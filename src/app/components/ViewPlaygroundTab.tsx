import { useEffect, useMemo, useState, type FormEvent } from 'react';

type ViewPlaygroundTabProps = {
  viewApiBaseUrl: string;
  viewKind: 'index';
};

type RegistryProtocol = {
  id: string;
  name?: string;
  agentRuntimePath?: string;
  status?: string;
};

type RegistryResponse = {
  protocols?: RegistryProtocol[];
};

type RuntimeInputDef = {
  default?: unknown;
};

type RuntimeViewShape = {
  title?: string;
  description?: string;
};

type RuntimeOperation = {
  label?: string;
  description?: string;
  inputs?: Record<string, RuntimeInputDef>;
  read?: RuntimeViewShape;
};

type RuntimeSpec = {
  index_views?: Record<string, RuntimeOperation>;
};

type CatalogEntry = {
  protocolId: string;
  protocolLabel: string;
  operationId: string;
  operationLabel: string;
  description: string;
  inputTemplate: string;
  limit: string;
};

type HealthResponse = {
  ok?: boolean;
  service?: string;
};

type ViewRunResponse = {
  ok: boolean;
  items?: unknown[];
  meta?: Record<string, unknown>;
  error?: string;
};

function buildInputTemplate(inputs?: Record<string, RuntimeInputDef>): string {
  const template: Record<string, unknown> = {};
  for (const [key, input] of Object.entries(inputs ?? {})) {
    if (Object.prototype.hasOwnProperty.call(input, 'default')) {
      template[key] = input.default;
    }
  }
  return JSON.stringify(template, null, 2);
}

function defaultLimitForOperation(operationId: string): string {
  if (operationId.includes('snapshot') || operationId.includes('resolve')) {
    return '1';
  }
  return '20';
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
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

export function ViewPlaygroundTab({ viewApiBaseUrl, viewKind }: ViewPlaygroundTabProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [protocolId, setProtocolId] = useState('');
  const [operationId, setOperationId] = useState('');
  const [inputText, setInputText] = useState('{}');
  const [limitText, setLimitText] = useState('20');
  const [healthText, setHealthText] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [result, setResult] = useState<ViewRunResponse | null>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [isRunLoading, setIsRunLoading] = useState(false);

  const trimmedBaseUrl = useMemo(() => viewApiBaseUrl.trim().replace(/\/+$/, ''), [viewApiBaseUrl]);
  const title = 'Index Views';
  const description = 'Run indexed discovery, feeds, rankings, and canonical read contracts declared in runtime.';

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      setIsCatalogLoading(true);
      setCatalogError(null);
      try {
        const registryResponse = await fetch('/idl/registry.json');
        if (!registryResponse.ok) {
          throw new Error(`Failed to load registry (${registryResponse.status}).`);
        }
        const registry = (await registryResponse.json()) as RegistryResponse;
        const loaded: CatalogEntry[] = [];

        for (const protocol of registry.protocols ?? []) {
          if (protocol.status === 'inactive' || !protocol.agentRuntimePath) {
            continue;
          }
          const runtimeResponse = await fetch(protocol.agentRuntimePath);
          if (!runtimeResponse.ok) {
            continue;
          }
          const runtime = (await runtimeResponse.json()) as RuntimeSpec;
          const readOperations = runtime.index_views ?? {};
          for (const [opId, operation] of Object.entries(readOperations)) {
            const view = operation.read;
            if (!view) {
              continue;
            }
            loaded.push({
              protocolId: protocol.id,
              protocolLabel: protocol.name ?? protocol.id,
              operationId: opId,
              operationLabel: operation.label ?? view.title ?? opId,
              description: view.description ?? operation.description ?? '',
              inputTemplate: buildInputTemplate(operation.inputs),
              limit: defaultLimitForOperation(opId),
            });
          }
        }

        loaded.sort((a, b) => {
          if (a.protocolLabel !== b.protocolLabel) {
            return a.protocolLabel.localeCompare(b.protocolLabel);
          }
          return a.operationLabel.localeCompare(b.operationLabel);
        });

        if (cancelled) {
          return;
        }

        setCatalog(loaded);
        const first = loaded[0] ?? null;
        if (first) {
          setProtocolId(first.protocolId);
          setOperationId(first.operationId);
          setInputText(first.inputTemplate);
          setLimitText(first.limit);
        } else {
          setProtocolId('');
          setOperationId('');
          setInputText('{}');
          setLimitText('20');
        }
      } catch (error) {
        if (!cancelled) {
          setCatalogError(error instanceof Error ? error.message : 'Failed to load view catalog.');
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
  }, [viewKind]);

  const applyCatalogEntry = (entry: CatalogEntry) => {
    setProtocolId(entry.protocolId);
    setOperationId(entry.operationId);
    setInputText(entry.inputTemplate);
    setLimitText(entry.limit);
    setErrorText(null);
    setResultText(null);
    setResult(null);
  };

  const handleHealthCheck = async () => {
    setIsHealthLoading(true);
    setErrorText(null);
    try {
      const response = await fetch(`${trimmedBaseUrl}/health`);
      const body = (await response.json()) as HealthResponse;
      if (!response.ok) {
        throw new Error(`Health check failed with ${response.status}.`);
      }
      setHealthText(
        [
          `service=${body.service ?? 'unknown'}`,
          `index_only=true`,
        ].join(' | '),
      );
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
      const parsedInput = JSON.parse(inputText) as Record<string, unknown>;
      const parsedLimit = limitText.trim().length > 0 ? Number.parseInt(limitText, 10) : undefined;
      if (typeof parsedLimit === 'number' && (!Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
        throw new Error('Limit must be a positive integer when provided.');
      }

      const response = await fetch(`${trimmedBaseUrl}/view-run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          protocol_id: protocolId,
          operation_id: operationId,
          input: parsedInput,
          ...(typeof parsedLimit === 'number' ? { limit: parsedLimit } : {}),
        }),
      });

      const body = (await response.json()) as ViewRunResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? `View run failed with ${response.status}.`);
      }

      setResult(body);
      setResultText(`items=${body.items?.length ?? 0}` + (body.meta ? ' | meta present' : ''));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'View run failed.');
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
          <code>{trimmedBaseUrl}</code>
        </div>
      </div>

      <div className="view-playground-presets">
        {catalog.map((entry) => (
          <button key={`${entry.protocolId}::${entry.operationId}`} type="button" onClick={() => applyCatalogEntry(entry)}>
            {entry.protocolLabel} / {entry.operationLabel}
          </button>
        ))}
        <button type="button" onClick={handleHealthCheck} disabled={isHealthLoading}>
          {isHealthLoading ? 'Checking...' : 'Check Health'}
        </button>
      </div>

      {catalogError ? <p className="view-playground-error">{catalogError}</p> : null}
      {healthText ? <p className="view-playground-info">{healthText}</p> : null}
      {errorText ? <p className="view-playground-error">{errorText}</p> : null}
      {resultText ? <p className="view-playground-info">{resultText}</p> : null}
      {isCatalogLoading ? <p className="view-playground-empty">Loading runtime view catalog...</p> : null}
      {!isCatalogLoading && catalog.length === 0 ? <p className="view-playground-empty">No runtime views are defined for this view type.</p> : null}

      <form className="view-playground-form" onSubmit={handleRun}>
        <label>
          Protocol ID
          <input value={protocolId} onChange={(event) => setProtocolId(event.target.value)} disabled={isRunLoading || catalog.length === 0} />
        </label>
        <label>
          Operation ID
          <input value={operationId} onChange={(event) => setOperationId(event.target.value)} disabled={isRunLoading || catalog.length === 0} />
        </label>
        <label>
          Limit
          <input value={limitText} onChange={(event) => setLimitText(event.target.value)} disabled={isRunLoading || catalog.length === 0} />
        </label>
        <label className="view-playground-form-full">
          Input JSON
          <textarea value={inputText} onChange={(event) => setInputText(event.target.value)} disabled={isRunLoading || catalog.length === 0} rows={12} />
        </label>
        <div className="view-playground-actions">
          <button type="submit" disabled={isRunLoading || catalog.length === 0}>
            {isRunLoading ? 'Running...' : 'Run View'}
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
            <p className="view-playground-empty">Run a view to inspect items here.</p>
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
