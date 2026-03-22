import { useEffect, useState, type FormEvent } from 'react';
import type { MetaAppSummary, MetaOperationSummary } from '@brij-digital/apppack-runtime/metaIdlRuntime';
import { listSupportedTokens, resolveToken } from '../../constants/tokens';
import {
  formatBuilderSelectableItemLabel,
  getBuilderInputMode,
  isBuilderInputEditable,
  readBuilderPath,
  stringifyBuilderDefault,
  valuesEqualForSelection,
} from '../builderHelpers';
import type { BuilderStepAction } from '../useBuilderController';
import type { OperationEnhancement } from '../metaEnhancements';

type BuilderViewMode = 'forms' | 'raw';
type BuilderAppSubmitMode = 'simulate' | 'send';

type BuilderProtocol = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
};

type BuilderStep = MetaAppSummary['steps'][number];
type BuilderSelectUi = Extract<NonNullable<BuilderStep['ui']>, { kind: 'select_from_derived' }>;
type BuilderToast = {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
};

type BuilderTabProps = {
  isWorking: boolean;
  builderViewMode: BuilderViewMode;
  builderProtocols: BuilderProtocol[];
  builderProtocolLabelsById: Record<string, string>;
  builderProtocolId: string;
  onSelectProtocol: (protocolId: string) => void;
  builderApps: MetaAppSummary[];
  builderAppId: string;
  onSelectApp: (app: MetaAppSummary) => void;
  builderOperations: MetaOperationSummary[];
  builderOperationId: string;
  onSelectOperation: (operationId: string) => void;
  selectedBuilderOperation: MetaOperationSummary | null;
  selectedBuilderOperationEnhancement: OperationEnhancement | null;
  builderOperationLabelsByOperationId: Record<string, string>;
  selectedBuilderApp: MetaAppSummary | null;
  builderAppLabelsByAppId: Record<string, string>;
  builderStepLabelsByAppStepKey: Record<string, string>;
  selectedBuilderStepActions: BuilderStepAction[];
  builderAppStepIndex: number;
  canOpenBuilderAppStep: (index: number) => boolean;
  onOpenBuilderAppStep: (index: number) => void;
  showBuilderSelectableItems: boolean;
  onBackStep: () => void;
  onResetStep: () => void;
  selectedBuilderAppSelectUi: BuilderSelectUi | null;
  selectedBuilderAppSelectableItems: unknown[];
  selectedBuilderSelectedItemValue: unknown;
  onSelectItem: (item: unknown) => void;
  visibleBuilderInputs: Array<[string, MetaOperationSummary['inputs'][string]]>;
  builderInputValues: Record<string, string>;
  onInputChange: (name: string, value: string) => void;
  onPrefillExample: () => void;
  isBuilderAppMode: boolean;
  builderAppSubmitMode: BuilderAppSubmitMode;
  onSetBuilderAppSubmitMode: (mode: BuilderAppSubmitMode) => void;
  builderSimulate: boolean;
  onSetBuilderSimulate: (value: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  builderStatusText: string | null;
  builderRawDetails: string | null;
  builderShowRawDetails: boolean;
  onToggleRawDetails: () => void;
};

export function BuilderTab(props: BuilderTabProps) {
  const {
    isWorking,
    builderViewMode,
    builderProtocols,
    builderProtocolLabelsById,
    builderProtocolId,
    onSelectProtocol,
    builderApps,
    builderAppId,
    onSelectApp,
    builderOperations,
    builderOperationId,
    onSelectOperation,
    selectedBuilderOperation,
    selectedBuilderOperationEnhancement,
    builderOperationLabelsByOperationId,
    selectedBuilderApp,
    builderAppLabelsByAppId,
    builderStepLabelsByAppStepKey,
    selectedBuilderStepActions,
    builderAppStepIndex,
    canOpenBuilderAppStep,
    onOpenBuilderAppStep,
    showBuilderSelectableItems,
    onBackStep,
    onResetStep,
    selectedBuilderAppSelectUi,
    selectedBuilderAppSelectableItems,
    selectedBuilderSelectedItemValue,
    onSelectItem,
    visibleBuilderInputs,
    builderInputValues,
    onInputChange,
    onPrefillExample,
    isBuilderAppMode,
    builderAppSubmitMode,
    onSetBuilderAppSubmitMode,
    builderSimulate,
    onSetBuilderSimulate,
    onSubmit,
    builderStatusText,
    builderRawDetails,
    builderShowRawDetails,
    onToggleRawDetails,
  } = props;
  const [displayDraftByInput, setDisplayDraftByInput] = useState<Record<string, string>>({});
  const [builderToast, setBuilderToast] = useState<BuilderToast | null>(null);
  const visibleStepActions = isBuilderAppMode ? selectedBuilderStepActions : [];
  const selectedOperationDisplayLabel =
    (selectedBuilderOperation && builderOperationLabelsByOperationId[selectedBuilderOperation.operationId]) ||
    selectedBuilderOperation?.operationId ||
    '';
  const builderAppHeaderTitle =
    builderViewMode === 'forms' && selectedBuilderApp ? selectedBuilderApp.title : `${builderProtocolId}/${selectedOperationDisplayLabel}`;
  const supportedTokens = listSupportedTokens();
  const showTechnicalHints = builderViewMode === 'raw';

  useEffect(() => {
    if (!builderStatusText || builderViewMode !== 'forms') {
      return;
    }
    const normalized = builderStatusText.toLowerCase();
    const kind: BuilderToast['kind'] =
      normalized.includes('error') || normalized.includes('failed')
        ? 'error'
        : normalized.includes('success') || normalized.includes('completed') || normalized.includes('tx sent')
          ? 'success'
          : 'info';
    const firstLine = builderStatusText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!firstLine) {
      return;
    }
    const cleaned = firstLine
      .replace(/^Builder (simulate|result|tx sent)( \([^)]+\))?:\s*/i, '')
      .replace(/^Error:\s*/i, '');
    setBuilderToast({
      id: Date.now(),
      kind,
      text: cleaned || firstLine,
    });
  }, [builderStatusText, builderViewMode]);

  useEffect(() => {
    if (!builderToast) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setBuilderToast((current) => (current?.id === builderToast.id ? null : current));
    }, 3200);
    return () => window.clearTimeout(timeout);
  }, [builderToast]);

  const actionClassName = (action: BuilderStepAction): string => {
    if (action.do.fn === 'back' || action.do.fn === 'reset') {
      return 'builder-back';
    }
    return 'builder-submit';
  };

  const isTokenMintInput = (_inputName: string, spec: MetaOperationSummary['inputs'][string]): boolean => {
    return spec.type.toLowerCase() === 'token_mint';
  };

  useEffect(() => {
    setDisplayDraftByInput({});
  }, [builderProtocolId, selectedBuilderOperation?.operationId, builderAppStepIndex, showBuilderSelectableItems]);

  const formatAtomicAmountForDisplay = (atomicRaw: string, decimals: number): string => {
    if (atomicRaw.trim().length === 0) {
      return '';
    }
    if (!/^\d+$/.test(atomicRaw.trim())) {
      return atomicRaw;
    }
    const atomic = BigInt(atomicRaw.trim());
    const scale = 10n ** BigInt(decimals);
    const whole = atomic / scale;
    const fraction = atomic % scale;
    if (fraction === 0n) {
      return whole.toString();
    }
    const padded = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${whole.toString()}.${padded}`;
  };

  const parseDisplayAmountToAtomic = (displayRaw: string, decimals: number): string | null => {
    const raw = displayRaw.trim();
    if (raw.length === 0) {
      return '';
    }
    // Keep temporary typing state (e.g. "1.") so users can continue entering decimals.
    if (raw === '.' || raw.endsWith('.')) {
      return null;
    }
    if (!/^\d*\.?\d*$/.test(raw)) {
      return null;
    }
    const [wholeRaw, fractionRaw = ''] = raw.split('.');
    const whole = wholeRaw.length > 0 ? wholeRaw : '0';
    const clippedFraction = fractionRaw.slice(0, decimals);
    const paddedFraction = clippedFraction.padEnd(decimals, '0');
    const scale = 10n ** BigInt(decimals);
    const wholeAtomic = BigInt(whole) * scale;
    const fractionAtomic = paddedFraction.length > 0 ? BigInt(paddedFraction) : 0n;
    return (wholeAtomic + fractionAtomic).toString();
  };

  const formatBpsToPercent = (bpsRaw: string): string => {
    const raw = bpsRaw.trim();
    if (raw.length === 0) {
      return '';
    }
    if (!/^\d+$/.test(raw)) {
      return bpsRaw;
    }
    const bps = Number(raw);
    if (!Number.isFinite(bps)) {
      return bpsRaw;
    }
    return (bps / 100).toString();
  };

  const parsePercentToBps = (percentRaw: string): string | null => {
    const raw = percentRaw.trim();
    if (raw.length === 0) {
      return '';
    }
    // Keep temporary typing state (e.g. "0.") during input editing.
    if (raw === '.' || raw.endsWith('.')) {
      return null;
    }
    if (!/^\d*\.?\d*$/.test(raw)) {
      return null;
    }
    const [wholeRaw, fractionRaw = ''] = raw.split('.');
    const whole = wholeRaw.length > 0 ? wholeRaw : '0';
    const clippedFraction = fractionRaw.slice(0, 2);
    const paddedFraction = clippedFraction.padEnd(2, '0');
    return (BigInt(whole) * 100n + BigInt(paddedFraction)).toString();
  };

  const resolveAmountToken = (inputName: string): ReturnType<typeof resolveToken> => {
    const normalized = inputName.toLowerCase();
    const baseMint = builderInputValues.base_mint ?? '';
    const quoteMint = builderInputValues.quote_mint ?? '';
    const outMint = builderInputValues.token_out_mint ?? '';
    const inMint = builderInputValues.token_in_mint ?? '';
    if (normalized.includes('sol')) {
      return resolveToken('SOL');
    }
    if ((normalized.includes('quote') || normalized.includes('usdc')) && quoteMint.trim().length > 0) {
      return resolveToken(quoteMint);
    }
    if ((normalized.includes('base') || normalized.includes('token')) && baseMint.trim().length > 0) {
      return resolveToken(baseMint);
    }
    if (normalized.includes('out') && outMint.trim().length > 0) {
      return resolveToken(outMint);
    }
    if (inMint.trim().length > 0) {
      return resolveToken(inMint);
    }
    return null;
  };

  const isAmountLikeInputName = (normalizedInputName: string): boolean => {
    return (
      normalizedInputName.includes('amount') ||
      normalizedInputName.endsWith('_in') ||
      normalizedInputName.endsWith('_out')
    );
  };

  const resolveFriendlyHint = (options: {
    inputName: string;
    showTokenPicker: boolean;
    resolvedToken: ReturnType<typeof resolveToken> | null;
    amountToken: ReturnType<typeof resolveToken> | null;
    isAmountField: boolean;
    isSlippageField: boolean;
    inputMode: 'edit' | 'readonly' | 'hidden';
    specHelp?: string;
  }): string | null => {
    const {
      inputName,
      showTokenPicker,
      resolvedToken,
      amountToken,
      isAmountField,
      isSlippageField,
      inputMode,
      specHelp,
    } = options;

    if (showTechnicalHints) {
      if (showTokenPicker) {
        return resolvedToken
          ? `ticker: ${resolvedToken.symbol} | decimals: ${resolvedToken.decimals} | mint: ${resolvedToken.mint}`
          : 'Select one token from the list.';
      }
      if (isAmountField && amountToken) {
        return `Unit: ${amountToken.symbol} (${amountToken.decimals} decimals).`;
      }
      if (isSlippageField) {
        return 'Unit: percent (%).';
      }
      return specHelp ?? null;
    }

    if (showTokenPicker) {
      return resolvedToken ? `Selected: ${resolvedToken.symbol}` : 'Choose a token.';
    }
    if (isAmountField && amountToken) {
      return `Amount in ${amountToken.symbol}.`;
    }
    if (isSlippageField) {
      return 'Price tolerance in %.';
    }
    if (inputMode === 'readonly') {
      if (inputName.toLowerCase().includes('estimated')) {
        return 'Updated automatically.';
      }
      return 'Filled automatically.';
    }
    return null;
  };

  return (
    <>
      {builderToast ? (
        <div className={`builder-toast builder-toast-${builderToast.kind}`} role="status" aria-live="polite">
          <span>{builderToast.text}</span>
          <button type="button" onClick={() => setBuilderToast(null)} aria-label="Dismiss message">
            ×
          </button>
        </div>
      ) : null}
      <section className="builder-shell" aria-live="polite">
        <div className="builder-layout">
          <div className="builder-main">
            <div className="builder-grid">
              <aside className="builder-list">
                <h3>Protocols</h3>
                <div className="builder-items">
                  {builderProtocols.map((protocol) => (
                    <button
                      key={protocol.id}
                      type="button"
                      className={builderProtocolId === protocol.id ? 'active' : ''}
                      onClick={() => onSelectProtocol(protocol.id)}
                      disabled={isWorking}
                    >
                      {builderProtocolLabelsById[protocol.id] ?? protocol.name}
                      {builderViewMode === 'raw' ? <small>{protocol.id}</small> : null}
                    </button>
                  ))}
                </div>
              </aside>

              <aside className="builder-list">
                <h3>{builderViewMode === 'forms' ? 'Apps' : 'Raw Operations'}</h3>
                <div className="builder-items">
                  {builderViewMode === 'forms'
                    ? builderApps.length > 0
                      ? builderApps.map((app) => (
                          <button
                            key={app.appId}
                            type="button"
                            className={builderAppId === app.appId ? 'active' : ''}
                            onClick={() => onSelectApp(app)}
                            disabled={isWorking}
                          >
                            {builderAppLabelsByAppId[app.appId] ?? app.title}
                          </button>
                        ))
                      : <p className="builder-empty">No apps declared for this protocol.</p>
                    : builderOperations.map((operation) => (
                        <button
                          key={operation.operationId}
                          type="button"
                          className={builderOperationId === operation.operationId ? 'active' : ''}
                          onClick={() => onSelectOperation(operation.operationId)}
                          disabled={isWorking}
                        >
                          {builderOperationLabelsByOperationId[operation.operationId] ?? operation.operationId}
                          <small>{operation.instruction || 'read-only'}</small>
                        </button>
                      ))}
                </div>
              </aside>
            </div>

            {selectedBuilderOperation ? (
              <form className="builder-form" onSubmit={onSubmit}>
                <h3>{builderAppHeaderTitle}</h3>
                {builderViewMode === 'forms' && selectedBuilderApp ? (
                  <>
                    <div className="builder-step-list">
                      {selectedBuilderApp.steps.map((step, index) => (
                        <button
                          key={step.stepId}
                          type="button"
                          className={builderAppStepIndex === index ? 'active' : ''}
                          disabled={isWorking || !canOpenBuilderAppStep(index)}
                          onClick={() => onOpenBuilderAppStep(index)}
                        >
                          {builderStepLabelsByAppStepKey[`${selectedBuilderApp.appId}:${step.stepId}`] ?? step.title}
                        </button>
                      ))}
                    </div>
                    {builderAppStepIndex > 0 || showBuilderSelectableItems ? (
                      <button
                        type="button"
                        className="builder-back builder-back-icon"
                        onClick={showBuilderSelectableItems ? onResetStep : onBackStep}
                        disabled={isWorking}
                        aria-label={showBuilderSelectableItems ? 'Back to search' : 'Back'}
                        title={showBuilderSelectableItems ? 'Back to search' : 'Back'}
                      >
                        <span aria-hidden="true">←</span>
                      </button>
                    ) : null}
                  </>
                ) : null}

                {showBuilderSelectableItems ? (
                  <div className="builder-pool-selection">
                    <p className="builder-note">
                      {selectedBuilderAppSelectUi?.title ?? 'Choose one item to unlock the next step.'}
                    </p>
                    <div className="builder-pool-list">
                      {selectedBuilderAppSelectableItems.map((item, index) => {
                        const itemValue = selectedBuilderAppSelectUi
                          ? readBuilderPath(item, selectedBuilderAppSelectUi.valuePath)
                          : undefined;
                        const isSelected = valuesEqualForSelection(itemValue, selectedBuilderSelectedItemValue);
                        return (
                          <button
                            key={`${String(itemValue ?? index)}-${index}`}
                            type="button"
                            className={isSelected ? 'active' : ''}
                            disabled={isWorking}
                            onClick={() => onSelectItem(item)}
                          >
                            {selectedBuilderAppSelectUi
                              ? formatBuilderSelectableItemLabel(item, index, selectedBuilderAppSelectUi)
                              : `${index + 1}. ${String(item)}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="builder-inputs">
                      {visibleBuilderInputs.map(([inputName, spec]) => {
                        const inputMode = getBuilderInputMode(spec);
                        if (inputMode === 'hidden') {
                          return null;
                        }
                        const editable = isBuilderInputEditable(spec);
                        const value = builderInputValues[inputName] ?? '';
                        const showTokenPicker = isTokenMintInput(inputName, spec);
                        const resolvedToken = showTokenPicker ? resolveToken(value) : null;
                        const selectedMint = resolvedToken?.mint ?? '';
                        const normalizedName = inputName.toLowerCase();
                        const isAmountField =
                          !showTokenPicker &&
                          spec.type.toLowerCase() === 'u64' &&
                          isAmountLikeInputName(normalizedName);
                        const amountToken = isAmountField ? resolveAmountToken(inputName) : null;
                        const isSlippageField = !showTokenPicker && normalizedName === 'slippage_bps';
                        const draftDisplayValue = displayDraftByInput[inputName];
                        const displayValue = (() => {
                          if (draftDisplayValue !== undefined) {
                            return draftDisplayValue;
                          }
                          if (isAmountField && amountToken) {
                            return formatAtomicAmountForDisplay(value, amountToken.decimals);
                          }
                          if (isSlippageField) {
                            return formatBpsToPercent(value);
                          }
                          return value;
                        })();
                        const hintText = resolveFriendlyHint({
                          inputName,
                          showTokenPicker,
                          resolvedToken,
                          amountToken,
                          isAmountField,
                          isSlippageField,
                          inputMode,
                          specHelp: selectedBuilderOperationEnhancement?.inputUi[inputName]?.help,
                        });
                        const labelText = selectedBuilderOperationEnhancement?.inputUi[inputName]?.label ?? inputName;
                        const placeholderText = (() => {
                          const uiPlaceholder = selectedBuilderOperationEnhancement?.inputUi[inputName]?.placeholder;
                          if (uiPlaceholder) {
                            return uiPlaceholder;
                          }
                          if (!showTechnicalHints) {
                            return '';
                          }
                          if (spec.default !== undefined) {
                            return `default: ${stringifyBuilderDefault(spec.default)}`;
                          }
                          if (typeof spec.read_from === 'string') {
                            return `read_from: ${spec.read_from}`;
                          }
                          return '';
                        })();
                        return (
                          <label key={inputName}>
                            <span>{labelText}</span>
                            {showTokenPicker ? (
                              <div className="builder-token-selector">
                                {inputMode === 'readonly' ? (
                                  <div className="builder-token-selector-shell builder-token-selector-shell-readonly">
                                    <span>{resolvedToken?.symbol ?? (selectedMint ? 'Custom mint' : 'No token')}</span>
                                  </div>
                                ) : (
                                  <div className="builder-token-selector-shell">
                                    <select
                                      value={selectedMint}
                                      onChange={(event) => onInputChange(inputName, event.target.value)}
                                      disabled={isWorking || !editable}
                                    >
                                      <option value="" disabled>
                                        Select token
                                      </option>
                                      {supportedTokens.map((token) => (
                                        <option key={`${inputName}:${token.symbol}`} value={token.mint}>
                                          {token.symbol}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <input
                                type="text"
                                value={displayValue}
                                onChange={(event) => {
                                  const nextRaw = event.target.value;
                                  if (isAmountField && amountToken) {
                                    setDisplayDraftByInput((prev) => ({ ...prev, [inputName]: nextRaw }));
                                    const nextAtomic = parseDisplayAmountToAtomic(nextRaw, amountToken.decimals);
                                    if (nextAtomic !== null) {
                                      onInputChange(inputName, nextAtomic);
                                    }
                                    return;
                                  }
                                  if (isSlippageField) {
                                    setDisplayDraftByInput((prev) => ({ ...prev, [inputName]: nextRaw }));
                                    const nextBps = parsePercentToBps(nextRaw);
                                    if (nextBps !== null) {
                                      onInputChange(inputName, nextBps);
                                    }
                                    return;
                                  }
                                  onInputChange(inputName, nextRaw);
                                }}
                                onBlur={() => {
                                  if (isAmountField || isSlippageField) {
                                    setDisplayDraftByInput((prev) => {
                                      const next = { ...prev };
                                      delete next[inputName];
                                      return next;
                                    });
                                  }
                                }}
                                placeholder={placeholderText}
                                disabled={isWorking || !editable}
                              />
                            )}
                            {hintText ? <small className="builder-token-meta">{hintText}</small> : null}
                          </label>
                        );
                      })}
                    </div>

                    {isBuilderAppMode ? (
                      <div className="builder-controls builder-controls-app">
                        {visibleStepActions.map((action, actionIndex) => {
                          if (action.do.fn === 'back') {
                            return (
                              <button
                                key={`step-action-${action.do.fn}-${actionIndex}`}
                                type="button"
                                className={actionClassName(action)}
                                onClick={onBackStep}
                                disabled={isWorking || builderAppStepIndex <= 0}
                              >
                                {action.label}
                              </button>
                            );
                          }
                          if (action.do.fn === 'reset') {
                            return (
                              <button
                                key={`step-action-${action.do.fn}-${actionIndex}`}
                                type="button"
                                className={actionClassName(action)}
                                onClick={onResetStep}
                                disabled={isWorking}
                              >
                                {action.label}
                              </button>
                            );
                          }
                          const runAction = action;
                          const runMode = runAction.do.mode;
                          return (
                            <button
                              key={`step-action-${runAction.do.fn}-${actionIndex}`}
                              type="submit"
                              className={actionClassName(runAction)}
                              disabled={isWorking}
                              onClick={() => {
                                if (
                                  selectedBuilderOperation.instruction &&
                                  (runMode === 'send' || runMode === 'simulate')
                                ) {
                                  onSetBuilderAppSubmitMode(runMode);
                                }
                              }}
                            >
                              {isWorking &&
                              selectedBuilderOperation.instruction &&
                              (runMode === 'send' || runMode === 'simulate') &&
                              builderAppSubmitMode === runMode
                                ? 'Running...'
                                : runAction.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <>
                        <div className="builder-controls">
                          <label className="builder-checkbox">
                            <input
                              type="checkbox"
                              checked={builderSimulate}
                              onChange={(event) => onSetBuilderSimulate(event.target.checked)}
                              disabled={isWorking}
                            />
                            simulate only (recommended first)
                          </label>
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
          </div>

          <aside className="builder-side">
            <div className="builder-dev-tools">
              <h3>Developer Tools</h3>
              <p className="builder-note">Use sample inputs for quick protocol debugging.</p>
              <button type="button" className="builder-prefill" onClick={onPrefillExample} disabled={isWorking}>
                Use Example Market
              </button>
            </div>
            <div className="builder-result-card">
              <h3 className="builder-result-title">Execution Panel</h3>
              {builderStatusText ? (
                <>
                  <pre className="builder-output">{builderStatusText}</pre>
                  {builderRawDetails ? (
                    <>
                      <button type="button" className="builder-raw-toggle" onClick={onToggleRawDetails}>
                        {builderShowRawDetails ? 'Hide raw details' : 'Show raw details'}
                      </button>
                      {builderShowRawDetails ? <pre className="builder-output">{builderRawDetails}</pre> : null}
                    </>
                  ) : null}
                </>
              ) : (
                <p className="builder-result-empty">
                  Run a simulation or send a transaction to see status, signature, and explorer link here.
                </p>
              )}
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
