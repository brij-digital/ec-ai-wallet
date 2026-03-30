import type { RuntimeOperationSummary } from '@brij-digital/apppack-runtime/runtimeOperationRuntime';
import { readBuilderPath } from './builderHelpers';

export type InputUiHints = {
  label: string;
  placeholder?: string;
  help?: string;
  group?: string;
  displayOrder?: number;
};

export type InputValidationHints = {
  required?: boolean;
  min?: string | number;
  max?: string | number;
  pattern?: string;
  message?: string;
};

export type CrossValidationRule = {
  kind: 'not_equal';
  left: string;
  right: string;
  message?: string;
};

export type OperationEnhancement = {
  label: string;
  inputUi: Record<string, InputUiHints>;
  inputValidation: Record<string, InputValidationHints>;
  crossValidation: CrossValidationRule[];
};

function asIntegerLike(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return null;
}

export function buildOperationEnhancementFromSummary(
  operation: RuntimeOperationSummary,
): OperationEnhancement {
  const inputUi: OperationEnhancement['inputUi'] = {};
  const inputValidation: OperationEnhancement['inputValidation'] = {};

  for (const [inputName, inputSpec] of Object.entries(operation.inputs)) {
    inputUi[inputName] = {
      label: inputName,
    };

    inputValidation[inputName] = {
      ...(typeof inputSpec.required === 'boolean' ? { required: inputSpec.required } : {}),
      ...(inputSpec.validate?.min !== undefined ? { min: inputSpec.validate.min } : {}),
      ...(inputSpec.validate?.max !== undefined ? { max: inputSpec.validate.max } : {}),
      ...(typeof inputSpec.validate?.pattern === 'string' ? { pattern: inputSpec.validate.pattern } : {}),
      ...(typeof inputSpec.validate?.message === 'string' ? { message: inputSpec.validate.message } : {}),
    };
  }

  return {
    label: operation.operationId,
    inputUi,
    inputValidation,
    crossValidation: operation.crossValidation ?? [],
  };
}

function validatePattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

export function validateOperationInput(options: {
  operation: RuntimeOperationSummary;
  input: Record<string, unknown>;
  enhancement?: OperationEnhancement;
}): string[] {
  const errors: string[] = [];
  const inputUi = options.enhancement?.inputUi ?? {};
  const inputValidation = options.enhancement?.inputValidation ?? {};

  for (const [inputName, inputSpec] of Object.entries(options.operation.inputs)) {
    const label = inputUi[inputName]?.label ?? inputName;
    const value = options.input[inputName];
    const validate = inputValidation[inputName] ?? {};

    if ((inputSpec.required || validate.required) && (value === undefined || value === null || value === '')) {
      errors.push(`${label} is required.`);
      continue;
    }

    if (value === undefined || value === null || value === '') {
      continue;
    }

    if (validate.pattern && typeof value === 'string' && !validatePattern(value, validate.pattern)) {
      errors.push(validate.message ?? `${label} does not match the required format.`);
    }

    const integerLike = asIntegerLike(value);
    const min = asIntegerLike(validate.min);
    const max = asIntegerLike(validate.max);
    if (integerLike !== null && min !== null && integerLike < min) {
      errors.push(validate.message ?? `${label} must be >= ${String(validate.min)}.`);
    }
    if (integerLike !== null && max !== null && integerLike > max) {
      errors.push(validate.message ?? `${label} must be <= ${String(validate.max)}.`);
    }
  }

  for (const rule of options.enhancement?.crossValidation ?? []) {
    if (rule.kind !== 'not_equal') {
      continue;
    }
    const left = readBuilderPath({ input: options.input }, rule.left);
    const right = readBuilderPath({ input: options.input }, rule.right);
    if (left !== undefined && right !== undefined && JSON.stringify(left) === JSON.stringify(right)) {
      errors.push(rule.message ?? `${rule.left} and ${rule.right} must be different.`);
    }
  }

  return errors;
}
