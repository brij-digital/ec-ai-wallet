# AppPack — AI Compatible by Design (Web)

This repository is the web app and pack-authoring workspace for AppPack.

It provides:
- a wallet-connected UI to execute declarative protocol operations
- an App Form Builder driven by protocol app specs
- command mode for strict, protocol-agnostic execution
- authoring + CI tooling for protocol packs (IDL + MetaIDL + AppSpec)

## Related Repos

- Runtime package: [brij-digital/apppack-runtime](https://github.com/brij-digital/apppack-runtime)
- View/index service: [brij-digital/apppack-view-service](https://github.com/brij-digital/apppack-view-service)

## Current Scope

Active protocols in this repo:
- `orca-whirlpool-mainnet`
- `pump-amm-mainnet`
- `pump-core-mainnet`
- `kamino-klend-mainnet`

Main UI tabs:
- `Apps`: end-user app flows from app specs
- `Raw Operations`: operation-level execution from MetaIDL
- `Command`: strict command parser (`/meta-run`, `/view-run`, raw IDL)
- `Compute`: developer inspection of declarative compute libraries

## Spec Model

Each protocol pack is split into 3 layers:

1. `IDL` (program truth)
- instruction/account encoding from protocol program
- example: [public/idl/orca_whirlpool.json](public/idl/orca_whirlpool.json)

2. `MetaIDL` (execution logic)
- declarative operation pipeline: `discover -> derive -> compute -> args/accounts`
- examples:
  - [public/idl/orca_whirlpool.meta.core.json](public/idl/orca_whirlpool.meta.core.json)
  - [public/idl/pump_core.meta.core.json](public/idl/pump_core.meta.core.json)

3. `AppSpec` (end-user flow)
- step-based app UX: actions, transitions, statuses, selectable derived lists
- examples:
  - [public/idl/orca_whirlpool.app.json](public/idl/orca_whirlpool.app.json)
  - [public/idl/pump_amm.app.json](public/idl/pump_amm.app.json)

Registry:
- [public/idl/registry.json](public/idl/registry.json)

Schemas:
- [public/idl/meta_idl.schema.v0.6.json](public/idl/meta_idl.schema.v0.6.json)
- [public/idl/meta_idl.core.schema.v0.6.json](public/idl/meta_idl.core.schema.v0.6.json)
- [public/idl/meta_app.schema.v0.1.json](public/idl/meta_app.schema.v0.1.json)

## Runtime + View Architecture

This web app depends on:
- `@agentform/apppack-runtime` (external package): deterministic IDL/MetaIDL execution runtime
- `apppack-view-service` (separate repo/service): read/view execution and indexed data endpoint (`/view-run`)

Important behavior:
- no local view fallback in app command mode
- `/meta-run` requires explicit mode: `--simulate` or `--send`

## Quick Start

Install and run:

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Environment

Optional frontend env vars:

- `VITE_SOLANA_RPC_URL` (wallet RPC endpoint)
- `VITE_VIEW_API_BASE_URL` (view service base URL)

Defaults:
- wallet RPC defaults to Solana public mainnet endpoint
- view API defaults to `https://apppack-view-service.onrender.com`

## Command Mode

Use `/help` in the app for current command help.

Core commands:
- `/meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> --simulate|--send`
- `/view-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON>`
- `/meta-explain <PROTOCOL_ID> <OPERATION_ID>`
- `/idl-list`
- `/idl-template <PROTOCOL_ID> <INSTRUCTION_NAME>`
- `/idl-view <PROTOCOL_ID> <ACCOUNT_TYPE> <ACCOUNT_PUBKEY>`
- `/read-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>`
- `/write-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>`

## Authoring Workflow

AIDL authoring sources (current):
- [aidl/orca_whirlpool.aidl.json](aidl/orca_whirlpool.aidl.json)
- [aidl/pump_amm.aidl.json](aidl/pump_amm.aidl.json)

Shared compute libraries:
- [aidl/orca_whirlpool.compute.json](aidl/orca_whirlpool.compute.json)
- [aidl/pump_amm.compute.json](aidl/pump_amm.compute.json)
- copied outputs in `public/compute/*.compute.json`

Compile and split outputs:

```bash
npm run aidl:compile
```

This does:
- compile `aidl/*.aidl.json` -> `public/idl/*.meta.json`
- split each meta pack -> `*.meta.core.json` and `*.app.json`

Check generated outputs are up to date:

```bash
npm run aidl:check
```

## Pack Quality Gates

Core checks:

```bash
npm run pack:check
npm run pack:lint
npm run pack:complexity:enforce
npm run ci:protocol-packs
```

Optional RPC-backed checks:

```bash
npm run pack:rpc-check
npm run ci:protocol-packs:rpc
```

## Additional Docs

- [PROJECT_STATE.md](PROJECT_STATE.md)
- [MAINTAINER_GUIDE.md](MAINTAINER_GUIDE.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/aidl-authoring.md](docs/aidl-authoring.md)
- [docs/meta-idl-tutorial.md](docs/meta-idl-tutorial.md)
- [docs/pack-builder.md](docs/pack-builder.md)
- [docs/protocol-pack-ci.md](docs/protocol-pack-ci.md)
