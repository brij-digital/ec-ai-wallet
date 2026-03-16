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
  findBuilderAppStepIndexById,
  stringifyBuilderDefault,
  writeBuilderPath,
  type BuilderAppStepContext,
} from './builderHelpers';
import type { OperationEnhancement } from './metaEnhancements';

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

type BuilderStepStatus = 'idle' | 'running' | 'success' | 'error';

type BuilderStepStatusTextTemplates = {
  idle?: string;
  running?: string;
  success?: string;
  error?: string;
};

type BuilderStepFlow = {
  nextOnSuccess?: string;
  nextOnError?: string;
  statusText: BuilderStepStatusTextTemplates;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractBuilderInputExamplesByOperation(
  operations: MetaOperationSummary[],
): Record<string, Record<string, string>> {
  const output: Record<string, Record<string, string>> = {};
  for (const operation of operations) {
    const examples: Record<string, string> = {};
    for (const [inputName, inputSpec] of Object.entries(operation.inputs)) {
      const inputSpecRecord = inputSpec as unknown as Record<string, unknown>;
      if (inputSpecRecord.ui_example !== undefined) {
        examples[inputName] = stringifyBuilderDefault(inputSpecRecord.ui_example);
        continue;
      }
      if (inputSpecRecord.example !== undefined) {
        examples[inputName] = stringifyBuilderDefault(inputSpecRecord.example);
      }
    }

    if (Object.keys(examples).length > 0) {
      output[operation.operationId] = examples;
    }
  }

  return output;
}

function parseBuilderStepFlow(step: MetaAppSummary['steps'][number] | null): BuilderStepFlow {
  if (!step) {
    return { statusText: {} };
  }
  const rawStatus = asRecord(step.statusText ?? null);
  const statusText: BuilderStepStatusTextTemplates = {
    ...(rawStatus && typeof rawStatus.idle === 'string' && rawStatus.idle.trim().length > 0
      ? { idle: rawStatus.idle.trim() }
      : {}),
    ...(rawStatus && typeof rawStatus.running === 'string' && rawStatus.running.trim().length > 0
      ? { running: rawStatus.running.trim() }
      : {}),
    ...(rawStatus && typeof rawStatus.success === 'string' && rawStatus.success.trim().length > 0
      ? { success: rawStatus.success.trim() }
      : {}),
    ...(rawStatus && typeof rawStatus.error === 'string' && rawStatus.error.trim().length > 0
      ? { error: rawStatus.error.trim() }
      : {}),
  };
  return {
    ...(step.nextOnSuccess ? { nextOnSuccess: step.nextOnSuccess } : {}),
    ...(step.nextOnError ? { nextOnError: step.nextOnError } : {}),
    statusText,
  };
}

function normalizeBuilderStepActions(step: MetaAppSummary['steps'][number] | null): BuilderStepAction[] {
  if (!step || !Array.isArray(step.actions)) {
    return [];
  }
  return step.actions.map((action) => ({
    actionId: action.actionId,
    kind: action.kind,
    label: action.label,
    ...(action.mode ? { mode: action.mode } : {}),
    variant: action.variant,
  }));
}

function renderBuilderStepStatusTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

function buildOperationEnhancementsByOperation(
  operations: MetaOperationSummary[],
): Record<string, OperationEnhancement> {
  const output: Record<string, OperationEnhancement> = {};
  for (const operation of operations) {
    const operationRecord = operation as unknown as Record<string, unknown>;
    const operationLabel =
      typeof operationRecord.label === 'string' && operationRecord.label.trim().length > 0
        ? operationRecord.label.trim()
        : operation.operationId;
    const inputUi: OperationEnhancement['inputUi'] = {};
    const inputValidation: OperationEnhancement['inputValidation'] = {};

    for (const [inputName, inputSpec] of Object.entries(operation.inputs)) {
      const inputSpecRecord = inputSpec as unknown as Record<string, unknown>;
      const inputLabel =
        typeof inputSpecRecord.label === 'string' && inputSpecRecord.label.trim().length > 0
          ? inputSpecRecord.label.trim()
          : inputName;
      inputUi[inputName] = {
        label: inputLabel,
        ...(typeof inputSpecRecord.placeholder === 'string' && inputSpecRecord.placeholder.trim().length > 0
          ? { placeholder: inputSpecRecord.placeholder.trim() }
          : {}),
        ...(typeof inputSpecRecord.help === 'string' && inputSpecRecord.help.trim().length > 0
          ? { help: inputSpecRecord.help.trim() }
          : {}),
        ...(typeof inputSpecRecord.group === 'string' && inputSpecRecord.group.trim().length > 0
          ? { group: inputSpecRecord.group.trim() }
          : {}),
        ...(typeof inputSpecRecord.display_order === 'number' && Number.isFinite(inputSpecRecord.display_order)
          ? { displayOrder: inputSpecRecord.display_order }
          : {}),
      };
      const validate =
        inputSpecRecord.validate && typeof inputSpecRecord.validate === 'object' && !Array.isArray(inputSpecRecord.validate)
          ? (inputSpecRecord.validate as Record<string, unknown>)
          : null;
      inputValidation[inputName] = {
        ...(validate && typeof validate.required === 'boolean' ? { required: validate.required } : {}),
        ...(validate && (typeof validate.min === 'string' || typeof validate.min === 'number')
          ? { min: validate.min }
          : {}),
        ...(validate && (typeof validate.max === 'string' || typeof validate.max === 'number')
          ? { max: validate.max }
          : {}),
        ...(validate && typeof validate.pattern === 'string' && validate.pattern.trim().length > 0
          ? { pattern: validate.pattern.trim() }
          : {}),
        ...(validate && typeof validate.message === 'string' && validate.message.trim().length > 0
          ? { message: validate.message.trim() }
          : {}),
      };
    }

    const crossValidationRaw = Array.isArray(operationRecord.crossValidation)
      ? operationRecord.crossValidation
      : [];
    const crossValidation = crossValidationRaw
      .map((rule) => (rule && typeof rule === 'object' && !Array.isArray(rule) ? (rule as Record<string, unknown>) : null))
      .filter((rule): rule is Record<string, unknown> => rule !== null)
      .filter((rule) => rule.kind === 'not_equal')
      .map((rule) => ({
        kind: 'not_equal' as const,
        left: String(rule.left ?? ''),
        right: String(rule.right ?? ''),
        ...(typeof rule.message === 'string' && rule.message.trim().length > 0
          ? { message: rule.message.trim() }
          : {}),
      }))
      .filter((rule) => rule.left.length > 0 && rule.right.length > 0);

    output[operation.operationId] = {
      label: operationLabel,
      inputUi,
      inputValidation,
      crossValidation,
    };
  }
  return output;
}

export function useBuilderController() {
  const [builderProtocols, setBuilderProtocols] = useState<BuilderProtocol[]>([]);
  const [builderProtocolLabelsById, setBuilderProtocolLabelsById] = useState<Record<string, string>>({});
  const [builderProtocolId, setBuilderProtocolId] = useState('');
  const [builderApps, setBuilderApps] = useState<MetaAppSummary[]>([]);
  const [builderOperationEnhancementsByOperation, setBuilderOperationEnhancementsByOperation] = useState<
    Record<string, OperationEnhancement>
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
    if (!selectedBuilderAppStep) {
      return [] as BuilderStepAction[];
    }
    return normalizeBuilderStepActions(selectedBuilderAppStep);
  }, [selectedBuilderAppStep]);
  const selectedBuilderStepFlow = useMemo(() => {
    if (!selectedBuilderAppStep) {
      return null;
    }
    return parseBuilderStepFlow(selectedBuilderAppStep);
  }, [selectedBuilderAppStep]);
  const builderOperationLabelsByOperationId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(builderOperationEnhancementsByOperation).map(([operationId, enhancement]) => [
          operationId,
          enhancement.label,
        ]),
      ),
    [builderOperationEnhancementsByOperation],
  );
  const builderAppLabelsByAppId = useMemo(
    () =>
      Object.fromEntries(
        builderApps.map((app) => [app.appId, app.label]),
      ),
    [builderApps],
  );
  const builderStepLabelsByAppStepKey = useMemo(() => {
    const output: Record<string, string> = {};
    for (const app of builderApps) {
      for (const step of app.steps) {
        if (typeof step.label === 'string' && step.label.length > 0) {
          output[`${app.appId}:${step.stepId}`] = step.label;
        }
      }
    }
    return output;
  }, [builderApps]);
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
      const idlRegistryView = await listIdlProtocols();
      const protocols = idlRegistryView.protocols.map((protocol) => ({
        id: protocol.id,
        name: protocol.name,
        status: protocol.status,
      }));

      if (cancelled) {
        return;
      }

      setBuilderProtocols(protocols);
      setBuilderProtocolLabelsById(
        Object.fromEntries(idlRegistryView.protocols.map((protocol) => [protocol.id, protocol.name])),
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
      setBuilderOperationEnhancementsByOperation({});
      setBuilderInputExamplesByOperation({});
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
      setBuilderOperationEnhancementsByOperation(
        buildOperationEnhancementsByOperation(operationsView.operations),
      );
      setBuilderInputExamplesByOperation(
        extractBuilderInputExamplesByOperation(operationsView.operations),
      );
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
        setBuilderOperationEnhancementsByOperation({});
        setBuilderInputExamplesByOperation({});
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

  function getBuilderStepStatusText(
    status: BuilderStepStatus,
    fallbackText: string,
    options?: {
      nextStepTitle?: string;
      error?: string;
    },
  ): string {
    if (!selectedBuilderAppStep) {
      return fallbackText;
    }
    const template = selectedBuilderStepFlow?.statusText?.[status];
    if (!template) {
      return fallbackText;
    }
    const values: Record<string, string> = {
      step_id: selectedBuilderAppStep.stepId,
      step_title: selectedBuilderAppStep.title,
      ...(options?.nextStepTitle ? { next_step_title: options.nextStepTitle } : {}),
      ...(options?.error ? { error: options.error } : {}),
    };
    return renderBuilderStepStatusTemplate(template, values);
  }

  function resolveBuilderNextStepIndexByOutcome(
    outcome: 'success' | 'error',
  ): number | null {
    if (!selectedBuilderApp || !selectedBuilderAppStep) {
      return null;
    }
    const targetStepId = outcome === 'success'
      ? selectedBuilderStepFlow?.nextOnSuccess
      : selectedBuilderStepFlow?.nextOnError;
    if (!targetStepId) {
      return null;
    }
    const index = findBuilderAppStepIndexById(selectedBuilderApp, targetStepId);
    return index >= 0 ? index : null;
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
    const nextIndex = stepCompleted ? resolveBuilderNextStepIndexByOutcome('success') : null;
    if (stepCompleted && nextIndex !== null) {
      const nextStep = selectedBuilderApp.steps[nextIndex];
      const nextUnlocked = isBuilderAppStepUnlocked(selectedBuilderApp, nextStep, nextContexts, nextCompleted);
      if (selectedBuilderAppSelectUi.autoAdvance && nextUnlocked) {
        setBuilderAppStepIndex(nextIndex);
        setBuilderOperationId(nextStep.operationId);
      }
      setBuilderStatusText(
        getBuilderStepStatusText('success', `Selected item: ${selectedValue === undefined ? 'n/a' : String(selectedValue)}. ${
          selectedBuilderAppSelectUi.autoAdvance && nextUnlocked
            ? `Continue on step ${nextIndex + 1}: ${nextStep.title}.`
            : 'Selection saved. Proceed to the next declared step.'
        }`, { nextStepTitle: nextStep.title }),
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
    prepared?: BuilderPreparedStepResult;
    operationSucceeded: boolean;
    errorMessage?: string;
  }): boolean {
    if (builderViewMode !== 'enduser' || !selectedBuilderAppStep) {
      return options.operationSucceeded;
    }
    const previousContext = builderAppStepContexts[selectedBuilderAppStep.stepId];
    const nextContexts = {
      ...builderAppStepContexts,
      [selectedBuilderAppStep.stepId]: {
        input: options.executionInput,
        derived: options.prepared?.derived ?? previousContext?.derived ?? {},
        args: options.prepared?.args ?? previousContext?.args ?? {},
        accounts: options.prepared?.accounts ?? previousContext?.accounts ?? {},
        instructionName: options.prepared?.instructionName ?? previousContext?.instructionName ?? null,
      },
    };
    setBuilderAppStepContexts(nextContexts);
    const completed = evaluateBuilderStepSuccess(selectedBuilderAppStep, nextContexts, options.operationSucceeded);
    const nextCompleted = {
      ...builderAppStepCompleted,
      [selectedBuilderAppStep.stepId]: completed,
    };
    setBuilderAppStepCompleted((prev) => ({
      ...prev,
      [selectedBuilderAppStep.stepId]: completed,
    }));
    const outcome: 'success' | 'error' = options.operationSucceeded && completed ? 'success' : 'error';
    const nextIndex = resolveBuilderNextStepIndexByOutcome(outcome);
    if (nextIndex !== null && selectedBuilderApp) {
      const nextStep = selectedBuilderApp.steps[nextIndex];
      const nextUnlocked = isBuilderAppStepUnlocked(selectedBuilderApp, nextStep, nextContexts, nextCompleted);
      if (nextUnlocked) {
        setBuilderAppStepIndex(nextIndex);
        setBuilderOperationId(nextStep.operationId);
      }
    }
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
    selectedBuilderStepFlow,
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
    getBuilderStepStatusText,
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
