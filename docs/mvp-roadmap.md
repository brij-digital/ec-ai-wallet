# MVP Roadmap

## Current Status

### Already In Place

- Edgevana server exists and Codex is installed there.
- Postgres, API, workers, and private RPC bootstrap are underway on the server.
- Pump AMM and Pump Core are both implemented in the current product shape.
- Orca materialized adapter work has started.
- Backend watch and sync-status model exists.
- Read-path fallbacks were intentionally removed.

### Not Yet True

- the 3 repos are not all green together from a fresh install
- runtime package integration is not fully stable downstream
- private RPC is not yet the default trusted backend path
- Pump and Orca are not yet battle-tested enough to call “boring”
- MVP scope is still at risk of expanding

## MVP Goal

Finish a battle-testable Pump/Orca agent-readable data plane that proves one sharp wedge:

- protocol-aware reads
- protocol-aware action surfaces
- honest sync state
- server deployment
- one clear user/demo flow

This MVP is **not**:

- a full marketplace
- full autonomy
- many protocols
- broad platform polish

## MVP Definition

A finished MVP should let us say:

> We can watch a Pump or Orca market, expose stable views and execution-ready protocol context, and serve that from our own backend with honest freshness and no fake fallbacks.

## Phase 1. Fix The Foundation

This comes first because the three repos must behave as a single product, and right now the runtime integration chain is not fully stable.

### Tasks

1. Fix `apppack-runtime` packaging and export resolution.
2. Make `ec-ai-wallet` build and test clean from a fresh install.
3. Make `apppack-view-service` build and test clean from a fresh install.
4. Pin and document the release/update flow across the three repos.
5. Make “all three repos green together” a baseline gate.

### Exit Criteria

- all 3 repos install from scratch
- all tests pass
- published runtime package works in both downstream repos

## Phase 2. Freeze MVP Scope

Reduce drift and stop adding side quests.

### MVP Protocols

- Pump AMM
- Pump Core
- Orca Whirlpool

### MVP Surfaces

- `resolve_pool`
- `pool_snapshot`
- `trade_feed`
- `market_cap_series`
- `stat_cards`
- one action-context style view where useful

### Explicitly Out Of Scope

- view marketplace
- `x402` monetization
- creator economy mechanics
- many more protocols
- fully autonomous agents

### Exit Criteria

- written MVP scope is agreed
- no new feature work outside this scope unless it unblocks reliability

## Phase 3. Stabilize The Server Stack

Move from “it runs” to “it is dependable.”

### Tasks

1. Finish Edgevana server bootstrap.
2. Keep Postgres, API, and workers under `systemd`.
3. Verify health endpoints and service restart behavior.
4. Document env, secrets, service units, logs, and recovery steps.
5. Make sure Codex can operate there end-to-end.

### Exit Criteria

- reboot-safe stack
- services auto-restart
- logs are readable
- one operator can recover the system quickly

## Phase 4. Make The Read Plane Honest And Boring

This is the heart of the MVP.

### Tasks

1. Keep no read-path fallbacks.
2. Make sync states explicit:
   - `pending`
   - `live`
   - `catching_up`
   - `stale`
3. Ensure watch/unwatch flow is reliable.
4. Ensure watched resources update predictably.
5. Tighten request latency for already-synced resources.

### Exit Criteria

- loading a watched token is predictable
- stale state is visible, not hidden
- no magic repair in request path

## Phase 5. Harden Pump

Pump is the reference market and the current proving ground.

### Tasks

1. Verify Pump AMM feed/series correctness against Pump.fun.
2. Verify Pump Core feed/series correctness against bonding-curve state.
3. Improve ranking / active token quality only if it helps usability.
4. Reduce false negatives in “why is this token missing?”
5. Define a small set of canonical test tokens:
   - active AMM
   - active Core
   - stale/dead
   - recently migrated

### Exit Criteria

- comparison against Pump.fun is trustworthy
- watch flow works for both AMM and Core
- demo tokens are stable and known

## Phase 6. Harden Orca

Orca is the second proof that this is not just a Pump-specific system.

### Tasks

1. Finish Orca materialized adapter path.
2. Validate `resolve_pool`, snapshot, feed, series, and stat cards.
3. Make sure the watch/status model works for Orca too.
4. Test one or two real Orca pools repeatedly.

### Exit Criteria

- the same mental model works on Pump and Orca
- the adapter pattern is proven by two real protocols

## Phase 7. Bring Up Private Solana RPC

Not as product polish. As operational leverage.

### Tasks

1. Finish private non-voting RPC bootstrap.
2. Confirm `127.0.0.1:8899` serves JSON-RPC correctly.
3. Compare local RPC vs Helius on the actual worker paths.
4. Decide which workloads move first:
   - likely market ingest first
   - then selected current-state reads later
5. Keep Helius only where still necessary during transition.

### Exit Criteria

- private RPC is usable
- at least one real backend path uses it successfully
- we understand where provider dependence still remains

## Phase 8. Improve Observability

We need to know whether the system works without guessing.

### Track

1. last stream event time
2. last materialized event time
3. watch count
4. per-resource sync status
5. worker restart count
6. websocket reconnect count
7. RPC/provider errors
8. lag from on-chain event to UI visibility

### Exit Criteria

- we can answer “is the system healthy?” quickly
- we can tell whether the bottleneck is ingest, DB, or UI

## Phase 9. Polish The Demo UX

Not broad UI work. Just enough to sell the story.

### Tasks

1. Make the Pump workspace the clean MVP surface.
2. Keep saved/watchlisted tokens smooth.
3. Show sync state clearly.
4. Keep chart/feed/trades readable.
5. Make comparison with Pump.fun easy.

### Exit Criteria

- someone can open the UI and understand what the product does
- no confusing stale or missing-data behavior

## Phase 10. Battle-Test For 2–4 Weeks

This is where the MVP becomes real.

### Tasks

1. Run the stack continuously.
2. Watch real tokens daily.
3. Compare with Pump.fun and Orca reality.
4. Restart services intentionally.
5. Reboot the server intentionally.
6. Test recovery from interruptions.
7. Collect concrete failure cases.

### Exit Criteria

- we know the top 3 recurring failures
- we know what breaks under stress
- we know whether Helius dependence is still acceptable

## Priority Order

If we want the strict order:

1. cross-repo packaging/build green
2. freeze MVP scope
3. stabilize server stack
4. harden Pump
5. harden Orca
6. bring private RPC into real use
7. observability
8. battle-testing
9. only after that: marketplace / `x402` expansion

## What To Cut For Now

To finish the MVP, pause:

- broad marketplace design
- `x402` go-to-market work
- too many new protocols
- generalized “AI agent platform” messaging
- speculative abstractions not required by Pump/Orca

## Deliverables Of A Finished MVP

By the end, we should have:

1. one server running the stack reliably
2. three repos green and synchronized
3. Pump AMM + Core working end-to-end
4. Orca working end-to-end
5. honest watch/sync model
6. one clean demo UI
7. one clear product statement

## Product Statement For The MVP

Use something like:

> AppPack gives intelligent clients a structured way to discover, read, and act on Solana protocols, starting with Pump and Orca.

That is narrow enough to test and strong enough to build on.

## Week-By-Week Execution Plan

### Week 1. Make The Stack Cohesive

Goal:
- get the three repos behaving as one product again

Tasks:
1. fix `apppack-runtime` export/package resolution
2. make `ec-ai-wallet` green from fresh install
3. make `apppack-view-service` green from fresh install
4. document and verify the runtime release/update flow
5. confirm the server is on the latest intended commits

Definition of done:
- all three repos build and test cleanly
- no unresolved runtime import/package issues remain

### Week 2. Stabilize The Server And Pump

Goal:
- make the server stack predictable
- make Pump trustworthy

Tasks:
1. verify `systemd` behavior for API and workers
2. verify logs, restart behavior, and health endpoints
3. validate Pump AMM against Pump.fun
4. validate Pump Core against bonding-curve state
5. define and document canonical Pump test tokens

Definition of done:
- server survives routine restarts
- Pump read surfaces are trustworthy enough for repeated use

### Week 3. Finish Orca And RPC Transition Work

Goal:
- prove the model on a second protocol
- move closer to owned infra

Tasks:
1. finish Orca adapter validation
2. test Orca feed/series/snapshot/stat cards on real pools
3. continue private RPC bootstrap and verify `127.0.0.1:8899`
4. compare Helius-backed and private-RPC-backed worker paths
5. decide which backend workloads switch first

Definition of done:
- Pump and Orca both work in the same product model
- private RPC is usable enough for real comparison work

### Week 4. Battle-Test And Tighten

Goal:
- make the MVP credible under real use

Tasks:
1. run the stack continuously
2. watch real tokens/pools every day
3. track stale/catching-up/live states
4. test service restarts and reboot recovery
5. collect and rank recurring failures
6. fix the top reliability issues only

Definition of done:
- we know the top recurring failure modes
- we know whether the current architecture is good enough to keep pushing
- we have one demo flow we trust

## Final MVP Exit Checklist

- [ ] all 3 repos green together
- [ ] server stack restart-safe
- [ ] Pump AMM works end-to-end
- [ ] Pump Core works end-to-end
- [ ] Orca works end-to-end
- [ ] honest sync-state UX in place
- [ ] private RPC usable and understood
- [ ] one battle-tested demo flow
