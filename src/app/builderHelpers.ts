import type {
  RuntimeOperationExplain,
  RuntimeOperationSummary,
} from '@brij-digital/apppack-runtime/runtimeOperationRuntime';
import { resolveToken } from '../constants/tokens';

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
    void spec;
    nextValues[inputName] = '';
  }

  return nextValues;
}

export function buildReadOnlyHighlightsFromSpec(
  output: RuntimeOperationSummary['output'] | RuntimeOperationExplain['output'] | undefined,
  value: unknown,
): string[] {
  if (!output) {
    return [];
  }

  const lines = [
    `output.type: ${output.type}`,
    `output.source: ${output.source}`,
  ];

  if (output.type === 'array' && Array.isArray(value)) {
    lines.push(`items: ${value.length}`);
    return lines;
  }

  if (output.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    lines.push(`keys: ${Object.keys(value as Record<string, unknown>).join(', ') || '(none)'}`);
    return lines;
  }

  if (output.type === 'scalar') {
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
    throw new Error(`Unsupported output.source ${sourcePath}: only $derived.* is supported in Builder remote view mode.`);
  }

  if (cleaned === 'derived') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`output.source ${sourcePath} resolved to non-object; expected object for $derived root.`);
    }
    return value as Record<string, unknown>;
  }

  const parts = cleaned.split('.').filter(Boolean);
  if (parts[0] !== 'derived' || parts.length < 2) {
    throw new Error(`Unsupported output.source ${sourcePath}: expected $derived.<name>.`);
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
  const inputLines = Object.entries(explanation.inputs).map(
    ([name, spec]) => `- ${name}: ${String(spec.type ?? 'unknown')}`,
  );

  const loadLines = explanation.load.map((step, index) => {
    const record = step && typeof step === 'object' && !Array.isArray(step) ? (step as Record<string, unknown>) : {};
    return `${index + 1}. ${String(record.name ?? `step_${index + 1}`)} -> ${String(record.kind ?? 'unknown')}`;
  });
  const transformLines = explanation.transform.map((step, index) => {
    const record = step && typeof step === 'object' && !Array.isArray(step) ? (step as Record<string, unknown>) : {};
    return `${index + 1}. ${String(record.name ?? `step_${index + 1}`)} -> ${String(record.kind ?? 'unknown')}`;
  });

  return [
    `Runtime operation: ${explanation.protocolId}/${explanation.operationId}`,
    `instruction: ${explanation.instruction || 'read-only'}`,
    '',
    'Inputs:',
    ...(inputLines.length > 0 ? inputLines : ['- none']),
    '',
    'Load:',
    ...(loadLines.length > 0 ? loadLines : ['- none']),
    '',
    'Transform:',
    ...(transformLines.length > 0 ? transformLines : ['- none']),
    '',
    'Raw:',
    asPrettyJson(explanation),
  ].join('\n');
}
