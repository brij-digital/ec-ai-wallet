import { describe, expect, it } from 'vitest';
import type { MetaAppSummary } from '@agentform/apppack-runtime/metaIdlRuntime';
import {
  isBuilderAppStepUnlocked,
  type BuilderAppStepContext,
} from './builderHelpers';

function createStepContext(derived: Record<string, unknown>): BuilderAppStepContext {
  return {
    input: {},
    derived,
    args: {},
    accounts: {},
    instructionName: null,
  };
}

const app: MetaAppSummary = {
  appId: 'discover_then_swap',
  label: 'Discover & Swap',
  title: 'Discover -> Swap',
  entryStepId: 'discover',
  steps: [
    {
      stepId: 'discover',
      label: 'Discover',
      operationId: 'list_pools',
      title: 'Discover',
      actions: [{ label: 'Find Pools', do: { fn: 'run', mode: 'view' } }],
      statusText: {
        running: 'Discovering...',
        success: 'Discover success',
        error: 'Discover failed',
      },
      inputFrom: {},
      requiresPaths: [],
    },
    {
      stepId: 'swap',
      label: 'Swap',
      operationId: 'swap_exact_in',
      title: 'Swap',
      actions: [{ label: 'Run Swap', do: { fn: 'run', mode: 'simulate' } }],
      statusText: {
        running: 'Swapping...',
        success: 'Swap success',
        error: 'Swap failed',
      },
      inputFrom: {},
      requiresPaths: ['$steps.discover.derived.selected_pool.pool'],
    },
  ],
};

describe('builder app step transitions and unlock rules', () => {
  it('entry step is unlocked by default', () => {
    expect(isBuilderAppStepUnlocked(app, app.steps[0]!, {}, {})).toBe(true);
  });

  it('dependent step stays locked until required paths are satisfied', () => {
    const swapStep = app.steps[1]!;
    expect(isBuilderAppStepUnlocked(app, swapStep, {}, {})).toBe(false);

    const completedOnly = { discover: true };
    expect(isBuilderAppStepUnlocked(app, swapStep, {}, completedOnly)).toBe(false);

    const contextsWithSelection = {
      discover: createStepContext({
        selected_pool: {
          pool: 'pool_pubkey',
        },
      }),
    };
    expect(isBuilderAppStepUnlocked(app, swapStep, contextsWithSelection, completedOnly)).toBe(true);
  });
});
