import { BN, BorshAccountsCoder } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey, type Connection } from '@solana/web3.js';
import type { Idl } from '@coral-xyz/anchor';
import { getProtocolById } from './idlRegistry';
import { previewIdlInstruction } from './idlDeclarativeRuntime';
import { runRegisteredComputeStep } from './metaComputeRegistry';

const SUPPORTED_META_IDL_SCHEMAS = new Set(['meta-idl.v0.1', 'meta-idl.v0.2']);
const DEFAULT_SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

type ResolverName =
  | 'wallet_pubkey'
  | 'decode_account'
  | 'ata'
  | 'pda'
  | 'lookup';

type LookupMode = 'first' | 'all';
type ComputeKind = string;

type ResolverStepFallback = {
  resolver: ResolverName;
  address?: unknown;
  account_type?: string;
  owner?: unknown;
  mint?: unknown;
  program_id?: unknown;
  seeds?: unknown[];
  source?: string;
  where?: unknown;
  select?: unknown;
  mode?: LookupMode;
};

type DeriveStep = ResolverStepFallback & {
  name: string;
  fallback?: ResolverStepFallback;
};

type ComputeStep = {
  name: string;
  compute: ComputeKind;
  [key: string]: unknown;
};

type ActionInputSpec = {
  type: string;
  required?: boolean;
  default?: unknown;
};

type ActionSpec = {
  instruction?: string;
  inputs?: Record<string, ActionInputSpec>;
  derive?: DeriveStep[];
  compute?: ComputeStep[];
  args?: Record<string, unknown>;
  accounts?: Record<string, unknown>;
  post?: PostInstructionSpec[];
  use?: MacroUseSpec[];
};

type MaterializedActionSpec = {
  instruction: string;
  inputs: Record<string, ActionInputSpec>;
  derive: DeriveStep[];
  compute: ComputeStep[];
  args: Record<string, unknown>;
  accounts: Record<string, unknown>;
  post?: PostInstructionSpec[];
};

type MacroParamSpec =
  | string
  | {
      type?: string;
      required?: boolean;
      default?: unknown;
    };

type MacroSpec = {
  params?: Record<string, MacroParamSpec>;
  expand: Omit<ActionSpec, 'use'>;
};

type MacroUseSpec = {
  macro: string;
  with?: Record<string, unknown>;
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
  macros?: Record<string, MacroSpec>;
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
  if (meta.schema && !SUPPORTED_META_IDL_SCHEMAS.has(meta.schema)) {
    throw new Error(
      `Unsupported meta IDL schema for ${protocolId}: ${meta.schema}. Supported: ${[...SUPPORTED_META_IDL_SCHEMAS].join(', ')}.`,
    );
  }

  if (meta.protocolId !== protocolId) {
    throw new Error(`Meta protocolId mismatch: expected ${protocolId}, got ${meta.protocolId}.`);
  }

  if (!meta.actions || typeof meta.actions !== 'object') {
    throw new Error(`Meta IDL for ${protocolId} is missing actions.`);
  }

  return meta;
}

function cloneJsonLike<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveMacroTemplateValue(value: unknown, paramScope: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$param.')) {
    return resolvePath(paramScope, value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveMacroTemplateValue(item, paramScope));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        resolveMacroTemplateValue(nested, paramScope),
      ]),
    );
  }

  return value;
}

function resolveMacroParams(macroName: string, macro: MacroSpec, use: MacroUseSpec): Record<string, unknown> {
  const provided = use.with ?? {};
  if (macro.params && typeof macro.params !== 'object') {
    throw new Error(`Macro ${macroName} params must be an object.`);
  }

  const resolved: Record<string, unknown> = {};
  if (macro.params) {
    for (const [name, rawSpec] of Object.entries(macro.params)) {
      const spec = typeof rawSpec === 'string' ? { type: rawSpec } : rawSpec;
      if (provided[name] !== undefined) {
        resolved[name] = provided[name];
        continue;
      }
      if (spec.default !== undefined) {
        resolved[name] = spec.default;
        continue;
      }
      if (spec.required !== false) {
        throw new Error(`Macro ${macroName} missing required param ${name}.`);
      }
    }

    for (const key of Object.keys(provided)) {
      if (!(key in macro.params)) {
        throw new Error(`Macro ${macroName} received unknown param ${key}.`);
      }
    }
  } else {
    Object.assign(resolved, provided);
  }

  return resolved;
}

function mergeActionFragment(target: MaterializedActionSpec, fragment: Omit<ActionSpec, 'use'>, label: string): void {
  if (fragment.instruction) {
    if (target.instruction && target.instruction !== fragment.instruction) {
      throw new Error(
        `Conflicting instruction while materializing action (${label}): ${target.instruction} vs ${fragment.instruction}.`,
      );
    }
    target.instruction = fragment.instruction;
  }

  if (fragment.inputs) {
    target.inputs = {
      ...target.inputs,
      ...cloneJsonLike(fragment.inputs),
    };
  }

  if (fragment.derive) {
    target.derive.push(...cloneJsonLike(fragment.derive));
  }

  if (fragment.compute) {
    target.compute.push(...cloneJsonLike(fragment.compute));
  }

  if (fragment.args) {
    target.args = {
      ...target.args,
      ...cloneJsonLike(fragment.args),
    };
  }

  if (fragment.accounts) {
    target.accounts = {
      ...target.accounts,
      ...cloneJsonLike(fragment.accounts),
    };
  }

  if (fragment.post && fragment.post.length > 0) {
    target.post = [...(target.post ?? []), ...cloneJsonLike(fragment.post)];
  }
}

function materializeAction(actionId: string, action: ActionSpec, meta: MetaIdlSpec): MaterializedActionSpec {
  const materialized: MaterializedActionSpec = {
    instruction: '',
    inputs: {},
    derive: [],
    compute: [],
    args: {},
    accounts: {},
    post: [],
  };

  for (const use of action.use ?? []) {
    if (!use.macro) {
      throw new Error(`Action ${actionId} contains macro use without macro name.`);
    }

    const macro = meta.macros?.[use.macro];
    if (!macro) {
      throw new Error(`Action ${actionId} references unknown macro ${use.macro}.`);
    }

    const params = resolveMacroParams(use.macro, macro, use);
    const expanded = resolveMacroTemplateValue(cloneJsonLike(macro.expand), { param: params }) as Omit<ActionSpec, 'use'>;
    mergeActionFragment(materialized, expanded, `macro ${use.macro}`);
  }

  const actionDirectFragment = cloneJsonLike({
    instruction: action.instruction,
    inputs: action.inputs,
    derive: action.derive,
    compute: action.compute,
    args: action.args,
    accounts: action.accounts,
    post: action.post,
  });
  mergeActionFragment(materialized, actionDirectFragment, `action ${actionId}`);

  if (!materialized.instruction) {
    throw new Error(`Action ${actionId} has no instruction after macro expansion.`);
  }

  if (!materialized.accounts || Object.keys(materialized.accounts).length === 0) {
    throw new Error(`Action ${actionId} has no accounts mapping after macro expansion.`);
  }

  return materialized;
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

  throw new Error(`Unsupported resolver: ${step.resolver}`);
}

async function runComputeStep(step: ComputeStep, ctx: ResolverContext): Promise<unknown> {
  const resolvedStep = asRecord(normalizeRuntimeValue(resolveTemplateValue(step, ctx.scope)), `compute:${step.name}`);
  const compute = asString(resolvedStep.compute, `compute:${step.name}:compute`);
  return runRegisteredComputeStep(
    {
      ...resolvedStep,
      name: step.name,
      compute,
    },
    {
      protocolId: ctx.protocol.id,
      programId: ctx.protocol.programId,
      connection: ctx.connection,
      walletPublicKey: ctx.walletPublicKey,
      idl: ctx.idl,
      scope: ctx.scope,
      previewInstruction: async ({ instructionName, args, accounts }) => {
        const preview = await previewIdlInstruction({
          protocolId: ctx.protocol.id,
          instructionName,
          args,
          accounts,
          walletPublicKey: ctx.walletPublicKey,
        });

        return {
          programId: preview.programId,
          dataBase64: preview.dataBase64,
          keys: preview.keys,
        };
      },
    },
  );
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

  const actionSpec = meta.actions[options.actionId];
  if (!actionSpec) {
    throw new Error(`Action ${options.actionId} not found in meta IDL for ${options.protocolId}.`);
  }
  const action = materializeAction(options.actionId, actionSpec, meta);

  const hydratedInput: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(action.inputs ?? {})) {
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

  for (const step of action.derive ?? []) {
    if (!step.name) {
      throw new Error(`Action ${options.actionId} has derive step without name.`);
    }

    const value = await runResolver(step, resolverCtx);
    derived[step.name] = value;
    scope[step.name] = value;
  }

  for (const step of action.compute ?? []) {
    if (!step.name) {
      throw new Error(`Action ${options.actionId} has compute step without name.`);
    }

    const value = await runComputeStep(step, resolverCtx);
    derived[step.name] = value;
    scope[step.name] = value;
  }

  const resolvedArgs = normalizeRuntimeValue(resolveTemplateValue(action.args ?? {}, scope));
  const resolvedAccounts = normalizeRuntimeValue(resolveTemplateValue(action.accounts ?? {}, scope));
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
