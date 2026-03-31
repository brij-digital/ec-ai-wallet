import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import type { Connection } from '@solana/web3.js';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import {
  sendIdlInstruction,
  simulateIdlInstruction,
} from '@brij-digital/apppack-runtime/idlDeclarativeRuntime';

type PreparedPreInstructionSpec =
  | {
      kind: 'spl_ata_create_idempotent';
      payer: string;
      ata: string;
      owner: string;
      mint: string;
      tokenProgram: string;
      associatedTokenProgram: string;
    }
  | {
      kind: 'system_transfer';
      from: string;
      to: string;
      lamports: string;
    }
  | {
      kind: 'spl_token_sync_native';
      account: string;
      tokenProgram: string;
    };

type PreparedPostInstructionSpec = {
  kind: 'spl_token_close_account';
  account: string;
  destination: string;
  owner: string;
  tokenProgram: string;
};

export type PreparedExecutionDraft = {
  protocolId: string;
  operationId: string;
  instructionName: string | null;
  args: Record<string, unknown>;
  accounts: Record<string, string>;
  remainingAccounts?: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  preInstructions?: PreparedPreInstructionSpec[];
  postInstructions?: PreparedPostInstructionSpec[];
};

export function buildPostInstructions(
  postSpecs: PreparedPostInstructionSpec[] = [],
): TransactionInstruction[] {
  return postSpecs.map((spec) =>
    createCloseAccountInstruction(
      new PublicKey(spec.account),
      new PublicKey(spec.destination),
      new PublicKey(spec.owner),
      [],
      new PublicKey(spec.tokenProgram),
    ),
  );
}

export function buildPreInstructions(
  preSpecs: PreparedPreInstructionSpec[] = [],
): TransactionInstruction[] {
  return preSpecs.map((spec) => {
    if (spec.kind === 'spl_ata_create_idempotent') {
      return createAssociatedTokenAccountIdempotentInstruction(
        new PublicKey(spec.payer),
        new PublicKey(spec.ata),
        new PublicKey(spec.owner),
        new PublicKey(spec.mint),
        new PublicKey(spec.tokenProgram),
        new PublicKey(spec.associatedTokenProgram),
      );
    }
    if (spec.kind === 'system_transfer') {
      return SystemProgram.transfer({
        fromPubkey: new PublicKey(spec.from),
        toPubkey: new PublicKey(spec.to),
        lamports: Number(spec.lamports),
      });
    }
    return createSyncNativeInstruction(new PublicKey(spec.account), new PublicKey(spec.tokenProgram));
  });
}

export async function simulatePreparedExecutionDraft(options: {
  draft: PreparedExecutionDraft;
  connection: Connection;
  wallet: WalletContextState;
}) {
  if (!options.draft.instructionName) {
    throw new Error('Draft has no instructionName.');
  }

  return simulateIdlInstruction({
    protocolId: options.draft.protocolId,
    instructionName: options.draft.instructionName,
    args: options.draft.args,
    accounts: options.draft.accounts,
    remainingAccounts: options.draft.remainingAccounts,
    preInstructions: buildPreInstructions(options.draft.preInstructions),
    postInstructions: buildPostInstructions(options.draft.postInstructions),
    connection: options.connection,
    wallet: options.wallet,
  });
}

export async function sendPreparedExecutionDraft(options: {
  draft: PreparedExecutionDraft;
  connection: Connection;
  wallet: WalletContextState;
  onStatus?: (status: 'preparing' | 'simulating' | 'awaiting_wallet_approval' | 'submitting' | 'submitted' | 'confirming' | 'confirmed') => void;
  onSubmitted?: (payload: { signature: string; explorerUrl: string }) => void;
}) {
  if (!options.draft.instructionName) {
    throw new Error('Draft has no instructionName.');
  }

  return sendIdlInstruction({
    protocolId: options.draft.protocolId,
    instructionName: options.draft.instructionName,
    args: options.draft.args,
    accounts: options.draft.accounts,
    remainingAccounts: options.draft.remainingAccounts,
    preInstructions: buildPreInstructions(options.draft.preInstructions),
    postInstructions: buildPostInstructions(options.draft.postInstructions),
    connection: options.connection,
    wallet: options.wallet,
    onStatus: options.onStatus,
    onSubmitted: options.onSubmitted,
  });
}
