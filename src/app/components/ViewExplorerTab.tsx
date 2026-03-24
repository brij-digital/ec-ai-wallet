import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { VIEW_PLAYGROUND_PRESETS } from '../viewModels';

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

type PumpCandidate = {
  pool: string;
  mint: string;
  quoteMint: string;
};

type OrcaCandidate = {
  pool: string;
  tokenMintA: string;
  tokenMintB: string;
};

type ExplorerCandidates = {
  pump: PumpCandidate[];
  orca: OrcaCandidate[];
};

type ActionableViewItem = {
  mint?: string;
  pool?: string;
  marketType?: string;
  tradeable?: boolean;
  summary?: string;
  confidence?: string;
  confidenceScore?: number;
  liquidityQuote?: number;
  volume24hQuote?: number;
  marketCapQuote?: number | null;
  latestTradeAt?: string | null;
  warnings?: string[];
  actionContext?: Record<string, unknown>;
};

const INDEXED_PROTOCOL_IDS = new Set(['pump-amm-mainnet', 'orca-whirlpool-mainnet']);

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

function fallbackPreset(view: ExplorerView): { input: string; limit: string } {
  const preset = VIEW_PLAYGROUND_PRESETS.find((entry) => entry.protocolId === view.protocolId && entry.operationId === view.operationId);
  return {
    input: preset?.input ?? '{}',
    limit: preset?.limit ?? '20',
  };
}

function defaultLimitForView(view: ExplorerView): string {
  if (view.operationId === 'resolve_pool' || view.operationId === 'pool_snapshot' || view.operationId === 'stat_cards' || view.operationId === 'token_trade_context') {
    return '1';
  }
  if (view.operationId === 'trade_feed' || view.operationId === 'market_cap_series' || view.operationId === 'list_tokens' || view.operationId === 'list_pools') {
    return '20';
  }
  return '20';
}

async function runView(
  baseUrl: string,
  protocolId: string,
  operationId: string,
  input: Record<string, unknown>,
  limit?: number,
): Promise<ViewRunResponse> {
  const response = await fetch(`${baseUrl}/view-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      protocol_id: protocolId,
      operation_id: operationId,
      input,
      ...(typeof limit === 'number' ? { limit } : {}),
    }),
  });
  return response.json() as Promise<ViewRunResponse>;
}

async function fetchIndexedCandidates(baseUrl: string): Promise<ExplorerCandidates> {
  const [pumpBody, orcaBody] = await Promise.all([
    runView(baseUrl, 'pump-amm-mainnet', 'list_tokens', {
      quote_mint: 'So11111111111111111111111111111111111111112',
      min_last_seen_slot: '0',
    }, 10),
    runView(baseUrl, 'orca-whirlpool-mainnet', 'list_pools', {
      token_in_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      token_out_mint: 'So11111111111111111111111111111111111111112',
    }, 10),
  ]);

  const pump = Array.isArray(pumpBody.items)
    ? pumpBody.items.flatMap((item) => {
        const row = item as Record<string, unknown>;
        return typeof row.pool === 'string' && typeof row.baseMint === 'string' && typeof row.quoteMint === 'string'
          ? [{ pool: row.pool, mint: row.baseMint, quoteMint: row.quoteMint }]
          : [];
      })
    : [];

  const orca = Array.isArray(orcaBody.items)
    ? orcaBody.items.flatMap((item) => {
        const row = item as Record<string, unknown>;
        return typeof row.whirlpool === 'string' && typeof row.tokenMintA === 'string' && typeof row.tokenMintB === 'string'
          ? [{ pool: row.whirlpool, tokenMintA: row.tokenMintA, tokenMintB: row.tokenMintB }]
          : [];
      })
    : [];

  return { pump, orca };
}

async function resolveRunnableSample(
  baseUrl: string,
  view: ExplorerView,
  candidates: ExplorerCandidates,
): Promise<{ input: string; limit: string } | null> {
  if (view.protocolId === 'pump-amm-mainnet') {
    if (view.operationId === 'list_tokens') {
      const first = candidates.pump[0];
      if (!first) {
        return null;
      }
      return {
        input: formatJson({
          quote_mint: first.quoteMint,
          min_last_seen_slot: '0',
        }),
        limit: defaultLimitForView(view),
      };
    }

    if (view.operationId === 'resolve_pool') {
      const first = candidates.pump[0];
      if (!first) {
        return null;
      }
      return {
        input: formatJson({
          mint: first.mint,
          quote_mint: first.quoteMint,
        }),
        limit: '1',
      };
    }

    if (view.operationId === 'token_trade_context') {
      let bestCandidate: { mint: string; quoteMint: string; score: number } | null = null;
      for (const candidate of candidates.pump) {
        const response = await runView(
          baseUrl,
          view.protocolId,
          view.operationId,
          { mint: candidate.mint, quote_mint: candidate.quoteMint },
          1,
        );
        const firstItem = Array.isArray(response.items) ? (response.items[0] as ActionableViewItem | undefined) : undefined;
        if (!firstItem) {
          continue;
        }
        const score =
          (firstItem.tradeable ? 100 : 0)
          + ((typeof firstItem.confidenceScore === 'number' ? firstItem.confidenceScore : 0) * 50)
          + (typeof firstItem.liquidityQuote === 'number' ? Math.min(firstItem.liquidityQuote, 250) : 0)
          + (typeof firstItem.volume24hQuote === 'number' ? Math.min(firstItem.volume24hQuote, 250) : 0)
          - ((Array.isArray(firstItem.warnings) ? firstItem.warnings.length : 0) * 15);
        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = {
            mint: candidate.mint,
            quoteMint: candidate.quoteMint,
            score,
          };
        }
      }
      if (!bestCandidate) {
        const fallback = candidates.pump[0];
        if (!fallback) {
          return null;
        }
        return {
          input: formatJson({
            mint: fallback.mint,
            quote_mint: fallback.quoteMint,
          }),
          limit: '1',
        };
      }
      return {
        input: formatJson({
          mint: bestCandidate.mint,
          quote_mint: bestCandidate.quoteMint,
        }),
        limit: '1',
      };
    }

    if (['pool_snapshot', 'stat_cards', 'market_cap_series', 'trade_feed'].includes(view.operationId)) {
      let bestCandidate: { pool: string; count: number } | null = null;
      for (const candidate of candidates.pump) {
        const sampleLimit = view.operationId === 'market_cap_series' ? 20 : 1;
        const response = await runView(baseUrl, view.protocolId, view.operationId, { pool: candidate.pool }, sampleLimit);
        const itemCount = Array.isArray(response.items) ? response.items.length : 0;
        if (view.operationId === 'market_cap_series') {
          if (!bestCandidate || itemCount > bestCandidate.count) {
            bestCandidate = { pool: candidate.pool, count: itemCount };
          }
          continue;
        }
        if (itemCount > 0) {
          return {
            input: formatJson({ pool: candidate.pool }),
            limit: defaultLimitForView(view),
          };
        }
      }
      if (view.operationId === 'market_cap_series' && bestCandidate?.count) {
        return {
          input: formatJson({ pool: bestCandidate.pool }),
          limit: defaultLimitForView(view),
        };
      }
      const fallback = candidates.pump[0];
      if (!fallback) {
        return null;
      }
      return {
        input: formatJson({ pool: fallback.pool }),
        limit: defaultLimitForView(view),
      };
    }
  }

  if (view.protocolId === 'orca-whirlpool-mainnet') {
    if (view.operationId === 'list_pools') {
      const first = candidates.orca[0];
      if (!first) {
        return null;
      }
      return {
        input: formatJson({
          token_in_mint: first.tokenMintB,
          token_out_mint: first.tokenMintA,
        }),
        limit: defaultLimitForView(view),
      };
    }

    if (view.operationId === 'resolve_pool') {
      const first = candidates.orca[0];
      if (!first) {
        return null;
      }
      return {
        input: formatJson({
          pool: first.pool,
        }),
        limit: '1',
      };
    }

    if (['pool_snapshot', 'stat_cards', 'market_cap_series', 'trade_feed'].includes(view.operationId)) {
      let bestCandidate: { pool: string; count: number } | null = null;
      for (const candidate of candidates.orca) {
        const sampleLimit = view.operationId === 'market_cap_series' ? 20 : 1;
        const response = await runView(baseUrl, view.protocolId, view.operationId, { pool: candidate.pool }, sampleLimit);
        const itemCount = Array.isArray(response.items) ? response.items.length : 0;
        if (view.operationId === 'market_cap_series') {
          if (!bestCandidate || itemCount > bestCandidate.count) {
            bestCandidate = { pool: candidate.pool, count: itemCount };
          }
          continue;
        }
        if (itemCount > 0) {
          return {
            input: formatJson({ pool: candidate.pool }),
            limit: defaultLimitForView(view),
          };
        }
      }
      if (view.operationId === 'market_cap_series' && bestCandidate?.count) {
        return {
          input: formatJson({ pool: bestCandidate.pool }),
          limit: defaultLimitForView(view),
        };
      }
      const fallback = candidates.orca[0];
      if (!fallback) {
        return null;
      }
      return {
        input: formatJson({ pool: fallback.pool }),
        limit: defaultLimitForView(view),
      };
    }
  }

  return null;
}

function isActionableViewItem(value: unknown): value is ActionableViewItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return 'tradeable' in row || 'actionContext' in row || 'confidence' in row;
}

function renderItemPreview(item: unknown, index: number) {
  if (!isActionableViewItem(item)) {
    return (
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
    );
  }

  const warnings = Array.isArray(item.warnings) ? item.warnings : [];
  const actions = item.actionContext && typeof item.actionContext === 'object'
    ? Object.entries(item.actionContext)
    : [];

  return (
    <article key={index} className="view-result-card view-result-card-actionable">
      <div className="view-actionable-head">
        <div>
          <strong>{item.tradeable ? 'Tradeable Context' : 'Context Needs Caution'}</strong>
          <span>{item.summary ?? 'Action-oriented Pump context built from indexed state.'}</span>
        </div>
        <div className={item.tradeable ? 'view-actionable-badge good' : 'view-actionable-badge warn'}>
          {item.tradeable ? 'tradeable' : 'restricted'}
        </div>
      </div>

      <div className="view-actionable-grid">
        <div><span>Mint</span><strong>{item.mint ?? '—'}</strong></div>
        <div><span>Pool</span><strong>{item.pool ?? '—'}</strong></div>
        <div><span>Market</span><strong>{item.marketType ?? '—'}</strong></div>
        <div><span>Confidence</span><strong>{item.confidence ?? '—'}{typeof item.confidenceScore === 'number' ? ` (${item.confidenceScore})` : ''}</strong></div>
        <div><span>Liquidity</span><strong>{typeof item.liquidityQuote === 'number' ? item.liquidityQuote.toFixed(4) : '—'}</strong></div>
        <div><span>24h Volume</span><strong>{typeof item.volume24hQuote === 'number' ? item.volume24hQuote.toFixed(4) : '—'}</strong></div>
        <div><span>Market Cap</span><strong>{typeof item.marketCapQuote === 'number' ? item.marketCapQuote.toFixed(4) : '—'}</strong></div>
        <div><span>Latest Trade</span><strong>{item.latestTradeAt ?? '—'}</strong></div>
      </div>

      <div className="view-actionable-section">
        <span>Warnings</span>
        {warnings.length > 0 ? (
          <div className="view-actionable-tags">
            {warnings.map((warning) => <code key={warning}>{warning}</code>)}
          </div>
        ) : (
          <strong>No major warnings</strong>
        )}
      </div>

      <div className="view-actionable-section">
        <span>Execution Handoff</span>
        {actions.length > 0 ? (
          <div className="view-actionable-actions">
            {actions.map(([name, action]) => (
              <div key={name} className="view-actionable-action">
                <strong>{name}</strong>
                <pre>{formatJson(action)}</pre>
              </div>
            ))}
          </div>
        ) : (
          <strong>No action context</strong>
        )}
      </div>
    </article>
  );
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
  const [indexedCandidates, setIndexedCandidates] = useState<ExplorerCandidates>({ pump: [], orca: [] });

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
          if (!INDEXED_PROTOCOL_IDS.has(protocol.id)) {
            continue;
          }
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

        const candidates = await fetchIndexedCandidates(trimmedBaseUrl);

        if (cancelled) {
          return;
        }
        setCatalog(loaded);
        setIndexedCandidates(candidates);
        const first = loaded[0] ?? null;
        if (first) {
          const key = `${first.protocolId}::${first.operationId}`;
          setSelectedViewKey((current) => current ?? key);
          setProtocolId((current) => current || first.protocolId);
          setOperationId((current) => current || first.operationId);
          const sample = await resolveRunnableSample(trimmedBaseUrl, first, candidates);
          const fallback = fallbackPreset(first);
          setInputText((current) => (current === '{}' ? (sample?.input ?? fallback.input) : current));
          setLimitText((current) => (current === '20' ? (sample?.limit ?? fallback.limit) : current));
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
  }, [trimmedBaseUrl]);

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

  const applySelectedView = async (view: ExplorerView) => {
    const key = `${view.protocolId}::${view.operationId}`;
    setSelectedViewKey(key);
    setProtocolId(view.protocolId);
    setOperationId(view.operationId);
    const fallback = fallbackPreset(view);
    setInputText(fallback.input);
    setLimitText(fallback.limit);
    setResult(null);
    setResultText(null);
    setErrorText(null);
    try {
      const sample = await resolveRunnableSample(trimmedBaseUrl, view, indexedCandidates);
      if (sample) {
        setInputText(sample.input);
        setLimitText(sample.limit);
      }
    } catch {
      // Keep fallback input if live sample resolution fails.
    }
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
                  <span>{view.kind}</span>
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
            {selectedView ? (
              <p className="view-playground-info">
                Default input is seeded from currently indexed {selectedView.protocolLabel} data when available.
              </p>
            ) : null}
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
                {result.items.map((item, index) => renderItemPreview(item, index))}
              </div>
            ) : (
              <p className="view-playground-empty">Run a view to inspect items here.</p>
            )}
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
