import { BN, BorshAccountsCoder, BorshCoder, EventParser } from '@coral-xyz/anchor';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { PublicKey, Transaction, TransactionInstruction, type Connection } from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { Idl } from '@coral-xyz/anchor';
import { getProtocolById } from './idlRegistry';
import { previewIdlInstruction } from './idlDeclarativeRuntime';

const META_IDL_SCHEMA = 'meta-idl.v0.1';
const DEFAULT_SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ORCA_TICK_ARRAY_SIZE = 88;
const ORCA_MIN_SQRT_PRICE = '4295048016';
const ORCA_MAX_SQRT_PRICE = '79226673515401279992447579055';

type ResolverName =
  | 'wallet_pubkey'
  | 'decode_account'
  | 'ata'
  | 'pda'
  | 'orca_swap_quote'
  | 'lookup';

type LookupMode = 'first' | 'all';

type ResolverStepFallback = {
  resolver: ResolverName;
  address?: unknown;
  account_type?: string;
  owner?: unknown;
  mint?: unknown;
  program_id?: unknown;
  seeds?: unknown[];
  whirlpool?: unknown;
  amount?: unknown;
  a_to_b?: unknown;
  slippage_bps?: unknown;
  tick_arrays?: unknown;
  source?: string;
  where?: unknown;
  select?: unknown;
  mode?: LookupMode;
};

type DeriveStep = ResolverStepFallback & {
  name: string;
  fallback?: ResolverStepFallback;
};

type ActionInputSpec = {
  type: string;
  required?: boolean;
  default?: unknown;
};

type ActionSpec = {
  instruction: string;
  inputs: Record<string, ActionInputSpec>;
  derive: DeriveStep[];
  args: Record<string, unknown>;
  accounts: Record<string, unknown>;
  post?: PostInstructionSpec[];
};

type MetaCondition =
  | { equals: [unknown, unknown] }
  | { all: MetaCondition[] }
  | { any: MetaCondition[] }
  | { not: MetaCondition };

type PostInstructionSpec = {
  kind: 'spl_token_close_account';
  account: unknown;
  destination: unknown;
  owner: unknown;
  token_program?: unknown;
  when?: MetaCondition;
};

type LookupSourceSpec =
  | { kind: 'inline'; items: unknown[] }
  | { kind: 'http_json'; url: string; items_path?: string; ttl_ms?: number };

type MetaIdlSpec = {
  schema?: string;
  version: string;
  protocolId: string;
  sources?: Record<string, LookupSourceSpec>;
  actions: Record<string, ActionSpec>;
};

type ResolverContext = {
  protocol: {
    id: string;
    name: string;
    network: string;
    programId: string;
    idlPath: string;
    metaPath: string;
  };
  meta: MetaIdlSpec;
  input: Record<string, unknown>;
  idl: Idl;
  connection: Connection;
  walletPublicKey: PublicKey;
  scope: Record<string, unknown>;
};

type PreparedMetaInstruction = {
  protocolId: string;
  instructionName: string;
  args: Record<string, unknown>;
  accounts: Record<string, string>;
  derived: Record<string, unknown>;
  postInstructions: PreparedPostInstruction[];
};

type PreparedPostInstruction = {
  kind: 'spl_token_close_account';
  account: string;
  destination: string;
  owner: string;
  tokenProgram: string;
};

const metaCache = new Map<string, MetaIdlSpec>();
const idlCache = new Map<string, Idl>();
const lookupSourceCache = new Map<string, { expiresAt: number; items: unknown[] }>();

type OrcaTickArrayStrategy = {
  searchStartOffsets: number[];
  windowSize: number;
  allowReuseLast: boolean;
};

function normalizeRuntimeValue(value: unknown): unknown {
  if (BN.isBN(value)) {
    return (value as BN).toString();
  }

  if (value instanceof PublicKey) {
    return value.toBase58();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeRuntimeValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeRuntimeValue(nested)]),
    );
  }

  return value;
}

function readPathFromValue(value: unknown, path: string): unknown {
  const cleaned = path.startsWith('$') ? path.slice(1) : path;
  const parts = cleaned.split('.').filter(Boolean);
  let current: unknown = value;

  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function resolvePath(scope: Record<string, unknown>, path: string): unknown {
  const resolved = readPathFromValue(scope, path);
  if (resolved === undefined) {
    throw new Error(`Cannot resolve path ${path}`);
  }

  return resolved;
}

function resolveTemplateValue(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    return resolvePath(scope, value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplateValue(item, scope));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        resolveTemplateValue(nested, scope),
      ]),
    );
  }

  return value;
}

function normalizeComparable(value: unknown): unknown {
  const normalized = normalizeRuntimeValue(value);
  if (Array.isArray(normalized)) {
    return normalized.map(normalizeComparable);
  }

  if (normalized && typeof normalized === 'object') {
    const entries = Object.entries(normalized as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, normalizeComparable(nested)] as const);
    return Object.fromEntries(entries);
  }

  return normalized;
}

function comparableHash(value: unknown): string {
  return JSON.stringify(normalizeComparable(value));
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return comparableHash(left) === comparableHash(right);
}

function asString(value: unknown, label: string): string {
  if (typeof value === 'string') {
    return value;
  }

  throw new Error(`${label} must be a string.`);
}

function asPubkey(value: unknown, label: string): PublicKey {
  if (value instanceof PublicKey) {
    return value;
  }

  if (typeof value === 'string') {
    return new PublicKey(value);
  }

  throw new Error(`${label} must be a public key.`);
}

function asBool(value: unknown, label: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  throw new Error(`${label} must be boolean.`);
}

function asIntegerString(value: unknown, label: string): string {
  const normalized = typeof value === 'number' || typeof value === 'bigint' ? value.toString() : value;
  if (typeof normalized !== 'string' || !/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be an unsigned integer string.`);
  }

  return normalized;
}

function asIntegerArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of safe integers.`);
  }

  const parsed = value.map((entry, index) => asSafeInteger(entry, `${label}[${index}]`));
  if (parsed.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }

  return parsed;
}

function asSignedIntegerString(value: unknown, label: string): string {
  const normalized = typeof value === 'number' || typeof value === 'bigint' ? value.toString() : value;
  if (typeof normalized !== 'string' || !/^-?\d+$/.test(normalized)) {
    throw new Error(`${label} must be an integer string.`);
  }

  return normalized;
}

function asSafeInteger(value: unknown, label: string): number {
  const parsed = Number(asSignedIntegerString(value, label));
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a safe integer.`);
  }
  return parsed;
}

function asBigInt(value: unknown, label: string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} must be a safe integer.`);
    }
    return BigInt(value);
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }

  if (BN.isBN(value)) {
    return BigInt((value as BN).toString());
  }

  throw new Error(`${label} must be an integer-like value.`);
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof atob !== 'function') {
    throw new Error('Base64 decoder is unavailable in this runtime.');
  }

  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function readU64Le(bytes: Uint8Array, offset: number): bigint {
  if (bytes.length < offset + 8) {
    throw new Error(`Unable to decode u64 at offset ${offset}: insufficient data length ${bytes.length}.`);
  }

  let value = 0n;
  for (let i = 0; i < 8; i += 1) {
    value |= BigInt(bytes[offset + i]) << BigInt(i * 8);
  }
  return value;
}

function readTokenAmountFromRawAccountData(data: Uint8Array | null | undefined): bigint {
  if (!data) {
    return 0n;
  }

  return readU64Le(data, 64);
}

function readTokenAmountFromSimAccount(simAccount: unknown): bigint {
  if (!simAccount || typeof simAccount !== 'object') {
    return 0n;
  }

  const data = (simAccount as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== 'string') {
    return 0n;
  }

  return readTokenAmountFromRawAccountData(decodeBase64(data[0]));
}

function getOrcaTickArrayStartIndex(tickIndex: number, tickSpacing: number, offset = 0): number {
  const arrayWidth = tickSpacing * ORCA_TICK_ARRAY_SIZE;
  const realIndex = Math.floor(tickIndex / arrayWidth);
  return (realIndex + offset) * arrayWidth;
}

function deriveOrcaTickArrayPda(programId: PublicKey, whirlpool: PublicKey, startTickIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('tick_array'), whirlpool.toBuffer(), new TextEncoder().encode(startTickIndex.toString())],
    programId,
  )[0];
}

function getRecordValue(
  record: Record<string, unknown>,
  candidates: string[],
  label: string,
): unknown {
  for (const candidate of candidates) {
    if (record[candidate] !== undefined) {
      return record[candidate];
    }
  }

  throw new Error(`Missing field ${label}. Expected one of: ${candidates.join(', ')}`);
}

function resolveOrcaTickArrayStrategy(step: DeriveStep, scope: Record<string, unknown>): OrcaTickArrayStrategy {
  const defaultStrategy: OrcaTickArrayStrategy = {
    searchStartOffsets: [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6],
    windowSize: 3,
    allowReuseLast: true,
  };

  if (!step.tick_arrays) {
    return defaultStrategy;
  }

  const resolved = asRecord(
    normalizeRuntimeValue(resolveTemplateValue(step.tick_arrays, scope)),
    `orca_swap_quote:${step.name}:tick_arrays`,
  );

  const searchStartOffsets =
    resolved.search_start_offsets !== undefined
      ? asIntegerArray(
          resolved.search_start_offsets,
          `orca_swap_quote:${step.name}:tick_arrays.search_start_offsets`,
        )
      : defaultStrategy.searchStartOffsets;

  const windowSize =
    resolved.window_size !== undefined
      ? asSafeInteger(resolved.window_size, `orca_swap_quote:${step.name}:tick_arrays.window_size`)
      : defaultStrategy.windowSize;

  if (windowSize < 1 || windowSize > 8) {
    throw new Error(`orca_swap_quote:${step.name}:tick_arrays.window_size must be between 1 and 8.`);
  }

  const allowReuseLast =
    resolved.allow_reuse_last !== undefined
      ? asBool(resolved.allow_reuse_last, `orca_swap_quote:${step.name}:tick_arrays.allow_reuse_last`)
      : defaultStrategy.allowReuseLast;

  return {
    searchStartOffsets,
    windowSize,
    allowReuseLast,
  };
}

function parseTradedEvent(logs: string[], idl: Idl, programId: PublicKey): { inAmount: bigint; outAmount: bigint } | null {
  try {
    const parser = new EventParser(programId, new BorshCoder(idl));
    const events = [...parser.parseLogs(logs)];
    const traded = [...events].reverse().find((event) => event.name.toLowerCase() === 'traded');
    if (!traded || !traded.data || typeof traded.data !== 'object') {
      return null;
    }

    const eventData = traded.data as Record<string, unknown>;
    const inAmount = asBigInt(
      eventData.input_amount ?? eventData.inputAmount ?? eventData.amount_in ?? eventData.amountIn,
      'traded.input_amount',
    );
    const outAmount = asBigInt(
      eventData.output_amount ?? eventData.outputAmount ?? eventData.amount_out ?? eventData.amountOut,
      'traded.output_amount',
    );

    return { inAmount, outAmount };
  } catch {
    return null;
  }
}

function assertStringRecord(value: unknown, label: string): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must resolve to an object.`);
  }

  const mapped = Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    const normalized = normalizeRuntimeValue(entry);
    if (typeof normalized !== 'string') {
      throw new Error(`${label}.${key} must resolve to string.`);
    }

    return [key, normalized] as const;
  });

  return Object.fromEntries(mapped);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must resolve to an object.`);
  }

  return value as Record<string, unknown>;
}

function resolveWhereFilter(where: unknown, scope: Record<string, unknown>, label: string): Record<string, unknown> {
  if (where === undefined) {
    return {};
  }

  return asRecord(resolveTemplateValue(where, scope), label);
}

function itemMatchesWhere(item: unknown, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([path, expected]) => {
    const actual = readPathFromValue(item, path);
    return valuesEqual(actual, expected);
  });
}

function applySelectTemplate(select: unknown, item: unknown, scope: Record<string, unknown>): unknown {
  if (select === undefined) {
    return item;
  }

  return resolveTemplateValue(select, {
    ...scope,
    item,
  });
}

function resolveCollectionMode(mode: LookupMode | undefined): LookupMode {
  if (!mode) {
    return 'first';
  }

  if (mode === 'first' || mode === 'all') {
    return mode;
  }

  throw new Error(`Unsupported collection mode: ${String(mode)}`);
}

function resolveCollectionCandidates(step: DeriveStep, items: unknown[], scope: Record<string, unknown>): unknown[] {
  const where = resolveWhereFilter(step.where, scope, `${step.resolver}:${step.name}:where`);
  return items
    .filter((item) => itemMatchesWhere(item, where))
    .map((item) => applySelectTemplate(step.select, item, scope));
}

function buildFallbackStep(step: DeriveStep): DeriveStep | null {
  if (!step.fallback) {
    return null;
  }

  return {
    name: `${step.name}_fallback`,
    ...step.fallback,
  };
}

function readItemsByPath(value: unknown, path?: string): unknown[] {
  if (path) {
    const resolved = readPathFromValue(value, path);
    if (!Array.isArray(resolved)) {
      throw new Error(`items_path ${path} did not resolve to an array.`);
    }
    return resolved;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    const maybeItems = (value as Record<string, unknown>).items;
    if (Array.isArray(maybeItems)) {
      return maybeItems;
    }
  }

  throw new Error('Lookup source response must be an array or expose an array in "items".');
}

function assertMetaSpec(meta: MetaIdlSpec, protocolId: string): MetaIdlSpec {
  if (meta.schema && meta.schema !== META_IDL_SCHEMA) {
    throw new Error(`Unsupported meta IDL schema for ${protocolId}: ${meta.schema}. Expected ${META_IDL_SCHEMA}.`);
  }

  if (meta.protocolId !== protocolId) {
    throw new Error(`Meta protocolId mismatch: expected ${protocolId}, got ${meta.protocolId}.`);
  }

  if (!meta.actions || typeof meta.actions !== 'object') {
    throw new Error(`Meta IDL for ${protocolId} is missing actions.`);
  }

  return meta;
}

function evaluateCondition(condition: MetaCondition, scope: Record<string, unknown>): boolean {
  if ('equals' in condition) {
    const [left, right] = condition.equals;
    const resolvedLeft = normalizeRuntimeValue(resolveTemplateValue(left, scope));
    const resolvedRight = normalizeRuntimeValue(resolveTemplateValue(right, scope));
    return valuesEqual(resolvedLeft, resolvedRight);
  }

  if ('all' in condition) {
    return condition.all.every((entry) => evaluateCondition(entry, scope));
  }

  if ('any' in condition) {
    return condition.any.some((entry) => evaluateCondition(entry, scope));
  }

  if ('not' in condition) {
    return !evaluateCondition(condition.not, scope);
  }

  throw new Error('Unsupported meta condition.');
}

function resolvePostInstructions(
  post: PostInstructionSpec[] | undefined,
  scope: Record<string, unknown>,
): PreparedPostInstruction[] {
  if (!post || post.length === 0) {
    return [];
  }

  return post
    .filter((spec) => (spec.when ? evaluateCondition(spec.when, scope) : true))
    .map((spec) => {
      if (spec.kind !== 'spl_token_close_account') {
        throw new Error(`Unsupported post instruction kind: ${spec.kind}`);
      }

      const account = asString(resolveTemplateValue(spec.account, scope), 'post.account');
      const destination = asString(resolveTemplateValue(spec.destination, scope), 'post.destination');
      const owner = asString(resolveTemplateValue(spec.owner, scope), 'post.owner');
      const tokenProgram = spec.token_program
        ? asString(resolveTemplateValue(spec.token_program, scope), 'post.token_program')
        : DEFAULT_SPL_TOKEN_PROGRAM;

      return {
        kind: 'spl_token_close_account',
        account,
        destination,
        owner,
        tokenProgram,
      };
    });
}

async function loadMetaSpec(protocolId: string): Promise<MetaIdlSpec> {
  if (metaCache.has(protocolId)) {
    return metaCache.get(protocolId)!;
  }

  const protocol = await getProtocolById(protocolId);
  if (!protocol.metaPath) {
    throw new Error(`Protocol ${protocolId} does not define metaPath in registry.`);
  }

  const response = await fetch(protocol.metaPath);
  if (!response.ok) {
    throw new Error(`Failed to load meta IDL from ${protocol.metaPath}`);
  }

  const parsed = assertMetaSpec((await response.json()) as MetaIdlSpec, protocolId);
  metaCache.set(protocolId, parsed);
  return parsed;
}

async function loadProtocolIdl(protocolId: string): Promise<Idl> {
  if (idlCache.has(protocolId)) {
    return idlCache.get(protocolId)!;
  }

  const protocol = await getProtocolById(protocolId);
  const response = await fetch(protocol.idlPath);
  if (!response.ok) {
    throw new Error(`Failed to load IDL from ${protocol.idlPath}`);
  }

  const parsed = (await response.json()) as Idl;
  idlCache.set(protocolId, parsed);
  return parsed;
}

async function loadLookupItems(step: DeriveStep, ctx: ResolverContext): Promise<unknown[]> {
  if (!step.source) {
    throw new Error(`Resolver lookup for ${step.name} missing source.`);
  }

  const source = ctx.meta.sources?.[step.source];
  if (!source) {
    throw new Error(`Lookup source ${step.source} not found in meta IDL.`);
  }

  if (source.kind === 'inline') {
    return source.items;
  }

  const resolvedUrl = asString(resolveTemplateValue(source.url, ctx.scope), `lookup:${step.name}:source.url`);
  const cacheKey = `${ctx.protocol.id}:${step.source}:${resolvedUrl}`;
  const now = Date.now();
  const ttlMs = source.ttl_ms ?? 0;
  const cached = lookupSourceCache.get(cacheKey);
  if (cached && cached.expiresAt >= now) {
    return cached.items;
  }

  const response = await fetch(resolvedUrl);
  if (!response.ok) {
    throw new Error(`Lookup source ${step.source} fetch failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as unknown;
  const items = readItemsByPath(body, source.items_path);

  if (ttlMs > 0) {
    lookupSourceCache.set(cacheKey, {
      expiresAt: now + ttlMs,
      items,
    });
  }

  return items;
}

async function runResolver(step: DeriveStep, ctx: ResolverContext): Promise<unknown> {
  if (step.resolver === 'wallet_pubkey') {
    return ctx.walletPublicKey.toBase58();
  }

  if (step.resolver === 'decode_account') {
    if (!step.address || !step.account_type) {
      throw new Error(`Resolver decode_account for ${step.name} missing address/account_type.`);
    }

    const address = asPubkey(resolveTemplateValue(step.address, ctx.scope), `decode_account:${step.name}:address`);
    const info = await ctx.connection.getAccountInfo(address, 'confirmed');
    if (!info) {
      throw new Error(`Account not found for decode_account ${step.name}: ${address.toBase58()}`);
    }

    const coder = new BorshAccountsCoder(ctx.idl);
    const decoded = coder.decode(step.account_type, info.data);
    return normalizeRuntimeValue(decoded);
  }

  if (step.resolver === 'ata') {
    if (!step.owner || !step.mint) {
      throw new Error(`Resolver ata for ${step.name} missing owner/mint.`);
    }

    const owner = asPubkey(resolveTemplateValue(step.owner, ctx.scope), `ata:${step.name}:owner`);
    const mint = asPubkey(resolveTemplateValue(step.mint, ctx.scope), `ata:${step.name}:mint`);
    return getAssociatedTokenAddressSync(mint, owner).toBase58();
  }

  if (step.resolver === 'pda') {
    if (!step.program_id || !step.seeds) {
      throw new Error(`Resolver pda for ${step.name} missing program_id/seeds.`);
    }

    const programId = asPubkey(resolveTemplateValue(step.program_id, ctx.scope), `pda:${step.name}:program_id`);

    const seeds = step.seeds.map((seed, index) => {
      if (typeof seed === 'string' && seed.startsWith('utf8:')) {
        return new TextEncoder().encode(seed.slice('utf8:'.length));
      }

      const resolved = resolveTemplateValue(seed, ctx.scope);
      const asKey = asPubkey(resolved, `pda:${step.name}:seed[${index}]`);
      return asKey.toBuffer();
    });

    return PublicKey.findProgramAddressSync(seeds, programId)[0].toBase58();
  }

  if (step.resolver === 'lookup') {
    const mode = resolveCollectionMode(step.mode);
    const items = await loadLookupItems(step, ctx);
    const candidates = resolveCollectionCandidates(step, items, ctx.scope);
    if (candidates.length === 0) {
      const fallbackStep = buildFallbackStep(step);
      if (fallbackStep) {
        return runResolver(fallbackStep, ctx);
      }
      throw new Error(`lookup resolver returned no candidate for step ${step.name}.`);
    }

    if (mode === 'all') {
      return normalizeRuntimeValue(candidates);
    }

    return normalizeRuntimeValue(candidates[0]);
  }

  if (step.resolver === 'orca_swap_quote') {
    if (!step.whirlpool || !step.amount || step.a_to_b === undefined || !step.slippage_bps) {
      throw new Error(`Resolver orca_swap_quote for ${step.name} missing fields.`);
    }

    const whirlpoolAddress = asPubkey(
      resolveTemplateValue(step.whirlpool, ctx.scope),
      `orca_swap_quote:${step.name}:whirlpool`,
    );
    const amount = asIntegerString(
      resolveTemplateValue(step.amount, ctx.scope),
      `orca_swap_quote:${step.name}:amount`,
    );
    const aToB = asBool(resolveTemplateValue(step.a_to_b, ctx.scope), `orca_swap_quote:${step.name}:a_to_b`);
    const slippageBps = Number(
      asIntegerString(resolveTemplateValue(step.slippage_bps, ctx.scope), `orca_swap_quote:${step.name}:slippage_bps`),
    );
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
      throw new Error(`orca_swap_quote:${step.name}:slippage_bps must be an integer between 0 and 10000.`);
    }

    const whirlpoolData = asRecord(ctx.scope.whirlpool_data, `orca_swap_quote:${step.name}:whirlpool_data`);
    const tickCurrentIndex = asSafeInteger(
      getRecordValue(whirlpoolData, ['tick_current_index', 'tickCurrentIndex'], 'tick_current_index'),
      `orca_swap_quote:${step.name}:tick_current_index`,
    );
    const tickSpacing = asSafeInteger(
      getRecordValue(whirlpoolData, ['tick_spacing', 'tickSpacing'], 'tick_spacing'),
      `orca_swap_quote:${step.name}:tick_spacing`,
    );
    if (tickSpacing <= 0) {
      throw new Error(`orca_swap_quote:${step.name}:tick_spacing must be > 0.`);
    }

    const tickArrayStrategy = resolveOrcaTickArrayStrategy(step, ctx.scope);
    const directionSign = aToB ? -1 : 1;
    const programId = new PublicKey(ctx.protocol.programId);
    const candidateTickArraySets: PublicKey[][] = [];
    const seenCandidates = new Set<string>();
    for (const startOffset of tickArrayStrategy.searchStartOffsets) {
      const offsets = Array.from(
        { length: tickArrayStrategy.windowSize },
        (_, index) => directionSign * (startOffset + index),
      );
      const tickArrayStarts = offsets.map((offset) => getOrcaTickArrayStartIndex(tickCurrentIndex, tickSpacing, offset));
      const derivedTickArrayPubkeys = tickArrayStarts.map((startTickIndex) =>
        deriveOrcaTickArrayPda(programId, whirlpoolAddress, startTickIndex),
      );
      const tickArrayInfos = await ctx.connection.getMultipleAccountsInfo(derivedTickArrayPubkeys, 'confirmed');

      if (!tickArrayInfos[0]) {
        continue;
      }

      const resolvedTickArrays: PublicKey[] = [];
      let invalidCandidate = false;
      for (let i = 0; i < derivedTickArrayPubkeys.length; i += 1) {
        if (tickArrayInfos[i]) {
          resolvedTickArrays.push(derivedTickArrayPubkeys[i]);
          continue;
        }

        if (!tickArrayStrategy.allowReuseLast || i === 0) {
          invalidCandidate = true;
          break;
        }

        resolvedTickArrays.push(resolvedTickArrays[i - 1]);
      }

      if (invalidCandidate) {
        continue;
      }

      const candidateKey = resolvedTickArrays.map((pubkey) => pubkey.toBase58()).join('|');
      if (seenCandidates.has(candidateKey)) {
        continue;
      }
      seenCandidates.add(candidateKey);
      candidateTickArraySets.push(resolvedTickArrays);
    }

    if (candidateTickArraySets.length === 0) {
      throw new Error(
        `orca_swap_quote:${step.name}: no initialized tick array candidate found for search offsets ${tickArrayStrategy.searchStartOffsets.join(',')}.`,
      );
    }

    const tokenOwnerAccountA = asPubkey(
      ctx.scope.token_owner_account_a,
      `orca_swap_quote:${step.name}:token_owner_account_a`,
    );
    const tokenOwnerAccountB = asPubkey(
      ctx.scope.token_owner_account_b,
      `orca_swap_quote:${step.name}:token_owner_account_b`,
    );
    const tokenVaultA = asPubkey(
      getRecordValue(whirlpoolData, ['token_vault_a', 'tokenVaultA'], 'token_vault_a'),
      `orca_swap_quote:${step.name}:token_vault_a`,
    );
    const tokenVaultB = asPubkey(
      getRecordValue(whirlpoolData, ['token_vault_b', 'tokenVaultB'], 'token_vault_b'),
      `orca_swap_quote:${step.name}:token_vault_b`,
    );
    const tokenMintA = asPubkey(
      getRecordValue(whirlpoolData, ['token_mint_a', 'tokenMintA'], 'token_mint_a'),
      `orca_swap_quote:${step.name}:token_mint_a`,
    );
    const tokenMintB = asPubkey(
      getRecordValue(whirlpoolData, ['token_mint_b', 'tokenMintB'], 'token_mint_b'),
      `orca_swap_quote:${step.name}:token_mint_b`,
    );
    const oracle = asPubkey(ctx.scope.oracle, `orca_swap_quote:${step.name}:oracle`);

    const preInstructions = [
      createAssociatedTokenAccountIdempotentInstruction(
        ctx.walletPublicKey,
        tokenOwnerAccountA,
        ctx.walletPublicKey,
        tokenMintA,
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        ctx.walletPublicKey,
        tokenOwnerAccountB,
        ctx.walletPublicKey,
        tokenMintB,
      ),
    ];

    const provisionalArgs = {
      amount,
      other_amount_threshold: '0',
      sqrt_price_limit: aToB ? ORCA_MIN_SQRT_PRICE : ORCA_MAX_SQRT_PRICE,
      amount_specified_is_input: true,
      a_to_b: aToB,
    };
    const preAmounts = await ctx.connection.getMultipleAccountsInfo(
      [aToB ? tokenOwnerAccountA : tokenOwnerAccountB, aToB ? tokenOwnerAccountB : tokenOwnerAccountA],
      'confirmed',
    );
    const preInputAmount = readTokenAmountFromRawAccountData(preAmounts[0]?.data);
    const preOutputAmount = readTokenAmountFromRawAccountData(preAmounts[1]?.data);
    const simulationErrors: string[] = [];

    for (const resolvedTickArrays of candidateTickArraySets) {
      const provisionalAccounts = {
        token_program: DEFAULT_SPL_TOKEN_PROGRAM,
        token_authority: ctx.walletPublicKey.toBase58(),
        whirlpool: whirlpoolAddress.toBase58(),
        token_owner_account_a: tokenOwnerAccountA.toBase58(),
        token_vault_a: tokenVaultA.toBase58(),
        token_owner_account_b: tokenOwnerAccountB.toBase58(),
        token_vault_b: tokenVaultB.toBase58(),
        tick_array_0: resolvedTickArrays[0].toBase58(),
        tick_array_1: resolvedTickArrays[1].toBase58(),
        tick_array_2: resolvedTickArrays[2].toBase58(),
        oracle: oracle.toBase58(),
      };

      const preview = await previewIdlInstruction({
        protocolId: ctx.protocol.id,
        instructionName: 'swap',
        args: provisionalArgs,
        accounts: provisionalAccounts,
        walletPublicKey: ctx.walletPublicKey,
      });

      const mainInstruction = new TransactionInstruction({
        programId: new PublicKey(preview.programId),
        keys: preview.keys.map((key) => ({
          pubkey: new PublicKey(key.pubkey),
          isSigner: key.isSigner,
          isWritable: key.isWritable,
        })),
        data: Buffer.from(decodeBase64(preview.dataBase64)),
      });
      const tx = new Transaction();
      tx.feePayer = ctx.walletPublicKey;
      preInstructions.forEach((ix) => tx.add(ix));
      tx.add(mainInstruction);

      const simulation = await ctx.connection.simulateTransaction(
        tx,
        undefined,
        [aToB ? tokenOwnerAccountA : tokenOwnerAccountB, aToB ? tokenOwnerAccountB : tokenOwnerAccountA],
      );

      if (simulation.value.err) {
        simulationErrors.push(
          `${resolvedTickArrays.map((key) => key.toBase58()).join(', ')} => ${JSON.stringify(simulation.value.err)}`,
        );
        continue;
      }

      const postInputAmount = readTokenAmountFromSimAccount(simulation.value.accounts?.[0]);
      const postOutputAmount = readTokenAmountFromSimAccount(simulation.value.accounts?.[1]);
      const eventQuote = parseTradedEvent(simulation.value.logs ?? [], ctx.idl, programId);

      let estimatedAmountIn = eventQuote?.inAmount ?? preInputAmount - postInputAmount;
      let estimatedAmountOut = eventQuote?.outAmount ?? postOutputAmount - preOutputAmount;
      if (estimatedAmountIn < 0n) {
        estimatedAmountIn = asBigInt(amount, `orca_swap_quote:${step.name}:amount`);
      }
      if (estimatedAmountOut < 0n) {
        estimatedAmountOut = 0n;
      }

      if (estimatedAmountOut === 0n) {
        simulationErrors.push(
          `${resolvedTickArrays.map((key) => key.toBase58()).join(', ')} => zero output during simulation`,
        );
        continue;
      }

      const otherAmountThreshold = (estimatedAmountOut * BigInt(10_000 - slippageBps)) / 10_000n;

      return {
        tickArray0: resolvedTickArrays[0].toBase58(),
        tickArray1: resolvedTickArrays[1].toBase58(),
        tickArray2: resolvedTickArrays[2].toBase58(),
        sqrtPriceLimit: aToB ? ORCA_MIN_SQRT_PRICE : ORCA_MAX_SQRT_PRICE,
        otherAmountThreshold: otherAmountThreshold.toString(),
        estimatedAmountIn: estimatedAmountIn.toString(),
        estimatedAmountOut: estimatedAmountOut.toString(),
      };
    }

    const errorDetail = simulationErrors.slice(0, 5).join('\n');
    throw new Error(
      `Swap quote simulation failed for all tick array candidates.\n${errorDetail || 'No simulation details available.'}`,
    );
  }

  throw new Error(`Unsupported resolver: ${step.resolver}`);
}

export async function prepareMetaInstruction(options: {
  protocolId: string;
  actionId: string;
  input: Record<string, unknown>;
  connection: Connection;
  walletPublicKey: PublicKey;
}): Promise<PreparedMetaInstruction> {
  const protocol = await getProtocolById(options.protocolId);
  const meta = await loadMetaSpec(options.protocolId);
  const idl = await loadProtocolIdl(options.protocolId);

  const action = meta.actions[options.actionId];
  if (!action) {
    throw new Error(`Action ${options.actionId} not found in meta IDL for ${options.protocolId}.`);
  }

  const hydratedInput: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(action.inputs)) {
    if (options.input[key] !== undefined) {
      hydratedInput[key] = options.input[key];
      continue;
    }

    if (spec.default !== undefined) {
      hydratedInput[key] = spec.default;
      continue;
    }

    if (spec.required !== false) {
      throw new Error(`Missing required meta input: ${key}`);
    }
  }

  const scope: Record<string, unknown> = {
    input: hydratedInput,
    protocol: {
      id: protocol.id,
      name: protocol.name,
      network: protocol.network,
      programId: protocol.programId,
      idlPath: protocol.idlPath,
      metaPath: protocol.metaPath,
    },
    meta,
  };

  const derived: Record<string, unknown> = {};

  const resolverCtx: ResolverContext = {
    protocol: scope.protocol as ResolverContext['protocol'],
    meta,
    input: hydratedInput,
    idl,
    connection: options.connection,
    walletPublicKey: options.walletPublicKey,
    scope,
  };

  for (const step of action.derive) {
    if (!step.name) {
      throw new Error(`Action ${options.actionId} has derive step without name.`);
    }

    const value = await runResolver(step, resolverCtx);
    derived[step.name] = value;
    scope[step.name] = value;
  }

  const resolvedArgs = normalizeRuntimeValue(resolveTemplateValue(action.args, scope));
  const resolvedAccounts = normalizeRuntimeValue(resolveTemplateValue(action.accounts, scope));
  const postInstructions = resolvePostInstructions(action.post, scope);

  return {
    protocolId: options.protocolId,
    instructionName: action.instruction,
    args: resolvedArgs as Record<string, unknown>,
    accounts: assertStringRecord(resolvedAccounts, 'accounts'),
    derived,
    postInstructions,
  };
}
