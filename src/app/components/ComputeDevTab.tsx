import { useEffect, useMemo, useState } from 'react';
import { listIdlProtocols } from '@agentform/apppack-runtime/idlDeclarativeRuntime';
import {
  explainMetaOperation,
  listMetaOperations,
  type MetaOperationExplain,
  type MetaOperationSummary,
} from '@agentform/apppack-runtime/metaIdlRuntime';

type ProtocolSummary = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
};

type ComputeDevTabProps = {
  isWorking: boolean;
};

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatComputeStep(step: Record<string, unknown>): string {
  const name = typeof step.name === 'string' ? step.name : 'result';
  const kind = typeof step.compute === 'string' ? step.compute : 'unknown';
  if (kind === 'math.add' || kind === 'math.mul' || kind === 'math.sum') {
    const values = Array.isArray(step.values) ? step.values.map(formatValue).join(', ') : '';
    return `const ${name} = ${kind}(${values});`;
  }
  if (kind === 'math.sub') {
    const values = Array.isArray(step.values) ? step.values.map(formatValue) : [];
    return `const ${name} = ${kind}(${values[0] ?? ''}, ${values[1] ?? ''});`;
  }
  if (kind === 'math.floor_div') {
    return `const ${name} = floorDiv(${formatValue(step.dividend)}, ${formatValue(step.divisor)});`;
  }
  if (kind === 'logic.if') {
    return `const ${name} = (${formatValue(step.condition)}) ? ${formatValue(step.then)} : ${formatValue(step.else)};`;
  }
  if (kind === 'coalesce') {
    const values = Array.isArray(step.values) ? step.values.map(formatValue).join(', ') : '';
    return `const ${name} = coalesce(${values});`;
  }
  if (
    kind === 'compare.equals' ||
    kind === 'compare.not_equals' ||
    kind === 'compare.gt' ||
    kind === 'compare.gte' ||
    kind === 'compare.lt' ||
    kind === 'compare.lte'
  ) {
    return `const ${name} = ${kind}(${formatValue(step.left)}, ${formatValue(step.right)});`;
  }
  if (kind === 'list.get') {
    return `const ${name} = listGet(${formatValue(step.values)}, ${formatValue(step.index)});`;
  }
  if (kind === 'list.filter') {
    return `const ${name} = listFilter(${formatValue(step.items)}, ${formatValue(step.where)});`;
  }
  if (kind === 'list.min_by' || kind === 'list.max_by') {
    return `const ${name} = ${kind}(${formatValue(step.items)}, ${formatValue(step.path)});`;
  }
  if (kind === 'list.range_map') {
    return `const ${name} = listRangeMap(base=${formatValue(step.base)}, step=${formatValue(step.step)}, count=${formatValue(step.count)});`;
  }
  if (kind === 'pda(seed_spec)') {
    return `const ${name} = derivePda(${formatValue(step.seeds)});`;
  }

  const args = Object.entries(step)
    .filter(([key]) => key !== 'name' && key !== 'compute')
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(', ');
  return `const ${name} = ${kind}({ ${args} });`;
}

function renderPseudoFunction(explain: MetaOperationExplain): string {
  const lines: string[] = [];
  const fnName = `${explain.protocolId.replace(/[^a-zA-Z0-9]+/g, '_')}_${explain.operationId}`;
  lines.push(`function ${fnName}(ctx) {`);
  lines.push(`  // operation: ${explain.operationId}`);
  lines.push(`  // instruction: ${explain.instruction ?? 'read-only'}`);

  const compute = Array.isArray(explain.compute) ? explain.compute : [];
  if (compute.length === 0) {
    lines.push('  // no compute steps');
    lines.push('  return {};');
    lines.push('}');
    return lines.join('\n');
  }

  lines.push('');
  for (const rawStep of compute) {
    const step = rawStep && typeof rawStep === 'object' && !Array.isArray(rawStep)
      ? (rawStep as Record<string, unknown>)
      : { name: 'unknown', compute: 'unknown' };
    lines.push(`  ${formatComputeStep(step)}`);
  }
  lines.push('');
  const names = compute
    .map((rawStep) =>
      rawStep && typeof rawStep === 'object' && !Array.isArray(rawStep) && typeof (rawStep as Record<string, unknown>).name === 'string'
        ? (rawStep as Record<string, unknown>).name as string
        : null,
    )
    .filter((name): name is string => !!name);
  lines.push(`  return { ${names.join(', ')} };`);
  lines.push('}');
  return lines.join('\n');
}

export function ComputeDevTab({ isWorking }: ComputeDevTabProps) {
  const [protocols, setProtocols] = useState<ProtocolSummary[]>([]);
  const [protocolId, setProtocolId] = useState('');
  const [operations, setOperations] = useState<MetaOperationSummary[]>([]);
  const [operationId, setOperationId] = useState('');
  const [explain, setExplain] = useState<MetaOperationExplain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const idlRegistryView = await listIdlProtocols();
        const list = idlRegistryView.protocols.map((protocol) => ({
          id: protocol.id,
          name: protocol.name,
          status: protocol.status,
        }));
        if (cancelled) {
          return;
        }
        setProtocols(list);
        const firstActive = list.find((item) => item.status === 'active') ?? list[0] ?? null;
        setProtocolId(firstActive?.id ?? '');
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : String(caught);
          setError(message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!protocolId) {
      setOperations([]);
      setOperationId('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const listed = await listMetaOperations({ protocolId });
        if (cancelled) {
          return;
        }
        setOperations(listed.operations);
        setOperationId(listed.operations[0]?.operationId ?? '');
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : String(caught);
          setError(message);
          setOperations([]);
          setOperationId('');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [protocolId]);

  useEffect(() => {
    if (!protocolId || !operationId) {
      setExplain(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const nextExplain = await explainMetaOperation({ protocolId, operationId });
        if (!cancelled) {
          setExplain(nextExplain);
        }
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : String(caught);
          setError(message);
          setExplain(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [protocolId, operationId]);

  const pseudoFunction = useMemo(() => {
    if (!explain) {
      return '';
    }
    return renderPseudoFunction(explain);
  }, [explain]);

  return (
    <section className="compute-shell" aria-live="polite">
      <div className="compute-controls">
        <label>
          Protocol
          <select value={protocolId} onChange={(event) => setProtocolId(event.target.value)} disabled={isWorking || loading}>
            {protocols.map((protocol) => (
              <option key={protocol.id} value={protocol.id}>
                {protocol.name} ({protocol.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          Operation
          <select value={operationId} onChange={(event) => setOperationId(event.target.value)} disabled={isWorking || loading || operations.length === 0}>
            {operations.map((operation) => (
              <option key={operation.operationId} value={operation.operationId}>
                {operation.operationId}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="compute-error">Error: {error}</p> : null}

      {explain ? (
        <div className="compute-panels">
          <article className="compute-panel">
            <h3>Pseudo JS</h3>
            <pre>{pseudoFunction}</pre>
          </article>
          <article className="compute-panel">
            <h3>Raw Compute Steps</h3>
            <pre>{JSON.stringify(explain.compute, null, 2)}</pre>
          </article>
        </div>
      ) : (
        <p className="compute-empty">{loading ? 'Loading compute spec...' : 'Select a protocol and operation.'}</p>
      )}
    </section>
  );
}
