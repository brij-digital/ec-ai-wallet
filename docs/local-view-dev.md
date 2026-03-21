# Local View Loop

Use this setup when iterating on view specs, indexer behavior, or small UI prototypes without waiting on Render/Neon deploys.

## 1. Local PostgreSQL

This repo assumes a local PostgreSQL instance is running on `localhost:5432` and a database named `apppack_local` exists.

Example setup on macOS (Homebrew):

```bash
brew install postgresql@17
brew services start postgresql@17
createdb apppack_local
```

## 2. Local view service

In `apppack-view-service`:

```bash
cd /Users/antoine/Documents/github/Espresso\ Cash/apppack-view-service
cp local.env.example .env
# then replace SOLANA_RPC_URL with your Helius RPC URL
npm run dev
```

In a second terminal:

```bash
cd /Users/antoine/Documents/github/Espresso\ Cash/apppack-view-service
npm run dev:worker
```

The API will be available at `http://localhost:8080`.

## 3. Local wallet playground

In `ec-ai-wallet`:

```bash
cd /Users/antoine/Documents/github/Espresso\ Cash/ec-ai-wallet
cp local.env.example .env.local
npm run dev
```

Open the app and use the `Views` tab to:
- verify the local view service is healthy
- run search views against your local index
- inspect raw result shapes and a simple structured preview

## 4. Suggested workflow

1. edit the view spec / runtime behavior
2. let the local worker backfill or refresh
3. check `http://localhost:8080/sync/status`
4. run the view from the wallet `Views` tab
5. inspect the data shape before deploying anything

## 5. Good next local additions

- Pump trade ingest worker (`feed` source)
- materialized 1m candles (`series` source)
- small purpose-built Pump page prototype that reuses the same views
