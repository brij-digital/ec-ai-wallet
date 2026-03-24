import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
} from 'lightweight-charts';

type TradingViewTestTabProps = {
  viewApiBaseUrl: string;
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

const DEFAULT_SYMBOL = 'pump:GknmGPnRtnmfSW44t8NqtQG8opKmfiHRvNXxhq69pump';

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

function buildHistoryUrl(baseUrl: string, symbol: string, resolution: string, from: number, to: number): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/tradingview/history`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('resolution', resolution);
  url.searchParams.set('from', String(from));
  url.searchParams.set('to', String(to));
  url.searchParams.set('limit', '500');
  return url.toString();
}

function buildSymbolUrl(baseUrl: string, symbol: string): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/tradingview/symbols`);
  url.searchParams.set('symbol', symbol);
  return url.toString();
}

export function TradingViewTestTab({ viewApiBaseUrl }: TradingViewTestTabProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [resolution, setResolution] = useState('1');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [symbolInfo, setSymbolInfo] = useState<string | null>(null);
  const [historyUrl, setHistoryUrl] = useState('');
  const [symbolUrl, setSymbolUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
        entireTextOnly: false,
      },
      timeScale: {
        borderColor: '#d7e2f2',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: '#9bb0d8' },
        horzLine: { color: '#9bb0d8' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 420,
    });

    chartRef.current = chart;
    const handleResize = () => {
      if (!chartContainerRef.current || !chartRef.current) {
        return;
      }
      chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  async function loadData() {
    setIsLoading(true);
    setErrorText(null);
    setStatusText(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const lookbackSeconds = resolution === '1D' ? 90 * 24 * 60 * 60 : resolution === '60' ? 7 * 24 * 60 * 60 : 6 * 60 * 60;
      const from = now - lookbackSeconds;
      const historyEndpoint = buildHistoryUrl(viewApiBaseUrl, symbol, resolution, from, now);
      const symbolEndpoint = buildSymbolUrl(viewApiBaseUrl, symbol);

      setHistoryUrl(historyEndpoint);
      setSymbolUrl(symbolEndpoint);

      const [symbolResponse, historyResponse] = await Promise.all([
        fetch(symbolEndpoint),
        fetch(historyEndpoint),
      ]);

      const symbolBody = await symbolResponse.json() as Record<string, unknown>;
      const historyBody = await historyResponse.json() as HistoryResponse;

      setSymbolInfo(JSON.stringify(symbolBody, null, 2));
      if (!historyResponse.ok || historyBody.s === 'error') {
        throw new Error(historyBody.errmsg ?? `History request failed with ${historyResponse.status}.`);
      }

      const times = historyBody.t ?? [];
      const opens = historyBody.o ?? [];
      const highs = historyBody.h ?? [];
      const lows = historyBody.l ?? [];
      const closes = historyBody.c ?? [];
      const volumes = historyBody.v ?? [];

      const candleData: CandlestickData[] = times.map((time, index) => ({
        time: time as UTCTimestamp,
        open: opens[index] ?? 0,
        high: highs[index] ?? 0,
        low: lows[index] ?? 0,
        close: closes[index] ?? 0,
      }));
      const volumeData: HistogramData[] = times.map((time, index) => ({
        time: time as UTCTimestamp,
        value: volumes[index] ?? 0,
        color: (closes[index] ?? 0) >= (opens[index] ?? 0) ? '#2e8b57' : '#c64545',
      }));

      const chart = chartRef.current;
      if (!chart) {
        throw new Error('Chart is not ready.');
      }
      chart.remove();
      if (!chartContainerRef.current) {
        throw new Error('Chart container is not ready.');
      }

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
          entireTextOnly: false,
        },
        timeScale: {
          borderColor: '#d7e2f2',
          timeVisible: true,
          secondsVisible: false,
        },
        width: chartContainerRef.current.clientWidth,
        height: 420,
      });
      chartRef.current = rebuilt;
      const candleSeries = rebuilt.addSeries(CandlestickSeries, {
        upColor: '#2e8b57',
        downColor: '#c64545',
        borderUpColor: '#2e8b57',
        borderDownColor: '#c64545',
        wickUpColor: '#2e8b57',
        wickDownColor: '#c64545',
        priceLineVisible: true,
        lastValueVisible: true,
      });
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

      setStatusText(`Loaded ${candleData.length} bars from TradingView history endpoint.`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load TradingView data.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  return (
    <section className="tv-test-shell">
      <div className="tv-test-header">
        <div>
          <h2>TradingView Test</h2>
          <p>Minimal candlestick test wired to the live Pump TradingView-compatible datalayer on the AppPack API.</p>
        </div>
      </div>

      <div className="tv-test-controls">
        <label>
          Symbol
          <input value={symbol} onChange={(event) => setSymbol(event.target.value)} disabled={isLoading} />
        </label>
        <label>
          Resolution
          <select value={resolution} onChange={(event) => setResolution(event.target.value)} disabled={isLoading}>
            <option value="1">1m</option>
            <option value="5">5m</option>
            <option value="15">15m</option>
            <option value="60">1h</option>
            <option value="1D">1d</option>
          </select>
        </label>
        <button type="button" onClick={() => void loadData()} disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Load Chart'}
        </button>
      </div>

      {statusText ? <p className="view-playground-info">{statusText}</p> : null}
      {errorText ? <p className="view-playground-error">{errorText}</p> : null}

      <div className="tv-test-chart" ref={chartContainerRef} />

      <div className="tv-test-panels">
        <section className="tv-test-panel">
          <h3>Symbol Endpoint</h3>
          <code>{symbolUrl || buildSymbolUrl(viewApiBaseUrl, symbol)}</code>
          <pre>{symbolInfo ?? '// no symbol info yet'}</pre>
        </section>
        <section className="tv-test-panel">
          <h3>History Endpoint</h3>
          <code>{historyUrl || buildHistoryUrl(viewApiBaseUrl, symbol, resolution, Math.floor(Date.now() / 1000) - 3600, Math.floor(Date.now() / 1000))}</code>
          <p className="tv-test-note">History is fetched in dense mode from the indexed Pump candle layer.</p>
        </section>
      </div>
    </section>
  );
}
