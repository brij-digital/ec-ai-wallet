// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBuilderController } from './useBuilderController';
import { listIdlProtocols } from '@agentform/apppack-runtime/idlDeclarativeRuntime';

vi.mock('@agentform/apppack-runtime/idlDeclarativeRuntime', async () => {
  return {
    listIdlProtocols: vi.fn(async () => ({
      protocols: [{ id: 'orca-whirlpool-mainnet', name: 'Orca', status: 'active' }],
    })),
  };
});

vi.mock('@agentform/apppack-runtime/metaIdlRuntime', async () => {
  return {
    listMetaOperations: vi.fn(async () => ({
      operations: [
        {
          operationId: 'list_pools',
          instruction: '',
          inputs: {
            token_in_mint: { type: 'pubkey', required: true },
            token_out_mint: { type: 'pubkey', required: true },
          },
        },
        {
          operationId: 'swap_exact_in',
          instruction: 'swap_v2',
          inputs: {
            amount_in: { type: 'u64', required: true },
          },
        },
      ],
    })),
    listMetaApps: vi.fn(async () => ({
      apps: [
        {
          appId: 'discover_then_swap',
          title: 'Discover -> Swap',
          entryStepId: 'discover',
          steps: [
            {
              stepId: 'discover',
              operationId: 'list_pools',
              title: 'Discover Pools',
              inputFrom: {},
              transitions: [{ on: 'success', to: 'swap' }],
              blocking: { dependsOn: [], requiresPaths: [] },
              success: { kind: 'operation_ok' },
              ui: {
                kind: 'select_from_derived',
                source: 'pool_candidates',
                bindTo: 'selected_pool',
                valuePath: 'whirlpool',
                labelFields: ['whirlpool'],
                requireSelection: true,
                autoAdvance: true,
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
                requiresPaths: ['$steps.discover.derived.selected_pool.whirlpool'],
              },
              success: { kind: 'operation_ok' },
            },
          ],
        },
      ],
    })),
    explainMetaOperation: vi.fn(),
    prepareMetaOperation: vi.fn(),
  };
});

describe('useBuilderController', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('loads protocol/app and starts on entry step operation', async () => {
    const { result } = renderHook(() => useBuilderController());

    await waitFor(() => {
      expect(result.current.builderProtocols.length).toBe(1);
      expect(result.current.builderProtocolId).toBe('orca-whirlpool-mainnet');
    });

    await waitFor(() => {
      expect(result.current.builderApps.length).toBe(1);
      expect(result.current.selectedBuilderAppStep?.stepId).toBe('discover');
      expect(result.current.selectedBuilderOperation?.operationId).toBe('list_pools');
    });
  });

  it('unlocks next step when dependency completion + selected pool path are satisfied', async () => {
    const { result } = renderHook(() => useBuilderController());

    await waitFor(() => {
      expect(result.current.selectedBuilderAppStep?.stepId).toBe('discover');
    });

    expect(result.current.canOpenBuilderAppStep(1)).toBe(false);

    act(() => {
      result.current.setBuilderAppStepContexts({
        discover: {
          input: {},
          derived: {
            selected_pool: {
              whirlpool: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE',
            },
          },
          args: {},
          accounts: {},
          instructionName: null,
        },
      });
      result.current.setBuilderAppStepCompleted({ discover: true });
    });

    await waitFor(() => {
      expect(result.current.canOpenBuilderAppStep(1)).toBe(true);
    });
  });

  it('loads step actions from raw app meta', async () => {
    vi.mocked(listIdlProtocols).mockResolvedValue({
      protocols: [{ id: 'orca-whirlpool-mainnet', name: 'Orca', status: 'active', metaPath: '/idl/orca.meta.json' }],
    } as never);
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          apps: {
            discover_then_swap: {
              steps: [
                {
                  id: 'discover',
                  actions: [
                    { id: 'discover_run', kind: 'run', label: 'Find Pools', mode: 'view', variant: 'primary' },
                  ],
                },
              ],
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const { result } = renderHook(() => useBuilderController());

    await waitFor(() => {
      expect(result.current.selectedBuilderStepActions).toEqual([
        {
          actionId: 'discover_run',
          kind: 'run',
          label: 'Find Pools',
          mode: 'view',
          variant: 'primary',
        },
      ]);
    });
  });

  it('prefill uses declared ui_example values from raw meta operations', async () => {
    vi.mocked(listIdlProtocols).mockResolvedValue({
      protocols: [{ id: 'orca-whirlpool-mainnet', name: 'Orca', status: 'active', metaPath: '/idl/orca.meta.json' }],
    } as never);
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          operations: {
            list_pools: {
              inputs: {
                token_in_mint: { type: 'pubkey', required: true, ui_example: 'USDC_EXAMPLE' },
                token_out_mint: { type: 'pubkey', required: true, ui_example: 'SOL_EXAMPLE' },
              },
            },
          },
          apps: {
            discover_then_swap: {
              steps: [
                {
                  id: 'discover',
                  actions: [{ id: 'discover_run', kind: 'run', label: 'Find Pools', mode: 'view' }],
                },
              ],
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const { result } = renderHook(() => useBuilderController());

    await waitFor(() => {
      expect(result.current.selectedBuilderOperation?.operationId).toBe('list_pools');
    });

    act(() => {
      result.current.handleBuilderPrefillExample();
    });

    expect(result.current.builderInputValues.token_in_mint).toBe('USDC_EXAMPLE');
    expect(result.current.builderInputValues.token_out_mint).toBe('SOL_EXAMPLE');
  });

  it('prefers declarative labels from raw meta when provided', async () => {
    vi.mocked(listIdlProtocols).mockResolvedValue({
      protocols: [{ id: 'orca-whirlpool-mainnet', name: 'Orca', status: 'active', metaPath: '/idl/orca.meta.json' }],
    } as never);
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          label: 'Orca Whirlpool',
          operations: {
            list_pools: {
              label: 'List Pools',
              inputs: {
                token_in_mint: { type: 'token_mint', label: 'Token In', display_order: 2 },
                token_out_mint: { type: 'token_mint', label: 'Token Out', display_order: 1 },
              },
            },
          },
          apps: {
            discover_then_swap: {
              label: 'Discover & Swap',
              steps: [{ id: 'discover', label: 'Discover Pools' }],
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const { result } = renderHook(() => useBuilderController());

    await waitFor(() => {
      expect(result.current.builderProtocolLabelsById['orca-whirlpool-mainnet']).toBe('Orca Whirlpool');
      expect(result.current.builderOperationLabelsByOperationId.list_pools).toBe('List Pools');
      expect(result.current.builderAppLabelsByAppId.discover_then_swap).toBe('Discover & Swap');
      expect(result.current.builderStepLabelsByAppStepKey['discover_then_swap:discover']).toBe('Discover Pools');
    });

    expect(result.current.visibleBuilderInputs.map(([name]) => name)).toEqual(['token_out_mint', 'token_in_mint']);
  });
});
