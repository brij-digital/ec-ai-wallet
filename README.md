# Espresso Cash AI Wallet MVP (Web)

This repository is a command-driven web demo for an Espresso Cash AI Wallet MVP.

Current scope:
- Single-signature wallet approval (no Swig/passkeys yet)
- One active swap integration via Orca Whirlpools on Solana mainnet
- One base IDL + one Meta IDL (`meta-idl.v0.6`) for declarative operation derivation
- One authoring DSL (`AIDL v0.1`) compiled to canonical Meta IDL JSON
- Chat-style command input with deterministic command parsing

## Commands

Global tooling commands:
- `/help`
- `/idl-list`
- `/idl-template <PROTOCOL_ID> <INSTRUCTION_NAME>`
- `/meta-explain <PROTOCOL_ID> <OPERATION_ID>`
- `/idl-view <PROTOCOL_ID> <ACCOUNT_TYPE> <ACCOUNT_PUBKEY>`
- `/idl-send <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>`
- `/write-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>`
- `/read-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>`

Protocol-native commands:
- Orca: `/swap <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> <SLIPPAGE_BPS>`, `/quote <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> <SLIPPAGE_BPS>`
- Pump AMM: `/pump-amm <TOKEN_MINT> <AMOUNT_SOL> <SLIPPAGE_BPS> [POOL_PUBKEY] [--simulate]`
- Pump curve: `/pump-curve <TOKEN_MINT> <AMOUNT_SOL> <SLIPPAGE_BPS> [--simulate]`

Examples:

```text
/quote SOL USDC 0.1 50
/swap SOL USDC 0.1 50
/pump-amm <TOKEN_MINT> 0.01 100 --simulate
/pump-amm <TOKEN_MINT> 0.01 100
/pump-curve <TOKEN_MINT> 0.01 100 --simulate
/meta-explain orca-whirlpool-mainnet swap_exact_in
/meta-explain pump-amm-mainnet buy
```

Raw examples:

```text
/read-raw orca-whirlpool-mainnet swap | {"amount":"1000","other_amount_threshold":"<MIN_OUT_ATOMIC>","sqrt_price_limit":"0","amount_specified_is_input":true,"a_to_b":true} | {"token_authority":"$WALLET","whirlpool":"<PUBKEY>","token_owner_account_a":"<PUBKEY>","token_vault_a":"<PUBKEY>","token_owner_account_b":"<PUBKEY>","token_vault_b":"<PUBKEY>","tick_array_0":"<PUBKEY>","tick_array_1":"<PUBKEY>","tick_array_2":"<PUBKEY>","oracle":"<PUBKEY>"}
/write-raw orca-whirlpool-mainnet swap | {"amount":"1000","other_amount_threshold":"<MIN_OUT_ATOMIC>","sqrt_price_limit":"0","amount_specified_is_input":true,"a_to_b":true} | {"token_authority":"$WALLET","whirlpool":"<PUBKEY>","token_owner_account_a":"<PUBKEY>","token_vault_a":"<PUBKEY>","token_owner_account_b":"<PUBKEY>","token_vault_b":"<PUBKEY>","tick_array_0":"<PUBKEY>","tick_array_1":"<PUBKEY>","tick_array_2":"<PUBKEY>","oracle":"<PUBKEY>"}
```

Supported token aliases for `/swap` and `/quote`:
- `SOL`
- `USDC`

## IDL + Meta IDL

- Base IDL: `public/idl/orca_whirlpool.json`
- Meta IDL: `public/idl/orca_whirlpool.meta.json`
- Pump AMM IDL: `public/idl/pump_amm.json`
- Pump AMM Meta IDL: `public/idl/pump_amm.meta.json`
- Orca authoring source: `aidl/orca_whirlpool.aidl.json`
- Pump AMM authoring source: `aidl/pump_amm.aidl.json`
- Meta IDL schema: `public/idl/meta_idl.schema.v0.6.json`
- Tutorial: `docs/meta-idl-tutorial.md`
  - Detailed end-to-end walkthrough of current `/quote` and `/swap` flow
- AIDL authoring guide: `docs/aidl-authoring.md`
- Pack builder guide: `docs/pack-builder.md`
- Protocol pack CI guide: `docs/protocol-pack-ci.md`
- Registry: `public/idl/registry.json`
- Discover registry: `src/lib/metaDiscoverRegistry.ts`
- Compute registry (generic primitives only): `src/lib/metaComputeRegistry.ts`

Meta operation used by `/swap` and `/quote`:
- `swap_exact_in`
- compiled instruction: `swap_v2`

Meta IDL v0.6 resolver primitives currently implemented in runtime:
- `wallet_pubkey`
- `decode_account`
- `account_owner`
- `token_account_balance`
- `token_supply`
- `ata`
- `pda`
- `lookup` (generic relation query primitive; not used in current Orca swap template)
- `unix_timestamp`

Meta IDL v0.6 discover primitives currently implemented in runtime:
- `discover.mock` (generic)
- `discover.query_http_json` (generic)
- `discover.compare_values` (generic)
- `discover.query` (generic on-chain RPC discovery)
- `discover.pick_list_item`
- `discover.pick_list_item_by_value`

Meta IDL v0.6 compute primitives currently implemented in runtime:
- `math.add`
- `math.sum`
- `math.mul`
- `math.sub`
- `math.floor_div`
- `list.range_map`
- `list.get`
- `list.filter`
- `list.first`
- `list.min_by`
- `list.max_by`
- `coalesce`
- `pda(seed_spec)`
- `compare.equals`
- `compare.not_equals`
- `compare.gt`
- `compare.gte`
- `compare.lt`
- `compare.lte`
- `logic.if`

Meta IDL v0.6 supports template expansion:
- `templates.<name>.expand` defines reusable declarative blocks.
- `operations.<operation>.use[]` applies templates with parameter mapping via `$param.*`.

Meta inputs use explicit readonly bindings:
- `read_from` is for readonly UI fields (displayed/computed preview values).
- Runtime input precedence is: user input -> default -> required-error.

Meta IDL execution supports optional declarative `post` steps:
- current built-in: `spl_token_close_account`
- used to auto-unwrap WSOL output (close WSOL ATA after swap when output mint is SOL)

If multiple pools are found for a pair, the app prompts the user to choose pool `1/2/3...` before continuing quote/swap execution.

## Run Locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Compile AIDL authoring files to canonical Meta IDL JSON:

```bash
npm run aidl:compile
```

Scaffold a new protocol pack (IDL + AIDL + registry entry):

```bash
npm run pack:init -- --id my-protocol-mainnet --name "My Protocol" --program-id <PROGRAM_ID_BASE58>
```

Run pack diagnostics while authoring:

```bash
npm run pack:doctor -- --protocol my-protocol-mainnet
```

Check that generated Meta IDL files are up to date:

```bash
npm run aidl:check
```

Run protocol-pack CI checks locally (registry/IDL/meta validation + deterministic materialization + fixture parity):

```bash
npm run pack:check
```

Run the same pack checks sequence used in CI:

```bash
npm run ci:protocol-packs
```

Run optional RPC-backed simulation/parity checks:

```bash
npm run pack:rpc-check
```

Or run full protocol-pack CI + RPC checks together:

```bash
npm run ci:protocol-packs:rpc
```

## Deploy to GitHub Pages

This repo now includes automatic deployment via:
- `.github/workflows/deploy-pages.yml`

How to enable:
1. Push to `main`.
2. In GitHub: `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.
4. Wait for the workflow `Deploy Web App to GitHub Pages` to complete.

URL format:
- Project site repo: `https://<org-or-user>.github.io/<repo-name>/`
- User/org site repo (`<org-or-user>.github.io`): `https://<org-or-user>.github.io/`

The workflow auto-sets Vite `base` path to match the repository type.

## Notes

- The app targets `mainnet-beta` by default.
- Swap execution requires a connected Phantom wallet.
- `/swap`, `/quote`, `/pump-amm`, and `/pump-curve` are strict declarative wrappers: discover + derive gather on-chain state, compute fills executable args in Meta IDL, then app runs RPC simulation and send.
- Orca `/swap` and `/quote` use a two-pass flow: pass 1 simulates to derive `estimated_out`; pass 2 feeds `estimated_out` back into Meta IDL so `other_amount_threshold` is computed declaratively.
- Pool discovery uses declarative `discover.query`:
  - if `whirlpool` is provided, runtime fetches that account directly;
  - otherwise runtime scans via `getProgramAccounts` filters.
- Meta execution pipeline is split into phases: `discover` (pool discovery + selection) -> `derive` (on-chain/account gather) -> `compute` (deterministic pure transforms) -> IDL build -> `simulate` or `send`.
- Authoring flow is split too: `AIDL source (human)` -> `compile` -> `Meta IDL JSON (runtime bytecode)`.
- SOL output is auto-unwrapped by default via declarative meta `post` step (`spl_token_close_account`).
