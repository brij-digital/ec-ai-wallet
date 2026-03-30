# Protocol Pack CI (Current)

This repo enforces protocol-pack quality with deterministic checks.

## CI Command Set

```bash
npm run aidl:check
npm run pack:check
npm run pack:lint
npm run pack:complexity:enforce
npm run ci:protocol-packs
```

Optional RPC suite:

```bash
npm run pack:rpc-check
npm run ci:protocol-packs:rpc
```

`ci:protocol-packs` runs:
1. `aidl:check`
2. `pack:check`
3. `pack:lint`
4. `pack:complexity:enforce`

## What Each Gate Covers

### `aidl:check`
- verifies compiled AIDL outputs are up to date
- verifies generated app outputs (`*.app.json`) are up to date

### `pack:check`
- registry integrity (`public/idl/registry.json`)
- Codama/runtime/app file existence and basic consistency
- deterministic operation materialization
- operation-level integrity (instruction existence, step name uniqueness)
- fixture checks in `protocol-packs/fixtures`
- RPC fixture coverage gate for active protocols

### `pack:lint`
- strict app-spec linting (`meta-app.v0.1`)
- action shape validation (`do.fn` / `do.mode`)
- status text presence (`running`, `success`, `error`)
- transition policy (`next_on_success` only)
- rejects deprecated fields (`transitions`, `blocking`)

### `pack:complexity:enforce`
- computes protocol complexity budget report
- fails when protocol exceeds configured limits

### `pack:rpc-check` (optional)
- simulation replay fixtures (`protocol-packs/rpc/simulations`)
- known tx parity fixtures (`protocol-packs/rpc/parity`)

## RPC Env Resolution

RPC URL resolution order:
1. `PACK_RPC_URL`
2. `SOLANA_RPC_URL`
3. `HELIUS_RPC_URL`

If no RPC URL is set, RPC checks are skipped.

## Fixture Locations

- deterministic fixture checks: `protocol-packs/fixtures/*.json`
- RPC simulation fixtures: `protocol-packs/rpc/simulations/*.json`
- RPC parity fixtures: `protocol-packs/rpc/parity/*.json`

## Typical Local CI Flow

```bash
npm run aidl:compile
npm run ci:protocol-packs
npm run pack:rpc-check
```

## Practical Policy

- Keep protocol logic in packs, not UI.
- Keep runtime behavior explicit (no hidden fallbacks in pack definitions).
- Commit source and generated artifacts in the same PR.
