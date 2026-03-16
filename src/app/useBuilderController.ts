/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react';
import { listIdlProtocols } from '@agentform/apppack-runtime/idlDeclarativeRuntime';
import {
  listMetaApps,
  listMetaOperations,
  type MetaAppSummary,
  type MetaOperationSummary,
} from '@agentform/apppack-runtime/metaIdlRuntime';
import {
  asPrettyJson,
  buildExampleInputsForOperation,
  evaluateBuilderStepSuccess,
  isBuilderAppStepUnlocked,
  readBuilderPath,
  resolveBuilderNextStepIndexOnSuccess,
  stringifyBuilderDefault,
  writeBuilderPath,
  type BuilderAppStepContext,
} from './builderHelpers';
import {
  extractAppUiEnhancements,
  extractOperationEnhancements,
  type AppUiEnhancement,
  type OperationEnhancement,
} from './metaEnhancements';

export type BuilderProtocol = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
};

export type BuilderViewMode = 'enduser' | 'geek';

export type BuilderPreparedStepResult = {
  derived: Record<string, unknown>;
  args: Record<string, unknown>;
  accounts: Record<string, string>;
  instructionName: string | null;
};

export type BuilderStepActionKind = 'run' | 'back' | 'reset';
export type BuilderStepActionMode = 'view' | 'simulate' | 'send';
export type BuilderStepActionVariant = 'primary' | 'secondary' | 'ghost';

export type BuilderStepAction = {
  actionId: string;
  kind: BuilderStepActionKind;
  label: string;
  mode?: BuilderStepActionMode;
  variant: BuilderStepActionVariant;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseBuilderStepAction(rawAction: unknown, fallbackId: string): BuilderStepAction | null {
  const action = asRecord(rawAction);
  if (!action) {
    return null;
  }

  const kind = action.kind;
  if (kind !== 'run' && kind !== 'back' && kind !== 'reset') {
    return null;
  }

  const rawLabel = action.label;
  if (typeof rawLabel !== 'string' || rawLabel.trim().length === 0) {
    return null;
  }

  const rawId = action.id;
  const actionId = typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : fallbackId;

  const rawVariant = action.variant;
  const variant: BuilderStepActionVariant =
    rawVariant === 'primary' || rawVariant === 'secondary' || rawVariant === 'ghost'
      ? rawVariant
      : kind === 'run'
        ? 'primary'
        : 'ghost';

  const rawMode = action.mode;
  const mode: BuilderStepActionMode | undefined =
    rawMode === 'view' || rawMode === 'simulate' || rawMode === 'send' ? rawMode : undefined;

  return {
    actionId,
    kind,
    label: rawLabel.trim(),
    ...(kind === 'run' && mode ? { mode } : {}),
    variant,
  };
}

function extractBuilderStepActionsByStep(rawMeta: unknown): Record<string, BuilderStepAction[]> {
  const meta = asRecord(rawMeta);
  if (!meta) {
    return {};
  }

  const apps = asRecord(meta.apps);
  if (!apps) {
    return {};
  }

  const actionsByStep: Record<string, BuilderStepAction[]> = {};
  for (const [appId, rawApp] of Object.entries(apps)) {
    const app = asRecord(rawApp);
    if (!app || !Array.isArray(app.steps)) {
      continue;
    }

    for (const rawStep of app.steps) {
      const step = asRecord(rawStep);
      const stepId = step && typeof step.id === 'string' && step.id.length > 0 ? step.id : null;
      if (!step || !stepId || !Array.isArray(step.actions)) {
        continue;
      }

      const normalized = step.actions
        .map((rawAction, index) => parseBuilderStepAction(rawAction, `${stepId}_action_${index + 1}`))
        .filter((action): action is BuilderStepAction => action !== null);
      if (normalized.length > 0) {
        actionsByStep[`${appId}:${stepId}`] = normalized;
      }
    }
  }

  return actionsByStep;
}

function extractBuilderInputExamplesByOperation(rawMeta: unknown): Record<string, Record<string, string>> {
  const meta = asRecord(rawMeta);
  if (!meta) {
    return {};
  }
  const operations = asRecord(meta.operations);
  if (!operations) {
    return {};
  }

  const output: Record<string, Record<string, string>> = {};
  for (const [operationId, rawOperation] of Object.entries(operations)) {
    const operation = asRecord(rawOperation);
    if (!operation) {
      continue;
    }
    const inputs = asRecord(operation.inputs);
    if (!inputs) {
      continue;
    }

    const examples: Record<string, string> = {};
    for (const [inputName, rawInputSpec] of Object.entries(inputs)) {
      const inputSpec = asRecord(rawInputSpec);
      if (!inputSpec) {
        continue;
      }
      if (inputSpec.ui_example !== undefined) {
        examples[inputName] = stringifyBuilderDefault(inputSpec.ui_example);
        continue;
      }
      if (inputSpec.example !== undefined) {
        examples[inputName] = stringifyBuilderDefault(inputSpec.example);
      }
    }

    if (Object.keys(examples).length > 0) {
      output[operationId] = examples;
    }
  }

  return output;
}

function resolveBuilderMetaPath(metaPath: string): string {
  return metaPath.startsWith('/') || /^https?:\/\//.test(metaPath) ? metaPath : `/${metaPath}`;
}

export function useBuilderController() {
  const [builderProtocols, setBuilderProtocols] = useState<BuilderProtocol[]>([]);
  const [builderProtocolLabelsById, setBuilderProtocolLabelsById] = useState<Record<string, string>>({});
  const [builderProtocolMetaPaths, setBuilderProtocolMetaPaths] = useState<Record<string, string | null>>({});
  const [builderProtocolId, setBuilderProtocolId] = useState('');
  const [builderApps, setBuilderApps] = useState<MetaAppSummary[]>([]);
  const [builderStepActionsByStep, setBuilderStepActionsByStep] = useState<Record<string, BuilderStepAction[]>>({});
  const [builderOperationEnhancementsByOperation, setBuilderOperationEnhancementsByOperation] = useState<
    Record<string, OperationEnhancement>
  >({});
  const [builderAppUiEnhancementsByApp, setBuilderAppUiEnhancementsByApp] = useState<
    Record<string, AppUiEnhancement>
  >({});
  const [builderInputExamplesByOperation, setBuilderInputExamplesByOperation] = useState<
    Record<string, Record<string, string>>
  >({});
  const [builderAppId, setBuilderAppId] = useState('');
  const [builderAppStepIndex, setBuilderAppStepIndex] = useState(0);
  const [builderAppStepContexts, setBuilderAppStepContexts] = useState<Record<string, BuilderAppStepContext>>({});
  const [builderAppStepCompleted, setBuilderAppStepCompleted] = useState<Record<string, boolean>>({});
  const [builderOperations, setBuilderOperations] = useState<MetaOperationSummary[]>([]);
  const [builderOperationId, setBuilderOperationId] = useState('');
  const [builderViewMode, setBuilderViewMode] = useState<BuilderViewMode>('enduser');
  const [builderInputValues, setBuilderInputValues] = useState<Record<string, string>>({});
  const [builderSimulate, setBuilderSimulate] = useState(true);
  const [builderAppSubmitMode, setBuilderAppSubmitMode] = useState<'simulate' | 'send'>('simulate');
  const [builderStatusText, setBuilderStatusText] = useState<string | null>(null);
  const [builderRawDetails, setBuilderRawDetails] = useState<string | null>(null);
  const [builderShowRawDetails, setBuilderShowRawDetails] = useState(false);

  const selectedBuilderApp = useMemo(
    () => builderApps.find((entry) => entry.appId === builderAppId) ?? null,
    [builderApps, builderAppId],
  );
  const selectedBuilderAppEntryStepIndex = useMemo(() => {
    if (!selectedBuilderApp) {
      return 0;
    }
    const index = selectedBuilderApp.steps.findIndex((step) => step.stepId === selectedBuilderApp.entryStepId);
    return index >= 0 ? index : 0;
  }, [selectedBuilderApp]);
  const isBuilderAppMode = builderViewMode === 'enduser' && !!selectedBuilderApp;
  const selectedBuilderAppStep = useMemo(() => {
    if (!selectedBuilderApp) {
      return null;
    }
    return selectedBuilderApp.steps[builderAppStepIndex] ?? null;
  }, [selectedBuilderApp, builderAppStepIndex]);
  const selectedBuilderAppStepContext = useMemo(() => {
    if (!selectedBuilderAppStep) {
      return null;
    }
    return builderAppStepContexts[selectedBuilderAppStep.stepId] ?? null;
  }, [selectedBuilderAppStep, builderAppStepContexts]);
  const selectedBuilderAppSelectUi = useMemo(() => {
    if (!selectedBuilderAppStep || !selectedBuilderAppStep.ui) {
      return null;
    }
    return selectedBuilderAppStep.ui.kind === 'select_from_derived' ? selectedBuilderAppStep.ui : null;
  }, [selectedBuilderAppStep]);
  const selectedBuilderAppSelectableItems = useMemo(() => {
    if (!selectedBuilderAppStepContext || !selectedBuilderAppSelectUi) {
      return [] as unknown[];
    }
    const fromDerived = readBuilderPath(
      selectedBuilderAppStepContext.derived,
      selectedBuilderAppSelectUi.source,
    );
    return Array.isArray(fromDerived) ? fromDerived : [];
  }, [selectedBuilderAppStepContext, selectedBuilderAppSelectUi]);
  const showBuilderSelectableItems = useMemo(
    () =>
      builderViewMode === 'enduser' &&
      !!selectedBuilderAppSelectUi &&
      selectedBuilderAppSelectableItems.length > 0,
    [builderViewMode, selectedBuilderAppSelectUi, selectedBuilderAppSelectableItems],
  );
  const selectedBuilderSelectedItemValue = useMemo(() => {
    if (!selectedBuilderAppStepContext || !selectedBuilderAppSelectUi) {
      return null;
    }
    const selectedItem = readBuilderPath(selectedBuilderAppStepContext.derived, selectedBuilderAppSelectUi.bindTo);
    if (selectedItem === undefined) {
      return null;
    }
    return readBuilderPath(selectedItem, selectedBuilderAppSelectUi.valuePath);
  }, [selectedBuilderAppStepContext, selectedBuilderAppSelectUi]);
  const selectedBuilderStepActions = useMemo(() => {
    if (!selectedBuilderApp || !selectedBuilderAppStep) {
      return [] as BuilderStepAction[];
    }
    const key = `${selectedBuilderApp.appId}:${selectedBuilderAppStep.stepId}`;
    return builderStepActionsByStep[key] ?? [];
  }, [selectedBuilderApp, selectedBuilderAppStep, builderStepActionsByStep]);
  const builderOperationLabelsByOperationId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(builderOperationEnhancementsByOperation)
          .filter(([, enhancement]) => typeof enhancement.label === 'string' && enhancement.label.length > 0)
          .map(([operationId, enhancement]) => [operationId, enhancement.label as string]),
      ),
    [builderOperationEnhancementsByOperation],
  );
  const builderAppLabelsByAppId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(builderAppUiEnhancementsByApp)
          .filter(([, enhancement]) => typeof enhancement.label === 'string' && enhancement.label.length > 0)
          .map(([appId, enhancement]) => [appId, enhancement.label as string]),
      ),
    [builderAppUiEnhancementsByApp],
  );
  const builderStepLabelsByAppStepKey = useMemo(() => {
    const output: Record<string, string> = {};
    for (const [appId, enhancement] of Object.entries(builderAppUiEnhancementsByApp)) {
      for (const [stepId, label] of Object.entries(enhancement.stepLabels)) {
        output[`${appId}:${stepId}`] = label;
      }
    }
    return output;
  }, [builderAppUiEnhancementsByApp]);
  const effectiveBuilderOperationId = useMemo(
    () =>
      builderViewMode === 'enduser'
        ? selectedBuilderAppStep?.operationId ?? ''
        : builderOperationId,
    [builderViewMode, selectedBuilderAppStep, builderOperationId],
  );
  const selectedBuilderOperation = useMemo(
    () => builderOperations.find((entry) => entry.operationId === effectiveBuilderOperationId) ?? null,
    [builderOperations, effectiveBuilderOperationId],
  );
  const selectedBuilderOperationEnhancement = useMemo(
    () =>
      selectedBuilderOperation
        ? builderOperationEnhancementsByOperation[selectedBuilderOperation.operationId] ?? null
        : null,
    [selectedBuilderOperation, builderOperationEnhancementsByOperation],
  );
  const visibleBuilderInputs = useMemo(() => {
    if (!selectedBuilderOperation) {
      return [] as Array<[string, MetaOperationSummary['inputs'][string]]>;
    }

    const filtered = Object.entries(selectedBuilderOperation.inputs).filter(([, spec]) => {
      if (builderViewMode === 'geek') {
        return true;
      }

      const autoResolved =
        spec.default !== undefined || (typeof spec.discover_from === 'string' && spec.discover_from.length > 0);
      if (spec.required && !autoResolved) {
        return true;
      }

      if (spec.ui_tier === 'enduser') {
        return true;
      }
      if (spec.ui_tier === 'geek') {
        return false;
      }

      return spec.required && !autoResolved;
    });

    const hintsByInput = selectedBuilderOperationEnhancement?.inputUi ?? {};
    return filtered.sort(([leftInput], [rightInput]) => {
      const leftOrder = hintsByInput[leftInput]?.displayOrder;
      const rightOrder = hintsByInput[rightInput]?.displayOrder;
      if (leftOrder !== undefined && rightOrder !== undefined) {
        return leftOrder - rightOrder;
      }
      if (leftOrder !== undefined) {
        return -1;
      }
      if (rightOrder !== undefined) {
        return 1;
      }
      return leftInput.localeCompare(rightInput);
    });
  }, [selectedBuilderOperation, builderViewMode, selectedBuilderOperationEnhancement]);
  const hiddenBuilderInputsCount = selectedBuilderOperation
    ? Object.keys(selectedBuilderOperation.inputs).length - visibleBuilderInputs.length
    : 0;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const registry = await listIdlProtocols();
      const protocols = registry.protocols.map((protocol) => ({
        id: protocol.id,
        name: protocol.name,
        status: protocol.status,
      }));

      if (cancelled) {
        return;
      }

      setBuilderProtocols(protocols);
      setBuilderProtocolMetaPaths(
        Object.fromEntries(
          registry.protocols.map((protocol) => [protocol.id, protocol.metaPath ?? null]),
        ),
      );
      setBuilderProtocolId((current) => current || protocols[0]?.id || '');
    })().catch((error) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : 'Failed to load protocol list.';
        setBuilderStatusText(`Error: ${message}`);
        setBuilderRawDetails(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!builderProtocolId) {
      setBuilderApps([]);
      setBuilderAppId('');
      setBuilderAppStepIndex(0);
      setBuilderAppStepContexts({});
      setBuilderAppStepCompleted({});
      setBuilderOperations([]);
      setBuilderOperationId('');
      return;
    }

    let cancelled = false;
    void (async () => {
      const [operationsView, appsView] = await Promise.all([
        listMetaOperations({
          protocolId: builderProtocolId,
        }),
        listMetaApps({
          protocolId: builderProtocolId,
        }),
      ]);
      if (cancelled) {
        return;
      }

      setBuilderApps(appsView.apps);
      setBuilderAppId((current) => {
        if (current && appsView.apps.some((entry) => entry.appId === current)) {
          return current;
        }
        return appsView.apps[0]?.appId ?? '';
      });
      const firstApp = appsView.apps[0];
      if (firstApp) {
        const entryIndex = firstApp.steps.findIndex((step) => step.stepId === firstApp.entryStepId);
        setBuilderAppStepIndex(entryIndex >= 0 ? entryIndex : 0);
      } else {
        setBuilderAppStepIndex(0);
      }
      setBuilderAppStepContexts({});
      setBuilderAppStepCompleted({});
      setBuilderOperations(operationsView.operations);
      setBuilderOperationId((current) => {
        const firstLoadedApp = appsView.apps[0];
        const entryStep = firstLoadedApp
          ? firstLoadedApp.steps.find((step) => step.stepId === firstLoadedApp.entryStepId) ?? firstLoadedApp.steps[0]
          : undefined;
        const appOperationId = entryStep?.operationId;
        if (builderViewMode === 'enduser' && appOperationId) {
          return appOperationId;
        }
        if (builderViewMode === 'enduser') {
          return '';
        }
        if (current && operationsView.operations.some((entry) => entry.operationId === current)) {
          return current;
        }
        return operationsView.operations[0]?.operationId ?? '';
      });
    })().catch((error) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : 'Failed to load meta operations/apps.';
        setBuilderStatusText(`Error: ${message}`);
        setBuilderRawDetails(null);
        setBuilderApps([]);
        setBuilderStepActionsByStep({});
        setBuilderOperationEnhancementsByOperation({});
        setBuilderAppUiEnhancementsByApp({});
        setBuilderInputExamplesByOperation({});
        setBuilderProtocolMetaPaths({});
        setBuilderAppId('');
        setBuilderAppStepIndex(0);
        setBuilderAppStepContexts({});
        setBuilderAppStepCompleted({});
        setBuilderOperations([]);
        setBuilderOperationId('');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [builderProtocolId, builderViewMode]);

  useEffect(() => {
    if (!builderProtocolId) {
      setBuilderStepActionsByStep({});
      setBuilderOperationEnhancementsByOperation({});
      setBuilderAppUiEnhancementsByApp({});
      setBuilderInputExamplesByOperation({});
      return;
    }
    const metaPath = builderProtocolMetaPaths[builderProtocolId] ?? null;
    if (!metaPath || typeof fetch !== 'function') {
      setBuilderStepActionsByStep({});
      setBuilderOperationEnhancementsByOperation({});
      setBuilderAppUiEnhancementsByApp({});
      setBuilderInputExamplesByOperation({});
      return;
    }

    let cancelled = false;
    void (async () => {
      const response = await fetch(resolveBuilderMetaPath(metaPath));
      if (!response.ok) {
        throw new Error(`Failed to load raw meta IDL (${response.status}).`);
      }
      const rawMeta = (await response.json()) as unknown;
      if (cancelled) {
        return;
      }
      const rawMetaRecord = asRecord(rawMeta);
      const rawProtocolLabel = rawMetaRecord ? rawMetaRecord.label : undefined;
      if (typeof rawProtocolLabel === 'string' && rawProtocolLabel.trim().length > 0) {
        setBuilderProtocolLabelsById((prev) => ({
          ...prev,
          [builderProtocolId]: rawProtocolLabel.trim(),
        }));
      }
      setBuilderStepActionsByStep(extractBuilderStepActionsByStep(rawMeta));
      setBuilderOperationEnhancementsByOperation(extractOperationEnhancements(rawMeta));
      setBuilderAppUiEnhancementsByApp(extractAppUiEnhancements(rawMeta));
      setBuilderInputExamplesByOperation(extractBuilderInputExamplesByOperation(rawMeta));
    })().catch(() => {
      if (!cancelled) {
        setBuilderStepActionsByStep({});
        setBuilderOperationEnhancementsByOperation({});
        setBuilderAppUiEnhancementsByApp({});
        setBuilderInputExamplesByOperation({});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [builderProtocolId, builderProtocolMetaPaths]);

  useEffect(() => {
    if (builderViewMode !== 'enduser') {
      return;
    }
    if (selectedBuilderAppStep) {
      if (builderOperationId !== selectedBuilderAppStep.operationId) {
        setBuilderOperationId(selectedBuilderAppStep.operationId);
      }
      return;
    }
    if (builderOperationId !== '') {
      setBuilderOperationId('');
    }
  }, [builderViewMode, selectedBuilderAppStep, builderOperationId]);

  useEffect(() => {
    if (!selectedBuilderApp) {
      return;
    }
    if (builderAppStepIndex < 0 || builderAppStepIndex >= selectedBuilderApp.steps.length) {
      setBuilderAppStepIndex(selectedBuilderAppEntryStepIndex);
    }
  }, [selectedBuilderApp, builderAppStepIndex, selectedBuilderAppEntryStepIndex]);

  useEffect(() => {
    if (!selectedBuilderOperation) {
      setBuilderInputValues({});
      return;
    }

    const resolveBuilderAppInputFrom = (
      value: unknown,
      contexts: Record<string, BuilderAppStepContext>,
    ): unknown => {
      if (typeof value === 'string' && value.startsWith('$')) {
        return readBuilderPath(
          {
            steps: contexts,
          },
          value,
        );
      }
      return value;
    };

    const nextValues = Object.fromEntries(
      Object.entries(selectedBuilderOperation.inputs).map(([inputName, spec]) => [
        inputName,
        spec.default === undefined ? '' : stringifyBuilderDefault(spec.default),
      ]),
    );

    if (builderViewMode === 'enduser' && selectedBuilderAppStep) {
      for (const [inputName, rawSource] of Object.entries(selectedBuilderAppStep.inputFrom)) {
        const resolved = resolveBuilderAppInputFrom(rawSource, builderAppStepContexts);
        if (resolved !== undefined) {
          nextValues[inputName] = stringifyBuilderDefault(resolved);
        }
      }
    }
    setBuilderInputValues(nextValues);
  }, [selectedBuilderOperation, builderViewMode, selectedBuilderAppStep, builderAppStepContexts]);

  function clearBuilderAppProgressFrom(startIndex: number) {
    if (!selectedBuilderApp) {
      return;
    }
    const stepIdsToClear = selectedBuilderApp.steps.slice(startIndex).map((step) => step.stepId);
    if (stepIdsToClear.length === 0) {
      return;
    }
    setBuilderAppStepContexts((prev) => {
      const next = { ...prev };
      for (const stepId of stepIdsToClear) {
        delete next[stepId];
      }
      return next;
    });
    setBuilderAppStepCompleted((prev) => {
      const next = { ...prev };
      for (const stepId of stepIdsToClear) {
        delete next[stepId];
      }
      return next;
    });
  }

  function canOpenBuilderAppStep(targetIndex: number): boolean {
    if (!selectedBuilderApp) {
      return false;
    }
    if (targetIndex < 0 || targetIndex >= selectedBuilderApp.steps.length) {
      return false;
    }
    const targetStep = selectedBuilderApp.steps[targetIndex];
    return isBuilderAppStepUnlocked(selectedBuilderApp, targetStep, builderAppStepContexts, builderAppStepCompleted);
  }

  function handleBuilderPrefillExample() {
    if (!selectedBuilderOperation) {
      return;
    }

    const built = buildExampleInputsForOperation(selectedBuilderOperation);
    const declaredExamples = builderInputExamplesByOperation[selectedBuilderOperation.operationId] ?? {};
    setBuilderInputValues({
      ...built,
      ...declaredExamples,
    });
    setBuilderStatusText(`Prefilled example inputs for ${builderProtocolId}/${selectedBuilderOperation.operationId}.`);
    setBuilderRawDetails(null);
    setBuilderShowRawDetails(false);
  }

  function handleBuilderModeEndUser() {
    setBuilderViewMode('enduser');
    const firstApp = builderApps[0];
    if (firstApp && firstApp.steps.length > 0) {
      setBuilderAppId(firstApp.appId);
      const entryIndex = firstApp.steps.findIndex((step) => step.stepId === firstApp.entryStepId);
      setBuilderAppStepIndex(entryIndex >= 0 ? entryIndex : 0);
      setBuilderAppStepContexts({});
      setBuilderAppStepCompleted({});
      const entryStep = firstApp.steps.find((step) => step.stepId === firstApp.entryStepId) ?? firstApp.steps[0];
      setBuilderOperationId(entryStep ? entryStep.operationId : '');
      return;
    }
    setBuilderOperationId('');
  }

  function handleBuilderModeGeek() {
    setBuilderViewMode('geek');
  }

  function handleBuilderProtocolSelect(nextProtocolId: string) {
    setBuilderProtocolId(nextProtocolId);
  }

  function handleBuilderAppSelect(app: MetaAppSummary) {
    setBuilderAppId(app.appId);
    const entryIndex = app.steps.findIndex((step) => step.stepId === app.entryStepId);
    setBuilderAppStepIndex(entryIndex >= 0 ? entryIndex : 0);
    setBuilderAppStepContexts({});
    setBuilderAppStepCompleted({});
    const entryStep = app.steps.find((step) => step.stepId === app.entryStepId) ?? app.steps[0];
    if (entryStep) {
      setBuilderOperationId(entryStep.operationId);
    }
  }

  function handleBuilderOperationSelect(nextOperationId: string) {
    setBuilderOperationId(nextOperationId);
  }

  function handleBuilderAppOpenStep(index: number) {
    if (!selectedBuilderApp || !canOpenBuilderAppStep(index)) {
      return;
    }
    const step = selectedBuilderApp.steps[index];
    setBuilderAppStepIndex(index);
    setBuilderOperationId(step.operationId);
  }

  function handleBuilderAppBackStep() {
    if (!selectedBuilderApp || builderAppStepIndex <= 0) {
      return;
    }
    const previousIndex = builderAppStepIndex - 1;
    const previousStep = selectedBuilderApp.steps[previousIndex];
    setBuilderAppStepIndex(previousIndex);
    setBuilderOperationId(previousStep.operationId);
  }

  function handleBuilderAppSelectItem(item: unknown) {
    if (!selectedBuilderAppStep || !selectedBuilderApp || !selectedBuilderAppSelectUi) {
      return;
    }
    clearBuilderAppProgressFrom(builderAppStepIndex + 1);
    const currentStepId = selectedBuilderAppStep.stepId;
    const bindPath = selectedBuilderAppSelectUi.bindTo;
    const currentContext = builderAppStepContexts[currentStepId];
    if (!currentContext) {
      setBuilderStatusText('Run this step first to populate selectable items.');
      setBuilderRawDetails(null);
      setBuilderShowRawDetails(false);
      return;
    }

    const nextContexts = {
      ...builderAppStepContexts,
      [currentStepId]: {
        ...currentContext,
        derived: writeBuilderPath({ ...currentContext.derived }, bindPath, item),
      },
    };
    setBuilderAppStepContexts(nextContexts);

    const stepCompleted = evaluateBuilderStepSuccess(selectedBuilderAppStep, nextContexts, true);
    const nextCompleted = {
      ...builderAppStepCompleted,
      [currentStepId]: stepCompleted,
    };
    setBuilderAppStepCompleted(nextCompleted);

    const selectedValue = readBuilderPath(item, selectedBuilderAppSelectUi.valuePath);
    const nextIndex = stepCompleted
      ? resolveBuilderNextStepIndexOnSuccess(selectedBuilderApp, selectedBuilderAppStep)
      : null;
    if (stepCompleted && nextIndex !== null) {
      const nextStep = selectedBuilderApp.steps[nextIndex];
      const nextUnlocked = isBuilderAppStepUnlocked(selectedBuilderApp, nextStep, nextContexts, nextCompleted);
      if (selectedBuilderAppSelectUi.autoAdvance && nextUnlocked) {
        setBuilderAppStepIndex(nextIndex);
        setBuilderOperationId(nextStep.operationId);
      }
      setBuilderStatusText(
        `Selected item: ${selectedValue === undefined ? 'n/a' : String(selectedValue)}. ${
          selectedBuilderAppSelectUi.autoAdvance && nextUnlocked
            ? `Continue on step ${nextIndex + 1}: ${nextStep.title}.`
            : 'Selection saved. Proceed to the next declared step.'
        }`,
      );
      setBuilderRawDetails(null);
      setBuilderShowRawDetails(false);
      return;
    }

    if (!stepCompleted) {
      setBuilderStatusText('Selection saved, but success criteria for this step are not satisfied yet.');
      setBuilderRawDetails(null);
      setBuilderShowRawDetails(false);
      return;
    }

    setBuilderStatusText(`Selected item: ${selectedValue === undefined ? 'n/a' : String(selectedValue)}.`);
    setBuilderRawDetails(null);
    setBuilderShowRawDetails(false);
  }

  function handleBuilderAppResetCurrentStep() {
    if (!selectedBuilderApp) {
      return;
    }
    clearBuilderAppProgressFrom(builderAppStepIndex);
    setBuilderStatusText('Step reset. Adjust inputs and run again.');
    setBuilderRawDetails(null);
    setBuilderShowRawDetails(false);
  }

  function handleBuilderInputChange(inputName: string, value: string) {
    setBuilderInputValues((prev) => ({
      ...prev,
      [inputName]: value,
    }));
  }

  function handleBuilderToggleRawDetails() {
    setBuilderShowRawDetails((current) => !current);
  }

  function setBuilderResult(lines: string[], raw?: unknown) {
    setBuilderStatusText(lines.join('\n'));
    setBuilderRawDetails(raw === undefined ? null : asPrettyJson(raw));
    setBuilderShowRawDetails(false);
  }

  function applyBuilderAppStepResult(options: {
    executionInput: Record<string, unknown>;
    prepared: BuilderPreparedStepResult;
    operationSucceeded: boolean;
  }): boolean {
    if (builderViewMode !== 'enduser' || !selectedBuilderAppStep) {
      return options.operationSucceeded;
    }
    const nextContexts = {
      ...builderAppStepContexts,
      [selectedBuilderAppStep.stepId]: {
        input: options.executionInput,
        derived: options.prepared.derived,
        args: options.prepared.args,
        accounts: options.prepared.accounts,
        instructionName: options.prepared.instructionName,
      },
    };
    setBuilderAppStepContexts(nextContexts);
    const completed = evaluateBuilderStepSuccess(selectedBuilderAppStep, nextContexts, options.operationSucceeded);
    setBuilderAppStepCompleted((prev) => ({
      ...prev,
      [selectedBuilderAppStep.stepId]: completed,
    }));
    return completed;
  }

  return {
    builderProtocols,
    builderProtocolLabelsById,
    builderProtocolId,
    builderApps,
    builderAppId,
    builderAppStepIndex,
    builderAppStepContexts,
    setBuilderAppStepContexts,
    builderAppStepCompleted,
    setBuilderAppStepCompleted,
    builderOperations,
    builderOperationId,
    builderViewMode,
    builderInputValues,
    builderSimulate,
    setBuilderSimulate,
    builderAppSubmitMode,
    setBuilderAppSubmitMode,
    builderStatusText,
    setBuilderStatusText,
    builderRawDetails,
    setBuilderRawDetails,
    builderShowRawDetails,
    setBuilderShowRawDetails,
    selectedBuilderApp,
    selectedBuilderAppStep,
    selectedBuilderAppSelectUi,
    selectedBuilderAppSelectableItems,
    selectedBuilderSelectedItemValue,
    selectedBuilderStepActions,
    selectedBuilderOperationEnhancement,
    builderOperationLabelsByOperationId,
    builderAppLabelsByAppId,
    builderStepLabelsByAppStepKey,
    selectedBuilderOperation,
    isBuilderAppMode,
    visibleBuilderInputs,
    hiddenBuilderInputsCount,
    showBuilderSelectableItems,
    canOpenBuilderAppStep,
    clearBuilderAppProgressFrom,
    setBuilderResult,
    applyBuilderAppStepResult,
    handleBuilderPrefillExample,
    handleBuilderModeEndUser,
    handleBuilderModeGeek,
    handleBuilderProtocolSelect,
    handleBuilderAppSelect,
    handleBuilderOperationSelect,
    handleBuilderAppOpenStep,
    handleBuilderAppBackStep,
    handleBuilderAppSelectItem,
    handleBuilderAppResetCurrentStep,
    handleBuilderInputChange,
    handleBuilderToggleRawDetails,
  };
}
