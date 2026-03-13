# Protocol Pack CI

This repo now includes a protocol-pack CI harness focused on data-driven safety for `IDL + Meta IDL` packs.

## Commands

```bash
npm run pack:check
npm run ci:protocol-packs
npm run pack:rpc-check
npm run ci:protocol-packs:rpc
```

`ci:protocol-packs` runs:
1. `aidl:check` (generated Meta IDL up to date)
2. `pack:check` (pack validation)

`pack:rpc-check` runs optional RPC-backed checks:
- replay simulation fixtures (`protocol-packs/rpc/simulations`)
- known transaction parity fixtures (`protocol-packs/rpc/parity`)

RPC env var resolution order:
1. `PACK_RPC_URL`
2. `SOLANA_RPC_URL`
3. `HELIUS_RPC_URL`

## What `pack:check` validates

1. Registry integrity (`public/idl/registry.json`)
- required manifest fields
- unique protocol IDs
- valid public keys
- referenced `idlPath/metaPath` files exist

2. IDL / Meta consistency
- supported `meta.schema`
- `meta.protocolId` matches manifest ID
- declared `$schema` file exists
- if IDL has `address`, it matches registry `programId`

3. Deterministic operation materialization
- each operation is expanded (`templates + use + direct fields`)
- expansion run twice must produce identical output

4. Operation-level integrity
- materialized instruction exists in IDL (when instruction is present)
- discover / derive / compute step names are unique per phase

5. Fixture parity checks
- fixtures in `protocol-packs/fixtures/*.json`
- assert expected instruction and required args/accounts/steps

6. RPC simulation/parity checks (optional)
- replay and simulate historical transactions via RPC `simulateTransaction`
- verify known historical tx parity via RPC `getTransaction`
- these checks are skipped when no RPC URL env is set

## Fixture format

```json
{
  "name": "Human readable check name",
  "protocolId": "orca-whirlpool-mainnet",
  "operationId": "swap_exact_in",
  "expect": {
    "instruction": "swap_v2",
    "requiredArgs": ["amount"],
    "requiredAccounts": ["whirlpool"],
    "requiredDiscoverSteps": ["pool_candidates"],
    "requiredDeriveSteps": ["wallet"],
    "requiredComputeSteps": ["other_amount_threshold"]
  }
}
```

All fields under `expect` are optional; only declared checks are enforced.

## RPC fixture formats

Simulation fixture (`protocol-packs/rpc/simulations/*.json`):

```json
{
  "name": "Replay Orca tx",
  "source": "replay_tx",
  "signature": "<TX_SIGNATURE>",
  "expect": {
    "allowError": true,
    "ok": true,
    "logsInclude": ["whirL..."],
    "errorIncludes": ["Custom"]
  }
}
```

Parity fixture (`protocol-packs/rpc/parity/*.json`):

```json
{
  "name": "Orca tx parity",
  "signature": "<TX_SIGNATURE>",
  "expect": {
    "programIdsContains": ["whirL..."],
    "logsInclude": ["Instruction: Swap"]
  }
}
```
