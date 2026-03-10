import { parseUiAmountToAtomic, resolveToken } from '../constants/tokens';

export type SwapPrefillCommand = {
  kind: 'swap';
  inputToken: string;
  outputToken: string;
  amountUi: string;
  amountAtomic: string;
  inputMint: string;
  outputMint: string;
  slippageBps: number;
};

export type QuotePrefillCommand = {
  kind: 'quote';
  inputToken: string;
  outputToken: string;
  amountUi: string;
  amountAtomic: string;
  inputMint: string;
  outputMint: string;
  slippageBps: number;
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

export type ParsedCommand =
  | { kind: 'swap'; value: SwapPrefillCommand }
  | { kind: 'quote'; value: QuotePrefillCommand }
  | { kind: 'write-raw'; value: IdlSendCommand }
  | { kind: 'read-raw'; value: IdlSendCommand }
  | { kind: 'help' }
  | { kind: 'idl-list' }
  | { kind: 'idl-template'; value: IdlTemplateCommand }
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

function parseMetaSwapArgs(args: string[], kind: 'swap' | 'quote'): SwapPrefillCommand | QuotePrefillCommand {
  if (args.length < 3 || args.length > 4) {
    throw new Error(`Usage: /${kind} <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]`);
  }

  const [inputRaw, outputRaw, amountUi, slippageRaw] = args;
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

  const slippageBps = slippageRaw ? Number(slippageRaw) : 50;
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) {
    throw new Error('SLIPPAGE_BPS must be an integer between 1 and 5000.');
  }

  const payload = {
    kind,
    inputToken: inputToken.symbol,
    outputToken: outputToken.symbol,
    amountUi,
    amountAtomic: amountAtomic.toString(),
    inputMint: inputToken.mint,
    outputMint: outputToken.mint,
    slippageBps,
  };

  if (kind === 'swap') {
    return payload as SwapPrefillCommand;
  }

  return payload as QuotePrefillCommand;
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

  if (command === '/swap') {
    return { kind: 'swap', value: parseMetaSwapArgs(args, 'swap') as SwapPrefillCommand };
  }

  if (command === '/quote') {
    return { kind: 'quote', value: parseMetaSwapArgs(args, 'quote') as QuotePrefillCommand };
  }

  throw new Error(`Unknown command: ${command}. Try /help.`);
}
