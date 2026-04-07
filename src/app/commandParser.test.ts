import { describe, expect, it } from 'vitest';
import { parseCommand } from './commandParser';

describe('command parser', () => {
  it('requires explicit mode for /meta-run', () => {
    expect(() => parseCommand('/meta-run orca-whirlpool-mainnet swap_exact_in {"amount_in":"1000"}')).toThrow(
      'Usage: /meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> --simulate|--send',
    );
  });

  it('parses /meta-run --simulate', () => {
    const parsed = parseCommand('/meta-run orca-whirlpool-mainnet swap_exact_in {"amount_in":"1000"} --simulate');
    expect(parsed.kind).toBe('meta-run');
    if (parsed.kind !== 'meta-run') {
      return;
    }
    expect(parsed.value.protocolId).toBe('orca-whirlpool-mainnet');
    expect(parsed.value.operationId).toBe('swap_exact_in');
    expect(parsed.value.mode).toBe('simulate');
    expect(parsed.value.input).toEqual({ amount_in: '1000' });
  });

  it('parses /meta-run --send', () => {
    const parsed = parseCommand('/meta-run pump-amm-mainnet buy {"quote_amount_in":"1000"} --send');
    expect(parsed.kind).toBe('meta-run');
    if (parsed.kind !== 'meta-run') {
      return;
    }
    expect(parsed.value.mode).toBe('send');
    expect(parsed.value.protocolId).toBe('pump-amm-mainnet');
    expect(parsed.value.operationId).toBe('buy');
  });

  it('rejects malformed /meta-run payload', () => {
    expect(() => parseCommand('/meta-run orca-whirlpool-mainnet')).toThrow(
      'Usage: /meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> --simulate|--send',
    );
  });

  it('rejects removed /view-run command', () => {
    expect(() => parseCommand('/view-run orca-whirlpool-mainnet pools_index {"token_in_mint":"A"}')).toThrow(
      'Unknown command: /view-run. This mode is protocol-agnostic; use /idl-list or /help.',
    );
  });
});
