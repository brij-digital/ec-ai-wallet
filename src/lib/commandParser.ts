import { parseUiAmountToAtomic, resolveToken } from '../constants/tokens';
import { PublicKey } from '@solana/web3.js';

export type OrcaCommand = {
  kind: 'orca';
  inputToken: string;
  outputToken: string;
  amountUi: string;
  amountAtomic: string;
  inputMint: string;
  outputMint: string;
  slippageBps: number;
  simulate: boolean;
};

export type PumpAmmCommand = {
  kind: 'pump-amm';
  tokenMint: string;
  amountUiSol: string;
  amountAtomic: string;
  slippageBps: number;
  simulate: boolean;
  pool?: string;
};

export type PumpCurveCommand = {
  kind: 'pump-curve';
  tokenMint: string;
  amountUiSol: string;
  amountAtomic: string;
  slippageBps: number;
  simulate: boolean;
};

export type KaminoDepositCommand = {
  kind: 'kamino-deposit';
  reserveOrVault: string;
  tokenMint: string;
  amountUi: string;
  simulate: boolean;
};

export type KaminoWithdrawCommand = {
  kind: 'kamino-withdraw';
  reserveOrVault: string;
  tokenMint: string;
  amountUi: string;
  simulate: boolean;
};

export type KaminoViewPositionCommand = {
  kind: 'kamino-view-position';
  reserveOrVault: string;
  tokenMint: string;
};

export type IdlSendCommand = {
  kind: 'idl-send';
  protocolId: string;
  instructionName: string;
  args: Record<string, unknown>;
  accounts: Record<string, string>;
};

export type IdlViewCommand = {
  kind: 'idl-view';
  protocolId: string;
  accountType: string;
  address: string;
};

export type IdlTemplateCommand = {
  kind: 'idl-template';
  protocolId: string;
  instructionName: string;
};

export type MetaExplainCommand = {
  kind: 'meta-explain';
  protocolId: string;
  operationId: string;
};

export type ParsedCommand =
  | { kind: 'orca'; value: OrcaCommand }
  | { kind: 'pump-amm'; value: PumpAmmCommand }
  | { kind: 'pump-curve'; value: PumpCurveCommand }
  | { kind: 'kamino-deposit'; value: KaminoDepositCommand }
  | { kind: 'kamino-withdraw'; value: KaminoWithdrawCommand }
  | { kind: 'kamino-view-position'; value: KaminoViewPositionCommand }
  | { kind: 'write-raw'; value: IdlSendCommand }
  | { kind: 'read-raw'; value: IdlSendCommand }
  | { kind: 'help' }
  | { kind: 'idl-list' }
  | { kind: 'idl-template'; value: IdlTemplateCommand }
  | { kind: 'meta-explain'; value: MetaExplainCommand }
  | { kind: 'idl-view'; value: IdlViewCommand }
  | { kind: 'idl-send'; value: IdlSendCommand };

function parseJsonObject<T extends Record<string, unknown>>(raw: string, fieldName: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid ${fieldName} JSON.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }

  return parsed as T;
}

function parseIdlActionPayload(
  payload: string,
): {
  protocolId: string;
  instructionName: string;
  args: Record<string, unknown>;
  accounts: Record<string, string>;
} {
  const sections = payload.split('|').map((section) => section.trim());

  if (sections.length !== 3) {
    throw new Error('Expected format: <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>');
  }

  const instructionHeaderParts = sections[0].split(/\s+/).filter(Boolean);
  if (instructionHeaderParts.length !== 2) {
    throw new Error('Expected <PROTOCOL_ID> <INSTRUCTION_NAME> before the first | separator.');
  }

  const [protocolId, instructionName] = instructionHeaderParts;
  const args = parseJsonObject<Record<string, unknown>>(sections[1], 'args');
  const accounts = parseJsonObject<Record<string, unknown>>(sections[2], 'accounts');

  const normalizedAccounts: Record<string, string> = {};
  for (const [name, value] of Object.entries(accounts)) {
    if (typeof value !== 'string') {
      throw new Error(`Account mapping ${name} must be a string public key or $WALLET.`);
    }
    normalizedAccounts[name] = value;
  }

  return {
    protocolId,
    instructionName,
    args,
    accounts: normalizedAccounts,
  };
}

function parseIdlSendCommand(trimmed: string): ParsedCommand {
  const payload = trimmed.slice('/idl-send'.length).trim();
  const parsed = parseIdlActionPayload(payload);

  return {
    kind: 'idl-send',
    value: {
      kind: 'idl-send',
      protocolId: parsed.protocolId,
      instructionName: parsed.instructionName,
      args: parsed.args,
      accounts: parsed.accounts,
    },
  };
}

function parseRawCommand(trimmed: string, commandName: '/write-raw' | '/read-raw'): ParsedCommand {
  const payload = trimmed.slice(commandName.length).trim();
  const parsed = parseIdlActionPayload(payload);

  return {
    kind: commandName === '/write-raw' ? 'write-raw' : 'read-raw',
    value: {
      kind: 'idl-send',
      protocolId: parsed.protocolId,
      instructionName: parsed.instructionName,
      args: parsed.args,
      accounts: parsed.accounts,
    },
  };
}

function parseOrcaArgs(args: string[]): OrcaCommand {
  const { argsWithoutFlag, simulate } = splitSimulationFlag(args);
  if (argsWithoutFlag.length !== 4) {
    throw new Error('Usage: /orca <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> <SLIPPAGE_BPS> [--simulate]');
  }

  const [inputRaw, outputRaw, amountUi, slippageRaw] = argsWithoutFlag;
  const inputToken = resolveToken(inputRaw);
  const outputToken = resolveToken(outputRaw);

  if (!inputToken) {
    throw new Error(`Unsupported input token: ${inputRaw}`);
  }

  if (!outputToken) {
    throw new Error(`Unsupported output token: ${outputRaw}`);
  }

  if (inputToken.mint === outputToken.mint) {
    throw new Error('Input and output token must differ.');
  }

  const amountAtomic = parseUiAmountToAtomic(amountUi, inputToken.decimals);
  if (amountAtomic <= 0n) {
    throw new Error('Amount must be greater than zero.');
  }

  const slippageBps = Number(slippageRaw);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) {
    throw new Error('SLIPPAGE_BPS must be an integer between 1 and 5000.');
  }

  return {
    kind: 'orca',
    inputToken: inputToken.symbol,
    outputToken: outputToken.symbol,
    amountUi,
    amountAtomic: amountAtomic.toString(),
    inputMint: inputToken.mint,
    outputMint: outputToken.mint,
    slippageBps,
    simulate,
  };
}

function splitSimulationFlag(args: string[]): { argsWithoutFlag: string[]; simulate: boolean } {
  let simulate = false;
  const argsWithoutFlag: string[] = [];
  for (const arg of args) {
    if (arg === '--simulate') {
      simulate = true;
      continue;
    }
    argsWithoutFlag.push(arg);
  }
  return { argsWithoutFlag, simulate };
}

function parsePumpAmmArgs(args: string[]): PumpAmmCommand {
  const { argsWithoutFlag, simulate } = splitSimulationFlag(args);
  if (argsWithoutFlag.length < 3 || argsWithoutFlag.length > 4) {
    throw new Error('Usage: /pump-amm <TOKEN_MINT> <AMOUNT_SOL> <SLIPPAGE_BPS> [POOL_PUBKEY] [--simulate]');
  }

  const [tokenMintRaw, amountUiSol, slippageRaw, poolRaw] = argsWithoutFlag;
  const tokenMint = new PublicKey(tokenMintRaw).toBase58();
  const amountAtomic = parseUiAmountToAtomic(amountUiSol, 9);
  if (amountAtomic <= 0n) {
    throw new Error('AMOUNT_SOL must be greater than zero.');
  }

  const slippageBps = Number(slippageRaw);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) {
    throw new Error('SLIPPAGE_BPS must be an integer between 1 and 5000.');
  }

  const pool = poolRaw ? new PublicKey(poolRaw).toBase58() : undefined;

  return {
    kind: 'pump-amm',
    tokenMint,
    amountUiSol,
    amountAtomic: amountAtomic.toString(),
    slippageBps,
    simulate,
    ...(pool ? { pool } : {}),
  };
}

function parsePumpCurveArgs(args: string[]): PumpCurveCommand {
  const { argsWithoutFlag, simulate } = splitSimulationFlag(args);
  if (argsWithoutFlag.length !== 3) {
    throw new Error('Usage: /pump-curve <TOKEN_MINT> <AMOUNT_SOL> <SLIPPAGE_BPS> [--simulate]');
  }

  const [tokenMintRaw, amountUiSol, slippageRaw] = argsWithoutFlag;
  const tokenMint = new PublicKey(tokenMintRaw).toBase58();
  const amountAtomic = parseUiAmountToAtomic(amountUiSol, 9);
  if (amountAtomic <= 0n) {
    throw new Error('AMOUNT_SOL must be greater than zero.');
  }

  const slippageBps = Number(slippageRaw);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) {
    throw new Error('SLIPPAGE_BPS must be an integer between 1 and 5000.');
  }

  return {
    kind: 'pump-curve',
    tokenMint,
    amountUiSol,
    amountAtomic: amountAtomic.toString(),
    slippageBps,
    simulate,
  };
}

function parseKaminoDepositArgs(args: string[]): KaminoDepositCommand {
  const { argsWithoutFlag, simulate } = splitSimulationFlag(args);
  if (argsWithoutFlag.length !== 3) {
    throw new Error(
      'Usage: /kamino-deposit <RESERVE_OR_VAULT> <TOKEN_MINT> <AMOUNT> [--simulate]',
    );
  }

  const [reserveOrVaultRaw, tokenMintRaw, amountUi] = argsWithoutFlag;
  const reserveOrVault = new PublicKey(reserveOrVaultRaw).toBase58();
  const tokenMint = new PublicKey(tokenMintRaw).toBase58();
  if (!/^\d+(\.\d+)?$/.test(amountUi)) {
    throw new Error('AMOUNT must be a positive number.');
  }

  return {
    kind: 'kamino-deposit',
    reserveOrVault,
    tokenMint,
    amountUi,
    simulate,
  };
}

function parseKaminoWithdrawArgs(args: string[]): KaminoWithdrawCommand {
  const { argsWithoutFlag, simulate } = splitSimulationFlag(args);
  if (argsWithoutFlag.length !== 3) {
    throw new Error(
      'Usage: /kamino-withdraw <RESERVE_OR_VAULT> <TOKEN_MINT> <AMOUNT> [--simulate]',
    );
  }

  const [reserveOrVaultRaw, tokenMintRaw, amountUi] = argsWithoutFlag;
  const reserveOrVault = new PublicKey(reserveOrVaultRaw).toBase58();
  const tokenMint = new PublicKey(tokenMintRaw).toBase58();
  if (!/^\d+(\.\d+)?$/.test(amountUi)) {
    throw new Error('AMOUNT must be a positive number.');
  }

  return {
    kind: 'kamino-withdraw',
    reserveOrVault,
    tokenMint,
    amountUi,
    simulate,
  };
}

function parseKaminoViewPositionArgs(args: string[]): KaminoViewPositionCommand {
  if (args.length !== 2) {
    throw new Error('Usage: /kamino-view-position <RESERVE_OR_VAULT> <TOKEN_MINT>');
  }

  const [reserveOrVaultRaw, tokenMintRaw] = args;
  const reserveOrVault = new PublicKey(reserveOrVaultRaw).toBase58();
  const tokenMint = new PublicKey(tokenMintRaw).toBase58();

  return {
    kind: 'kamino-view-position',
    reserveOrVault,
    tokenMint,
  };
}

export function parseCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('Enter a command. Try /help.');
  }

  if (trimmed.startsWith('/idl-send')) {
    return parseIdlSendCommand(trimmed);
  }

  if (trimmed.startsWith('/write-raw ')) {
    return parseRawCommand(trimmed, '/write-raw');
  }

  if (trimmed.startsWith('/read-raw ')) {
    return parseRawCommand(trimmed, '/read-raw');
  }

  const [command, ...args] = trimmed.split(/\s+/);

  if (command === '/help') {
    return { kind: 'help' };
  }

  if (command === '/idl-list') {
    return { kind: 'idl-list' };
  }

  if (command === '/idl-template') {
    if (args.length !== 2) {
      throw new Error('Usage: /idl-template <PROTOCOL_ID> <INSTRUCTION_NAME>');
    }

    const [protocolId, instructionName] = args;
    return {
      kind: 'idl-template',
      value: {
        kind: 'idl-template',
        protocolId,
        instructionName,
      },
    };
  }

  if (command === '/meta-explain') {
    if (args.length !== 2) {
      throw new Error('Usage: /meta-explain <PROTOCOL_ID> <OPERATION_ID>');
    }

    const [protocolId, operationId] = args;
    return {
      kind: 'meta-explain',
      value: {
        kind: 'meta-explain',
        protocolId,
        operationId,
      },
    };
  }

  if (command === '/idl-view') {
    if (args.length !== 3) {
      throw new Error('Usage: /idl-view <PROTOCOL_ID> <ACCOUNT_TYPE> <ACCOUNT_PUBKEY>');
    }

    const [protocolId, accountType, address] = args;
    return {
      kind: 'idl-view',
      value: {
        kind: 'idl-view',
        protocolId,
        accountType,
        address,
      },
    };
  }

  if (command === '/orca') {
    return { kind: 'orca', value: parseOrcaArgs(args) };
  }

  if (command === '/pump-amm') {
    return { kind: 'pump-amm', value: parsePumpAmmArgs(args) };
  }

  if (command === '/pump-curve') {
    return { kind: 'pump-curve', value: parsePumpCurveArgs(args) };
  }

  if (command === '/kamino-deposit') {
    return { kind: 'kamino-deposit', value: parseKaminoDepositArgs(args) };
  }

  if (command === '/kamino-withdraw') {
    return { kind: 'kamino-withdraw', value: parseKaminoWithdrawArgs(args) };
  }

  if (command === '/kamino-view-position') {
    return { kind: 'kamino-view-position', value: parseKaminoViewPositionArgs(args) };
  }

  throw new Error(`Unknown command: ${command}. Try /help.`);
}
