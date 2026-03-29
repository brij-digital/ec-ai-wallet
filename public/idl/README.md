This directory contains generated or synced JSON artifacts.
Because they are JSON files, they do not carry inline `GENERATED / DO NOT EDIT` comments.
Treat this README as the explicit ownership header for the directory.

Shared schema files in this directory are synced from [`apppack-runtime/schemas`](/home/ubuntu/src/apppack-runtime/schemas).

Do not hand-edit:
- `meta_idl.schema.v0.6.json`
- `meta_idl.core.schema.v0.6.json`
- `meta_view.schema.v0.2.json`
- `meta_view.schema.v0.3.json`
- `meta_app.schema.v0.1.json`

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
- MetaIDL/AppSpec outputs: `*.meta.json`, `*.meta.core.json`, `*.app.json`

Current ownership model:
- `*.codama.json` are the protocol source of truth
- `*.json` IDLs are compatibility artifacts while some tooling still needs Anchor-style codecs
- `*.runtime.json` are wallet-owned declarative indexing specs
- `*.app.json` are wallet-owned product/app specs
- `*.meta.json` and `*.meta.core.json` are legacy transitional artifacts during migration
- downstream repos must sync these files instead of editing their own copies

Target architecture:
- `Codama` = protocol truth
- `runtime` = indexing / compute / projections
- `app` = UX / agent flow

Current migration rule for `*.meta.core.json`:
- keep only action-facing material such as `templates`, `operations`, and optional app lookup sources
- do not carry runtime ingest sources like `rpc_transaction_crawler` there
- runtime indexing logic belongs in `*.runtime.json`
