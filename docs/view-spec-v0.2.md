# View Spec v0.2 Proposal

This document proposes a simpler view model for AppPack.

The goal is to make views explicit about:
- how the entity universe is bootstrapped
- how it is refreshed
- how queries are executed
- which data is hydrated live
- how outputs are decoded, sorted, and selected

The goal is not to describe indexing infrastructure internals.

## Why Change the Current Model?

The current `view` shape mixes several concerns:
- query bootstrap
- event stream hints
- mapping
- entity identity

That makes it harder to reason about:
- which views require indexing
- which views can run directly from RPC
- which fields should be indexed versus hydrated live

For high-cardinality protocols like Pump, indexing everything is wasteful.
For protocols like Orca, hydrating every account at query time is too slow.

The design target is:
- index only entity keys and stable search fields
- hydrate the shortlist live when needed
- keep protocol/business logic in runtime/spec, not in indexing infra

## Core Model

A view is one of two kinds:
- `account`: read one or a few known accounts
- `search`: query an entity universe and return a shortlist

The model is:
- `bootstrap`: how the entity universe is discovered initially
- `refresh`: how it stays up to date
- `query`: how filters, hydration, decode, sort, and select work

Inside `query`, split filters into two layers:
- `indexed_filters`: binary/index-friendly shortlist filters
- `filters`: decoded business filters applied after hydration/decode

Temporal shortlist guidance:
- the cache layer can expose `account.firstSeenSlot` and `account.lastSeenSlot`
- use an optional input like `min_last_seen_slot` when a search view benefits from recency windows
- keep exact binary shortlist filters in `indexed_filters`, and use temporal narrowing in `filters`

Bootstrap hot-set guidance:
- high-cardinality protocols can set `bootstrap.lookback_seconds`
- this tells the sync worker to use `changedSinceSlot` on the initial bootstrap
- example: `lookback_seconds: 600` keeps the initial sync focused on accounts changed in roughly the last 10 minutes instead of scanning the full universe
- very hot protocols can also set `bootstrap.max_pages`
- example: `max_pages: 5` forces the initial hot bootstrap to stop after a few recent pages and switch to incremental sync
- cache-heavy hot views can set `bootstrap.retention_seconds`
- example: `retention_seconds: 3600` prunes cached accounts for that program if they have not been seen for the last hour

Practical split between the two kinds:
- `search` exists to discover entities in a large universe, so it benefits from cache/index infrastructure
- `account` exists to read a known address, so it should stay much simpler
- if the platform later runs its own RPC, `account` views are good candidates for direct RPC reads, while `search` remains cache/index oriented

## Rules

1. The spec describes business intent, not infra implementation.
   Do not encode table names, stream IDs, worker names, retry policy, or batch size.

2. Search views should not require hydrating the full universe at request time.
   Use indexed discovery first, then hydrate a shortlist.

3. Only stable search fields should be relied on for broad indexing.
   Examples: mint addresses, account type, creator, tick spacing.

4. Moving fields should be treated as live or refreshable.
   Examples: liquidity, reserves, prices, balances.

## New Shape

### `account`
Use for:
- `view_pool(pool)`
- `view_reserve(reserve)`
- `view_position(position)`

Why this kind exists:
- once an app or agent already knows the target pubkey, re-running a global search is wasteful
- many dynamic fields such as liquidity or balances are best served by re-reading the exact account, not by rediscovering the universe
- `account` should be thought of as "known-address read", not as "static cached read"

Required fields:
- `kind`
- `source`
- `target`
- `select`

### `search`
Use for:
- `list_pools(tokenA, tokenB)`
- `list_tokens(quoteMint)`
- `search_reserves(mint)`

Required fields:
- `kind`
- `source`
- `entity_type`
- `bootstrap`
- `query`

## Example: Orca `list_pools`

```json
{
  "kind": "search",
  "source": "indexed",
  "entity_type": "whirlpool_pool",
  "title": "List pools",
  "description": "Find Whirlpool pools for a token pair.",
  "bootstrap": {
    "kind": "scan_accounts",
    "source": "rpc.getProgramAccounts",
    "program_id": "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    "account_type": "Whirlpool",
    "filters": []
  },
  "refresh": {
    "mode": "stream",
    "source": "program_account_updates"
  },
  "query": {
    "indexed_filters": {
      "any": [
        {
          "all": [
            { "field": "memcmp.101", "op": "=", "value": "$input.token_in_mint" },
            { "field": "memcmp.181", "op": "=", "value": "$input.token_out_mint" }
          ]
        },
        {
          "all": [
            { "field": "memcmp.101", "op": "=", "value": "$input.token_out_mint" },
            { "field": "memcmp.181", "op": "=", "value": "$input.token_in_mint" }
          ]
        }
      ]
    },
    "filters": {
      "any": [
        {
          "all": [
            { "field": "decoded.token_mint_a", "op": "=", "value": "$input.token_in_mint" },
            { "field": "decoded.token_mint_b", "op": "=", "value": "$input.token_out_mint" }
          ]
        },
        {
          "all": [
            { "field": "decoded.token_mint_a", "op": "=", "value": "$input.token_out_mint" },
            { "field": "decoded.token_mint_b", "op": "=", "value": "$input.token_in_mint" }
          ]
        }
      ]
    },
    "hydrate": {
      "mode": "accounts",
      "candidate_limit": 20,
      "fields": ["pubkey", "data_bytes", "slot"]
    },
    "decode": {
      "account_type": "Whirlpool"
    },
    "sort": [
      {
        "field": "decoded.liquidity",
        "dir": "desc",
        "mode": "indexed_then_live_refine",
        "candidate_limit": 20
      }
    ],
    "limit": 20,
    "select": {
      "whirlpool": "$account.pubkey",
      "tokenMintA": "$decoded.token_mint_a",
      "tokenMintB": "$decoded.token_mint_b",
      "tickSpacing": "$decoded.tick_spacing",
      "liquidity": "$decoded.liquidity"
    }
  }
}
```

## Example: Pump `list_tokens`

```json
{
  "kind": "search",
  "source": "indexed",
  "entity_type": "pump_pool",
  "title": "List tokens",
  "description": "List Pump AMM pools quoted in WSOL.",
  "bootstrap": {
    "kind": "scan_accounts",
    "source": "rpc.getProgramAccounts",
    "program_id": "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
    "account_type": "Pool",
    "lookback_seconds": 600,
    "max_pages": 5,
    "retention_seconds": 3600,
    "filters": []
  },
  "refresh": {
    "mode": "stream",
    "source": "program_account_updates"
  },
  "query": {
    "filters": {
      "all": [
        { "field": "decoded.quote_mint", "op": "=", "value": "$input.quote_mint" },
        { "field": "account.lastSeenSlot", "op": ">=", "value": "$input.min_last_seen_slot" }
      ]
    },
    "hydrate": {
      "mode": "accounts",
      "candidate_limit": 50,
      "fields": ["pubkey", "data_bytes", "slot"]
    },
    "decode": {
      "account_type": "Pool"
    },
    "sort": [
      {
        "field": "account.lastSeenSlot",
        "dir": "desc",
        "mode": "indexed"
      },
      {
        "field": "decoded.index",
        "dir": "desc",
        "mode": "indexed"
      }
    ],
    "limit": 20,
    "select": {
      "pool": "$account.pubkey",
      "baseMint": "$decoded.base_mint",
      "quoteMint": "$decoded.quote_mint",
      "coinCreator": "$decoded.coin_creator"
    }
  }
}
```

## Example: Kamino `view_reserve`

```json
{
  "kind": "account",
  "source": "rpc",
  "entity_type": "kamino_reserve",
  "target": {
    "address": "$input.reserve",
    "account_type": "Reserve"
  },
  "refresh": {
    "mode": "on_demand"
  },
  "select": {
    "reserve": "$input.reserve",
    "liquidityMint": "$decoded.liquidity.mintPubkey",
    "liquidityVault": "$decoded.liquidity.supplyVault",
    "collateralMint": "$decoded.collateral.mintPubkey"
  }
}
```

## Indexed Versus Live Fields

The view spec should not force the platform to index every decoded field.

Practical guidance:
- stable fields should be indexed when they are useful for broad search
- moving fields should be hydrated live or refreshed separately
- if a field has a known binary offset, prefer `indexed_filters` for shortlist creation
- keep semantic correctness checks in `filters`

Examples of stable fields:
- account type
- mint addresses
- creator

## Temporal Filtering

If a search view needs “recently seen” behavior, prefer:
- optional input: `min_last_seen_slot`
- query filter: `account.lastSeenSlot >= $input.min_last_seen_slot`
- primary sort: `account.lastSeenSlot desc`

This keeps recency logic declarative without inventing a separate feed model too early.
- tick spacing

Examples of moving fields:
- liquidity
- reserves
- prices
- balances

## What App Developers Provide

App developers should provide:
- the view kind
- bootstrap intent
- filters
- decode type
- sort/select shape

They should not have to provide:
- their own indexing API
- stream IDs
- SQL schema details
- worker internals

## What the Platform Provides

The platform is responsible for:
- running bootstrap
- maintaining the entity cache
- refreshing entities
- hydrating accounts
- executing decode/filter/sort/select

## Migration from Current v0.6 View

Current shape:
- `bootstrap`
- `stream`
- `mapping`
- `entity_keys`

Proposed shape:
- `kind`
- `source`
- `entity_type`
- `bootstrap`
- `refresh`
- `query` or `target/select`

A rough mapping is:
- `stream` -> `refresh`
- `mapping.select` -> `query.select`
- `mapping.source` -> implied decode/hydrate source
- `entity_keys` -> part of platform index contract, not mandatory view syntax

## Recommendation

Adopt this in two phases.

Phase 1:
- add the new view schema and docs
- start authoring new views in v0.2 style
- keep runtime compatibility layer temporarily

Phase 2:
- migrate Orca, Pump, Kamino views
- remove old `mapping/entity_keys` style once runtime catches up
