# MetaIDL Tutorial (Current Runtime)

This tutorial reflects the current architecture in this repo.

## Mental Model

A protocol pack has three layers:

1. `IDL`:
- binary instruction/account schema from protocol program

2. `MetaIDL`:
- declarative execution plan for operations
- phases: `discover -> derive -> compute -> args/accounts`

3. `AppSpec`:
- end-user flow over operations (steps/actions/transitions)

## Where Runtime Lives

Execution runtime is externalized in package:
- `@brij-digital/apppack-runtime`

This web app consumes runtime APIs and renders UI.

## Operation Anatomy

A MetaIDL operation typically contains:
- `inputs`: typed inputs, labels, defaults, optional `read_from`, optional `ui_mode`
- `discover`: protocol-aware query/pick steps
- `derive`: wallet/PDA/ATA/account decode steps
- `compute`: deterministic math/list/logic transforms
- `args`: final instruction args mapping
- `accounts`: final instruction account mapping
- optional `pre`/`post` instructions

## Read-Only Preview Pattern

You can show computed values directly in form inputs:
- define input as `ui_mode: "readonly"`
- bind `read_from: "$derived.some_value"`
- compute `some_value` in operation `compute`

This is how live previews are displayed without custom UI protocol code.

## Example Pattern

- Orca swap uses computed quote preview (`estimated_out`) from declarative compute
- Pump Core buy now computes `min_tokens_out_auto` declaratively and binds it to readonly input

## AppSpec Flow (meta-app.v0.1)

App steps are strict and explicit:
- `actions` use `{ label, do: { fn, mode? } }`
- `fn=run` requires `mode`
- step transitions use `next_on_success`
- step gating uses `requires_paths`
- selectable derived lists are declared under `step.ui` (`select_from_derived`)

No implicit transitions/fallbacks are intended in pack authoring.

## Command Path

In Command tab, execution is strict and explicit:
- `/meta-run <protocol> <operation> <input-json> --simulate|--send`
- `/view-run <protocol> <operation> <input-json>`

`/meta-run` requires explicit mode.

## Compile + Split Pipeline

Authoring pipeline:
- `aidl/*.aidl.json` + `aidl/*.compute.json`
- `npm run aidl:compile`

Outputs:
- `public/idl/*.meta.json`
- `public/idl/*.meta.core.json`
- `public/idl/*.app.json`
- `public/compute/*.compute.json`

## Validation + CI

Use these commands while iterating:

```bash
npm run aidl:check
npm run pack:check
npm run pack:lint
npm run pack:complexity:enforce
```

Optional RPC checks:

```bash
npm run pack:rpc-check
```

## Practical Debug Checklist

When an operation fails:
- verify required inputs are present and typed
- inspect `/meta-explain <protocol> <operation>`
- run `--simulate` first
- inspect derived accounts and compute outputs in raw details
- check view operation output when app step depends on `requires_paths`
