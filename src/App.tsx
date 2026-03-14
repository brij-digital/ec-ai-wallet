import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import Decimal from 'decimal.js';
import './App.css';
import { formatTokenAmount, listSupportedTokens, parseUiAmountToAtomic, resolveToken } from './constants/tokens';
import {
  parseCommand,
  type KaminoDepositCommand,
  type KaminoViewPositionCommand,
  type KaminoWithdrawCommand,
  type OrcaCommand,
  type OrcaListPoolsCommand,
  type PumpAmmCommand,
  type PumpCurveCommand,
  type ViewRunCommand,
} from './app/commandParser';
import {
  decodeIdlAccount,
  getInstructionTemplate,
  listIdlProtocols,
  previewIdlInstruction,
  sendIdlInstruction,
  simulateIdlInstruction,
} from '@agentform/apppack-runtime/idlDeclarativeRuntime';
import {
  explainMetaOperation,
  listMetaApps,
  listMetaOperations,
  prepareMetaOperation,
  prepareMetaInstruction,
  type MetaAppSummary,
  type MetaOperationExplain,
  type MetaOperationSummary,
} from '@agentform/apppack-runtime/metaIdlRuntime';

const ORCA_PROTOCOL_ID = 'orca-whirlpool-mainnet';
const ORCA_LIST_POOLS_OPERATION_ID = 'list_pools';
const ORCA_OPERATION_ID = 'swap_exact_in';
const PUMP_AMM_PROTOCOL_ID = 'pump-amm-mainnet';
const PUMP_AMM_OPERATION_ID = 'buy';
const PUMP_AMM_RESOLVE_POOL_OPERATION_ID = 'resolve_pool';
const PUMP_CURVE_PROTOCOL_ID = 'pump-core-mainnet';
const PUMP_CURVE_OPERATION_ID = 'buy_exact_sol_in';
const KAMINO_KLEND_PROTOCOL_ID = 'kamino-klend-mainnet';
const KAMINO_DEPOSIT_OPERATION_ID = 'deposit_reserve_liquidity';
const KAMINO_WITHDRAW_OPERATION_ID = 'redeem_reserve_collateral';
const KAMINO_VIEW_OPERATION_ID = 'view_position';
const DEFAULT_VIEW_API_BASE_URL = 'https://apppack-view-service.onrender.com';
const VIEW_API_BASE_URL = String(import.meta.env.VITE_VIEW_API_BASE_URL ?? DEFAULT_VIEW_API_BASE_URL)
  .trim()
  .replace(/\/+$/, '');
const QUICK_PREFILL_SWAP_COMMAND =
  '/orca Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v So11111111111111111111111111111111111111112 0.01 50 --simulate';
const QUICK_PREFILL_ORCA_LIST_POOLS_COMMAND =
  '/orca-list-pools EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v So11111111111111111111111111111111111111112';
const QUICK_PREFILL_PUMP_QUOTE_COMMAND =
  '/pump-amm C4yDhKwkikpVGCQWD9BT2SJyHAtRFFnKPDM9Nyshpump 0.01 100 --simulate';
const QUICK_PREFILL_PUMP_CURVE_COMMAND =
  '/pump-curve 2wHC2vrKwFn87nwXcCnBbx5KRBi61km156af9YS8pump 0.01 100 --simulate';
const QUICK_PREFILL_KAMINO_DEPOSIT_COMMAND =
  '/kamino-deposit 8J5NcJX4RScwC9hWfW2MtgQ8v4D6vQkYvA4K4GcCbn8J EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 0.1 --simulate';
const BUILDER_EXAMPLE_INPUTS: Record<string, Record<string, string>> = {
  [`${ORCA_PROTOCOL_ID}/${ORCA_LIST_POOLS_OPERATION_ID}`]: {
    token_in_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    token_out_mint: 'So11111111111111111111111111111111111111112',
  },
  [`${ORCA_PROTOCOL_ID}/${ORCA_OPERATION_ID}`]: {
    token_in_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    token_out_mint: 'So11111111111111111111111111111111111111112',
    amount_in: '10000',
    slippage_bps: '50',
    whirlpool: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE',
    unwrap_sol_output: 'true',
  },
  [`${PUMP_AMM_PROTOCOL_ID}/${PUMP_AMM_OPERATION_ID}`]: {
    base_mint: 'C4yDhKwkikpVGCQWD9BT2SJyHAtRFFnKPDM9Nyshpump',
    quote_mint: 'So11111111111111111111111111111111111111112',
    quote_amount_in: '10000000',
    track_volume: 'true',
    slippage_bps: '100',
  },
  [`${PUMP_CURVE_PROTOCOL_ID}/${PUMP_CURVE_OPERATION_ID}`]: {
    base_mint: '2wHC2vrKwFn87nwXcCnBbx5KRBi61km156af9YS8pump',
    spendable_sol_in: '10000000',
    min_tokens_out: '1',
    track_volume: 'true',
    slippage_bps: '100',
  },
  [`${KAMINO_KLEND_PROTOCOL_ID}/${KAMINO_DEPOSIT_OPERATION_ID}`]: {
    liquidity_amount: '100000',
  },
  [`${KAMINO_KLEND_PROTOCOL_ID}/${KAMINO_WITHDRAW_OPERATION_ID}`]: {
    liquidity_amount: '100000',
  },
};

type Message = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
};

type AppTab = 'command' | 'builder';

type BuilderProtocol = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
};

type BuilderViewMode = 'enduser' | 'geek';

type BuilderApp = MetaAppSummary;

type OrcaPoolCandidate = {
  whirlpool: string;
  tokenMintA: string;
  tokenMintB: string;
  tickSpacing: string;
  liquidity: string;
};

type BuilderAppStepContext = {
  input: Record<string, unknown>;
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
  '/orca-list-pools <INPUT_TOKEN> <OUTPUT_TOKEN>',
  '/orca <WHIRLPOOL> <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> <SLIPPAGE_BPS> [--simulate]',
  '/pump-amm <TOKEN_MINT> <AMOUNT_SOL> <SLIPPAGE_BPS> [POOL_PUBKEY] [--simulate]',
  '/pump-curve <TOKEN_MINT> <AMOUNT_SOL> <SLIPPAGE_BPS> [--simulate]',
  '/kamino-deposit <RESERVE_OR_VAULT> <TOKEN_MINT> <AMOUNT> [--simulate]',
  '/kamino-withdraw <RESERVE_OR_VAULT> <TOKEN_MINT> <AMOUNT> [--simulate]',
  '/kamino-view-position <RESERVE_OR_VAULT> <TOKEN_MINT>',
  '/write-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>',
  '/read-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>',
  '/idl-list',
  '/idl-template <PROTOCOL_ID> <INSTRUCTION_NAME>',
  '/meta-explain <PROTOCOL_ID> <OPERATION_ID>',
  '/view-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON>',
  '/idl-view <PROTOCOL_ID> <ACCOUNT_TYPE> <ACCOUNT_PUBKEY>',
  '/help',
  '',
  'Notes:',
  'AMOUNT is UI amount (e.g. 0.1 for SOL).',
  'Pool discovery is on-chain via Orca program account scan.',
  'Pump quote/buy spends wrapped SOL (WSOL) under the hood.',
  'Kamino commands accept reserve pubkey or reserve vault pubkey as first argument.',
  '',
  'Examples:',
  '/orca-list-pools SOL USDC',
  '/orca <WHIRLPOOL> SOL USDC 0.1 50 --simulate',
  '/orca <WHIRLPOOL> SOL USDC 0.1 50',
  '/pump-amm <TOKEN_MINT> 0.01 100 --simulate',
  '/pump-amm <TOKEN_MINT> 0.01 100',
  '/pump-curve <TOKEN_MINT> 0.01 100 --simulate',
  '/pump-curve <TOKEN_MINT> 0.01 100',
  '/kamino-deposit <RESERVE_OR_VAULT> EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 10 --simulate',
  '/kamino-withdraw <RESERVE_OR_VAULT> EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 5 --simulate',
  '/kamino-view-position <RESERVE_OR_VAULT> EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
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

  function stringifyBuilderDefault(value: unknown): string {
    if (value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  function readBuilderPath(value: unknown, path: string): unknown {
    const cleaned = path.startsWith('$') ? path.slice(1) : path;
    const parts = cleaned.split('.').filter(Boolean);
    let current: unknown = value;
    for (const part of parts) {
      if (!current || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  function writeBuilderPath(value: Record<string, unknown>, path: string, nextValue: unknown): Record<string, unknown> {
    const cleaned = path.startsWith('$') ? path.slice(1) : path;
    const parts = cleaned.split('.').filter(Boolean);
    if (parts.length === 0) {
      return value;
    }

    const nextRoot: Record<string, unknown> = { ...value };
    let current: Record<string, unknown> = nextRoot;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      const existing = current[key];
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        current[key] = {};
      } else {
        current[key] = { ...(existing as Record<string, unknown>) };
      }
      current = current[key] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = nextValue;
    return nextRoot;
  }

  function valuesEqualForSelection(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function isBuilderTruthy(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) && value !== 0;
    }
    if (typeof value === 'bigint') {
      return value !== 0n;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return false;
      }
      if (trimmed === '0' || trimmed.toLowerCase() === 'false' || trimmed.toLowerCase() === 'null') {
        return false;
      }
      return true;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>).length > 0;
    }
    return true;
  }

  function buildBuilderAppScope(contexts: Record<string, BuilderAppStepContext>): Record<string, unknown> {
    return {
      steps: contexts,
    };
  }

  function evaluateBuilderStepSuccess(
    step: MetaAppSummary['steps'][number],
    contexts: Record<string, BuilderAppStepContext>,
    operationSucceeded: boolean,
  ): boolean {
    if (step.success.kind === 'operation_ok') {
      return operationSucceeded;
    }
    const value = readBuilderPath(buildBuilderAppScope(contexts), step.success.path);
    return isBuilderTruthy(value);
  }

  function findBuilderAppStepIndexById(app: MetaAppSummary, stepId: string): number {
    return app.steps.findIndex((step) => step.stepId === stepId);
  }

  function resolveBuilderNextStepIndexOnSuccess(
    app: MetaAppSummary,
    step: MetaAppSummary['steps'][number],
  ): number | null {
    const nextTransition = step.transitions.find((transition) => transition.on === 'success');
    if (!nextTransition) {
      return null;
    }
    const nextIndex = findBuilderAppStepIndexById(app, nextTransition.to);
    return nextIndex >= 0 ? nextIndex : null;
  }

  function resolveBuilderAppInputFrom(
    value: unknown,
    contexts: Record<string, BuilderAppStepContext>,
  ): unknown {
    if (typeof value === 'string' && value.startsWith('$')) {
      return readBuilderPath(
        {
          steps: contexts,
        },
        value,
      );
    }
    return value;
  }

  function formatBuilderSelectableItemLabel(
    item: unknown,
    index: number,
    ui: NonNullable<MetaAppSummary['steps'][number]['ui']>,
  ): string {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      if (ui.labelFields.length > 0) {
        const values = ui.labelFields
          .map((field) => readBuilderPath(record, field))
          .filter((entry) => entry !== undefined && entry !== null)
          .map((entry) => String(entry));
        if (values.length > 0) {
          return `${index + 1}. ${values.join(' | ')}`;
        }
      }
      const selected = readBuilderPath(record, ui.valuePath);
      if (selected !== undefined) {
        return `${index + 1}. ${String(selected)}`;
      }
      return `${index + 1}. [invalid selector: ui.valuePath did not resolve]`;
    }
    return `${index + 1}. ${String(item)}`;
  }

  function isAutoResolvedBuilderInput(spec: MetaOperationSummary['inputs'][string]): boolean {
    return spec.default !== undefined || (typeof spec.discover_from === 'string' && spec.discover_from.length > 0);
  }

  function isBuilderInputEditable(spec: MetaOperationSummary['inputs'][string]): boolean {
    if (typeof spec.ui_editable === 'boolean') {
      return spec.ui_editable;
    }
    return !isAutoResolvedBuilderInput(spec);
  }

  function getBuilderInputTag(spec: MetaOperationSummary['inputs'][string]): string {
    if (spec.discover_from) {
      if (spec.discover_stage === 'compute') {
        return 'computed';
      }
      if (spec.discover_stage === 'derive' || spec.discover_stage === 'discover') {
        return 'derived';
      }
      if (spec.discover_stage === 'input') {
        return 'linked';
      }
      return 'auto';
    }
    if (spec.default !== undefined) {
      return 'default';
    }
    if (spec.required) {
      return 'required';
    }
    if (spec.default === undefined && !spec.discover_from) {
      return 'required via discover';
    }
    return 'optional';
  }

  function parseBuilderInputValue(raw: string, type: string, label: string): unknown {
    const trimmed = raw.trim();
    if (!trimmed) {
      return undefined;
    }

    const normalizedType = type.toLowerCase();
    if (normalizedType === 'bool' || normalizedType === 'boolean') {
      if (trimmed === 'true') {
        return true;
      }
      if (trimmed === 'false') {
        return false;
      }
      throw new Error(`${label} must be true or false.`);
    }

    if (/^[ui]\d+$/.test(normalizedType)) {
      if (!/^-?\d+$/.test(trimmed)) {
        throw new Error(`${label} must be an integer.`);
      }
      return trimmed;
    }

    if (normalizedType === 'f32' || normalizedType === 'f64' || normalizedType === 'number') {
      const value = Number(trimmed);
      if (!Number.isFinite(value)) {
        throw new Error(`${label} must be a finite number.`);
      }
      return value;
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        throw new Error(`${label} must be valid JSON.`);
      }
    }

    if (trimmed === 'null') {
      return null;
    }

    return trimmed;
  }

  function buildExampleInputsForOperation(operation: MetaOperationSummary): Record<string, string> {
    const overrides = BUILDER_EXAMPLE_INPUTS[`${builderProtocolId}/${operation.operationId}`] ?? {};
    const nextValues: Record<string, string> = {};

    for (const [inputName, spec] of Object.entries(operation.inputs)) {
      const override = overrides[inputName];
      if (override !== undefined) {
        nextValues[inputName] = override;
        continue;
      }

      if (spec.default !== undefined) {
        nextValues[inputName] = stringifyBuilderDefault(spec.default);
        continue;
      }

      const normalizedType = spec.type.toLowerCase();
      if (normalizedType === 'bool' || normalizedType === 'boolean') {
        nextValues[inputName] = 'true';
        continue;
      }
      if (/^[ui]\d+$/.test(normalizedType)) {
        nextValues[inputName] = '1';
        continue;
      }
      if (normalizedType === 'f32' || normalizedType === 'f64' || normalizedType === 'number') {
        nextValues[inputName] = '0.1';
        continue;
      }

      nextValues[inputName] = '';
    }

    return nextValues;
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

  function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label} must be an object.`);
    }
    return value as Record<string, unknown>;
  }

  function asString(value: unknown, label: string): string {
    if (typeof value !== 'string') {
      throw new Error(`${label} must be a string.`);
    }
    return value;
  }

  function asIntegerLikeString(value: unknown, label: string): string {
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
      return String(value);
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    throw new Error(`${label} must be an integer-like value.`);
  }

  function asBoolean(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') {
      throw new Error(`${label} must be a boolean.`);
    }
    return value;
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

    const response = await fetch(`${VIEW_API_BASE_URL}/view-run`, {
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

  function normalizeOrcaPoolCandidates(raw: unknown): OrcaPoolCandidate[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((entry, index) => {
      const candidate = asRecord(entry, `pool_candidates[${index}]`);
      const tokenMintA = candidate.tokenMintA ?? candidate.token_mint_a;
      const tokenMintB = candidate.tokenMintB ?? candidate.token_mint_b;
      const tickSpacing = candidate.tickSpacing ?? candidate.tick_spacing;
      return {
        whirlpool: asString(candidate.whirlpool, `pool_candidates[${index}].whirlpool`),
        tokenMintA: asString(tokenMintA, `pool_candidates[${index}].tokenMintA`),
        tokenMintB: asString(tokenMintB, `pool_candidates[${index}].tokenMintB`),
        tickSpacing: asIntegerLikeString(tickSpacing, `pool_candidates[${index}].tickSpacing`),
        liquidity: asIntegerLikeString(candidate.liquidity, `pool_candidates[${index}].liquidity`),
      };
    });
  }

  function normalizePumpPoolCandidates(raw: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((entry, index) => {
      const candidate = asRecord(entry, `pool_candidates[${index}]`);
      return {
        pool: asString(candidate.pool, `pool_candidates[${index}].pool`),
        baseMint: asString(candidate.baseMint, `pool_candidates[${index}].baseMint`),
        quoteMint: asString(candidate.quoteMint, `pool_candidates[${index}].quoteMint`),
        lpSupply: asIntegerLikeString(candidate.lpSupply, `pool_candidates[${index}].lpSupply`),
      };
    });
  }

  function compactInteger(value: string): string {
    if (value.length <= 12) {
      return value;
    }
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  function formatOrcaPoolChoiceLine(pool: OrcaPoolCandidate, index: number): string {
    return `${index + 1}. ${compactPubkey(pool.whirlpool)} | tickSpacing ${pool.tickSpacing} | liquidity ${compactInteger(pool.liquidity)}`;
  }

  function stringifyReadOutputValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function formatReadOutputItem(
    item: unknown,
    index: number,
    labelFields: string[],
  ): string {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      if (labelFields.length > 0) {
        const parts = labelFields
          .map((field) => readBuilderPath(record, field))
          .filter((entry) => entry !== undefined && entry !== null)
          .map((entry) => String(entry));
        if (parts.length > 0) {
          return `${index + 1}. ${parts.join(' | ')}`;
        }
        return `${index + 1}. [no label field resolved]`;
      }
      return `${index + 1}. [configure read_output.itemLabelFields]`;
    }
    return `${index + 1}. ${stringifyReadOutputValue(item)}`;
  }

  function buildReadOnlyHighlightsFromSpec(
    spec: NonNullable<MetaOperationSummary['readOutput']>,
    readValue: unknown,
  ): string[] {
    const highlights: string[] = [];
    if (spec.title) {
      highlights.push(spec.title);
    }

    if (spec.type === 'scalar') {
      if (readValue === undefined || readValue === null || readValue === '') {
        highlights.push(spec.emptyText ?? 'No value returned.');
        return highlights;
      }
      highlights.push(`value: ${stringifyReadOutputValue(readValue)}`);
      return highlights;
    }

    if (spec.type === 'object') {
      if (!readValue || typeof readValue !== 'object' || Array.isArray(readValue)) {
        highlights.push(spec.emptyText ?? 'No object returned.');
        return highlights;
      }
      const entries = Object.entries(readValue as Record<string, unknown>);
      if (entries.length === 0) {
        highlights.push(spec.emptyText ?? 'No object fields returned.');
        return highlights;
      }
      for (const [key, value] of entries) {
        highlights.push(`${key}: ${stringifyReadOutputValue(value)}`);
      }
      return highlights;
    }

    if (!Array.isArray(readValue)) {
      highlights.push(spec.emptyText ?? 'No list returned.');
      return highlights;
    }

    if (readValue.length === 0) {
      highlights.push(spec.emptyText ?? 'No items found.');
      return highlights;
    }

    const maxItems = typeof spec.maxItems === 'number' && spec.maxItems > 0 ? spec.maxItems : readValue.length;
    const shown = readValue.slice(0, maxItems);
    highlights.push(`items: ${readValue.length}`);
    highlights.push(...shown.map((item, index) => formatReadOutputItem(item, index, spec.itemLabelFields ?? [])));
    if (readValue.length > shown.length) {
      highlights.push(`...and ${readValue.length - shown.length} more.`);
    }
    return highlights;
  }

  function asPrettyJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  function setBuilderResult(lines: string[], raw?: unknown) {
    setBuilderStatusText(lines.join('\n'));
    setBuilderRawDetails(raw === undefined ? null : asPrettyJson(raw));
    setBuilderShowRawDetails(false);
  }

  function applyBuilderAppStepResult(options: {
    executionInput: Record<string, unknown>;
    prepared: Awaited<ReturnType<typeof prepareMetaOperation>>;
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

  function isBuilderAppStepUnlocked(
    app: MetaAppSummary,
    targetStep: MetaAppSummary['steps'][number],
    contexts: Record<string, BuilderAppStepContext>,
    completed: Record<string, boolean>,
  ): boolean {
    const dependsSatisfied = targetStep.blocking.dependsOn.every((stepId) => Boolean(completed[stepId]));
    if (!dependsSatisfied) {
      return false;
    }
    const scope = buildBuilderAppScope(contexts);
    const pathsSatisfied = targetStep.blocking.requiresPaths.every((path) => isBuilderTruthy(readBuilderPath(scope, path)));
    if (!pathsSatisfied) {
      return false;
    }

    if (targetStep.stepId === app.entryStepId) {
      return true;
    }

    return app.steps.some(
      (step) =>
        Boolean(completed[step.stepId]) &&
        step.transitions.some((transition) => transition.on === 'success' && transition.to === targetStep.stepId),
    );
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

  function getMintDisplay(mint: string): { label: string; decimals: number | null } {
    const token = resolveToken(mint);
    if (token) {
      return { label: token.symbol, decimals: token.decimals };
    }
    return { label: compactPubkey(mint), decimals: null };
  }

  function formatAmountWithMint(amountAtomic: string, mint: string): string {
    const display = getMintDisplay(mint);
    if (display.decimals !== null) {
      return `${formatTokenAmount(amountAtomic, display.decimals)} ${display.label} (${amountAtomic})`;
    }
    return `${amountAtomic} atomic (${display.label})`;
  }

  function renderMetaExplain(explanation: MetaOperationExplain): string {
    const formatRequired = (spec: Record<string, unknown>): string => {
      const required = spec.required === false ? 'optional' : 'required';
      const defaultText = spec.default !== undefined ? `, default=${JSON.stringify(spec.default)}` : '';
      const discoverFromText =
        typeof spec.discover_from === 'string' ? `, discover_from=${spec.discover_from}` : '';
      return `${required}${defaultText}${discoverFromText}`;
    };

    const discoverLines = explanation.discover.map((step, index) => {
      const name = String(step.name ?? `step_${index + 1}`);
      const kind = String(step.discover ?? 'unknown');
      return `${index + 1}. ${name} -> ${kind}`;
    });

    const deriveLines = explanation.derive.map((step, index) => {
      const name = String(step.name ?? `step_${index + 1}`);
      const resolver = String(step.resolver ?? 'unknown');
      return `${index + 1}. ${name} -> ${resolver}`;
    });

    const computeLines = explanation.compute.map((step, index) => {
      const name = String(step.name ?? `step_${index + 1}`);
      const compute = String(step.compute ?? 'unknown');
      return `${index + 1}. ${name} -> ${compute}`;
    });

    const inputLines = Object.entries(explanation.inputs).map(
      ([name, spec]) => `- ${name}: ${String(spec.type ?? 'unknown')} (${formatRequired(spec)})`,
    );

    const view = explanation.view as Record<string, unknown> | undefined;
    const viewBootstrap = view?.bootstrap as Record<string, unknown> | undefined;
    const viewStream = view?.stream as Record<string, unknown> | undefined;

    const viewBootstrapSteps = Array.isArray(viewBootstrap?.steps)
      ? (viewBootstrap.steps as unknown[])
          .map((entry) => String(entry))
          .filter((entry) => entry.length > 0)
      : [];
    const viewEntityKeys = Array.isArray(view?.entity_keys)
      ? (view.entity_keys as unknown[])
          .map((entry) => String(entry))
          .filter((entry) => entry.length > 0)
      : [];
    const viewStreamSource = viewStream
      ? String(viewStream.source ?? 'n/a')
      : null;
    const viewStreamFilter = viewStream
      ? String(viewStream.filter ?? 'n/a')
      : null;

    return [
      `Meta operation: ${explanation.protocolId}/${explanation.operationId}`,
      `schema: ${explanation.schema ?? 'n/a'} | version: ${explanation.version}`,
      `instruction: ${explanation.instruction}`,
      `templates used: ${explanation.templateUse.length > 0 ? explanation.templateUse.map((entry) => String(entry.template ?? entry.macro ?? 'unknown')).join(', ') : 'none'}`,
      '',
      'Inputs:',
      ...(inputLines.length > 0 ? inputLines : ['- none']),
      '',
      'Discover phase:',
      ...(discoverLines.length > 0 ? discoverLines : ['none']),
      '',
      'Derive phase:',
      ...(deriveLines.length > 0 ? deriveLines : ['none']),
      '',
      'Compute phase:',
      ...(computeLines.length > 0 ? computeLines : ['none']),
      '',
      'View contract:',
      ...(view
        ? [
            `bootstrap steps: ${viewBootstrapSteps.join(', ') || 'none'}`,
            `stream source: ${viewStreamSource ?? 'none'}`,
            `stream filter: ${viewStreamFilter ?? 'none'}`,
            `entity keys: ${viewEntityKeys.join(', ') || 'none'}`,
          ]
        : ['none']),
      '',
      `Build args keys: ${Object.keys(explanation.args).join(', ') || 'none'}`,
      `Build accounts keys: ${Object.keys(explanation.accounts).join(', ') || 'none'}`,
      `Post steps: ${explanation.post.length}`,
      '',
      'Expanded JSON:',
      asPrettyJson(explanation),
    ].join('\n');
  }

  function encodeIxDataBase64(data: Uint8Array): string {
    let binary = '';
    for (const byte of data) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  function compactPubkey(value: unknown): string {
    const text = String(value ?? 'n/a');
    if (text.length <= 12) {
      return text;
    }
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
  }

  function readU64Le(data: Uint8Array, offset: number): bigint {
    if (data.length < offset + 8) {
      return 0n;
    }

    let value = 0n;
    for (let i = 0; i < 8; i += 1) {
      value |= BigInt(data[offset + i]) << BigInt(i * 8);
    }
    return value;
  }

  function decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  function readSplTokenAmountFromSimAccount(dataBase64: string | null): bigint {
    if (!dataBase64) {
      return 0n;
    }

    const bytes = decodeBase64(dataBase64);
    return readU64Le(bytes, 64);
  }

  function buildOwnerAtaPreInstructions(options: {
    owner: PublicKey;
    pairs: Array<{ ata: string; mint: string }>;
  }): TransactionInstruction[] {
    return options.pairs.map((pair) =>
      createAssociatedTokenAccountIdempotentInstruction(
        options.owner,
        new PublicKey(pair.ata),
        options.owner,
        new PublicKey(pair.mint),
      ),
    );
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

  function buildBuilderPreInstructions(options: {
    protocolId: string;
    derived: Record<string, unknown>;
    accounts: Record<string, string>;
    walletPublicKey: PublicKey;
  }): TransactionInstruction[] {
    if (options.protocolId === ORCA_PROTOCOL_ID) {
      const whirlpoolDataRaw = options.derived.whirlpool_data;
      if (whirlpoolDataRaw && typeof whirlpoolDataRaw === 'object' && !Array.isArray(whirlpoolDataRaw)) {
        const whirlpoolData = asRecord(whirlpoolDataRaw, 'derived.whirlpool_data');
        const tokenOwnerA = options.accounts.token_owner_account_a;
        const tokenOwnerB = options.accounts.token_owner_account_b;
        const mintA = whirlpoolData.token_mint_a;
        const mintB = whirlpoolData.token_mint_b;

        if (
          typeof tokenOwnerA === 'string' &&
          typeof tokenOwnerB === 'string' &&
          typeof mintA === 'string' &&
          typeof mintB === 'string'
        ) {
          return buildOwnerAtaPreInstructions({
            owner: options.walletPublicKey,
            pairs: [
              { ata: tokenOwnerA, mint: mintA },
              { ata: tokenOwnerB, mint: mintB },
            ],
          });
        }
      }
    }

    return [];
  }

  function formatPercent(value: number): string {
    if (!Number.isFinite(value)) {
      return 'n/a';
    }
    return `${(value * 100).toFixed(2)}%`;
  }

  async function executeOrcaListPools(options: {
    value: OrcaListPoolsCommand;
  }): Promise<void> {
    const response = await runRemoteViewRun({
      protocolId: ORCA_PROTOCOL_ID,
      operationId: ORCA_LIST_POOLS_OPERATION_ID,
      input: {
        token_in_mint: options.value.inputMint,
        token_out_mint: options.value.outputMint,
      },
      limit: 20,
    });

    const poolCandidates = normalizeOrcaPoolCandidates(response.items ?? []);
    if (poolCandidates.length === 0) {
      pushMessage(
        'assistant',
        `No Orca Whirlpool pool found for ${options.value.inputToken}/${options.value.outputToken}.`,
      );
      return;
    }

    const lines = [
      `Orca pools (${options.value.inputToken}/${options.value.outputToken}):`,
      ...poolCandidates.map((pool, index) => formatOrcaPoolChoiceLine(pool, index)),
      '',
      'Use one whirlpool in swap command:',
      `/orca <WHIRLPOOL> ${options.value.inputToken} ${options.value.outputToken} <AMOUNT> <SLIPPAGE_BPS> [--simulate]`,
    ];
    pushMessage('assistant', lines.join('\n'));
  }

  async function executeOrca(options: {
    value: OrcaCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to derive owner token accounts.');
    }
    const walletPublicKey = wallet.publicKey;
    const selectedWhirlpool = options.value.whirlpool;

    const preparedInitial = await prepareMetaInstruction({
      protocolId: ORCA_PROTOCOL_ID,
      operationId: ORCA_OPERATION_ID,
      input: {
        token_in_mint: options.value.inputMint,
        token_out_mint: options.value.outputMint,
        amount_in: options.value.amountAtomic,
        slippage_bps: options.value.slippageBps,
        whirlpool: selectedWhirlpool,
      },
      connection,
      walletPublicKey,
    });

    const whirlpoolDataInitial = preparedInitial.derived.whirlpool_data as Record<string, unknown> | undefined;
    const inputTokenMeta = resolveToken(options.value.inputMint);
    const outputTokenMeta = resolveToken(options.value.outputMint);

    if (!whirlpoolDataInitial) {
      throw new Error('Missing derived whirlpool data from meta runtime.');
    }

    const preInstructionsInitial = buildOwnerAtaPreInstructions({
      owner: walletPublicKey,
      pairs: [
        {
          ata: preparedInitial.accounts.token_owner_account_a,
          mint: String(whirlpoolDataInitial.token_mint_a),
        },
        {
          ata: preparedInitial.accounts.token_owner_account_b,
          mint: String(whirlpoolDataInitial.token_mint_b),
        },
      ],
    });
    const postInstructionsInitial = buildMetaPostInstructions(preparedInitial.postInstructions);

    const aToBInitial = asBoolean(preparedInitial.derived.a_to_b, 'a_to_b');
    const inputAtaInitial = aToBInitial
      ? preparedInitial.accounts.token_owner_account_a
      : preparedInitial.accounts.token_owner_account_b;
    const outputAtaInitial = aToBInitial
      ? preparedInitial.accounts.token_owner_account_b
      : preparedInitial.accounts.token_owner_account_a;
    let inputBalanceAtomic = '0';
    try {
      const inputBalance = await connection.getTokenAccountBalance(new PublicKey(inputAtaInitial), 'confirmed');
      inputBalanceAtomic = inputBalance.value.amount;
    } catch {
      inputBalanceAtomic = '0';
    }
    let outputBalanceAtomic = '0';
    try {
      const outputBalance = await connection.getTokenAccountBalance(new PublicKey(outputAtaInitial), 'confirmed');
      outputBalanceAtomic = outputBalance.value.amount;
    } catch {
      outputBalanceAtomic = '0';
    }

    const requiredInputAtomic = BigInt(options.value.amountAtomic);
    const availableInputAtomic = BigInt(inputBalanceAtomic);
    if (availableInputAtomic < requiredInputAtomic) {
      const availableUi = inputTokenMeta
        ? formatTokenAmount(availableInputAtomic.toString(), inputTokenMeta.decimals)
        : availableInputAtomic.toString();
      const requiredUi = inputTokenMeta
        ? formatTokenAmount(requiredInputAtomic.toString(), inputTokenMeta.decimals)
        : requiredInputAtomic.toString();
      throw new Error(
        `Insufficient ${options.value.inputToken} balance in input token account. Required: ${requiredUi} (${requiredInputAtomic.toString()}), available: ${availableUi} (${availableInputAtomic.toString()}).`,
      );
    }

    const rawPreviewByArgs = new Map<string, Record<string, unknown>>();
    const getRawPreview = async (options: {
      prepared: Awaited<ReturnType<typeof prepareMetaInstruction>>;
      args: Record<string, unknown>;
      preInstructions: TransactionInstruction[];
      postInstructions: TransactionInstruction[];
    }): Promise<Record<string, unknown>> => {
      const cacheKey = JSON.stringify({
        instructionName: options.prepared.instructionName,
        args: options.args,
        accounts: options.prepared.accounts,
        remaining: options.prepared.remainingAccounts,
      });
      const cached = rawPreviewByArgs.get(cacheKey);
      if (cached) {
        return cached;
      }

      const preview = {
        preInstructions: options.preInstructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          keys: ix.keys.map((key) => ({
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          dataBase64: encodeIxDataBase64(ix.data),
        })),
        postInstructions: options.postInstructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          keys: ix.keys.map((key) => ({
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          dataBase64: encodeIxDataBase64(ix.data),
        })),
        mainInstruction: await previewIdlInstruction({
          protocolId: options.prepared.protocolId,
          instructionName: options.prepared.instructionName,
          args: options.args,
          accounts: options.prepared.accounts,
          remainingAccounts: options.prepared.remainingAccounts,
          walletPublicKey,
        }),
      };

      rawPreviewByArgs.set(cacheKey, preview);
      return preview;
    };

    const provisionalArgs = preparedInitial.args as Record<string, unknown>;
    let provisionalSimulation: Awaited<ReturnType<typeof simulateIdlInstruction>>;
    try {
      provisionalSimulation = await simulateIdlInstruction({
        protocolId: preparedInitial.protocolId,
        instructionName: preparedInitial.instructionName,
        args: provisionalArgs,
        accounts: preparedInitial.accounts,
        remainingAccounts: preparedInitial.remainingAccounts,
        preInstructions: preInstructionsInitial,
        // Estimate output on token accounts before any optional close-account post steps.
        postInstructions: [],
        includeAccounts: [inputAtaInitial, outputAtaInitial],
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown simulation error.';
      const rawPreview = await getRawPreview({
        prepared: preparedInitial,
        args: provisionalArgs,
        preInstructions: preInstructionsInitial,
        postInstructions: postInstructionsInitial,
      });
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    if (!provisionalSimulation.ok) {
      const rawPreview = await getRawPreview({
        prepared: preparedInitial,
        args: provisionalArgs,
        preInstructions: preInstructionsInitial,
        postInstructions: postInstructionsInitial,
      });
      const simError = provisionalSimulation.error ?? 'unknown';
      const logs = provisionalSimulation.logs.join('\n');
      throw new Error(`Simulation failed: ${simError}\n${logs}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    const simOutputAccount = provisionalSimulation.accounts.find((entry) => entry.address === outputAtaInitial);
    const preInputAtomic = availableInputAtomic;
    const preOutputAtomic = BigInt(outputBalanceAtomic);
    const postOutputAtomic = readSplTokenAmountFromSimAccount(simOutputAccount?.dataBase64 ?? null);

    const estimatedOutAtomicBigint = postOutputAtomic > preOutputAtomic ? postOutputAtomic - preOutputAtomic : 0n;
    if (estimatedOutAtomicBigint <= 0n) {
      throw new Error('Could not estimate output from simulation (estimated output is zero).');
    }

    const preparedFinal = await prepareMetaInstruction({
      protocolId: ORCA_PROTOCOL_ID,
      operationId: ORCA_OPERATION_ID,
      input: {
        token_in_mint: options.value.inputMint,
        token_out_mint: options.value.outputMint,
        amount_in: options.value.amountAtomic,
        slippage_bps: options.value.slippageBps,
        estimated_out: estimatedOutAtomicBigint.toString(),
        whirlpool: selectedWhirlpool,
      },
      connection,
      walletPublicKey,
    });

    const whirlpoolDataFinal = preparedFinal.derived.whirlpool_data as Record<string, unknown> | undefined;
    if (!whirlpoolDataFinal) {
      throw new Error('Missing derived whirlpool data from final Orca meta pass.');
    }
    const preInstructionsFinal = buildOwnerAtaPreInstructions({
      owner: walletPublicKey,
      pairs: [
        {
          ata: preparedFinal.accounts.token_owner_account_a,
          mint: String(whirlpoolDataFinal.token_mint_a),
        },
        {
          ata: preparedFinal.accounts.token_owner_account_b,
          mint: String(whirlpoolDataFinal.token_mint_b),
        },
      ],
    });
    const postInstructionsFinal = buildMetaPostInstructions(preparedFinal.postInstructions);
    const aToBFinal = asBoolean(preparedFinal.derived.a_to_b, 'a_to_b');
    const inputAtaFinal = aToBFinal ? preparedFinal.accounts.token_owner_account_a : preparedFinal.accounts.token_owner_account_b;
    const outputAtaFinal = aToBFinal ? preparedFinal.accounts.token_owner_account_b : preparedFinal.accounts.token_owner_account_a;
    const finalArgs = preparedFinal.args as Record<string, unknown>;
    const minOutAtomic = asIntegerLikeString(finalArgs.other_amount_threshold, 'args.other_amount_threshold');

    let finalSimulation: Awaited<ReturnType<typeof simulateIdlInstruction>>;
    try {
      finalSimulation = await simulateIdlInstruction({
        protocolId: preparedFinal.protocolId,
        instructionName: preparedFinal.instructionName,
        args: finalArgs,
        accounts: preparedFinal.accounts,
        remainingAccounts: preparedFinal.remainingAccounts,
        preInstructions: preInstructionsFinal,
        postInstructions: [],
        includeAccounts: [inputAtaFinal, outputAtaFinal],
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown simulation error.';
      const rawPreview = await getRawPreview({
        prepared: preparedFinal,
        args: finalArgs,
        preInstructions: preInstructionsFinal,
        postInstructions: postInstructionsFinal,
      });
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    if (!finalSimulation.ok) {
      const rawPreview = await getRawPreview({
        prepared: preparedFinal,
        args: finalArgs,
        preInstructions: preInstructionsFinal,
        postInstructions: postInstructionsFinal,
      });
      const simError = finalSimulation.error ?? 'unknown';
      const logs = finalSimulation.logs.join('\n');
      throw new Error(`Simulation failed: ${simError}\n${logs}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    const finalSimInputAccount = finalSimulation.accounts.find((entry) => entry.address === inputAtaFinal);
    const finalSimOutputAccount = finalSimulation.accounts.find((entry) => entry.address === outputAtaFinal);
    const finalPostInputAtomic = readSplTokenAmountFromSimAccount(finalSimInputAccount?.dataBase64 ?? null);
    const finalPostOutputAtomic = readSplTokenAmountFromSimAccount(finalSimOutputAccount?.dataBase64 ?? null);
    const finalEstimatedInAtomicBigint = preInputAtomic > finalPostInputAtomic ? preInputAtomic - finalPostInputAtomic : 0n;
    const finalEstimatedOutAtomicBigint = finalPostOutputAtomic > preOutputAtomic ? finalPostOutputAtomic - preOutputAtomic : 0n;
    if (finalEstimatedOutAtomicBigint <= 0n) {
      throw new Error('Could not estimate output from simulation (estimated output is zero).');
    }

    const estimatedInAtomic = finalEstimatedInAtomicBigint.toString();
    const estimatedOutAtomic = finalEstimatedOutAtomicBigint.toString();
    const estimatedInUi = inputTokenMeta ? formatTokenAmount(estimatedInAtomic, inputTokenMeta.decimals) : estimatedInAtomic;
    const estimatedOutUi = outputTokenMeta ? formatTokenAmount(estimatedOutAtomic, outputTokenMeta.decimals) : estimatedOutAtomic;
    const minOutUi = outputTokenMeta ? formatTokenAmount(minOutAtomic, outputTokenMeta.decimals) : minOutAtomic;
    let impliedRateText = 'n/a';
    if (inputTokenMeta && outputTokenMeta && estimatedInAtomic !== '0') {
      const inUi = new Decimal(estimatedInAtomic).div(new Decimal(10).pow(inputTokenMeta.decimals));
      const outUi = new Decimal(estimatedOutAtomic).div(new Decimal(10).pow(outputTokenMeta.decimals));
      if (inUi.gt(0)) {
        impliedRateText = outUi.div(inUi).toSignificantDigits(8).toString();
      }
    }

    if (options.value.simulate) {
      pushMessage(
        'assistant',
        [
          'Orca simulate (meta IDL + simulation):',
          `pair: ${options.value.inputToken}/${options.value.outputToken}`,
          `pool: ${selectedWhirlpool}`,
          `input: ${estimatedInUi} ${options.value.inputToken}`,
          `estimated output: ${estimatedOutUi} ${options.value.outputToken}`,
          `min output @ ${options.value.slippageBps} bps: ${minOutUi} ${options.value.outputToken}`,
          `implied rate: 1 ${options.value.inputToken} ≈ ${impliedRateText} ${options.value.outputToken}`,
          `tick arrays: ${compactPubkey(preparedFinal.accounts.tick_array_0)}, ${compactPubkey(preparedFinal.accounts.tick_array_1)}, ${compactPubkey(preparedFinal.accounts.tick_array_2)}`,
          `simulation: ok${finalSimulation.unitsConsumed ? ` (${finalSimulation.unitsConsumed} CU)` : ''}`,
          'Run same command without --simulate to execute.',
        ].join('\n'),
      );
      return;
    }

    let result: Awaited<ReturnType<typeof sendIdlInstruction>>;
    try {
      result = await sendIdlInstruction({
        protocolId: preparedFinal.protocolId,
        instructionName: preparedFinal.instructionName,
        args: finalArgs,
        accounts: preparedFinal.accounts,
        remainingAccounts: preparedFinal.remainingAccounts,
        preInstructions: preInstructionsFinal,
        postInstructions: postInstructionsFinal,
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown send error.';
      const rawPreview = await getRawPreview({
        prepared: preparedFinal,
        args: finalArgs,
        preInstructions: preInstructionsFinal,
        postInstructions: postInstructionsFinal,
      });
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    pushMessage(
      'assistant',
      [
        'Orca tx sent (meta IDL -> write-raw).',
        `pair: ${options.value.inputToken}/${options.value.outputToken}`,
        `pool: ${selectedWhirlpool}`,
        `estimatedOut: ${estimatedOutUi} ${options.value.outputToken} (${estimatedOutAtomic})`,
        result.signature,
        result.explorerUrl,
      ].join('\n'),
    );
  }

  async function executePumpAmm(options: {
    value: PumpAmmCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to execute Pump AMM operations.');
    }
    const walletPublicKey = wallet.publicKey;

    let resolvedPool: Awaited<ReturnType<typeof prepareMetaOperation>>;
    try {
      resolvedPool = await prepareMetaOperation({
        protocolId: PUMP_AMM_PROTOCOL_ID,
        operationId: PUMP_AMM_RESOLVE_POOL_OPERATION_ID,
        input: {
          base_mint: options.value.tokenMint,
          quote_mint: 'So11111111111111111111111111111111111111112',
          ...(options.value.pool ? { pool: options.value.pool } : {}),
        },
        connection,
        walletPublicKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const noPoolFound =
        message.includes('discover:selected_pool: no candidates found.') ||
        message.includes('discover:pool_candidates: no candidates found.');
      if (noPoolFound) {
        throw new Error(
          [
            `No Pump AMM pool found for token ${options.value.tokenMint} against SOL.`,
            options.value.pool
              ? `The provided pool ${options.value.pool} does not match this token/SOL pair in Pump AMM.`
              : 'This token may still be on bonding-curve or on another venue.',
            'Use /pump-curve <TOKEN_MINT> <AMOUNT_SOL> <SLIPPAGE_BPS> --simulate to quote bonding-curve directly.',
          ].join(' '),
        );
      }
      throw error;
    }

    const candidates = normalizePumpPoolCandidates(resolvedPool.derived.pool_candidates);
    if (candidates.length === 0) {
      throw new Error(
        'No Pump AMM pool found for this token mint against SOL. The token may exist on Pump bonding-curve but not be migrated/listed in Pump AMM yet.',
      );
    }

    const selectedPool = asRecord(resolvedPool.derived.selected_pool, 'selected_pool');
    const selectedPoolAddress = asString(selectedPool.pool, 'selected_pool.pool');

    const prepared = await prepareMetaInstruction({
      protocolId: PUMP_AMM_PROTOCOL_ID,
      operationId: PUMP_AMM_OPERATION_ID,
      input: {
        base_mint: options.value.tokenMint,
        quote_amount_in: options.value.amountAtomic,
        track_volume: true,
        slippage_bps: options.value.slippageBps,
        pool: selectedPoolAddress,
      },
      connection,
      walletPublicKey,
    });

    const poolData = asRecord(prepared.derived.pool_data, 'pool_data');

    const userBaseAta = prepared.accounts.user_base_token_account;
    const userQuoteAta = prepared.accounts.user_quote_token_account;
    const poolBaseMint = asString(poolData.base_mint, 'pool_data.base_mint');
    const poolQuoteMint = asString(poolData.quote_mint, 'pool_data.quote_mint');
    const baseTokenProgram = new PublicKey(
      asString(prepared.accounts.base_token_program, 'accounts.base_token_program'),
    );
    const quoteTokenProgram = new PublicKey(
      asString(prepared.accounts.quote_token_program, 'accounts.quote_token_program'),
    );
    if (poolQuoteMint !== 'So11111111111111111111111111111111111111112') {
      throw new Error(
        `Unsupported Pump quote mint ${poolQuoteMint}. This command currently supports SOL-quoted pools only.`,
      );
    }
    const finalArgs = prepared.args as Record<string, unknown>;
    const computedBaseOutAtomic = asIntegerLikeString(
      finalArgs.base_amount_out,
      'args.base_amount_out',
    );
    const computedMaxQuoteInAtomic = BigInt(
      asIntegerLikeString(finalArgs.max_quote_amount_in, 'args.max_quote_amount_in'),
    );
    const trackVolume =
      finalArgs.track_volume === undefined ? true : asBoolean(finalArgs.track_volume, 'args.track_volume');
    const lpFeeBpsRaw = prepared.derived.lp_fee_bps;
    const protocolFeeBpsRaw = prepared.derived.protocol_fee_bps;
    const creatorFeeBpsRaw = prepared.derived.creator_fee_bps;
    const hasFeeBps = lpFeeBpsRaw !== undefined && protocolFeeBpsRaw !== undefined && creatorFeeBpsRaw !== undefined;
    const lpFeeBps = hasFeeBps ? asIntegerLikeString(lpFeeBpsRaw, 'derived.lp_fee_bps') : null;
    const protocolFeeBps = hasFeeBps
      ? asIntegerLikeString(protocolFeeBpsRaw, 'derived.protocol_fee_bps')
      : null;
    const creatorFeeBps = hasFeeBps ? asIntegerLikeString(creatorFeeBpsRaw, 'derived.creator_fee_bps') : null;

    const preInstructions: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        new PublicKey(userBaseAta),
        walletPublicKey,
        new PublicKey(poolBaseMint),
        baseTokenProgram,
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        new PublicKey(userQuoteAta),
        walletPublicKey,
        new PublicKey(poolQuoteMint),
        quoteTokenProgram,
      ),
      SystemProgram.transfer({
        fromPubkey: walletPublicKey,
        toPubkey: new PublicKey(userQuoteAta),
        // For Pump AMM `buy`, quote debit can go up to max_quote_amount_in.
        lamports: computedMaxQuoteInAtomic,
      }),
      createSyncNativeInstruction(new PublicKey(userQuoteAta)),
    ];

    const postInstructions = buildMetaPostInstructions(prepared.postInstructions);

    let preBaseAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(userBaseAta), 'confirmed');
      preBaseAtomic = BigInt(balance.value.amount);
    } catch {
      preBaseAtomic = 0n;
    }
    let preQuoteAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(userQuoteAta), 'confirmed');
      preQuoteAtomic = BigInt(balance.value.amount);
    } catch {
      preQuoteAtomic = 0n;
    }
    const rawPreviewByArgs = new Map<string, Record<string, unknown>>();
    const getRawPreview = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const cacheKey = JSON.stringify(args);
      const cached = rawPreviewByArgs.get(cacheKey);
      if (cached) {
        return cached;
      }

      const preview = {
        preInstructions: preInstructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          keys: ix.keys.map((key) => ({
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          dataBase64: encodeIxDataBase64(ix.data),
        })),
        postInstructions: postInstructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          keys: ix.keys.map((key) => ({
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          dataBase64: encodeIxDataBase64(ix.data),
        })),
        mainInstruction: await previewIdlInstruction({
          protocolId: prepared.protocolId,
          instructionName: prepared.instructionName,
          args,
          accounts: prepared.accounts,
          remainingAccounts: prepared.remainingAccounts,
          walletPublicKey,
        }),
      };
      rawPreviewByArgs.set(cacheKey, preview);
      return preview;
    };
    let simulation: Awaited<ReturnType<typeof simulateIdlInstruction>>;
    try {
      simulation = await simulateIdlInstruction({
        protocolId: prepared.protocolId,
        instructionName: prepared.instructionName,
        args: finalArgs,
        accounts: prepared.accounts,
        remainingAccounts: prepared.remainingAccounts,
        preInstructions,
        postInstructions: [],
        includeAccounts: [userBaseAta, userQuoteAta],
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown simulation error.';
      const rawPreview = await getRawPreview(finalArgs);
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    if (!simulation.ok) {
      const rawPreview = await getRawPreview(finalArgs);
      const simError = simulation.error ?? 'unknown';
      const logs = simulation.logs.join('\n');
      const feeBpsLine =
        lpFeeBps !== null && protocolFeeBps !== null && creatorFeeBps !== null
          ? `Fee bps: lp=${lpFeeBps}, protocol=${protocolFeeBps}, creator=${creatorFeeBps}`
        : 'Fee bps: n/a';
      throw new Error(
        [
          `Simulation failed: ${simError}`,
          logs,
          '',
          `Deterministic args: base_amount_out=${computedBaseOutAtomic}, max_quote_amount_in=${computedMaxQuoteInAtomic.toString()}, track_volume=${String(trackVolume)}`,
          feeBpsLine,
          '',
          `Raw instruction preview:\n${asPrettyJson(rawPreview)}`,
        ].join('\n'),
      );
    }

    const simBase = simulation.accounts.find((entry) => entry.address === userBaseAta);
    const simQuote = simulation.accounts.find((entry) => entry.address === userQuoteAta);
    const postBaseAtomic = readSplTokenAmountFromSimAccount(simBase?.dataBase64 ?? null);
    const postQuoteAtomic = readSplTokenAmountFromSimAccount(simQuote?.dataBase64 ?? null);
    const estimatedOutAtomicBigint = postBaseAtomic > preBaseAtomic ? postBaseAtomic - preBaseAtomic : 0n;
    const totalQuoteBeforeSwap = preQuoteAtomic + computedMaxQuoteInAtomic;
    const estimatedQuoteSpentAtomicBigint =
      totalQuoteBeforeSwap > postQuoteAtomic ? totalQuoteBeforeSwap - postQuoteAtomic : 0n;

    if (options.value.simulate) {
      pushMessage(
        'assistant',
        [
          'Pump AMM simulate (deterministic math + simulation):',
          `token: ${options.value.tokenMint}`,
          `pool: ${selectedPoolAddress}`,
          `input: ${options.value.amountUiSol} SOL (${options.value.amountAtomic} lamports)`,
          `computed base_amount_out: ${computedBaseOutAtomic} base atomic`,
          `computed max_quote_amount_in: ${computedMaxQuoteInAtomic.toString()} lamports`,
          lpFeeBps !== null && protocolFeeBps !== null && creatorFeeBps !== null
            ? `fee bps (lp/protocol/creator): ${lpFeeBps}/${protocolFeeBps}/${creatorFeeBps}`
            : 'fee bps (lp/protocol/creator): n/a',
          `simulated output: ${estimatedOutAtomicBigint.toString()} base atomic`,
          `simulated quote spent: ${estimatedQuoteSpentAtomicBigint.toString()} lamports`,
          `simulation: ok${simulation.unitsConsumed ? ` (${simulation.unitsConsumed} CU)` : ''}`,
          'Run same command without --simulate to execute.',
        ].join('\n'),
      );
      return;
    }

    let result: Awaited<ReturnType<typeof sendIdlInstruction>>;
    try {
      result = await sendIdlInstruction({
        protocolId: prepared.protocolId,
        instructionName: prepared.instructionName,
        args: finalArgs,
        accounts: prepared.accounts,
        remainingAccounts: prepared.remainingAccounts,
        preInstructions,
        postInstructions,
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown send error.';
      const rawPreview = await getRawPreview(finalArgs);
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    pushMessage(
      'assistant',
      [
        'Pump AMM tx sent (meta IDL -> write-raw).',
        `token: ${options.value.tokenMint}`,
        `pool: ${selectedPoolAddress}`,
        `baseAmountOut: ${computedBaseOutAtomic}`,
        `maxQuoteAmountIn: ${computedMaxQuoteInAtomic.toString()}`,
        result.signature,
        result.explorerUrl,
      ].join('\n'),
    );
  }

  async function executePumpCurve(options: {
    value: PumpCurveCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to run Pump curve simulation.');
    }
    const walletPublicKey = wallet.publicKey;

    const prepared = await prepareMetaInstruction({
      protocolId: PUMP_CURVE_PROTOCOL_ID,
      operationId: PUMP_CURVE_OPERATION_ID,
      input: {
        base_mint: options.value.tokenMint,
        spendable_sol_in: options.value.amountAtomic,
        min_tokens_out: '1',
        track_volume: false,
        slippage_bps: options.value.slippageBps,
      },
      connection,
      walletPublicKey,
    });
    const mint = new PublicKey(options.value.tokenMint);
    const bondingCurve = asString(prepared.accounts.bonding_curve, 'bonding_curve');
    const associatedUser = asString(prepared.accounts.associated_user, 'associated_user');
    const tokenProgram = asString(prepared.accounts.token_program, 'token_program');
    const curveData = asRecord(prepared.derived.bonding_curve_data, 'bonding_curve_data');
    const complete = asBoolean(curveData.complete, 'bonding_curve_data.complete');
    const realTokenReserves = asIntegerLikeString(curveData.real_token_reserves, 'bonding_curve_data.real_token_reserves');
    const realSolReserves = asIntegerLikeString(curveData.real_sol_reserves, 'bonding_curve_data.real_sol_reserves');

    if (complete) {
      throw new Error(
        [
          `Bonding curve is complete for token ${options.value.tokenMint}.`,
          'This token has graduated/migrated, so Pump core /pump-curve is no longer the executable route.',
          `Try: /pump-amm ${options.value.tokenMint} ${options.value.amountUiSol} ${options.value.slippageBps} --simulate`,
        ].join('\n'),
      );
    }

    const preInstructions: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        new PublicKey(associatedUser),
        walletPublicKey,
        mint,
        new PublicKey(tokenProgram),
      ),
    ];

    let preUserAtomic = '0';
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(associatedUser), 'confirmed');
      preUserAtomic = balance.value.amount;
    } catch {
      preUserAtomic = '0';
    }

    const rawPreviewByArgs = new Map<string, Record<string, unknown>>();
    const getRawPreview = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const cacheKey = JSON.stringify(args);
      const cached = rawPreviewByArgs.get(cacheKey);
      if (cached) {
        return cached;
      }

      const preview = {
        preInstructions: preInstructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          keys: ix.keys.map((key) => ({
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          dataBase64: encodeIxDataBase64(ix.data),
        })),
        mainInstruction: await previewIdlInstruction({
          protocolId: prepared.protocolId,
          instructionName: prepared.instructionName,
          args,
          accounts: prepared.accounts,
          remainingAccounts: prepared.remainingAccounts,
          walletPublicKey,
        }),
      };
      rawPreviewByArgs.set(cacheKey, preview);
      return preview;
    };

    const provisionalArgs = prepared.args as Record<string, unknown>;
    let simulation: Awaited<ReturnType<typeof simulateIdlInstruction>>;
    try {
      simulation = await simulateIdlInstruction({
        protocolId: prepared.protocolId,
        instructionName: prepared.instructionName,
        args: provisionalArgs,
        accounts: prepared.accounts,
        remainingAccounts: prepared.remainingAccounts,
        preInstructions,
        postInstructions: [],
        includeAccounts: [associatedUser],
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown simulation error.';
      const rawPreview = await getRawPreview(provisionalArgs);
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    if (!simulation.ok) {
      const rawPreview = await getRawPreview(provisionalArgs);
      const simError = simulation.error ?? 'unknown';
      const logs = simulation.logs.join('\n');
      const isCurveComplete =
        simError.includes('6005') ||
        logs.includes('BondingCurveComplete') ||
        logs.includes('Error Number: 6005');
      if (isCurveComplete) {
        throw new Error(
          [
            `Bonding curve is complete for token ${options.value.tokenMint}.`,
            'This token has graduated/migrated, so Pump core /pump-curve is no longer the executable route.',
            `Try: /pump-amm ${options.value.tokenMint} ${options.value.amountUiSol} ${options.value.slippageBps} --simulate`,
          ].join('\n'),
        );
      }
      throw new Error(`Simulation failed: ${simError}\n${logs}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    const simUser = simulation.accounts.find((entry) => entry.address === associatedUser);
    const postUserAtomic = readSplTokenAmountFromSimAccount(simUser?.dataBase64 ?? null);
    const estimatedOut = postUserAtomic > BigInt(preUserAtomic) ? postUserAtomic - BigInt(preUserAtomic) : 0n;
    if (estimatedOut <= 0n) {
      throw new Error('Could not estimate Pump curve output from simulation (estimated output is zero).');
    }

    const minOut = (estimatedOut * BigInt(10_000 - options.value.slippageBps)) / 10_000n;
    const minOutAtomic = (minOut > 0n ? minOut : 1n).toString();

    const finalArgs = {
      ...provisionalArgs,
      min_tokens_out: minOutAtomic,
    };

    let tokenDecimals = 6;
    try {
      const tokenSupply = await connection.getTokenSupply(mint, 'confirmed');
      tokenDecimals = tokenSupply.value.decimals;
    } catch {
      tokenDecimals = 6;
    }

    const estimatedOutUi = formatTokenAmount(estimatedOut.toString(), tokenDecimals);
    const minOutUi = formatTokenAmount(minOutAtomic, tokenDecimals);
    if (options.value.simulate) {
      pushMessage(
        'assistant',
        [
          'Pump bonding-curve simulate (meta IDL + simulation):',
          `token: ${options.value.tokenMint}`,
          `bondingCurve: ${bondingCurve}`,
          `input: ${options.value.amountUiSol} SOL (${options.value.amountAtomic} lamports)`,
          `estimated output: ${estimatedOutUi} tokens (${estimatedOut.toString()} atomic)`,
          `min output @ ${options.value.slippageBps} bps: ${minOutUi} tokens (${minOutAtomic} atomic)`,
          `curve status: complete=${complete}, real_token_reserves=${realTokenReserves}, real_sol_reserves=${realSolReserves}`,
          `simulation: ok${simulation.unitsConsumed ? ` (${simulation.unitsConsumed} CU)` : ''}`,
          'Run same command without --simulate to execute.',
        ].join('\n'),
      );
      return;
    }

    let result: Awaited<ReturnType<typeof sendIdlInstruction>>;
    try {
      result = await sendIdlInstruction({
        protocolId: prepared.protocolId,
        instructionName: prepared.instructionName,
        args: finalArgs,
        accounts: prepared.accounts,
        remainingAccounts: prepared.remainingAccounts,
        preInstructions,
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown send error.';
      const rawPreview = await getRawPreview(finalArgs);
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    pushMessage(
      'assistant',
      [
        'Pump curve tx sent (meta IDL -> write-raw).',
        `token: ${options.value.tokenMint}`,
        `bondingCurve: ${bondingCurve}`,
        `minTokensOut: ${minOutUi} (${minOutAtomic})`,
        result.signature,
        result.explorerUrl,
      ].join('\n'),
    );
  }

  function buildKaminoAtaPreInstructions(options: {
    owner: PublicKey;
    userLiquidityAta: string;
    liquidityMint: string;
    liquidityTokenProgram: string;
    userCollateralAta: string;
    collateralMint: string;
    collateralTokenProgram: string;
  }): TransactionInstruction[] {
    return [
      createAssociatedTokenAccountIdempotentInstruction(
        options.owner,
        new PublicKey(options.userLiquidityAta),
        options.owner,
        new PublicKey(options.liquidityMint),
        new PublicKey(options.liquidityTokenProgram),
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        options.owner,
        new PublicKey(options.userCollateralAta),
        options.owner,
        new PublicKey(options.collateralMint),
        new PublicKey(options.collateralTokenProgram),
      ),
    ];
  }

  async function prepareKaminoResolvedReserve(options: {
    reserveOrVault: string;
    tokenMint: string;
    walletPublicKey: PublicKey;
  }): Promise<{
    reserveAddress: string;
    resolvedBy: string;
    reserveData: Record<string, unknown>;
    mintDecimals: number;
    liquidityMint: string;
  }> {
    const prepared = await prepareMetaOperation({
      protocolId: KAMINO_KLEND_PROTOCOL_ID,
      operationId: 'resolve_reserve',
      input: {
        reserve_or_vault: options.reserveOrVault,
        token_mint: options.tokenMint,
      },
      connection,
      walletPublicKey: options.walletPublicKey,
    });

    const reserveAddress = asString(prepared.derived.reserve, 'reserve');
    const resolvedByRaw = prepared.derived.resolved_by ?? prepared.derived.resolvedBy;
    const resolvedBy = resolvedByRaw === undefined ? 'unknown' : asString(resolvedByRaw, 'resolved_by');
    const reserveData = asRecord(prepared.derived.reserve_data ?? prepared.derived.reserveData, 'reserve_data');
    const reserveLiquidity = asRecord(reserveData.liquidity, 'reserve_data.liquidity');
    const liquidityMint = asString(reserveLiquidity.mintPubkey, 'reserve_data.liquidity.mintPubkey');
    const mintDecimals = Number(asIntegerLikeString(reserveLiquidity.mintDecimals, 'reserve_data.liquidity.mintDecimals'));
    if (!Number.isFinite(mintDecimals) || mintDecimals < 0 || mintDecimals > 18) {
      throw new Error(`Invalid Kamino mint decimals: ${String(reserveLiquidity.mintDecimals)}.`);
    }

    return {
      reserveAddress,
      resolvedBy,
      reserveData,
      mintDecimals,
      liquidityMint,
    };
  }

  function formatBpsAsPercent(bpsRaw: unknown): string {
    const bps = Number(asIntegerLikeString(bpsRaw, 'bps'));
    return `${(bps / 100).toFixed(2)}%`;
  }

  function estimateApyFromAprBps(aprBpsRaw: unknown): number {
    const aprBps = Number(asIntegerLikeString(aprBpsRaw, 'apr_bps'));
    const apr = aprBps / 10_000;
    return Math.pow(1 + apr / 365, 365) - 1;
  }

  async function executeKaminoDeposit(options: {
    value: KaminoDepositCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to run Kamino deposit.');
    }
    const walletPublicKey = wallet.publicKey;
    const resolved = await prepareKaminoResolvedReserve({
      reserveOrVault: options.value.reserveOrVault,
      tokenMint: options.value.tokenMint,
      walletPublicKey,
    });
    const liquidityAmountAtomic = parseUiAmountToAtomic(options.value.amountUi, resolved.mintDecimals);
    if (liquidityAmountAtomic <= 0n) {
      throw new Error('AMOUNT must be greater than zero.');
    }

    const prepared = await prepareMetaInstruction({
      protocolId: KAMINO_KLEND_PROTOCOL_ID,
      operationId: KAMINO_DEPOSIT_OPERATION_ID,
      input: {
        reserve_or_vault: options.value.reserveOrVault,
        token_mint: options.value.tokenMint,
        liquidity_amount: liquidityAmountAtomic.toString(),
      },
      connection,
      walletPublicKey,
    });

    const preInstructions = buildKaminoAtaPreInstructions({
      owner: walletPublicKey,
      userLiquidityAta: prepared.accounts.userSourceLiquidity,
      liquidityMint: prepared.accounts.reserveLiquidityMint,
      liquidityTokenProgram: prepared.accounts.liquidityTokenProgram,
      userCollateralAta: prepared.accounts.userDestinationCollateral,
      collateralMint: prepared.accounts.reserveCollateralMint,
      collateralTokenProgram: prepared.accounts.collateralTokenProgram,
    });

    let preSourceAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(prepared.accounts.userSourceLiquidity), 'confirmed');
      preSourceAtomic = BigInt(balance.value.amount);
    } catch {
      preSourceAtomic = 0n;
    }
    let preCollateralAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(
        new PublicKey(prepared.accounts.userDestinationCollateral),
        'confirmed',
      );
      preCollateralAtomic = BigInt(balance.value.amount);
    } catch {
      preCollateralAtomic = 0n;
    }

    const args = prepared.args as Record<string, unknown>;
    const simulation = await simulateIdlInstruction({
      protocolId: prepared.protocolId,
      instructionName: prepared.instructionName,
      args,
      accounts: prepared.accounts,
      preInstructions,
      includeAccounts: [prepared.accounts.userSourceLiquidity, prepared.accounts.userDestinationCollateral],
      connection,
      wallet,
    });
    if (!simulation.ok) {
      throw new Error(`Simulation failed: ${simulation.error ?? 'unknown'}\n${simulation.logs.join('\n')}`);
    }

    const simSource = simulation.accounts.find((entry) => entry.address === prepared.accounts.userSourceLiquidity);
    const simCollateral = simulation.accounts.find((entry) => entry.address === prepared.accounts.userDestinationCollateral);
    const postSourceAtomic = readSplTokenAmountFromSimAccount(simSource?.dataBase64 ?? null);
    const postCollateralAtomic = readSplTokenAmountFromSimAccount(simCollateral?.dataBase64 ?? null);
    const estimatedLiquiditySpent = preSourceAtomic > postSourceAtomic ? preSourceAtomic - postSourceAtomic : 0n;
    const estimatedCollateralMinted =
      postCollateralAtomic > preCollateralAtomic ? postCollateralAtomic - preCollateralAtomic : 0n;

    if (options.value.simulate) {
      pushMessage(
        'assistant',
        [
          'Kamino deposit simulate:',
          `resolved reserve: ${resolved.reserveAddress} (${resolved.resolvedBy})`,
          `liquidity mint: ${resolved.liquidityMint}`,
          `input amount: ${options.value.amountUi} (${liquidityAmountAtomic.toString()} atomic)`,
          `estimated liquidity spent: ${estimatedLiquiditySpent.toString()} atomic`,
          `estimated collateral minted: ${estimatedCollateralMinted.toString()} atomic`,
          `simulation: ok${simulation.unitsConsumed ? ` (${simulation.unitsConsumed} CU)` : ''}`,
          'Run same command without --simulate to execute.',
        ].join('\n'),
      );
      return;
    }

    const result = await sendIdlInstruction({
      protocolId: prepared.protocolId,
      instructionName: prepared.instructionName,
      args,
      accounts: prepared.accounts,
      preInstructions,
      connection,
      wallet,
    });

    pushMessage(
      'assistant',
      [
        'Kamino deposit tx sent.',
        `reserve: ${resolved.reserveAddress}`,
        `liquidity amount: ${options.value.amountUi} (${liquidityAmountAtomic.toString()} atomic)`,
        result.signature,
        result.explorerUrl,
      ].join('\n'),
    );
  }

  async function executeKaminoWithdraw(options: {
    value: KaminoWithdrawCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to run Kamino withdraw.');
    }
    const walletPublicKey = wallet.publicKey;
    const resolved = await prepareKaminoResolvedReserve({
      reserveOrVault: options.value.reserveOrVault,
      tokenMint: options.value.tokenMint,
      walletPublicKey,
    });
    const liquidityAmountAtomic = parseUiAmountToAtomic(options.value.amountUi, resolved.mintDecimals);
    if (liquidityAmountAtomic <= 0n) {
      throw new Error('AMOUNT must be greater than zero.');
    }

    const prepared = await prepareMetaInstruction({
      protocolId: KAMINO_KLEND_PROTOCOL_ID,
      operationId: KAMINO_WITHDRAW_OPERATION_ID,
      input: {
        reserve_or_vault: options.value.reserveOrVault,
        token_mint: options.value.tokenMint,
        liquidity_amount: liquidityAmountAtomic.toString(),
      },
      connection,
      walletPublicKey,
    });
    const args = prepared.args as Record<string, unknown>;
    const collateralAmount = asIntegerLikeString(args.collateralAmount, 'args.collateralAmount');

    const preInstructions = buildKaminoAtaPreInstructions({
      owner: walletPublicKey,
      userLiquidityAta: prepared.accounts.userDestinationLiquidity,
      liquidityMint: prepared.accounts.reserveLiquidityMint,
      liquidityTokenProgram: prepared.accounts.liquidityTokenProgram,
      userCollateralAta: prepared.accounts.userSourceCollateral,
      collateralMint: prepared.accounts.reserveCollateralMint,
      collateralTokenProgram: prepared.accounts.collateralTokenProgram,
    });

    let preLiquidityAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(
        new PublicKey(prepared.accounts.userDestinationLiquidity),
        'confirmed',
      );
      preLiquidityAtomic = BigInt(balance.value.amount);
    } catch {
      preLiquidityAtomic = 0n;
    }
    let preCollateralAtomic = 0n;
    try {
      const balance = await connection.getTokenAccountBalance(new PublicKey(prepared.accounts.userSourceCollateral), 'confirmed');
      preCollateralAtomic = BigInt(balance.value.amount);
    } catch {
      preCollateralAtomic = 0n;
    }

    const simulation = await simulateIdlInstruction({
      protocolId: prepared.protocolId,
      instructionName: prepared.instructionName,
      args,
      accounts: prepared.accounts,
      preInstructions,
      includeAccounts: [prepared.accounts.userDestinationLiquidity, prepared.accounts.userSourceCollateral],
      connection,
      wallet,
    });
    if (!simulation.ok) {
      throw new Error(`Simulation failed: ${simulation.error ?? 'unknown'}\n${simulation.logs.join('\n')}`);
    }

    const simLiquidity = simulation.accounts.find((entry) => entry.address === prepared.accounts.userDestinationLiquidity);
    const simCollateral = simulation.accounts.find((entry) => entry.address === prepared.accounts.userSourceCollateral);
    const postLiquidityAtomic = readSplTokenAmountFromSimAccount(simLiquidity?.dataBase64 ?? null);
    const postCollateralAtomic = readSplTokenAmountFromSimAccount(simCollateral?.dataBase64 ?? null);
    const estimatedLiquidityOut =
      postLiquidityAtomic > preLiquidityAtomic ? postLiquidityAtomic - preLiquidityAtomic : 0n;
    const estimatedCollateralSpent =
      preCollateralAtomic > postCollateralAtomic ? preCollateralAtomic - postCollateralAtomic : 0n;

    if (options.value.simulate) {
      pushMessage(
        'assistant',
        [
          'Kamino withdraw simulate:',
          `resolved reserve: ${resolved.reserveAddress} (${resolved.resolvedBy})`,
          `requested liquidity out: ${options.value.amountUi} (${liquidityAmountAtomic.toString()} atomic)`,
          `computed collateralAmount arg: ${collateralAmount}`,
          `estimated liquidity out: ${estimatedLiquidityOut.toString()} atomic`,
          `estimated collateral spent: ${estimatedCollateralSpent.toString()} atomic`,
          `simulation: ok${simulation.unitsConsumed ? ` (${simulation.unitsConsumed} CU)` : ''}`,
          'Run same command without --simulate to execute.',
        ].join('\n'),
      );
      return;
    }

    const result = await sendIdlInstruction({
      protocolId: prepared.protocolId,
      instructionName: prepared.instructionName,
      args,
      accounts: prepared.accounts,
      preInstructions,
      connection,
      wallet,
    });

    pushMessage(
      'assistant',
      [
        'Kamino withdraw tx sent.',
        `reserve: ${resolved.reserveAddress}`,
        `computed collateralAmount: ${collateralAmount}`,
        result.signature,
        result.explorerUrl,
      ].join('\n'),
    );
  }

  async function executeKaminoViewPosition(options: {
    value: KaminoViewPositionCommand;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to view Kamino position.');
    }
    const walletPublicKey = wallet.publicKey;
    const prepared = await prepareMetaOperation({
      protocolId: KAMINO_KLEND_PROTOCOL_ID,
      operationId: KAMINO_VIEW_OPERATION_ID,
      input: {
        reserve_or_vault: options.value.reserveOrVault,
        token_mint: options.value.tokenMint,
      },
      connection,
      walletPublicKey,
    });

    const reserveAddress = asString(prepared.derived.reserve, 'reserve');
    const resolvedByRaw = prepared.derived.resolved_by ?? prepared.derived.resolvedBy;
    const resolvedBy = resolvedByRaw === undefined ? 'unknown' : asString(resolvedByRaw, 'resolved_by');
    const reserveData = asRecord(prepared.derived.reserve_data ?? prepared.derived.reserveData, 'reserve_data');
    const reserveLiquidity = asRecord(reserveData.liquidity, 'reserve_data.liquidity');
    const liquidityMint = asString(reserveLiquidity.mintPubkey, 'reserve_data.liquidity.mintPubkey');
    const mintDecimals = Number(asIntegerLikeString(reserveLiquidity.mintDecimals, 'reserve_data.liquidity.mintDecimals'));

    const userLiquidityAta = asString(prepared.derived.user_liquidity_ata, 'user_liquidity_ata');
    const userCollateralAta = asString(prepared.derived.user_collateral_ata, 'user_collateral_ata');
    const userLiquidityBalanceAtomic = asIntegerLikeString(
      prepared.derived.user_liquidity_balance,
      'user_liquidity_balance',
    );
    const userCollateralBalanceAtomic = asIntegerLikeString(
      prepared.derived.user_collateral_balance,
      'user_collateral_balance',
    );
    const estimatedLiquidityClaimAtomic = asIntegerLikeString(
      prepared.derived.estimated_redeemable_liquidity,
      'estimated_redeemable_liquidity',
    );
    const reserveUtilizationBps = asIntegerLikeString(prepared.derived.reserve_utilization_bps, 'reserve_utilization_bps');
    const supplyAprBps = asIntegerLikeString(prepared.derived.supply_apr_bps, 'supply_apr_bps');
    const supplyApyApprox = estimateApyFromAprBps(supplyAprBps);
    const liquidityUi = formatTokenAmount(userLiquidityBalanceAtomic, mintDecimals);
    const claimUi = formatTokenAmount(estimatedLiquidityClaimAtomic, mintDecimals);

    pushMessage(
      'assistant',
      [
        'Kamino position:',
        `resolved reserve: ${reserveAddress} (${resolvedBy})`,
        `liquidity mint: ${liquidityMint}`,
        `liquidity ATA: ${userLiquidityAta}`,
        `collateral ATA: ${userCollateralAta}`,
        `wallet liquidity balance: ${liquidityUi} (${userLiquidityBalanceAtomic} atomic)`,
        `wallet collateral balance: ${userCollateralBalanceAtomic} cToken atomic`,
        `estimated redeemable liquidity: ${claimUi} (${estimatedLiquidityClaimAtomic} atomic)`,
        `reserve utilization: ${formatBpsAsPercent(reserveUtilizationBps)} (${reserveUtilizationBps} bps)`,
        `estimated supply APR: ${formatBpsAsPercent(supplyAprBps)} (${supplyAprBps} bps)`,
        `estimated supply APY (daily comp approximation): ${formatPercent(supplyApyApprox)}`,
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

    if (!wallet.publicKey) {
      setBuilderStatusText('Error: Connect wallet first.');
      setBuilderRawDetails(null);
      return;
    }

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

      let executionInput = { ...inputPayload };
      let prepared = await prepareMetaOperation({
        protocolId: builderProtocolId,
        operationId: selectedBuilderOperation.operationId,
        input: executionInput,
        connection,
        walletPublicKey: wallet.publicKey,
      });
      const builderNotes: string[] = [];

      if (
        builderProtocolId === ORCA_PROTOCOL_ID &&
        selectedBuilderOperation.operationId === ORCA_OPERATION_ID
      ) {
        const pass1Input = {
          ...executionInput,
          estimated_out: '0',
        };

        const pass1Prepared = await prepareMetaOperation({
          protocolId: builderProtocolId,
          operationId: selectedBuilderOperation.operationId,
          input: pass1Input,
          connection,
          walletPublicKey: wallet.publicKey,
        });

        if (!pass1Prepared.instructionName) {
          throw new Error('Orca pass-1 operation did not produce an executable instruction.');
        }

        const pass1PreInstructions = buildBuilderPreInstructions({
          protocolId: pass1Prepared.protocolId,
          derived: pass1Prepared.derived,
          accounts: pass1Prepared.accounts,
          walletPublicKey: wallet.publicKey,
        });
        const pass1AToB = asBoolean(pass1Prepared.derived.a_to_b, 'derived.a_to_b');
        const pass1OutputAta = pass1AToB
          ? pass1Prepared.accounts.token_owner_account_b
          : pass1Prepared.accounts.token_owner_account_a;
        let pass1PreOutputAtomic = 0n;
        try {
          const balance = await connection.getTokenAccountBalance(new PublicKey(pass1OutputAta), 'confirmed');
          pass1PreOutputAtomic = BigInt(balance.value.amount);
        } catch {
          pass1PreOutputAtomic = 0n;
        }

        const pass1Simulation = await simulateIdlInstruction({
          protocolId: pass1Prepared.protocolId,
          instructionName: pass1Prepared.instructionName,
          args: pass1Prepared.args,
          accounts: pass1Prepared.accounts,
          remainingAccounts: pass1Prepared.remainingAccounts,
          preInstructions: pass1PreInstructions,
          postInstructions: [],
          includeAccounts: [pass1OutputAta],
          connection,
          wallet,
        });
        if (!pass1Simulation.ok) {
          throw new Error(
            `Orca pass-1 simulation failed: ${pass1Simulation.error ?? 'unknown'}\n${pass1Simulation.logs.join('\n')}`,
          );
        }

        const pass1OutputAccount = pass1Simulation.accounts.find((entry) => entry.address === pass1OutputAta);
        const pass1PostOutputAtomic = readSplTokenAmountFromSimAccount(pass1OutputAccount?.dataBase64 ?? null);
        const computedEstimatedOut =
          pass1PostOutputAtomic > pass1PreOutputAtomic ? pass1PostOutputAtomic - pass1PreOutputAtomic : 0n;
        if (computedEstimatedOut <= 0n) {
          throw new Error('Orca pass-1 simulation produced zero estimated output.');
        }

        executionInput = {
          ...executionInput,
          estimated_out: computedEstimatedOut.toString(),
        };
        prepared = await prepareMetaOperation({
          protocolId: builderProtocolId,
          operationId: selectedBuilderOperation.operationId,
          input: executionInput,
          connection,
          walletPublicKey: wallet.publicKey,
        });
        builderNotes.push(`computed estimated_out via simulation pass-1: ${computedEstimatedOut.toString()}`);
      }

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

      const preInstructions = buildBuilderPreInstructions({
        protocolId: prepared.protocolId,
        derived: prepared.derived,
        accounts: prepared.accounts,
        walletPublicKey: wallet.publicKey,
      });
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
        if (
          builderProtocolId === ORCA_PROTOCOL_ID &&
          selectedBuilderOperation.operationId === ORCA_OPERATION_ID &&
          typeof executionInput.token_in_mint === 'string' &&
          typeof executionInput.token_out_mint === 'string'
        ) {
          const inMint = executionInput.token_in_mint;
          const outMint = executionInput.token_out_mint;
          const inLabel = getMintDisplay(inMint).label;
          const outLabel = getMintDisplay(outMint).label;

          const amountInAtomic = asIntegerLikeString(prepared.args.amount, 'args.amount');
          const estimatedOutAtomic = asIntegerLikeString(
            executionInput.estimated_out ?? '0',
            'input.estimated_out',
          );
          const minOutAtomic = asIntegerLikeString(
            prepared.args.other_amount_threshold,
            'args.other_amount_threshold',
          );
          const slippageBps = asIntegerLikeString(
            executionInput.slippage_bps ?? '0',
            'input.slippage_bps',
          );

          simulationHighlights.push(`pair: ${inLabel}/${outLabel}`);
          simulationHighlights.push(`amount in: ${formatAmountWithMint(amountInAtomic, inMint)}`);
          simulationHighlights.push(`estimated out: ${formatAmountWithMint(estimatedOutAtomic, outMint)}`);
          simulationHighlights.push(`min out (slippage ${slippageBps} bps): ${formatAmountWithMint(minOutAtomic, outMint)}`);
          if (typeof prepared.accounts.whirlpool === 'string') {
            simulationHighlights.push(`pool: ${prepared.accounts.whirlpool}`);
          }
        }

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

      if (parsed.kind === 'orca') {
        await executeOrca({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'orca-list-pools') {
        await executeOrcaListPools({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'pump-amm') {
        await executePumpAmm({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'pump-curve') {
        await executePumpCurve({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'kamino-deposit') {
        await executeKaminoDeposit({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'kamino-withdraw') {
        await executeKaminoWithdraw({
          value: parsed.value,
        });
        return;
      }

      if (parsed.kind === 'kamino-view-position') {
        await executeKaminoViewPosition({
          value: parsed.value,
        });
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

        {activeTab === 'builder' ? (
          <div className="builder-mode-switch builder-mode-switch-global" role="tablist" aria-label="Builder audience mode">
            <button
              type="button"
              className={builderViewMode === 'enduser' ? 'active' : ''}
              onClick={handleBuilderModeEndUser}
              disabled={isWorking}
            >
              End User
            </button>
            <button
              type="button"
              className={builderViewMode === 'geek' ? 'active' : ''}
              onClick={handleBuilderModeGeek}
              disabled={isWorking}
            >
              Geek
            </button>
          </div>
        ) : null}

        {activeTab === 'command' ? (
          <div className="chat-log" aria-live="polite">
            {messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
        ) : null}

        {activeTab === 'command' ? (
          <>
            <form className="command-form" onSubmit={handleCommandSubmit}>
              <input
                type="text"
                value={commandInput}
                onChange={(event) => setCommandInput(event.target.value)}
                placeholder="/orca-list-pools SOL USDC"
                disabled={isWorking}
                aria-label="Command input"
              />
              <button type="submit" disabled={isWorking}>
                {isWorking ? 'Running...' : 'Run'}
              </button>
            </form>
            <div className="quick-actions">
              <button
                type="button"
                onClick={() => setCommandInput(QUICK_PREFILL_ORCA_LIST_POOLS_COMMAND)}
                disabled={isWorking}
              >
                Prefill Orca Pools
              </button>
              <button
                type="button"
                onClick={() => setCommandInput(QUICK_PREFILL_SWAP_COMMAND)}
                disabled={isWorking}
              >
                Prefill USDC-&gt;SOL 0.01
              </button>
              <button
                type="button"
                onClick={() => setCommandInput(QUICK_PREFILL_PUMP_QUOTE_COMMAND)}
                disabled={isWorking}
              >
                Prefill Pump Quote
              </button>
              <button
                type="button"
                onClick={() => setCommandInput(QUICK_PREFILL_PUMP_CURVE_COMMAND)}
                disabled={isWorking}
              >
                Prefill Pump Curve
              </button>
              <button
                type="button"
                onClick={() => setCommandInput(QUICK_PREFILL_KAMINO_DEPOSIT_COMMAND)}
                disabled={isWorking}
              >
                Prefill Kamino Deposit
              </button>
            </div>
          </>
        ) : (
          <section className="builder-shell" aria-live="polite">
            <div className="builder-grid">
              <aside className="builder-list">
                <h3>Protocols</h3>
                <div className="builder-items">
                  {builderProtocols.map((protocol) => (
                    <button
                      key={protocol.id}
                      type="button"
                      className={builderProtocolId === protocol.id ? 'active' : ''}
                      onClick={() => setBuilderProtocolId(protocol.id)}
                      disabled={isWorking}
                    >
                      {protocol.name}
                      <small>{protocol.id}</small>
                    </button>
                  ))}
                </div>
              </aside>

              <aside className="builder-list">
                <h3>{builderViewMode === 'enduser' ? 'Apps' : 'Actions'}</h3>
                <div className="builder-items">
                  {builderViewMode === 'enduser'
                    ? builderApps.length > 0
                      ? builderApps.map((app) => (
                          <button
                            key={app.appId}
                            type="button"
                            className={builderAppId === app.appId ? 'active' : ''}
                            onClick={() => {
                              setBuilderAppId(app.appId);
                              const entryIndex = app.steps.findIndex((step) => step.stepId === app.entryStepId);
                              setBuilderAppStepIndex(entryIndex >= 0 ? entryIndex : 0);
                              setBuilderAppStepContexts({});
                              setBuilderAppStepCompleted({});
                              const entryStep = app.steps.find((step) => step.stepId === app.entryStepId) ?? app.steps[0];
                              if (entryStep) {
                                setBuilderOperationId(entryStep.operationId);
                              }
                            }}
                            disabled={isWorking}
                          >
                            {app.title}
                            <small>{app.appId}</small>
                          </button>
                        ))
                      : (
                          <p className="builder-empty">No end-user apps declared for this protocol.</p>
                        )
                    : builderOperations.map((operation) => (
                        <button
                          key={operation.operationId}
                          type="button"
                          className={builderOperationId === operation.operationId ? 'active' : ''}
                          onClick={() => setBuilderOperationId(operation.operationId)}
                          disabled={isWorking}
                        >
                          {operation.operationId}
                          <small>{operation.instruction || 'read-only'}</small>
                        </button>
                      ))}
                </div>
              </aside>
            </div>

            {selectedBuilderOperation ? (
              <form className="builder-form" onSubmit={handleBuilderSubmit}>
                <h3>
                  {builderProtocolId}/{selectedBuilderOperation.operationId}
                </h3>
                {builderViewMode === 'enduser' && selectedBuilderApp ? (
                  <>
                    <p>
                      app: <strong>{selectedBuilderApp.title}</strong>
                      {selectedBuilderApp.description ? ` — ${selectedBuilderApp.description}` : ''}
                    </p>
                    <div className="builder-step-list">
                      {selectedBuilderApp.steps.map((step, index) => (
                        <button
                          key={step.stepId}
                          type="button"
                          className={builderAppStepIndex === index ? 'active' : ''}
                          disabled={isWorking || !canOpenBuilderAppStep(index)}
                          onClick={() => {
                            if (!canOpenBuilderAppStep(index)) {
                              return;
                            }
                            setBuilderAppStepIndex(index);
                            setBuilderOperationId(step.operationId);
                          }}
                        >
                          {index + 1}. {step.title}
                        </button>
                      ))}
                    </div>
                    {builderAppStepIndex > 0 ? (
                      <button
                        type="button"
                        className="builder-back"
                        onClick={handleBuilderAppBackStep}
                        disabled={isWorking}
                      >
                        Back to previous step
                      </button>
                    ) : null}
                    {selectedBuilderAppStep?.description ? (
                      <p className="builder-note">{selectedBuilderAppStep.description}</p>
                    ) : null}
                  </>
                ) : null}
                <p>
                  instruction: <code>{selectedBuilderOperation.instruction || 'read-only'}</code>
                </p>

                {showBuilderSelectableItems ? (
                  <div className="builder-pool-selection">
                    <p className="builder-note">
                      {selectedBuilderAppSelectUi?.title ?? 'Choose one item to unlock the next step.'}
                    </p>
                    {selectedBuilderAppSelectUi?.description ? (
                      <p className="builder-note">{selectedBuilderAppSelectUi.description}</p>
                    ) : null}
                    <div className="builder-pool-list">
                      {selectedBuilderAppSelectableItems.map((item, index) => {
                        const itemValue =
                          selectedBuilderAppSelectUi
                            ? readBuilderPath(item, selectedBuilderAppSelectUi.valuePath)
                            : undefined;
                        const isSelected = valuesEqualForSelection(itemValue, selectedBuilderSelectedItemValue);
                        return (
                        <button
                          key={`${String(itemValue ?? index)}-${index}`}
                          type="button"
                          className={isSelected ? 'active' : ''}
                          disabled={isWorking}
                          onClick={() => handleBuilderAppSelectItem(item)}
                        >
                          {selectedBuilderAppSelectUi
                            ? formatBuilderSelectableItemLabel(item, index, selectedBuilderAppSelectUi)
                            : `${index + 1}. ${String(item)}`}
                        </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="builder-back"
                      onClick={handleBuilderAppResetCurrentStep}
                      disabled={isWorking}
                    >
                      Back to search form
                    </button>
                  </div>
                ) : (
                  <>
                    {hiddenBuilderInputsCount > 0 && builderViewMode === 'enduser' ? (
                      <p className="builder-note">
                        {hiddenBuilderInputsCount} field(s) auto-resolved (default/derived/computed). Switch to Geek mode to view them.
                      </p>
                    ) : null}

                    <div className="builder-inputs">
                      {visibleBuilderInputs.map(([inputName, spec]) => {
                        const editable = isBuilderInputEditable(spec);
                        const fieldTag = getBuilderInputTag(spec);
                        return (
                        <label key={inputName}>
                          <span>
                            {inputName} <code>{spec.type}</code>{' '}
                            {spec.required ? <strong>({fieldTag})</strong> : <em>({fieldTag})</em>}
                          </span>
                          <input
                            type="text"
                            value={builderInputValues[inputName] ?? ''}
                            onChange={(event) =>
                              setBuilderInputValues((prev) => ({
                                ...prev,
                                [inputName]: event.target.value,
                              }))
                            }
                            placeholder={
                              spec.default !== undefined
                                ? `default: ${stringifyBuilderDefault(spec.default)}`
                                : spec.discover_from
                                  ? `discover_from: ${spec.discover_from}`
                                : ''
                            }
                            disabled={isWorking || !editable}
                          />
                        </label>
                        );
                      })}
                    </div>

                    {isBuilderAppMode ? (
                      <div className="builder-controls builder-controls-app">
                        <button
                          type="button"
                          className="builder-prefill"
                          onClick={handleBuilderPrefillExample}
                          disabled={isWorking}
                        >
                          Prefill Example Data
                        </button>
                        {selectedBuilderOperation.instruction ? (
                          <>
                            <button
                              type="submit"
                              className="builder-submit"
                              disabled={isWorking}
                              onClick={() => setBuilderAppSubmitMode('simulate')}
                            >
                              {isWorking && builderAppSubmitMode === 'simulate' ? 'Running...' : 'Run Simulation'}
                            </button>
                            <button
                              type="submit"
                              className="builder-submit builder-submit-secondary"
                              disabled={isWorking}
                              onClick={() => setBuilderAppSubmitMode('send')}
                            >
                              {isWorking && builderAppSubmitMode === 'send' ? 'Running...' : 'Send Transaction'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="submit"
                            className="builder-submit"
                            disabled={isWorking}
                          >
                            {isWorking ? 'Running...' : 'Run'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="builder-controls">
                          <label className="builder-checkbox">
                            <input
                              type="checkbox"
                              checked={builderSimulate}
                              onChange={(event) => setBuilderSimulate(event.target.checked)}
                              disabled={isWorking}
                            />
                            simulate only (recommended first)
                          </label>
                          <button
                            type="button"
                            className="builder-prefill"
                            onClick={handleBuilderPrefillExample}
                            disabled={isWorking}
                          >
                            Prefill Example Data
                          </button>
                        </div>

                        <button type="submit" className="builder-submit" disabled={isWorking}>
                          {isWorking ? 'Running...' : builderSimulate ? 'Run Simulation' : 'Send Transaction'}
                        </button>
                      </>
                    )}
                  </>
                )}
              </form>
            ) : (
              <div className="builder-empty">Select a protocol and action to start.</div>
            )}

            {builderStatusText ? (
              <div>
                <pre className="builder-output">{builderStatusText}</pre>
                {builderRawDetails ? (
                  <>
                    <button
                      type="button"
                      className="builder-raw-toggle"
                      onClick={() => setBuilderShowRawDetails((current) => !current)}
                    >
                      {builderShowRawDetails ? 'Hide raw details' : 'Show raw details'}
                    </button>
                    {builderShowRawDetails ? <pre className="builder-output">{builderRawDetails}</pre> : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
        )}
      </section>
    </main>
  );
}

export default App;
