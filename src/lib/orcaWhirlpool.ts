import { BN } from '@coral-xyz/anchor';
import { Percentage } from '@orca-so/common-sdk';
import type { Wallet as WhirlpoolWallet } from '@orca-so/common-sdk';
import {
  IGNORE_CACHE,
  ORCA_SUPPORTED_TICK_SPACINGS,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORCA_WHIRLPOOLS_CONFIG,
  PDAUtil,
  PoolUtil,
  WhirlpoolContext,
  buildWhirlpoolClient,
  swapQuoteByInputToken,
} from '@orca-so/whirlpools-sdk';
import type { SwapQuote } from '@orca-so/whirlpools-sdk';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import { Connection, PublicKey } from '@solana/web3.js';
import type { Transaction, VersionedTransaction } from '@solana/web3.js';
import type { SwapCommand } from './commandParser';

export type PreparedOrcaSwap = {
  poolAddress: string;
  tickSpacing: number;
  quote: SwapQuote;
  estimatedAmountInAtomic: string;
  estimatedAmountOutAtomic: string;
};

function toWhirlpoolWallet(wallet: WalletContextState): WhirlpoolWallet {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Connect a wallet with signing support first.');
  }

  return {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      if (wallet.signAllTransactions) {
        return wallet.signAllTransactions(txs);
      }

      const signed: T[] = [];
      for (const tx of txs) {
        signed.push(await wallet.signTransaction!(tx));
      }
      return signed;
    },
  };
}

async function resolveBestPoolAddress(
  inputMint: PublicKey,
  outputMint: PublicKey,
  connection: Connection,
  ctx: WhirlpoolContext,
) {
  const [orderedTokenA, orderedTokenB] = PoolUtil.orderMints(inputMint, outputMint);
  const tokenA = new PublicKey(orderedTokenA);
  const tokenB = new PublicKey(orderedTokenB);

  const candidates = ORCA_SUPPORTED_TICK_SPACINGS.map((tickSpacing) => ({
    tickSpacing,
    address: PDAUtil.getWhirlpool(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      ORCA_WHIRLPOOLS_CONFIG,
      tokenA,
      tokenB,
      tickSpacing,
    ).publicKey,
  }));

  const accountInfos = await connection.getMultipleAccountsInfo(candidates.map((candidate) => candidate.address));

  const existingCandidates = candidates.filter((_, index) => accountInfos[index] !== null);
  if (existingCandidates.length === 0) {
    throw new Error('No Orca Whirlpool found for this token pair.');
  }

  const fetchedPools = await ctx.fetcher.getPools(
    existingCandidates.map((candidate) => candidate.address),
    IGNORE_CACHE,
  );

  let selected: (typeof candidates)[number] | null = null;
  let highestLiquidity = new BN(0);
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const poolData = fetchedPools.get(candidate.address.toBase58());
    if (!poolData) {
      continue;
    }

    if (!selected || poolData.liquidity.gt(highestLiquidity)) {
      selected = candidate;
      highestLiquidity = poolData.liquidity;
    }
  }

  if (!selected) {
    throw new Error('No initialized Orca Whirlpool pool data found for this token pair.');
  }

  return selected;
}

export async function prepareOrcaSwap(options: {
  command: SwapCommand;
  connection: Connection;
  wallet: WalletContextState;
}): Promise<PreparedOrcaSwap> {
  const whirlpoolWallet = toWhirlpoolWallet(options.wallet);
  const ctx = WhirlpoolContext.from(options.connection, whirlpoolWallet);
  const client = buildWhirlpoolClient(ctx);

  const inputMint = new PublicKey(options.command.inputMint);
  const outputMint = new PublicKey(options.command.outputMint);
  const selectedPool = await resolveBestPoolAddress(inputMint, outputMint, options.connection, ctx);

  const whirlpool = await client.getPool(selectedPool.address, IGNORE_CACHE);
  const slippage = Percentage.fromFraction(options.command.slippageBps, 10_000);

  const quote = await swapQuoteByInputToken(
    whirlpool,
    inputMint,
    new BN(options.command.amountAtomic),
    slippage,
    ORCA_WHIRLPOOL_PROGRAM_ID,
    ctx.fetcher,
    IGNORE_CACHE,
  );

  return {
    poolAddress: selectedPool.address.toBase58(),
    tickSpacing: selectedPool.tickSpacing,
    quote,
    estimatedAmountInAtomic: quote.estimatedAmountIn.toString(),
    estimatedAmountOutAtomic: quote.estimatedAmountOut.toString(),
  };
}

export async function executeOrcaSwap(options: {
  preparedSwap: PreparedOrcaSwap;
  connection: Connection;
  wallet: WalletContextState;
}): Promise<string> {
  const whirlpoolWallet = toWhirlpoolWallet(options.wallet);
  const ctx = WhirlpoolContext.from(options.connection, whirlpoolWallet);
  const client = buildWhirlpoolClient(ctx);

  const whirlpool = await client.getPool(options.preparedSwap.poolAddress, IGNORE_CACHE);
  const txBuilder = await whirlpool.swap(options.preparedSwap.quote, whirlpoolWallet.publicKey);

  return txBuilder.buildAndExecute();
}
