# Meta IDL Tutorial (Espresso Cash MVP)

This document explains how the current Meta IDL pipeline works in this repo, from user command to on-chain transaction.

## 1) Quick Mental Model

- **Base IDL** defines program instruction shapes (args + accounts + binary encoding).
- **Meta IDL** defines how to derive those args/accounts from user intent.
- **Runtime** executes the Meta IDL derivation steps, then uses base IDL to build instruction data.

In this MVP:
- **Protocol**: Orca Whirlpool
- **User commands**: `/quote` and `/swap`
- **Main action**: `swap_exact_in` (compiled to `swap_v2`)

---

## 2) Files You Should Know

- Base IDL: `public/idl/orca_whirlpool.json`
- Meta IDL: `public/idl/orca_whirlpool.meta.json`
- Meta schema: `public/idl/meta_idl.schema.v0.3.json`
- Runtime: `src/lib/metaIdlRuntime.ts`
- Compute registry: `src/lib/metaComputeRegistry.ts`
- App command handling: `src/App.tsx`

---

## 3) Vocabulary (Current Base)

### Core objects
- **Intent**: high-level operation (`swap_exact_in`).
- **Action**: protocol-specific implementation of that intent (`actions.swap_exact_in`).
- **Template**: reusable declarative action template (`templates.orca.swap_exact_in.v1`).
- **Resolver**: one primitive data-derivation step in `derive[]`.
- **Compute step**: one deterministic compute/evaluate step in `compute[]`.

### Implemented resolvers
- `wallet_pubkey`
- `lookup`
- `decode_account`
- `ata`
- `pda`
- `unix_timestamp`

### Implemented compute steps
- `math.add`
- `math.mul`
- `math.floor_div`
- `list.range_map`
- `pda(seed_spec)`

### Template variables
- `$input.*`: action input values
- `$param.*`: template params
- `$protocol.*`: protocol metadata from registry
- `$<derive_step_name>.*`: outputs from previous derive steps

---

## 4) End-to-End Flow (`/quote` or `/swap`)

Example command:

```text
/swap EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v So11111111111111111111111111111111111111112 0.01 50
```

### Step A: Parse user command
`src/App.tsx` parses command and converts UI amount into atomic integer string (`amount_in`).

### Step B: Prepare meta instruction
`prepareMetaInstruction(...)` in `metaIdlRuntime.ts`:
1. Loads protocol metadata from registry.
2. Loads Meta IDL (`orca_whirlpool.meta.json`).
3. Materializes action `swap_exact_in`:
   - applies `use` template
   - expands template with `$param.*`
4. Hydrates missing input defaults (e.g., `slippage_bps: 50`).
5. Executes `derive[]` resolvers (data only) in order.
6. Executes `compute[]` steps in order.
7. Produces final:
   - `instructionName`
   - `args`
   - `accounts`
   - optional `postInstructions`

For current Orca template:
- `instructionName = swap_v2`
- `remaining_accounts_info = null` (no supplemental arrays in this MVP)

### Step C: Quote vs Swap split
- `/quote` calls `simulateIdlInstruction(...)`
- `/swap` calls `sendIdlInstruction(...)`

Both use the **same derived plan**; only execution mode differs.

---

## 5) What Each Derive Step Does (Orca template)

From `templates.orca.swap_exact_in.v1.expand.derive`:

1. `wallet` (`wallet_pubkey`)
- Output: connected wallet pubkey.

2. `selected_pool` (`lookup`)
- Source: `orca_whirlpool_directory` (local JSON DB)
- Filter: `tokenInMint`, `tokenOutMint`
- Output: one pool row containing `whirlpool`, `aToB`, etc.

3. `whirlpool_data` (`decode_account`)
- Reads and decodes Whirlpool account data from chain.
- Needed fields include token mints, vaults, tick spacing/current tick.

4. `token_owner_account_a` + `token_owner_account_b` (`ata`)
- Derives user ATAs for pool token mints.

5. `oracle` (`pda`)
- Derives Orca oracle PDA with seeds.

6. Tick arrays
- In current v0.3 template, tick arrays are derived declaratively in `compute[]`:
  - `ticks_per_array = tick_spacing * 88`
  - `direction_step = ticks_per_array * tickArrayDirection`
  - `current_start_index = floor_div(tick_current_index, ticks_per_array) * ticks_per_array`
  - `tick_array_starts = list.range_map(base=current_start_index, step=direction_step, count=3)`
  - `tick_arrays = pda(seed_spec)` mapped over `tick_array_starts`

## 6) Quote/Swap Threshold Flow (No Kernel)

- Meta derive resolves base accounts/PDAs and compute resolves tick arrays.
- App simulates the candidate swap tx with `other_amount_threshold = 1`.
- App reads simulated output token delta.
- App computes `min_out` from user slippage bps.
- `/quote` displays estimate + min out.
- `/swap` sends tx with computed `other_amount_threshold`.

---

## 7) Why Simulation-First

For Whirlpool swap, you still need runtime values that are not directly user inputs:
- `tick_array_0/1/2`
- `other_amount_threshold`

Execution from IDL does not require protocol quote kernels.
Simulation gives a protocol-agnostic output estimate and lets the app compute slippage threshold before send.

---

## 8) Template System (v0.3)

In Meta IDL v0.3:
- `templates.<name>.expand` stores reusable action fragments.
- `actions.<id>.use[]` applies those templates.

Current action:
- `actions.swap_exact_in` only defines input shape + template call.
- Full derive/compute/args/accounts are in template `orca.swap_exact_in.v1`.

Benefits:
- Less duplication
- Easier protocol upgrades (new template versions)
- Cleaner intent layer

---

## 9) Common Questions

### Is this code or declarative?
- Meta IDL itself is declarative JSON.
- Runtime has code, but executes only known resolver/compute primitives.
- Template expansion is data expansion, not arbitrary script execution.

### Why not derive everything in parallel?
- Some steps are parallelizable.
- Others have hard dependencies (e.g., quote depends on pool + decoded state + ATAs + oracle).
- Current implementation is sequential for determinism/simplicity.

### Why quote and swap share same plan?
- To avoid drift between “what we quote” and “what we execute.”
- Difference is only simulation vs send path.

---

## 10) Practical Debug Checklist

If `/quote` or `/swap` fails:

1. Check command input mint order and amount.
2. Verify pool exists in `orca_whirlpool.directory.db.json`.
3. Verify resolved Whirlpool account decodes correctly.
4. Check compute outputs: `tick_array_starts` and `tick_arrays`.
5. Check simulation/quote errors (slippage constraints, account setup, liquidity conditions).
6. Validate final args/accounts preview.

---

## 11) Concrete Walkthrough (USDC -> SOL)

This is the exact flow for:

```text
/swap EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v So11111111111111111111111111111111111111112 0.01 50
```

### A) Parse and normalize input (`src/App.tsx`)

1. Parse command into:
- `token_in_mint = EPjF...` (USDC)
- `token_out_mint = So11...` (SOL)
- `amount = 0.01`
- `slippage_bps = 50`
2. Convert UI amount to atomic:
- `amount_in = "10000"` (USDC 6 decimals)

### B) Materialize action (`src/lib/metaIdlRuntime.ts`)

1. Load action `swap_exact_in` from `actions`.
2. Expand template `orca.swap_exact_in.v1` from `templates`.
3. Bind template params:
- `$param.token_in_mint = $input.token_in_mint`
- `$param.token_out_mint = $input.token_out_mint`
- `$param.amount_in = $input.amount_in`
- `$param.slippage_bps = $input.slippage_bps`

### C) Derive phase (`derive[]`)

1. `wallet` (`wallet_pubkey`)
- Reads connected wallet pubkey.
2. `selected_pool` (`lookup`)
- Directory filter by `tokenInMint` and `tokenOutMint`.
- Returns row with `whirlpool`, `aToB`, `tickArrayDirection`.
3. `whirlpool_data` (`decode_account`)
- Decodes on-chain Whirlpool account.
- Provides `tick_current_index`, `tick_spacing`, token mints, vaults.
4. `token_owner_account_a/b` (`ata`)
- Derives user token ATAs for mint A and mint B.
5. `oracle` (`pda`)
- Derives oracle PDA from seeds `["oracle", whirlpool]`.

### D) Compute phase (`compute[]`, `src/lib/metaComputeRegistry.ts`)

Using one recent run values:
- `tick_current_index = -24642`
- `tick_spacing = 4`
- `tickArrayDirection = +1` (USDC -> SOL direction)

Steps:
1. `ticks_per_array = math.mul([tick_spacing, 88]) = 352`
2. `direction_step = math.mul([ticks_per_array, tickArrayDirection]) = 352`
3. `current_array_index = math.floor_div(-24642, 352) = -71`
4. `current_start_index = math.mul([-71, 352]) = -24992`
5. `tick_array_starts = list.range_map(base=-24992, step=352, count=3)`
- Result: `[-24992, -24640, -24288]`
6. `tick_arrays = pda(seed_spec)` with seeds:
- `utf8("tick_array")`
- `pubkey(whirlpool)`
- `item_utf8` (each start index rendered as string)

Resulting PDAs:
- `65cUCgkA...` (start `-24992`)
- `8Rs3qKaV...` (start `-24640`)
- `FhCuVGm1...` (start `-24288`)

### E) Build phase (IDL encode)

1. Resolve `args` from templates:
- `amount = "10000"`
- `other_amount_threshold = "1"` (placeholder before simulation policy update)
- `amount_specified_is_input = true`
- `a_to_b = selected_pool.aToB`
2. Resolve `accounts`:
- Pool/vault/oracle from derive
- Tick arrays from compute (`$tick_arrays.0/1/2`)
3. Encode instruction data with base IDL.

### F) Execute path split (`src/App.tsx`)

1. `/quote`:
- Simulate built transaction
- Extract estimated token deltas from simulation
- Compute `min_out` from `slippage_bps`
- Display quote summary
2. `/swap`:
- Reuse same derived+computed plan
- Set final `other_amount_threshold = min_out`
- Send transaction

This is why quote and swap stay aligned: same declarative plan, different final action (simulate vs send).

---

## 12) Recommended Next Improvements

1. Add `/meta-plan <action>` for human-readable expanded steps.
2. Add `/meta-expand <action>` for compiled action JSON.
3. Add meta linter (unknown refs, missing required fields, unused derives).
4. Add fixture tests for intent -> derived args/accounts determinism.
