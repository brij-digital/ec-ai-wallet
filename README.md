# Espresso Cash AI Wallet MVP (Web)

This repository is a command-driven web demo for an Espresso Cash AI Wallet MVP.

Current scope:
- Single-signature wallet approval (no Swig/passkeys yet)
- One active swap integration via Orca Whirlpools on Solana mainnet
- One base IDL + one Meta IDL (`meta-idl.v0.2`) for declarative action derivation
- Chat-style command input with deterministic command parsing

## Commands

- `/help`
- `/swap <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]`
- `/quote <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]`
- `/write-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>`
- `/read-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>`
- `/idl-list`
- `/idl-template <PROTOCOL_ID> <INSTRUCTION_NAME>`
- `/idl-view <PROTOCOL_ID> <ACCOUNT_TYPE> <ACCOUNT_PUBKEY>`

Examples:

```text
/quote SOL USDC 0.1 50
/swap SOL USDC 0.1 50
```

Raw examples:

```text
/read-raw orca-whirlpool-mainnet swap | {"amount":"1000","other_amount_threshold":"1","sqrt_price_limit":"0","amount_specified_is_input":true,"a_to_b":true} | {"token_authority":"$WALLET","whirlpool":"<PUBKEY>","token_owner_account_a":"<PUBKEY>","token_vault_a":"<PUBKEY>","token_owner_account_b":"<PUBKEY>","token_vault_b":"<PUBKEY>","tick_array_0":"<PUBKEY>","tick_array_1":"<PUBKEY>","tick_array_2":"<PUBKEY>","oracle":"<PUBKEY>"}
/write-raw orca-whirlpool-mainnet swap | {"amount":"1000","other_amount_threshold":"1","sqrt_price_limit":"0","amount_specified_is_input":true,"a_to_b":true} | {"token_authority":"$WALLET","whirlpool":"<PUBKEY>","token_owner_account_a":"<PUBKEY>","token_vault_a":"<PUBKEY>","token_owner_account_b":"<PUBKEY>","token_vault_b":"<PUBKEY>","tick_array_0":"<PUBKEY>","tick_array_1":"<PUBKEY>","tick_array_2":"<PUBKEY>","oracle":"<PUBKEY>"}
```

Supported token aliases for `/swap` and `/quote`:
- `SOL`
- `USDC`

## IDL + Meta IDL

- Base IDL: `public/idl/orca_whirlpool.json`
- Meta IDL: `public/idl/orca_whirlpool.meta.json`
- Meta IDL schema: `public/idl/meta_idl.schema.v0.2.json`
- Tutorial: `docs/meta-idl-tutorial.md`
- Local pool directory DB: `public/idl/orca_whirlpool.directory.db.json`
- Registry: `public/idl/registry.json`

Directory DB rows are directional for fast lookup:
- `tokenInMint`
- `tokenOutMint`
- `aToB`
- `whirlpool`

Meta action used by `/swap` and `/quote`:
- `swap_exact_in`

Meta IDL v0.2 resolver primitives currently implemented in runtime:
- `wallet_pubkey`
- `decode_account`
- `ata`
- `pda`
- `orca_swap_quote`
- `lookup` (query indexed relation from local/remote JSON directory)

`orca_swap_quote` supports declarative tick-array strategy:

```json
{
  "name": "quote",
  "resolver": "orca_swap_quote",
  "tick_arrays": {
    "search_start_offsets": [0, -1, 1, -2, 2, -3, 3],
    "window_size": 3,
    "allow_reuse_last": true
  }
}
```

Meta IDL v0.2 also supports macro expansion:
- `macros.<name>.expand` defines reusable declarative blocks.
- `actions.<action>.use[]` applies macros with parameter mapping via `$param.*`.

Meta IDL execution supports optional declarative `post` steps:
- current built-in: `spl_token_close_account`
- used to auto-unwrap WSOL output (close WSOL ATA after swap when output mint is SOL)

Example pattern for DB-backed fast discovery:

```json
{
  "name": "selected_pool",
  "resolver": "lookup",
  "source": "orca_whirlpool_directory",
  "where": {
    "tokenInMint": "$input.token_in_mint",
    "tokenOutMint": "$input.token_out_mint"
  },
  "mode": "first"
}
```

## Run Locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Notes

- The app targets `mainnet-beta` by default.
- Swap execution requires a connected Phantom wallet.
- `/swap` and `/quote` are strict declarative wrappers: they resolve accounts/PDAs/tick arrays from meta IDL, derive quotes with RPC simulation, then call `write-raw/read-raw` under the hood.
- SOL output is auto-unwrapped by default via declarative meta `post` step (`spl_token_close_account`).
