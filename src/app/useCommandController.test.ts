// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCommandController } from './useCommandController';

vi.mock('@brij-digital/apppack-runtime/idlDeclarativeRuntime', async () => {
  return {
    listIdlProtocols: vi.fn(),
    getInstructionTemplate: vi.fn(),
    decodeIdlAccount: vi.fn(),
    simulateIdlInstruction: vi.fn(),
    sendIdlInstruction: vi.fn(),
  };
});

vi.mock('@brij-digital/apppack-runtime/appSpecRuntime', async () => {
  return {
    explainAppOperation: vi.fn(),
    listAppOperations: vi.fn(),
    prepareAppOperation: vi.fn(),
  };
});

describe('useCommandController', () => {
  const connection = {} as never;
  const wallet = { publicKey: null } as never;

  it('starts with a default assistant message', () => {
    const { result } = renderHook(() =>
      useCommandController({
        connection,
        wallet,
        supportedTokens: 'SOL (So111...)',
        viewApiBaseUrl: 'https://example.com',
        defaultViewApiBaseUrl: 'https://example.com',
      }),
    );

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.text).toContain('Use /help');
  });

  it('handles /help and appends supported tokens', async () => {
    const { result } = renderHook(() =>
      useCommandController({
        connection,
        wallet,
        supportedTokens: 'SOL (So111...)',
        viewApiBaseUrl: 'https://example.com',
        defaultViewApiBaseUrl: 'https://example.com',
      }),
    );

    act(() => {
      result.current.setCommandInput('/help');
    });

    await act(async () => {
      await result.current.handleCommandSubmit({
        preventDefault: () => undefined,
      } as never);
    });

    expect(result.current.messages).toHaveLength(3);
    expect(result.current.messages[1]?.role).toBe('user');
    expect(result.current.messages[1]?.text).toBe('/help');
    expect(result.current.messages[2]?.text).toContain('Supported tokens: SOL (So111...)');
    expect(result.current.isWorking).toBe(false);
  });
});
