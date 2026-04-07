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

export type MetaRunCommand = {
  kind: 'meta-run';
  protocolId: string;
  operationId: string;
  input: Record<string, unknown>;
  mode: 'simulate' | 'send';
};

export type ParsedCommand =
  | { kind: 'write-raw'; value: IdlSendCommand }
  | { kind: 'read-raw'; value: IdlSendCommand }
  | { kind: 'help' }
  | { kind: 'idl-list' }
  | { kind: 'idl-template'; value: IdlTemplateCommand }
  | { kind: 'meta-explain'; value: MetaExplainCommand }
  | { kind: 'meta-run'; value: MetaRunCommand }
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

function parseMetaRunCommand(trimmed: string): ParsedCommand {
  let payload = trimmed.slice('/meta-run'.length).trim();
  let mode: 'simulate' | 'send' | null = null;

  const hasTrailingSend = payload.endsWith('--send');
  const hasTrailingSimulate = payload.endsWith('--simulate');
  if (hasTrailingSend && hasTrailingSimulate) {
    throw new Error('Usage: /meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> --simulate|--send');
  }

  if (hasTrailingSend) {
    payload = payload.slice(0, -'--send'.length).trim();
    mode = 'send';
  } else if (hasTrailingSimulate) {
    payload = payload.slice(0, -'--simulate'.length).trim();
    mode = 'simulate';
  }
  if (!mode) {
    throw new Error('Usage: /meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> --simulate|--send');
  }

  if (payload.length === 0) {
    throw new Error('Usage: /meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> --simulate|--send');
  }

  const firstSpace = payload.indexOf(' ');
  if (firstSpace <= 0) {
    throw new Error('Usage: /meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> --simulate|--send');
  }
  const protocolId = payload.slice(0, firstSpace).trim();
  const rest = payload.slice(firstSpace + 1).trim();
  const secondSpace = rest.indexOf(' ');
  if (secondSpace <= 0) {
    throw new Error('Usage: /meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> --simulate|--send');
  }
  const operationId = rest.slice(0, secondSpace).trim();
  const inputRaw = rest.slice(secondSpace + 1).trim();
  if (inputRaw.length === 0) {
    throw new Error('Usage: /meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> --simulate|--send');
  }

  return {
    kind: 'meta-run',
    value: {
      kind: 'meta-run',
      protocolId,
      operationId,
      input: parseJsonObject<Record<string, unknown>>(inputRaw, 'input'),
      mode,
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

export function parseCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('Enter a command. Try /help.');
  }

  if (trimmed.startsWith('/idl-send')) {
    return parseIdlSendCommand(trimmed);
  }

  if (trimmed === '/meta-run' || trimmed.startsWith('/meta-run ')) {
    return parseMetaRunCommand(trimmed);
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

  throw new Error(`Unknown command: ${command}. This mode is protocol-agnostic; use /idl-list or /help.`);
}
