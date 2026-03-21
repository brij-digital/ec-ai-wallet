export type ViewExample = {
  label: string;
  protocolId: string;
  operationId: string;
  input: string;
  limit: string;
};

export type ScenarioMetricFormat = 'compact' | 'price' | 'percent' | 'pubkey' | 'time' | 'text';
export type ScenarioMetricSource = 'snapshot' | 'stats' | 'resolved';

export type ScenarioMetric = {
  label: string;
  source: ScenarioMetricSource;
  field?: string;
  format: ScenarioMetricFormat;
  digits?: number;
  fallback?: string;
};

export type ViewScenarioDefinition = {
  id: string;
  title: string;
  description: string;
  protocolId: string;
  entity: {
    label: string;
    inputKey: string;
    defaultValue: string;
    placeholder?: string;
  };
  resolve: {
    operationId: string;
    input: (entityValue: string) => Record<string, unknown>;
    resultField: string;
    statusText: string;
  };
  latest?: {
    label: string;
    operationId: string;
    input: Record<string, unknown>;
    resultField: string;
    statusText: string;
  };
  resource: {
    label: string;
    inputKey: string;
    pendingLabel: string;
  };
  views: {
    snapshot: string;
    stats: string;
    series: string;
    feed: string;
  };
  hero: {
    title: ScenarioMetric;
    subtitle: ScenarioMetric[];
    highlights: ScenarioMetric[];
    sideMetrics: ScenarioMetric[];
  };
  statCards: ScenarioMetric[];
  chart: {
    title: string;
    valueFields: string[];
  };
  feed: {
    title: string;
    sideField?: string;
    timeField: string;
    amountField: string;
    priceField: string;
    secondaryValueField?: string;
    secondaryTextField?: string;
  };
};

const DEFAULT_QUOTE_MINT = 'So11111111111111111111111111111111111111112';

export const VIEW_PLAYGROUND_PRESETS: ViewExample[] = [
  {
    label: 'Recent token search',
    protocolId: 'pump-amm-mainnet',
    operationId: 'list_tokens',
    input: JSON.stringify(
      {
        quote_mint: DEFAULT_QUOTE_MINT,
        min_last_seen_slot: '0',
      },
      null,
      2,
    ),
    limit: '10',
  },
  {
    label: 'Resolve pool by mint',
    protocolId: 'pump-amm-mainnet',
    operationId: 'resolve_pool',
    input: JSON.stringify(
      {
        mint: '7kYCrqXPj5Fx53wyTSshDNjoC13Poq7BupVzv3Xybonk',
        quote_mint: DEFAULT_QUOTE_MINT,
      },
      null,
      2,
    ),
    limit: '1',
  },
  {
    label: 'Series for a pool',
    protocolId: 'pump-amm-mainnet',
    operationId: 'market_cap_series',
    input: JSON.stringify(
      {
        pool: '7opE4JxmcgttNQkSvwVQt3G2ELTjQzP3BsWvQ48H4aQ3',
      },
      null,
      2,
    ),
    limit: '60',
  },
  {
    label: 'Orca pool search',
    protocolId: 'orca-whirlpool-mainnet',
    operationId: 'list_pools',
    input: JSON.stringify(
      {
        token_in_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        token_out_mint: DEFAULT_QUOTE_MINT,
      },
      null,
      2,
    ),
    limit: '10',
  },
  {
    label: 'Kamino reserve resolve',
    protocolId: 'kamino-klend-mainnet',
    operationId: 'resolve_reserve',
    input: JSON.stringify(
      {
        mint: DEFAULT_QUOTE_MINT,
      },
      null,
      2,
    ),
    limit: '5',
  },
];

export const DEFAULT_VIEW_SCENARIO: ViewScenarioDefinition = {
  id: 'pump-coin-page',
  title: 'View Scenario',
  description:
    'Generic scenario runner for a multi-view page. This default scenario uses Pump as example data, but the component itself stays protocol-agnostic.',
  protocolId: 'pump-amm-mainnet',
  entity: {
    label: 'Entity Value',
    inputKey: 'mint',
    defaultValue: 'GrekEV3U7Mwqzb7vGD67Mmqcm8yfNHsV3b7XJ2bNmoon',
    placeholder: 'Enter the entity identifier used by the resolve view',
  },
  resolve: {
    operationId: 'resolve_pool',
    input: (mint) => ({
      mint,
      quote_mint: DEFAULT_QUOTE_MINT,
    }),
    resultField: 'pool',
    statusText: 'Resolving resource from entity...',
  },
  latest: {
    label: 'Latest Entity',
    operationId: 'list_tokens',
    input: {
      quote_mint: DEFAULT_QUOTE_MINT,
      min_last_seen_slot: '0',
    },
    resultField: 'baseMint',
    statusText: 'Finding a recent entity...',
  },
  resource: {
    label: 'Resource',
    inputKey: 'pool',
    pendingLabel: 'Resource pending',
  },
  views: {
    snapshot: 'pool_snapshot',
    stats: 'stat_cards',
    series: 'market_cap_series',
    feed: 'trade_feed',
  },
  hero: {
    title: {
      label: 'Primary Value',
      source: 'snapshot',
      field: 'marketCapQuote',
      format: 'compact',
      digits: 1,
    },
    subtitle: [
      { label: 'Base Mint', source: 'snapshot', field: 'baseMint', format: 'pubkey' },
      { label: 'Quote Mint', source: 'snapshot', field: 'quoteMint', format: 'pubkey' },
    ],
    highlights: [
      { label: 'Price', source: 'snapshot', field: 'priceQuote', format: 'price' },
      { label: '24h', source: 'stats', field: 'priceChange24hPct', format: 'percent' },
      { label: 'Vol', source: 'stats', field: 'volume24hQuote', format: 'compact', digits: 1 },
    ],
    sideMetrics: [
      { label: 'Liquidity', source: 'snapshot', field: 'liquidityQuote', format: 'compact', digits: 1 },
      { label: 'Creator', source: 'snapshot', field: 'coinCreator', format: 'pubkey' },
      { label: 'Observed', source: 'snapshot', field: 'observedAt', format: 'time' },
    ],
  },
  statCards: [
    { label: 'Price', source: 'stats', field: 'priceQuote', format: 'price' },
    { label: '5m', source: 'stats', field: 'priceChange5mPct', format: 'percent' },
    { label: '1h', source: 'stats', field: 'priceChange1hPct', format: 'percent' },
    { label: '6h', source: 'stats', field: 'priceChange6hPct', format: 'percent' },
    { label: '24h Volume', source: 'stats', field: 'volume24hQuote', format: 'compact', digits: 1 },
  ],
  chart: {
    title: 'Series',
    valueFields: ['closeMarketCap', 'close'],
  },
  feed: {
    title: 'Feed',
    sideField: 'side',
    timeField: 'eventTime',
    amountField: 'quoteAmountUi',
    priceField: 'priceQuote',
    secondaryValueField: 'marketCapQuote',
    secondaryTextField: 'user',
  },
};
