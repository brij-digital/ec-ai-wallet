import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  isBusinessDay,
  isUTCTimestamp,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

type PumpWorkspaceTabProps = {
  viewApiBaseUrl: string;
};

type ViewRunResponse = {
  ok: boolean;
  items?: unknown[];
  meta?: Record<string, unknown>;
  error?: string;
};

type RankedToken = {
  mint: string;
  pool: string;
  marketType: string;
  score: number;
  liquidityQuote: number;
  volumeWindowQuote: number;
  tradeCountWindow: number;
  uniqueTradersWindow: number;
  buyCountWindow: number;
  sellCountWindow: number;
  lastTradeAt: string | null;
  warnings: string[];
};

type TokenTradeContext = {
  mint: string;
  pool: string;
  marketType: string;
  priceQuote: number;
  marketCapQuote: number | null;
  liquidityQuote: number;
  volume24hQuote: number;
  latestTradeAt: string | null;
  confidence?: string;
  confidenceScore?: number;
  warnings?: string[];
  checks?: Array<{
    code?: string;
    label?: string;
    status?: string;
    value?: number | string | null;
    value_ms?: number | null;
  }>;
  actionContext?: Record<string, unknown>;
};

type TradeFeedItem = {
  eventTime?: string | null;
  blockTime?: string | null;
  side?: string;
  quoteAmountUi?: number;
  priceQuote?: number;
  userPubkey?: string;
  signature?: string;
};

type HistoryResponse = {
  s: 'ok' | 'no_data' | 'error';
  errmsg?: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
};

type CandleInspect = {
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changePct: number | null;
};

const DEFAULT_QUOTE_MINT = 'So11111111111111111111111111111111111111112';

type WorkspaceCallConfig = {
  operation: string;
  input?: Record<string, unknown>;
  limit?: number;
};

type WorkspaceChartConfig = {
  provider?: string;
  symbol_prefix?: string;
  resolution?: string;
  lookback_seconds?: number;
  limit?: number;
};

type WorkspaceSeedConfig = WorkspaceCallConfig & {
  entity_field?: string;
};

type WorkspaceMeta = {
  title?: string;
  description?: string;
  seed?: WorkspaceSeedConfig;
  context?: WorkspaceCallConfig;
  feed?: WorkspaceCallConfig;
  chart?: WorkspaceChartConfig;
};

type ProtocolMetaResponse = {
  workspaces?: Record<string, WorkspaceMeta>;
};

function formatPriceLabel(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const abs = Math.abs(value);
  if (abs === 0) {
    return '0';
  }
  if (abs >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (abs >= 1) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  }
  if (abs >= 0.000001) {
    return value.toFixed(8);
  }
  return value.toExponential(4);
}

function formatCompact(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString(undefined, {
    notation: 'compact',
    maximumFractionDigits: digits,
  });
}

function formatTimeLabel(time: Time | unknown): string {
  const value = time as Time;
  if (isUTCTimestamp(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (isBusinessDay(value)) {
    return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
  }
  if (typeof value === 'string') {
    return value;
  }
  return '';
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

async function runView(
  baseUrl: string,
  protocolId: string,
  operationId: string,
  input: Record<string, unknown>,
  limit?: number,
): Promise<ViewRunResponse> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/view-run`, {
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

function substituteEntity(input: Record<string, unknown> | undefined, entity: string): Record<string, unknown> {
  if (!input) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, value === '$entity' ? entity : value]),
  );
}

function buildHistoryUrl(baseUrl: string, mint: string, chartConfig?: WorkspaceChartConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const from = now - (chartConfig?.lookback_seconds ?? (24 * 60 * 60));
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/tradingview/history`);
  url.searchParams.set('symbol', `${chartConfig?.symbol_prefix ?? 'pump:'}${mint}`);
  url.searchParams.set('resolution', chartConfig?.resolution ?? '1');
  url.searchParams.set('from', String(from));
  url.searchParams.set('to', String(now));
  url.searchParams.set('limit', String(chartConfig?.limit ?? 500));
  return url.toString();
}

export function PumpWorkspaceTab({ viewApiBaseUrl }: PumpWorkspaceTabProps) {
  const baseUrl = useMemo(() => viewApiBaseUrl.trim().replace(/\/+$/, ''), [viewApiBaseUrl]);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const latestInspectRef = useRef<CandleInspect | null>(null);

  const [rankedTokens, setRankedTokens] = useState<RankedToken[]>([]);
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [context, setContext] = useState<TokenTradeContext | null>(null);
  const [feed, setFeed] = useState<TradeFeedItem[]>([]);
  const [chartStatus, setChartStatus] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [selectedCandle, setSelectedCandle] = useState<CandleInspect | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [workspaceMeta, setWorkspaceMeta] = useState<WorkspaceMeta | null>(null);

  const selectedRanked = rankedTokens.find((item) => item.mint === selectedMint) ?? null;

  const workspaceTitle = workspaceMeta?.title ?? 'Pump Workspace';
  const workspaceDescription = workspaceMeta?.description ?? 'Discover active mints, inspect execution context, validate price action, and jump straight into handoff-ready buy or sell inputs.';

  useEffect(() => {
    if (!chartContainerRef.current) {
      return;
    }
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#17325a',
      },
      localization: {
        priceFormatter: formatPriceLabel,
      },
      grid: {
        vertLines: { color: '#edf2fb' },
        horzLines: { color: '#edf2fb' },
      },
      rightPriceScale: {
        borderColor: '#d7e2f2',
      },
      timeScale: {
        borderColor: '#d7e2f2',
        timeVisible: true,
        secondsVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height: 360,
    });
    chartRef.current = chart;
    const onResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  async function loadRankedTokens(): Promise<void> {
    const seed = workspaceMeta?.seed;
    const response = await runView(
      baseUrl,
      'pump-amm-mainnet',
      seed?.operation ?? 'ranked_active_tokens',
      substituteEntity(seed?.input, selectedMint ?? ''),
      seed?.limit ?? 12,
    );
    if (!response.ok || !Array.isArray(response.items)) {
      throw new Error(response.error ?? 'Failed to load ranked Pump tokens.');
    }
    const items = response.items.filter((item): item is RankedToken => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
      }
      const row = item as Record<string, unknown>;
      return typeof row.mint === 'string' && typeof row.pool === 'string';
    });
    setRankedTokens(items);
    if (!selectedMint && items[0]?.mint) {
      setSelectedMint(items[0].mint);
    } else if (selectedMint && !items.some((item) => item.mint === selectedMint) && items[0]?.mint) {
      setSelectedMint(items[0].mint);
    }
  }

  async function loadWorkspace(mint: string): Promise<void> {
    const contextConfig = workspaceMeta?.context;
    const feedConfig = workspaceMeta?.feed;
    const [contextResponse, feedResponse] = await Promise.all([
      runView(
        baseUrl,
        'pump-amm-mainnet',
        contextConfig?.operation ?? 'token_trade_context',
        substituteEntity(
          contextConfig?.input ?? {
            mint,
            quote_mint: DEFAULT_QUOTE_MINT,
          },
          mint,
        ),
        contextConfig?.limit ?? 1,
      ),
      runView(
        baseUrl,
        'pump-amm-mainnet',
        feedConfig?.operation ?? 'trade_feed',
        substituteEntity(
          feedConfig?.input ?? {
            mint,
            quote_mint: DEFAULT_QUOTE_MINT,
          },
          mint,
        ),
        feedConfig?.limit ?? 12,
      ),
    ]);

    if (!contextResponse.ok || !Array.isArray(contextResponse.items) || !contextResponse.items[0]) {
      throw new Error(contextResponse.error ?? 'Failed to load token trade context.');
    }

    setContext(contextResponse.items[0] as TokenTradeContext);
    setFeed(Array.isArray(feedResponse.items) ? (feedResponse.items as TradeFeedItem[]) : []);
  }

  async function loadChart(mint: string): Promise<void> {
    setChartError(null);
    setChartStatus(null);
    const historyUrl = buildHistoryUrl(baseUrl, mint, workspaceMeta?.chart);
    const response = await fetch(historyUrl);
    const body = await response.json() as HistoryResponse;
    if (!response.ok || body.s === 'error') {
      throw new Error(body.errmsg ?? 'Failed to load chart history.');
    }

    const times = body.t ?? [];
    const opens = body.o ?? [];
    const highs = body.h ?? [];
    const lows = body.l ?? [];
    const closes = body.c ?? [];
    const volumes = body.v ?? [];

    const candleData: CandlestickData[] = times.map((time, index) => ({
      time: time as UTCTimestamp,
      open: opens[index] ?? 0,
      high: highs[index] ?? 0,
      low: lows[index] ?? 0,
      close: closes[index] ?? 0,
    }));
    const volumeData = times.map((time, index) => ({
      time: time as UTCTimestamp,
      value: volumes[index] ?? 0,
      color: (closes[index] ?? 0) >= (opens[index] ?? 0) ? '#2e8b57' : '#c64545',
    }));

    const latest = candleData.at(-1);
    const latestVolume = volumeData.at(-1)?.value ?? 0;
    if (latest) {
      latestInspectRef.current = {
        timeLabel: formatTimeLabel(latest.time),
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: latest.close,
        volume: latestVolume,
        changePct: latest.open === 0 ? null : ((latest.close - latest.open) / latest.open) * 100,
      };
      setSelectedCandle(latestInspectRef.current);
    } else {
      latestInspectRef.current = null;
      setSelectedCandle(null);
    }

    if (!chartContainerRef.current || !chartRef.current) {
      return;
    }
    chartRef.current.remove();
    const rebuilt = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#17325a',
      },
      localization: {
        priceFormatter: formatPriceLabel,
      },
      grid: {
        vertLines: { color: '#edf2fb' },
        horzLines: { color: '#edf2fb' },
      },
      rightPriceScale: {
        borderColor: '#d7e2f2',
      },
      timeScale: {
        borderColor: '#d7e2f2',
        timeVisible: true,
        secondsVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height: 360,
    });
    chartRef.current = rebuilt;
    const candleSeries = rebuilt.addSeries(CandlestickSeries, {
      upColor: '#2e8b57',
      downColor: '#c64545',
      borderUpColor: '#2e8b57',
      borderDownColor: '#c64545',
      wickUpColor: '#2e8b57',
      wickDownColor: '#c64545',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    candleSeriesRef.current = candleSeries;
    const volumeSeries = rebuilt.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    rebuilt.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    });
    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    rebuilt.timeScale().fitContent();
    rebuilt.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      const series = candleSeriesRef.current;
      if (!series || !param.point || !param.time) {
        setSelectedCandle(latestInspectRef.current);
        return;
      }
      const data = param.seriesData.get(series);
      if (!data || !('open' in data) || !('high' in data) || !('low' in data) || !('close' in data)) {
        setSelectedCandle(latestInspectRef.current);
        return;
      }
      const matchedVolume = volumeData.find((entry) => String(entry.time) === String(param.time))?.value ?? 0;
      setSelectedCandle({
        timeLabel: formatTimeLabel(param.time),
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        volume: matchedVolume,
        changePct: data.open === 0 ? null : ((data.close - data.open) / data.open) * 100,
      });
    });
    setChartStatus(`Loaded ${candleData.length} bars of indexed Pump history.`);
  }

  async function refreshAll(targetMint?: string): Promise<void> {
    setIsRefreshing(true);
    setWorkspaceError(null);
    try {
      await loadRankedTokens();
      const mint = targetMint ?? selectedMint;
      if (mint) {
        await Promise.all([loadWorkspace(mint), loadChart(mint)]);
      }
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to load Pump workspace.');
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const metaResponse = await fetch('/idl/pump_amm.meta.core.json');
        if (metaResponse.ok) {
          const metaJson = (await metaResponse.json()) as ProtocolMetaResponse;
          setWorkspaceMeta(metaJson.workspaces?.market_mint ?? null);
        }
      } catch {
        setWorkspaceMeta(null);
      }
    })();
  }, []);

  useEffect(() => {
    void refreshAll();
    const interval = window.setInterval(() => {
      void refreshAll(selectedMint ?? undefined);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [workspaceMeta]);

  useEffect(() => {
    if (!selectedMint) {
      return;
    }
    void (async () => {
      setWorkspaceError(null);
      try {
        await Promise.all([loadWorkspace(selectedMint), loadChart(selectedMint)]);
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : 'Failed to load selected Pump mint.');
      }
    })();
  }, [selectedMint]);

  const actions = context?.actionContext && typeof context.actionContext === 'object'
    ? Object.entries(context.actionContext)
    : [];

  return (
    <section className="pump-workspace-shell">
      <div className="pump-workspace-header">
        <div>
          <h2>{workspaceTitle}</h2>
          <p>{workspaceDescription}</p>
        </div>
        <div className="pump-workspace-target">
          <span>Target</span>
          <code>{baseUrl}</code>
        </div>
      </div>

      <div className="pump-workspace-toolbar">
        <div className="pump-workspace-toolbar-copy">
          <strong>Primary flow</strong>
          <span>Discover active mints, qualify them, inspect the chart, then act.</span>
        </div>
        <button type="button" onClick={() => void refreshAll(selectedMint ?? undefined)} disabled={isRefreshing}>
          {isRefreshing ? 'Refreshing…' : 'Refresh Workspace'}
        </button>
      </div>

      {workspaceError ? <p className="view-playground-error">{workspaceError}</p> : null}
      {chartError ? <p className="view-playground-error">{chartError}</p> : null}
      {chartStatus ? <p className="view-playground-info">{chartStatus}</p> : null}

      <div className="pump-workspace-layout">
        <aside className="pump-rankings-panel">
          <div className="pump-panel-header">
            <h3>Active Tokens</h3>
            <span>{rankedTokens.length} live candidates</span>
          </div>
          <div className="pump-ranking-list">
            {rankedTokens.map((token, index) => {
              const active = token.mint === selectedMint;
              return (
                <button
                  key={token.mint}
                  type="button"
                  className={active ? 'pump-ranking-card active' : 'pump-ranking-card'}
                  onClick={() => setSelectedMint(token.mint)}
                >
                  <div className="pump-ranking-head">
                    <strong>#{index + 1} {shortPubkey(token.mint)}</strong>
                    <code>{token.score.toFixed(3)}</code>
                  </div>
                  <div className="pump-ranking-metrics">
                    <span>Vol {formatCompact(token.volumeWindowQuote)}</span>
                    <span>Liq {formatCompact(token.liquidityQuote)}</span>
                    <span>Trades {token.tradeCountWindow}</span>
                  </div>
                  {token.warnings.length > 0 ? (
                    <div className="pump-ranking-tags">
                      {token.warnings.slice(0, 3).map((warning) => <code key={warning}>{warning}</code>)}
                    </div>
                  ) : (
                    <div className="pump-ranking-tags">
                      <code>clean_flow</code>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="pump-workspace-main">
          <section className="pump-panel">
            <div className="pump-panel-header">
              <h3>Mint Workspace</h3>
              <span>
                {selectedRanked ? `Score ${selectedRanked.score.toFixed(3)}` : (selectedMint ?? 'Select a mint')}
              </span>
            </div>
            {context ? (
              <>
                <div className="pump-hero-grid">
                  <div className="pump-hero-card">
                    <span>Price</span>
                    <strong>{formatPriceLabel(context.priceQuote)}</strong>
                  </div>
                  <div className="pump-hero-card">
                    <span>Market Cap</span>
                    <strong>{formatCompact(context.marketCapQuote)}</strong>
                  </div>
                  <div className="pump-hero-card">
                    <span>Liquidity</span>
                    <strong>{formatCompact(context.liquidityQuote)}</strong>
                  </div>
                  <div className="pump-hero-card">
                    <span>24h Volume</span>
                    <strong>{formatCompact(context.volume24hQuote)}</strong>
                  </div>
                  <div className="pump-hero-card">
                    <span>Latest Trade</span>
                    <strong>{context.latestTradeAt ?? '—'}</strong>
                  </div>
                  <div className="pump-hero-card">
                    <span>Confidence</span>
                    <strong>{context.confidence ?? '—'}{typeof context.confidenceScore === 'number' ? ` (${context.confidenceScore.toFixed(3)})` : ''}</strong>
                  </div>
                </div>

                <div className="pump-context-grid">
                  <section className="pump-context-card">
                    <span>Warning Codes</span>
                    {Array.isArray(context.warnings) && context.warnings.length > 0 ? (
                      <div className="pump-ranking-tags">
                        {context.warnings.map((warning) => <code key={warning}>{warning}</code>)}
                      </div>
                    ) : (
                      <strong>No major warnings</strong>
                    )}
                  </section>
                  <section className="pump-context-card">
                    <span>State Checks</span>
                    {Array.isArray(context.checks) && context.checks.length > 0 ? (
                      <div className="pump-check-list">
                        {context.checks.map((check, index) => (
                          <div key={`${check.code ?? 'check'}-${index}`} className="pump-check-row">
                            <strong>{check.label ?? check.code ?? 'check'}</strong>
                            <code>{check.status ?? 'unknown'}</code>
                            <span>
                              {typeof check.value_ms === 'number'
                                ? `${check.value_ms} ms`
                                : check.value == null
                                  ? 'n/a'
                                  : String(check.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <strong>No state checks</strong>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <p className="view-playground-empty">Loading context…</p>
            )}
          </section>

          <section className="pump-panel">
            <div className="pump-panel-header">
              <h3>Price Chart</h3>
              <span>Dense 1m indexed history</span>
            </div>
            {selectedCandle ? (
              <div className="tv-ohlc-strip">
                <div><span>Time</span><strong>{selectedCandle.timeLabel}</strong></div>
                <div><span>Open</span><strong>{formatPriceLabel(selectedCandle.open)}</strong></div>
                <div><span>High</span><strong>{formatPriceLabel(selectedCandle.high)}</strong></div>
                <div><span>Low</span><strong>{formatPriceLabel(selectedCandle.low)}</strong></div>
                <div><span>Close</span><strong>{formatPriceLabel(selectedCandle.close)}</strong></div>
                <div><span>Volume</span><strong>{selectedCandle.volume.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong></div>
                <div><span>Change</span><strong>{selectedCandle.changePct == null ? '—' : `${selectedCandle.changePct >= 0 ? '+' : ''}${selectedCandle.changePct.toFixed(2)}%`}</strong></div>
              </div>
            ) : null}
            <div className="tv-test-chart" ref={chartContainerRef} />
          </section>

          <section className="pump-two-column">
            <section className="pump-panel">
              <div className="pump-panel-header">
                <h3>Recent Trades</h3>
                <span>{feed.length} latest fills</span>
              </div>
              <div className="pump-trade-feed">
                {feed.map((item, index) => (
                  <article key={`${item.signature ?? 'trade'}-${index}`} className="pump-trade-row">
                    <div>
                      <strong>{item.side ?? 'trade'}</strong>
                      <span>{item.eventTime ?? item.blockTime ?? '—'}</span>
                    </div>
                    <div>
                      <strong>{typeof item.quoteAmountUi === 'number' ? item.quoteAmountUi.toFixed(6) : '—'}</strong>
                      <span>{typeof item.priceQuote === 'number' ? formatPriceLabel(item.priceQuote) : '—'}</span>
                    </div>
                    <div>
                      <strong>{shortPubkey(item.userPubkey)}</strong>
                      <span>{shortPubkey(item.signature)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="pump-panel">
              <div className="pump-panel-header">
                <h3>Execution Handoff</h3>
                <span>Ready-to-fill operations</span>
              </div>
              <div className="pump-action-list">
                {actions.map(([name, action]) => (
                  <article key={name} className="pump-action-card">
                    <strong>{name}</strong>
                    <pre>{JSON.stringify(action, null, 2)}</pre>
                  </article>
                ))}
              </div>
            </section>
          </section>
        </div>
      </div>
    </section>
  );
}
