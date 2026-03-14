# AIDL Authoring Guide (v0.1)

This project treats Meta IDL JSON as runtime bytecode.

Authoring happens in AIDL source files:
- `aidl/*.aidl.json`

Compilation produces canonical runtime files:
- `public/idl/*.meta.json`

## Why this split

- AIDL is shorter and easier to maintain.
- Runtime stays strict and deterministic.
- Generated Meta IDL remains explicit/auditable.

## Commands

Compile:

```bash
npm run aidl:compile
```

Check generated files are up to date:

```bash
npm run aidl:check
```

## AIDL file shape

Example:

```json
{
  "kind": "aidl.v0.1",
  "target": {
    "output": "public/idl/pump_amm.meta.json",
    "schema": "meta-idl.v0.6",
    "schemaPath": "/idl/meta_idl.schema.v0.6.json",
    "version": "0.1.0",
    "protocolId": "pump-amm-mainnet"
  },
  "templates": {},
  "operations": {}
}
```

Notes:
- `target.output` is where compiled Meta IDL JSON is written.
- `templates`/`operations` compile to standard Meta IDL fields.
- `operations.useTemplate` is accepted in AIDL and compiles to `operations.use`.
- Read operations can declare a `view` contract:
  - `bootstrap` query steps
  - optional `stream` source/filter
  - `mapping` transform/select
  - `entity_keys` for deterministic identity

## Compute shorthand

AIDL supports shorthand for compute steps and compiles to runtime primitives.

Supported shorthand:
- `{ "name": "x", "add": [a, b, ...] }` -> `math.add`
- `{ "name": "x", "sum": [a, ...] }` -> `math.sum`
- `{ "name": "x", "mul": [a, b, ...] }` -> `math.mul`
- `{ "name": "x", "sub": [a, b, ...] }` -> `math.sub`
- `{ "name": "x", "floor_div": [dividend, divisor] }` -> `math.floor_div`
- `{ "name": "x", "if": { "condition": c, "then": t, "else": e } }` -> `logic.if`
- `{ "name": "x", "get": { "values": arr, "index": i } }` -> `list.get`
- `{ "name": "x", "filter": { "items": arr, "where": clauses } }` -> `list.filter`
- `{ "name": "x", "min_by": { "items": arr, "path": "p", "allow_empty": true } }` -> `list.min_by`
- `{ "name": "x", "max_by": { "items": arr, "path": "p", "allow_empty": true } }` -> `list.max_by`
- `{ "name": "x", "coalesce": [a, b, ...] }` -> `coalesce`
- `{ "name": "x", "eq": [left, right] }` -> `compare.equals`
- `{ "name": "x", "ne": [left, right] }` -> `compare.not_equals`
- `{ "name": "x", "gt": [left, right] }` -> `compare.gt`
- `{ "name": "x", "gte": [left, right] }` -> `compare.gte`
- `{ "name": "x", "lt": [left, right] }` -> `compare.lt`
- `{ "name": "x", "lte": [left, right] }` -> `compare.lte`
- `{ "name": "x", "pda": { "program_id": "...", "seeds": [...] } }` -> `pda(seed_spec)`

You can still use canonical compute format directly by specifying `compute`.

## Current source of truth

- Pump AMM authoring source:
  - `aidl/pump_amm.aidl.json`
- Orca authoring source:
  - `aidl/orca_whirlpool.aidl.json`
- Generated runtime file:
  - `public/idl/pump_amm.meta.json`
  - `public/idl/orca_whirlpool.meta.json`

## Workflow recommendation

1. Edit `aidl/*.aidl.json`.
2. Run `npm run aidl:compile`.
3. Run `npm run lint && npm run build`.
4. Commit both source and generated output.
