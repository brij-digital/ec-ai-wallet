// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { useBuilderController } from './useBuilderController';
import { useBuilderSubmitController } from './useBuilderSubmitController';
import {
  listIdlProtocols,
  simulateIdlInstruction,
} from '@agentform/apppack-runtime/idlDeclarativeRuntime';
import {
  listMetaApps,
  listMetaOperations,
  prepareMetaOperation,
} from '@agentform/apppack-runtime/metaIdlRuntime';

vi.mock('@agentform/apppack-runtime/idlDeclarativeRuntime', async () => {
  return {
    listIdlProtocols: vi.fn(),
    simulateIdlInstruction: vi.fn(),
    sendIdlInstruction: vi.fn(),
  };
});

vi.mock('@agentform/apppack-runtime/metaIdlRuntime', async () => {
  return {
    listMetaOperations: vi.fn(),
    listMetaApps: vi.fn(),
    prepareMetaOperation: vi.fn(),
  };
});

describe('useBuilderSubmitController', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listIdlProtocols).mockResolvedValue({
      protocols: [{ id: 'orca-whirlpool-mainnet', name: 'Orca', status: 'active' }],
    } as never);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('runs list_pools -> select item -> swap simulate in end-user app flow', async () => {
    vi.mocked(listIdlProtocols).mockResolvedValue({
      protocols: [{ id: 'orca-whirlpool-mainnet', name: 'Orca', status: 'active', metaPath: '/idl/orca.meta.json' }],
    } as never);

    vi.mocked(listMetaOperations).mockResolvedValue({
      operations: [
        {
          operationId: 'list_pools',
          label: 'List Pools',
          instruction: '',
          inputs: {
            token_in_mint: { type: 'pubkey', required: true, label: 'Token In' },
            token_out_mint: { type: 'pubkey', required: true, label: 'Token Out' },
          },
          readOutput: {
            source: '$derived.pool_candidates',
            summary: {
              mode: 'list',
              countLabel: 'pools found',
              itemLabelTemplate: '{item.whirlpool}',
            },
          },
        },
        {
          operationId: 'swap_exact_in',
          label: 'Swap Exact In',
          instruction: 'swap_v2',
          inputs: {
            amount_in: { type: 'u64', required: true, label: 'Amount In' },
          },
        },
      ],
    } as never);

    vi.mocked(listMetaApps).mockResolvedValue({
      apps: [
        {
          appId: 'discover_then_swap',
          label: 'Discover & Swap',
          title: 'Discover -> Swap',
          entryStepId: 'discover',
          steps: [
            {
              stepId: 'discover',
              label: 'Discover',
              operationId: 'list_pools',
              title: 'Discover pools',
              nextOnSuccess: 'swap',
              actions: [{ actionId: 'discover_run', kind: 'run', label: 'Find Pools', mode: 'view', variant: 'primary' }],
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
              label: 'Swap',
              operationId: 'swap_exact_in',
              title: 'Swap',
              actions: [{ actionId: 'swap_run', kind: 'run', label: 'Run Swap', mode: 'simulate', variant: 'primary' }],
              inputFrom: {
                pool: '$steps.discover.derived.selected_pool.whirlpool',
              },
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
    } as never);

    vi.mocked(prepareMetaOperation).mockResolvedValue({
      protocolId: 'orca-whirlpool-mainnet',
      instructionName: 'swap_v2',
      args: { amount: '1000' },
      accounts: { whirlpool: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE' },
      derived: {},
      postInstructions: [],
      remainingAccounts: undefined,
    } as never);

    vi.mocked(simulateIdlInstruction).mockResolvedValue({
      ok: true,
      unitsConsumed: 12345,
      error: null,
      logs: ['ok'],
    } as never);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/idl/orca.meta.core.json')) {
        return {
          ok: true,
          json: async () => ({
            label: 'Orca',
            operations: {
              list_pools: {
                label: 'List Pools',
                inputs: {
                  token_in_mint: { type: 'pubkey', label: 'Token In' },
                  token_out_mint: { type: 'pubkey', label: 'Token Out' },
                },
              },
              swap_exact_in: {
                label: 'Swap',
                inputs: {
                  amount_in: { type: 'u64', label: 'Amount In' },
                },
              },
            },
          }),
        } as Response;
      }
      if (url.includes('/idl/orca.app.json')) {
        return {
          ok: true,
          json: async () => ({
            apps: {
              discover_then_swap: {
                label: 'Discover & Swap',
                steps: [
                  {
                    id: 'discover',
                    label: 'Discover',
                    next_on_success: 'swap',
                  },
                  {
                    id: 'swap',
                    label: 'Swap',
                  },
                ],
              },
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            ok: true,
            items: [
              { whirlpool: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE' },
              { whirlpool: 'HVuJoW1px34PAEfc9uWUv7Lrh7Ta4uSoPrkztCcdwa21' },
            ],
          }),
      } as Response;
    }) as typeof fetch;

    const pushMessage = vi.fn();
    const setIsBuilderWorking = vi.fn();
    const wallet = {
      publicKey: new PublicKey('11111111111111111111111111111111'),
    } as never;
    const connection = {} as never;

    const { result } = renderHook(() => {
      const builder = useBuilderController();
      const submit = useBuilderSubmitController({
        connection,
        wallet,
        viewApiBaseUrl: 'https://example.com',
        pushMessage,
        setIsBuilderWorking,
        builderProtocolId: builder.builderProtocolId,
        selectedBuilderOperation: builder.selectedBuilderOperation,
        selectedBuilderOperationEnhancement: builder.selectedBuilderOperationEnhancement,
        builderInputValues: builder.builderInputValues,
        builderViewMode: builder.builderViewMode,
        selectedBuilderAppStep: builder.selectedBuilderAppStep,
        selectedBuilderApp: builder.selectedBuilderApp,
        builderAppStepIndex: builder.builderAppStepIndex,
        setBuilderAppStepCompleted: builder.setBuilderAppStepCompleted,
        clearBuilderAppProgressFrom: builder.clearBuilderAppProgressFrom,
        setBuilderStatusText: builder.setBuilderStatusText,
        setBuilderRawDetails: builder.setBuilderRawDetails,
        setBuilderShowRawDetails: builder.setBuilderShowRawDetails,
        applyBuilderAppStepResult: builder.applyBuilderAppStepResult,
        getBuilderStepStatusText: builder.getBuilderStepStatusText,
        setBuilderResult: builder.setBuilderResult,
        isBuilderAppMode: builder.isBuilderAppMode,
        builderAppSubmitMode: builder.builderAppSubmitMode,
        builderSimulate: builder.builderSimulate,
      });
      return { builder, submit };
    });

    await waitFor(() => {
      expect(result.current.builder.selectedBuilderOperation?.operationId).toBe('list_pools');
    });

    act(() => {
      result.current.builder.handleBuilderInputChange(
        'token_in_mint',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      );
      result.current.builder.handleBuilderInputChange(
        'token_out_mint',
        'So11111111111111111111111111111111111111112',
      );
    });

    await act(async () => {
      await result.current.submit.handleBuilderSubmit({
        preventDefault: () => undefined,
      } as never);
    });

    await waitFor(() => {
      expect(result.current.builder.selectedBuilderAppSelectableItems.length).toBe(2);
    });

    act(() => {
      const first = result.current.builder.selectedBuilderAppSelectableItems[0];
      result.current.builder.handleBuilderAppSelectItem(first);
    });

    await waitFor(() => {
      expect(result.current.builder.selectedBuilderOperation?.operationId).toBe('swap_exact_in');
    });

    act(() => {
      result.current.builder.handleBuilderInputChange('amount_in', '1000');
    });

    await act(async () => {
      await result.current.submit.handleBuilderSubmit({
        preventDefault: () => undefined,
      } as never);
    });

    await waitFor(() => {
      expect(result.current.builder.builderStatusText).toContain('Builder simulate');
      expect(result.current.builder.builderStatusText).toContain('status: success');
    });
  });

  it('returns a clear error when read_output.source cannot be resolved', async () => {
    vi.mocked(listMetaOperations).mockResolvedValue({
      operations: [
        {
          operationId: 'broken_read',
          label: 'Broken Read',
          instruction: '',
          inputs: {
            token_in_mint: { type: 'pubkey', required: true, label: 'Token In' },
            token_out_mint: { type: 'pubkey', required: true, label: 'Token Out' },
          },
          readOutput: {
            source: '$input.missing',
            summary: {
              mode: 'list',
              countLabel: 'items',
              itemLabelTemplate: '{item.whirlpool}',
            },
          },
        },
      ],
    } as never);

    vi.mocked(listMetaApps).mockResolvedValue({
      apps: [
        {
          appId: 'broken-read-app',
          label: 'Broken Read',
          title: 'Broken read',
          entryStepId: 'broken_step',
          steps: [
            {
              stepId: 'broken_step',
              label: 'Broken Step',
              operationId: 'broken_read',
              title: 'Broken step',
              actions: [{ actionId: 'broken_run', kind: 'run', label: 'Run', mode: 'view', variant: 'primary' }],
              inputFrom: {},
              transitions: [],
              blocking: { dependsOn: [], requiresPaths: [] },
              success: { kind: 'operation_ok' },
            },
          ],
        },
      ],
    } as never);

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            ok: true,
            items: [{ whirlpool: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE' }],
          }),
      } as Response;
    }) as typeof fetch;

    const pushMessage = vi.fn();
    const setIsBuilderWorking = vi.fn();
    const wallet = { publicKey: null } as never;
    const connection = {} as never;

    const { result } = renderHook(() => {
      const builder = useBuilderController();
      const submit = useBuilderSubmitController({
        connection,
        wallet,
        viewApiBaseUrl: 'https://example.com',
        pushMessage,
        setIsBuilderWorking,
        builderProtocolId: builder.builderProtocolId,
        selectedBuilderOperation: builder.selectedBuilderOperation,
        selectedBuilderOperationEnhancement: builder.selectedBuilderOperationEnhancement,
        builderInputValues: builder.builderInputValues,
        builderViewMode: builder.builderViewMode,
        selectedBuilderAppStep: builder.selectedBuilderAppStep,
        selectedBuilderApp: builder.selectedBuilderApp,
        builderAppStepIndex: builder.builderAppStepIndex,
        setBuilderAppStepCompleted: builder.setBuilderAppStepCompleted,
        clearBuilderAppProgressFrom: builder.clearBuilderAppProgressFrom,
        setBuilderStatusText: builder.setBuilderStatusText,
        setBuilderRawDetails: builder.setBuilderRawDetails,
        setBuilderShowRawDetails: builder.setBuilderShowRawDetails,
        applyBuilderAppStepResult: builder.applyBuilderAppStepResult,
        getBuilderStepStatusText: builder.getBuilderStepStatusText,
        setBuilderResult: builder.setBuilderResult,
        isBuilderAppMode: builder.isBuilderAppMode,
        builderAppSubmitMode: builder.builderAppSubmitMode,
        builderSimulate: builder.builderSimulate,
      });
      return { builder, submit };
    });

    await waitFor(() => {
      expect(result.current.builder.selectedBuilderOperation?.operationId).toBe('broken_read');
    });

    act(() => {
      result.current.builder.handleBuilderInputChange(
        'token_in_mint',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      );
      result.current.builder.handleBuilderInputChange(
        'token_out_mint',
        'So11111111111111111111111111111111111111112',
      );
    });

    await act(async () => {
      await result.current.submit.handleBuilderSubmit({
        preventDefault: () => undefined,
      } as never);
    });

    await waitFor(() => {
      expect(result.current.builder.builderStatusText).toContain('Unsupported read_output.source');
      expect(result.current.builder.builderStatusText).toContain('$input.missing');
    });
  });
});
