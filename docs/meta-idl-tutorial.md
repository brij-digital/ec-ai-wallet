# Meta IDL Tutorial (Espresso Cash MVP)

This document reflects the current implementation in this repo.

## 1) Mental Model

- **Base IDL** (`orca_whirlpool.json`) defines instruction/account encoding.
- **Meta IDL** (`orca_whirlpool.meta.json`) defines how to turn a high-level operation into concrete args/accounts.
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
- Meta spec: `public/idl/orca_whirlpool.meta.json`
- Meta schema: `public/idl/meta_idl.schema.v0.3.json`

## 3) Runtime Vocabulary

Operation pipeline phases:
1. `discover[]`
2. `derive[]`
3. `compute[]`
4. Build IDL instruction
5. Simulate (`/quote`) or send (`/swap`)

Current discover steps used by Orca operation:
- `discover.query`
- `discover.pick_list_item`

Current derive steps used by Orca operation:
- `wallet_pubkey`
- `decode_account`
- `ata`
- `pda`

Current compute steps used by Orca operation:
- `math.mul`
- `math.floor_div`
- `list.range_map`
- `pda(seed_spec)`
- `compare.equals`
- `logic.if`

## 4) What `discover[]` Does Now

In `templates.orca.swap_exact_in.v1.expand.discover`:

1. `pool_candidates` (`discover.query`)
- Runs on-chain discovery via RPC `getProgramAccounts` against Orca program.
- Uses declarative OR memcmp filters for `(mintA,mintB)` and `(mintB,mintA)`.
- Auto-adds account discriminator filter from IDL `account_type`.
- Decodes Whirlpool accounts, applies declarative `where/sort/limit/select`.
- Produces candidates with:
  - `whirlpool`, `tokenMintA`, `tokenMintB`, `tickSpacing`, `liquidity`.

2. `selected_pool` (`discover.pick_list_item`)
- Picks `pool_candidates[input.pool_index]`.
- `pool_index` default is `0`.

## 5) App-Level Pool Selection UX

`src/App.tsx` adds a two-pass flow:

1. First run `/quote` or `/swap` without explicit `pool_index`.
2. Runtime returns `pool_candidates` and a default `selected_pool` (`index 0`).
3. If candidates count > 1, app pauses and prompts user to choose:
- Click button in the optional list UI, or
- Type `1`, `2`, `3`, ...
4. App reruns the same operation with chosen `pool_index`.
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
- `other_amount_threshold = "1"` provisional
- `sqrt_price_limit = "0"`
- `a_to_b = a_to_b`
- accounts wired from derive/compute outputs

## 7) Quote vs Swap

Both paths share the same prepared plan.

`/quote`:
- Simulates with provisional threshold.
- Computes estimated output and min output from slippage bps.
- Displays summary.

`/swap`:
- Reuses same plan.
- Replaces `other_amount_threshold` with computed min output.
- Sends transaction.

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
