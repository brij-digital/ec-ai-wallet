# Project State

## Mission

AppPack is a declarative execution layer for Solana.

The project turns protocol specifications into:
- deterministic transaction preparation
- simulation and send flows
- indexed view/read flows
- end-user app flows generated from spec

The goal is to keep protocol logic in data, not in UI glue or one-off SDK code.

## Repositories

### 1. `ec-ai-wallet`
Role:
- web app
- pack authoring workspace
- CI control plane for protocol packs
- main place to review end-user UX and spec ergonomics

Owns:
- `aidl/*.aidl.json`
- `aidl/*.compute.json`
- generated `public/idl/*`
- generated `public/compute/*`
- App UI and command execution surface
- pack CI scripts and fixtures

### 2. `apppack-runtime`
Role:
- generic runtime

Owns:
- Codama/runtime/app parsing
- generic derive / compute / execution behavior
- schema handling
- declarative runtime primitives

Must not own:
- protocol-specific hacks
- UI-specific behavior

### 3. `apppack-view-service`
Role:
- read/view execution service
- indexed account cache
- bootstrap + incremental sync worker

Owns:
- `/view-run`
- account cache and refresh flow
- Neon-backed account cache and refresh flow
- sync state for search-view universes

Current emphasis:
- search/discovery views rely on the cached account universe
- known-account reads are still part of the overall view model, but do not need the same indexing machinery

Must not own:
- protocol transaction execution logic
- pack-specific UI assumptions

## Architecture Boundaries

### Codama
Protocol truth.
Defines instructions, events, accounts, types, and structure.

### Runtime
Execution logic.
Defines operation expansion such as:
- discover
- derive
- compute
- pre/post instructions
- args/accounts binding
- projections

### App
End-user flow.
Defines:
- steps
- actions
- next step transitions
- step copy / labels
- input presentation

## Non-Negotiables

These are the rules that keep the project coherent.

1. Declarative first.
   If a behavior belongs in protocol logic, prefer pack/spec changes over UI code.

2. No silent fallback.
   Missing fields, invalid transitions, and unsupported cases should fail explicitly.

3. Runtime stays generic.
   Protocol logic belongs in packs unless a primitive is reusable across protocols.

4. Views are separate from writes.
   Read/index concerns live in the view layer, not inside send logic.

5. Every regression should add coverage.
   Bug fixes should add at least one fixture or test when practical.

6. Generated outputs must stay in sync.
   `aidl:check` must pass before merge.

## Current Product Shape

Active protocols:
- `orca-whirlpool-mainnet`
- `pump-amm-mainnet`
- `pump-core-mainnet`
- `kamino-klend-mainnet`

Active surfaces:
- Apps
- Raw Operations
- Compute
- Views
- Pump
- TradingView

Currently disabled in the default shell:
- Command
- Explorer

## Safe AI Ownership Areas

AI can safely lead on:
- pack bug fixes
- fixtures and tests
- docs
- CI and release hygiene
- label/microcopy improvements from spec
- new flows built from existing runtime primitives

AI should not make unilateral decisions on:
- key custody model
- security-sensitive signer flow changes
- schema redesign without migration plan
- major repo boundary changes

## Definition of Healthy State

The project is in a healthy state when:
- all 3 repos build and test cleanly
- pack CI is green
- docs match behavior
- generated outputs are in sync
- runtime changes are generic and justified
- app behavior is driven by spec, not hidden UI logic
