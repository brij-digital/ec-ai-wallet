import type { Idl } from '@coral-xyz/anchor';
import type { Connection, PublicKey } from '@solana/web3.js';
import { runOrcaSwapQuoteCompute } from './protocols/orca/compute';

export type ComputeStepResolved = {
  name: string;
  compute: string;
  [key: string]: unknown;
};

export type ComputeInstructionPreview = {
  programId: string;
  dataBase64: string;
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
};

export type ComputeRuntimeContext = {
  protocolId: string;
  programId: string;
  connection: Connection;
  walletPublicKey: PublicKey;
  idl: Idl;
  scope: Record<string, unknown>;
  previewInstruction: (options: {
    instructionName: string;
    args: Record<string, unknown>;
    accounts: Record<string, string>;
  }) => Promise<ComputeInstructionPreview>;
};

type ComputeExecutor = (step: ComputeStepResolved, ctx: ComputeRuntimeContext) => Promise<unknown>;

const COMPUTE_EXECUTORS: Record<string, ComputeExecutor> = {
  orca_swap_quote: runOrcaSwapQuoteCompute,
};

export async function runRegisteredComputeStep(step: ComputeStepResolved, ctx: ComputeRuntimeContext): Promise<unknown> {
  const executor = COMPUTE_EXECUTORS[step.compute];
  if (!executor) {
    throw new Error(`Unsupported compute step: ${step.compute}`);
  }

  return executor(step, ctx);
}
