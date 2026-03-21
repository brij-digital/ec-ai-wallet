import { useMemo, useState } from 'react';
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

function formatCompact(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  if (value >= 1) {
    return value.toFixed(4);
  }
  return value.toPrecision(4);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
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

function buildChartPath(points: DataRecord[], fields: string[], width: number, height: number): string {
  if (points.length === 0) {
    return '';
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
    return '';
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return points
    .map((point, index) => {
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
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
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

export function ViewScenarioTab({ viewApiBaseUrl, scenario }: ViewScenarioTabProps) {
  const [entityValue, setEntityValue] = useState(scenario.entity.defaultValue);
  const [resolvedResource, setResolvedResource] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DataRecord | null>(null);
  const [stats, setStats] = useState<DataRecord | null>(null);
  const [series, setSeries] = useState<DataRecord[]>([]);
  const [feed, setFeed] = useState<DataRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const trimmedBaseUrl = useMemo(() => viewApiBaseUrl.trim().replace(/\/+$/, ''), [viewApiBaseUrl]);
  const chartPath = useMemo(() => buildChartPath(series, scenario.chart.valueFields, 720, 220), [scenario.chart.valueFields, series]);

  const readMetric = (metric: ScenarioMetric): string => {
    const sourceRecord =
      metric.source === 'snapshot' ? snapshot : metric.source === 'stats' ? stats : { value: resolvedResource };
    const rawValue = metric.source === 'resolved' ? resolvedResource : getField(sourceRecord, metric.field);
    return formatMetricValue(rawValue, metric);
  };

  const loadScenario = async (targetValue: string) => {
    setIsLoading(true);
    setErrorText(null);
    setStatusText(scenario.resolve.statusText);
    try {
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

      setResolvedResource(resourceValue);
      setStatusText(`Loading ${scenario.views.snapshot}, ${scenario.views.stats}, ${scenario.views.series}, and ${scenario.views.feed}...`);
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
      setStatusText(`Loaded ${scenario.resource.label.toLowerCase()} ${resourceValue}.`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Scenario load failed.');
      setStatusText(null);
      setSnapshot(null);
      setStats(null);
      setSeries([]);
      setFeed([]);
      setResolvedResource(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadLatest = async () => {
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
      await loadScenario(nextValue);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to load latest entity.');
      setStatusText(null);
    } finally {
      setIsLoading(false);
    }
  };

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
          {scenario.latest ? (
            <button type="button" className="secondary" onClick={() => void loadLatest()} disabled={isLoading}>
              {scenario.latest.label}
            </button>
          ) : null}
        </div>
      </div>

      {statusText ? <p className="view-playground-info">{statusText}</p> : null}
      {errorText ? <p className="view-playground-error">{errorText}</p> : null}

      <section className="view-scenario-hero">
        <div className="view-scenario-hero-main">
          <span className="view-scenario-eyebrow">
            {resolvedResource ? shortPubkey(resolvedResource) : scenario.resource.pendingLabel}
          </span>
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
            <span>{series.length} point(s)</span>
          </div>
          {series.length > 0 && chartPath ? (
            <div className="view-scenario-chart-shell">
              <svg viewBox="0 0 720 220" preserveAspectRatio="none" role="img" aria-label="Scenario chart">
                <path d={chartPath} fill="none" stroke="#4ade80" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </div>
          ) : (
            <p className="view-playground-empty">No series points yet for this scenario.</p>
          )}
        </section>

        <section className="view-scenario-feed-panel">
          <div className="view-scenario-panel-header">
            <h3>{scenario.feed.title}</h3>
            <span>{feed.length} item(s)</span>
          </div>
          {feed.length > 0 ? (
            <div className="view-scenario-feed-list">
              {feed.map((item, index) => {
                const sideText = scenario.feed.sideField ? String(getField(item, scenario.feed.sideField) ?? '') : '';
                const timeValue = getField(item, scenario.feed.timeField);
                const amountValue = getField(item, scenario.feed.amountField);
                const priceValue = getField(item, scenario.feed.priceField);
                const secondaryValue = scenario.feed.secondaryValueField ? getField(item, scenario.feed.secondaryValueField) : null;
                const secondaryText = scenario.feed.secondaryTextField ? getField(item, scenario.feed.secondaryTextField) : null;
                return (
                  <article key={`${index}:${String(getField(item, 'signature') ?? getField(item, 'slot') ?? index)}`} className={`view-scenario-feed-item ${sideText}`}>
                    <div>
                      <strong>{sideText ? sideText.toUpperCase() : 'ITEM'}</strong>
                      <span>{typeof timeValue === 'string' && timeValue ? new Date(timeValue).toLocaleTimeString() : '—'}</span>
                    </div>
                    <div>
                      <strong>{formatCompact(typeof amountValue === 'number' ? amountValue : Number(amountValue ?? NaN), 2)}</strong>
                      <span>@ {formatPrice(typeof priceValue === 'number' ? priceValue : Number(priceValue ?? NaN))}</span>
                    </div>
                    <div>
                      <strong>{formatCompact(typeof secondaryValue === 'number' ? secondaryValue : Number(secondaryValue ?? NaN), 1)}</strong>
                      <span>{typeof secondaryText === 'string' ? shortPubkey(secondaryText) : '—'}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="view-playground-empty">No feed items materialized yet for this scenario.</p>
          )}
        </section>
      </div>
    </section>
  );
}
