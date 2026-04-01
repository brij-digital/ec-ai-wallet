import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import { type WalletContextState } from '@solana/wallet-adapter-react';
import { type Connection, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import {
  parseCommand,
  type MetaRunCommand,
  type ViewRunCommand,
} from './commandParser';
import {
  decodeIdlAccount,
  getInstructionTemplate,
  listIdlProtocols,
  sendIdlInstruction,
  simulateIdlInstruction,
} from '@brij-digital/apppack-runtime/idlDeclarativeRuntime';
import {
  explainRuntimeOperation as explainMetaOperation,
  listRuntimeOperations as listMetaOperations,
  prepareRuntimeOperation as prepareMetaOperation,
  type RuntimeOperationSummary as MetaOperationSummary,
} from '@brij-digital/apppack-runtime/runtimeOperationRuntime';
import { asPrettyJson, renderMetaExplain } from './builderHelpers';
import { resolveToken } from '../constants/tokens';
import {
  validateOperationInput,
  type OperationEnhancement,
} from './metaEnhancements';
import type { CommandMessage } from './components/CommandTab';

type RemoteViewRunResponse = {
  ok: boolean;
  protocol?: string;
  operation?: string;
  items?: unknown[];
  query?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  error?: string;
};

type UseCommandControllerOptions = {
  connection: Connection;
  wallet: WalletContextState;
  supportedTokens: string;
  viewApiBaseUrl: string;
  defaultViewApiBaseUrl: string;
};

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

function buildMetaPreInstructions(
  preSpecs: Array<
    | {
        kind: 'spl_ata_create_idempotent';
        payer: string;
        ata: string;
        owner: string;
        mint: string;
        tokenProgram: string;
        associatedTokenProgram: string;
      }
    | {
        kind: 'system_transfer';
        from: string;
        to: string;
        lamports: string;
      }
    | {
        kind: 'spl_token_sync_native';
        account: string;
        tokenProgram: string;
      }
  > = [],
): TransactionInstruction[] {
  return preSpecs.map((spec) => {
    if (spec.kind === 'spl_ata_create_idempotent') {
      return createAssociatedTokenAccountIdempotentInstruction(
        new PublicKey(spec.payer),
        new PublicKey(spec.ata),
        new PublicKey(spec.owner),
        new PublicKey(spec.mint),
        new PublicKey(spec.tokenProgram),
        new PublicKey(spec.associatedTokenProgram),
      );
    }

    if (spec.kind === 'system_transfer') {
      return SystemProgram.transfer({
        fromPubkey: new PublicKey(spec.from),
        toPubkey: new PublicKey(spec.to),
        lamports: Number(spec.lamports),
      });
    }

    if (spec.kind === 'spl_token_sync_native') {
      return createSyncNativeInstruction(new PublicKey(spec.account), new PublicKey(spec.tokenProgram));
    }

    throw new Error(`Unsupported meta pre instruction kind: ${(spec as { kind?: string }).kind ?? 'unknown'}`);
  });
}

function buildOperationEnhancementFromSummary(operation: MetaOperationSummary): OperationEnhancement {
  const operationRecord = operation as unknown as Record<string, unknown>;
  const operationLabel =
    typeof operationRecord.label === 'string' && operationRecord.label.trim().length > 0
      ? operationRecord.label.trim()
      : operation.operationId;

  const inputUi: OperationEnhancement['inputUi'] = {};
  const inputValidation: OperationEnhancement['inputValidation'] = {};
  for (const [inputName, inputSpec] of Object.entries(operation.inputs)) {
    const specRecord = inputSpec as unknown as Record<string, unknown>;
    const inputLabel =
      typeof specRecord.label === 'string' && specRecord.label.trim().length > 0
        ? specRecord.label.trim()
        : inputName;
    inputUi[inputName] = {
      label: inputLabel,
      ...(typeof specRecord.placeholder === 'string' && specRecord.placeholder.trim().length > 0
        ? { placeholder: specRecord.placeholder.trim() }
        : {}),
      ...(typeof specRecord.help === 'string' && specRecord.help.trim().length > 0
        ? { help: specRecord.help.trim() }
        : {}),
      ...(typeof specRecord.group === 'string' && specRecord.group.trim().length > 0
        ? { group: specRecord.group.trim() }
        : {}),
      ...(typeof specRecord.display_order === 'number' && Number.isFinite(specRecord.display_order)
        ? { displayOrder: specRecord.display_order }
        : {}),
    };
    void inputSpec;
    inputValidation[inputName] = {};
  }

  return {
    label: operationLabel,
    inputUi,
    inputValidation,
  };
}

export function useCommandController(options: UseCommandControllerOptions) {
  const {
    connection,
    wallet,
    supportedTokens,
    viewApiBaseUrl,
    defaultViewApiBaseUrl,
  } = options;

  const [messages, setMessages] = useState<CommandMessage[]>([
    {
      id: 1,
      role: 'assistant',
      text: 'AppPack ready. Use /help to see commands.',
    },
  ]);
  const [commandInput, setCommandInput] = useState('');
  const [isWorking, setIsWorking] = useState(false);

  const helpText = useMemo(
    () =>
      [
        'Commands:',
        '/meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> --simulate|--send',
        '/view-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON>',
        '/write-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>',
        '/read-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>',
        '/idl-list',
        '/idl-template <PROTOCOL_ID> <INSTRUCTION_NAME>',
        '/meta-explain <PROTOCOL_ID> <OPERATION_ID>',
        '/idl-view <PROTOCOL_ID> <ACCOUNT_TYPE> <ACCOUNT_PUBKEY>',
        '/help',
        '',
        'Notes:',
        'Use /meta-run for protocol-agnostic operation execution from runtime specs.',
        `Pool discovery runs through View API (${defaultViewApiBaseUrl}) with no local fallback.`,
        '/meta-run requires explicit mode: --simulate or --send.',
        'Use --simulate first, then --send with same input for deterministic execution.',
        '',
        'Examples:',
        '/meta-run orca-whirlpool-mainnet swap_exact_in {"token_in_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","token_out_mint":"So11111111111111111111111111111111111111112","amount_in":"10000","slippage_bps":50,"estimated_out":"100000","whirlpool":"Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE","unwrap_sol_output":true} --simulate',
        '/meta-run orca-whirlpool-mainnet swap_exact_in {"token_in_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","token_out_mint":"So11111111111111111111111111111111111111112","amount_in":"10000","slippage_bps":50,"estimated_out":"100000","whirlpool":"Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE","unwrap_sol_output":true} --send',
        '/meta-explain orca-whirlpool-mainnet swap_exact_in',
        '/meta-explain orca-whirlpool-mainnet pools_index',
        '/meta-explain pump-amm-mainnet buy',
        '/meta-explain pump-core-mainnet buy_exact_sol_in',
        '/view-run orca-whirlpool-mainnet pools_index {"token_in_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","token_out_mint":"So11111111111111111111111111111111111111112"}',
      ].join('\n'),
    [defaultViewApiBaseUrl],
  );

  function pushMessage(role: 'user' | 'assistant', text: string) {
    setMessages((prev) => [...prev, { id: prev.length + 1, role, text }]);
  }

  async function runRemoteViewRun(params: {
    protocolId: string;
    operationId: string;
    input: Record<string, unknown>;
    limit?: number;
  }): Promise<RemoteViewRunResponse> {
    if (!viewApiBaseUrl) {
      throw new Error('View API base URL is not configured (VITE_VIEW_API_BASE_URL).');
    }

    let response: Response;
    try {
      response = await fetch(`${viewApiBaseUrl}/view-run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          protocol_id: params.protocolId,
          operation_id: params.operationId,
          input: params.input,
          ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
        }),
      });
    } catch {
      throw new Error(
        `Failed to reach View API at ${viewApiBaseUrl}. Check service uptime and CORS preflight configuration for /view-run.`,
      );
    }

    const bodyText = await response.text();
    let parsed: unknown = null;
    if (bodyText.trim().length > 0) {
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      const detail =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { error?: unknown }).error === 'string'
          ? (parsed as { error: string }).error
          : bodyText || response.statusText;
      throw new Error(`View API error ${response.status}: ${detail}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('View API returned invalid JSON response.');
    }

    const result = parsed as RemoteViewRunResponse;
    if (!result.ok) {
      throw new Error(result.error ?? 'View API returned ok=false.');
    }

    return result;
  }

  async function executeMetaRun(value: MetaRunCommand): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to execute runtime operations.');
    }

    const operationsView = await listMetaOperations({
      protocolId: value.protocolId,
    });
    const operation = operationsView.operations.find((entry) => entry.operationId === value.operationId);
    if (!operation) {
      throw new Error(`Operation ${value.operationId} not found in protocol ${value.protocolId}.`);
    }

    const normalizedInput: Record<string, unknown> = { ...value.input };
    for (const [inputName, spec] of Object.entries(operation.inputs)) {
      if (spec.type.toLowerCase() !== 'token_mint') {
        continue;
      }
      const raw = normalizedInput[inputName];
      if (typeof raw !== 'string') {
        continue;
      }
      const token = resolveToken(raw);
      if (token) {
        normalizedInput[inputName] = token.mint;
      }
    }

    const enhancement = buildOperationEnhancementFromSummary(operation);
    const validationErrors = validateOperationInput({
      operation,
      input: normalizedInput,
      enhancement,
    });
    if (validationErrors.length > 0) {
      throw new Error(validationErrors[0]);
    }

    const prepared = await prepareMetaOperation({
      protocolId: value.protocolId,
      operationId: value.operationId,
      input: normalizedInput,
      connection,
      walletPublicKey: wallet.publicKey,
    });

    const instructionName = prepared.instructionName;
    const isReadOnlyOperation = !instructionName;
    if (isReadOnlyOperation && value.mode === 'send') {
      throw new Error(`Operation ${value.protocolId}/${value.operationId} is read-only and cannot be sent.`);
    }

    if (isReadOnlyOperation) {
      pushMessage(
        'assistant',
        [
          `Meta read (${value.protocolId}/${value.operationId}):`,
          'Read-only operation (no transaction execution).',
          '',
          asPrettyJson({
            input: normalizedInput,
            derived: prepared.derived,
            args: prepared.args,
            accounts: prepared.accounts,
          }),
        ].join('\n'),
      );
      return;
    }

    const preInstructions = buildMetaPreInstructions(prepared.preInstructions);
    const postInstructions = buildMetaPostInstructions(prepared.postInstructions);

    if (value.mode === 'simulate') {
      const simulation = await simulateIdlInstruction({
        protocolId: prepared.protocolId,
        instructionName,
        args: prepared.args,
        accounts: prepared.accounts,
        remainingAccounts: prepared.remainingAccounts,
        preInstructions,
        postInstructions,
        connection,
        wallet,
      });

      pushMessage(
        'assistant',
        [
          `Meta simulate (${value.protocolId}/${value.operationId}):`,
          `instruction: ${instructionName}`,
          `status: ${simulation.ok ? 'success' : 'failed'}`,
          `units: ${simulation.unitsConsumed ?? 'n/a'}`,
          `error: ${simulation.error ?? 'none'}`,
          '',
          asPrettyJson({
            input: normalizedInput,
            derived: prepared.derived,
            args: prepared.args,
            accounts: prepared.accounts,
            logs: simulation.logs,
          }),
        ].join('\n'),
      );
      return;
    }

    const sent = await sendIdlInstruction({
      protocolId: prepared.protocolId,
      instructionName,
      args: prepared.args,
      accounts: prepared.accounts,
      remainingAccounts: prepared.remainingAccounts,
      preInstructions,
      postInstructions,
      connection,
      wallet,
    });

    pushMessage(
      'assistant',
      [
        `Meta tx sent (${value.protocolId}/${value.operationId}):`,
        `instruction: ${instructionName}`,
        sent.signature,
        sent.explorerUrl,
      ].join('\n'),
    );
  }

  async function executeViewRun(value: ViewRunCommand): Promise<void> {
    const response = await runRemoteViewRun({
      protocolId: value.protocolId,
      operationId: value.operationId,
      input: value.input,
      limit: 20,
    });

    const items = Array.isArray(response.items) ? response.items : [];
    const highlights = [
      `items: ${items.length}`,
      ...(response.meta ? [`source: ${asPrettyJson(response.meta)}`] : []),
    ];
    pushMessage(
      'assistant',
      [
        `View run (${value.protocolId}/${value.operationId}):`,
        ...(highlights.length > 0 ? highlights : ['No data returned.']),
        '',
        'Raw JSON:',
        asPrettyJson({
          input: value.input,
          output: response,
        }),
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
      const parsed = parseCommand(raw);

      if (parsed.kind === 'help') {
        pushMessage('assistant', `${helpText}\n\nSupported tokens: ${supportedTokens}`);
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

      if (parsed.kind === 'meta-run') {
        await executeMetaRun(parsed.value);
        return;
      }

      if (parsed.kind === 'view-run') {
        await executeViewRun(parsed.value);
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
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error while handling command.';
      pushMessage('assistant', `Error: ${message}`);
    } finally {
      setIsWorking(false);
    }
  }

  return {
    messages,
    commandInput,
    setCommandInput,
    isWorking,
    handleCommandSubmit,
    pushMessage,
  };
}
