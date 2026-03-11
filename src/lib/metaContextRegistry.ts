import type { Connection, PublicKey } from '@solana/web3.js';

export type ContextStepResolved = {
  name: string;
  context: string;
  [key: string]: unknown;
};

export type ContextRuntimeContext = {
  protocolId: string;
  programId: string;
  connection: Connection;
  walletPublicKey: PublicKey;
  scope: Record<string, unknown>;
};

type ContextExecutor = (step: ContextStepResolved, ctx: ContextRuntimeContext) => Promise<unknown>;

const contextHttpCache = new Map<string, { expiresAt: number; value: unknown }>();

function asString(value: unknown, label: string): string {
  if (typeof value === 'string') {
    return value;
  }
  throw new Error(`${label} must be a string.`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function asSafeInteger(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label} must be an integer.`);
}

function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label} must be a finite number.`);
}

function readPathFromValue(value: unknown, path: string): unknown {
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

function buildUrlWithQuery(url: string, query: Record<string, unknown>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) {
    return url;
  }

  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
      continue;
    }

    params.set(key, JSON.stringify(value));
  }

  const queryString = params.toString();
  if (!queryString) {
    return url;
  }

  return `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
}

async function runContextMock(step: ContextStepResolved): Promise<unknown> {
  if (step.value === undefined) {
    throw new Error(`context:${step.name}:value is required for context.mock.`);
  }
  return step.value;
}

async function runContextQueryHttpJson(step: ContextStepResolved): Promise<unknown> {
  const url = asString(step.url, `context:${step.name}:url`);
  const query = step.query === undefined ? {} : asRecord(step.query, `context:${step.name}:query`);
  const itemsPath = step.items_path === undefined ? undefined : asString(step.items_path, `context:${step.name}:items_path`);
  const selectPath = step.select_path === undefined ? undefined : asString(step.select_path, `context:${step.name}:select_path`);
  const maxAgeMs = step.max_age_ms === undefined ? 0 : asSafeInteger(step.max_age_ms, `context:${step.name}:max_age_ms`);

  const resolvedUrl = buildUrlWithQuery(url, query);
  const cacheKey = `${step.context}:${resolvedUrl}:${itemsPath ?? ''}:${selectPath ?? ''}`;
  const now = Date.now();
  const cached = contextHttpCache.get(cacheKey);
  if (cached && cached.expiresAt >= now) {
    return cached.value;
  }

  const response = await fetch(resolvedUrl);
  if (!response.ok) {
    throw new Error(`context:${step.name}:fetch failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as unknown;
  let result: unknown = body;

  if (itemsPath) {
    result = readPathFromValue(result, itemsPath);
    if (result === undefined) {
      throw new Error(`context:${step.name}:items_path ${itemsPath} not found.`);
    }
  }

  if (selectPath) {
    result = readPathFromValue(result, selectPath);
    if (result === undefined) {
      throw new Error(`context:${step.name}:select_path ${selectPath} not found.`);
    }
  }

  if (maxAgeMs > 0) {
    contextHttpCache.set(cacheKey, {
      expiresAt: now + maxAgeMs,
      value: result,
    });
  }

  return result;
}

async function runContextCompareValues(step: ContextStepResolved): Promise<unknown> {
  const items = asArray(step.items, `context:${step.name}:items`);
  if (items.length === 0) {
    throw new Error(`context:${step.name}:items must not be empty.`);
  }

  const mode = step.mode === undefined ? 'first' : asString(step.mode, `context:${step.name}:mode`);
  if (mode === 'first') {
    return items[0];
  }

  const metricPath = asString(step.metric_path, `context:${step.name}:metric_path`);
  const pickMax = mode === 'max';
  const pickMin = mode === 'min';
  if (!pickMax && !pickMin) {
    throw new Error(`context:${step.name}:mode must be one of first|max|min.`);
  }

  let selected = items[0];
  let selectedMetric = asFiniteNumber(
    readPathFromValue(selected, metricPath),
    `context:${step.name}:items[0].${metricPath}`,
  );

  for (let i = 1; i < items.length; i += 1) {
    const itemMetric = asFiniteNumber(
      readPathFromValue(items[i], metricPath),
      `context:${step.name}:items[${i}].${metricPath}`,
    );
    if ((pickMax && itemMetric > selectedMetric) || (pickMin && itemMetric < selectedMetric)) {
      selected = items[i];
      selectedMetric = itemMetric;
    }
  }

  return selected;
}

const CONTEXT_EXECUTORS: Record<string, ContextExecutor> = {
  'context.mock': runContextMock,
  'context.query_http_json': runContextQueryHttpJson,
  'context.compare_values': runContextCompareValues,
};

export async function runRegisteredContextStep(step: ContextStepResolved, ctx: ContextRuntimeContext): Promise<unknown> {
  const executor = CONTEXT_EXECUTORS[step.context];
  if (!executor) {
    throw new Error(`Unsupported context step: ${step.context}`);
  }

  return executor(step, ctx);
}
