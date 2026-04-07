import { useEffect, useMemo, useState, type FormEvent } from 'react';

type ViewPlaygroundTabProps = {
  viewApiBaseUrl: string;
  viewKind: 'index';
};

type RegistryIndexing = {
  id: string;
  entitySchemaPath?: string | null;
  status?: string;
};

type RegistryResponse = {
  indexings?: RegistryIndexing[];
};

type EntityFieldSpec = {
  type?: string;
  filterable?: boolean;
  primaryKey?: boolean;
};

type EntityEmitSpec = {
  id?: string | string[];
  timeField?: string;
  defaultOrderBy?: string[];
  fields?: Record<string, EntityFieldSpec>;
};

type EntitySourceSpec = {
  from?: string;
  recordKind?: string;
  recordName?: string | string[];
};

type EntityDefinition = {
  source?: EntitySourceSpec;
  emit?: EntityEmitSpec;
};

type EntitySchema = {
  indexingId?: string;
  entities?: Record<string, EntityDefinition>;
};

type CatalogEntry = {
  indexingId: string;
  entityName: string;
  label: string;
  sourceLabel: string;
  filterableFields: string[];
  primaryKeyFields: string[];
  timeField: string | null;
  orderBy: string;
  limit: string;
  whereTemplate: string;
};

type HealthIndexing = {
  indexing_id?: string;
  status?: string;
};

type HealthResponse = {
  ok?: boolean;
  status?: string;
  indexings?: HealthIndexing[];
};

type EntityListResponse = {
  ok: boolean;
  indexingId?: string;
  entity?: string;
  items?: unknown[];
  meta?: Record<string, unknown>;
  error?: string;
};

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error(`Empty response body (${response.status}).`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Expected JSON response but received non-JSON body (${response.status}).`);
  }
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return formatJson(value);
}

function buildSourceLabel(source?: EntitySourceSpec): string {
  const from = source?.from ?? 'unknown';
  const kind = source?.recordKind ?? 'record';
  const recordName = source?.recordName;
  const names = Array.isArray(recordName) ? recordName.join(', ') : recordName;
  return [from, kind, names].filter(Boolean).join(' / ');
}

function buildWhereTemplate(fields: string[]): string {
  if (fields.length === 0) {
    return '{}';
  }
  const template = Object.fromEntries(fields.slice(0, 2).map((field) => [field, '']));
  return JSON.stringify(template, null, 2);
}

function defaultLimitForEntity(primaryKeyFields: string[], timeField: string | null): string {
  if (primaryKeyFields.length > 0 && !timeField) {
    return '1';
  }
  return '20';
}

function describeHealth(snapshot: HealthResponse): string {
  const indexings = snapshot.indexings ?? [];
  const stale = indexings.filter((item) => item.status === 'stale').length;
  const degraded = indexings.filter((item) => item.status === 'degraded').length;
  const failing = indexings.filter((item) => item.status === 'failing').length;
  return [
    `status=${snapshot.status ?? 'unknown'}`,
    `indexings=${indexings.length}`,
    `stale=${stale}`,
    `degraded=${degraded}`,
    `failing=${failing}`,
  ].join(' | ');
}

function normalizeWhereInput(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Filters JSON must be an object.');
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== '' && entry !== null && entry !== undefined)
      .map(([key, entry]) => {
        if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
          return [key, String(entry)];
        }
        throw new Error(`Filter ${key} must be a string, number, or boolean.`);
      }),
  );
}

export function ViewPlaygroundTab({ viewApiBaseUrl }: ViewPlaygroundTabProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [indexingId, setIndexingId] = useState('');
  const [entityName, setEntityName] = useState('');
  const [whereText, setWhereText] = useState('{}');
  const [limitText, setLimitText] = useState('20');
  const [orderByText, setOrderByText] = useState('');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [healthText, setHealthText] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [result, setResult] = useState<EntityListResponse | null>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [isRunLoading, setIsRunLoading] = useState(false);

  const trimmedBaseUrl = useMemo(() => viewApiBaseUrl.trim().replace(/\/+$/, ''), [viewApiBaseUrl]);
  const title = 'Indexed Entities';
  const description = 'Browse materialized layer-2 entities served by the indexing API.';

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      setIsCatalogLoading(true);
      setCatalogError(null);
      try {
        const registryResponse = await fetch('/idl/registry.json', { cache: 'no-store' });
        if (!registryResponse.ok) {
          throw new Error(`Failed to load registry (${registryResponse.status}).`);
        }
        const registry = (await registryResponse.json()) as RegistryResponse;
        const loaded: CatalogEntry[] = [];

        for (const indexing of registry.indexings ?? []) {
          if (indexing.status === 'inactive' || !indexing.entitySchemaPath) {
            continue;
          }
          const entityResponse = await fetch(indexing.entitySchemaPath, { cache: 'no-store' });
          if (!entityResponse.ok) {
            continue;
          }
          const entitySchema = (await entityResponse.json()) as EntitySchema;
          for (const [nextEntityName, definition] of Object.entries(entitySchema.entities ?? {})) {
            const fields = definition.emit?.fields ?? {};
            const filterableFields = Object.entries(fields)
              .filter(([, spec]) => spec.filterable || spec.primaryKey)
              .map(([fieldName]) => fieldName);
            const primaryKeyFields = Object.entries(fields)
              .filter(([, spec]) => spec.primaryKey)
              .map(([fieldName]) => fieldName);
            const timeField = definition.emit?.timeField ?? null;
            loaded.push({
              indexingId: entitySchema.indexingId ?? indexing.id,
              entityName: nextEntityName,
              label: `${entitySchema.indexingId ?? indexing.id} / ${nextEntityName}`,
              sourceLabel: buildSourceLabel(definition.source),
              filterableFields,
              primaryKeyFields,
              timeField,
              orderBy: (definition.emit?.defaultOrderBy ?? []).join(','),
              limit: defaultLimitForEntity(primaryKeyFields, timeField),
              whereTemplate: buildWhereTemplate(filterableFields),
            });
          }
        }

        loaded.sort((left, right) => left.label.localeCompare(right.label));

        if (cancelled) {
          return;
        }

        setCatalog(loaded);
        const first = loaded[0] ?? null;
        if (first) {
          setIndexingId(first.indexingId);
          setEntityName(first.entityName);
          setWhereText(first.whereTemplate);
          setLimitText(first.limit);
          setOrderByText(first.orderBy);
          setFromText('');
          setToText('');
        } else {
          setIndexingId('');
          setEntityName('');
          setWhereText('{}');
          setLimitText('20');
          setOrderByText('');
          setFromText('');
          setToText('');
        }
      } catch (error) {
        if (!cancelled) {
          setCatalogError(error instanceof Error ? error.message : 'Failed to load entity catalog.');
        }
      } finally {
        if (!cancelled) {
          setIsCatalogLoading(false);
        }
      }
    }

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedEntry = useMemo(
    () => catalog.find((entry) => entry.indexingId === indexingId && entry.entityName === entityName) ?? null,
    [catalog, entityName, indexingId],
  );

  const applyCatalogEntry = (entry: CatalogEntry) => {
    setIndexingId(entry.indexingId);
    setEntityName(entry.entityName);
    setWhereText(entry.whereTemplate);
    setLimitText(entry.limit);
    setOrderByText(entry.orderBy);
    setFromText('');
    setToText('');
    setErrorText(null);
    setResultText(null);
    setResult(null);
  };

  const handleHealthCheck = async () => {
    setIsHealthLoading(true);
    setErrorText(null);
    try {
      const response = await fetch(`${trimmedBaseUrl}/health`);
      const body = await readJsonResponse<HealthResponse>(response);
      if (!response.ok) {
        throw new Error(`Health check failed with ${response.status}.`);
      }
      setHealthText(describeHealth(body));
    } catch (error) {
      setHealthText(null);
      setErrorText(error instanceof Error ? error.message : 'Health check failed.');
    } finally {
      setIsHealthLoading(false);
    }
  };

  const handleRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsRunLoading(true);
    setErrorText(null);
    setResultText(null);
    setResult(null);

    try {
      const parsedWhere = normalizeWhereInput(JSON.parse(whereText) as Record<string, unknown>);
      const url = new URL(
        `${trimmedBaseUrl || window.location.origin}/entity/${encodeURIComponent(indexingId)}/${encodeURIComponent(entityName)}`,
      );

      const parsedLimit = limitText.trim().length > 0 ? Number.parseInt(limitText, 10) : undefined;
      if (typeof parsedLimit === 'number') {
        if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
          throw new Error('Limit must be a positive integer when provided.');
        }
        url.searchParams.set('limit', String(parsedLimit));
      }
      if (orderByText.trim().length > 0) {
        url.searchParams.set('orderBy', orderByText.trim());
      }
      if (fromText.trim().length > 0) {
        url.searchParams.set('from', fromText.trim());
      }
      if (toText.trim().length > 0) {
        url.searchParams.set('to', toText.trim());
      }
      for (const [field, value] of Object.entries(parsedWhere)) {
        url.searchParams.set(`where[${field}]`, value);
      }

      const response = await fetch(url.toString(), {
        headers: {
          accept: 'application/json',
        },
      });

      const body = await readJsonResponse<EntityListResponse>(response);
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? `Entity query failed with ${response.status}.`);
      }

      setResult(body);
      setResultText(`items=${body.items?.length ?? 0}` + (body.meta ? ` | source=${String(body.meta.source ?? 'unknown')}` : ''));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Entity query failed.');
    } finally {
      setIsRunLoading(false);
    }
  };

  return (
    <section className="view-playground-shell">
      <div className="view-playground-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="view-playground-target">
          <span>Target</span>
          <code>{trimmedBaseUrl}/entity/{'{indexing}'}/{'{entity}'}</code>
        </div>
      </div>

      <div className="view-playground-presets">
        {catalog.map((entry) => (
          <button key={`${entry.indexingId}::${entry.entityName}`} type="button" onClick={() => applyCatalogEntry(entry)}>
            {entry.label}
          </button>
        ))}
        <button type="button" onClick={handleHealthCheck} disabled={isHealthLoading}>
          {isHealthLoading ? 'Checking...' : 'Check Health'}
        </button>
      </div>

      {catalogError ? <p className="view-playground-error">{catalogError}</p> : null}
      {healthText ? <p className="view-playground-info">{healthText}</p> : null}
      {selectedEntry ? (
        <p className="view-playground-info">
          source={selectedEntry.sourceLabel}
          {selectedEntry.timeField ? ` | timeField=${selectedEntry.timeField}` : ''}
          {selectedEntry.filterableFields.length > 0 ? ` | filters=${selectedEntry.filterableFields.join(', ')}` : ''}
        </p>
      ) : null}
      {errorText ? <p className="view-playground-error">{errorText}</p> : null}
      {resultText ? <p className="view-playground-info">{resultText}</p> : null}
      {isCatalogLoading ? <p className="view-playground-empty">Loading entity catalog...</p> : null}
      {!isCatalogLoading && catalog.length === 0 ? <p className="view-playground-empty">No materialized entities are declared in the current registry.</p> : null}

      <form className="view-playground-form" onSubmit={handleRun}>
        <label>
          Indexing ID
          <input value={indexingId} onChange={(event) => setIndexingId(event.target.value)} disabled={isRunLoading || catalog.length === 0} />
        </label>
        <label>
          Entity
          <input value={entityName} onChange={(event) => setEntityName(event.target.value)} disabled={isRunLoading || catalog.length === 0} />
        </label>
        <label>
          Limit
          <input value={limitText} onChange={(event) => setLimitText(event.target.value)} disabled={isRunLoading || catalog.length === 0} />
        </label>
        <label>
          Order By
          <input value={orderByText} onChange={(event) => setOrderByText(event.target.value)} disabled={isRunLoading || catalog.length === 0} />
        </label>
        <label>
          From
          <input value={fromText} onChange={(event) => setFromText(event.target.value)} disabled={isRunLoading || catalog.length === 0} placeholder="2026-04-06T00:00:00Z" />
        </label>
        <label>
          To
          <input value={toText} onChange={(event) => setToText(event.target.value)} disabled={isRunLoading || catalog.length === 0} placeholder="2026-04-06T23:59:59Z" />
        </label>
        <label className="view-playground-form-full">
          Filters JSON
          <textarea value={whereText} onChange={(event) => setWhereText(event.target.value)} disabled={isRunLoading || catalog.length === 0} rows={12} />
        </label>
        <div className="view-playground-actions">
          <button type="submit" disabled={isRunLoading || catalog.length === 0}>
            {isRunLoading ? 'Querying...' : 'Run Query'}
          </button>
        </div>
      </form>

      <div className="view-playground-results">
        <section className="view-playground-panel">
          <h3>Structured Preview</h3>
          {Array.isArray(result?.items) && result.items.length > 0 ? (
            <div className="view-result-grid">
              {result.items.map((item, index) => (
                <article key={index} className="view-result-card">
                  <strong>Item {index + 1}</strong>
                  {item && typeof item === 'object' && !Array.isArray(item) ? (
                    <dl>
                      {Object.entries(item as Record<string, unknown>).map(([key, value]) => (
                        <div key={key} className="view-result-row">
                          <dt>{key}</dt>
                          <dd>{summarizeValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <pre>{formatJson(item)}</pre>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="view-playground-empty">Run an entity query to inspect items here.</p>
          )}
        </section>

        <section className="view-playground-panel">
          <h3>Raw Response</h3>
          <pre>{result ? formatJson(result) : '// no result yet'}</pre>
        </section>
      </div>
    </section>
  );
}
