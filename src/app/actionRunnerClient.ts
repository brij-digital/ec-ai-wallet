import type { Connection, PublicKey } from '@solana/web3.js';
import { runActionRunner, type ActionRunnerResult, type ActionRunnerSpec } from '@brij-digital/apppack-runtime/actionRunner';
import {
  prepareRuntimeOperation,
  runRuntimeView,
} from '@brij-digital/apppack-runtime';

type RunnerRegistryEntry = {
  actionId: string;
  path: string;
};

type RunnerRegistry = {
  runners?: RunnerRegistryEntry[];
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status}).`);
  }
  return (await response.json()) as T;
}

export async function loadActionRunnerSpecs(): Promise<ActionRunnerSpec[]> {
  const registry = await readJson<RunnerRegistry>('/idl/action_runners.json');
  const specs = await Promise.all(
    (registry.runners ?? []).map(async (entry) => readJson<ActionRunnerSpec>(entry.path)),
  );
  return specs.sort((left, right) => left.title.localeCompare(right.title));
}

export async function runActionRunnerSpec(options: {
  spec: ActionRunnerSpec;
  input: Record<string, unknown>;
  connection: Connection;
  walletPublicKey: PublicKey | null;
}): Promise<ActionRunnerResult> {
  return runActionRunner({
    spec: options.spec,
    input: options.input,
    executeStep: async (step) => {
      if (!options.walletPublicKey) {
        throw new Error(`${step.kind} step ${step.id} requires a connected wallet.`);
      }

      if (step.kind === 'read') {
        const computed = await runRuntimeView({
          protocolId: step.protocolId,
          operationId: step.operationId,
          input: step.input,
          connection: options.connection,
          walletPublicKey: options.walletPublicKey,
        });
        return {
          output: computed.output,
          meta: {
            ...(computed.outputSpec ? { outputSpec: computed.outputSpec } : {}),
            derived: computed.derived,
            loadInstructionArgs: computed.loadInstructionArgs,
            loadInstructionAccounts: computed.loadInstructionAccounts,
            preInstructions: computed.preInstructions,
            postInstructions: computed.postInstructions,
          },
        };
      }

      if (step.kind !== 'write') {
        throw new Error(`Unsupported runner step kind ${step.kind}.`);
      }

      const prepared = await prepareRuntimeOperation({
        protocolId: step.protocolId,
        operationId: step.operationId,
        input: step.input,
        connection: options.connection,
        walletPublicKey: options.walletPublicKey,
      });
      return {
        output: prepared,
      };
    },
  });
}
