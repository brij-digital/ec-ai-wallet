import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScenarioMetric, ViewScenarioDefinition } from '../viewModels';

type ViewScenarioTabProps = {
  viewApiBaseUrl: string;
  scenario: ViewScenarioDefinition;
};

type ViewRunResponse<T = unknown> = {
  ok: boolean;
  items?: T[];
  meta?: Record<string, unknown>;
  error?: string;
};

type DataRecord = Record<string, unknown>;
type WatchStatus = {
  protocolId: string;
  marketType: string;
  resourceId: string;
  entityId: string;
  active: boolean;
  lastSignature: string | null;
  lastEventTime: string | null;
  lastBackfillAt: string | null;
  lastStreamEventAt: string | null;
  syncStatus: 'pending' | 'live' | 'catching_up' | 'stale';
  lagMs: number | null;
  updatedAt: string;
};

function formatCompact(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCurrencyCompact(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  if (Math.abs(value) < 1) {
    return `$${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.min(Math.max(digits + 2, 2), 6),
    }).format(value)}`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  if (value >= 1) {
    return `$${value.toFixed(4)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(6)}`;
  }
  return `$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 12,
  }).format(value)}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function formatDecimal(value: number | null | undefined, digits = 9): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const maximumFractionDigits = Math.min(Math.max(digits, 2), 9);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

function shortPubkey(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) {
    return '—';
  }
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getField(record: DataRecord | null, field?: string): unknown {
  if (!record || !field) {
    return null;
  }
  return field.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return null;
    }
    return (current as Record<string, unknown>)[segment];
  }, record);
}

function formatMetricValue(value: unknown, metric: ScenarioMetric): string {
  switch (metric.format) {
    case 'compact':
      return formatCompact(typeof value === 'number' ? value : Number(value ?? NaN), metric.digits ?? 2);
    case 'currencyCompact':
      return formatCurrencyCompact(typeof value === 'number' ? value : Number(value ?? NaN), metric.digits ?? 2);
    case 'price':
      return formatPrice(typeof value === 'number' ? value : Number(value ?? NaN));
    case 'percent':
      return formatPercent(typeof value === 'number' ? value : Number(value ?? NaN));
    case 'pubkey':
      return shortPubkey(typeof value === 'string' ? value : null);
    case 'time':
      return typeof value === 'string' && value ? new Date(value).toLocaleTimeString() : '—';
    case 'text':
    default:
      if (value === null || value === undefined || value === '') {
        return metric.fallback ?? '—';
      }
      return String(value);
  }
}

function buildChartGeometry(points: DataRecord[], fields: string[], width: number, height: number): {
  path: string;
  points: Array<{ x: number; y: number; value: number }>;
} {
  if (points.length === 0) {
    return { path: '', points: [] };
  }
  const values = points
    .map((point) => {
      for (const field of fields) {
        const value = getField(point, field);
        const numeric = typeof value === 'number' ? value : Number(value ?? NaN);
        if (Number.isFinite(numeric)) {
          return numeric;
        }
      }
      return NaN;
    })
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return { path: '', points: [] };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const chartPoints = points.map((point, index) => {
      let numeric = NaN;
      for (const field of fields) {
        const value = getField(point, field);
        const candidate = typeof value === 'number' ? value : Number(value ?? NaN);
        if (Number.isFinite(candidate)) {
          numeric = candidate;
          break;
        }
      }
      const safe = Number.isFinite(numeric) ? numeric : min;
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - ((safe - min) / range) * height;
      return { x, y, value: safe };
    });
  const path = chartPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  return { path, points: chartPoints };
}

async function runView<T>(
  baseUrl: string,
  protocolId: string,
  operationId: string,
  input: Record<string, unknown>,
  limit?: number,
): Promise<ViewRunResponse<T>> {
  const response = await fetch(`${baseUrl}/view-run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      protocol_id: protocolId,
      operation_id: operationId,
      input,
      ...(typeof limit === 'number' ? { limit } : {}),
    }),
  });
  const body = (await response.json()) as ViewRunResponse<T>;
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `${operationId} failed with ${response.status}`);
  }
  return body;
}

async function ensureWatchedEntity(
  baseUrl: string,
  protocolId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${baseUrl}/market/watch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      protocol_id: protocolId,
      input,
    }),
  });
  const body = (await response.json()) as { ok: boolean; item?: Record<string, unknown> | null; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `watch failed with ${response.status}`);
  }
  return body.item ?? null;
}

async function fetchWatchStatus(
  baseUrl: string,
  protocolId: string,
  input: Record<string, unknown>,
): Promise<WatchStatus | null> {
  const url = new URL(`${baseUrl}/market/watch-status`);
  url.searchParams.set('protocol_id', protocolId);
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url.toString());
  const body = (await response.json()) as { ok: boolean; item?: WatchStatus | null; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `watch-status failed with ${response.status}`);
  }
  return body.item ?? null;
}

async function unwatchEntity(
  baseUrl: string,
  protocolId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${baseUrl}/market/unwatch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      protocol_id: protocolId,
      input,
    }),
  });
  const body = (await response.json()) as { ok: boolean; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `unwatch failed with ${response.status}`);
  }
}

export function ViewScenarioTab({ viewApiBaseUrl, scenario }: ViewScenarioTabProps) {
  const REFRESH_INTERVAL_MS = 60_000;
  const savedEntitiesStorageKey = `view-scenario:${scenario.id}:saved-entities`;
  const [entityValue, setEntityValue] = useState(scenario.entity.defaultValue);
  const [savedEntities, setSavedEntities] = useState<string[]>([]);
  const [resolvedResource, setResolvedResource] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DataRecord | null>(null);
  const [stats, setStats] = useState<DataRecord | null>(null);
  const [series, setSeries] = useState<DataRecord[]>([]);
  const [feed, setFeed] = useState<DataRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [watchStatus, setWatchStatus] = useState<WatchStatus | null>(null);
  const lastEntityRef = useRef<string | null>(null);

  const trimmedBaseUrl = useMemo(() => viewApiBaseUrl.trim().replace(/\/+$/, ''), [viewApiBaseUrl]);
  const chartGeometry = useMemo(() => buildChartGeometry(series, scenario.chart.valueFields, 720, 220), [scenario.chart.valueFields, series]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(savedEntitiesStorageKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setSavedEntities(
          parsed
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim()),
        );
      }
    } catch {
      // Ignore invalid local state and start with an empty watchlist.
    }
  }, [savedEntitiesStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(savedEntitiesStorageKey, JSON.stringify(savedEntities));
    } catch {
      // Ignore persistence errors in local/dev mode.
    }
  }, [savedEntities, savedEntitiesStorageKey]);

  const readMetric = (metric: ScenarioMetric): string => {
    const sourceRecord =
      metric.source === 'snapshot' ? snapshot : metric.source === 'stats' ? stats : { value: resolvedResource };
    const rawValue = metric.source === 'resolved' ? resolvedResource : getField(sourceRecord, metric.field);
    return formatMetricValue(rawValue, metric);
  };

  const fetchScenarioData = useCallback(async (targetValue: string, mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') {
      setIsLoading(true);
      setStatusText(scenario.resolve.statusText);
    } else {
      setIsRefreshing(true);
      setStatusText(`Refreshing ${scenario.title.toLowerCase()}...`);
    }
    setErrorText(null);
    try {
      await ensureWatchedEntity(trimmedBaseUrl, scenario.protocolId, scenario.resolve.input(targetValue));
      const resolved = await runView<DataRecord>(
        trimmedBaseUrl,
        scenario.protocolId,
        scenario.resolve.operationId,
        scenario.resolve.input(targetValue),
        1,
      );
      const resourceValue = resolved.items?.[0]?.[scenario.resolve.resultField];
      if (typeof resourceValue !== 'string' || resourceValue.length === 0) {
        throw new Error(`No ${scenario.resource.label.toLowerCase()} found for this value.`);
      }

      lastEntityRef.current = targetValue;
      setResolvedResource(resourceValue);
      if (mode === 'initial') {
        setStatusText(`Loading ${scenario.views.snapshot}, ${scenario.views.stats}, ${scenario.views.series}, and ${scenario.views.feed}...`);
      }
      const resourceInput = { [scenario.resource.inputKey]: resourceValue };

      const [snapshotResult, statsResult, seriesResult, feedResult] = await Promise.all([
        runView<DataRecord>(trimmedBaseUrl, scenario.protocolId, scenario.views.snapshot, resourceInput, 1),
        runView<DataRecord>(trimmedBaseUrl, scenario.protocolId, scenario.views.stats, resourceInput, 1),
        runView<DataRecord>(trimmedBaseUrl, scenario.protocolId, scenario.views.series, resourceInput, 240),
        runView<DataRecord>(trimmedBaseUrl, scenario.protocolId, scenario.views.feed, resourceInput, 30),
      ]);

      setSnapshot(snapshotResult.items?.[0] ?? null);
      setStats(statsResult.items?.[0] ?? null);
      setSeries((seriesResult.items as DataRecord[] | undefined) ?? []);
      setFeed((feedResult.items as DataRecord[] | undefined) ?? []);
      const nextWatchStatus = await fetchWatchStatus(trimmedBaseUrl, scenario.protocolId, scenario.resolve.input(targetValue));
      setWatchStatus(nextWatchStatus);
      setLastUpdatedAt(new Date().toISOString());
      setStatusText(
        nextWatchStatus?.syncStatus === 'catching_up'
          ? `Loaded ${scenario.resource.label.toLowerCase()} ${resourceValue}. Backend is catching up recent activity...`
          : `Loaded ${scenario.resource.label.toLowerCase()} ${resourceValue}.`,
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Scenario load failed.');
      setStatusText(null);
      if (mode === 'initial') {
        setSnapshot(null);
        setStats(null);
        setSeries([]);
        setFeed([]);
        setResolvedResource(null);
        setWatchStatus(null);
        lastEntityRef.current = null;
        setLastUpdatedAt(null);
      }
    } finally {
      if (mode === 'initial') {
        setIsLoading(false);
      } else {
        setIsRefreshing(false);
      }
    }
  }, [scenario, trimmedBaseUrl]);

  const loadScenario = useCallback(async (targetValue: string) => {
    await fetchScenarioData(targetValue, 'initial');
  }, [fetchScenarioData]);

  const addCurrentEntity = useCallback(() => {
    const nextValue = entityValue.trim();
    if (!nextValue) {
      return;
    }
    setSavedEntities((current) => {
      if (current.includes(nextValue)) {
        return current;
      }
      return [nextValue, ...current].slice(0, 12);
    });
    setErrorText(null);
    void (async () => {
      try {
        await ensureWatchedEntity(trimmedBaseUrl, scenario.protocolId, scenario.resolve.input(nextValue));
        setWatchStatus(await fetchWatchStatus(trimmedBaseUrl, scenario.protocolId, scenario.resolve.input(nextValue)));
        setStatusText(`Saved ${scenario.entity.label.toLowerCase()} ${shortPubkey(nextValue)} and enabled backend watch.`);
      } catch (error) {
        setStatusText(`Saved ${scenario.entity.label.toLowerCase()} ${shortPubkey(nextValue)} locally.`);
        setErrorText(error instanceof Error ? error.message : 'Unable to enable backend watch.');
      }
    })();
  }, [entityValue, scenario.entity.label, scenario.protocolId, scenario.resolve, trimmedBaseUrl]);

  const removeSavedEntity = useCallback((value: string) => {
    setSavedEntities((current) => current.filter((entry) => entry !== value));
    if (value === entityValue.trim()) {
      setWatchStatus(null);
    }
    void (async () => {
      try {
        await unwatchEntity(trimmedBaseUrl, scenario.protocolId, scenario.resolve.input(value));
        setStatusText(`Removed ${shortPubkey(value)} and disabled backend watch.`);
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : 'Unable to disable backend watch.');
      }
    })();
  }, [entityValue, scenario.protocolId, scenario.resolve, trimmedBaseUrl]);

  const loadSavedEntity = useCallback(async (value: string) => {
    setEntityValue(value);
    await loadScenario(value);
  }, [loadScenario]);

  const loadLatest = useCallback(async () => {
    if (!scenario.latest) {
      return;
    }
    setIsLoading(true);
    setErrorText(null);
    setStatusText(scenario.latest.statusText);
    try {
      const latest = await runView<DataRecord>(
        trimmedBaseUrl,
        scenario.protocolId,
        scenario.latest.operationId,
        scenario.latest.input,
        1,
      );
      const nextValue = latest.items?.[0]?.[scenario.latest.resultField];
      if (typeof nextValue !== 'string' || nextValue.length === 0) {
        throw new Error(`No entity value returned by ${scenario.latest.operationId}.`);
      }
      setEntityValue(nextValue);
      await fetchScenarioData(nextValue, 'initial');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to load latest entity.');
      setStatusText(null);
    } finally {
      setIsLoading(false);
    }
  }, [fetchScenarioData, scenario, trimmedBaseUrl]);

  useEffect(() => {
    if (!autoRefreshEnabled || !lastEntityRef.current) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void fetchScenarioData(lastEntityRef.current as string, 'refresh');
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [autoRefreshEnabled, fetchScenarioData]);

  return (
    <section className="view-scenario-shell">
      <div className="view-scenario-header">
        <div>
          <h2>{scenario.title}</h2>
          <p>{scenario.description}</p>
        </div>
        <div className="view-playground-target">
          <span>Target</span>
          <code>{trimmedBaseUrl}</code>
        </div>
      </div>

      <div className="view-scenario-controls">
        <label>
          {scenario.entity.label}
          <input
            value={entityValue}
            onChange={(event) => setEntityValue(event.target.value)}
            disabled={isLoading}
            placeholder={scenario.entity.placeholder}
          />
        </label>
        <div className="view-scenario-actions">
          <button type="button" onClick={() => void loadScenario(entityValue)} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Load Scenario'}
          </button>
          <button type="button" className="secondary" onClick={addCurrentEntity} disabled={isLoading || entityValue.trim().length === 0}>
            Save Token
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void fetchScenarioData(entityValue, 'refresh')}
            disabled={isLoading || isRefreshing}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh Now'}
          </button>
          {scenario.latest ? (
            <button type="button" className="secondary" onClick={() => void loadLatest()} disabled={isLoading}>
              {scenario.latest.label}
            </button>
          ) : null}
        </div>
      </div>

      <div className="view-scenario-saved-bar">
        <span>Saved Tokens</span>
        {savedEntities.length > 0 ? (
          <div className="view-scenario-saved-list">
            {savedEntities.map((value) => (
              <div key={value} className="view-scenario-saved-chip">
                <button type="button" className="view-scenario-saved-load" onClick={() => void loadSavedEntity(value)}>
                  {shortPubkey(value)}
                </button>
                <button
                  type="button"
                  className="view-scenario-saved-remove"
                  aria-label={`Remove ${value}`}
                  onClick={() => removeSavedEntity(value)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="view-scenario-saved-empty">Save a mint here to keep a few Pump tokens handy while you compare screens.</p>
        )}
      </div>

      {statusText ? <p className="view-playground-info">{statusText}</p> : null}
      {errorText ? <p className="view-playground-error">{errorText}</p> : null}
      <div className="view-scenario-meta">
        <span>{autoRefreshEnabled ? 'Auto-refresh on (60s)' : 'Auto-refresh off'}</span>
        <button type="button" className="secondary" onClick={() => setAutoRefreshEnabled((value) => !value)}>
          {autoRefreshEnabled ? 'Pause Auto-refresh' : 'Enable Auto-refresh'}
        </button>
        <span>{lastUpdatedAt ? `Last updated ${new Date(lastUpdatedAt).toLocaleTimeString()}` : 'Not loaded yet'}</span>
        <span>
          {watchStatus
            ? `Sync ${watchStatus.syncStatus}${watchStatus.lastEventTime ? ` · last event ${formatRelativeTime(watchStatus.lastEventTime)}` : ''}`
            : 'Not watched yet'}
        </span>
      </div>

      <section className="view-scenario-hero">
        <div className="view-scenario-hero-main">
          <span className="view-scenario-eyebrow">
            {resolvedResource ? shortPubkey(resolvedResource) : scenario.resource.pendingLabel}
          </span>
          <div className="view-scenario-value-label">{scenario.hero.title.label}</div>
          <h3>{readMetric(scenario.hero.title)}</h3>
          <p>{scenario.hero.subtitle.map(readMetric).join(' / ')}</p>
          <div className="view-scenario-highlights">
            {scenario.hero.highlights.map((metric) => (
              <span key={metric.label}>
                {metric.label} {readMetric(metric)}
              </span>
            ))}
          </div>
        </div>
        <div className="view-scenario-hero-side">
          {scenario.hero.sideMetrics.map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong>{readMetric(metric)}</strong>
            </div>
          ))}
        </div>
      </section>

      <div className="view-scenario-card-grid">
        {scenario.statCards.map((metric) => (
          <article key={metric.label} className="view-scenario-stat-card">
            <span>{metric.label}</span>
            <strong>{readMetric(metric)}</strong>
          </article>
        ))}
      </div>

      <div className="view-scenario-panels">
        <section className="view-scenario-chart-panel">
          <div className="view-scenario-panel-header">
            <h3>{scenario.chart.title}</h3>
            <span>{scenario.chart.valueLabel ? `${series.length} point(s) · ${scenario.chart.valueLabel}` : `${series.length} point(s)`}</span>
          </div>
          {series.length > 0 && chartGeometry.points.length > 0 ? (
            <div className="view-scenario-chart-shell">
              <svg viewBox="0 0 720 220" preserveAspectRatio="none" role="img" aria-label="Scenario chart">
                {chartGeometry.points.length > 1 ? (
                  <path d={chartGeometry.path} fill="none" stroke="#4ade80" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                ) : null}
                {chartGeometry.points.map((point, index) => (
                  <circle
                    key={`${index}:${point.x}:${point.y}`}
                    cx={point.x}
                    cy={point.y}
                    r={chartGeometry.points.length === 1 ? 6 : 4}
                    fill="#4ade80"
                    stroke="#d9ffe7"
                    strokeWidth="2"
                  />
                ))}
              </svg>
            </div>
          ) : (
            <p className="view-playground-empty">No series points yet for this scenario.</p>
          )}
          {series.length === 1 ? (
            <p className="view-playground-empty">Only one 1-minute bucket so far. The line will appear as more trades arrive.</p>
          ) : null}
        </section>
      </div>

      <section className="view-scenario-feed-panel view-scenario-feed-panel-full">
        <div className="view-scenario-panel-header">
          <h3>{scenario.feed.title}</h3>
          <span>{feed.length} item(s)</span>
        </div>
        {feed.length > 0 ? (
          <div className="view-scenario-feed-table-wrap">
            <table className="view-scenario-feed-table">
              <thead>
                <tr>
                  <th>{scenario.feed.accountLabel ?? (scenario.feed.accountField ? 'Account' : 'Item')}</th>
                  <th>{scenario.feed.typeLabel ?? 'Type'}</th>
                  <th>{scenario.feed.amountLabel ?? 'Amount'}</th>
                  <th>{scenario.feed.tokenAmountLabel ?? 'Token Amount'}</th>
                  <th>Time</th>
                  <th>{scenario.feed.referenceLabel ?? (scenario.feed.txField ? 'Txn' : 'Reference')}</th>
                </tr>
              </thead>
              <tbody>
                {feed.map((item, index) => {
                  const sideText = scenario.feed.sideField ? String(getField(item, scenario.feed.sideField) ?? '') : '';
                  const timeValue = getField(item, scenario.feed.timeField);
                  const amountValue = getField(item, scenario.feed.amountField);
                  const tokenAmountValue = scenario.feed.tokenAmountField ? getField(item, scenario.feed.tokenAmountField) : null;
                  const txValue = scenario.feed.txField ? getField(item, scenario.feed.txField) : null;
                  const accountValue = scenario.feed.accountField ? getField(item, scenario.feed.accountField) : null;
                  const priceValue = getField(item, scenario.feed.priceField);
                  const secondaryValue = scenario.feed.secondaryValueField ? getField(item, scenario.feed.secondaryValueField) : null;

                  return (
                    <tr key={`${index}:${String(getField(item, 'signature') ?? getField(item, 'slot') ?? index)}`} className={`view-scenario-feed-row ${sideText}`}>
                      <td>
                        <strong>{typeof accountValue === 'string' ? shortPubkey(accountValue) : '—'}</strong>
                      </td>
                      <td>
                        <span className={`view-scenario-side-pill ${sideText}`}>{sideText ? sideText.toUpperCase() : 'ITEM'}</span>
                      </td>
                      <td>
                        <strong>{formatDecimal(typeof amountValue === 'number' ? amountValue : Number(amountValue ?? NaN), 9)}</strong>
                        <span>{scenario.feed.amountUnitLabel ?? '—'}</span>
                      </td>
                      <td>
                        <strong>{formatCompact(typeof tokenAmountValue === 'number' ? tokenAmountValue : Number(tokenAmountValue ?? NaN), 2)}</strong>
                        <span>{scenario.feed.tokenAmountUnitLabel ?? scenario.feed.tokenAmountLabel ?? 'Token'}</span>
                      </td>
                      <td>
                        <strong>{formatRelativeTime(typeof timeValue === 'string' ? timeValue : null)}</strong>
                        <span>{typeof timeValue === 'string' && timeValue ? new Date(timeValue).toLocaleTimeString() : '—'}</span>
                      </td>
                      <td>
                        <strong>{typeof txValue === 'string' ? shortPubkey(txValue) : '—'}</strong>
                        <span>
                          {scenario.feed.priceLabel ? `${scenario.feed.priceLabel} ${formatPrice(typeof priceValue === 'number' ? priceValue : Number(priceValue ?? NaN))}` : formatPrice(typeof priceValue === 'number' ? priceValue : Number(priceValue ?? NaN))}
                        </span>
                        {scenario.feed.secondaryValueLabel ? (
                          <span>{`${scenario.feed.secondaryValueLabel} ${formatCurrencyCompact(typeof secondaryValue === 'number' ? secondaryValue : Number(secondaryValue ?? NaN), 2)}`}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="view-playground-empty">No feed items materialized yet for this scenario.</p>
        )}
      </section>
    </section>
  );
}
