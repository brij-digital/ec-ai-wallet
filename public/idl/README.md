This directory contains generated or synced JSON artifacts.
Because they are JSON files, they do not carry inline `GENERATED / DO NOT EDIT` comments.
Treat this README as the explicit ownership header for the directory.

Protocol artifacts in this directory are synced from [`protocol-registry`](/Users/antoine/.openclaw/workspace-coding/brij-digital/protocol-registry).

Shared schema files in that registry are owned by [`apppack-runtime/schemas`](/Users/antoine/.openclaw/workspace-coding/brij-digital/apppack-runtime/schemas).

Do not hand-edit:
- `declarative_decoder_runtime.schema.v1.json`
- `solana_agent_runtime.schema.v1.json`
- `solana_action_runner.schema.v1.json`

Use:
- `npm run registry:sync`
- `npm run registry:check`

Schema ownership rule:
- edit only [`apppack-runtime/schemas`](/Users/antoine/.openclaw/workspace-coding/brij-digital/apppack-runtime/schemas), then sync those into [`protocol-registry`](/Users/antoine/.openclaw/workspace-coding/brij-digital/protocol-registry)
- never edit the copies here by hand
- if drift is reported, rerun `npm run registry:sync`

This directory is a synced consumer copy for the wallet app.

In practice:
- authoring source lives in [`protocol-registry`](/Users/antoine/.openclaw/workspace-coding/brij-digital/protocol-registry)
- synced consumer outputs land in `public/idl/`
- downstream consumers should sync from the registry, not from the wallet copy

Protocol pack ownership rule:
- edit pack authoring source in [`protocol-registry`](/Users/antoine/.openclaw/workspace-coding/brij-digital/protocol-registry)
- verify with `npm run pack:check`
- do not hand-edit generated artifacts in `public/idl/`

Generated protocol artifacts in this directory now include:
- canonical protocol specs: `*.codama.json`
- declarative ingest specs: `*.ingest.json`
- declarative indexed-read specs: `*.indexed-reads.json`
- declarative runtime specs: `*.runtime.json`

Current ownership model:
- `*.codama.json` are the protocol source of truth
- `*.ingest.json` own event/account ingestion and canonical record emission
- `*.indexed-reads.json` own indexed reads and discovery
- `*.runtime.json` own deterministic compute and write preparation
- downstream repos must sync these files instead of editing their own copies

Target architecture:
- `Codama` = protocol truth
- `indexing` = reads / discovery
- `runtime` = compute / write preparation / small transaction envelope

Current migration rule:
- active packs expose only `codama + runtime`
- `*.meta.json` / `*.meta.core.json` are no longer part of the active pack contract
