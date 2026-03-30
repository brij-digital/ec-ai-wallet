This directory contains generated or synced JSON artifacts.
Because they are JSON files, they do not carry inline `GENERATED / DO NOT EDIT` comments.
Treat this README as the explicit ownership header for the directory.

Shared schema files in this directory are synced from [`apppack-runtime/schemas`](/home/ubuntu/src/apppack-runtime/schemas).

Do not hand-edit:
- `meta_view.schema.v0.2.json`
- `meta_view.schema.v0.3.json`
- `meta_app.schema.v0.1.json`
- `declarative_decoder_runtime.schema.v1.json`

Use:
- `npm run schemas:sync`
- `npm run schemas:check`

Schema ownership rule:
- edit only [`apppack-runtime/schemas`](/home/ubuntu/src/apppack-runtime/schemas)
- never edit the copies here by hand
- if drift is reported, rerun `npm run schemas:sync`

This directory is also the current generated protocol-pack artifact source for downstream consumers.

In practice:
- authoring source lives in `aidl/` where available
- generated outputs land in `public/idl/`
- downstream consumers like `apppack-view-service` should sync from these generated outputs instead of editing parallel copies

Protocol pack ownership rule:
- edit source files in [`aidl/`](/home/ubuntu/src/ec-ai-wallet/aidl) or the pack authoring source in this repo
- regenerate with `npm run aidl:compile`
- verify with `npm run aidl:check`
- do not hand-edit generated artifacts in `public/idl/`

Generated protocol artifacts in this directory now include:
- canonical protocol specs: `*.codama.json`
- codec compatibility IDLs: `*.json`
- declarative indexing/runtime specs: `*.runtime.json`
- app specs: `*.app.json`

Current ownership model:
- `*.codama.json` are the protocol source of truth
- `*.json` IDLs are compatibility artifacts while some tooling still needs Anchor-style codecs
- `*.runtime.json` are wallet-owned declarative indexing specs
- `*.app.json` are wallet-owned execution + product/app specs
- downstream repos must sync these files instead of editing their own copies
- `registry.json` may omit `idlPath` for migrated protocols; when a codec IDL is still needed, it should be resolved from `*.runtime.json` decoder artifacts, not treated as primary registry truth

Target architecture:
- `Codama` = protocol truth
- `runtime` = indexing / compute / projections
- `app` = UX / agent flow

Current migration rule:
- active packs expose only `codama + runtime + app`
- `*.meta.json` / `*.meta.core.json` are no longer part of the active pack contract
