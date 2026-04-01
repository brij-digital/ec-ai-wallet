import type { FormEvent } from 'react';
import type { RuntimeOperationSummary } from '@brij-digital/apppack-runtime/runtimeOperationRuntime';
import { listSupportedTokens, resolveToken } from '../../constants/tokens';
import {
  getBuilderInputMode,
  isBuilderInputEditable,
} from '../builderHelpers';
import type { OperationEnhancement } from '../metaEnhancements';

type BuilderProtocol = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
};

type BuilderTabProps = {
  isWorking: boolean;
  builderProtocols: BuilderProtocol[];
  builderProtocolId: string;
  onSelectProtocol: (protocolId: string) => void;
  builderOperations: RuntimeOperationSummary[];
  builderOperationId: string;
  onSelectOperation: (operationId: string) => void;
  selectedBuilderOperation: RuntimeOperationSummary | null;
  selectedBuilderOperationEnhancement: OperationEnhancement | null;
  visibleBuilderInputs: Array<[string, RuntimeOperationSummary['inputs'][string]]>;
  builderInputValues: Record<string, string>;
  onInputChange: (name: string, value: string) => void;
  onPrefillExample: () => void;
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
    builderProtocols,
    builderProtocolId,
    onSelectProtocol,
    builderOperations,
    builderOperationId,
    onSelectOperation,
    selectedBuilderOperation,
    selectedBuilderOperationEnhancement,
    visibleBuilderInputs,
    builderInputValues,
    onInputChange,
    onPrefillExample,
    builderSimulate,
    onSetBuilderSimulate,
    onSubmit,
    builderStatusText,
    builderRawDetails,
    builderShowRawDetails,
    onToggleRawDetails,
  } = props;

  const supportedTokens = listSupportedTokens();

  return (
    <section className="builder-shell">
      <div className="builder-layout">
        <div className="builder-main">
          <div className="builder-grid">
            <div className="builder-list">
              <h3>Protocols</h3>
              <div className="builder-items">
                {builderProtocols.map((protocol) => (
                  <button
                    key={protocol.id}
                    type="button"
                    className={protocol.id === builderProtocolId ? 'active' : ''}
                    onClick={() => onSelectProtocol(protocol.id)}
                    disabled={isWorking}
                  >
                    {protocol.name}
                    <small>{protocol.id}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="builder-form">
              <h3>Raw Operations</h3>
              <p>Select a protocol and action to start.</p>

              <form onSubmit={onSubmit}>
                <div className="builder-inputs">
                  <label>
                    <span>Operation</span>
                    <select
                      value={builderOperationId}
                      onChange={(event) => onSelectOperation(event.target.value)}
                      disabled={isWorking || builderOperations.length === 0}
                    >
                      {builderOperations.map((operation) => (
                        <option key={operation.operationId} value={operation.operationId}>
                          {operation.operationId}
                        </option>
                      ))}
                    </select>
                  </label>

                  {visibleBuilderInputs.map(([inputName, spec]) => {
                    const editable = isBuilderInputEditable(spec);
                    const mode = getBuilderInputMode(spec);
                    const help = selectedBuilderOperationEnhancement?.inputUi[inputName]?.help;
                    const label = selectedBuilderOperationEnhancement?.inputUi[inputName]?.label ?? inputName;
                    const tokenInput = spec.type.toLowerCase() === 'token_mint';

                    if (tokenInput && editable) {
                      const currentValue = builderInputValues[inputName] ?? '';
                      const selectedToken = resolveToken(currentValue);
                      return (
                        <label key={inputName}>
                          <span>{label}</span>
                          <div className="builder-token-selector">
                            <div className="builder-token-selector-shell">
                              <select
                                value={selectedToken?.symbol ?? '__custom__'}
                                onChange={(event) => {
                                  const token = resolveToken(event.target.value);
                                  onInputChange(inputName, token?.mint ?? '');
                                }}
                                disabled={isWorking}
                              >
                                {supportedTokens.map((token) => (
                                  <option key={token.mint} value={token.symbol}>
                                    {token.symbol}
                                  </option>
                                ))}
                                <option value="__custom__">Custom mint</option>
                              </select>
                            </div>
                            {selectedToken ? (
                              <div className="builder-token-meta">
                                ticker: {selectedToken.symbol} | decimals: {selectedToken.decimals} | mint: {selectedToken.mint}
                              </div>
                            ) : null}
                            <input
                              type="text"
                              value={builderInputValues[inputName] ?? ''}
                              onChange={(event) => onInputChange(inputName, event.target.value)}
                              placeholder={inputName}
                              disabled={isWorking}
                            />
                          </div>
                          {help ? <small className="builder-input-help">{help}</small> : null}
                        </label>
                      );
                    }

                    return (
                      <label key={inputName}>
                        <span>{label}</span>
                        <input
                          type="text"
                          value={builderInputValues[inputName] ?? ''}
                          onChange={(event) => onInputChange(inputName, event.target.value)}
                          placeholder={inputName}
                          disabled={isWorking || !editable}
                          readOnly={!editable}
                          data-mode={mode}
                        />
                        {help ? <small className="builder-input-help">{help}</small> : null}
                      </label>
                    );
                  })}
                </div>

                <div className="builder-controls">
                  <button type="button" className="builder-prefill" onClick={onPrefillExample} disabled={isWorking || !selectedBuilderOperation}>
                    Use Example Market
                  </button>
                  <label className="builder-checkbox">
                    <input
                      type="checkbox"
                      checked={builderSimulate}
                      onChange={(event) => onSetBuilderSimulate(event.target.checked)}
                      disabled={isWorking}
                    />
                    simulate only (recommended first)
                  </label>
                  <button type="submit" className="builder-submit" disabled={isWorking || !selectedBuilderOperation}>
                    {isWorking ? 'Working…' : builderSimulate ? 'Run Simulation' : 'Send Transaction'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        <aside className="builder-side">
          <div className="builder-dev-tools">
            <h3>Developer Tools</h3>
            <p>Use sample inputs for quick protocol debugging.</p>
          </div>
          <div className="builder-result-card">
            <h3 className="builder-result-title">Execution Panel</h3>
            {builderStatusText ? (
              <pre className="builder-output">{builderStatusText}</pre>
            ) : (
              <p className="builder-result-empty">Run an operation to inspect the runtime output.</p>
            )}
            {builderRawDetails ? (
              <>
                <button type="button" className="builder-raw-toggle" onClick={onToggleRawDetails}>
                  {builderShowRawDetails ? 'Hide raw details' : 'Show raw details'}
                </button>
                {builderShowRawDetails ? <pre className="builder-output">{builderRawDetails}</pre> : null}
              </>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
