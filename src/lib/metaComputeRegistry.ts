import type { Idl } from '@coral-xyz/anchor';
import { PublicKey, type Connection } from '@solana/web3.js';

export type ComputeStepResolved = {
  name: string;
  compute: string;
  [key: string]: unknown;
};

export type ComputeInstructionPreview = {
  programId: string;
  dataBase64: string;
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
};

export type ComputeRuntimeContext = {
  protocolId: string;
  programId: string;
  connection: Connection;
  walletPublicKey: PublicKey;
  idl: Idl;
  scope: Record<string, unknown>;
  previewInstruction: (options: {
    instructionName: string;
    args: Record<string, unknown>;
    accounts: Record<string, string>;
  }) => Promise<ComputeInstructionPreview>;
};

type ComputeExecutor = (step: ComputeStepResolved, ctx: ComputeRuntimeContext) => Promise<unknown>;

type PdaSeedSpec =
  | { kind: 'utf8'; value: string }
  | { kind: 'pubkey'; value: unknown }
  | { kind: 'i32_le'; value: unknown }
  | { kind: 'item_i32_le' }
  | { kind: 'item_utf8' };

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function normalizeComparable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeComparable);
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, normalizeComparable(nested)] as const);
    return Object.fromEntries(entries);
  }

  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeComparable(left)) === JSON.stringify(normalizeComparable(right));
}

function asInteger(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label} must be a safe integer.`);
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

function toInt32LeBytes(value: number, label: string): Uint8Array {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new Error(`${label} must fit in i32.`);
  }

  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

async function runMathAdd(step: ComputeStepResolved): Promise<number> {
  const values = asArray(step.values, `compute:${step.name}:values`).map((entry, index) =>
    asInteger(entry, `compute:${step.name}:values[${index}]`),
  );
  if (values.length < 2) {
    throw new Error(`compute:${step.name}:values must contain at least 2 elements.`);
  }
  return values.reduce((acc, value) => acc + value, 0);
}

async function runMathMul(step: ComputeStepResolved): Promise<number> {
  const values = asArray(step.values, `compute:${step.name}:values`).map((entry, index) =>
    asInteger(entry, `compute:${step.name}:values[${index}]`),
  );
  if (values.length < 2) {
    throw new Error(`compute:${step.name}:values must contain at least 2 elements.`);
  }
  return values.reduce((acc, value) => acc * value, 1);
}

async function runMathFloorDiv(step: ComputeStepResolved): Promise<number> {
  const dividend = asInteger(step.dividend, `compute:${step.name}:dividend`);
  const divisor = asInteger(step.divisor, `compute:${step.name}:divisor`);
  if (divisor === 0) {
    throw new Error(`compute:${step.name}:divisor must not be zero.`);
  }
  return Math.floor(dividend / divisor);
}

async function runListRangeMap(step: ComputeStepResolved): Promise<number[]> {
  const base = asInteger(step.base, `compute:${step.name}:base`);
  const stepSize = asInteger(step.step, `compute:${step.name}:step`);
  const count = asInteger(step.count, `compute:${step.name}:count`);
  if (count <= 0 || count > 16) {
    throw new Error(`compute:${step.name}:count must be between 1 and 16.`);
  }

  return Array.from({ length: count }, (_, index) => base + index * stepSize);
}

function encodePdaSeed(seed: PdaSeedSpec, item: unknown, label: string): Uint8Array {
  if (seed.kind === 'utf8') {
    return new TextEncoder().encode(seed.value);
  }

  if (seed.kind === 'pubkey') {
    return asPubkey(seed.value, `${label}:value`).toBuffer();
  }

  if (seed.kind === 'i32_le') {
    return toInt32LeBytes(asInteger(seed.value, `${label}:value`), `${label}:value`);
  }

  if (seed.kind === 'item_utf8') {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'bigint') {
      throw new Error(`${label}:item must be string/number/bigint for item_utf8.`);
    }
    return new TextEncoder().encode(String(item));
  }

  return toInt32LeBytes(asInteger(item, `${label}:item`), `${label}:item`);
}

function parseSeedSpec(raw: unknown, label: string): PdaSeedSpec {
  const seed = asRecord(raw, label);
  const kind = seed.kind;
  if (kind === 'utf8') {
    if (typeof seed.value !== 'string') {
      throw new Error(`${label}: utf8 seed requires string value.`);
    }
    return { kind: 'utf8', value: seed.value };
  }

  if (kind === 'pubkey') {
    return { kind: 'pubkey', value: seed.value };
  }

  if (kind === 'i32_le') {
    return { kind: 'i32_le', value: seed.value };
  }

  if (kind === 'item_i32_le') {
    return { kind: 'item_i32_le' };
  }

  if (kind === 'item_utf8') {
    return { kind: 'item_utf8' };
  }

  throw new Error(`${label}: unsupported seed kind ${String(kind)}.`);
}

async function runPdaSeedSpec(step: ComputeStepResolved, ctx: ComputeRuntimeContext): Promise<string | string[]> {
  const programId = asPubkey(step.program_id ?? ctx.programId, `compute:${step.name}:program_id`);
  const seeds = asArray(step.seeds, `compute:${step.name}:seeds`).map((entry, index) =>
    parseSeedSpec(entry, `compute:${step.name}:seeds[${index}]`),
  );

  const mapOver = step.map_over === undefined ? null : asArray(step.map_over, `compute:${step.name}:map_over`);
  if (!mapOver) {
    const encodedSeeds = seeds.map((seed, index) =>
      encodePdaSeed(seed, undefined, `compute:${step.name}:seeds[${index}]`),
    );
    return PublicKey.findProgramAddressSync(encodedSeeds, programId)[0].toBase58();
  }

  return mapOver.map((item, itemIndex) => {
    const encodedSeeds = seeds.map((seed, seedIndex) =>
      encodePdaSeed(seed, item, `compute:${step.name}:map_over[${itemIndex}].seeds[${seedIndex}]`),
    );
    return PublicKey.findProgramAddressSync(encodedSeeds, programId)[0].toBase58();
  });
}

async function runCompareEquals(step: ComputeStepResolved): Promise<boolean> {
  return valuesEqual(step.left, step.right);
}

async function runLogicIf(step: ComputeStepResolved): Promise<unknown> {
  const condition = step.condition;
  if (typeof condition !== 'boolean') {
    throw new Error(`compute:${step.name}:condition must be boolean.`);
  }
  return condition ? step.then : step.else;
}

const COMPUTE_EXECUTORS: Record<string, ComputeExecutor> = {
  'math.add': runMathAdd,
  'math.mul': runMathMul,
  'math.floor_div': runMathFloorDiv,
  'list.range_map': runListRangeMap,
  'pda(seed_spec)': runPdaSeedSpec,
  'compare.equals': runCompareEquals,
  'logic.if': runLogicIf,
};

export async function runRegisteredComputeStep(step: ComputeStepResolved, ctx: ComputeRuntimeContext): Promise<unknown> {
  const executor = COMPUTE_EXECUTORS[step.compute];
  if (!executor) {
    throw new Error(`Unsupported compute step: ${step.compute}`);
  }

  return executor(step, ctx);
}
