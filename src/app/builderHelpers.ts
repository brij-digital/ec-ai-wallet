import type {
  RuntimeOperationExplain,
  RuntimeOperationSummary,
} from '@brij-digital/apppack-runtime/runtimeOperationRuntime';
import { resolveToken } from '../constants/tokens';

export function stringifyBuilderDefault(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function readBuilderPath(value: unknown, path: string): unknown {
  const cleaned = path.startsWith('$') ? path.slice(1) : path;
  const parts = cleaned.split('.').filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function getBuilderInputMode(
  _spec: RuntimeOperationSummary['inputs'][string],
): 'edit' | 'readonly' {
  return 'edit';
}

export function isBuilderInputEditable(spec: RuntimeOperationSummary['inputs'][string]): boolean {
  return getBuilderInputMode(spec) === 'edit';
}

export function parseBuilderInputValue(raw: string, type: string, label: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalizedType = type.toLowerCase();
  if (normalizedType === 'bool' || normalizedType === 'boolean') {
    if (trimmed === 'true') {
      return true;
    }
    if (trimmed === 'false') {
      return false;
    }
    throw new Error(`${label} must be true or false.`);
  }

  if (/^[ui]\d+$/.test(normalizedType)) {
    if (!/^-?\d+$/.test(trimmed)) {
      throw new Error(`${label} must be an integer.`);
    }
    return trimmed;
  }

  if (normalizedType === 'f32' || normalizedType === 'f64' || normalizedType === 'number') {
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be a finite number.`);
    }
    return value;
  }

  if (normalizedType === 'token_mint') {
    const token = resolveToken(trimmed);
    return token?.mint ?? trimmed;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error(`${label} must be valid JSON.`);
    }
  }

  if (trimmed === 'null') {
    return null;
  }

  return trimmed;
}

export function buildExampleInputsForOperation(
  operation: RuntimeOperationSummary,
): Record<string, string> {
  const nextValues: Record<string, string> = {};

  for (const [inputName, spec] of Object.entries(operation.inputs)) {
    if (spec.default !== undefined) {
      nextValues[inputName] = stringifyBuilderDefault(spec.default);
      continue;
    }
    nextValues[inputName] = '';
  }

  return nextValues;
}

export function buildReadOnlyHighlightsFromSpec(
  readOutput: RuntimeOperationSummary['readOutput'] | RuntimeOperationExplain['readOutput'] | undefined,
  value: unknown,
): string[] {
  if (!readOutput) {
    return [];
  }

  const lines = [
    `read_output.type: ${readOutput.type}`,
    `read_output.source: ${readOutput.source}`,
  ];

  if (readOutput.type === 'array' && Array.isArray(value)) {
    lines.push(`items: ${value.length}`);
    return lines;
  }

  if (readOutput.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    lines.push(`keys: ${Object.keys(value as Record<string, unknown>).join(', ') || '(none)'}`);
    return lines;
  }

  if (readOutput.type === 'scalar') {
    lines.push(`value: ${String(value)}`);
  }

  return lines;
}

export function asPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function buildDerivedFromReadOutputSource(sourcePath: string, value: unknown): Record<string, unknown> {
  const cleaned = sourcePath.startsWith('$') ? sourcePath.slice(1) : sourcePath;
  if (!cleaned.startsWith('derived')) {
    throw new Error(`Unsupported read_output.source ${sourcePath}: only $derived.* is supported in Builder remote view mode.`);
  }

  if (cleaned === 'derived') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`read_output.source ${sourcePath} resolved to non-object; expected object for $derived root.`);
    }
    return value as Record<string, unknown>;
  }

  const parts = cleaned.split('.').filter(Boolean);
  if (parts[0] !== 'derived' || parts.length < 2) {
    throw new Error(`Unsupported read_output.source ${sourcePath}: expected $derived.<name>.`);
  }

  const out: Record<string, unknown> = {};
  let current: Record<string, unknown> = out;
  const relative = parts.slice(1);
  for (let i = 0; i < relative.length - 1; i += 1) {
    const key = relative[i]!;
    current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[relative[relative.length - 1]!] = value;
  return out;
}

export function renderMetaExplain(explanation: RuntimeOperationExplain): string {
  const formatRequired = (spec: Record<string, unknown>): string => {
    const required = spec.required === false ? 'optional' : 'required';
    const defaultText = spec.default !== undefined ? `, default=${JSON.stringify(spec.default)}` : '';
    return `${required}${defaultText}`;
  };

  const inputLines = Object.entries(explanation.inputs).map(
    ([name, spec]) => `- ${name}: ${String(spec.type ?? 'unknown')} (${formatRequired(spec as Record<string, unknown>)})`,
  );

  const deriveLines = explanation.derive.map((step, index) => {
    const record = step && typeof step === 'object' && !Array.isArray(step) ? (step as Record<string, unknown>) : {};
    return `${index + 1}. ${String(record.name ?? `step_${index + 1}`)} -> ${String(record.resolver ?? 'unknown')}`;
  });
  const computeLines = explanation.compute.map((step, index) => {
    const record = step && typeof step === 'object' && !Array.isArray(step) ? (step as Record<string, unknown>) : {};
    return `${index + 1}. ${String(record.name ?? `step_${index + 1}`)} -> ${String(record.compute ?? 'unknown')}`;
  });

  return [
    `Runtime operation: ${explanation.protocolId}/${explanation.operationId}`,
    `instruction: ${explanation.instruction || 'read-only'}`,
    '',
    'Inputs:',
    ...(inputLines.length > 0 ? inputLines : ['- none']),
    '',
    'Derive:',
    ...(deriveLines.length > 0 ? deriveLines : ['- none']),
    '',
    'Compute:',
    ...(computeLines.length > 0 ? computeLines : ['- none']),
    '',
    'Raw:',
    asPrettyJson(explanation),
  ].join('\n');
}
