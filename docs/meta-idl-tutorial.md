# Meta IDL Tutorial (Espresso Cash MVP)

This document explains how the current Meta IDL pipeline works in this repo, from user command to on-chain transaction.

## 1) Quick Mental Model

- **Base IDL** defines program instruction shapes (args + accounts + binary encoding).
- **Meta IDL** defines how to derive those args/accounts from user intent.
- **Runtime** executes the Meta IDL derivation steps, then uses base IDL to build instruction data.

In this MVP:
- **Protocol**: Orca Whirlpool
- **User commands**: `/quote` and `/swap`
- **Main action**: `swap_exact_in`

---

## 2) Files You Should Know

- Base IDL: `public/idl/orca_whirlpool.json`
- Meta IDL: `public/idl/orca_whirlpool.meta.json`
- Meta schema: `public/idl/meta_idl.schema.v0.2.json`
- Runtime: `src/lib/metaIdlRuntime.ts`
- Compute registry: `src/lib/metaComputeRegistry.ts`
- Orca compute plugin: `src/lib/protocols/orca/compute.ts`
- App command handling: `src/App.tsx`

---

## 3) Vocabulary (Current Base)

### Core objects
- **Intent**: high-level operation (`swap_exact_in`).
- **Action**: protocol-specific implementation of that intent (`actions.swap_exact_in`).
- **Macro**: reusable declarative template (`macros.orca.swap_exact_in.v1`).
- **Resolver**: one primitive data-derivation step in `derive[]`.
- **Compute step**: one deterministic compute/evaluate step in `compute[]`.

### Implemented resolvers
- `wallet_pubkey`
- `lookup`
- `decode_account`
- `ata`
- `pda`

### Implemented compute steps
- `orca_swap_quote`

### Template variables
- `$input.*`: action input values
- `$param.*`: macro params
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
   - applies `use` macro
   - expands macro with `$param.*`
4. Hydrates missing input defaults (e.g., `slippage_bps: 50`).
5. Executes `derive[]` resolvers (data only) in order.
6. Executes `compute[]` steps (quote/evaluate) in order.
7. Produces final:
   - `instructionName`
   - `args`
   - `accounts`
   - optional `postInstructions`

### Step C: Quote vs Swap split
- `/quote` calls `simulateIdlInstruction(...)`
- `/swap` calls `sendIdlInstruction(...)`

Both use the **same derived plan**; only execution mode differs.

---

## 5) What Each Derive Step Does (Orca macro)

From `macros.orca.swap_exact_in.v1.expand.derive`:

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

## 6) What Compute Step Does (Orca macro)

From `macros.orca.swap_exact_in.v1.expand.compute`:

1. `quote` (`orca_swap_quote`)
- Builds candidate swap instruction(s)
- Tries tick-array candidates (from declarative tick strategy)
- Simulates transaction
- Extracts estimated in/out
- Computes `other_amount_threshold` (slippage-protected min out)
- Returns final quote fields (`tickArray0/1/2`, `sqrtPriceLimit`, thresholds, estimates)

---

## 7) Why `orca_swap_quote` Exists

For Whirlpool swap, you still need runtime values that are not directly user inputs:
- `tick_array_0/1/2`
- `sqrt_price_limit`
- `other_amount_threshold`

The compute step derives these deterministically via chain state + simulation.

---

## 8) Macro System (v0.2)

In Meta IDL v0.2:
- `macros.<name>.expand` stores reusable action fragments.
- `actions.<id>.use[]` applies those macros.

Current action:
- `actions.swap_exact_in` only defines input shape + macro call.
- Full derive/compute/args/accounts are in macro `orca.swap_exact_in.v1`.

Benefits:
- Less duplication
- Easier protocol upgrades (new macro versions)
- Cleaner intent layer

---

## 9) Common Questions

### Is this code or declarative?
- Meta IDL itself is declarative JSON.
- Runtime has code, but executes only known resolver/compute primitives.
- Macro is template expansion, not arbitrary script execution.

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
4. Check tick-array candidate search config.
5. Check simulation error logs and custom error codes.
6. Validate final args/accounts preview.

---

## 11) Recommended Next Improvements

1. Add `/meta-plan <action>` for human-readable expanded steps.
2. Add `/meta-expand <action>` for compiled action JSON.
3. Add meta linter (unknown refs, missing required fields, unused derives).
4. Add fixture tests for intent -> derived args/accounts determinism.
