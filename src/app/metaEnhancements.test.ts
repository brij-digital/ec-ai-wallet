import { describe, expect, it } from 'vitest';
import type { MetaOperationSummary } from '@agentform/apppack-runtime/metaIdlRuntime';
import { extractOperationEnhancements, validateOperationInput } from './metaEnhancements';

function operationWithInputs(inputs: MetaOperationSummary['inputs']): MetaOperationSummary {
  return {
    operationId: 'test_op',
    instruction: 'test_ix',
    inputs,
  };
}

describe('extractOperationEnhancements', () => {
  it('extracts labels and input ui hints', () => {
    const enhancements = extractOperationEnhancements({
      operations: {
        list_pools: {
          label: 'List Pools',
          inputs: {
            token_in_mint: {
              type: 'token_mint',
              label: 'Token In',
              placeholder: 'USDC',
              help: 'Pick input token',
              group: 'market',
              display_order: 1,
            },
          },
        },
      },
    });
    expect(enhancements.list_pools?.label).toBe('List Pools');
    expect(enhancements.list_pools?.inputUi.token_in_mint).toEqual({
      label: 'Token In',
      placeholder: 'USDC',
      help: 'Pick input token',
      group: 'market',
      displayOrder: 1,
    });
  });

  it('throws when operation/input labels are missing in strict mode', () => {
    expect(() =>
      extractOperationEnhancements({
        operations: {
          list_pools: {
            inputs: {
              token_in_mint: { type: 'token_mint' },
            },
          },
        },
      }),
    ).toThrow(/label/);
  });
});

describe('validateOperationInput', () => {
  it('enforces per-input min/max/pattern rules', () => {
    const operation = operationWithInputs({
      amount_in: { type: 'u64', required: true },
      slippage_bps: { type: 'u16', required: true },
    });
    const errors = validateOperationInput({
      operation,
      input: {
        amount_in: '0',
        slippage_bps: '5001',
      },
      enhancement: {
        label: 'Swap',
        inputUi: {},
        inputValidation: {
          amount_in: { min: '1', message: 'amount_in must be > 0' },
          slippage_bps: { min: 0, max: 5000 },
        },
        crossValidation: [],
      },
    });
    expect(errors[0]).toContain('amount_in');
  });

  it('enforces cross rule not_equal', () => {
    const operation = operationWithInputs({
      token_in_mint: { type: 'token_mint', required: true },
      token_out_mint: { type: 'token_mint', required: true },
    });
    const errors = validateOperationInput({
      operation,
      input: {
        token_in_mint: 'A',
        token_out_mint: 'A',
      },
      enhancement: {
        label: 'Swap',
        inputUi: {},
        inputValidation: {},
        crossValidation: [
          {
            kind: 'not_equal',
            left: '$input.token_in_mint',
            right: '$input.token_out_mint',
            message: 'token_in/token_out must differ',
          },
        ],
      },
    });
    expect(errors).toContain('token_in/token_out must differ');
  });
});
