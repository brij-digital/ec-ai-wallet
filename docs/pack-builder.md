# Protocol Pack Builder (Current)

This doc covers the practical workflow to add or evolve protocol packs in this repo.

## Pack Layout

A protocol pack is represented by files under `public/idl`:
- `<slug>.codama.json` (protocol source of truth)
- `<slug>.runtime.json` (runtime/indexing/read contract)
- `runtime-codec-plan.json` (generated execution artifact)

Registry entry:
- `public/idl/registry.json`

## 1) Scaffold a New Pack

```bash
npm run pack:init -- \
  --id my-protocol-mainnet \
  --name "My Protocol" \
  --program-id 11111111111111111111111111111111
```

Useful optional flags:
- `--network mainnet-beta`
- `--slug my_protocol`
- `--transport local-my-protocol`
- `--status inactive|active`
- `--commands /my-op,/my-read`
- `--overwrite`

What scaffold creates:
- `aidl/<slug>.aidl.json` (starter AIDL source)
- `registry.json` entry
- then runs AIDL compile

## 2) Author Operations

In AIDL source:
- define runtime-facing operations
- keep protocol behavior in `Codama + runtime`

## 3) Compile and Split Outputs

```bash
npm run aidl:compile
```

This compiles AIDL and generates the runtime pack outputs consumed by runtime/UI.

## 4) Validate During Authoring

```bash
npm run pack:doctor -- --protocol my-protocol-mainnet
npm run aidl:check
npm run pack:check
npm run pack:lint
npm run pack:complexity:enforce
```

Optional RPC-backed checks:

```bash
npm run pack:rpc-check
```

## 5) Activate Pack

Once checks and fixtures are ready:
- set protocol `status` to `active` in `registry.json`
- run full CI command:

```bash
npm run ci:protocol-packs
```

## Recommended Iteration Loop

1. Edit AIDL + compute libraries.
2. `npm run aidl:compile`.
3. Validate with `pack:check`, `pack:lint`, complexity gate.
4. Run app in `npm run dev` and test in Raw + Compute + Views tabs.
5. Commit source and generated pack outputs together.
