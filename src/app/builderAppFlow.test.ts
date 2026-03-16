import { describe, expect, it } from 'vitest';
import type { MetaAppSummary } from '@agentform/apppack-runtime/metaIdlRuntime';
import {
  evaluateBuilderStepSuccess,
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
  title: 'Discover -> Swap',
  entryStepId: 'discover',
  steps: [
    {
      stepId: 'discover',
      operationId: 'list_pools',
      title: 'Discover',
      inputFrom: {},
      transitions: [{ on: 'success', to: 'swap' }],
      blocking: {
        dependsOn: [],
        requiresPaths: [],
      },
      success: {
        kind: 'operation_ok',
      },
    },
    {
      stepId: 'swap',
      operationId: 'swap_exact_in',
      title: 'Swap',
      inputFrom: {},
      transitions: [],
      blocking: {
        dependsOn: ['discover'],
        requiresPaths: ['$steps.discover.derived.selected_pool.pool'],
      },
      success: {
        kind: 'path_truthy',
        path: '$steps.discover.derived.selected_pool.pool',
      },
    },
  ],
};

describe('builder app step transitions and unlock rules', () => {
  it('entry step is unlocked by default', () => {
    expect(isBuilderAppStepUnlocked(app, app.steps[0]!, {}, {})).toBe(true);
  });

  it('dependent step stays locked until dependency and required paths are satisfied', () => {
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

  it('evaluates operation_ok and path_truthy success kinds', () => {
    const discoverStep = app.steps[0]!;
    const swapStep = app.steps[1]!;

    expect(evaluateBuilderStepSuccess(discoverStep, {}, true)).toBe(true);
    expect(evaluateBuilderStepSuccess(discoverStep, {}, false)).toBe(false);

    const contexts = {
      discover: createStepContext({
        selected_pool: {
          pool: 'pool_pubkey',
        },
      }),
    };
    expect(evaluateBuilderStepSuccess(swapStep, contexts, true)).toBe(true);
  });
});
