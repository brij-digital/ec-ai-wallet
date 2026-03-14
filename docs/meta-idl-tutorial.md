# Meta IDL Tutorial (Espresso Cash MVP)

This document reflects the current implementation in this repo.

## 1) Mental Model

- **Base IDL** (`orca_whirlpool.json`) defines instruction/account encoding.
- **Meta IDL** (`orca_whirlpool.meta.json`) defines how to turn a high-level operation into concrete args/accounts.
- **AIDL source** (`aidl/*.aidl.json`) is the human-authoring format that compiles to Meta IDL JSON.
- **Runtime** executes Meta phases and then calls the base IDL builder/simulator/sender.

Current protocol/operation:
- Protocol: Orca Whirlpools mainnet
- User commands: `/quote`, `/swap`
- Operation: `swap_exact_in` -> instruction `swap_v2`

## 2) Key Files

- Meta runtime: `src/lib/metaIdlRuntime.ts`
- Discover runtime (generic): `src/lib/metaDiscoverRegistry.ts`
- Compute runtime: `src/lib/metaComputeRegistry.ts`
- App command flow: `src/App.tsx`
- AIDL compiler: `scripts/compile-aidl.mjs`
- Meta spec: `public/idl/orca_whirlpool.meta.json`
- Meta schema: `public/idl/meta_idl.schema.v0.6.json`

## 2.1) View Contract In Meta IDL

Read operations can now include a declarative `view` block with protocol logic only:

- `bootstrap`:
  - initial query steps (usually `discover.query` step names).
- `stream`:
  - event source + filter for incremental updates.
- `mapping`:
  - how raw discovered/derived data maps to output entities.
- `entity_keys`:
  - deterministic identity fields for upsert/dedup.

This keeps runtime policy concerns (freshness SLA, reconcile cadence, finality policy) outside protocol packs.

## 3) Runtime Vocabulary

Operation pipeline phases:
1. `discover[]`
2. `derive[]`
3. `compute[]`
4. Fill optional inputs declared with `discover_from` (if missing)
5. Build IDL instruction
5. Simulate (`/quote`) or send (`/swap`)

Current discover steps used by Orca operation:
- `discover.query`
- `discover.pick_list_item_by_value`

Current derive steps used by Orca operation:
- `wallet_pubkey`
- `decode_account`
- `ata`
- `pda`

Current compute steps used by Orca operation:
- `math.mul`
- `math.sub`
- `math.floor_div`
- `list.range_map`
- `pda(seed_spec)`
- `compare.equals`
- `logic.if`

Meta IDL v0.5 runtime (available primitives):
- `token_account_balance`, `token_supply` resolvers
- `math.sum`, `list.filter`, `list.first`, `list.min_by`, `list.max_by`, `coalesce`
- `compare.not_equals`, `compare.gt`, `compare.gte`, `compare.lt`, `compare.lte`

## 4) What `discover[]` Does Now

In `templates.orca.swap_exact_in.v2.expand.discover`:

1. `pool_candidates` (`discover.query`)
- Runs on-chain discovery via RPC `getProgramAccounts` against Orca program.
- If `input.whirlpool` is present, it fetches that pool account directly instead of scanning.
- Uses declarative OR memcmp filters for `(mintA,mintB)` and `(mintB,mintA)`.
- Auto-adds account discriminator filter from IDL `account_type`.
- Decodes Whirlpool accounts, applies declarative `where/sort/limit/select`.
- Produces candidates with:
  - `whirlpool`, `tokenMintA`, `tokenMintB`, `tickSpacing`, `liquidity`.

2. `selected_pool` (`discover.pick_list_item_by_value`)
- If `input.whirlpool` is provided, picks matching candidate by `whirlpool`.
- Otherwise falls back to first candidate (`fallback_index = 0`).

## 5) App-Level Pool Selection UX

`src/App.tsx` adds a two-pass flow:

1. First run `/quote` or `/swap`.
2. Runtime returns `pool_candidates` and a default `selected_pool` (`index 0`).
3. If candidates count > 1, app pauses and prompts user to choose:
- Click button in the optional list UI, or
- Type `1`, `2`, `3`, ...
4. App reruns the same operation with chosen `whirlpool`.
5. Flow continues to derive/compute/simulate/send.

If only one pool exists, no prompt is shown and execution continues immediately.

## 6) Derive + Compute + Build

After `selected_pool` is fixed:

Derive:
- `wallet`
- `whirlpool_data` from `selected_pool.whirlpool`
- `token_owner_account_a/b` (ATAs)
- `oracle` PDA

Compute tick arrays:
- `a_to_b = compare.equals(selected_pool.tokenMintA, input.token_in_mint)`
- `tick_array_direction = logic.if(a_to_b, -1, 1)`
- `ticks_per_array = tick_spacing * 88`
- `direction_step = ticks_per_array * tick_array_direction`
- `current_array_index = floor_div(tick_current_index, ticks_per_array)`
- `current_start_index = current_array_index * ticks_per_array`
- `tick_array_starts = range_map(current_start_index, direction_step, 3)`
- `tick_arrays = pda(seed_spec)` over `tick_array_starts`

Build args/accounts:
- `amount = input.amount_in`
- `other_amount_threshold = floor(estimated_out * (10000 - slippage_bps) / 10000)`
- `sqrt_price_limit = "0"`
- `a_to_b = a_to_b`
- accounts wired from derive/compute outputs

## 7) Quote vs Swap

Both paths share the same declarative operation and account wiring.

`/quote`:
- Pass 1: simulates with `estimated_out=0` to obtain output estimate from account deltas.
- Pass 2: reruns Meta IDL with `estimated_out` input so `other_amount_threshold` is computed in Meta.
- Simulates final executable args and displays summary.

`/swap`:
- Uses the same two-pass flow as `/quote`.
- Sends transaction with final pass executable args (no app-side arg override).

## 8) Why It Feels Slow

Pool discovery runs on-chain via `getProgramAccounts`. It is trust-minimized and cacheless, but slower than using an index.

## 9) Debug Checklist

If `/quote` or `/swap` fails:

1. Check wallet connected.
2. Verify pair mints are correct.
3. Check `pool_candidates` not empty.
4. If prompted, ensure selected index is in range.
5. Verify `whirlpool_data` decode succeeds.
6. Check computed `tick_array_starts` / `tick_arrays`.
7. Inspect simulation logs and raw instruction preview.

## 10) Next Architecture Step

Current split is:
- Generic runtime in `metaDiscoverRegistry`
- Protocol specifics in Meta IDL data (`discover.query` + derive/compute config)

To scale, keep adding generic discover/compute primitives and keep protocol files data-only.

## 12) Authoring vs Runtime

- Edit human source in `aidl/*.aidl.json`.
- Compile to canonical runtime JSON with:

```bash
npm run aidl:compile
```

- Runtime only consumes generated `public/idl/*.meta.json`.

## 11) Optional Inputs via Discovery

Meta input specs can use:
- `discover_from: "$path.to.value"`

Resolution precedence is:
1. user input
2. input default
3. `discover_from`
4. required error

This keeps one command surface while letting operations fill additional values deterministically from discovered state.
