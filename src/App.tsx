import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { createCloseAccountInstruction } from '@solana/spl-token';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import './App.css';
import { listSupportedTokens } from './constants/tokens';
import {
  parseCommand,
  type MetaRunCommand,
  type ViewRunCommand,
} from './app/commandParser';
import {
  decodeIdlAccount,
  getInstructionTemplate,
  listIdlProtocols,
  sendIdlInstruction,
  simulateIdlInstruction,
} from '@agentform/apppack-runtime/idlDeclarativeRuntime';
import {
  explainMetaOperation,
  listMetaApps,
  listMetaOperations,
  prepareMetaOperation,
  type MetaAppSummary,
  type MetaOperationSummary,
} from '@agentform/apppack-runtime/metaIdlRuntime';
import {
  asPrettyJson,
  buildDerivedFromReadOutputSource,
  buildExampleInputsForOperation,
  buildReadOnlyHighlightsFromSpec,
  evaluateBuilderStepSuccess,
  isBuilderAppStepUnlocked,
  parseBuilderInputValue,
  readBuilderPath,
  renderMetaExplain,
  resolveBuilderNextStepIndexOnSuccess,
  stringifyBuilderDefault,
  writeBuilderPath,
  type BuilderAppStepContext,
} from './app/builderHelpers';
import { BuilderTab } from './app/components/BuilderTab';
import { CommandTab, type CommandMessage } from './app/components/CommandTab';

const DEFAULT_VIEW_API_BASE_URL = 'https://apppack-view-service.onrender.com';
const VIEW_API_BASE_URL = String(import.meta.env.VITE_VIEW_API_BASE_URL ?? DEFAULT_VIEW_API_BASE_URL)
  .trim()
  .replace(/\/+$/, '');
const QUICK_PREFILL_META_RUN_COMMAND =
  '/meta-run orca-whirlpool-mainnet swap_exact_in {"token_in_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","token_out_mint":"So11111111111111111111111111111111111111112","amount_in":"10000","slippage_bps":50,"estimated_out":"100000","whirlpool":"Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE","unwrap_sol_output":true} --simulate';

type Message = CommandMessage;

type AppTab = 'command' | 'builder';

type BuilderProtocol = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
};

type BuilderViewMode = 'enduser' | 'geek';

type BuilderApp = MetaAppSummary;

type BuilderPreparedStepResult = {
  derived: Record<string, unknown>;
  args: Record<string, unknown>;
  accounts: Record<string, string>;
  instructionName: string | null;
};

type RemoteViewRunResponse = {
  ok: boolean;
  protocol?: string;
  operation?: string;
  items?: unknown[];
  query?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  error?: string;
};

const HELP_TEXT = [
  'Commands:',
  '/meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> [--simulate|--send]',
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
  'Use /meta-run for protocol-agnostic operation execution from MetaIDL.',
  `Pool discovery runs through View API (${DEFAULT_VIEW_API_BASE_URL}) with no local fallback.`,
  'Use --simulate first, then --send with same input for deterministic execution.',
  '',
  'Examples:',
  '/meta-run orca-whirlpool-mainnet swap_exact_in {"token_in_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","token_out_mint":"So11111111111111111111111111111111111111112","amount_in":"10000","slippage_bps":50,"estimated_out":"100000","whirlpool":"Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE","unwrap_sol_output":true} --simulate',
  '/meta-run orca-whirlpool-mainnet swap_exact_in {"token_in_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","token_out_mint":"So11111111111111111111111111111111111111112","amount_in":"10000","slippage_bps":50,"estimated_out":"100000","whirlpool":"Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE","unwrap_sol_output":true} --send',
  '/meta-explain orca-whirlpool-mainnet swap_exact_in',
  '/meta-explain orca-whirlpool-mainnet list_pools',
  '/meta-explain pump-amm-mainnet buy',
  '/meta-explain pump-core-mainnet buy_exact_sol_in',
  '/meta-explain kamino-klend-mainnet deposit_reserve_liquidity',
  '/meta-explain kamino-klend-mainnet redeem_reserve_collateral',
  '/view-run orca-whirlpool-mainnet list_pools {"token_in_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","token_out_mint":"So11111111111111111111111111111111111111112"}',
].join('\n');

function App() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'assistant',
      text: 'AppPack ready. Use /help to see commands.',
    },
  ]);
  const [activeTab, setActiveTab] = useState<AppTab>('builder');
  const [commandInput, setCommandInput] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [builderProtocols, setBuilderProtocols] = useState<BuilderProtocol[]>([]);
  const [builderProtocolId, setBuilderProtocolId] = useState('');
  const [builderApps, setBuilderApps] = useState<BuilderApp[]>([]);
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

  const supportedTokens = useMemo(
    () => listSupportedTokens().map((token) => `${token.symbol} (${token.mint})`).join(', '),
    [],
  );
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
  const visibleBuilderInputs = useMemo(() => {
    if (!selectedBuilderOperation) {
      return [] as Array<[string, MetaOperationSummary['inputs'][string]]>;
    }

    return Object.entries(selectedBuilderOperation.inputs).filter(([, spec]) => {
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
  }, [selectedBuilderOperation, builderViewMode]);
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
        const firstApp = appsView.apps[0];
        const entryStep = firstApp
          ? firstApp.steps.find((step) => step.stepId === firstApp.entryStepId) ?? firstApp.steps[0]
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

  function pushMessage(role: 'user' | 'assistant', text: string) {
    setMessages((prev) => [...prev, { id: prev.length + 1, role, text }]);
  }

  function handleBuilderPrefillExample() {
    if (!selectedBuilderOperation) {
      return;
    }

    setBuilderInputValues(buildExampleInputsForOperation(selectedBuilderOperation));
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

  function handleBuilderAppSelect(app: BuilderApp) {
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

  async function runRemoteViewRun(options: {
    protocolId: string;
    operationId: string;
    input: Record<string, unknown>;
    limit?: number;
  }): Promise<RemoteViewRunResponse> {
    if (!VIEW_API_BASE_URL) {
      throw new Error('View API base URL is not configured (VITE_VIEW_API_BASE_URL).');
    }

    let response: Response;
    try {
      response = await fetch(`${VIEW_API_BASE_URL}/view-run`, {
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
        `Failed to reach View API at ${VIEW_API_BASE_URL}. Check service uptime and CORS preflight configuration for /view-run.`,
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

  function buildBuilderPreInstructions(): TransactionInstruction[] {
    // UI stays protocol-agnostic: no protocol/account-name heuristics here.
    // Pre-instructions must come from declarative runtime/meta flow.
    return [];
  }

  async function executeMetaRun(options: {
    value: MetaRunCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to execute MetaIDL operations.');
    }

    const prepared = await prepareMetaOperation({
      protocolId: options.value.protocolId,
      operationId: options.value.operationId,
      input: options.value.input,
      connection,
      walletPublicKey: wallet.publicKey,
    });

    if (!prepared.instructionName) {
      pushMessage(
        'assistant',
        [
          `Meta run (${options.value.protocolId}/${options.value.operationId}):`,
          'Read-only operation (no instruction to execute).',
          '',
          asPrettyJson({
            input: options.value.input,
            derived: prepared.derived,
            args: prepared.args,
            accounts: prepared.accounts,
          }),
        ].join('\n'),
      );
      return;
    }

    const preInstructions = buildBuilderPreInstructions();
    const postInstructions = buildMetaPostInstructions(prepared.postInstructions);

    if (options.value.simulate) {
      const simulation = await simulateIdlInstruction({
        protocolId: prepared.protocolId,
        instructionName: prepared.instructionName,
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
          `Meta simulate (${options.value.protocolId}/${options.value.operationId}):`,
          `instruction: ${prepared.instructionName}`,
          `status: ${simulation.ok ? 'success' : 'failed'}`,
          `units: ${simulation.unitsConsumed ?? 'n/a'}`,
          `error: ${simulation.error ?? 'none'}`,
          '',
          asPrettyJson({
            input: options.value.input,
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
      instructionName: prepared.instructionName,
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
        `Meta tx sent (${options.value.protocolId}/${options.value.operationId}):`,
        `instruction: ${prepared.instructionName}`,
        sent.signature,
        sent.explorerUrl,
      ].join('\n'),
    );
  }

  async function executeViewRun(options: {
    value: ViewRunCommand;
  }): Promise<void> {
    const response = await runRemoteViewRun({
      protocolId: options.value.protocolId,
      operationId: options.value.operationId,
      input: options.value.input,
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
        `View run (${options.value.protocolId}/${options.value.operationId}):`,
        ...(highlights.length > 0 ? highlights : ['No data returned.']),
        '',
        'Raw JSON:',
        asPrettyJson({
          input: options.value.input,
          output: response,
        }),
      ].join('\n'),
    );
  }

  async function handleBuilderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!builderProtocolId || !selectedBuilderOperation) {
      setBuilderStatusText('Error: Select a protocol and an operation first.');
      setBuilderRawDetails(null);
      return;
    }

    const isReadOnlyOperation = !selectedBuilderOperation.instruction;
    if (!wallet.publicKey && !isReadOnlyOperation) {
      setBuilderStatusText('Error: Connect wallet first.');
      setBuilderRawDetails(null);
      return;
    }
    const walletPublicKey = wallet.publicKey;

    setIsWorking(true);
    setBuilderStatusText(null);
    setBuilderRawDetails(null);
    setBuilderShowRawDetails(false);

    if (builderViewMode === 'enduser' && selectedBuilderAppStep && selectedBuilderApp) {
      clearBuilderAppProgressFrom(builderAppStepIndex);
      setBuilderAppStepCompleted((prev) => ({
        ...prev,
        [selectedBuilderAppStep.stepId]: false,
      }));
    }

    try {
      const inputPayload: Record<string, unknown> = {};
      for (const [inputName, spec] of Object.entries(selectedBuilderOperation.inputs)) {
        const rawValue = builderInputValues[inputName] ?? '';
        if (!rawValue.trim()) {
          const hasDefault = spec.default !== undefined;
          const hasDiscoverFrom = typeof spec.discover_from === 'string' && spec.discover_from.length > 0;
          if (spec.required && !hasDefault && !hasDiscoverFrom) {
            throw new Error(`Missing required input ${inputName}.`);
          }
          continue;
        }

        inputPayload[inputName] = parseBuilderInputValue(rawValue, spec.type, `input ${inputName}`);
      }

      const executionInput = { ...inputPayload };
      if (isReadOnlyOperation) {
        if (!selectedBuilderOperation.readOutput) {
          throw new Error(
            `Read-only operation ${builderProtocolId}/${selectedBuilderOperation.operationId} is missing read_output in Meta IDL.`,
          );
        }

        const response = await runRemoteViewRun({
          protocolId: builderProtocolId,
          operationId: selectedBuilderOperation.operationId,
          input: executionInput,
          limit: 20,
        });

        const remoteItems = response.items ?? [];
        const derived = buildDerivedFromReadOutputSource(selectedBuilderOperation.readOutput.source, remoteItems);
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
        const readValue = readBuilderPath(readScope, selectedBuilderOperation.readOutput.source);
        if (readValue === undefined) {
          throw new Error(
            `read_output.source ${selectedBuilderOperation.readOutput.source} did not resolve for ${builderProtocolId}/${selectedBuilderOperation.operationId}.`,
          );
        }

        const readOnlyHighlights = buildReadOnlyHighlightsFromSpec(selectedBuilderOperation.readOutput, readValue);
        const resultLines = [
          `Builder result (${builderProtocolId}/${selectedBuilderOperation.operationId}):`,
          'Read-only operation (view API).',
          ...(readOnlyHighlights.length > 0 ? readOnlyHighlights : []),
        ];
        setBuilderResult(resultLines, {
          input: executionInput,
          viewApi: {
            baseUrl: VIEW_API_BASE_URL,
            protocolId: builderProtocolId,
            operationId: selectedBuilderOperation.operationId,
          },
          readOutput: selectedBuilderOperation.readOutput,
          readOutputValue: readValue,
          response,
          derived: preparedReadOnly.derived,
          args: preparedReadOnly.args,
          accounts: preparedReadOnly.accounts,
        });
        applyBuilderAppStepResult({
          executionInput,
          prepared: preparedReadOnly,
          operationSucceeded: true,
        });
        pushMessage('assistant', resultLines.join('\n'));
        return;
      }

      const prepared = await prepareMetaOperation({
        protocolId: builderProtocolId,
        operationId: selectedBuilderOperation.operationId,
        input: executionInput,
        connection,
        walletPublicKey: walletPublicKey as PublicKey,
      });
      const builderNotes: string[] = [];

      if (!prepared.instructionName) {
        if (!selectedBuilderOperation.readOutput) {
          throw new Error(
            `Read-only operation ${builderProtocolId}/${selectedBuilderOperation.operationId} is missing read_output in Meta IDL.`,
          );
        }
        const readScope = {
          input: executionInput,
          args: prepared.args,
          accounts: prepared.accounts,
          derived: prepared.derived,
        };
        const readValue = readBuilderPath(readScope, selectedBuilderOperation.readOutput.source);
        if (readValue === undefined) {
          throw new Error(
            `read_output.source ${selectedBuilderOperation.readOutput.source} did not resolve for ${builderProtocolId}/${selectedBuilderOperation.operationId}.`,
          );
        }
        const readOnlyHighlights = buildReadOnlyHighlightsFromSpec(selectedBuilderOperation.readOutput, readValue);
        const resultLines = [
          `Builder result (${builderProtocolId}/${selectedBuilderOperation.operationId}):`,
          'Read-only operation (no instruction to execute).',
          ...(readOnlyHighlights.length > 0 ? readOnlyHighlights : []),
        ];
        setBuilderResult(resultLines, {
          input: executionInput,
          notes: builderNotes,
          readOutput: selectedBuilderOperation.readOutput,
          readOutputValue: readValue,
          derived: prepared.derived,
          args: prepared.args,
          accounts: prepared.accounts,
        });
        applyBuilderAppStepResult({
          executionInput,
          prepared,
          operationSucceeded: true,
        });
        pushMessage('assistant', resultLines.join('\n'));
        return;
      }

      const preInstructions = buildBuilderPreInstructions();
      const postInstructions = buildMetaPostInstructions(prepared.postInstructions);
      const runAsSimulation = isBuilderAppMode ? builderAppSubmitMode === 'simulate' : builderSimulate;

      if (runAsSimulation) {
        const simulation = await simulateIdlInstruction({
          protocolId: prepared.protocolId,
          instructionName: prepared.instructionName,
          args: prepared.args,
          accounts: prepared.accounts,
          remainingAccounts: prepared.remainingAccounts,
          preInstructions,
          postInstructions,
          connection,
          wallet,
        });

        const simulationHighlights: string[] = [];

        const resultLines = [
          `Builder simulate (${builderProtocolId}/${selectedBuilderOperation.operationId}):`,
          `instruction: ${prepared.instructionName}`,
          `status: ${simulation.ok ? 'success' : 'failed'}`,
          `units: ${simulation.unitsConsumed ?? 'n/a'}`,
          ...(simulationHighlights.length > 0 ? simulationHighlights : []),
          ...(builderNotes.length > 0 ? builderNotes : []),
          `error: ${simulation.error ?? 'none'}`,
          ...(simulation.ok
            ? [
                isBuilderAppMode
                  ? 'next: click Send Transaction when ready.'
                  : 'next: disable simulate and click Send Transaction.',
              ]
            : []),
        ];
        setBuilderResult(resultLines, {
          input: executionInput,
          notes: builderNotes,
          args: prepared.args,
          accounts: prepared.accounts,
          logs: simulation.logs,
        });
        if (simulation.ok) {
          applyBuilderAppStepResult({
            executionInput,
            prepared,
            operationSucceeded: true,
          });
        }
        pushMessage('assistant', resultLines.join('\n'));
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
        connection,
        wallet,
      });

      const resultLines = [
        `Builder tx sent (${builderProtocolId}/${selectedBuilderOperation.operationId}):`,
        `instruction: ${prepared.instructionName}`,
        ...(builderNotes.length > 0 ? builderNotes : []),
        `signature: ${sent.signature}`,
        `explorer: ${sent.explorerUrl}`,
      ];
      setBuilderResult(resultLines);
      applyBuilderAppStepResult({
        executionInput,
        prepared,
        operationSucceeded: true,
      });
      pushMessage('assistant', resultLines.join('\n'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown builder error.';
      const text = `Error: ${message}`;
      setBuilderStatusText(text);
      setBuilderRawDetails(null);
      setBuilderShowRawDetails(false);
      pushMessage('assistant', text);
    } finally {
      setIsWorking(false);
    }
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
        pushMessage('assistant', `${HELP_TEXT}\n\nSupported tokens: ${supportedTokens}`);
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
        await executeMetaRun({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'view-run') {
        await executeViewRun({
          value: parsed.value,
        });
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
        return;
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error while handling command.';
      pushMessage('assistant', `Error: ${message}`);
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card-shell">
        <header className="card-header">
          <div>
            <h1>AppPack — AI Compatible by Design</h1>
            <p>Define once, execute everywhere: AppPack turns protocol specs into deterministic, verifiable on-chain read and transaction flows, so users and AI agents can discover options, simulate outcomes, and execute safely without external SDK lock-in, custom API glue, or fragile wallet-connection UX.</p>
          </div>
          <WalletMultiButton />
        </header>

        <div className="tab-switcher" role="tablist" aria-label="Mode">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'builder'}
            className={activeTab === 'builder' ? 'active' : ''}
            onClick={() => setActiveTab('builder')}
          >
            Forms
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'command'}
            className={activeTab === 'command' ? 'active' : ''}
            onClick={() => setActiveTab('command')}
          >
            Command
          </button>
        </div>

        {activeTab === 'command' ? (
          <CommandTab
            messages={messages}
            isWorking={isWorking}
            commandInput={commandInput}
            onCommandInputChange={setCommandInput}
            onSubmit={handleCommandSubmit}
            onPrefillMetaRun={() => setCommandInput(QUICK_PREFILL_META_RUN_COMMAND)}
          />
        ) : (
          <BuilderTab
            isWorking={isWorking}
            builderViewMode={builderViewMode}
            onModeEndUser={handleBuilderModeEndUser}
            onModeGeek={handleBuilderModeGeek}
            builderProtocols={builderProtocols}
            builderProtocolId={builderProtocolId}
            onSelectProtocol={handleBuilderProtocolSelect}
            builderApps={builderApps}
            builderAppId={builderAppId}
            onSelectApp={handleBuilderAppSelect}
            builderOperations={builderOperations}
            builderOperationId={builderOperationId}
            onSelectOperation={handleBuilderOperationSelect}
            selectedBuilderOperation={selectedBuilderOperation}
            selectedBuilderApp={selectedBuilderApp}
            selectedBuilderAppStep={selectedBuilderAppStep}
            builderAppStepIndex={builderAppStepIndex}
            canOpenBuilderAppStep={canOpenBuilderAppStep}
            onOpenBuilderAppStep={handleBuilderAppOpenStep}
            showBuilderSelectableItems={showBuilderSelectableItems}
            onBackStep={handleBuilderAppBackStep}
            onResetStep={handleBuilderAppResetCurrentStep}
            selectedBuilderAppSelectUi={selectedBuilderAppSelectUi}
            selectedBuilderAppSelectableItems={selectedBuilderAppSelectableItems}
            selectedBuilderSelectedItemValue={selectedBuilderSelectedItemValue}
            onSelectItem={handleBuilderAppSelectItem}
            hiddenBuilderInputsCount={hiddenBuilderInputsCount}
            visibleBuilderInputs={visibleBuilderInputs}
            builderInputValues={builderInputValues}
            onInputChange={handleBuilderInputChange}
            onPrefillExample={handleBuilderPrefillExample}
            isBuilderAppMode={isBuilderAppMode}
            builderAppSubmitMode={builderAppSubmitMode}
            onSetBuilderAppSubmitMode={setBuilderAppSubmitMode}
            builderSimulate={builderSimulate}
            onSetBuilderSimulate={setBuilderSimulate}
            onSubmit={handleBuilderSubmit}
            builderStatusText={builderStatusText}
            builderRawDetails={builderRawDetails}
            builderShowRawDetails={builderShowRawDetails}
            onToggleRawDetails={handleBuilderToggleRawDetails}
          />
        )}
      </section>
    </main>
  );
}

export default App;
