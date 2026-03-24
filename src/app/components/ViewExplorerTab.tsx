import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { VIEW_PLAYGROUND_PRESETS, VIEW_SCENARIOS, type ViewScenarioDefinition } from '../viewModels';
import { ViewScenarioTab } from './ViewScenarioTab';

type ViewExplorerTabProps = {
  viewApiBaseUrl: string;
};

type RegistryProtocol = {
  id: string;
  name?: string;
  network?: string;
  programId?: string;
  metaPath?: string;
  metaCorePath?: string;
  status?: string;
  supportedCommands?: string[];
};

type RegistryResponse = {
  protocols: RegistryProtocol[];
};

type MetaOperation = {
  label?: string;
  description?: string;
  view?: {
    kind?: string;
    source?: string;
    entity_type?: string;
    title?: string;
    description?: string;
  };
  read_output?: {
    title?: string;
    empty_text?: string;
  };
};

type MetaResponse = {
  protocolId?: string;
  label?: string;
  operations?: Record<string, MetaOperation>;
};

type ExplorerView = {
  protocolId: string;
  protocolLabel: string;
  operationId: string;
  operationLabel: string;
  description: string;
  kind: string;
  source: string;
  entityType: string | null;
  supportedCommands: string[];
};

type HealthResponse = {
  ok?: boolean;
  service?: string;
  mode?: string;
  sync?: {
    provider?: string;
    total_jobs?: number;
    bootstrap_pending?: number;
    incremental_jobs?: number;
    jobs_with_errors?: number;
    last_updated_at?: string;
  };
  materialized?: {
    pump_market_ingestion_provider?: string;
  };
};

type ViewRunResponse = {
  ok: boolean;
  items?: unknown[];
  meta?: Record<string, unknown>;
  error?: string;
};

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return formatJson(value);
}

function labelForScenario(scenario: ViewScenarioDefinition): string {
  return `${scenario.title} · ${scenario.protocolId}`;
}

export function ViewExplorerTab({ viewApiBaseUrl }: ViewExplorerTabProps) {
  const [catalog, setCatalog] = useState<ExplorerView[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [selectedViewKey, setSelectedViewKey] = useState<string | null>(null);
  const [protocolFilter, setProtocolFilter] = useState<'all' | string>('all');
  const [protocolId, setProtocolId] = useState('');
  const [operationId, setOperationId] = useState('');
  const [inputText, setInputText] = useState('{}');
  const [limitText, setLimitText] = useState('20');
  const [healthText, setHealthText] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [result, setResult] = useState<ViewRunResponse | null>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [isRunLoading, setIsRunLoading] = useState(false);
  const [activeScenarioId, setActiveScenarioId] = useState(VIEW_SCENARIOS[0]?.id ?? '');

  const trimmedBaseUrl = useMemo(() => viewApiBaseUrl.trim().replace(/\/+$/, ''), [viewApiBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      setIsCatalogLoading(true);
      setCatalogError(null);
      try {
        const registryResponse = await fetch('/idl/registry.json');
        if (!registryResponse.ok) {
          throw new Error(`Failed to load registry (${registryResponse.status}).`);
        }
        const registry = (await registryResponse.json()) as RegistryResponse;
        const loaded: ExplorerView[] = [];

        for (const protocol of registry.protocols ?? []) {
          const metaPath = protocol.metaCorePath ?? protocol.metaPath;
          if (!metaPath) {
            continue;
          }
          const metaResponse = await fetch(metaPath);
          if (!metaResponse.ok) {
            continue;
          }
          const meta = (await metaResponse.json()) as MetaResponse;
          for (const [opId, operation] of Object.entries(meta.operations ?? {})) {
            if (!operation.view) {
              continue;
            }
            loaded.push({
              protocolId: protocol.id,
              protocolLabel: protocol.name ?? meta.label ?? protocol.id,
              operationId: opId,
              operationLabel: operation.label ?? operation.view.title ?? opId,
              description: operation.view.description ?? operation.description ?? operation.read_output?.title ?? '',
              kind: operation.view.kind ?? 'view',
              source: operation.view.source ?? 'unknown',
              entityType: operation.view.entity_type ?? null,
              supportedCommands: protocol.supportedCommands ?? [],
            });
          }
        }

        loaded.sort((a, b) => {
          if (a.protocolLabel !== b.protocolLabel) {
            return a.protocolLabel.localeCompare(b.protocolLabel);
          }
          return a.operationLabel.localeCompare(b.operationLabel);
        });

        if (cancelled) {
          return;
        }
        setCatalog(loaded);
        const first = loaded[0] ?? null;
        if (first) {
          const key = `${first.protocolId}::${first.operationId}`;
          setSelectedViewKey((current) => current ?? key);
          setProtocolId((current) => current || first.protocolId);
          setOperationId((current) => current || first.operationId);
          const preset = VIEW_PLAYGROUND_PRESETS.find((entry) => entry.protocolId === first.protocolId && entry.operationId === first.operationId);
          if (preset) {
            setInputText((current) => (current === '{}' ? preset.input : current));
            setLimitText((current) => (current === '20' ? preset.limit : current));
          }
        }
      } catch (error) {
        if (!cancelled) {
          setCatalogError(error instanceof Error ? error.message : 'Failed to load catalog.');
        }
      } finally {
        if (!cancelled) {
          setIsCatalogLoading(false);
        }
      }
    }
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const protocols = useMemo(() => {
    const map = new Map<string, string>();
    for (const view of catalog) {
      if (!map.has(view.protocolId)) {
        map.set(view.protocolId, view.protocolLabel);
      }
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [catalog]);

  const filteredCatalog = useMemo(
    () => catalog.filter((view) => protocolFilter === 'all' || view.protocolId === protocolFilter),
    [catalog, protocolFilter],
  );

  const selectedView = useMemo(
    () => catalog.find((view) => `${view.protocolId}::${view.operationId}` === selectedViewKey) ?? null,
    [catalog, selectedViewKey],
  );

  const activeScenario = useMemo(
    () => VIEW_SCENARIOS.find((scenario) => scenario.id === activeScenarioId) ?? VIEW_SCENARIOS[0] ?? null,
    [activeScenarioId],
  );

  const applySelectedView = (view: ExplorerView) => {
    const key = `${view.protocolId}::${view.operationId}`;
    setSelectedViewKey(key);
    setProtocolId(view.protocolId);
    setOperationId(view.operationId);
    const preset = VIEW_PLAYGROUND_PRESETS.find((entry) => entry.protocolId === view.protocolId && entry.operationId === view.operationId);
    setInputText(preset?.input ?? '{}');
    setLimitText(preset?.limit ?? '20');
    setResult(null);
    setResultText(null);
    setErrorText(null);
  };

  const handleHealthCheck = async () => {
    setIsHealthLoading(true);
    setErrorText(null);
    try {
      const response = await fetch(`${trimmedBaseUrl}/health`);
      const body = (await response.json()) as HealthResponse;
      if (!response.ok) {
        throw new Error(`Health check failed with ${response.status}.`);
      }
      setHealthText(
        [
          `service=${body.service ?? 'unknown'}`,
          `mode=${body.mode ?? 'unknown'}`,
          `provider=${body.sync?.provider ?? 'unknown'}`,
          `jobs=${body.sync?.total_jobs ?? 0}`,
          `errors=${body.sync?.jobs_with_errors ?? 0}`,
          `pump_ingest=${body.materialized?.pump_market_ingestion_provider ?? 'unknown'}`,
        ].join(' | '),
      );
    } catch (error) {
      setHealthText(null);
      setErrorText(error instanceof Error ? error.message : 'Health check failed.');
    } finally {
      setIsHealthLoading(false);
    }
  };

  const handleRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsRunLoading(true);
    setErrorText(null);
    setResultText(null);
    setResult(null);
    try {
      const parsedInput = JSON.parse(inputText) as Record<string, unknown>;
      const parsedLimit = limitText.trim().length > 0 ? Number.parseInt(limitText, 10) : undefined;
      if (typeof parsedLimit === 'number' && (!Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
        throw new Error('Limit must be a positive integer when provided.');
      }
      const response = await fetch(`${trimmedBaseUrl}/view-run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocol_id: protocolId,
          operation_id: operationId,
          input: parsedInput,
          ...(typeof parsedLimit === 'number' ? { limit: parsedLimit } : {}),
        }),
      });
      const body = (await response.json()) as ViewRunResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? `View run failed with ${response.status}.`);
      }
      setResult(body);
      setResultText(`items=${body.items?.length ?? 0}` + (body.meta ? ' | meta present' : ''));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'View run failed.');
    } finally {
      setIsRunLoading(false);
    }
  };

  return (
    <section className="view-explorer-shell">
      <div className="view-explorer-header">
        <div>
          <h2>View Explorer</h2>
          <p>Browse indexed views, inspect query shapes, and run live reads against the AppPack data plane without committing to GraphQL first.</p>
        </div>
        <div className="view-explorer-target">
          <span>Target</span>
          <code>{trimmedBaseUrl}</code>
        </div>
      </div>

      <div className="view-explorer-toolbar">
        <div className="view-explorer-filter-group">
          <label>
            Protocol
            <select value={protocolFilter} onChange={(event) => setProtocolFilter(event.target.value)}>
              <option value="all">All protocols</option>
              {protocols.map((protocol) => (
                <option key={protocol.id} value={protocol.id}>
                  {protocol.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="view-explorer-actions">
          <button type="button" onClick={handleHealthCheck} disabled={isHealthLoading}>
            {isHealthLoading ? 'Checking…' : 'Check Index Health'}
          </button>
        </div>
      </div>

      {healthText ? <p className="view-playground-info">{healthText}</p> : null}
      {catalogError ? <p className="view-playground-error">{catalogError}</p> : null}
      {errorText ? <p className="view-playground-error">{errorText}</p> : null}
      {resultText ? <p className="view-playground-info">{resultText}</p> : null}

      <div className="view-explorer-layout">
        <aside className="view-explorer-sidebar">
          <div className="view-explorer-sidebar-header">
            <strong>Indexed Views</strong>
            <span>{isCatalogLoading ? 'Loading…' : `${filteredCatalog.length} views`}</span>
          </div>
          <div className="view-explorer-view-list">
            {filteredCatalog.map((view) => {
              const isActive = selectedViewKey === `${view.protocolId}::${view.operationId}`;
              return (
                <button
                  key={`${view.protocolId}::${view.operationId}`}
                  type="button"
                  className={isActive ? 'view-explorer-view-card active' : 'view-explorer-view-card'}
                  onClick={() => applySelectedView(view)}
                >
                  <strong>{view.operationLabel}</strong>
                  <span>{view.protocolLabel}</span>
                  <span>{view.kind} · {view.source}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="view-explorer-main">
          <section className="view-explorer-panel">
            <div className="view-explorer-panel-header">
              <h3>{selectedView?.operationLabel ?? 'Select a view'}</h3>
              {selectedView ? <span>{selectedView.protocolLabel}</span> : null}
            </div>
            {selectedView ? (
              <div className="view-explorer-metadata">
                <div><span>Protocol</span><strong>{selectedView.protocolId}</strong></div>
                <div><span>Operation</span><strong>{selectedView.operationId}</strong></div>
                <div><span>Kind</span><strong>{selectedView.kind}</strong></div>
                <div><span>Source</span><strong>{selectedView.source}</strong></div>
                <div><span>Entity Type</span><strong>{selectedView.entityType ?? '—'}</strong></div>
                <div><span>Commands</span><strong>{selectedView.supportedCommands.join(', ') || '—'}</strong></div>
              </div>
            ) : (
              <p className="view-playground-empty">Choose a view from the catalog.</p>
            )}
            {selectedView?.description ? <p className="view-explorer-description">{selectedView.description}</p> : null}
          </section>

          <section className="view-explorer-panel">
            <div className="view-explorer-panel-header">
              <h3>Query Runner</h3>
              <span>{protocolId && operationId ? `${protocolId} / ${operationId}` : 'Ready'}</span>
            </div>
            <form className="view-playground-form" onSubmit={handleRun}>
              <label>
                Protocol ID
                <input value={protocolId} onChange={(event) => setProtocolId(event.target.value)} disabled={isRunLoading} />
              </label>
              <label>
                Operation ID
                <input value={operationId} onChange={(event) => setOperationId(event.target.value)} disabled={isRunLoading} />
              </label>
              <label>
                Limit
                <input value={limitText} onChange={(event) => setLimitText(event.target.value)} disabled={isRunLoading} />
              </label>
              <label className="view-playground-form-full">
                Input JSON
                <textarea value={inputText} onChange={(event) => setInputText(event.target.value)} disabled={isRunLoading} rows={10} />
              </label>
              <div className="view-playground-actions">
                <button type="submit" disabled={isRunLoading}>
                  {isRunLoading ? 'Running…' : 'Run View'}
                </button>
              </div>
            </form>
          </section>

          <section className="view-explorer-panel">
            <div className="view-explorer-panel-header">
              <h3>Structured Preview</h3>
              <span>{result?.items?.length ?? 0} item(s)</span>
            </div>
            {Array.isArray(result?.items) && result.items.length > 0 ? (
              <div className="view-result-grid">
                {result.items.map((item, index) => (
                  <article key={index} className="view-result-card">
                    <strong>Item {index + 1}</strong>
                    {item && typeof item === 'object' && !Array.isArray(item) ? (
                      <dl>
                        {Object.entries(item as Record<string, unknown>).map(([key, value]) => (
                          <div key={key} className="view-result-row">
                            <dt>{key}</dt>
                            <dd>{summarizeValue(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <pre>{formatJson(item)}</pre>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="view-playground-empty">Run a view to inspect items here.</p>
            )}
          </section>

          <section className="view-explorer-panel">
            <div className="view-explorer-panel-header">
              <h3>Featured Pages</h3>
              <span>Protocol-shaped demos on top of the same indexed views</span>
            </div>
            <div className="view-explorer-featured-tabs">
              {VIEW_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  className={scenario.id === activeScenarioId ? 'active' : ''}
                  onClick={() => setActiveScenarioId(scenario.id)}
                >
                  {labelForScenario(scenario)}
                </button>
              ))}
            </div>
            {activeScenario ? <ViewScenarioTab key={activeScenario.id} viewApiBaseUrl={trimmedBaseUrl} scenario={activeScenario} /> : null}
          </section>

          <section className="view-explorer-panel">
            <div className="view-explorer-panel-header">
              <h3>Raw Response</h3>
              <span>JSON</span>
            </div>
            <pre>{result ? formatJson(result) : '// no result yet'}</pre>
          </section>
        </div>
      </div>
    </section>
  );
}
