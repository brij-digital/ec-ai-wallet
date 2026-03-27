# MVP Roadmap

## Current Status

### Already In Place

- one server is running the stack under `systemd`
- private RPC is up and usable on the box
- Carbon is the active Pump ingestion path
- canonical indexed tables now exist in `apppack-view-service`
- Pump views already read primarily from canonical tables
- a Pump-focused UI flow exists and is useful as a temporary demo surface

### Still Not True

- the system is not yet declarative end to end
- Pump logic still lives in protocol-specific adapter code
- Orca is not yet migrated onto the same canonical model
- battle-tested reliability is not yet proven
- the 3 repos are not yet treated as one hard deployment baseline

## MVP Goal

Finish a battle-testable canonical Solana data plane for intelligent clients, proven first on Pump and then on Orca.

This MVP should prove one sharp idea:

- one canonical indexed contract
- protocol-aware reads on top of it
- execution-ready context on top of it
- honest freshness and sync state
- one server we actually operate ourselves

This MVP is **not**:

- a marketplace
- `x402` monetization
- a broad AI agent platform
- many protocols
- broad frontend polish

## MVP Definition

A finished MVP should let us say:

> AppPack gives intelligent clients a canonical indexed way to discover, understand, and act on Solana markets, starting with Pump and Orca.

## Phase 1. Make The 3 Repos Boring Together

This remains first. The product is the combined system, not the repos separately.

### Tasks

1. make `apppack-runtime` packaging and exports stable
2. make `apppack-view-service` green from fresh install
3. make `ec-ai-wallet` green from fresh install
4. document the release/update flow across the repos
5. make “all 3 repos green together” a baseline gate

### Exit Criteria

- all 3 repos install from scratch
- all relevant tests/builds pass
- published runtime package works downstream

## Phase 2. Freeze The Real MVP Scope

We should stop pretending this MVP is broader than it is.

### MVP Protocols

- Pump AMM
- Pump Core
- Orca Whirlpool

### MVP View Families

- `resolve_pool`
- `pool_snapshot`
- `trade_feed`
- `market_cap_series`
- `stat_cards`
- `ranked_active_tokens`
- `token_trade_context`

### Explicitly Out Of Scope

- marketplace UX
- `x402`
- many more protocols
- fully autonomous agents
- speculative abstractions not required by Pump/Orca

### Exit Criteria

- written MVP scope is agreed
- new work outside this scope must clearly unblock reliability or canonicalization

## Phase 3. Stabilize The Server Stack

The stack must be reboot-safe and operator-friendly.

### Tasks

1. keep API, Carbon, projection workers, and DB under `systemd`
2. verify health endpoints and restart behavior
3. document env, units, secrets, logs, and recovery steps
4. verify Codex can operate there end-to-end

### Exit Criteria

- reboot-safe stack
- services auto-restart
- logs are readable
- one operator can recover the system quickly

## Phase 4. Canonicalize Pump End To End

This is the real center of gravity now.

### Tasks

1. keep Carbon as low-level ingestion only
2. write Pump events and entity state into canonical indexed tables
3. build canonical series from canonical events
4. serve Pump views from canonical tables only
5. remove old Pump product tables from the primary contract

### Exit Criteria

- Pump views no longer depend on `pump_*` product tables
- Carbon is not the owner of product semantics
- canonical tables are the source of truth for Pump reads

## Phase 5. Make The Read Plane Honest And Boring

No fake repair, no hidden magic.

### Tasks

1. keep no read-path fallbacks
2. keep no hidden background repair fallback either
3. expose freshness honestly
4. keep sync state explicit:
   - `pending`
   - `live`
   - `catching_up`
   - `stale`
5. make watched-resource behavior predictable if we keep it
6. keep already-synced request latency tight

### Exit Criteria

- loading a known resource is predictable
- stale state is visible, not hidden
- no magic repair in the request path
- no magic repair outside the request path either

## Phase 6. Prove The Same Canonical Model On Orca

Orca should prove this is not a Pump-only trick.

### Tasks

1. move Orca onto the same canonical indexed contract
2. validate `resolve_pool`, snapshot, feed, series, and stat cards
3. test one or two real Orca pools repeatedly
4. ensure the same mental model applies as on Pump

### Exit Criteria

- Pump and Orca both work on the same canonical model
- protocol-specific adapter logic is reduced, not expanded

## Phase 7. Tighten Source Reliability

Canonical reads are not enough if the ingestion source still drops data.

### Tasks

1. keep private RPC healthy and boring
2. remove or reduce Carbon queue drops
3. verify end-to-end freshness from chain to indexed views
4. document retention and replay expectations
5. ensure the source path does not silently lose events

### Exit Criteria

- private RPC is dependable
- Carbon is not visibly dropping updates in normal operation
- we understand retention and replay boundaries

## Phase 8. Improve Observability

We need to know where the system is unhealthy without guessing.

### Track

1. last chain event time
2. last indexed event time
3. last projected series point time
4. per-resource freshness
5. worker restart count
6. RPC/provider errors
7. queue pressure / backlog
8. lag from on-chain event to API visibility

### Exit Criteria

- we can answer “is the system healthy?” quickly
- we can tell whether the bottleneck is source, projection, DB, or UI

## Phase 9. Keep One Honest Demo Surface

Not broad UI work. Just enough to demonstrate the data plane clearly.

### Tasks

1. keep one clean Pump-first demo flow
2. make it easy to:
   - discover
   - inspect
   - understand freshness
   - see execution context
3. make comparison with external reality easy when useful

### Exit Criteria

- someone can open the UI and understand what the product does
- the UI does not hide stale or missing-data behavior

## Phase 10. Battle-Test For 2–4 Weeks

This is where the MVP becomes real.

### Tasks

1. run the stack continuously
2. watch real Pump and Orca resources daily
3. restart services intentionally
4. reboot the server intentionally
5. compare indexed output with external reality
6. collect and rank recurring failures
7. fix the top reliability issues only

### Exit Criteria

- we know the top recurring failures
- we know what breaks under stress
- we know whether the architecture is good enough to keep pushing

## Priority Order

If we want the strict order:

1. three repos green together
2. stabilize server stack
3. canonicalize Pump end to end
4. make the read plane honest and boring
5. move Orca onto the same canonical model
6. tighten source reliability
7. observability
8. battle-testing
9. only after that: marketplace / `x402`

## What To Cut For Now

To finish the MVP, pause:

- broad marketplace design
- `x402` go-to-market work
- too many new protocols
- generalized “AI agent platform” messaging
- frontend abstraction work that is not required to prove the data plane

## Deliverables Of A Finished MVP

By the end, we should have:

1. one server running the stack reliably
2. three repos green and synchronized
3. Pump on the canonical indexed path
4. Orca on the same canonical indexed path
5. honest freshness and sync-state semantics
6. one clean demo surface
7. one clear product statement

## Product Statement For The MVP

Use something like:

> AppPack gives intelligent clients a canonical indexed data plane for discovering, understanding, and acting on Solana markets, starting with Pump and Orca.

## Week-By-Week Execution Plan

### Week 1. Make The Stack Cohesive

Goal:
- get the three repos behaving as one product again

Tasks:
1. fix `apppack-runtime` packaging and exports
2. make `apppack-view-service` green from fresh install
3. make `ec-ai-wallet` green from fresh install
4. document and verify the release/update flow
5. confirm the server is on the intended commits

Definition of done:
- all three repos build and test cleanly
- no unresolved runtime/package issues remain

### Week 2. Canonicalize Pump

Goal:
- make Pump trustworthy on the new canonical path

Tasks:
1. keep Carbon writing canonical Pump events/state
2. keep Pump series and views reading canonical tables
3. remove remaining Pump legacy product dependencies
4. validate Pump views against reality
5. define canonical Pump test resources

Definition of done:
- Pump reads are canonically served
- Pump output is trustworthy enough for repeated use

### Week 3. Prove Orca On The Same Model

Goal:
- prove the architecture is not Pump-specific

Tasks:
1. move Orca onto the same canonical path
2. validate Orca feed/series/snapshot/stat cards
3. test real pools repeatedly
4. compare behavior with Pump mental model

Definition of done:
- Pump and Orca both work on the same data-plane model

### Week 4. Tighten Reliability And Battle-Test

Goal:
- make the MVP credible under real use

Tasks:
1. reduce source drops / queue pressure
2. improve observability
3. run the stack continuously
4. test restart and reboot recovery
5. collect and rank recurring failures
6. fix the top reliability issues only

Definition of done:
- we know the top recurring failure modes
- we know whether the current architecture is good enough to keep pushing
- we have one demo flow we trust

## Final MVP Exit Checklist

- [ ] all 3 repos green together
- [ ] server stack restart-safe
- [ ] Pump served from the canonical indexed path
- [ ] Orca served from the same canonical model
- [ ] honest freshness/sync-state semantics in place
- [ ] private RPC usable and understood
- [ ] source reliability understood and acceptable
- [ ] one battle-tested demo flow
