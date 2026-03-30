import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import type { Connection } from '@solana/web3.js';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { useCallback, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import {
  sendIdlInstruction,
  simulateIdlInstruction,
} from '@brij-digital/apppack-runtime/idlDeclarativeRuntime';
import {
  type AppOperationSummary as MetaOperationSummary,
} from '@brij-digital/apppack-runtime/appSpecRuntime';
import {
  prepareRuntimeOperation,
} from '@brij-digital/apppack-runtime/runtimeOperationRuntime';
import {
  buildDerivedFromReadOutputSource,
  buildReadOnlyHighlightsFromSpec,
  parseBuilderInputValue,
  readBuilderPath,
  stringifyBuilderDefault,
} from './builderHelpers';
import { validateOperationInput, type OperationEnhancement } from './metaEnhancements';
import type { BuilderPreparedStepResult, BuilderViewMode } from './useBuilderController';

type RemoteViewRunResponse = {
  ok: boolean;
  items?: unknown[];
  meta?: Record<string, unknown>;
  error?: string;
};

type UseBuilderSubmitControllerOptions = {
  connection: Connection;
  wallet: WalletContextState;
  viewApiBaseUrl: string;
  pushMessage: (role: 'user' | 'assistant', text: string) => void;
  setIsBuilderWorking: (value: boolean) => void;
  builderProtocolId: string;
  selectedBuilderOperation: MetaOperationSummary | null;
  selectedBuilderOperationEnhancement: OperationEnhancement | null;
  builderInputValues: Record<string, string>;
  onSetBuilderInputValue: (name: string, value: string) => void;
  builderViewMode: BuilderViewMode;
  selectedBuilderAppStep: { stepId: string; title: string } | null;
  selectedBuilderApp: unknown | null;
  builderAppStepIndex: number;
  setBuilderAppStepCompleted: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  clearBuilderAppProgressFrom: (startIndex: number) => void;
  setBuilderStatusText: (value: string | null) => void;
  setBuilderRawDetails: (value: string | null) => void;
  setBuilderShowRawDetails: (value: boolean) => void;
  applyBuilderAppStepResult: (options: {
    executionInput: Record<string, unknown>;
    prepared?: BuilderPreparedStepResult;
    operationSucceeded: boolean;
    errorMessage?: string;
  }) => boolean;
  getBuilderStepStatusText: (
    status: 'idle' | 'running' | 'success' | 'error',
    options?: {
      nextStepTitle?: string;
      error?: string;
    },
  ) => string;
  setBuilderResult: (lines: string[], raw?: unknown) => void;
  isBuilderAppMode: boolean;
  builderAppSubmitMode: 'simulate' | 'send';
  builderSimulate: boolean;
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

async function runRemoteViewRun(options: {
  viewApiBaseUrl: string;
  protocolId: string;
  operationId: string;
  input: Record<string, unknown>;
  limit?: number;
}): Promise<RemoteViewRunResponse> {
  if (!options.viewApiBaseUrl) {
    throw new Error('View API base URL is not configured (VITE_VIEW_API_BASE_URL).');
  }

  let response: Response;
  try {
    response = await fetch(`${options.viewApiBaseUrl}/view-run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        protocol_id: options.protocolId,
        operation_id: options.operationId,
        input: options.input,
        ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
      }),
    });
  } catch {
    throw new Error(
      `Failed to reach View API at ${options.viewApiBaseUrl}. Check service uptime and CORS preflight configuration for /view-run.`,
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
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof (parsed as { error?: unknown }).error === 'string'
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

export function useBuilderSubmitController(options: UseBuilderSubmitControllerOptions) {
  const previewSeqRef = useRef(0);
  const {
    selectedBuilderOperation,
    wallet,
    builderInputValues,
    builderProtocolId,
    connection,
    onSetBuilderInputValue,
  } = options;

  useEffect(() => {
    const operation = selectedBuilderOperation;
    if (!operation) {
      return;
    }
    const previewWalletPublicKey = wallet.publicKey ?? PublicKey.default;

    const previewBindings = Object.entries(operation.inputs)
      .map(([inputName, spec]) => {
        const readFrom = spec.bind_from;
        if (typeof readFrom !== 'string' || readFrom.trim().length === 0) {
          return null;
        }
        return {
          inputName,
          source: readFrom.trim(),
        };
      })
      .filter((entry): entry is { inputName: string; source: string } => entry !== null);

    if (previewBindings.length === 0) {
      return;
    }

    const missingRequired = Object.entries(operation.inputs).some(([inputName, spec]) => {
      const readFrom = spec.bind_from;
      if (typeof readFrom === 'string' && readFrom.trim().length > 0) {
        return false;
      }
      const rawValue = builderInputValues[inputName] ?? '';
      if (rawValue.trim().length > 0) {
        return false;
      }
      const hasDefault = spec.default !== undefined;
      const hasReadFrom = typeof spec.bind_from === 'string' && spec.bind_from.length > 0;
      return spec.required && !hasDefault && !hasReadFrom;
    });
    if (missingRequired) {
      return;
    }

    const debounce = window.setTimeout(() => {
      const currentSeq = ++previewSeqRef.current;
      void (async () => {
        try {
          const inputPayload: Record<string, unknown> = {};
          for (const [inputName, spec] of Object.entries(operation.inputs)) {
            const rawValue = builderInputValues[inputName] ?? '';
            if (!rawValue.trim()) {
              continue;
            }
            if (
              typeof spec.bind_from === 'string' &&
              spec.bind_from.trim().length > 0 &&
              (spec.ui_mode === 'readonly' || spec.ui_mode === 'hidden')
            ) {
              // Read-only preview fields are derived from prepareMetaOperation.
              continue;
            }
            inputPayload[inputName] = parseBuilderInputValue(rawValue, spec.type, `input ${inputName}`);
          }

          const prepared = await prepareRuntimeOperation({
            protocolId: builderProtocolId,
            operationId: operation.operationId,
            input: inputPayload,
            connection,
            walletPublicKey: previewWalletPublicKey,
          });

          if (currentSeq !== previewSeqRef.current) {
            return;
          }

          const scope = {
            input: inputPayload,
            args: prepared.args,
            accounts: prepared.accounts,
            derived: prepared.derived,
          };
          for (const binding of previewBindings) {
            const previewValue = readBuilderPath(scope, binding.source);
            if (previewValue === undefined || previewValue === null) {
              continue;
            }
            const nextText = stringifyBuilderDefault(previewValue);
            if ((builderInputValues[binding.inputName] ?? '') !== nextText) {
              onSetBuilderInputValue(binding.inputName, nextText);
            }
          }
        } catch {
          // Silent by design: preview updates must never block main flow.
        }
      })();
    }, 350);

    return () => {
      window.clearTimeout(debounce);
    };
  }, [
    builderInputValues,
    builderProtocolId,
    connection,
    onSetBuilderInputValue,
    selectedBuilderOperation,
    wallet,
  ]);

  const handleBuilderSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!options.builderProtocolId || !options.selectedBuilderOperation) {
        options.setBuilderStatusText('Error: Select a protocol and an operation first.');
        options.setBuilderRawDetails(null);
        return;
      }

      const isReadOnlyOperation = !options.selectedBuilderOperation.instruction;
      if (!options.wallet.publicKey && !isReadOnlyOperation) {
        options.setBuilderStatusText('Error: Connect wallet first.');
        options.setBuilderRawDetails(null);
        return;
      }
      const walletPublicKey = options.wallet.publicKey;

      options.setIsBuilderWorking(true);
      options.setBuilderStatusText(null);
      options.setBuilderRawDetails(null);
      options.setBuilderShowRawDetails(false);
      if (options.isBuilderAppMode && options.selectedBuilderAppStep) {
        options.setBuilderStatusText(
          options.getBuilderStepStatusText('running'),
        );
      }

      if (options.builderViewMode === 'forms' && options.selectedBuilderAppStep && options.selectedBuilderApp) {
        options.clearBuilderAppProgressFrom(options.builderAppStepIndex);
        options.setBuilderAppStepCompleted((prev) => ({
          ...prev,
          [options.selectedBuilderAppStep?.stepId ?? '']: false,
        }));
      }

      try {
        const inputPayload: Record<string, unknown> = {};
        for (const [inputName, spec] of Object.entries(options.selectedBuilderOperation.inputs)) {
          const rawValue = options.builderInputValues[inputName] ?? '';
          if (!rawValue.trim()) {
            const hasDefault = spec.default !== undefined;
            const hasReadFrom =
              typeof spec.bind_from === 'string' && spec.bind_from.length > 0;
            if (spec.required && !hasDefault && !hasReadFrom) {
              throw new Error(`Missing required input ${inputName}.`);
            }
            continue;
          }

          inputPayload[inputName] = parseBuilderInputValue(rawValue, spec.type, `input ${inputName}`);
        }

        const executionInput = { ...inputPayload };
        const validationErrors = validateOperationInput({
          operation: options.selectedBuilderOperation,
          input: executionInput,
          enhancement: options.selectedBuilderOperationEnhancement ?? undefined,
        });
        if (validationErrors.length > 0) {
          throw new Error(validationErrors[0]);
        }
        if (isReadOnlyOperation) {
          if (!options.selectedBuilderOperation.readOutput) {
            throw new Error(
              `Read-only operation ${options.builderProtocolId}/${options.selectedBuilderOperation.operationId} is missing read_output in the runtime spec.`,
            );
          }

          const response = await runRemoteViewRun({
            viewApiBaseUrl: options.viewApiBaseUrl,
            protocolId: options.builderProtocolId,
            operationId: options.selectedBuilderOperation.operationId,
            input: executionInput,
            limit: 20,
          });

          const remoteItems = response.items ?? [];
          const derived = buildDerivedFromReadOutputSource(
            options.selectedBuilderOperation.readOutput.source,
            remoteItems,
          );
          const preparedReadOnly: BuilderPreparedStepResult = {
            derived,
            args: {},
            accounts: {},
            instructionName: null,
          };

          const readScope = {
            input: executionInput,
            args: preparedReadOnly.args,
            accounts: preparedReadOnly.accounts,
            derived: preparedReadOnly.derived,
          };
          const readValue = readBuilderPath(readScope, options.selectedBuilderOperation.readOutput.source);
          if (readValue === undefined) {
            throw new Error(
              `read_output.source ${options.selectedBuilderOperation.readOutput.source} did not resolve for ${options.builderProtocolId}/${options.selectedBuilderOperation.operationId}.`,
            );
          }

          const readOnlyHighlights = buildReadOnlyHighlightsFromSpec(
            options.selectedBuilderOperation.readOutput,
            readValue,
          );
          const resultLines = [
            `Builder result (${options.builderProtocolId}/${options.selectedBuilderOperation.operationId}):`,
            'Read-only operation (view API).',
            ...(readOnlyHighlights.length > 0 ? readOnlyHighlights : []),
          ];
          options.setBuilderResult(resultLines, {
            input: executionInput,
            viewApi: {
              baseUrl: options.viewApiBaseUrl,
              protocolId: options.builderProtocolId,
              operationId: options.selectedBuilderOperation.operationId,
            },
            readOutput: options.selectedBuilderOperation.readOutput,
            readOutputValue: readValue,
            response,
            derived: preparedReadOnly.derived,
            args: preparedReadOnly.args,
            accounts: preparedReadOnly.accounts,
          });
          options.applyBuilderAppStepResult({
            executionInput,
            prepared: preparedReadOnly,
            operationSucceeded: true,
          });
          options.pushMessage('assistant', resultLines.join('\n'));
          return;
        }

        const prepared = await prepareRuntimeOperation({
          protocolId: options.builderProtocolId,
          operationId: options.selectedBuilderOperation.operationId,
          input: executionInput,
          connection: options.connection,
          walletPublicKey: walletPublicKey as PublicKey,
        });
        const builderNotes: string[] = [];

        if (!prepared.instructionName) {
          if (!options.selectedBuilderOperation.readOutput) {
            throw new Error(
              `Read-only operation ${options.builderProtocolId}/${options.selectedBuilderOperation.operationId} is missing read_output in the runtime spec.`,
            );
          }
          const readScope = {
            input: executionInput,
            args: prepared.args,
            accounts: prepared.accounts,
            derived: prepared.derived,
          };
          const readValue = readBuilderPath(readScope, options.selectedBuilderOperation.readOutput.source);
          if (readValue === undefined) {
            throw new Error(
              `read_output.source ${options.selectedBuilderOperation.readOutput.source} did not resolve for ${options.builderProtocolId}/${options.selectedBuilderOperation.operationId}.`,
            );
          }
          const readOnlyHighlights = buildReadOnlyHighlightsFromSpec(
            options.selectedBuilderOperation.readOutput,
            readValue,
          );
          const resultLines = [
            `Builder result (${options.builderProtocolId}/${options.selectedBuilderOperation.operationId}):`,
            'Read-only operation (no instruction to execute).',
            ...(readOnlyHighlights.length > 0 ? readOnlyHighlights : []),
          ];
          options.setBuilderResult(resultLines, {
            input: executionInput,
            notes: builderNotes,
            readOutput: options.selectedBuilderOperation.readOutput,
            readOutputValue: readValue,
            derived: prepared.derived,
            args: prepared.args,
            accounts: prepared.accounts,
          });
          options.applyBuilderAppStepResult({
            executionInput,
            prepared,
            operationSucceeded: true,
          });
          options.pushMessage('assistant', resultLines.join('\n'));
          return;
        }

        const preInstructions = buildMetaPreInstructions(prepared.preInstructions);
        const postInstructions = buildMetaPostInstructions(prepared.postInstructions);
        const runAsSimulation = options.isBuilderAppMode
          ? options.builderAppSubmitMode === 'simulate'
          : options.builderSimulate;

        if (runAsSimulation) {
          const simulation = await simulateIdlInstruction({
            protocolId: prepared.protocolId,
            instructionName: prepared.instructionName,
            args: prepared.args,
            accounts: prepared.accounts,
            remainingAccounts: prepared.remainingAccounts,
            preInstructions,
            postInstructions,
            connection: options.connection,
            wallet: options.wallet,
          });

          const resultLines = [
            `Builder simulate (${options.builderProtocolId}/${options.selectedBuilderOperation.operationId}):`,
            `instruction: ${prepared.instructionName}`,
            `status: ${simulation.ok ? 'success' : 'failed'}`,
            options.isBuilderAppMode
              ? options.getBuilderStepStatusText(
                  simulation.ok ? 'success' : 'error',
                  simulation.ok ? undefined : { error: simulation.error ?? 'unknown simulation error' },
                )
              : simulation.ok
                ? 'Step completed.'
                : `Step failed: ${simulation.error ?? 'unknown simulation error'}`,
            `units: ${simulation.unitsConsumed ?? 'n/a'}`,
            ...(builderNotes.length > 0 ? builderNotes : []),
            `error: ${simulation.error ?? 'none'}`,
            ...(simulation.ok
              ? [
                  options.isBuilderAppMode
                    ? 'next: click Send Transaction when ready.'
                    : 'next: disable simulate and click Send Transaction.',
                ]
              : []),
          ];
          options.setBuilderResult(resultLines, {
            input: executionInput,
            notes: builderNotes,
            args: prepared.args,
            accounts: prepared.accounts,
            logs: simulation.logs,
          });
          if (simulation.ok) {
            options.applyBuilderAppStepResult({
              executionInput,
              prepared,
              operationSucceeded: true,
            });
          } else {
            options.applyBuilderAppStepResult({
              executionInput,
              prepared,
              operationSucceeded: false,
              errorMessage: simulation.error ?? 'unknown simulation error',
            });
          }
          options.pushMessage('assistant', resultLines.join('\n'));
          return;
        }

        const sent = await sendIdlInstruction({
          protocolId: prepared.protocolId,
          instructionName: prepared.instructionName,
          args: prepared.args,
          accounts: prepared.accounts,
          remainingAccounts: prepared.remainingAccounts,
          preInstructions,
          postInstructions,
          connection: options.connection,
          wallet: options.wallet,
        });

        const resultLines = [
          `Builder tx sent (${options.builderProtocolId}/${options.selectedBuilderOperation.operationId}):`,
          `instruction: ${prepared.instructionName}`,
          options.isBuilderAppMode ? options.getBuilderStepStatusText('success') : 'Step completed.',
          ...(builderNotes.length > 0 ? builderNotes : []),
          `signature: ${sent.signature}`,
          `explorer: ${sent.explorerUrl}`,
        ];
        options.setBuilderResult(resultLines);
        options.applyBuilderAppStepResult({
          executionInput,
          prepared,
          operationSucceeded: true,
        });
        options.pushMessage('assistant', resultLines.join('\n'));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown builder error.';
        options.applyBuilderAppStepResult({
          executionInput: {},
          operationSucceeded: false,
          errorMessage: message,
        });
        const text = `Error: ${message}`;
        options.setBuilderStatusText(
          options.isBuilderAppMode ? options.getBuilderStepStatusText('error', { error: message }) : text,
        );
        options.setBuilderRawDetails(null);
        options.setBuilderShowRawDetails(false);
        options.pushMessage('assistant', text);
      } finally {
        options.setIsBuilderWorking(false);
      }
    },
    [options],
  );

  return {
    handleBuilderSubmit,
  };
}
