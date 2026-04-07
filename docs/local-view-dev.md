# Local Indexing Loop

Use this setup when iterating on entity specs, projector behavior, or small UI prototypes without waiting on deploys.

## 1. Local PostgreSQL

This repo assumes a local PostgreSQL instance is running on `localhost:5432` and a database named `apppack_local` exists.

Example setup on macOS (Homebrew):

```bash
brew install postgresql@17
brew services start postgresql@17
createdb apppack_local
```

## 2. Local indexing stack

In `protocol-indexing`:

```bash
cd /Users/antoine/Documents/github/AppPACK/protocol-indexing
cargo run --manifest-path protocol-indexing-engine/Cargo.toml -- ingest-live
# or run the projector / API roles separately in additional terminals:
cargo run --manifest-path protocol-indexing-engine/Cargo.toml -- project
cargo run --manifest-path protocol-indexing-engine/Cargo.toml -- api
```

The API will be available at `http://localhost:8080`.

## 3. Local wallet playground

In `protocol-ui`:

```bash
cd /Users/antoine/Documents/github/Espresso\ Cash/protocol-ui
cp local.env.example .env.local
npm run dev
```

Open the app and use the `Entities` tab to:
- verify the local indexing API is healthy
- browse materialized entities against your local index
- inspect raw result shapes and a simple structured preview

## 4. Suggested workflow

1. edit the entity spec / runtime behavior
2. let the projector catch up
3. check `http://localhost:8080/health`
4. inspect the data from the wallet `Entities` tab
5. inspect the data shape before deploying anything
