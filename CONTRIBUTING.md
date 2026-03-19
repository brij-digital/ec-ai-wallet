# Contributing

## Start Here

If you are new to the project, read in this order:
1. [PROJECT_STATE.md](PROJECT_STATE.md)
2. [MAINTAINER_GUIDE.md](MAINTAINER_GUIDE.md)
3. [README.md](README.md)
4. [docs/aidl-authoring.md](docs/aidl-authoring.md)
5. [docs/pack-builder.md](docs/pack-builder.md)

## Common Contribution Types

### Pack bug fix
Usually edit:
- `aidl/*.aidl.json`
- optionally `aidl/*.compute.json`

Then run:

```bash
npm run aidl:compile
npm run build
npm run ci:protocol-packs
```

### Runtime primitive or parser fix
Make the change in `apppack-runtime`, add tests there, then bump dependency here if needed.

### View/read issue
Make the change in `apppack-view-service`.

## Pack Authoring Kit

When adding or extending a protocol pack, use this checklist.

### 1. Define protocol truth
- add or update raw IDL in `public/idl/*.json` if needed
- keep protocol truth separate from execution logic

### 2. Author execution logic
- add or update `aidl/<protocol>.aidl.json`
- add reusable compute blocks in `aidl/<protocol>.compute.json` when it improves clarity
- prefer named reusable compute blocks over large inline compute chains when the logic is reused

### 3. Author end-user flow
- keep end-user flows in app spec
- labels and help text should be human-readable
- avoid protocol jargon when a user-facing name is clearer

### 4. Compile and inspect outputs

```bash
npm run aidl:compile
```

Inspect:
- `public/idl/*.meta.json`
- `public/idl/*.meta.core.json`
- `public/idl/*.app.json`
- `public/compute/*.compute.json`

### 5. Add validation coverage
At minimum, prefer one of:
- protocol pack fixture
- parity fixture against known tx
- simulation fixture
- UI/unit test if the bug is form/runtime integration related

### 6. Verify ergonomics
Check in the app:
- Apps tab
- Raw Operations tab
- Command mode
- Compute tab if compute changed

## Style Guidance

- Prefer explicit config over convenience magic.
- Keep runtime generic.
- Keep protocol logic in spec.
- Keep copy simple.
- Keep diffs small when possible.
