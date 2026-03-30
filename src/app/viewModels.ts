export type ViewExample = {
  label: string;
  viewKind: 'contract' | 'index';
  protocolId: string;
  operationId: string;
  input: string;
  limit: string;
};

export type ScenarioMetricFormat = 'compact' | 'currencyCompact' | 'price' | 'decimal' | 'percent' | 'pubkey' | 'time' | 'text';
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
    stats?: string;
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
    valueLabel?: string;
  };
  feed: {
    title: string;
    accountLabel?: string;
    typeLabel?: string;
    referenceLabel?: string;
    sideField?: string;
    accountField?: string;
    txField?: string;
    timeField: string;
    amountField: string;
    tokenAmountField?: string;
    priceField: string;
    amountLabel?: string;
    amountUnitLabel?: string;
    tokenAmountLabel?: string;
    tokenAmountUnitLabel?: string;
    priceLabel?: string;
    secondaryValueField?: string;
    secondaryValueLabel?: string;
    secondaryTextField?: string;
    secondaryTextLabel?: string;
  };
};

const DEFAULT_QUOTE_MINT = 'So11111111111111111111111111111111111111112';

export const VIEW_PLAYGROUND_PRESETS: ViewExample[] = [
  {
    label: 'Recent token search',
    viewKind: 'contract',
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
    viewKind: 'index',
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
    viewKind: 'index',
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
    label: 'Ranked active Pump tokens',
    viewKind: 'index',
    protocolId: 'pump-amm-mainnet',
    operationId: 'ranked_active_tokens',
    input: JSON.stringify(
      {
        quote_mint: DEFAULT_QUOTE_MINT,
        window_hours: 24,
        max_activity_age_minutes: 30,
        min_liquidity: 0,
        min_volume: 0,
      },
      null,
      2,
    ),
    limit: '20',
  },
  {
    label: 'Orca pool search',
    viewKind: 'contract',
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
];

export const PUMP_VIEW_SCENARIO: ViewScenarioDefinition = {
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
    series: 'market_cap_series',
    feed: 'trade_feed',
  },
  hero: {
    title: {
      label: 'Market Cap (SOL)',
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
      { label: 'Price (SOL)', source: 'snapshot', field: 'priceQuote', format: 'decimal', digits: 12 },
      { label: 'Liquidity (SOL)', source: 'snapshot', field: 'liquidityQuote', format: 'compact', digits: 2 },
      { label: 'Observed', source: 'snapshot', field: 'observedAt', format: 'time' },
    ],
    sideMetrics: [
      { label: 'Market', source: 'snapshot', field: 'marketType', format: 'text' },
      { label: 'Liquidity (SOL)', source: 'snapshot', field: 'liquidityQuote', format: 'compact', digits: 2 },
      { label: 'Creator', source: 'snapshot', field: 'coinCreator', format: 'pubkey' },
      { label: 'Observed', source: 'snapshot', field: 'observedAt', format: 'time' },
    ],
  },
  statCards: [],
  chart: {
    title: 'Trading Chart',
    valueFields: ['closeMarketCap', 'close'],
    valueLabel: '1m OHLC + volume',
  },
  feed: {
    title: 'Recent Trades',
    accountLabel: 'Account',
    typeLabel: 'Type',
    referenceLabel: 'Txn',
    accountField: 'user',
    txField: 'signature',
    sideField: 'side',
    timeField: 'eventTime',
    amountField: 'quoteAmountUi',
    tokenAmountField: 'baseAmountUi',
    priceField: 'priceQuote',
    amountLabel: 'Amount (SOL)',
    amountUnitLabel: 'SOL',
    tokenAmountLabel: 'Amount (Token)',
    tokenAmountUnitLabel: 'Token',
    priceLabel: 'Price (SOL)',
    secondaryValueField: 'marketCapQuote',
    secondaryValueLabel: 'Market Cap (SOL)',
    secondaryTextField: 'user',
    secondaryTextLabel: 'User',
  },
};

export const ORCA_VIEW_SCENARIO: ViewScenarioDefinition = {
  id: 'orca-pool-page',
  title: 'Orca Pool Page',
  description: 'SQL-backed Orca Whirlpool scenario with pool snapshot, price chart, and recent swap history.',
  protocolId: 'orca-whirlpool-mainnet',
  entity: {
    label: 'Whirlpool',
    inputKey: 'pool',
    defaultValue: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE',
    placeholder: 'Enter an Orca Whirlpool address',
  },
  resolve: {
    operationId: 'resolve_pool',
    input: (pool) => ({ pool }),
    resultField: 'pool',
    statusText: 'Resolving Whirlpool pool...',
  },
  resource: {
    label: 'Whirlpool',
    inputKey: 'pool',
    pendingLabel: 'Whirlpool pending',
  },
  views: {
    snapshot: 'pool_snapshot',
    stats: 'stat_cards',
    series: 'market_cap_series',
    feed: 'trade_feed',
  },
  hero: {
    title: {
      label: 'Price B per A',
      source: 'snapshot',
      field: 'priceQuote',
      format: 'decimal',
      digits: 9,
    },
    subtitle: [
      { label: 'Token A', source: 'snapshot', field: 'tokenMintA', format: 'pubkey' },
      { label: 'Token B', source: 'snapshot', field: 'tokenMintB', format: 'pubkey' },
    ],
    highlights: [
      { label: 'Inverse Price', source: 'snapshot', field: 'inversePriceQuote', format: 'decimal', digits: 9 },
      { label: '24h', source: 'stats', field: 'priceChange24hPct', format: 'percent' },
      { label: '24h Vol (Token B)', source: 'stats', field: 'volume24hQuote', format: 'compact', digits: 2 },
    ],
    sideMetrics: [
      { label: 'Tick Spacing', source: 'snapshot', field: 'tickSpacing', format: 'text' },
      { label: 'Fee (bps)', source: 'snapshot', field: 'feeRateBps', format: 'decimal', digits: 2 },
      { label: 'Liquidity (Token B)', source: 'snapshot', field: 'liquidityQuote', format: 'compact', digits: 2 },
      { label: 'Observed', source: 'snapshot', field: 'observedAt', format: 'time' },
    ],
  },
  statCards: [
    { label: 'Price B per A', source: 'stats', field: 'priceQuote', format: 'decimal', digits: 9 },
    { label: 'Price A per B', source: 'stats', field: 'inversePriceQuote', format: 'decimal', digits: 9 },
    { label: '5m', source: 'stats', field: 'priceChange5mPct', format: 'percent' },
    { label: '1h', source: 'stats', field: 'priceChange1hPct', format: 'percent' },
    { label: '24h Vol (Token B)', source: 'stats', field: 'volume24hQuote', format: 'compact', digits: 2 },
  ],
  chart: {
    title: 'Pool Price Chart',
    valueFields: ['close'],
    valueLabel: '1m price + volume',
  },
  feed: {
    title: 'Recent Swaps',
    accountLabel: 'Trader',
    typeLabel: 'Side',
    referenceLabel: 'Txn',
    accountField: 'trader',
    txField: 'signature',
    sideField: 'side',
    timeField: 'eventTime',
    amountField: 'quoteNotionalUi',
    tokenAmountField: 'amountOutUi',
    priceField: 'priceQuote',
    amountLabel: 'Notional (Token B)',
    amountUnitLabel: 'Token B',
    tokenAmountLabel: 'Output',
    tokenAmountUnitLabel: 'Token',
    priceLabel: 'Price B/A',
    secondaryTextField: 'tokenInMint',
    secondaryTextLabel: 'Token In',
  },
};

export const VIEW_SCENARIOS: ViewScenarioDefinition[] = [PUMP_VIEW_SCENARIO, ORCA_VIEW_SCENARIO];

export const DEFAULT_VIEW_SCENARIO: ViewScenarioDefinition = PUMP_VIEW_SCENARIO;
