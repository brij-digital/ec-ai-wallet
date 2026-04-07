import type { WalletContextState } from '@solana/wallet-adapter-react';
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { useCallback } from 'react';
import type { FormEvent } from 'react';
import {
  prepareRuntimeOperation,
  runRuntimeView,
  type RuntimeOperationSummary,
} from '@brij-digital/apppack-runtime/runtimeOperationRuntime';
import {
  buildReadOnlyHighlightsFromSpec,
  parseBuilderInputValue,
} from './builderHelpers';
import { validateOperationInput, type OperationEnhancement } from './metaEnhancements';
import {
  sendPreparedExecutionDraft,
  simulatePreparedExecutionDraft,
} from './runtimeSubmit';
import type { BuilderPreparedStepResult } from './useBuilderController';

type UseBuilderSubmitControllerOptions = {
  connection: Connection;
  wallet: WalletContextState;
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

function buildPreparedResult(prepared: Awaited<ReturnType<typeof prepareRuntimeOperation>>): BuilderPreparedStepResult {
  return {
    derived: prepared.derived,
    args: prepared.args,
    accounts: prepared.accounts,
    instructionName: prepared.instructionName,
  };
}

export function useBuilderSubmitController(options: UseBuilderSubmitControllerOptions) {
  const handleBuilderSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!options.builderProtocolId || !options.selectedBuilderOperation) {
        options.setBuilderStatusText('Error: Select a protocol and an operation first.');
        options.setBuilderRawDetails(null);
        return;
      }

      const operation = options.selectedBuilderOperation;
      const isReadOnlyOperation = operation.executionKind !== 'write';
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
          if (!options.wallet.publicKey) {
            throw new Error('Connect wallet first to execute runtime views.');
          }
          if (!operation.output) {
            throw new Error(`Read-only operation ${options.builderProtocolId}/${operation.operationId} is missing output.`);
          }

          const computed = await runRuntimeView({
            protocolId: options.builderProtocolId,
            operationId: operation.operationId,
            input: inputPayload,
            connection: options.connection,
            walletPublicKey: options.wallet.publicKey,
          });

          const lines = [
            `Runtime result (${options.builderProtocolId}/${operation.operationId}):`,
            'Read-only operation (runtime view).',
            ...buildReadOnlyHighlightsFromSpec(operation.output, computed.output),
          ];
          options.setBuilderResult(lines, {
            input: inputPayload,
            output: computed.output,
            outputSpec: computed.outputSpec,
            derived: computed.derived,
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
