# Espresso Cash AI Wallet MVP (Web)

This repository is a command-driven web demo for an Espresso Cash AI Wallet MVP.

Current scope:
- Single-signature wallet approval (no Swig/passkeys yet)
- One active swap integration via Orca Whirlpools on Solana mainnet
- Local IDL registry (`public/idl`) to prove dynamic protocol plumbing
- Chat-style command input with deterministic command parsing

## Commands

- `/help`
- `/swap <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]`
- `/confirm`

Example:

```text
/swap SOL USDC 0.01 50
/confirm
```

Supported token aliases in this MVP:
- `SOL`
- `USDC`

## IDL Registry

The local protocol registry is stored at:
- `public/idl/registry.json`

The initial protocol IDL is stored at:
- `public/idl/orca_whirlpool.json`

## Run Locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Notes

- The app targets `mainnet-beta` by default.
- Swap execution requires a connected Phantom wallet.
- Swap quotes and transaction instructions are built locally with Orca Whirlpools SDK (IDL-backed).
