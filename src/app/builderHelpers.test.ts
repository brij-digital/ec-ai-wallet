import { describe, expect, it } from 'vitest';
import type { MetaOperationSummary } from '@brij-digital/apppack-runtime/metaIdlRuntime';
import { buildDerivedFromReadOutputSource, buildExampleInputsForOperation } from './builderHelpers';

function opWithInputs(inputs: MetaOperationSummary['inputs']): MetaOperationSummary {
  return {
    operationId: 'test_op',
    instruction: 'test_ix',
    executionKind: 'write',
    inputs,
  };
}

describe('buildExampleInputsForOperation', () => {
  it('prefers default over example fields', () => {
    const operation = opWithInputs({
      amount: {
        type: 'u64',
        required: true,
        default: '42',
      },
      slippage_bps: {
        type: 'u16',
        required: true,
        ...( { ui_example: '50', example: '100' } as Record<string, unknown>),
      },
    });

    const values = buildExampleInputsForOperation(operation);
    expect(values.amount).toBe('42');
    expect(values.slippage_bps).toBe('50');
  });

  it('falls back by type when no defaults/examples exist', () => {
    const operation = opWithInputs({
      track_volume: {
        type: 'bool',
        required: false,
      },
      amount_in: {
        type: 'u64',
        required: true,
      },
      price: {
        type: 'f64',
        required: false,
      },
      token_mint: {
        type: 'pubkey',
        required: true,
      },
    });

    const values = buildExampleInputsForOperation(operation);
    expect(values.track_volume).toBe('true');
    expect(values.amount_in).toBe('1');
    expect(values.price).toBe('0.1');
    expect(values.token_mint).toBe('');
  });

  it('does not prefill computed readonly fields from read_from', () => {
    const operation = opWithInputs({
      min_tokens_out: {
        type: 'u64',
        required: false,
        read_from: '$derived.min_tokens_out_auto',
        ui_mode: 'readonly',
      } as MetaOperationSummary['inputs'][string],
      slippage_bps: {
        type: 'u16',
        required: true,
      },
    });

    const values = buildExampleInputsForOperation(operation);
    expect(values.min_tokens_out).toBe('');
    expect(values.slippage_bps).toBe('1');
  });
});

describe('buildDerivedFromReadOutputSource', () => {
  it('maps $derived paths from read output payload', () => {
    const derived = buildDerivedFromReadOutputSource('$derived.pool_candidates', [{ whirlpool: 'abc' }]);
    expect(derived).toEqual({
      pool_candidates: [{ whirlpool: 'abc' }],
    });
  });

  it('rejects non-derived source roots', () => {
    expect(() => buildDerivedFromReadOutputSource('$input.anything', 1)).toThrow(
      'Unsupported read_output.source $input.anything: only $derived.* is supported in Builder remote view mode.',
    );
  });
});
