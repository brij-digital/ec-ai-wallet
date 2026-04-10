// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeOperationExplain, RuntimeOperationSummary, RuntimePack } from '@brij-digital/apppack-runtime/runtimeOperationRuntime';
import { ComputeDevTab } from './ComputeDevTab';

const runtimeMocks = vi.hoisted(() => ({
  listIdlProtocolsMock: vi.fn(),
  listRuntimeOperationsMock: vi.fn(),
  explainRuntimeOperationMock: vi.fn(),
  loadRuntimePackMock: vi.fn(),
}));

vi.mock('@brij-digital/apppack-runtime/codamaFacade', () => ({
  listIdlProtocols: runtimeMocks.listIdlProtocolsMock,
}));

vi.mock('@brij-digital/apppack-runtime/runtimeOperationRuntime', () => ({
  listRuntimeOperations: runtimeMocks.listRuntimeOperationsMock,
  explainRuntimeOperation: runtimeMocks.explainRuntimeOperationMock,
  loadRuntimePack: runtimeMocks.loadRuntimePackMock,
}));

function makeOperation(operationId: string): RuntimeOperationSummary {
  return {
    operationId,
    operationKind: 'write',
    executionKind: 'write',
    instruction: `${operationId}_ix`,
    inputs: {},
  };
}

function makeExplain(protocolId: string, operationId: string): RuntimeOperationExplain {
  return {
    protocolId,
    operationId,
    operationKind: 'write',
    instruction: `${operationId}_ix`,
    inputs: {},
    steps: [
      {
        phase: 'transform',
        step: {
          name: 'result',
          kind: 'math.add',
          values: ['1', '2'],
        },
        fragment: 'result = math.add(1, 2)',
      },
    ],
    args: {},
    accounts: {},
    pre: [],
    post: [],
    loadInstructionArgs: {},
    loadInstructionAccounts: {},
    remainingAccounts: [],
    output: undefined,
  };
}

function makePack(protocolId: string, transforms: Record<string, unknown[]> = {}): RuntimePack {
  return {
    schema: 'solana-agent-runtime.v1',
    protocolId,
    programId: `${protocolId}-program`,
    codamaPath: `/idl/${protocolId}.codama.json`,
    views: {},
    writes: {},
    transforms,
  };
}

describe('ComputeDevTab', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    runtimeMocks.listIdlProtocolsMock.mockResolvedValue({
      protocols: [
        { id: 'pump-mainnet', name: 'Pump', status: 'active' },
        { id: 'marinade-mainnet', name: 'Marinade', status: 'active' },
      ],
    });

    runtimeMocks.listRuntimeOperationsMock.mockImplementation(async ({ protocolId }: { protocolId: string }) => {
      if (protocolId === 'pump-mainnet') {
        return {
          protocolId,
          operations: [makeOperation('collect_reward_v2')],
        };
      }
      if (protocolId === 'marinade-mainnet') {
        return {
          protocolId,
          operations: [makeOperation('deposit_stake_account')],
        };
      }
      return { protocolId, operations: [] };
    });

    runtimeMocks.loadRuntimePackMock.mockImplementation(async (protocolId: string) => {
      if (protocolId === 'pump-mainnet') {
        return makePack(protocolId, {
          collect_reward_v2__helper: [{ name: 'result', kind: 'math.add', values: ['1', '2'] }],
        });
      }
      if (protocolId === 'marinade-mainnet') {
        return makePack(protocolId, {});
      }
      return makePack(protocolId, {});
    });

    runtimeMocks.explainRuntimeOperationMock.mockImplementation(async ({ protocolId, operationId }: { protocolId: string; operationId: string }) => {
      if (protocolId === 'pump-mainnet' && operationId === 'collect_reward_v2') {
        return makeExplain(protocolId, operationId);
      }
      if (protocolId === 'marinade-mainnet' && operationId === 'deposit_stake_account') {
        return makeExplain(protocolId, operationId);
      }
      throw new Error(`Operation ${operationId} not found in agent runtime pack for ${protocolId}.`);
    });
  });

  it('clears a stale operation when switching protocols', async () => {
    render(<ComputeDevTab isWorking={false} />);

    await screen.findByText('Runtime Pack');
    expect(await screen.findByDisplayValue('Writes (1)')).toBeTruthy();
    expect(await screen.findByDisplayValue('collect_reward_v2 (1 transform step)')).toBeTruthy();
    await screen.findByText(/function pump_mainnet_collect_reward_v2\(ctx\)/);

    runtimeMocks.explainRuntimeOperationMock.mockClear();

    fireEvent.change(screen.getByLabelText('Protocol'), {
      target: { value: 'marinade-mainnet' },
    });

    expect(await screen.findByDisplayValue('Writes (1)')).toBeTruthy();
    expect(await screen.findByDisplayValue('deposit_stake_account (1 transform step)')).toBeTruthy();
    await screen.findByText(/function marinade_mainnet_deposit_stake_account/);

    expect(
      runtimeMocks.explainRuntimeOperationMock.mock.calls.some(
        ([arg]) =>
          arg?.protocolId === 'marinade-mainnet'
          && arg?.operationId === 'collect_reward_v2',
      ),
    ).toBe(false);

    await waitFor(() => {
      expect(screen.queryByText(/Operation collect_reward_v2 not found in agent runtime pack for marinade-mainnet/)).toBeNull();
    });
  });

  it('shows named transforms alongside operations', async () => {
    render(<ComputeDevTab isWorking={false} />);

    await screen.findByText(/function pump_mainnet_collect_reward_v2\(ctx\)/);

    fireEvent.change(await screen.findByLabelText('Section'), {
      target: { value: 'transforms' },
    });

    expect(await screen.findByDisplayValue('Named Transforms (1)')).toBeTruthy();
    expect(await screen.findByDisplayValue('collect_reward_v2__helper (1 step)')).toBeTruthy();
    expect(await screen.findByText('Named Transform')).toBeTruthy();
    expect(await screen.findByText(/function pump_mainnet_collect_reward_v2__helper\(ctx\)/)).toBeTruthy();
  });
});
