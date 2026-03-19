# Maintainer Guide

This guide is for humans and AI maintainers.

## Primary Goal

Keep the system understandable and safe while preserving momentum.

Do not optimize for cleverness.
Optimize for explicit behavior, small diffs, and strong regression protection.

## Default Maintenance Workflow

1. Reproduce the issue.
2. Decide which layer owns the fix:
   - protocol truth -> IDL
   - execution wiring -> MetaIDL
   - end-user flow/copy -> AppSpec
   - reusable primitive -> runtime
   - indexed reads -> view-service
3. Prefer the narrowest correct layer.
4. Add or update coverage.
5. Run the relevant checks.
6. Update docs if behavior changed.

## Where Fixes Should Go

### Put the fix in the pack when
- a protocol account is missing
- a pre/post instruction is missing
- a protocol computation is wrong
- a field label/help/order is wrong
- a step flow is protocol-specific

### Put the fix in runtime when
- the behavior is truly reusable across multiple protocols
- the current schema supports it but runtime interprets it incorrectly
- a new primitive is needed and is not protocol-specific

### Put the fix in view-service when
- the issue is in indexed reads
- cache hydration is wrong
- `/view-run` result shaping is wrong

### Avoid fixing in UI when
- the behavior can be represented in pack spec
- the UI would need to know protocol names or account semantics

## Review Rules

Before merging, check:
- Is this fix in the right layer?
- Does it remove or add hidden behavior?
- Does it make the spec more or less explicit?
- Is there a regression test or fixture?
- Are generated files in sync?

## Required Commands

For pack changes in `ec-ai-wallet`:

```bash
npm run aidl:compile
npm run build
npm run ci:protocol-packs
```

For runtime changes in `apppack-runtime`:

```bash
npm run build
npm test
```

For view-service changes in `apppack-view-service`:

```bash
npm run build
npm test
```

## Triage Labels

Recommended GitHub labels:
- `ai-safe`
- `needs-human-decision`
- `schema-change`
- `security-review`
- `docs`
- `runtime`
- `view-service`
- `pack`
- `ux-copy`
- `good-first-pack`

## PR Expectations

Every PR should answer:
- what was broken or missing
- why this layer is the right place for the fix
- how it was validated
- whether docs changed

## What AI Can Own Autonomously

Good autonomous AI work:
- bug reproduction and fix
- pack fixture updates
- generated output sync
- docs cleanup
- test additions
- copy simplification from spec fields

Needs approval first:
- schema version bump
- signer/security model changes
- changes across all 3 repos with boundary implications
- new backend infra commitments

## Anti-Patterns

Do not do these.

- Protocol-specific UI hacks.
- Silent fallbacks for missing config.
- Runtime shortcuts that bypass spec.
- Fixing generated files without fixing AIDL source.
- Mixing read-index concerns into send execution logic.
- Large speculative refactors without tests.
