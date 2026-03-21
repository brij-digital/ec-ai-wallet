import { useMemo, useState, type FormEvent } from 'react';
import { VIEW_PLAYGROUND_PRESETS } from '../viewModels';

type ViewPlaygroundTabProps = {
  viewApiBaseUrl: string;
};

type HealthResponse = {
  ok?: boolean;
  service?: string;
  sync?: {
    total_jobs?: number;
    bootstrap_pending?: number;
    incremental_jobs?: number;
    jobs_with_errors?: number;
  };
};

type ViewRunResponse = {
  ok: boolean;
  items?: unknown[];
  meta?: Record<string, unknown>;
  error?: string;
};

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

export function ViewPlaygroundTab({ viewApiBaseUrl }: ViewPlaygroundTabProps) {
  const [protocolId, setProtocolId] = useState(VIEW_PLAYGROUND_PRESETS[0].protocolId);
  const [operationId, setOperationId] = useState(VIEW_PLAYGROUND_PRESETS[0].operationId);
  const [inputText, setInputText] = useState(VIEW_PLAYGROUND_PRESETS[0].input);
  const [limitText, setLimitText] = useState(VIEW_PLAYGROUND_PRESETS[0].limit);
  const [healthText, setHealthText] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [result, setResult] = useState<ViewRunResponse | null>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [isRunLoading, setIsRunLoading] = useState(false);

  const trimmedBaseUrl = useMemo(() => viewApiBaseUrl.trim().replace(/\/+$/, ''), [viewApiBaseUrl]);

  const applyPreset = (preset: (typeof VIEW_PLAYGROUND_PRESETS)[number]) => {
    setProtocolId(preset.protocolId);
    setOperationId(preset.operationId);
    setInputText(preset.input);
    setLimitText(preset.limit);
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
          `jobs=${body.sync?.total_jobs ?? 0}`,
          `bootstrap_pending=${body.sync?.bootstrap_pending ?? 0}`,
          `incremental_jobs=${body.sync?.incremental_jobs ?? 0}`,
          `jobs_with_errors=${body.sync?.jobs_with_errors ?? 0}`,
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
          <h2>Views Playground</h2>
          <p>Run the local or remote view service, inspect result shapes, and sanity-check whether a view is already usable in UI.</p>
        </div>
        <div className="view-playground-target">
          <span>Target</span>
          <code>{trimmedBaseUrl}</code>
        </div>
      </div>

      <div className="view-playground-presets">
        {VIEW_PLAYGROUND_PRESETS.map((preset) => (
          <button key={preset.label} type="button" onClick={() => applyPreset(preset)}>
            {preset.label}
          </button>
        ))}
        <button type="button" onClick={handleHealthCheck} disabled={isHealthLoading}>
          {isHealthLoading ? 'Checking...' : 'Check Health'}
        </button>
      </div>

      {healthText ? <p className="view-playground-info">{healthText}</p> : null}
      {errorText ? <p className="view-playground-error">{errorText}</p> : null}
      {resultText ? <p className="view-playground-info">{resultText}</p> : null}

      <form className="view-playground-form" onSubmit={handleRun}>
        <label>
          Protocol ID
          <input value={protocolId} onChange={(event) => setProtocolId(event.target.value)} disabled={isRunLoading} />
        </label>
        <label>
          Operation ID
          <input value={operationId} onChange={(event) => setOperationId(event.target.value)} disabled={isRunLoading} />
        </label>
        <label>
          Limit
          <input value={limitText} onChange={(event) => setLimitText(event.target.value)} disabled={isRunLoading} />
        </label>
        <label className="view-playground-form-full">
          Input JSON
          <textarea value={inputText} onChange={(event) => setInputText(event.target.value)} disabled={isRunLoading} rows={12} />
        </label>
        <div className="view-playground-actions">
          <button type="submit" disabled={isRunLoading}>
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
