import type { FormEvent } from 'react';
import type { MetaAppSummary, MetaOperationSummary } from '@agentform/apppack-runtime/metaIdlRuntime';
import {
  formatBuilderSelectableItemLabel,
  getBuilderInputTag,
  isBuilderInputEditable,
  readBuilderPath,
  stringifyBuilderDefault,
  valuesEqualForSelection,
} from '../builderHelpers';
import type { BuilderStepAction } from '../useBuilderController';

type BuilderViewMode = 'enduser' | 'geek';
type BuilderAppSubmitMode = 'simulate' | 'send';

type BuilderProtocol = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
};

type BuilderStep = MetaAppSummary['steps'][number];
type BuilderSelectUi = Extract<NonNullable<BuilderStep['ui']>, { kind: 'select_from_derived' }>;

type BuilderTabProps = {
  isWorking: boolean;
  builderViewMode: BuilderViewMode;
  onModeEndUser: () => void;
  onModeGeek: () => void;
  builderProtocols: BuilderProtocol[];
  builderProtocolId: string;
  onSelectProtocol: (protocolId: string) => void;
  builderApps: MetaAppSummary[];
  builderAppId: string;
  onSelectApp: (app: MetaAppSummary) => void;
  builderOperations: MetaOperationSummary[];
  builderOperationId: string;
  onSelectOperation: (operationId: string) => void;
  selectedBuilderOperation: MetaOperationSummary | null;
  selectedBuilderApp: MetaAppSummary | null;
  selectedBuilderAppStep: BuilderStep | null;
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
  hiddenBuilderInputsCount: number;
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
    onModeEndUser,
    onModeGeek,
    builderProtocols,
    builderProtocolId,
    onSelectProtocol,
    builderApps,
    builderAppId,
    onSelectApp,
    builderOperations,
    builderOperationId,
    onSelectOperation,
    selectedBuilderOperation,
    selectedBuilderApp,
    selectedBuilderAppStep,
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
    hiddenBuilderInputsCount,
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
  const visibleStepActions = isBuilderAppMode ? selectedBuilderStepActions : [];

  const actionClassName = (action: BuilderStepAction): string => {
    if (action.variant === 'secondary') {
      return 'builder-submit builder-submit-secondary';
    }
    if (action.variant === 'ghost') {
      return 'builder-back';
    }
    return 'builder-submit';
  };

  return (
    <>
      <div className="builder-mode-switch builder-mode-switch-global" role="tablist" aria-label="Builder audience mode">
        <button
          type="button"
          className={builderViewMode === 'enduser' ? 'active' : ''}
          onClick={onModeEndUser}
          disabled={isWorking}
        >
          End User
        </button>
        <button
          type="button"
          className={builderViewMode === 'geek' ? 'active' : ''}
          onClick={onModeGeek}
          disabled={isWorking}
        >
          Geek
        </button>
      </div>

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
                            onClick={() => onSelectApp(app)}
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
                          onClick={() => onSelectOperation(operation.operationId)}
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
              <form className="builder-form" onSubmit={onSubmit}>
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
                          onClick={() => onOpenBuilderAppStep(index)}
                        >
                          {index + 1}. {step.title}
                        </button>
                      ))}
                    </div>
                    {builderAppStepIndex > 0 || showBuilderSelectableItems ? (
                      <button
                        type="button"
                        className="builder-back"
                        onClick={showBuilderSelectableItems ? onResetStep : onBackStep}
                        disabled={isWorking}
                      >
                        {showBuilderSelectableItems ? 'Back to search form' : 'Back to previous step'}
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
                    {hiddenBuilderInputsCount > 0 && builderViewMode === 'enduser' ? (
                      <p className="builder-note">
                        {hiddenBuilderInputsCount} field(s) auto-resolved (default/derived/computed). Switch to Geek mode
                        to view them.
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
                              onChange={(event) => onInputChange(inputName, event.target.value)}
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
                        {visibleStepActions.length > 0 ? (
                          visibleStepActions.map((action) => {
                            if (action.kind === 'back') {
                              return (
                                <button
                                  key={action.actionId}
                                  type="button"
                                  className={actionClassName(action)}
                                  onClick={onBackStep}
                                  disabled={isWorking || builderAppStepIndex <= 0}
                                >
                                  {action.label}
                                </button>
                              );
                            }
                            if (action.kind === 'reset') {
                              return (
                                <button
                                  key={action.actionId}
                                  type="button"
                                  className={actionClassName(action)}
                                  onClick={onResetStep}
                                  disabled={isWorking}
                                >
                                  {action.label}
                                </button>
                              );
                            }
                            return (
                              <button
                                key={action.actionId}
                                type="submit"
                                className={actionClassName(action)}
                                disabled={isWorking}
                                onClick={() => {
                                  if (selectedBuilderOperation.instruction) {
                                    onSetBuilderAppSubmitMode(action.mode === 'send' ? 'send' : 'simulate');
                                  }
                                }}
                              >
                                {isWorking &&
                                selectedBuilderOperation.instruction &&
                                builderAppSubmitMode === (action.mode === 'send' ? 'send' : 'simulate')
                                  ? 'Running...'
                                  : action.label}
                              </button>
                            );
                          })
                        ) : selectedBuilderOperation.instruction ? (
                          <>
                            <button
                              type="submit"
                              className="builder-submit"
                              disabled={isWorking}
                              onClick={() => onSetBuilderAppSubmitMode('simulate')}
                            >
                              {isWorking && builderAppSubmitMode === 'simulate' ? 'Running...' : 'Run Simulation'}
                            </button>
                            <button
                              type="submit"
                              className="builder-submit builder-submit-secondary"
                              disabled={isWorking}
                              onClick={() => onSetBuilderAppSubmitMode('send')}
                            >
                              {isWorking && builderAppSubmitMode === 'send' ? 'Running...' : 'Send Transaction'}
                            </button>
                          </>
                        ) : (
                          <button type="submit" className="builder-submit" disabled={isWorking}>
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
                              onChange={(event) => onSetBuilderSimulate(event.target.checked)}
                              disabled={isWorking}
                            />
                            simulate only (recommended first)
                          </label>
                          <button
                            type="button"
                            className="builder-prefill"
                            onClick={onPrefillExample}
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
          </div>

          <aside className="builder-side">
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
