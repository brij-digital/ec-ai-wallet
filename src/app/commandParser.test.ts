import { describe, expect, it } from 'vitest';
import { parseCommand } from './commandParser';

describe('command parser', () => {
  it('parses /meta-run with default mode=auto', () => {
    const parsed = parseCommand('/meta-run orca-whirlpool-mainnet swap_exact_in {"amount_in":"1000"}');
    expect(parsed.kind).toBe('meta-run');
    if (parsed.kind !== 'meta-run') {
      return;
    }
    expect(parsed.value.protocolId).toBe('orca-whirlpool-mainnet');
    expect(parsed.value.operationId).toBe('swap_exact_in');
    expect(parsed.value.mode).toBe('auto');
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

  it('parses /meta-run --simulate', () => {
    const parsed = parseCommand('/meta-run pump-amm-mainnet buy {"quote_amount_in":"1000"} --simulate');
    expect(parsed.kind).toBe('meta-run');
    if (parsed.kind !== 'meta-run') {
      return;
    }
    expect(parsed.value.mode).toBe('simulate');
  });

  it('parses /view-run with JSON input', () => {
    const parsed = parseCommand('/view-run orca-whirlpool-mainnet list_pools {"token_in_mint":"A","token_out_mint":"B"}');
    expect(parsed.kind).toBe('view-run');
    if (parsed.kind !== 'view-run') {
      return;
    }
    expect(parsed.value.protocolId).toBe('orca-whirlpool-mainnet');
    expect(parsed.value.operationId).toBe('list_pools');
    expect(parsed.value.input).toEqual({ token_in_mint: 'A', token_out_mint: 'B' });
  });

  it('rejects malformed /meta-run payload', () => {
    expect(() => parseCommand('/meta-run orca-whirlpool-mainnet')).toThrow(
      'Usage: /meta-run <PROTOCOL_ID> <OPERATION_ID> <INPUT_JSON> [--simulate|--send]',
    );
  });

  it('rejects malformed /view-run JSON', () => {
    expect(() => parseCommand('/view-run orca-whirlpool-mainnet list_pools {bad-json}')).toThrow(
      'Invalid input JSON.',
    );
  });
});
