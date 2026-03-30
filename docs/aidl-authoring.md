# AIDL Authoring Guide (Current)

AIDL is the authoring format for app specs in this repo.

Goal:
- keep authoring concise for humans
- compile to strict app JSON consumed by `@brij-digital/apppack-runtime`

## Source Files

AIDL operation/app sources:
- `aidl/*.aidl.json`

AIDL shared compute libraries:
- `aidl/*.compute.json`

Generated outputs:
- `public/idl/*.app.json`
- `public/compute/*.compute.json` (copied source libraries for inspection)

## Compile Commands

Compile packs:

```bash
npm run aidl:compile
```

Check generated outputs are in sync:

```bash
npm run aidl:check
```

## Minimal AIDL Shape

```json
{
  "kind": "aidl.v0.1",
  "target": {
    "output": "public/idl/my_protocol.app.json",
    "schema": "meta-app.v0.1",
    "schemaPath": "/idl/meta_app.schema.v0.1.json",
    "version": "0.1.0",
    "protocolId": "my-protocol-mainnet"
  },
  "label": "My Protocol",
  "templates": {},
  "operations": {},
  "apps": {}
}
```

## Compute Libraries (`aidl.compute.v0.1`)

Compute libraries are reusable declarative blocks referenced by `compute_refs`.

Example shape:

```json
{
  "kind": "aidl.compute.v0.1",
  "libraries": {
    "my.compute.v1": [
      { "name": "x", "add": ["1", "2"] }
    ]
  }
}
```

Supported shorthand in AIDL compute steps:
- `add`, `sum`, `mul`, `sub`, `floor_div`
- `if`
- `get`, `filter`, `min_by`, `max_by`
- `coalesce`
- `eq`, `ne`, `gt`, `gte`, `lt`, `lte`
- `pda`

Compiler maps these to runtime primitives (for example `add -> math.add`).

## App Spec Rules Enforced by Compiler/Lint

App schema is strict (`meta-app.v0.1`).

Important rules:
- `actions` must use `{ "label", "do": { "fn", "mode?" } }`
- `fn=run` requires `mode` (`view|simulate|send`)
- `fn=back|reset` must not include `mode`
- `status_text` is normalized/required (`running`, `success`, `error`)
- `transitions` is deprecated (use `next_on_success`)
- `blocking` wrapper is deprecated (use `requires_paths` on step)
- `ui_editable` is deprecated (use `ui_mode`: `edit|readonly|hidden`)

## Current Status in This Repo

AIDL-first app packs today:
- `orca_whirlpool`
- `pump_amm`

Runtime logic no longer lives in AIDL output. Keep indexing / compute / projections in `public/idl/*.runtime.json`.

## Recommended Workflow

1. Edit `aidl/*.aidl.json` and `aidl/*.compute.json`.
2. Run `npm run aidl:compile`.
3. Run `npm run ci:protocol-packs`.
4. Commit source + generated files together.
