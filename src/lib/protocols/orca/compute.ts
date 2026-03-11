import { BorshCoder, EventParser, type Idl } from '@coral-xyz/anchor';
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { ComputeRuntimeContext, ComputeStepResolved } from '../../metaComputeRegistry';

const ORCA_TICK_ARRAY_SIZE = 88;
const ORCA_MIN_SQRT_PRICE = '4295048016';
const ORCA_MAX_SQRT_PRICE = '79226673515401279992447579055';

type OrcaTickArrayStrategy = {
  searchStartOffsets: number[];
  windowSize: number;
  allowReuseLast: boolean;
};

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
  throw new Error(`${label} must be an integer-like value.`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must resolve to an object.`);
  }
  return value as Record<string, unknown>;
}

function getRecordValue(record: Record<string, unknown>, candidates: string[], label: string): unknown {
  for (const candidate of candidates) {
    if (record[candidate] !== undefined) {
      return record[candidate];
    }
  }
  throw new Error(`Missing field ${label}. Expected one of: ${candidates.join(', ')}`);
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

function resolveTickArrayStrategy(step: ComputeStepResolved): OrcaTickArrayStrategy {
  const defaultStrategy: OrcaTickArrayStrategy = {
    searchStartOffsets: [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6],
    windowSize: 3,
    allowReuseLast: true,
  };

  if (!step.tick_arrays) {
    return defaultStrategy;
  }

  const resolved = asRecord(step.tick_arrays, `compute.orca_swap_quote:${step.name}:tick_arrays`);
  const searchStartOffsets =
    resolved.search_start_offsets !== undefined
      ? asIntegerArray(
          resolved.search_start_offsets,
          `compute.orca_swap_quote:${step.name}:tick_arrays.search_start_offsets`,
        )
      : defaultStrategy.searchStartOffsets;
  const windowSize =
    resolved.window_size !== undefined
      ? asSafeInteger(resolved.window_size, `compute.orca_swap_quote:${step.name}:tick_arrays.window_size`)
      : defaultStrategy.windowSize;
  if (windowSize < 1 || windowSize > 8) {
    throw new Error(`compute.orca_swap_quote:${step.name}:tick_arrays.window_size must be between 1 and 8.`);
  }
  const allowReuseLast =
    resolved.allow_reuse_last !== undefined
      ? asBool(resolved.allow_reuse_last, `compute.orca_swap_quote:${step.name}:tick_arrays.allow_reuse_last`)
      : defaultStrategy.allowReuseLast;

  return {
    searchStartOffsets,
    windowSize,
    allowReuseLast,
  };
}

export async function runOrcaSwapQuoteCompute(step: ComputeStepResolved, ctx: ComputeRuntimeContext): Promise<unknown> {
  const whirlpoolAddress = asPubkey(step.whirlpool, `compute.orca_swap_quote:${step.name}:whirlpool`);
  const amount = asIntegerString(step.amount, `compute.orca_swap_quote:${step.name}:amount`);
  const aToB = asBool(step.a_to_b, `compute.orca_swap_quote:${step.name}:a_to_b`);
  const slippageBps = Number(asIntegerString(step.slippage_bps, `compute.orca_swap_quote:${step.name}:slippage_bps`));
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error(`compute.orca_swap_quote:${step.name}:slippage_bps must be an integer between 0 and 10000.`);
  }

  const whirlpoolData = asRecord(ctx.scope.whirlpool_data, `compute.orca_swap_quote:${step.name}:whirlpool_data`);
  const tickCurrentIndex = asSafeInteger(
    getRecordValue(whirlpoolData, ['tick_current_index', 'tickCurrentIndex'], 'tick_current_index'),
    `compute.orca_swap_quote:${step.name}:tick_current_index`,
  );
  const tickSpacing = asSafeInteger(
    getRecordValue(whirlpoolData, ['tick_spacing', 'tickSpacing'], 'tick_spacing'),
    `compute.orca_swap_quote:${step.name}:tick_spacing`,
  );
  if (tickSpacing <= 0) {
    throw new Error(`compute.orca_swap_quote:${step.name}:tick_spacing must be > 0.`);
  }

  const tickArrayStrategy = resolveTickArrayStrategy(step);
  const directionSign = aToB ? -1 : 1;
  const programId = new PublicKey(ctx.programId);
  const candidateTickArraySets: PublicKey[][] = [];
  const seenCandidates = new Set<string>();
  for (const startOffset of tickArrayStrategy.searchStartOffsets) {
    const offsets = Array.from({ length: tickArrayStrategy.windowSize }, (_, index) => directionSign * (startOffset + index));
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
      `compute.orca_swap_quote:${step.name}: no initialized tick array candidate found for search offsets ${tickArrayStrategy.searchStartOffsets.join(',')}.`,
    );
  }

  const tokenOwnerAccountA = asPubkey(ctx.scope.token_owner_account_a, `compute.orca_swap_quote:${step.name}:token_owner_account_a`);
  const tokenOwnerAccountB = asPubkey(ctx.scope.token_owner_account_b, `compute.orca_swap_quote:${step.name}:token_owner_account_b`);
  const tokenVaultA = asPubkey(
    getRecordValue(whirlpoolData, ['token_vault_a', 'tokenVaultA'], 'token_vault_a'),
    `compute.orca_swap_quote:${step.name}:token_vault_a`,
  );
  const tokenVaultB = asPubkey(
    getRecordValue(whirlpoolData, ['token_vault_b', 'tokenVaultB'], 'token_vault_b'),
    `compute.orca_swap_quote:${step.name}:token_vault_b`,
  );
  const tokenMintA = asPubkey(
    getRecordValue(whirlpoolData, ['token_mint_a', 'tokenMintA'], 'token_mint_a'),
    `compute.orca_swap_quote:${step.name}:token_mint_a`,
  );
  const tokenMintB = asPubkey(
    getRecordValue(whirlpoolData, ['token_mint_b', 'tokenMintB'], 'token_mint_b'),
    `compute.orca_swap_quote:${step.name}:token_mint_b`,
  );
  const oracle = asPubkey(ctx.scope.oracle, `compute.orca_swap_quote:${step.name}:oracle`);

  const preInstructions = [
    createAssociatedTokenAccountIdempotentInstruction(ctx.walletPublicKey, tokenOwnerAccountA, ctx.walletPublicKey, tokenMintA),
    createAssociatedTokenAccountIdempotentInstruction(ctx.walletPublicKey, tokenOwnerAccountB, ctx.walletPublicKey, tokenMintB),
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
      token_program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
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

    const preview = await ctx.previewInstruction({
      instructionName: 'swap',
      args: provisionalArgs,
      accounts: provisionalAccounts,
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
      simulationErrors.push(`${resolvedTickArrays.map((key) => key.toBase58()).join(', ')} => ${JSON.stringify(simulation.value.err)}`);
      continue;
    }

    const postInputAmount = readTokenAmountFromSimAccount(simulation.value.accounts?.[0]);
    const postOutputAmount = readTokenAmountFromSimAccount(simulation.value.accounts?.[1]);
    const eventQuote = parseTradedEvent(simulation.value.logs ?? [], ctx.idl, programId);

    let estimatedAmountIn = eventQuote?.inAmount ?? preInputAmount - postInputAmount;
    let estimatedAmountOut = eventQuote?.outAmount ?? postOutputAmount - preOutputAmount;
    if (estimatedAmountIn < 0n) {
      estimatedAmountIn = asBigInt(amount, `compute.orca_swap_quote:${step.name}:amount`);
    }
    if (estimatedAmountOut < 0n) {
      estimatedAmountOut = 0n;
    }
    if (estimatedAmountOut === 0n) {
      simulationErrors.push(`${resolvedTickArrays.map((key) => key.toBase58()).join(', ')} => zero output during simulation`);
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
  throw new Error(`Swap quote simulation failed for all tick array candidates.\n${errorDetail || 'No simulation details available.'}`);
}
