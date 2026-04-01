import { useEffect, useMemo, useState } from 'react';
import { listIdlProtocols } from '@brij-digital/apppack-runtime/idlDeclarativeRuntime';
import {
  listRuntimeOperations,
  type RuntimeOperationSummary,
} from '@brij-digital/apppack-runtime/runtimeOperationRuntime';
import {
  asPrettyJson,
  buildExampleInputsForOperation,
} from './builderHelpers';
import {
  buildOperationEnhancementFromSummary,
  type OperationEnhancement,
} from './metaEnhancements';

export type BuilderProtocol = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
};

export type BuilderPreparedStepResult = {
  derived: Record<string, unknown>;
  args: Record<string, unknown>;
  accounts: Record<string, string>;
  instructionName: string | null;
};

const DEV_PREFILL_PRESETS: Record<string, Record<string, Record<string, string>>> = {
  'pump-core-mainnet': {
    buy_exact_sol_in: {
      base_mint: 'C8KGwny4tfPwcLvXC9bgcaFMbqyDvroZgxW7AoBbpump',
      spendable_sol_in: '10000000',
      slippage_bps: '100',
    },
  },
  'pump-amm-mainnet': {
    list_tokens: {
      quote_mint: 'So11111111111111111111111111111111111111112',
    },
    view_pool: {
      base_mint: 'C4yDhKwkikpVGCQWD9BT2SJyHAtRFFnKPDM9Nyshpump',
      quote_mint: 'So11111111111111111111111111111111111111112',
    },
    buy: {
      base_mint: 'C4yDhKwkikpVGCQWD9BT2SJyHAtRFFnKPDM9Nyshpump',
      quote_mint: 'So11111111111111111111111111111111111111112',
      pool: 'HVuJoW1px34PAEfc9uWUv7Lrh7Ta4uSoPrkztCcdwa21',
      quote_amount_in: '10000000',
      slippage_bps: '100',
    },
    sell: {
      base_mint: 'C4yDhKwkikpVGCQWD9BT2SJyHAtRFFnKPDM9Nyshpump',
      quote_mint: 'So11111111111111111111111111111111111111112',
      pool: 'HVuJoW1px34PAEfc9uWUv7Lrh7Ta4uSoPrkztCcdwa21',
      base_amount_in: '1000000',
      min_quote_amount_out: '1',
    },
  },
};

export function useBuilderController() {
  const [builderProtocols, setBuilderProtocols] = useState<BuilderProtocol[]>([]);
  const [builderProtocolId, setBuilderProtocolId] = useState('');
  const [builderOperations, setBuilderOperations] = useState<RuntimeOperationSummary[]>([]);
  const [builderOperationId, setBuilderOperationId] = useState('');
  const [builderInputValues, setBuilderInputValues] = useState<Record<string, string>>({});
  const [builderSimulate, setBuilderSimulate] = useState(true);
  const [builderStatusText, setBuilderStatusText] = useState<string | null>(null);
  const [builderRawDetails, setBuilderRawDetails] = useState<string | null>(null);
  const [builderShowRawDetails, setBuilderShowRawDetails] = useState(false);

  const builderProtocolLabelsById = useMemo(
    () => Object.fromEntries(builderProtocols.map((protocol) => [protocol.id, protocol.name])),
    [builderProtocols],
  );

  const builderOperationLabelsByOperationId = useMemo(
    () => Object.fromEntries(builderOperations.map((operation) => [operation.operationId, operation.operationId])),
    [builderOperations],
  );

  const builderOperationEnhancementsByOperation = useMemo(
    () =>
      Object.fromEntries(
        builderOperations.map((operation) => [
          operation.operationId,
          buildOperationEnhancementFromSummary(operation),
        ]),
      ) as Record<string, OperationEnhancement>,
    [builderOperations],
  );

  const selectedBuilderOperation = useMemo(
    () => builderOperations.find((entry) => entry.operationId === builderOperationId) ?? null,
    [builderOperations, builderOperationId],
  );

  const selectedBuilderOperationEnhancement = useMemo(
    () =>
      selectedBuilderOperation
        ? builderOperationEnhancementsByOperation[selectedBuilderOperation.operationId] ?? null
        : null,
    [builderOperationEnhancementsByOperation, selectedBuilderOperation],
  );

  const visibleBuilderInputs = useMemo(
    () => (selectedBuilderOperation ? Object.entries(selectedBuilderOperation.inputs) : []),
    [selectedBuilderOperation],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const registry = await listIdlProtocols();
      const protocols = registry.protocols
        .filter((protocol) => typeof protocol.agentRuntimePath === 'string' && protocol.agentRuntimePath.length > 0)
        .map((protocol) => ({
          id: protocol.id,
          name: protocol.name,
          status: protocol.status,
        }));
      if (cancelled) {
        return;
      }
      setBuilderProtocols(protocols);
      const firstActive = protocols.find((entry) => entry.status === 'active') ?? protocols[0] ?? null;
      setBuilderProtocolId(firstActive?.id ?? '');
    })().catch((error) => {
      if (!cancelled) {
        setBuilderStatusText(`Error: ${error instanceof Error ? error.message : 'Failed to load protocols.'}`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!builderProtocolId) {
      setBuilderOperations([]);
      setBuilderOperationId('');
      setBuilderInputValues({});
      return;
    }

    let cancelled = false;
    void (async () => {
      const operationsView = await listRuntimeOperations({
        protocolId: builderProtocolId,
      });
      const executionOperations = operationsView.operations.filter((entry) => entry.executionKind === 'write');
      if (cancelled) {
        return;
      }
      setBuilderOperations(executionOperations);
      setBuilderOperationId((current) => {
        if (current && executionOperations.some((entry) => entry.operationId === current)) {
          return current;
        }
        return executionOperations[0]?.operationId ?? '';
      });
    })().catch((error) => {
      if (!cancelled) {
        setBuilderStatusText(`Error: ${error instanceof Error ? error.message : 'Failed to load runtime operations.'}`);
        setBuilderOperations([]);
        setBuilderOperationId('');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [builderProtocolId]);

  useEffect(() => {
    if (!selectedBuilderOperation) {
      setBuilderInputValues({});
      return;
    }

    const nextValues = Object.fromEntries(
      Object.keys(selectedBuilderOperation.inputs).map((inputName) => [inputName, '']),
    );
    setBuilderInputValues(nextValues);
  }, [selectedBuilderOperation]);

  function handleBuilderProtocolSelect(nextProtocolId: string) {
    setBuilderProtocolId(nextProtocolId);
  }

  function handleBuilderOperationSelect(nextOperationId: string) {
    setBuilderOperationId(nextOperationId);
  }

  function handleBuilderInputChange(inputName: string, value: string) {
    setBuilderInputValues((prev) => ({
      ...prev,
      [inputName]: value,
    }));
  }

  function handleBuilderPrefillExample() {
    if (!selectedBuilderOperation) {
      return;
    }

    const built = buildExampleInputsForOperation(selectedBuilderOperation);
    const presetExamples = DEV_PREFILL_PRESETS[builderProtocolId]?.[selectedBuilderOperation.operationId] ?? {};
    setBuilderInputValues({
      ...built,
      ...presetExamples,
    });
    setBuilderStatusText(`Prefilled example inputs for ${builderProtocolId}/${selectedBuilderOperation.operationId}.`);
    setBuilderRawDetails(null);
    setBuilderShowRawDetails(false);
  }

  function handleBuilderToggleRawDetails() {
    setBuilderShowRawDetails((current) => !current);
  }

  function setBuilderResult(lines: string[], raw?: unknown) {
    setBuilderStatusText(lines.join('\n'));
    setBuilderRawDetails(raw === undefined ? null : asPrettyJson(raw));
    setBuilderShowRawDetails(false);
  }

  return {
    builderProtocols,
    builderProtocolLabelsById,
    builderProtocolId,
    builderOperations,
    builderOperationId,
    builderInputValues,
    builderSimulate,
    setBuilderSimulate,
    builderStatusText,
    setBuilderStatusText,
    builderRawDetails,
    setBuilderRawDetails,
    builderShowRawDetails,
    setBuilderShowRawDetails,
    builderOperationLabelsByOperationId,
    selectedBuilderOperation,
    selectedBuilderOperationEnhancement,
    visibleBuilderInputs,
    setBuilderResult,
    handleBuilderProtocolSelect,
    handleBuilderOperationSelect,
    handleBuilderInputChange,
    handleBuilderPrefillExample,
    handleBuilderToggleRawDetails,
  };
}
