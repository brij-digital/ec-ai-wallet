import type { MetaOperationSummary } from '@agentform/apppack-runtime/metaIdlRuntime';
import { readBuilderPath } from './builderHelpers';

type JsonRecord = Record<string, unknown>;

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

export type AppUiEnhancement = {
  label: string;
  stepLabels: Record<string, string>;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asRequiredString(value: unknown, label: string): string {
  const parsed = asString(value);
  if (!parsed) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return parsed;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function parseInputUiHints(rawInputSpec: unknown, inputPath: string): InputUiHints {
  const inputSpec = asRecord(rawInputSpec);
  if (!inputSpec) {
    throw new Error(`${inputPath} must be an object.`);
  }
  const label = asRequiredString(inputSpec.label, `${inputPath}.label`);
  const placeholder = asString(inputSpec.placeholder);
  const help = asString(inputSpec.help);
  const group = asString(inputSpec.group);
  const displayOrder = asNumber(inputSpec.display_order);
  return {
    label,
    ...(placeholder ? { placeholder } : {}),
    ...(help ? { help } : {}),
    ...(group ? { group } : {}),
    ...(displayOrder !== undefined ? { displayOrder } : {}),
  };
}

function parseInputValidationHints(rawInputSpec: unknown): InputValidationHints {
  const inputSpec = asRecord(rawInputSpec);
  if (!inputSpec) {
    return {};
  }
  const rawValidate = asRecord(inputSpec.validate);
  if (!rawValidate) {
    return {};
  }
  const required = typeof rawValidate.required === 'boolean' ? rawValidate.required : undefined;
  const min =
    typeof rawValidate.min === 'string' || typeof rawValidate.min === 'number' ? rawValidate.min : undefined;
  const max =
    typeof rawValidate.max === 'string' || typeof rawValidate.max === 'number' ? rawValidate.max : undefined;
  const pattern = asString(rawValidate.pattern);
  const message = asString(rawValidate.message);
  return {
    ...(required !== undefined ? { required } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(pattern ? { pattern } : {}),
    ...(message ? { message } : {}),
  };
}

function parseCrossValidation(rawOperation: JsonRecord): CrossValidationRule[] {
  const rawValidate = asRecord(rawOperation.validate);
  if (!rawValidate || !Array.isArray(rawValidate.cross)) {
    return [];
  }
  const rules: CrossValidationRule[] = [];
  for (const rawRule of rawValidate.cross) {
    const rule = asRecord(rawRule);
    if (!rule) {
      continue;
    }
    const kind = asString(rule.kind);
    if (kind !== 'not_equal') {
      continue;
    }
    const left = asString(rule.left);
    const right = asString(rule.right);
    if (!left || !right) {
      continue;
    }
    const message = asString(rule.message);
    rules.push({
      kind: 'not_equal',
      left,
      right,
      ...(message ? { message } : {}),
    });
  }
  return rules;
}

export function extractOperationEnhancements(rawMeta: unknown): Record<string, OperationEnhancement> {
  const meta = asRecord(rawMeta);
  if (!meta) {
    throw new Error('meta must be an object.');
  }
  const operations = asRecord(meta.operations);
  if (!operations) {
    throw new Error('meta.operations must be an object.');
  }

  const output: Record<string, OperationEnhancement> = {};
  for (const [operationId, rawOperation] of Object.entries(operations)) {
    const operation = asRecord(rawOperation);
    if (!operation) {
      throw new Error(`operation ${operationId} must be an object.`);
    }
    const label = asRequiredString(operation.label, `operations.${operationId}.label`);
    const inputs = asRecord(operation.inputs);
    const inputUi: Record<string, InputUiHints> = {};
    const inputValidation: Record<string, InputValidationHints> = {};
    if (inputs) {
      for (const [inputName, rawInputSpec] of Object.entries(inputs)) {
        inputUi[inputName] = parseInputUiHints(rawInputSpec, `operations.${operationId}.inputs.${inputName}`);
        inputValidation[inputName] = parseInputValidationHints(rawInputSpec);
      }
    }

    output[operationId] = {
      label,
      inputUi,
      inputValidation,
      crossValidation: parseCrossValidation(operation),
    };
  }
  return output;
}

export function extractAppUiEnhancements(rawMeta: unknown): Record<string, AppUiEnhancement> {
  const meta = asRecord(rawMeta);
  if (!meta) {
    throw new Error('meta must be an object.');
  }
  const apps = asRecord(meta.apps);
  if (!apps) {
    throw new Error('meta.apps must be an object.');
  }
  const output: Record<string, AppUiEnhancement> = {};
  for (const [appId, rawApp] of Object.entries(apps)) {
    const app = asRecord(rawApp);
    if (!app) {
      throw new Error(`app ${appId} must be an object.`);
    }
    const stepLabels: Record<string, string> = {};
    if (Array.isArray(app.steps)) {
      for (const rawStep of app.steps) {
        const step = asRecord(rawStep);
        if (!step) {
          throw new Error(`app ${appId} step must be an object.`);
        }
        const stepId = asRequiredString(step.id, `apps.${appId}.steps[].id`);
        const stepLabel = asRequiredString(step.label, `apps.${appId}.steps[].label`);
        stepLabels[stepId] = stepLabel;
      }
    }
    const label = asRequiredString(app.label, `apps.${appId}.label`);
    output[appId] = {
      label,
      stepLabels,
    };
  }
  return output;
}

const rawMetaCache = new Map<string, Promise<unknown>>();

function resolveMetaPath(metaPath: string): string {
  return metaPath.startsWith('/') || /^https?:\/\//.test(metaPath) ? metaPath : `/${metaPath}`;
}

export async function loadRawMetaForProtocol(protocolId: string): Promise<unknown> {
  const cached = rawMetaCache.get(protocolId);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const { listIdlProtocols } = await import('@agentform/apppack-runtime/idlDeclarativeRuntime');
    const registry = await listIdlProtocols();
    const protocol = registry.protocols.find((entry) => entry.id === protocolId);
    if (!protocol || !protocol.metaPath) {
      throw new Error(`Meta IDL path not found for protocol ${protocolId}.`);
    }
    const response = await fetch(resolveMetaPath(protocol.metaPath));
    if (!response.ok) {
      throw new Error(`Failed to load raw meta IDL (${response.status}) for ${protocolId}.`);
    }
    return (await response.json()) as unknown;
  })();

  rawMetaCache.set(protocolId, promise);
  try {
    return await promise;
  } catch (error) {
    rawMetaCache.delete(protocolId);
    throw error;
  }
}

function parseIntegerLike(value: unknown): bigint | null {
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

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function stringifyComparable(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

function compareMinMax(value: unknown, threshold: string | number, direction: 'min' | 'max'): boolean | null {
  const intValue = parseIntegerLike(value);
  const intThreshold = parseIntegerLike(threshold);
  if (intValue !== null && intThreshold !== null) {
    return direction === 'min' ? intValue >= intThreshold : intValue <= intThreshold;
  }

  const numValue = parseFiniteNumber(value);
  const numThreshold = parseFiniteNumber(threshold);
  if (numValue !== null && numThreshold !== null) {
    return direction === 'min' ? numValue >= numThreshold : numValue <= numThreshold;
  }
  return null;
}

export function validateOperationInput(options: {
  operation: MetaOperationSummary;
  input: Record<string, unknown>;
  enhancement?: OperationEnhancement;
}): string[] {
  const { operation, input, enhancement } = options;
  const errors: string[] = [];
  const inputValidation = enhancement?.inputValidation ?? {};

  for (const [inputName, spec] of Object.entries(operation.inputs)) {
    const value = input[inputName];
    const rules = inputValidation[inputName] ?? {};
    const ruleMessage = rules.message;

    const isMissing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0);

    const requiredByRule = rules.required === true;
    const required = spec.required || requiredByRule;
    const hasDefault = spec.default !== undefined;
    const hasDiscover = typeof spec.discover_from === 'string' && spec.discover_from.length > 0;
    if (required && isMissing && !hasDefault && !hasDiscover) {
      errors.push(ruleMessage ?? `Missing required input ${inputName}.`);
      continue;
    }
    if (isMissing) {
      continue;
    }

    if (rules.pattern && typeof value === 'string') {
      try {
        const re = new RegExp(rules.pattern);
        if (!re.test(value)) {
          errors.push(ruleMessage ?? `Input ${inputName} does not match expected format.`);
          continue;
        }
      } catch {
        errors.push(`Invalid validation pattern for input ${inputName}.`);
        continue;
      }
    }

    if (rules.min !== undefined) {
      const valid = compareMinMax(value, rules.min, 'min');
      if (valid === false) {
        errors.push(ruleMessage ?? `Input ${inputName} must be >= ${String(rules.min)}.`);
        continue;
      }
    }
    if (rules.max !== undefined) {
      const valid = compareMinMax(value, rules.max, 'max');
      if (valid === false) {
        errors.push(ruleMessage ?? `Input ${inputName} must be <= ${String(rules.max)}.`);
        continue;
      }
    }
  }

  for (const rule of enhancement?.crossValidation ?? []) {
    if (rule.kind === 'not_equal') {
      const left = readBuilderPath({ input }, rule.left);
      const right = readBuilderPath({ input }, rule.right);
      if (left === undefined || right === undefined) {
        continue;
      }
      if (stringifyComparable(left) === stringifyComparable(right)) {
        errors.push(rule.message ?? `${rule.left} and ${rule.right} must be different.`);
      }
    }
  }

  return errors;
}
