# View Spec v0.3

`v0.3` keeps the `account` and `search` model from `v0.2`, then adds two new data primitives:
- `series`
- `feed`

The goal is to support product surfaces like a Pump-style token page without forcing one giant “screen view”.

## Mental Model

Use the four kinds like this:
- `search`: discover an entity in a large universe
- `account`: read a known account or pool
- `series`: time-bucketed or materialized history
- `feed`: ordered event stream or materialized event list

This keeps views focused on executable data contracts.
Composition of several views into a page stays outside the spec.

## New Cross-Cutting Fields

### `source_kind`
`source_kind` tells the caller what substrate the data is coming from.

Common values:
- `direct_rpc`
- `account_scan`
- `account_changes`
- `materialized_series`
- `materialized_feed`
- later: `tx_stream`

### `freshness`
`freshness` tells the buyer or UI what latency/staleness class to expect.

Example:

```json
{
  "freshness": {
    "class": "near_realtime",
    "target_ms": 5000,
    "max_staleness_ms": 30000
  }
}
```

## Why `series` and `feed` Exist

`account` and `search` are great for current-state reads.
They are not enough to describe:
- candles
- trade timelines
- 24h rolling stats
- buy/sell markers

For those, we need first-class time-oriented views.

## Pump v0.3 Example Set

### `pump.resolve_pool`
- `kind: "search"`
- `source_kind: "account_changes"`
- role: find the Pump pool for a mint

### `pump.pool_snapshot`
- `kind: "account"`
- `source_kind: "account_changes"`
- role: current pool state

### `pump.trade_feed`
- `kind: "feed"`
- `source_kind: "materialized_feed"`
- role: recent trades ordered by event time

### `pump.market_cap_series`
- `kind: "series"`
- `source_kind: "materialized_series"`
- role: chart data

### `pump.stat_cards`
- `kind: "series"` or hybrid current-state+series implementation
- `source_kind: "materialized_series"`
- role: 5m / 1h / 6h / 24h changes and 24h volume

## Recommended Freshness For The Pump POC

### `search`
```json
{
  "class": "near_realtime",
  "target_ms": 5000,
  "max_staleness_ms": 20000
}
```

### `account`
```json
{
  "class": "near_realtime",
  "target_ms": 2000,
  "max_staleness_ms": 10000
}
```

### `feed`
```json
{
  "class": "near_realtime",
  "target_ms": 1000,
  "max_staleness_ms": 5000
}
```

### `series`
```json
{
  "class": "near_realtime",
  "target_ms": 5000,
  "max_staleness_ms": 30000
}
```

## POC Infra Expectation

For the Pump POC we do **not** need a fully self-hosted RPC.
A practical local stack is:
- Helius RPC for current-state sync
- Helius signatures / transaction fetch for event ingest
- local Postgres for materialized trades and candles
- local UI that consumes the resulting views

That gives us:
- believable current-state reads
- believable recent trade feed
- believable 1 minute series

It does **not** promise exchange-grade realtime.
The next step after this POC would be a true stream/indexing layer for finer granularity.
