import type { Connection, PublicKey } from '@solana/web3.js';
import {
  prepareRuntimeOperation,
  runActionRunner,
  runRuntimeView,
  type ActionRunnerResult,
  type ActionRunnerSpec,
} from '@brij-digital/apppack-runtime';

type RunnerRegistryEntry = {
  actionId: string;
  path: string;
};

type RunnerRegistry = {
  runners?: RunnerRegistryEntry[];
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
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
  viewApiBaseUrl: string;
  connection: Connection;
  walletPublicKey: PublicKey | null;
}): Promise<ActionRunnerResult> {
  const trimmedBaseUrl = options.viewApiBaseUrl.trim().replace(/\/+$/, '');
  return runActionRunner({
    spec: options.spec,
    input: options.input,
    executeStep: async (step) => {
      if (step.kind === 'index_view') {
        const response = await fetch(`${trimmedBaseUrl}/view-run`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            protocol_id: step.protocolId,
            operation_id: step.operationId,
            input: step.input,
            ...(typeof step.limit === 'number' ? { limit: step.limit } : {}),
          }),
        });
        const parsed = (await response.json()) as {
          ok?: boolean;
          items?: unknown[];
          meta?: Record<string, unknown>;
          error?: string;
        };
        if (!response.ok || !parsed.ok) {
          throw new Error(parsed.error ?? `Index view failed for ${step.protocolId}/${step.operationId}.`);
        }
        const output = step.limit === 1 ? (parsed.items?.[0] ?? null) : (parsed.items ?? []);
        return {
          output,
          meta: parsed.meta ?? {},
        };
      }

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
