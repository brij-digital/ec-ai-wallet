import type { WalletContextState } from '@solana/wallet-adapter-react';
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import {
  prepareRuntimeOperation,
  type RuntimeOperationSummary,
} from '@brij-digital/apppack-runtime/runtimeOperationRuntime';
import {
  buildDerivedFromReadOutputSource,
  buildReadOnlyHighlightsFromSpec,
  parseBuilderInputValue,
  readBuilderPath,
  stringifyBuilderDefault,
} from './builderHelpers';
import { validateOperationInput, type OperationEnhancement } from './metaEnhancements';
import {
  sendPreparedExecutionDraft,
  simulatePreparedExecutionDraft,
} from './runtimeSubmit';
import type { BuilderPreparedStepResult } from './useBuilderController';

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
  selectedBuilderOperation: RuntimeOperationSummary | null;
  selectedBuilderOperationEnhancement: OperationEnhancement | null;
  builderInputValues: Record<string, string>;
  onSetBuilderInputValue: (name: string, value: string) => void;
  setBuilderStatusText: (value: string | null) => void;
  setBuilderRawDetails: (value: string | null) => void;
  setBuilderShowRawDetails: (value: boolean) => void;
  setBuilderResult: (lines: string[], raw?: unknown) => void;
  builderSimulate: boolean;
};

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

  const response = await fetch(`${options.viewApiBaseUrl}/view-run`, {
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

  const parsed = (await response.json()) as RemoteViewRunResponse;
  if (!response.ok) {
    throw new Error(parsed.error ?? `View API error ${response.status}`);
  }
  if (!parsed.ok) {
    throw new Error(parsed.error ?? 'View API returned ok=false.');
  }
  return parsed;
}

function buildPreparedResult(prepared: Awaited<ReturnType<typeof prepareRuntimeOperation>>): BuilderPreparedStepResult {
  return {
    derived: prepared.derived,
    args: prepared.args,
    accounts: prepared.accounts,
    instructionName: prepared.instructionName,
  };
}

export function useBuilderSubmitController(options: UseBuilderSubmitControllerOptions) {
  const previewSeqRef = useRef(0);

  useEffect(() => {
    const operation = options.selectedBuilderOperation;
    if (!operation) {
      return;
    }
    const previewWalletPublicKey = options.wallet.publicKey ?? PublicKey.default;
    const previewBindings = Object.entries(operation.inputs)
      .filter(([, spec]) => typeof spec.bind_from === 'string' && spec.bind_from.trim().length > 0)
      .map(([inputName, spec]) => ({
        inputName,
        source: spec.bind_from!.trim(),
      }));
    if (previewBindings.length === 0) {
      return;
    }

    const missingRequired = Object.entries(operation.inputs).some(([inputName, spec]) => {
      if (typeof spec.bind_from === 'string' && spec.bind_from.trim().length > 0) {
        return false;
      }
      const rawValue = options.builderInputValues[inputName] ?? '';
      return spec.required && spec.default === undefined && rawValue.trim().length === 0;
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
            const rawValue = options.builderInputValues[inputName] ?? '';
            if (!rawValue.trim()) {
              continue;
            }
            if (typeof spec.bind_from === 'string' && spec.bind_from.trim().length > 0) {
              continue;
            }
            inputPayload[inputName] = parseBuilderInputValue(rawValue, spec.type, `input ${inputName}`);
          }

          const prepared = await prepareRuntimeOperation({
            protocolId: options.builderProtocolId,
            operationId: operation.operationId,
            input: inputPayload,
            connection: options.connection,
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
            if ((options.builderInputValues[binding.inputName] ?? '') !== nextText) {
              options.onSetBuilderInputValue(binding.inputName, nextText);
            }
          }
        } catch {
          // Preview hydration must stay silent.
        }
      })();
    }, 350);

    return () => {
      window.clearTimeout(debounce);
    };
  }, [
    options.builderInputValues,
    options.builderProtocolId,
    options.connection,
    options.onSetBuilderInputValue,
    options.selectedBuilderOperation,
    options.wallet.publicKey,
  ]);

  const handleBuilderSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!options.builderProtocolId || !options.selectedBuilderOperation) {
        options.setBuilderStatusText('Error: Select a protocol and an operation first.');
        options.setBuilderRawDetails(null);
        return;
      }

      const operation = options.selectedBuilderOperation;
      const isReadOnlyOperation = !operation.instruction;
      if (!options.wallet.publicKey && !isReadOnlyOperation) {
        options.setBuilderStatusText('Error: Connect wallet first.');
        options.setBuilderRawDetails(null);
        return;
      }

      options.setIsBuilderWorking(true);
      options.setBuilderStatusText(null);
      options.setBuilderRawDetails(null);
      options.setBuilderShowRawDetails(false);

      try {
        const inputPayload: Record<string, unknown> = {};
        for (const [inputName, spec] of Object.entries(operation.inputs)) {
          const rawValue = options.builderInputValues[inputName] ?? '';
          if (!rawValue.trim()) {
            const autoBound = typeof spec.bind_from === 'string' && spec.bind_from.trim().length > 0;
            if (spec.required && spec.default === undefined && !autoBound) {
              throw new Error(`Missing required input ${inputName}.`);
            }
            continue;
          }
          inputPayload[inputName] = parseBuilderInputValue(rawValue, spec.type, `input ${inputName}`);
        }

        const validationErrors = validateOperationInput({
          operation,
          input: inputPayload,
          enhancement: options.selectedBuilderOperationEnhancement ?? undefined,
        });
        if (validationErrors.length > 0) {
          throw new Error(validationErrors[0]);
        }

        if (isReadOnlyOperation) {
          if (!operation.readOutput) {
            throw new Error(`Read-only operation ${options.builderProtocolId}/${operation.operationId} is missing read_output.`);
          }

          const response = await runRemoteViewRun({
            viewApiBaseUrl: options.viewApiBaseUrl,
            protocolId: options.builderProtocolId,
            operationId: operation.operationId,
            input: inputPayload,
            limit: 20,
          });

          const readValue = response.items ?? [];
          const derived = buildDerivedFromReadOutputSource(operation.readOutput.source, readValue);
          const preparedReadOnly: BuilderPreparedStepResult = {
            derived,
            args: {},
            accounts: {},
            instructionName: null,
          };

          const lines = [
            `Runtime result (${options.builderProtocolId}/${operation.operationId}):`,
            'Read-only operation (view API).',
            ...buildReadOnlyHighlightsFromSpec(operation.readOutput, readValue),
          ];
          options.setBuilderResult(lines, {
            input: inputPayload,
            response,
            derived: preparedReadOnly.derived,
          });
          options.pushMessage('assistant', lines.join('\n'));
          return;
        }

        const prepared = await prepareRuntimeOperation({
          protocolId: options.builderProtocolId,
          operationId: operation.operationId,
          input: inputPayload,
          connection: options.connection,
          walletPublicKey: options.wallet.publicKey as PublicKey,
        });

        if (!prepared.instructionName) {
          throw new Error(`Operation ${operation.operationId} did not resolve to an instruction.`);
        }

        if (options.builderSimulate) {
          const simulation = await simulatePreparedExecutionDraft({
            draft: prepared,
            connection: options.connection,
            wallet: options.wallet,
          });

          const lines = [
            `Runtime simulate (${options.builderProtocolId}/${operation.operationId}):`,
            `instruction: ${prepared.instructionName}`,
            `status: ${simulation.ok ? 'success' : 'failed'}`,
            `units: ${simulation.unitsConsumed ?? 'n/a'}`,
            `error: ${simulation.error ?? 'none'}`,
          ];
          options.setBuilderResult(lines, {
            input: inputPayload,
            prepared: buildPreparedResult(prepared),
            logs: simulation.logs,
          });
          options.pushMessage('assistant', lines.join('\n'));
          return;
        }

        const sent = await sendPreparedExecutionDraft({
          draft: prepared,
          connection: options.connection,
          wallet: options.wallet,
        });

        const lines = [
          `Runtime tx sent (${options.builderProtocolId}/${operation.operationId}):`,
          `instruction: ${prepared.instructionName}`,
          `signature: ${sent.signature}`,
          `explorer: ${sent.explorerUrl}`,
        ];
        options.setBuilderResult(lines, {
          input: inputPayload,
          prepared: buildPreparedResult(prepared),
        });
        options.pushMessage('assistant', lines.join('\n'));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown builder error.';
        const text = `Error: ${message}`;
        options.setBuilderStatusText(text);
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
