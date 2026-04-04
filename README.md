# AppPack — AI Compatible by Design (Web)

This repository is the web app and pack-authoring workspace for AppPack.

It provides:
- a wallet-connected UI to execute declarative protocol operations
- authoring + CI tooling for protocol packs (`Codama + indexing + runtime`)

## Related Repos

- Runtime package: [brij-digital/apppack-runtime](https://github.com/brij-digital/apppack-runtime)
- View/index service: [brij-digital/apppack-view-service](https://github.com/brij-digital/apppack-view-service)

## Repo Relationship

This is one of the three main AppPack repositories:
- `apppack-runtime`: shared runtime package published to GitHub Packages
- `ec-ai-wallet`: this web app, which consumes the published runtime package
- `apppack-view-service`: backend read/index service, which also consumes the published runtime package

Package installs in this repo are expected to resolve the runtime from GitHub Packages under the `@brij-digital` scope.

## Package Naming

Use `@brij-digital/apppack-runtime` directly in both `package.json` and source imports.
Do not reintroduce the legacy `@agentform/apppack-runtime` alias.

## Current Scope

Active protocols in this repo:
- `orca-whirlpool-mainnet`
- `pump-amm-mainnet`
- `pump-core-mainnet`

Main UI tabs:
- `Pump`: pump-specific reference workspace
- `Views`: backend read/view playground
- `Raw Operations`: operation-level execution from runtime specs
- `Compute`: developer inspection of runtime compute
- `TradingView`: chart/debug surface

Currently disabled in the default UI shell:
- `Command`
- `Explorer`

## Spec Model

Each active protocol pack is now split into 3 layers:

1. `Codama IDL`
- canonical source of truth for instruction structure
- instruction accounts
- signers
- fixed/default/PDA-backed accounts
- examples:
  - [public/idl/orca_whirlpool.codama.json](public/idl/orca_whirlpool.codama.json)
  - [public/idl/pump_amm.codama.json](public/idl/pump_amm.codama.json)

2. `Indexing Spec`
- ingest specs: `*.ingest.json`
- indexed reads specs: `*.indexed-reads.json`
- discovery
- feeds
- ranking
- series
- examples:
  - [public/idl/orca_whirlpool.ingest.json](public/idl/orca_whirlpool.ingest.json)
  - [public/idl/orca_whirlpool.indexed-reads.json](public/idl/orca_whirlpool.indexed-reads.json)
  - [public/idl/pump_amm.ingest.json](public/idl/pump_amm.ingest.json)
  - [public/idl/pump_amm.indexed-reads.json](public/idl/pump_amm.indexed-reads.json)

3. `Runtime Spec`
- deterministic compute
- deterministic write preparation
- small transaction-envelope logic around writes
- examples:
  - [public/idl/orca_whirlpool.runtime.json](public/idl/orca_whirlpool.runtime.json)
  - [public/idl/pump_core.runtime.json](public/idl/pump_core.runtime.json)

Registry:
- [public/idl/registry.json](public/idl/registry.json)

Schemas:
- [public/idl/declarative_decoder_runtime.schema.v1.json](public/idl/declarative_decoder_runtime.schema.v1.json)
- [public/idl/solana_agent_runtime.schema.v1.json](public/idl/solana_agent_runtime.schema.v1.json)

## Runtime + View Architecture

This web app depends on:
- `@brij-digital/apppack-runtime` (external package): deterministic protocol/runtime execution runtime
- `apppack-view-service` (separate repo/service): read/view execution and indexed data endpoint (`/view-run`)

Important behavior:
- no local view fallback in app command mode
- `/meta-run` requires explicit mode: `--simulate` or `--send`
- indexed reads are owned by the view service and the indexing spec
- runtime compute/write execution is owned by `@brij-digital/apppack-runtime`

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
- wallet RPC defaults to `https://api.brijmail.com/rpc`
- view API defaults to `https://api.brijmail.com`

For local iteration against a local view/indexer loop:

```bash
cp local.env.example .env.local
npm run dev
```

The app now includes a `Views` tab that can:
- ping `/health`
- run a view directly against the configured view API
- show both a structured preview and the raw JSON response

It also includes a `Scenarios` tab that can run a multi-view page recipe.
The default recipe currently uses Pump data, but the component is scenario-driven rather than protocol-specific.

See [docs/local-view-dev.md](docs/local-view-dev.md) for the full local loop, including PostgreSQL and the local view-service worker.

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
- compile `aidl/*.aidl.json` -> `public/idl/*.app.json`
- keep runtime logic in `public/idl/*.runtime.json`
- sync shared schemas before writing outputs

Check generated outputs are up to date:

```bash
npm run aidl:check
```

Codama source-of-truth validation:

```bash
npm run codama:check
```

Optional bootstrap helper when introducing a new protocol from an existing codec IDL:

```bash
npm run codama:bootstrap-from-codec
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
- [docs/runtime-spec.md](https://github.com/brij-digital/apppack-runtime/blob/main/docs/runtime-spec.md)
- [docs/aidl-authoring.md](docs/aidl-authoring.md)
- [docs/pack-builder.md](docs/pack-builder.md)
- [docs/protocol-pack-ci.md](docs/protocol-pack-ci.md)
- [docs/view-spec-v0.2.md](docs/view-spec-v0.2.md)
- [docs/view-spec-v0.3.md](docs/view-spec-v0.3.md)

## Product Direction

AppPack should be treated primarily as an agent-native execution platform.
In that model:
- `apppack-runtime` is the shared execution engine
- `apppack-view-service` is the indexed search/read backend
- `ec-ai-wallet` is the reference client and protocol-pack authoring environment
