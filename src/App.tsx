import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { BorshAccountsCoder, utils, type Idl } from '@coral-xyz/anchor';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import Decimal from 'decimal.js';
import './App.css';
import { formatTokenAmount, listSupportedTokens, parseUiAmountToAtomic, resolveToken } from './constants/tokens';
import {
  parseCommand,
  type KaminoDepositCommand,
  type KaminoViewPositionCommand,
  type KaminoWithdrawCommand,
  type OrcaCommand,
  type PumpAmmCommand,
  type PumpCurveCommand,
} from './lib/commandParser';
import {
  decodeIdlAccount,
  getInstructionTemplate,
  listIdlProtocols,
  previewIdlInstruction,
  sendIdlInstruction,
  simulateIdlInstruction,
} from './lib/idlDeclarativeRuntime';
import {
  explainMetaOperation,
  prepareMetaOperation,
  prepareMetaInstruction,
  type MetaOperationExplain,
} from './lib/metaIdlRuntime';
import { normalizeIdlForAnchorCoder } from './lib/normalizeIdl';

const ORCA_PROTOCOL_ID = 'orca-whirlpool-mainnet';
const ORCA_OPERATION_ID = 'swap_exact_in';
const PUMP_AMM_PROTOCOL_ID = 'pump-amm-mainnet';
const PUMP_AMM_OPERATION_ID = 'buy';
const PUMP_CURVE_PROTOCOL_ID = 'pump-core-mainnet';
const PUMP_CURVE_OPERATION_ID = 'buy_exact_sol_in';
const KAMINO_KLEND_PROTOCOL_ID = 'kamino-klend-mainnet';
const KAMINO_DEPOSIT_OPERATION_ID = 'deposit_reserve_liquidity';
const KAMINO_WITHDRAW_OPERATION_ID = 'redeem_reserve_collateral';
const KAMINO_VIEW_OPERATION_ID = 'view_position';
const KAMINO_KLEND_PROGRAM_ID = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const QUICK_PREFILL_SWAP_COMMAND =
  '/orca EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v So11111111111111111111111111111111111111112 0.01 50 --simulate';
const QUICK_PREFILL_PUMP_QUOTE_COMMAND =
  '/pump-amm C4yDhKwkikpVGCQWD9BT2SJyHAtRFFnKPDM9Nyshpump 0.01 100 --simulate';
const QUICK_PREFILL_PUMP_CURVE_COMMAND =
  '/pump-curve EuN3FubSnMCCxZahkxneNcRFSXdweeLXuWnXKYMc18H5 0.01 100 --simulate';
const QUICK_PREFILL_KAMINO_DEPOSIT_COMMAND =
  '/kamino-deposit 8J5NcJX4RScwC9hWfW2MtgQ8v4D6vQkYvA4K4GcCbn8J EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 0.1 --simulate';
const KAMINO_FIXED_SLOT_MS = 400;
const KAMINO_SLOTS_PER_SECOND = 2;
const KAMINO_SLOTS_PER_YEAR = KAMINO_SLOTS_PER_SECOND * 60 * 60 * 24 * 365;
const KAMINO_SF_SCALE = 1n << 60n;
let kaminoLookupIdlCache: Idl | null = null;
let kaminoReserveDiscriminatorCache: string | null = null;
let kaminoReserveScanCache: { fetchedAt: number; reserves: KaminoReserveSnapshot[] } | null = null;

type Message = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
};

type OrcaPoolCandidate = {
  whirlpool: string;
  tokenMintA: string;
  tokenMintB: string;
  tickSpacing: string;
  liquidity: string;
};

type PumpPoolCandidate = {
  pool: string;
  baseMint: string;
  quoteMint: string;
  lpSupply: string;
};

type KaminoReserveSnapshot = {
  address: string;
  lendingMarket: string;
  liquidityMint: string;
  liquiditySupplyVault: string;
  liquidityTokenProgram: string;
  collateralMint: string;
  collateralSupplyVault: string;
  mintDecimals: number;
  availableAmount: bigint;
  borrowedAmountSf: bigint;
  accumulatedProtocolFeesSf: bigint;
  accumulatedReferrerFeesSf: bigint;
  pendingReferrerFeesSf: bigint;
  collateralMintTotalSupply: bigint;
  protocolTakeRatePct: number;
  borrowCurvePoints: Array<{ utilizationRateBps: number; borrowRateBps: number }>;
};

type PendingPoolSelection = {
  command: OrcaCommand;
  candidates: OrcaPoolCandidate[];
};

const HELP_TEXT = [
  'Commands:',
  '/orca <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> <SLIPPAGE_BPS> [--simulate]',
  '/pump-amm <TOKEN_MINT> <AMOUNT_SOL> <SLIPPAGE_BPS> [POOL_PUBKEY] [--simulate]',
  '/pump-curve <TOKEN_MINT> <AMOUNT_SOL> <SLIPPAGE_BPS> [--simulate]',
  '/kamino-deposit <RESERVE_OR_VAULT> <TOKEN_MINT> <AMOUNT> [--simulate]',
  '/kamino-withdraw <RESERVE_OR_VAULT> <TOKEN_MINT> <AMOUNT> [--simulate]',
  '/kamino-view-position <RESERVE_OR_VAULT> <TOKEN_MINT>',
  '/write-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>',
  '/read-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>',
  '/idl-list',
  '/idl-template <PROTOCOL_ID> <INSTRUCTION_NAME>',
  '/meta-explain <PROTOCOL_ID> <OPERATION_ID>',
  '/idl-view <PROTOCOL_ID> <ACCOUNT_TYPE> <ACCOUNT_PUBKEY>',
  '/help',
  '',
  'Notes:',
  'AMOUNT is UI amount (e.g. 0.1 for SOL).',
  'Pool discovery is on-chain via Orca program account scan.',
  'Pump quote/buy spends wrapped SOL (WSOL) under the hood.',
  'Kamino commands accept reserve pubkey or reserve vault pubkey as first argument.',
  'If multiple pools match a pair, you will be asked to pick one (or provide a whirlpool override internally).',
  '',
  'Examples:',
  '/orca SOL USDC 0.1 50 --simulate',
  '/orca SOL USDC 0.1 50',
  '/pump-amm <TOKEN_MINT> 0.01 100 --simulate',
  '/pump-amm <TOKEN_MINT> 0.01 100',
  '/pump-curve <TOKEN_MINT> 0.01 100 --simulate',
  '/pump-curve <TOKEN_MINT> 0.01 100',
  '/kamino-deposit <RESERVE_OR_VAULT> EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 10 --simulate',
  '/kamino-withdraw <RESERVE_OR_VAULT> EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 5 --simulate',
  '/kamino-view-position <RESERVE_OR_VAULT> EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  '/meta-explain orca-whirlpool-mainnet swap_exact_in',
  '/meta-explain pump-amm-mainnet buy',
  '/meta-explain pump-core-mainnet buy_exact_sol_in',
  '/meta-explain kamino-klend-mainnet deposit_reserve_liquidity',
  '/meta-explain kamino-klend-mainnet redeem_reserve_collateral',
].join('\n');

function App() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'assistant',
      text: 'Espresso Cash MVP ready. Use /help to see commands.',
    },
  ]);
  const [commandInput, setCommandInput] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [pendingPoolSelection, setPendingPoolSelection] = useState<PendingPoolSelection | null>(null);

  const supportedTokens = useMemo(
    () => listSupportedTokens().map((token) => `${token.symbol} (${token.mint})`).join(', '),
    [],
  );

  function pushMessage(role: 'user' | 'assistant', text: string) {
    setMessages((prev) => [...prev, { id: prev.length + 1, role, text }]);
  }

  function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label} must be an object.`);
    }
    return value as Record<string, unknown>;
  }

  function asString(value: unknown, label: string): string {
    if (typeof value !== 'string') {
      throw new Error(`${label} must be a string.`);
    }
    return value;
  }

  function asIntegerLikeString(value: unknown, label: string): string {
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
      return String(value);
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    throw new Error(`${label} must be an integer-like value.`);
  }

  function asBoolean(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') {
      throw new Error(`${label} must be a boolean.`);
    }
    return value;
  }

  function normalizePoolCandidates(raw: unknown): OrcaPoolCandidate[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((entry, index) => {
      const candidate = asRecord(entry, `pool_candidates[${index}]`);
      return {
        whirlpool: asString(candidate.whirlpool, `pool_candidates[${index}].whirlpool`),
        tokenMintA: asString(candidate.tokenMintA, `pool_candidates[${index}].tokenMintA`),
        tokenMintB: asString(candidate.tokenMintB, `pool_candidates[${index}].tokenMintB`),
        tickSpacing: asIntegerLikeString(candidate.tickSpacing, `pool_candidates[${index}].tickSpacing`),
        liquidity: asIntegerLikeString(candidate.liquidity, `pool_candidates[${index}].liquidity`),
      };
    });
  }

  function normalizePumpPoolCandidates(raw: unknown): PumpPoolCandidate[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((entry, index) => {
      const candidate = asRecord(entry, `pool_candidates[${index}]`);
      return {
        pool: asString(candidate.pool, `pool_candidates[${index}].pool`),
        baseMint: asString(candidate.baseMint, `pool_candidates[${index}].baseMint`),
        quoteMint: asString(candidate.quoteMint, `pool_candidates[${index}].quoteMint`),
        lpSupply: asIntegerLikeString(candidate.lpSupply, `pool_candidates[${index}].lpSupply`),
      };
    });
  }

  function asPrettyJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  function renderMetaExplain(explanation: MetaOperationExplain): string {
    const formatRequired = (spec: Record<string, unknown>): string => {
      const required = spec.required === false ? 'optional' : 'required';
      const defaultText = spec.default !== undefined ? `, default=${JSON.stringify(spec.default)}` : '';
      const discoverFromText =
        typeof spec.discover_from === 'string' ? `, discover_from=${spec.discover_from}` : '';
      return `${required}${defaultText}${discoverFromText}`;
    };

    const discoverLines = explanation.discover.map((step, index) => {
      const name = String(step.name ?? `step_${index + 1}`);
      const kind = String(step.discover ?? 'unknown');
      return `${index + 1}. ${name} -> ${kind}`;
    });

    const deriveLines = explanation.derive.map((step, index) => {
      const name = String(step.name ?? `step_${index + 1}`);
      const resolver = String(step.resolver ?? 'unknown');
      return `${index + 1}. ${name} -> ${resolver}`;
    });

    const computeLines = explanation.compute.map((step, index) => {
      const name = String(step.name ?? `step_${index + 1}`);
      const compute = String(step.compute ?? 'unknown');
      return `${index + 1}. ${name} -> ${compute}`;
    });

    const inputLines = Object.entries(explanation.inputs).map(
      ([name, spec]) => `- ${name}: ${String(spec.type ?? 'unknown')} (${formatRequired(spec)})`,
    );

    return [
      `Meta operation: ${explanation.protocolId}/${explanation.operationId}`,
      `schema: ${explanation.schema ?? 'n/a'} | version: ${explanation.version}`,
      `instruction: ${explanation.instruction}`,
      `templates used: ${explanation.templateUse.length > 0 ? explanation.templateUse.map((entry) => String(entry.template ?? entry.macro ?? 'unknown')).join(', ') : 'none'}`,
      '',
      'Inputs:',
      ...(inputLines.length > 0 ? inputLines : ['- none']),
      '',
      'Discover phase:',
      ...(discoverLines.length > 0 ? discoverLines : ['none']),
      '',
      'Derive phase:',
      ...(deriveLines.length > 0 ? deriveLines : ['none']),
      '',
      'Compute phase:',
      ...(computeLines.length > 0 ? computeLines : ['none']),
      '',
      `Build args keys: ${Object.keys(explanation.args).join(', ') || 'none'}`,
      `Build accounts keys: ${Object.keys(explanation.accounts).join(', ') || 'none'}`,
      `Post steps: ${explanation.post.length}`,
      '',
      'Expanded JSON:',
      asPrettyJson(explanation),
    ].join('\n');
  }

  function encodeIxDataBase64(data: Uint8Array): string {
    let binary = '';
    for (const byte of data) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  function compactPubkey(value: unknown): string {
    const text = String(value ?? 'n/a');
    if (text.length <= 12) {
      return text;
    }
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
  }

  function readU64Le(data: Uint8Array, offset: number): bigint {
    if (data.length < offset + 8) {
      return 0n;
    }

    let value = 0n;
    for (let i = 0; i < 8; i += 1) {
      value |= BigInt(data[offset + i]) << BigInt(i * 8);
    }
    return value;
  }

  function decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  function readSplTokenAmountFromSimAccount(dataBase64: string | null): bigint {
    if (!dataBase64) {
      return 0n;
    }

    const bytes = decodeBase64(dataBase64);
    return readU64Le(bytes, 64);
  }

  function buildOwnerAtaPreInstructions(options: {
    owner: PublicKey;
    pairs: Array<{ ata: string; mint: string }>;
  }): TransactionInstruction[] {
    return options.pairs.map((pair) =>
      createAssociatedTokenAccountIdempotentInstruction(
        options.owner,
        new PublicKey(pair.ata),
        options.owner,
        new PublicKey(pair.mint),
      ),
    );
  }

  function buildMetaPostInstructions(
    postSpecs: Array<{
      kind: 'spl_token_close_account';
      account: string;
      destination: string;
      owner: string;
      tokenProgram: string;
    }>,
  ): TransactionInstruction[] {
    return postSpecs.map((spec) => {
      if (spec.kind !== 'spl_token_close_account') {
        throw new Error(`Unsupported meta post instruction kind: ${spec.kind}`);
      }

      return createCloseAccountInstruction(
        new PublicKey(spec.account),
        new PublicKey(spec.destination),
        new PublicKey(spec.owner),
        [],
        new PublicKey(spec.tokenProgram),
      );
    });
  }

  function compactInteger(value: string): string {
    if (value.length <= 12) {
      return value;
    }
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  function formatPoolChoiceLine(pool: OrcaPoolCandidate, index: number): string {
    return `${index + 1}. ${compactPubkey(pool.whirlpool)} | tickSpacing ${pool.tickSpacing} | liquidity ${compactInteger(pool.liquidity)}`;
  }

  async function loadKaminoLookupIdl(): Promise<Idl> {
    if (kaminoLookupIdlCache) {
      return kaminoLookupIdlCache;
    }

    const response = await fetch('/idl/kamino_klend.json');
    if (!response.ok) {
      throw new Error('Failed to load local Kamino IDL.');
    }
    const parsed = normalizeIdlForAnchorCoder((await response.json()) as Idl);
    kaminoLookupIdlCache = parsed;
    return parsed;
  }

  function toPubkeyString(value: unknown, label: string): string {
    if (value instanceof PublicKey) {
      return value.toBase58();
    }
    if (typeof value === 'string') {
      return new PublicKey(value).toBase58();
    }
    if (value && typeof value === 'object' && 'toBase58' in (value as Record<string, unknown>)) {
      const toBase58 = (value as { toBase58?: () => string }).toBase58;
      if (typeof toBase58 === 'function') {
        return new PublicKey(toBase58()).toBase58();
      }
    }
    throw new Error(`${label} must be a public key.`);
  }

  function toBigIntLike(value: unknown, label: string): bigint {
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
      return BigInt(value);
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
      return BigInt(value);
    }
    if (value && typeof value === 'object' && 'toString' in (value as Record<string, unknown>)) {
      const rendered = String((value as { toString: () => string }).toString());
      if (/^-?\d+$/.test(rendered)) {
        return BigInt(rendered);
      }
    }
    throw new Error(`${label} must be bigint-compatible integer.`);
  }

  function toNumberLike(value: unknown, label: string): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    if (value && typeof value === 'object' && 'toString' in (value as Record<string, unknown>)) {
      const parsed = Number(String((value as { toString: () => string }).toString()));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    throw new Error(`${label} must be number-like.`);
  }

  function parseKaminoReserveSnapshot(decoded: unknown, address: string): KaminoReserveSnapshot {
    const reserve = asRecord(decoded, 'kamino.reserve');
    const liquidity = asRecord(reserve.liquidity, 'kamino.reserve.liquidity');
    const collateral = asRecord(reserve.collateral, 'kamino.reserve.collateral');
    const config = asRecord(reserve.config, 'kamino.reserve.config');
    const borrowRateCurve = asRecord(config.borrowRateCurve, 'kamino.reserve.config.borrowRateCurve');
    const pointsRaw = Array.isArray(borrowRateCurve.points) ? borrowRateCurve.points : [];
    const borrowCurvePoints = pointsRaw.map((entry, index) => {
      const point = asRecord(entry, `kamino.reserve.config.borrowRateCurve.points[${index}]`);
      return {
        utilizationRateBps: Math.trunc(toNumberLike(point.utilizationRateBps, `curve[${index}].utilizationRateBps`)),
        borrowRateBps: Math.trunc(toNumberLike(point.borrowRateBps, `curve[${index}].borrowRateBps`)),
      };
    });

    return {
      address: new PublicKey(address).toBase58(),
      lendingMarket: toPubkeyString(reserve.lendingMarket, 'reserve.lendingMarket'),
      liquidityMint: toPubkeyString(liquidity.mintPubkey, 'reserve.liquidity.mintPubkey'),
      liquiditySupplyVault: toPubkeyString(liquidity.supplyVault, 'reserve.liquidity.supplyVault'),
      liquidityTokenProgram: toPubkeyString(liquidity.tokenProgram, 'reserve.liquidity.tokenProgram'),
      collateralMint: toPubkeyString(collateral.mintPubkey, 'reserve.collateral.mintPubkey'),
      collateralSupplyVault: toPubkeyString(collateral.supplyVault, 'reserve.collateral.supplyVault'),
      mintDecimals: Math.trunc(toNumberLike(liquidity.mintDecimals, 'reserve.liquidity.mintDecimals')),
      availableAmount: toBigIntLike(liquidity.availableAmount, 'reserve.liquidity.availableAmount'),
      borrowedAmountSf: toBigIntLike(liquidity.borrowedAmountSf, 'reserve.liquidity.borrowedAmountSf'),
      accumulatedProtocolFeesSf: toBigIntLike(
        liquidity.accumulatedProtocolFeesSf,
        'reserve.liquidity.accumulatedProtocolFeesSf',
      ),
      accumulatedReferrerFeesSf: toBigIntLike(
        liquidity.accumulatedReferrerFeesSf,
        'reserve.liquidity.accumulatedReferrerFeesSf',
      ),
      pendingReferrerFeesSf: toBigIntLike(
        liquidity.pendingReferrerFeesSf,
        'reserve.liquidity.pendingReferrerFeesSf',
      ),
      collateralMintTotalSupply: toBigIntLike(collateral.mintTotalSupply, 'reserve.collateral.mintTotalSupply'),
      protocolTakeRatePct: Math.trunc(toNumberLike(config.protocolTakeRatePct, 'reserve.config.protocolTakeRatePct')),
      borrowCurvePoints,
    };
  }

  function estimateKaminoTotalSupplyAtomic(snapshot: KaminoReserveSnapshot): bigint {
    const borrowed = snapshot.borrowedAmountSf / KAMINO_SF_SCALE;
    const protocolFees = snapshot.accumulatedProtocolFeesSf / KAMINO_SF_SCALE;
    const referrerFees = snapshot.accumulatedReferrerFeesSf / KAMINO_SF_SCALE;
    const pendingFees = snapshot.pendingReferrerFeesSf / KAMINO_SF_SCALE;
    const total = snapshot.availableAmount + borrowed - protocolFees - referrerFees - pendingFees;
    return total > 0n ? total : 0n;
  }

  function estimateKaminoCollateralForWithdrawAtomic(
    snapshot: KaminoReserveSnapshot,
    liquidityAmountAtomic: bigint,
  ): bigint {
    const totalSupply = estimateKaminoTotalSupplyAtomic(snapshot);
    if (totalSupply <= 0n || snapshot.collateralMintTotalSupply <= 0n) {
      return liquidityAmountAtomic;
    }
    const numerator = liquidityAmountAtomic * snapshot.collateralMintTotalSupply;
    return (numerator + totalSupply - 1n) / totalSupply;
  }

  function estimateKaminoLiquidityFromCollateralAtomic(
    snapshot: KaminoReserveSnapshot,
    collateralAmountAtomic: bigint,
  ): bigint {
    const totalSupply = estimateKaminoTotalSupplyAtomic(snapshot);
    if (totalSupply <= 0n || snapshot.collateralMintTotalSupply <= 0n) {
      return collateralAmountAtomic;
    }
    return (collateralAmountAtomic * totalSupply) / snapshot.collateralMintTotalSupply;
  }

  function getBorrowRateFromCurve(utilization: number, points: Array<{ utilizationRateBps: number; borrowRateBps: number }>): number {
    const curve = points
      .map((point) => ({
        utilization: point.utilizationRateBps / 10_000,
        rate: point.borrowRateBps / 10_000,
      }))
      .sort((left, right) => left.utilization - right.utilization);
    if (curve.length < 2) {
      return 0;
    }

    const boundedUtilization = Math.min(1, Math.max(0, utilization));
    for (let index = 1; index < curve.length; index += 1) {
      const left = curve[index - 1];
      const right = curve[index];
      if (boundedUtilization <= right.utilization) {
        if (right.utilization <= left.utilization) {
          return right.rate;
        }
        const ratio = (boundedUtilization - left.utilization) / (right.utilization - left.utilization);
        return left.rate + ratio * (right.rate - left.rate);
      }
    }

    return curve[curve.length - 1].rate;
  }

  function calculateKaminoSupplyYield(snapshot: KaminoReserveSnapshot): {
    utilization: number;
    supplyApr: number;
    supplyApy: number;
  } {
    const totalSupply = estimateKaminoTotalSupplyAtomic(snapshot);
    if (totalSupply <= 0n) {
      return { utilization: 0, supplyApr: 0, supplyApy: 0 };
    }

    const borrowed = Number(snapshot.borrowedAmountSf / KAMINO_SF_SCALE);
    const supply = Number(totalSupply);
    if (!Number.isFinite(borrowed) || !Number.isFinite(supply) || supply <= 0) {
      return { utilization: 0, supplyApr: 0, supplyApy: 0 };
    }

    const utilization = Math.min(1, Math.max(0, borrowed / supply));
    const slotAdjustmentFactor = 1000 / KAMINO_SLOTS_PER_SECOND / KAMINO_FIXED_SLOT_MS;
    const rawBorrowRate = getBorrowRateFromCurve(utilization, snapshot.borrowCurvePoints) * slotAdjustmentFactor;
    const protocolTake = 1 - snapshot.protocolTakeRatePct / 100;
    const supplyApr = Math.max(0, utilization * rawBorrowRate * protocolTake);
    const supplyApy = Math.max(0, Math.pow(1 + supplyApr / KAMINO_SLOTS_PER_YEAR, KAMINO_SLOTS_PER_YEAR) - 1);
    return { utilization, supplyApr, supplyApy };
  }

  function formatPercent(value: number): string {
    if (!Number.isFinite(value)) {
      return 'n/a';
    }
    return `${(value * 100).toFixed(2)}%`;
  }

  async function getKaminoReserveDiscriminator(): Promise<string> {
    if (kaminoReserveDiscriminatorCache) {
      return kaminoReserveDiscriminatorCache;
    }
    const idl = await loadKaminoLookupIdl();
    const reserveAccount = (idl.accounts ?? []).find((entry) => entry.name === 'Reserve') as
      | { discriminator?: number[] }
      | undefined;
    if (reserveAccount && Array.isArray(reserveAccount.discriminator) && reserveAccount.discriminator.length === 8) {
      kaminoReserveDiscriminatorCache = utils.bytes.bs58.encode(Uint8Array.from(reserveAccount.discriminator));
      return kaminoReserveDiscriminatorCache;
    }

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('account:Reserve'));
    const discriminatorBytes = new Uint8Array(digest).slice(0, 8);
    kaminoReserveDiscriminatorCache = utils.bytes.bs58.encode(discriminatorBytes);
    return kaminoReserveDiscriminatorCache;
  }

  async function scanKaminoReserves(): Promise<KaminoReserveSnapshot[]> {
    const now = Date.now();
    if (kaminoReserveScanCache && now - kaminoReserveScanCache.fetchedAt < 30_000) {
      return kaminoReserveScanCache.reserves;
    }

    const [idl, discriminator] = await Promise.all([loadKaminoLookupIdl(), getKaminoReserveDiscriminator()]);
    const coder = new BorshAccountsCoder(idl);
    const accounts = await connection.getProgramAccounts(new PublicKey(KAMINO_KLEND_PROGRAM_ID), {
      commitment: 'confirmed',
      filters: [{ memcmp: { offset: 0, bytes: discriminator } }],
    });

    const reserves: KaminoReserveSnapshot[] = [];
    for (const account of accounts) {
      try {
        const decoded = coder.decode('Reserve', account.account.data);
        reserves.push(parseKaminoReserveSnapshot(decoded, account.pubkey.toBase58()));
      } catch {
        // Skip non-decodable account data.
      }
    }

    kaminoReserveScanCache = {
      fetchedAt: now,
      reserves,
    };
    return reserves;
  }

  async function resolveKaminoReserveForCommand(options: {
    reserveOrVault: string;
    tokenMint: string;
  }): Promise<{ reserve: KaminoReserveSnapshot; resolvedBy: 'reserve' | 'vault' }> {
    const reserveOrVault = new PublicKey(options.reserveOrVault).toBase58();
    const tokenMint = new PublicKey(options.tokenMint).toBase58();

    try {
      const decodedDirect = await decodeIdlAccount({
        protocolId: KAMINO_KLEND_PROTOCOL_ID,
        accountType: 'Reserve',
        address: reserveOrVault,
        connection,
      });
      const reserveDirect = parseKaminoReserveSnapshot(decodedDirect.data, reserveOrVault);
      if (reserveDirect.liquidityMint !== tokenMint) {
        throw new Error(
          `Token mint mismatch for reserve ${reserveOrVault}. Reserve mint is ${reserveDirect.liquidityMint}, input mint is ${tokenMint}.`,
        );
      }
      return {
        reserve: reserveDirect,
        resolvedBy: 'reserve',
      };
    } catch {
      // Not a direct reserve pubkey, continue with vault lookup.
    }

    const reserves = await scanKaminoReserves();
    const tokenReserves = reserves.filter((entry) => entry.liquidityMint === tokenMint);
    const matched = tokenReserves.find(
      (entry) =>
        entry.address === reserveOrVault ||
        entry.liquiditySupplyVault === reserveOrVault ||
        entry.collateralSupplyVault === reserveOrVault,
    );
    if (matched) {
      return {
        reserve: matched,
        resolvedBy: matched.address === reserveOrVault ? 'reserve' : 'vault',
      };
    }

    throw new Error(
      `No Kamino reserve found for token ${tokenMint} matching selector ${reserveOrVault} (reserve or vault).`,
    );
  }

  async function executeOrca(options: {
    value: OrcaCommand;
    whirlpool?: string;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to derive owner token accounts.');
    }
    const walletPublicKey = wallet.publicKey;
    const preparedInitial = await prepareMetaInstruction({
      protocolId: ORCA_PROTOCOL_ID,
      operationId: ORCA_OPERATION_ID,
      input: {
        token_in_mint: options.value.inputMint,
        token_out_mint: options.value.outputMint,
        amount_in: options.value.amountAtomic,
        slippage_bps: options.value.slippageBps,
        ...(options.whirlpool !== undefined ? { whirlpool: options.whirlpool } : {}),
      },
      connection,
      walletPublicKey,
    });

    const poolCandidates = normalizePoolCandidates(preparedInitial.derived.pool_candidates);
    if (poolCandidates.length > 1 && options.whirlpool === undefined) {
      setPendingPoolSelection({
        command: options.value,
        candidates: poolCandidates,
      });
      pushMessage(
        'assistant',
        [
          `Multiple pools found for ${options.value.inputToken}/${options.value.outputToken}.`,
          'Pick a pool by clicking a button below or typing its number:',
          ...poolCandidates.map((pool, index) => formatPoolChoiceLine(pool, index)),
        ].join('\n'),
      );
      return;
    }

    setPendingPoolSelection(null);

    const selectedPoolRaw = preparedInitial.derived.selected_pool;
    if (!selectedPoolRaw || typeof selectedPoolRaw !== 'object') {
      throw new Error('Missing derived selected_pool from meta runtime.');
    }
    const selectedPool = asRecord(selectedPoolRaw, 'selected_pool');
    const selectedWhirlpool = asString(selectedPool.whirlpool, 'selected_pool.whirlpool');
    const whirlpoolDataInitial = preparedInitial.derived.whirlpool_data as Record<string, unknown> | undefined;
    const inputTokenMeta = resolveToken(options.value.inputMint);
    const outputTokenMeta = resolveToken(options.value.outputMint);

    if (!whirlpoolDataInitial) {
      throw new Error('Missing derived whirlpool data from meta runtime.');
    }

    const preInstructionsInitial = buildOwnerAtaPreInstructions({
      owner: walletPublicKey,
      pairs: [
        {
          ata: preparedInitial.accounts.token_owner_account_a,
          mint: String(whirlpoolDataInitial.token_mint_a),
        },
        {
          ata: preparedInitial.accounts.token_owner_account_b,
          mint: String(whirlpoolDataInitial.token_mint_b),
        },
      ],
    });
    const postInstructionsInitial = buildMetaPostInstructions(preparedInitial.postInstructions);

    const aToBInitial = asBoolean(preparedInitial.derived.a_to_b, 'a_to_b');
    const inputAtaInitial = aToBInitial
      ? preparedInitial.accounts.token_owner_account_a
      : preparedInitial.accounts.token_owner_account_b;
    const outputAtaInitial = aToBInitial
      ? preparedInitial.accounts.token_owner_account_b
      : preparedInitial.accounts.token_owner_account_a;
    let inputBalanceAtomic = '0';
    try {
      const inputBalance = await connection.getTokenAccountBalance(new PublicKey(inputAtaInitial), 'confirmed');
      inputBalanceAtomic = inputBalance.value.amount;
    } catch {
      inputBalanceAtomic = '0';
    }
    let outputBalanceAtomic = '0';
    try {
      const outputBalance = await connection.getTokenAccountBalance(new PublicKey(outputAtaInitial), 'confirmed');
      outputBalanceAtomic = outputBalance.value.amount;
    } catch {
      outputBalanceAtomic = '0';
    }

    const requiredInputAtomic = BigInt(options.value.amountAtomic);
    const availableInputAtomic = BigInt(inputBalanceAtomic);
    if (availableInputAtomic < requiredInputAtomic) {
      const availableUi = inputTokenMeta
        ? formatTokenAmount(availableInputAtomic.toString(), inputTokenMeta.decimals)
        : availableInputAtomic.toString();
      const requiredUi = inputTokenMeta
        ? formatTokenAmount(requiredInputAtomic.toString(), inputTokenMeta.decimals)
        : requiredInputAtomic.toString();
      throw new Error(
        `Insufficient ${options.value.inputToken} balance in input token account. Required: ${requiredUi} (${requiredInputAtomic.toString()}), available: ${availableUi} (${availableInputAtomic.toString()}).`,
      );
    }

    const rawPreviewByArgs = new Map<string, Record<string, unknown>>();
    const getRawPreview = async (options: {
      prepared: Awaited<ReturnType<typeof prepareMetaInstruction>>;
      args: Record<string, unknown>;
      preInstructions: TransactionInstruction[];
      postInstructions: TransactionInstruction[];
    }): Promise<Record<string, unknown>> => {
      const cacheKey = JSON.stringify({
        instructionName: options.prepared.instructionName,
        args: options.args,
        accounts: options.prepared.accounts,
        remaining: options.prepared.remainingAccounts,
      });
      const cached = rawPreviewByArgs.get(cacheKey);
      if (cached) {
        return cached;
      }

      const preview = {
        preInstructions: options.preInstructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          keys: ix.keys.map((key) => ({
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          dataBase64: encodeIxDataBase64(ix.data),
        })),
        postInstructions: options.postInstructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          keys: ix.keys.map((key) => ({
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          dataBase64: encodeIxDataBase64(ix.data),
        })),
        mainInstruction: await previewIdlInstruction({
          protocolId: options.prepared.protocolId,
          instructionName: options.prepared.instructionName,
          args: options.args,
          accounts: options.prepared.accounts,
          remainingAccounts: options.prepared.remainingAccounts,
          walletPublicKey,
        }),
      };

      rawPreviewByArgs.set(cacheKey, preview);
      return preview;
    };

    const provisionalArgs = preparedInitial.args as Record<string, unknown>;
    let provisionalSimulation: Awaited<ReturnType<typeof simulateIdlInstruction>>;
    try {
      provisionalSimulation = await simulateIdlInstruction({
        protocolId: preparedInitial.protocolId,
        instructionName: preparedInitial.instructionName,
        args: provisionalArgs,
        accounts: preparedInitial.accounts,
        remainingAccounts: preparedInitial.remainingAccounts,
        preInstructions: preInstructionsInitial,
        // Estimate output on token accounts before any optional close-account post steps.
        postInstructions: [],
        includeAccounts: [inputAtaInitial, outputAtaInitial],
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown simulation error.';
      const rawPreview = await getRawPreview({
        prepared: preparedInitial,
        args: provisionalArgs,
        preInstructions: preInstructionsInitial,
        postInstructions: postInstructionsInitial,
      });
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    if (!provisionalSimulation.ok) {
      const rawPreview = await getRawPreview({
        prepared: preparedInitial,
        args: provisionalArgs,
        preInstructions: preInstructionsInitial,
        postInstructions: postInstructionsInitial,
      });
      const simError = provisionalSimulation.error ?? 'unknown';
      const logs = provisionalSimulation.logs.join('\n');
      throw new Error(`Simulation failed: ${simError}\n${logs}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    const simOutputAccount = provisionalSimulation.accounts.find((entry) => entry.address === outputAtaInitial);
    const preInputAtomic = availableInputAtomic;
    const preOutputAtomic = BigInt(outputBalanceAtomic);
    const postOutputAtomic = readSplTokenAmountFromSimAccount(simOutputAccount?.dataBase64 ?? null);

    const estimatedOutAtomicBigint = postOutputAtomic > preOutputAtomic ? postOutputAtomic - preOutputAtomic : 0n;
    if (estimatedOutAtomicBigint <= 0n) {
      throw new Error('Could not estimate output from simulation (estimated output is zero).');
    }

    const preparedFinal = await prepareMetaInstruction({
      protocolId: ORCA_PROTOCOL_ID,
      operationId: ORCA_OPERATION_ID,
      input: {
        token_in_mint: options.value.inputMint,
        token_out_mint: options.value.outputMint,
        amount_in: options.value.amountAtomic,
        slippage_bps: options.value.slippageBps,
        estimated_out: estimatedOutAtomicBigint.toString(),
        whirlpool: selectedWhirlpool,
      },
      connection,
      walletPublicKey,
    });

    const whirlpoolDataFinal = preparedFinal.derived.whirlpool_data as Record<string, unknown> | undefined;
    if (!whirlpoolDataFinal) {
      throw new Error('Missing derived whirlpool data from final Orca meta pass.');
    }
    const preInstructionsFinal = buildOwnerAtaPreInstructions({
      owner: walletPublicKey,
      pairs: [
        {
          ata: preparedFinal.accounts.token_owner_account_a,
          mint: String(whirlpoolDataFinal.token_mint_a),
        },
        {
          ata: preparedFinal.accounts.token_owner_account_b,
          mint: String(whirlpoolDataFinal.token_mint_b),
        },
      ],
    });
    const postInstructionsFinal = buildMetaPostInstructions(preparedFinal.postInstructions);
    const aToBFinal = asBoolean(preparedFinal.derived.a_to_b, 'a_to_b');
    const inputAtaFinal = aToBFinal ? preparedFinal.accounts.token_owner_account_a : preparedFinal.accounts.token_owner_account_b;
    const outputAtaFinal = aToBFinal ? preparedFinal.accounts.token_owner_account_b : preparedFinal.accounts.token_owner_account_a;
    const finalArgs = preparedFinal.args as Record<string, unknown>;
    const minOutAtomic = asIntegerLikeString(finalArgs.other_amount_threshold, 'args.other_amount_threshold');

    let finalSimulation: Awaited<ReturnType<typeof simulateIdlInstruction>>;
    try {
      finalSimulation = await simulateIdlInstruction({
        protocolId: preparedFinal.protocolId,
        instructionName: preparedFinal.instructionName,
        args: finalArgs,
        accounts: preparedFinal.accounts,
        remainingAccounts: preparedFinal.remainingAccounts,
        preInstructions: preInstructionsFinal,
        postInstructions: [],
        includeAccounts: [inputAtaFinal, outputAtaFinal],
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown simulation error.';
      const rawPreview = await getRawPreview({
        prepared: preparedFinal,
        args: finalArgs,
        preInstructions: preInstructionsFinal,
        postInstructions: postInstructionsFinal,
      });
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    if (!finalSimulation.ok) {
      const rawPreview = await getRawPreview({
        prepared: preparedFinal,
        args: finalArgs,
        preInstructions: preInstructionsFinal,
        postInstructions: postInstructionsFinal,
      });
      const simError = finalSimulation.error ?? 'unknown';
      const logs = finalSimulation.logs.join('\n');
      throw new Error(`Simulation failed: ${simError}\n${logs}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    const finalSimInputAccount = finalSimulation.accounts.find((entry) => entry.address === inputAtaFinal);
    const finalSimOutputAccount = finalSimulation.accounts.find((entry) => entry.address === outputAtaFinal);
    const finalPostInputAtomic = readSplTokenAmountFromSimAccount(finalSimInputAccount?.dataBase64 ?? null);
    const finalPostOutputAtomic = readSplTokenAmountFromSimAccount(finalSimOutputAccount?.dataBase64 ?? null);
    const finalEstimatedInAtomicBigint = preInputAtomic > finalPostInputAtomic ? preInputAtomic - finalPostInputAtomic : 0n;
    const finalEstimatedOutAtomicBigint = finalPostOutputAtomic > preOutputAtomic ? finalPostOutputAtomic - preOutputAtomic : 0n;
    if (finalEstimatedOutAtomicBigint <= 0n) {
      throw new Error('Could not estimate output from simulation (estimated output is zero).');
    }

    const estimatedInAtomic = finalEstimatedInAtomicBigint.toString();
    const estimatedOutAtomic = finalEstimatedOutAtomicBigint.toString();
    const estimatedInUi = inputTokenMeta ? formatTokenAmount(estimatedInAtomic, inputTokenMeta.decimals) : estimatedInAtomic;
    const estimatedOutUi = outputTokenMeta ? formatTokenAmount(estimatedOutAtomic, outputTokenMeta.decimals) : estimatedOutAtomic;
    const minOutUi = outputTokenMeta ? formatTokenAmount(minOutAtomic, outputTokenMeta.decimals) : minOutAtomic;
    let impliedRateText = 'n/a';
    if (inputTokenMeta && outputTokenMeta && estimatedInAtomic !== '0') {
      const inUi = new Decimal(estimatedInAtomic).div(new Decimal(10).pow(inputTokenMeta.decimals));
      const outUi = new Decimal(estimatedOutAtomic).div(new Decimal(10).pow(outputTokenMeta.decimals));
      if (inUi.gt(0)) {
        impliedRateText = outUi.div(inUi).toSignificantDigits(8).toString();
      }
    }

    if (options.value.simulate) {
      pushMessage(
        'assistant',
        [
          'Orca simulate (meta IDL + simulation):',
          `pair: ${options.value.inputToken}/${options.value.outputToken}`,
          `pool: ${selectedWhirlpool}`,
          `input: ${estimatedInUi} ${options.value.inputToken}`,
          `estimated output: ${estimatedOutUi} ${options.value.outputToken}`,
          `min output @ ${options.value.slippageBps} bps: ${minOutUi} ${options.value.outputToken}`,
          `implied rate: 1 ${options.value.inputToken} ≈ ${impliedRateText} ${options.value.outputToken}`,
          `tick arrays: ${compactPubkey(preparedFinal.accounts.tick_array_0)}, ${compactPubkey(preparedFinal.accounts.tick_array_1)}, ${compactPubkey(preparedFinal.accounts.tick_array_2)}`,
          `simulation: ok${finalSimulation.unitsConsumed ? ` (${finalSimulation.unitsConsumed} CU)` : ''}`,
          'Run same command without --simulate to execute.',
        ].join('\n'),
      );
      return;
    }

    let result: Awaited<ReturnType<typeof sendIdlInstruction>>;
    try {
      result = await sendIdlInstruction({
        protocolId: preparedFinal.protocolId,
        instructionName: preparedFinal.instructionName,
        args: finalArgs,
        accounts: preparedFinal.accounts,
        remainingAccounts: preparedFinal.remainingAccounts,
        preInstructions: preInstructionsFinal,
        postInstructions: postInstructionsFinal,
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown send error.';
      const rawPreview = await getRawPreview({
        prepared: preparedFinal,
        args: finalArgs,
        preInstructions: preInstructionsFinal,
        postInstructions: postInstructionsFinal,
      });
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    pushMessage(
      'assistant',
      [
        'Orca tx sent (meta IDL -> write-raw).',
        `pair: ${options.value.inputToken}/${options.value.outputToken}`,
        `pool: ${selectedWhirlpool}`,
        `estimatedOut: ${estimatedOutUi} ${options.value.outputToken} (${estimatedOutAtomic})`,
        result.signature,
        result.explorerUrl,
      ].join('\n'),
    );
  }

  async function executePumpAmm(options: {
    value: PumpAmmCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to execute Pump AMM operations.');
    }
    const walletPublicKey = wallet.publicKey;

    let prepared: Awaited<ReturnType<typeof prepareMetaInstruction>>;
    try {
      prepared = await prepareMetaInstruction({
        protocolId: PUMP_AMM_PROTOCOL_ID,
        operationId: PUMP_AMM_OPERATION_ID,
        input: {
          base_mint: options.value.tokenMint,
          quote_amount_in: options.value.amountAtomic,
          track_volume: true,
          slippage_bps: options.value.slippageBps,
          ...(options.value.pool ? { pool: options.value.pool } : {}),
        },
        connection,
        walletPublicKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const noPoolFound =
        message.includes('discover:selected_pool: no candidates found.') ||
        message.includes('discover:pool_candidates: no candidates found.');
      if (noPoolFound) {
        throw new Error(
          [
            `No Pump AMM pool found for token ${options.value.tokenMint} against SOL.`,
            options.value.pool
              ? `The provided pool ${options.value.pool} does not match this token/SOL pair in Pump AMM.`
              : 'This token may still be on bonding-curve or on another venue.',
            'Use /pump-curve <TOKEN_MINT> <AMOUNT_SOL> <SLIPPAGE_BPS> --simulate to quote bonding-curve directly.',
          ].join(' '),
        );
      }
      throw error;
    }

    const candidates = normalizePumpPoolCandidates(prepared.derived.pool_candidates);
    if (candidates.length === 0) {
      throw new Error(
        'No Pump AMM pool found for this token mint against SOL. The token may exist on Pump bonding-curve but not be migrated/listed in Pump AMM yet.',
      );
    }

    const selectedPool = asRecord(prepared.derived.selected_pool, 'selected_pool');
    const selectedPoolAddress = asString(selectedPool.pool, 'selected_pool.pool');
    const poolData = asRecord(prepared.derived.pool_data, 'pool_data');

    const userBaseAta = prepared.accounts.user_base_token_account;
    const userQuoteAta = prepared.accounts.user_quote_token_account;
    const poolBaseMint = asString(poolData.base_mint, 'pool_data.base_mint');
    const poolQuoteMint = asString(poolData.quote_mint, 'pool_data.quote_mint');
    const baseTokenProgram = new PublicKey(
      asString(prepared.accounts.base_token_program, 'accounts.base_token_program'),
    );
    const quoteTokenProgram = new PublicKey(
      asString(prepared.accounts.quote_token_program, 'accounts.quote_token_program'),
    );
    if (poolQuoteMint !== 'So11111111111111111111111111111111111111112') {
      throw new Error(
        `Unsupported Pump quote mint ${poolQuoteMint}. This command currently supports SOL-quoted pools only.`,
      );
    }
    const finalArgs = prepared.args as Record<string, unknown>;
    const computedBaseOutAtomic = asIntegerLikeString(
      finalArgs.base_amount_out,
      'args.base_amount_out',
    );
    const computedMaxQuoteInAtomic = BigInt(
      asIntegerLikeString(finalArgs.max_quote_amount_in, 'args.max_quote_amount_in'),
    );
    const trackVolume =
      finalArgs.track_volume === undefined ? true : asBoolean(finalArgs.track_volume, 'args.track_volume');
    const lpFeeBpsRaw = prepared.derived.lp_fee_bps;
    const protocolFeeBpsRaw = prepared.derived.protocol_fee_bps;
    const creatorFeeBpsRaw = prepared.derived.creator_fee_bps;
    const hasFeeBps = lpFeeBpsRaw !== undefined && protocolFeeBpsRaw !== undefined && creatorFeeBpsRaw !== undefined;
    const lpFeeBps = hasFeeBps ? asIntegerLikeString(lpFeeBpsRaw, 'derived.lp_fee_bps') : null;
    const protocolFeeBps = hasFeeBps
      ? asIntegerLikeString(protocolFeeBpsRaw, 'derived.protocol_fee_bps')
      : null;
    const creatorFeeBps = hasFeeBps ? asIntegerLikeString(creatorFeeBpsRaw, 'derived.creator_fee_bps') : null;

    const preInstructions: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        new PublicKey(userBaseAta),
        walletPublicKey,
        new PublicKey(poolBaseMint),
        baseTokenProgram,
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        new PublicKey(userQuoteAta),
        walletPublicKey,
        new PublicKey(poolQuoteMint),
        quoteTokenProgram,
      ),
      SystemProgram.transfer({
        fromPubkey: walletPublicKey,
        toPubkey: new PublicKey(userQuoteAta),
        // For Pump AMM `buy`, quote debit can go up to max_quote_amount_in.
        lamports: computedMaxQuoteInAtomic,
      }),
      createSyncNativeInstruction(new PublicKey(userQuoteAta)),
    ];

    const postInstructions = buildMetaPostInstructions(prepared.postInstructions);

    let preBaseAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(userBaseAta), 'confirmed');
      preBaseAtomic = BigInt(balance.value.amount);
    } catch {
      preBaseAtomic = 0n;
    }
    let preQuoteAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(userQuoteAta), 'confirmed');
      preQuoteAtomic = BigInt(balance.value.amount);
    } catch {
      preQuoteAtomic = 0n;
    }
    const rawPreviewByArgs = new Map<string, Record<string, unknown>>();
    const getRawPreview = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const cacheKey = JSON.stringify(args);
      const cached = rawPreviewByArgs.get(cacheKey);
      if (cached) {
        return cached;
      }

      const preview = {
        preInstructions: preInstructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          keys: ix.keys.map((key) => ({
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          dataBase64: encodeIxDataBase64(ix.data),
        })),
        postInstructions: postInstructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          keys: ix.keys.map((key) => ({
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          dataBase64: encodeIxDataBase64(ix.data),
        })),
        mainInstruction: await previewIdlInstruction({
          protocolId: prepared.protocolId,
          instructionName: prepared.instructionName,
          args,
          accounts: prepared.accounts,
          remainingAccounts: prepared.remainingAccounts,
          walletPublicKey,
        }),
      };
      rawPreviewByArgs.set(cacheKey, preview);
      return preview;
    };
    let simulation: Awaited<ReturnType<typeof simulateIdlInstruction>>;
    try {
      simulation = await simulateIdlInstruction({
        protocolId: prepared.protocolId,
        instructionName: prepared.instructionName,
        args: finalArgs,
        accounts: prepared.accounts,
        remainingAccounts: prepared.remainingAccounts,
        preInstructions,
        postInstructions: [],
        includeAccounts: [userBaseAta, userQuoteAta],
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown simulation error.';
      const rawPreview = await getRawPreview(finalArgs);
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    if (!simulation.ok) {
      const rawPreview = await getRawPreview(finalArgs);
      const simError = simulation.error ?? 'unknown';
      const logs = simulation.logs.join('\n');
      const feeBpsLine =
        lpFeeBps !== null && protocolFeeBps !== null && creatorFeeBps !== null
          ? `Fee bps: lp=${lpFeeBps}, protocol=${protocolFeeBps}, creator=${creatorFeeBps}`
        : 'Fee bps: n/a';
      throw new Error(
        [
          `Simulation failed: ${simError}`,
          logs,
          '',
          `Deterministic args: base_amount_out=${computedBaseOutAtomic}, max_quote_amount_in=${computedMaxQuoteInAtomic.toString()}, track_volume=${String(trackVolume)}`,
          feeBpsLine,
          '',
          `Raw instruction preview:\n${asPrettyJson(rawPreview)}`,
        ].join('\n'),
      );
    }

    const simBase = simulation.accounts.find((entry) => entry.address === userBaseAta);
    const simQuote = simulation.accounts.find((entry) => entry.address === userQuoteAta);
    const postBaseAtomic = readSplTokenAmountFromSimAccount(simBase?.dataBase64 ?? null);
    const postQuoteAtomic = readSplTokenAmountFromSimAccount(simQuote?.dataBase64 ?? null);
    const estimatedOutAtomicBigint = postBaseAtomic > preBaseAtomic ? postBaseAtomic - preBaseAtomic : 0n;
    const totalQuoteBeforeSwap = preQuoteAtomic + computedMaxQuoteInAtomic;
    const estimatedQuoteSpentAtomicBigint =
      totalQuoteBeforeSwap > postQuoteAtomic ? totalQuoteBeforeSwap - postQuoteAtomic : 0n;

    if (options.value.simulate) {
      pushMessage(
        'assistant',
        [
          'Pump AMM simulate (deterministic math + simulation):',
          `token: ${options.value.tokenMint}`,
          `pool: ${selectedPoolAddress}`,
          `input: ${options.value.amountUiSol} SOL (${options.value.amountAtomic} lamports)`,
          `computed base_amount_out: ${computedBaseOutAtomic} base atomic`,
          `computed max_quote_amount_in: ${computedMaxQuoteInAtomic.toString()} lamports`,
          lpFeeBps !== null && protocolFeeBps !== null && creatorFeeBps !== null
            ? `fee bps (lp/protocol/creator): ${lpFeeBps}/${protocolFeeBps}/${creatorFeeBps}`
            : 'fee bps (lp/protocol/creator): n/a',
          `simulated output: ${estimatedOutAtomicBigint.toString()} base atomic`,
          `simulated quote spent: ${estimatedQuoteSpentAtomicBigint.toString()} lamports`,
          `simulation: ok${simulation.unitsConsumed ? ` (${simulation.unitsConsumed} CU)` : ''}`,
          'Run same command without --simulate to execute.',
        ].join('\n'),
      );
      return;
    }

    let result: Awaited<ReturnType<typeof sendIdlInstruction>>;
    try {
      result = await sendIdlInstruction({
        protocolId: prepared.protocolId,
        instructionName: prepared.instructionName,
        args: finalArgs,
        accounts: prepared.accounts,
        remainingAccounts: prepared.remainingAccounts,
        preInstructions,
        postInstructions,
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown send error.';
      const rawPreview = await getRawPreview(finalArgs);
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    pushMessage(
      'assistant',
      [
        'Pump AMM tx sent (meta IDL -> write-raw).',
        `token: ${options.value.tokenMint}`,
        `pool: ${selectedPoolAddress}`,
        `baseAmountOut: ${computedBaseOutAtomic}`,
        `maxQuoteAmountIn: ${computedMaxQuoteInAtomic.toString()}`,
        result.signature,
        result.explorerUrl,
      ].join('\n'),
    );
  }

  async function executePumpCurve(options: {
    value: PumpCurveCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to run Pump curve simulation.');
    }
    const walletPublicKey = wallet.publicKey;

    const prepared = await prepareMetaInstruction({
      protocolId: PUMP_CURVE_PROTOCOL_ID,
      operationId: PUMP_CURVE_OPERATION_ID,
      input: {
        base_mint: options.value.tokenMint,
        spendable_sol_in: options.value.amountAtomic,
        min_tokens_out: '1',
        track_volume: false,
        slippage_bps: options.value.slippageBps,
      },
      connection,
      walletPublicKey,
    });
    const mint = new PublicKey(options.value.tokenMint);
    const bondingCurve = asString(prepared.accounts.bonding_curve, 'bonding_curve');
    const associatedUser = asString(prepared.accounts.associated_user, 'associated_user');
    const tokenProgram = asString(prepared.accounts.token_program, 'token_program');
    const curveData = asRecord(prepared.derived.bonding_curve_data, 'bonding_curve_data');
    const complete = asBoolean(curveData.complete, 'bonding_curve_data.complete');
    const realTokenReserves = asIntegerLikeString(curveData.real_token_reserves, 'bonding_curve_data.real_token_reserves');
    const realSolReserves = asIntegerLikeString(curveData.real_sol_reserves, 'bonding_curve_data.real_sol_reserves');

    if (complete) {
      throw new Error(
        [
          `Bonding curve is complete for token ${options.value.tokenMint}.`,
          'This token has graduated/migrated, so Pump core /pump-curve is no longer the executable route.',
          `Try: /pump-amm ${options.value.tokenMint} ${options.value.amountUiSol} ${options.value.slippageBps} --simulate`,
        ].join('\n'),
      );
    }

    const preInstructions: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        new PublicKey(associatedUser),
        walletPublicKey,
        mint,
        new PublicKey(tokenProgram),
      ),
    ];

    let preUserAtomic = '0';
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(associatedUser), 'confirmed');
      preUserAtomic = balance.value.amount;
    } catch {
      preUserAtomic = '0';
    }

    const rawPreviewByArgs = new Map<string, Record<string, unknown>>();
    const getRawPreview = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const cacheKey = JSON.stringify(args);
      const cached = rawPreviewByArgs.get(cacheKey);
      if (cached) {
        return cached;
      }

      const preview = {
        preInstructions: preInstructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          keys: ix.keys.map((key) => ({
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          dataBase64: encodeIxDataBase64(ix.data),
        })),
        mainInstruction: await previewIdlInstruction({
          protocolId: prepared.protocolId,
          instructionName: prepared.instructionName,
          args,
          accounts: prepared.accounts,
          remainingAccounts: prepared.remainingAccounts,
          walletPublicKey,
        }),
      };
      rawPreviewByArgs.set(cacheKey, preview);
      return preview;
    };

    const provisionalArgs = prepared.args as Record<string, unknown>;
    let simulation: Awaited<ReturnType<typeof simulateIdlInstruction>>;
    try {
      simulation = await simulateIdlInstruction({
        protocolId: prepared.protocolId,
        instructionName: prepared.instructionName,
        args: provisionalArgs,
        accounts: prepared.accounts,
        remainingAccounts: prepared.remainingAccounts,
        preInstructions,
        postInstructions: [],
        includeAccounts: [associatedUser],
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown simulation error.';
      const rawPreview = await getRawPreview(provisionalArgs);
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    if (!simulation.ok) {
      const rawPreview = await getRawPreview(provisionalArgs);
      const simError = simulation.error ?? 'unknown';
      const logs = simulation.logs.join('\n');
      const isCurveComplete =
        simError.includes('6005') ||
        logs.includes('BondingCurveComplete') ||
        logs.includes('Error Number: 6005');
      if (isCurveComplete) {
        throw new Error(
          [
            `Bonding curve is complete for token ${options.value.tokenMint}.`,
            'This token has graduated/migrated, so Pump core /pump-curve is no longer the executable route.',
            `Try: /pump-amm ${options.value.tokenMint} ${options.value.amountUiSol} ${options.value.slippageBps} --simulate`,
          ].join('\n'),
        );
      }
      throw new Error(`Simulation failed: ${simError}\n${logs}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    const simUser = simulation.accounts.find((entry) => entry.address === associatedUser);
    const postUserAtomic = readSplTokenAmountFromSimAccount(simUser?.dataBase64 ?? null);
    const estimatedOut = postUserAtomic > BigInt(preUserAtomic) ? postUserAtomic - BigInt(preUserAtomic) : 0n;
    if (estimatedOut <= 0n) {
      throw new Error('Could not estimate Pump curve output from simulation (estimated output is zero).');
    }

    const minOut = (estimatedOut * BigInt(10_000 - options.value.slippageBps)) / 10_000n;
    const minOutAtomic = (minOut > 0n ? minOut : 1n).toString();

    const finalArgs = {
      ...provisionalArgs,
      min_tokens_out: minOutAtomic,
    };

    let tokenDecimals = 6;
    try {
      const tokenSupply = await connection.getTokenSupply(mint, 'confirmed');
      tokenDecimals = tokenSupply.value.decimals;
    } catch {
      tokenDecimals = 6;
    }

    const estimatedOutUi = formatTokenAmount(estimatedOut.toString(), tokenDecimals);
    const minOutUi = formatTokenAmount(minOutAtomic, tokenDecimals);
    if (options.value.simulate) {
      pushMessage(
        'assistant',
        [
          'Pump bonding-curve simulate (meta IDL + simulation):',
          `token: ${options.value.tokenMint}`,
          `bondingCurve: ${bondingCurve}`,
          `input: ${options.value.amountUiSol} SOL (${options.value.amountAtomic} lamports)`,
          `estimated output: ${estimatedOutUi} tokens (${estimatedOut.toString()} atomic)`,
          `min output @ ${options.value.slippageBps} bps: ${minOutUi} tokens (${minOutAtomic} atomic)`,
          `curve status: complete=${complete}, real_token_reserves=${realTokenReserves}, real_sol_reserves=${realSolReserves}`,
          `simulation: ok${simulation.unitsConsumed ? ` (${simulation.unitsConsumed} CU)` : ''}`,
          'Run same command without --simulate to execute.',
        ].join('\n'),
      );
      return;
    }

    let result: Awaited<ReturnType<typeof sendIdlInstruction>>;
    try {
      result = await sendIdlInstruction({
        protocolId: prepared.protocolId,
        instructionName: prepared.instructionName,
        args: finalArgs,
        accounts: prepared.accounts,
        remainingAccounts: prepared.remainingAccounts,
        preInstructions,
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown send error.';
      const rawPreview = await getRawPreview(finalArgs);
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    pushMessage(
      'assistant',
      [
        'Pump curve tx sent (meta IDL -> write-raw).',
        `token: ${options.value.tokenMint}`,
        `bondingCurve: ${bondingCurve}`,
        `minTokensOut: ${minOutUi} (${minOutAtomic})`,
        result.signature,
        result.explorerUrl,
      ].join('\n'),
    );
  }

  function buildKaminoAtaPreInstructions(options: {
    owner: PublicKey;
    userLiquidityAta: string;
    liquidityMint: string;
    liquidityTokenProgram: string;
    userCollateralAta: string;
    collateralMint: string;
    collateralTokenProgram: string;
  }): TransactionInstruction[] {
    return [
      createAssociatedTokenAccountIdempotentInstruction(
        options.owner,
        new PublicKey(options.userLiquidityAta),
        options.owner,
        new PublicKey(options.liquidityMint),
        new PublicKey(options.liquidityTokenProgram),
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        options.owner,
        new PublicKey(options.userCollateralAta),
        options.owner,
        new PublicKey(options.collateralMint),
        new PublicKey(options.collateralTokenProgram),
      ),
    ];
  }

  async function executeKaminoDeposit(options: {
    value: KaminoDepositCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to run Kamino deposit.');
    }
    const walletPublicKey = wallet.publicKey;
    const resolved = await resolveKaminoReserveForCommand({
      reserveOrVault: options.value.reserveOrVault,
      tokenMint: options.value.tokenMint,
    });
    const liquidityAmountAtomic = parseUiAmountToAtomic(options.value.amountUi, resolved.reserve.mintDecimals);
    if (liquidityAmountAtomic <= 0n) {
      throw new Error('AMOUNT must be greater than zero.');
    }

    const prepared = await prepareMetaInstruction({
      protocolId: KAMINO_KLEND_PROTOCOL_ID,
      operationId: KAMINO_DEPOSIT_OPERATION_ID,
      input: {
        reserve: resolved.reserve.address,
        liquidity_mint: resolved.reserve.liquidityMint,
        liquidity_amount: liquidityAmountAtomic.toString(),
      },
      connection,
      walletPublicKey,
    });

    const preInstructions = buildKaminoAtaPreInstructions({
      owner: walletPublicKey,
      userLiquidityAta: prepared.accounts.userSourceLiquidity,
      liquidityMint: prepared.accounts.reserveLiquidityMint,
      liquidityTokenProgram: prepared.accounts.liquidityTokenProgram,
      userCollateralAta: prepared.accounts.userDestinationCollateral,
      collateralMint: prepared.accounts.reserveCollateralMint,
      collateralTokenProgram: prepared.accounts.collateralTokenProgram,
    });

    let preSourceAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(prepared.accounts.userSourceLiquidity), 'confirmed');
      preSourceAtomic = BigInt(balance.value.amount);
    } catch {
      preSourceAtomic = 0n;
    }
    let preCollateralAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(
        new PublicKey(prepared.accounts.userDestinationCollateral),
        'confirmed',
      );
      preCollateralAtomic = BigInt(balance.value.amount);
    } catch {
      preCollateralAtomic = 0n;
    }

    const args = prepared.args as Record<string, unknown>;
    const simulation = await simulateIdlInstruction({
      protocolId: prepared.protocolId,
      instructionName: prepared.instructionName,
      args,
      accounts: prepared.accounts,
      preInstructions,
      includeAccounts: [prepared.accounts.userSourceLiquidity, prepared.accounts.userDestinationCollateral],
      connection,
      wallet,
    });
    if (!simulation.ok) {
      throw new Error(`Simulation failed: ${simulation.error ?? 'unknown'}\n${simulation.logs.join('\n')}`);
    }

    const simSource = simulation.accounts.find((entry) => entry.address === prepared.accounts.userSourceLiquidity);
    const simCollateral = simulation.accounts.find((entry) => entry.address === prepared.accounts.userDestinationCollateral);
    const postSourceAtomic = readSplTokenAmountFromSimAccount(simSource?.dataBase64 ?? null);
    const postCollateralAtomic = readSplTokenAmountFromSimAccount(simCollateral?.dataBase64 ?? null);
    const estimatedLiquiditySpent = preSourceAtomic > postSourceAtomic ? preSourceAtomic - postSourceAtomic : 0n;
    const estimatedCollateralMinted =
      postCollateralAtomic > preCollateralAtomic ? postCollateralAtomic - preCollateralAtomic : 0n;

    if (options.value.simulate) {
      pushMessage(
        'assistant',
        [
          'Kamino deposit simulate:',
          `resolved reserve: ${resolved.reserve.address} (${resolved.resolvedBy})`,
          `liquidity mint: ${resolved.reserve.liquidityMint}`,
          `input amount: ${options.value.amountUi} (${liquidityAmountAtomic.toString()} atomic)`,
          `estimated liquidity spent: ${estimatedLiquiditySpent.toString()} atomic`,
          `estimated collateral minted: ${estimatedCollateralMinted.toString()} atomic`,
          `simulation: ok${simulation.unitsConsumed ? ` (${simulation.unitsConsumed} CU)` : ''}`,
          'Run same command without --simulate to execute.',
        ].join('\n'),
      );
      return;
    }

    const result = await sendIdlInstruction({
      protocolId: prepared.protocolId,
      instructionName: prepared.instructionName,
      args,
      accounts: prepared.accounts,
      preInstructions,
      connection,
      wallet,
    });

    pushMessage(
      'assistant',
      [
        'Kamino deposit tx sent.',
        `reserve: ${resolved.reserve.address}`,
        `liquidity amount: ${options.value.amountUi} (${liquidityAmountAtomic.toString()} atomic)`,
        result.signature,
        result.explorerUrl,
      ].join('\n'),
    );
  }

  async function executeKaminoWithdraw(options: {
    value: KaminoWithdrawCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to run Kamino withdraw.');
    }
    const walletPublicKey = wallet.publicKey;
    const resolved = await resolveKaminoReserveForCommand({
      reserveOrVault: options.value.reserveOrVault,
      tokenMint: options.value.tokenMint,
    });
    const liquidityAmountAtomic = parseUiAmountToAtomic(options.value.amountUi, resolved.reserve.mintDecimals);
    if (liquidityAmountAtomic <= 0n) {
      throw new Error('AMOUNT must be greater than zero.');
    }

    const prepared = await prepareMetaInstruction({
      protocolId: KAMINO_KLEND_PROTOCOL_ID,
      operationId: KAMINO_WITHDRAW_OPERATION_ID,
      input: {
        reserve: resolved.reserve.address,
        liquidity_mint: resolved.reserve.liquidityMint,
        liquidity_amount: liquidityAmountAtomic.toString(),
      },
      connection,
      walletPublicKey,
    });
    const args = prepared.args as Record<string, unknown>;
    const collateralAmount = asIntegerLikeString(args.collateralAmount, 'args.collateralAmount');
    const localEstimatedCollateral = estimateKaminoCollateralForWithdrawAtomic(
      resolved.reserve,
      liquidityAmountAtomic,
    ).toString();

    const preInstructions = buildKaminoAtaPreInstructions({
      owner: walletPublicKey,
      userLiquidityAta: prepared.accounts.userDestinationLiquidity,
      liquidityMint: prepared.accounts.reserveLiquidityMint,
      liquidityTokenProgram: prepared.accounts.liquidityTokenProgram,
      userCollateralAta: prepared.accounts.userSourceCollateral,
      collateralMint: prepared.accounts.reserveCollateralMint,
      collateralTokenProgram: prepared.accounts.collateralTokenProgram,
    });

    let preLiquidityAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(
        new PublicKey(prepared.accounts.userDestinationLiquidity),
        'confirmed',
      );
      preLiquidityAtomic = BigInt(balance.value.amount);
    } catch {
      preLiquidityAtomic = 0n;
    }
    let preCollateralAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(prepared.accounts.userSourceCollateral), 'confirmed');
      preCollateralAtomic = BigInt(balance.value.amount);
    } catch {
      preCollateralAtomic = 0n;
    }

    const simulation = await simulateIdlInstruction({
      protocolId: prepared.protocolId,
      instructionName: prepared.instructionName,
      args,
      accounts: prepared.accounts,
      preInstructions,
      includeAccounts: [prepared.accounts.userDestinationLiquidity, prepared.accounts.userSourceCollateral],
      connection,
      wallet,
    });
    if (!simulation.ok) {
      throw new Error(`Simulation failed: ${simulation.error ?? 'unknown'}\n${simulation.logs.join('\n')}`);
    }

    const simLiquidity = simulation.accounts.find((entry) => entry.address === prepared.accounts.userDestinationLiquidity);
    const simCollateral = simulation.accounts.find((entry) => entry.address === prepared.accounts.userSourceCollateral);
    const postLiquidityAtomic = readSplTokenAmountFromSimAccount(simLiquidity?.dataBase64 ?? null);
    const postCollateralAtomic = readSplTokenAmountFromSimAccount(simCollateral?.dataBase64 ?? null);
    const estimatedLiquidityOut =
      postLiquidityAtomic > preLiquidityAtomic ? postLiquidityAtomic - preLiquidityAtomic : 0n;
    const estimatedCollateralSpent =
      preCollateralAtomic > postCollateralAtomic ? preCollateralAtomic - postCollateralAtomic : 0n;

    if (options.value.simulate) {
      pushMessage(
        'assistant',
        [
          'Kamino withdraw simulate:',
          `resolved reserve: ${resolved.reserve.address} (${resolved.resolvedBy})`,
          `requested liquidity out: ${options.value.amountUi} (${liquidityAmountAtomic.toString()} atomic)`,
          `computed collateralAmount arg: ${collateralAmount}`,
          `local collateral estimate: ${localEstimatedCollateral}`,
          `estimated liquidity out: ${estimatedLiquidityOut.toString()} atomic`,
          `estimated collateral spent: ${estimatedCollateralSpent.toString()} atomic`,
          `simulation: ok${simulation.unitsConsumed ? ` (${simulation.unitsConsumed} CU)` : ''}`,
          'Run same command without --simulate to execute.',
        ].join('\n'),
      );
      return;
    }

    const result = await sendIdlInstruction({
      protocolId: prepared.protocolId,
      instructionName: prepared.instructionName,
      args,
      accounts: prepared.accounts,
      preInstructions,
      connection,
      wallet,
    });

    pushMessage(
      'assistant',
      [
        'Kamino withdraw tx sent.',
        `reserve: ${resolved.reserve.address}`,
        `computed collateralAmount: ${collateralAmount}`,
        result.signature,
        result.explorerUrl,
      ].join('\n'),
    );
  }

  async function executeKaminoViewPosition(options: {
    value: KaminoViewPositionCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to view Kamino position.');
    }
    const walletPublicKey = wallet.publicKey;
    const resolved = await resolveKaminoReserveForCommand({
      reserveOrVault: options.value.reserveOrVault,
      tokenMint: options.value.tokenMint,
    });
    const prepared = await prepareMetaOperation({
      protocolId: KAMINO_KLEND_PROTOCOL_ID,
      operationId: KAMINO_VIEW_OPERATION_ID,
      input: {
        reserve: resolved.reserve.address,
        liquidity_mint: resolved.reserve.liquidityMint,
      },
      connection,
      walletPublicKey,
    });

    const reserveData = parseKaminoReserveSnapshot(
      prepared.derived.reserve_data ?? prepared.derived.reserveData,
      resolved.reserve.address,
    );
    const userLiquidityAta = asString(prepared.derived.user_liquidity_ata, 'user_liquidity_ata');
    const userCollateralAta = asString(prepared.derived.user_collateral_ata, 'user_collateral_ata');

    let userLiquidityBalanceAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(userLiquidityAta), 'confirmed');
      userLiquidityBalanceAtomic = BigInt(balance.value.amount);
    } catch {
      userLiquidityBalanceAtomic = 0n;
    }
    let userCollateralBalanceAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(userCollateralAta), 'confirmed');
      userCollateralBalanceAtomic = BigInt(balance.value.amount);
    } catch {
      userCollateralBalanceAtomic = 0n;
    }

    const estimatedLiquidityClaimAtomic = estimateKaminoLiquidityFromCollateralAtomic(
      reserveData,
      userCollateralBalanceAtomic,
    );
    const liquidityUi = formatTokenAmount(userLiquidityBalanceAtomic.toString(), reserveData.mintDecimals);
    const claimUi = formatTokenAmount(estimatedLiquidityClaimAtomic.toString(), reserveData.mintDecimals);
    const supplyYield = calculateKaminoSupplyYield(reserveData);

    pushMessage(
      'assistant',
      [
        'Kamino position:',
        `resolved reserve: ${reserveData.address} (${resolved.resolvedBy})`,
        `liquidity mint: ${reserveData.liquidityMint}`,
        `liquidity ATA: ${userLiquidityAta}`,
        `collateral ATA: ${userCollateralAta}`,
        `wallet liquidity balance: ${liquidityUi} (${userLiquidityBalanceAtomic.toString()} atomic)`,
        `wallet collateral balance: ${userCollateralBalanceAtomic.toString()} cToken atomic`,
        `estimated redeemable liquidity: ${claimUi} (${estimatedLiquidityClaimAtomic.toString()} atomic)`,
        `reserve utilization: ${formatPercent(supplyYield.utilization)}`,
        `estimated supply APR: ${formatPercent(supplyYield.supplyApr)}`,
        `estimated supply APY: ${formatPercent(supplyYield.supplyApy)}`,
      ].join('\n'),
    );
  }

  async function handleCommandSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const raw = commandInput.trim();
    if (!raw) {
      return;
    }

    pushMessage('user', raw);
    setCommandInput('');

    setIsWorking(true);
    try {
      if (pendingPoolSelection) {
        if (/^\d+$/.test(raw)) {
          const oneBasedIndex = Number(raw);
          const zeroBasedIndex = oneBasedIndex - 1;
          if (zeroBasedIndex < 0 || zeroBasedIndex >= pendingPoolSelection.candidates.length) {
            throw new Error(`Pool selection out of range. Choose 1-${pendingPoolSelection.candidates.length}.`);
          }
          await executeOrca({
            value: pendingPoolSelection.command,
            whirlpool: pendingPoolSelection.candidates[zeroBasedIndex].whirlpool,
          });
          return;
        }

        if (!raw.startsWith('/')) {
          throw new Error(
            `Select a pool by number (1-${pendingPoolSelection.candidates.length}) or enter a new command starting with /.`,
          );
        }

        setPendingPoolSelection(null);
      }

      const parsed = parseCommand(raw);

      if (parsed.kind === 'help') {
        pushMessage('assistant', `${HELP_TEXT}\n\nSupported tokens: ${supportedTokens}`);
        return;
      }

      if (parsed.kind === 'idl-list') {
        const registryView = await listIdlProtocols();
        const protocolLines = registryView.protocols.map(
          (protocol) =>
            `- ${protocol.id} (${protocol.name}) [${protocol.status}]\\n  native: ${protocol.supportedCommands.join(', ') || 'none'}`,
        );
        pushMessage(
          'assistant',
          [
            'IDL Registry:',
            `version: ${registryView.version ?? 'n/a'}`,
            `global commands: ${registryView.globalCommands.join(', ') || 'none'}`,
            '',
            'Protocols:',
            ...(protocolLines.length > 0 ? protocolLines : ['- none']),
            '',
            'Raw JSON:',
            asPrettyJson(registryView),
          ].join('\n'),
        );
        return;
      }

      if (parsed.kind === 'idl-template') {
        const template = await getInstructionTemplate({
          protocolId: parsed.value.protocolId,
          instructionName: parsed.value.instructionName,
        });
        pushMessage('assistant', asPrettyJson(template));
        return;
      }

      if (parsed.kind === 'meta-explain') {
        const explanation = await explainMetaOperation({
          protocolId: parsed.value.protocolId,
          operationId: parsed.value.operationId,
        });
        pushMessage('assistant', renderMetaExplain(explanation));
        return;
      }

      if (parsed.kind === 'idl-view') {
        const decoded = await decodeIdlAccount({
          protocolId: parsed.value.protocolId,
          accountType: parsed.value.accountType,
          address: parsed.value.address,
          connection,
        });
        pushMessage('assistant', asPrettyJson(decoded));
        return;
      }

      if (parsed.kind === 'orca') {
        await executeOrca({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'pump-amm') {
        await executePumpAmm({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'pump-curve') {
        await executePumpCurve({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'kamino-deposit') {
        await executeKaminoDeposit({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'kamino-withdraw') {
        await executeKaminoWithdraw({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'kamino-view-position') {
        await executeKaminoViewPosition({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'read-raw') {
        const sim = await simulateIdlInstruction({
          protocolId: parsed.value.protocolId,
          instructionName: parsed.value.instructionName,
          args: parsed.value.args,
          accounts: parsed.value.accounts,
          connection,
          wallet,
        });
        pushMessage('assistant', asPrettyJson(sim));
        return;
      }

      if (parsed.kind === 'write-raw' || parsed.kind === 'idl-send') {
        const result = await sendIdlInstruction({
          protocolId: parsed.value.protocolId,
          instructionName: parsed.value.instructionName,
          args: parsed.value.args,
          accounts: parsed.value.accounts,
          connection,
          wallet,
        });
        pushMessage('assistant', `Raw instruction sent.\n${result.signature}\n${result.explorerUrl}`);
        return;
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error while handling command.';
      pushMessage('assistant', `Error: ${message}`);
    } finally {
      setIsWorking(false);
    }
  }

  async function handlePoolOptionClick(index: number) {
    if (!pendingPoolSelection) {
      return;
    }

    const oneBased = index + 1;
    pushMessage('user', String(oneBased));
    setIsWorking(true);
    try {
      await executeOrca({
        value: pendingPoolSelection.command,
        whirlpool: pendingPoolSelection.candidates[index].whirlpool,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error while selecting pool.';
      pushMessage('assistant', `Error: ${message}`);
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card-shell">
        <header className="card-header">
          <div>
            <h1>Espresso Cash AI Wallet MVP</h1>
            <p>Mainnet demo: command-driven swaps with single-signature wallet approval.</p>
          </div>
          <WalletMultiButton />
        </header>

        <div className="chat-log" aria-live="polite">
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <p>{message.text}</p>
            </article>
          ))}
        </div>

        {pendingPoolSelection ? (
          <div className="pending-block" aria-live="polite">
            <strong>
              Choose a pool for {pendingPoolSelection.command.inputToken}/{pendingPoolSelection.command.outputToken}
            </strong>
            <p>Click one option, or type the number in chat.</p>
            <div className="option-list">
              {pendingPoolSelection.candidates.map((candidate, index) => (
                <button
                  key={`${candidate.whirlpool}-${index}`}
                  type="button"
                  onClick={() => {
                    void handlePoolOptionClick(index);
                  }}
                  disabled={isWorking}
                >
                  {formatPoolChoiceLine(candidate, index)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <form className="command-form" onSubmit={handleCommandSubmit}>
          <input
            type="text"
            value={commandInput}
            onChange={(event) => setCommandInput(event.target.value)}
            placeholder="/orca SOL USDC 0.1 50 --simulate"
            disabled={isWorking}
            aria-label="Command input"
          />
          <button type="submit" disabled={isWorking}>
            {isWorking ? 'Running...' : 'Run'}
          </button>
        </form>
        <div className="quick-actions">
          <button
            type="button"
            onClick={() => setCommandInput(QUICK_PREFILL_SWAP_COMMAND)}
            disabled={isWorking}
          >
            Prefill USDC-&gt;SOL 0.01
          </button>
          <button
            type="button"
            onClick={() => setCommandInput(QUICK_PREFILL_PUMP_QUOTE_COMMAND)}
            disabled={isWorking}
          >
            Prefill Pump Quote
          </button>
          <button
            type="button"
            onClick={() => setCommandInput(QUICK_PREFILL_PUMP_CURVE_COMMAND)}
            disabled={isWorking}
          >
            Prefill Pump Curve
          </button>
          <button
            type="button"
            onClick={() => setCommandInput(QUICK_PREFILL_KAMINO_DEPOSIT_COMMAND)}
            disabled={isWorking}
          >
            Prefill Kamino Deposit
          </button>
        </div>
      </section>
    </main>
  );
}

export default App;
