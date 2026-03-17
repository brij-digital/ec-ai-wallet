import type { MetaAppSummary, MetaOperationExplain, MetaOperationSummary } from '@agentform/apppack-runtime/metaIdlRuntime';
import { resolveToken } from '../constants/tokens';

export type BuilderAppStepContext = {
  input: Record<string, unknown>;
  derived: Record<string, unknown>;
  args: Record<string, unknown>;
  accounts: Record<string, string>;
  instructionName: string | null;
};

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

export function writeBuilderPath(value: Record<string, unknown>, path: string, nextValue: unknown): Record<string, unknown> {
  const cleaned = path.startsWith('$') ? path.slice(1) : path;
  const parts = cleaned.split('.').filter(Boolean);
  if (parts.length === 0) {
    return value;
  }

  const nextRoot: Record<string, unknown> = { ...value };
  let current: Record<string, unknown> = nextRoot;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const existing = current[key];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[key] = {};
    } else {
      current[key] = { ...(existing as Record<string, unknown>) };
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = nextValue;
  return nextRoot;
}

export function valuesEqualForSelection(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isBuilderTruthy(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value !== 0;
  }
  if (typeof value === 'bigint') {
    return value !== 0n;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return false;
    }
    if (trimmed === '0' || trimmed.toLowerCase() === 'false' || trimmed.toLowerCase() === 'null') {
      return false;
    }
    return true;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
}

export function buildBuilderAppScope(contexts: Record<string, BuilderAppStepContext>): Record<string, unknown> {
  return {
    steps: contexts,
  };
}

export function evaluateBuilderStepSuccess(
  step: MetaAppSummary['steps'][number],
  contexts: Record<string, BuilderAppStepContext>,
  operationSucceeded: boolean,
): boolean {
  if (step.success.kind === 'operation_ok') {
    return operationSucceeded;
  }
  if (step.success.kind === 'value_present') {
    const value = readBuilderPath(buildBuilderAppScope(contexts), step.success.path);
    return isBuilderTruthy(value);
  }
  throw new Error(`Unsupported step success kind: ${String((step.success as { kind?: unknown }).kind)}`);
}

export function findBuilderAppStepIndexById(app: MetaAppSummary, stepId: string): number {
  return app.steps.findIndex((step) => step.stepId === stepId);
}

export function isBuilderAppStepUnlocked(
  app: MetaAppSummary,
  targetStep: MetaAppSummary['steps'][number],
  contexts: Record<string, BuilderAppStepContext>,
  completed: Record<string, boolean>,
): boolean {
  const dependsSatisfied = targetStep.blocking.dependsOn.every((stepId) => Boolean(completed[stepId]));
  if (!dependsSatisfied) {
    return false;
  }
  const scope = buildBuilderAppScope(contexts);
  const pathsSatisfied = targetStep.blocking.requiresPaths.every((path) => isBuilderTruthy(readBuilderPath(scope, path)));
  if (!pathsSatisfied) {
    return false;
  }

  if (targetStep.stepId === app.entryStepId) {
    return true;
  }
  return true;
}

export function formatBuilderSelectableItemLabel(
  item: unknown,
  index: number,
  ui: NonNullable<MetaAppSummary['steps'][number]['ui']>,
): string {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    if (ui.labelFields.length > 0) {
      const values = ui.labelFields
        .map((field) => readBuilderPath(record, field))
        .filter((entry) => entry !== undefined && entry !== null)
        .map((entry) => String(entry));
      if (values.length > 0) {
        return `${index + 1}. ${values.join(' | ')}`;
      }
    }
    const selected = readBuilderPath(record, ui.valuePath);
    if (selected !== undefined) {
      return `${index + 1}. ${String(selected)}`;
    }
    return `${index + 1}. [invalid selector: ui.valuePath did not resolve]`;
  }
  return `${index + 1}. ${String(item)}`;
}

export function isAutoResolvedBuilderInput(spec: MetaOperationSummary['inputs'][string]): boolean {
  const readFrom = spec.read_from;
  return (
    spec.default !== undefined ||
    (typeof readFrom === 'string' && readFrom.length > 0)
  );
}

export function isBuilderInputEditable(spec: MetaOperationSummary['inputs'][string]): boolean {
  if (typeof spec.ui_editable === 'boolean') {
    return spec.ui_editable;
  }
  return !isAutoResolvedBuilderInput(spec);
}

export function getBuilderInputTag(spec: MetaOperationSummary['inputs'][string]): string {
  if (typeof spec.read_from === 'string' && spec.read_from.length > 0) {
    return 'readonly';
  }
  if (spec.default !== undefined) {
    return 'default';
  }
  if (spec.required) {
    return 'required';
  }
  return 'optional';
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
  operation: MetaOperationSummary,
): Record<string, string> {
  const nextValues: Record<string, string> = {};

  for (const [inputName, spec] of Object.entries(operation.inputs)) {
    if (spec.default !== undefined) {
      nextValues[inputName] = stringifyBuilderDefault(spec.default);
      continue;
    }
    const extra = spec as Record<string, unknown>;
    const uiExample = extra.ui_example;
    if (uiExample !== undefined) {
      nextValues[inputName] = stringifyBuilderDefault(uiExample);
      continue;
    }
    const example = extra.example;
    if (example !== undefined) {
      nextValues[inputName] = stringifyBuilderDefault(example);
      continue;
    }

    const normalizedType = spec.type.toLowerCase();
    if (normalizedType === 'bool' || normalizedType === 'boolean') {
      nextValues[inputName] = 'true';
      continue;
    }
    if (/^[ui]\d+$/.test(normalizedType)) {
      nextValues[inputName] = '1';
      continue;
    }
    if (normalizedType === 'f32' || normalizedType === 'f64' || normalizedType === 'number') {
      nextValues[inputName] = '0.1';
      continue;
    }

    nextValues[inputName] = '';
  }

  return nextValues;
}

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

export function asIntegerLikeString(value: unknown, label: string): string {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  throw new Error(`${label} must be an integer-like value.`);
}

export function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

export function compactPubkey(value: unknown): string {
  const text = String(value ?? 'n/a');
  if (text.length <= 12) {
    return text;
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function stringifyReadOutputValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatReadOutputItem(
  item: unknown,
  index: number,
  labelFields: string[],
): string {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    if (labelFields.length > 0) {
      const parts = labelFields
        .map((field) => readBuilderPath(record, field))
        .filter((entry) => entry !== undefined && entry !== null)
        .map((entry) => String(entry));
      if (parts.length > 0) {
        return `${index + 1}. ${parts.join(' | ')}`;
      }
      return `${index + 1}. [no label field resolved]`;
    }
    return `${index + 1}. [configure read_output.itemLabelFields]`;
  }
  return `${index + 1}. ${stringifyReadOutputValue(item)}`;
}

export function buildReadOnlyHighlightsFromSpec(
  spec: NonNullable<MetaOperationSummary['readOutput']>,
  readValue: unknown,
): string[] {
  const highlights: string[] = [];
  if (spec.title) {
    highlights.push(spec.title);
  }

  if (spec.type === 'scalar') {
    if (readValue === undefined || readValue === null || readValue === '') {
      highlights.push(spec.emptyText ?? 'No value returned.');
      return highlights;
    }
    highlights.push(`value: ${stringifyReadOutputValue(readValue)}`);
    return highlights;
  }

  if (spec.type === 'object') {
    if (!readValue || typeof readValue !== 'object' || Array.isArray(readValue)) {
      highlights.push(spec.emptyText ?? 'No object returned.');
      return highlights;
    }
    const entries = Object.entries(readValue as Record<string, unknown>);
    if (entries.length === 0) {
      highlights.push(spec.emptyText ?? 'No object fields returned.');
      return highlights;
    }
    for (const [key, value] of entries) {
      highlights.push(`${key}: ${stringifyReadOutputValue(value)}`);
    }
    return highlights;
  }

  if (!Array.isArray(readValue)) {
    highlights.push(spec.emptyText ?? 'No list returned.');
    return highlights;
  }

  if (readValue.length === 0) {
    highlights.push(spec.emptyText ?? 'No items found.');
    return highlights;
  }

  const maxItems = typeof spec.maxItems === 'number' && spec.maxItems > 0 ? spec.maxItems : readValue.length;
  const shown = readValue.slice(0, maxItems);
  highlights.push(`items: ${readValue.length}`);
  highlights.push(...shown.map((item, index) => formatReadOutputItem(item, index, spec.itemLabelFields ?? [])));
  if (readValue.length > shown.length) {
    highlights.push(`...and ${readValue.length - shown.length} more.`);
  }
  return highlights;
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
  // Build relative to derived root so "$derived.pool_candidates" becomes
  // { pool_candidates: value }, not { derived: { pool_candidates: value } }.
  const relative = parts.slice(1);
  for (let i = 0; i < relative.length - 1; i += 1) {
    const key = relative[i]!;
    current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[relative[relative.length - 1]!] = value;
  return out;
}

export function renderMetaExplain(explanation: MetaOperationExplain): string {
  const formatRequired = (spec: Record<string, unknown>): string => {
    const required = spec.required === false ? 'optional' : 'required';
    const defaultText = spec.default !== undefined ? `, default=${JSON.stringify(spec.default)}` : '';
    const discoverFromText =
      typeof spec.read_from === 'string' ? `, read_from=${spec.read_from}` : '';
    return `${required}${defaultText}${discoverFromText}`;
  };

  const discoverLines = explanation.discover.map((step, index) => {
    const name = String(step.name ?? `step_${index + 1}`);
    const kind = String(step.discover ?? 'unknown');
    return `${index + 1}. ${name} -> ${kind}`;
  });

  const deriveLines = explanation.derive.map((step, index) => {
    const name = String(step.name ?? `step_${index + 1}`);
    const resolver = String(step.resolver ?? 'unknown');
    return `${index + 1}. ${name} -> ${resolver}`;
  });

  const computeLines = explanation.compute.map((step, index) => {
    const name = String(step.name ?? `step_${index + 1}`);
    const compute = String(step.compute ?? 'unknown');
    return `${index + 1}. ${name} -> ${compute}`;
  });

  const inputLines = Object.entries(explanation.inputs).map(
    ([name, spec]) => `- ${name}: ${String(spec.type ?? 'unknown')} (${formatRequired(spec)})`,
  );

  const view = explanation.view as Record<string, unknown> | undefined;
  const viewBootstrap = view?.bootstrap as Record<string, unknown> | undefined;
  const viewStream = view?.stream as Record<string, unknown> | undefined;

  const viewBootstrapSteps = Array.isArray(viewBootstrap?.steps)
    ? (viewBootstrap.steps as unknown[])
        .map((entry) => String(entry))
        .filter((entry) => entry.length > 0)
    : [];
  const viewEntityKeys = Array.isArray(view?.entity_keys)
    ? (view.entity_keys as unknown[])
        .map((entry) => String(entry))
        .filter((entry) => entry.length > 0)
    : [];
  const viewStreamSource = viewStream
    ? String(viewStream.source ?? 'n/a')
    : null;
  const viewStreamFilter = viewStream
    ? String(viewStream.filter ?? 'n/a')
    : null;

  return [
    `Meta operation: ${explanation.protocolId}/${explanation.operationId}`,
    `schema: ${explanation.schema ?? 'n/a'} | version: ${explanation.version}`,
    `instruction: ${explanation.instruction}`,
    `templates used: ${explanation.templateUse.length > 0 ? explanation.templateUse.map((entry) => String(entry.template ?? entry.macro ?? 'unknown')).join(', ') : 'none'}`,
    '',
    'Inputs:',
    ...(inputLines.length > 0 ? inputLines : ['- none']),
    '',
    'Discover phase:',
    ...(discoverLines.length > 0 ? discoverLines : ['none']),
    '',
    'Derive phase:',
    ...(deriveLines.length > 0 ? deriveLines : ['none']),
    '',
    'Compute phase:',
    ...(computeLines.length > 0 ? computeLines : ['none']),
    '',
    'View contract:',
    ...(view
      ? [
          `bootstrap steps: ${viewBootstrapSteps.join(', ') || 'none'}`,
          `stream source: ${viewStreamSource ?? 'none'}`,
          `stream filter: ${viewStreamFilter ?? 'none'}`,
          `entity keys: ${viewEntityKeys.join(', ') || 'none'}`,
        ]
      : ['none']),
    '',
    `Build args keys: ${Object.keys(explanation.args).join(', ') || 'none'}`,
    `Build accounts keys: ${Object.keys(explanation.accounts).join(', ') || 'none'}`,
    `Post steps: ${explanation.post.length}`,
    '',
    'Expanded JSON:',
    asPrettyJson(explanation),
  ].join('\n');
}
