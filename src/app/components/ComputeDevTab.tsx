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
  computePath: string | null;
};

type ComputeDevTabProps = {
  isWorking: boolean;
};

const ALL_LIBRARIES_KEY = '__all_libraries__';

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

function normalizeComputeStep(rawStep: Record<string, unknown>): Record<string, unknown> {
  if (typeof rawStep.compute === 'string') {
    return rawStep;
  }

  const name = typeof rawStep.name === 'string' ? rawStep.name : 'result';
  if ('add' in rawStep) {
    return { name, compute: 'math.add', values: rawStep.add };
  }
  if ('sum' in rawStep) {
    return { name, compute: 'math.sum', values: rawStep.sum };
  }
  if ('mul' in rawStep) {
    return { name, compute: 'math.mul', values: rawStep.mul };
  }
  if ('sub' in rawStep) {
    return { name, compute: 'math.sub', values: rawStep.sub };
  }
  if ('floor_div' in rawStep) {
    const values = Array.isArray(rawStep.floor_div) ? rawStep.floor_div : [];
    return {
      name,
      compute: 'math.floor_div',
      dividend: values[0],
      divisor: values[1],
    };
  }
  if ('if' in rawStep && rawStep.if && typeof rawStep.if === 'object' && !Array.isArray(rawStep.if)) {
    const ifSpec = rawStep.if as Record<string, unknown>;
    return {
      name,
      compute: 'logic.if',
      condition: ifSpec.condition,
      then: ifSpec.then,
      else: ifSpec.else,
    };
  }
  if ('coalesce' in rawStep) {
    return {
      name,
      compute: 'coalesce',
      values: rawStep.coalesce,
    };
  }
  if ('eq' in rawStep || 'ne' in rawStep || 'gt' in rawStep || 'gte' in rawStep || 'lt' in rawStep || 'lte' in rawStep) {
    const key = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].find((entry) => entry in rawStep);
    const values = key && Array.isArray(rawStep[key]) ? rawStep[key] : [];
    const kindMap: Record<string, string> = {
      eq: 'compare.equals',
      ne: 'compare.not_equals',
      gt: 'compare.gt',
      gte: 'compare.gte',
      lt: 'compare.lt',
      lte: 'compare.lte',
    };
    return {
      name,
      compute: key ? kindMap[key] : 'unknown',
      left: values[0],
      right: values[1],
    };
  }
  if ('pda' in rawStep) {
    const pda = rawStep.pda && typeof rawStep.pda === 'object' && !Array.isArray(rawStep.pda)
      ? (rawStep.pda as Record<string, unknown>)
      : {};
    return {
      name,
      compute: 'pda(seed_spec)',
      ...pda,
    };
  }
  if ('compute' in rawStep) {
    return rawStep;
  }

  return { ...rawStep, name, compute: 'unknown' };
}

function renderPseudoFunction(functionName: string, instruction: string | null, computeSteps: Record<string, unknown>[]): string {
  const lines: string[] = [];
  lines.push(`function ${functionName}(ctx) {`);
  lines.push(`  // instruction: ${instruction ?? 'read-only'}`);

  if (computeSteps.length === 0) {
    lines.push('  // no compute steps');
    lines.push('  return {};');
    lines.push('}');
    return lines.join('\n');
  }

  lines.push('');
  for (const rawStep of computeSteps) {
    const step = normalizeComputeStep(rawStep);
    lines.push(`  ${formatComputeStep(step)}`);
  }
  lines.push('');
  const names = computeSteps
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

function renderAllLibrariesPseudo(libraries: Record<string, Record<string, unknown>[]>): string {
  const names = Object.keys(libraries);
  if (names.length === 0) {
    return '// no compute libraries';
  }
  return names
    .map((libraryName) => {
      const functionName = libraryName.replace(/[^a-zA-Z0-9]+/g, '_');
      return renderPseudoFunction(functionName, null, libraries[libraryName] ?? []);
    })
    .join('\n\n');
}

type ComputeLibraryFile = {
  kind: string;
  libraries: Record<string, Record<string, unknown>[]>;
};

function computePathFromMetaPath(metaPath: string | undefined): string | null {
  if (!metaPath || !metaPath.endsWith('.meta.json')) {
    return null;
  }
  return metaPath.replace(/^\/idl\//, '/compute/').replace(/\.meta\.json$/, '.compute.json');
}

export function ComputeDevTab({ isWorking }: ComputeDevTabProps) {
  const [protocols, setProtocols] = useState<ProtocolSummary[]>([]);
  const [protocolId, setProtocolId] = useState('');
  const [operations, setOperations] = useState<MetaOperationSummary[]>([]);
  const [operationComputeCounts, setOperationComputeCounts] = useState<Record<string, number>>({});
  const [operationId, setOperationId] = useState('');
  const [explain, setExplain] = useState<MetaOperationExplain | null>(null);
  const [computeLibraries, setComputeLibraries] = useState<Record<string, Record<string, unknown>[]>>({});
  const [selectedLibrary, setSelectedLibrary] = useState('');
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const idlRegistryView = await listIdlProtocols();
        const list = idlRegistryView.protocols.map((protocol) => ({
          id: protocol.id,
          name: protocol.name,
          status: protocol.status,
          computePath: computePathFromMetaPath(
            typeof (protocol as unknown as Record<string, unknown>).metaPath === 'string'
              ? ((protocol as unknown as Record<string, unknown>).metaPath as string)
              : undefined,
          ),
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

  const selectedProtocol = useMemo(
    () => protocols.find((protocol) => protocol.id === protocolId) ?? null,
    [protocols, protocolId],
  );

  useEffect(() => {
    if (!protocolId) {
      setOperations([]);
      setOperationComputeCounts({});
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
        const countEntries = await Promise.all(
          listed.operations.map(async (operation) => {
            const details = await explainMetaOperation({ protocolId, operationId: operation.operationId });
            return [operation.operationId, Array.isArray(details.compute) ? details.compute.length : 0] as const;
          }),
        );
        if (cancelled) {
          return;
        }
        const counts = Object.fromEntries(countEntries);
        setOperationComputeCounts(counts);
        const preferred =
          listed.operations.find((operation) => (counts[operation.operationId] ?? 0) > 0)?.operationId ??
          listed.operations[0]?.operationId ??
          '';
        setOperationId(preferred);
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : String(caught);
          setError(message);
          setOperations([]);
          setOperationComputeCounts({});
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
    if (!selectedProtocol || !selectedProtocol.computePath) {
      setComputeLibraries({});
      setSelectedLibrary('');
      setLibraryError(null);
      return;
    }
    const computePath = selectedProtocol.computePath;
    let cancelled = false;
    setLibraryLoading(true);
    setLibraryError(null);
    void (async () => {
      try {
        const response = await fetch(computePath);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${computePath} (${response.status})`);
        }
        const raw = (await response.json()) as unknown;
        const parsed = raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as ComputeLibraryFile)
          : null;
        const libraries =
          parsed && parsed.libraries && typeof parsed.libraries === 'object' && !Array.isArray(parsed.libraries)
            ? parsed.libraries
            : {};

        if (cancelled) {
          return;
        }
        setComputeLibraries(libraries);
        const hasLibraries = Object.keys(libraries).length > 0;
        setSelectedLibrary(hasLibraries ? ALL_LIBRARIES_KEY : '');
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : String(caught);
          setLibraryError(message);
          setComputeLibraries({});
          setSelectedLibrary('');
        }
      } finally {
        if (!cancelled) {
          setLibraryLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProtocol]);

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

  const operationPseudoFunction = useMemo(() => {
    if (!explain) {
      return '';
    }
    const functionName = `${explain.protocolId.replace(/[^a-zA-Z0-9]+/g, '_')}_${explain.operationId}`;
    const compute = Array.isArray(explain.compute)
      ? explain.compute.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
      : [];
    return renderPseudoFunction(functionName, explain.instruction ?? null, compute);
  }, [explain]);

  const libraryNames = useMemo(() => Object.keys(computeLibraries), [computeLibraries]);
  const selectedLibrarySteps = useMemo(
    () =>
      selectedLibrary && selectedLibrary !== ALL_LIBRARIES_KEY
        ? computeLibraries[selectedLibrary] ?? []
        : [],
    [computeLibraries, selectedLibrary],
  );
  const libraryPseudoFunction = useMemo(() => {
    if (!selectedLibrary) {
      return '';
    }
    if (selectedLibrary === ALL_LIBRARIES_KEY) {
      return renderAllLibrariesPseudo(computeLibraries);
    }
    const functionName = selectedLibrary.replace(/[^a-zA-Z0-9]+/g, '_');
    return renderPseudoFunction(functionName, null, selectedLibrarySteps);
  }, [selectedLibrary, selectedLibrarySteps, computeLibraries]);
  const libraryRawCompute = useMemo(() => {
    if (!selectedLibrary) {
      return null;
    }
    if (selectedLibrary === ALL_LIBRARIES_KEY) {
      return computeLibraries;
    }
    return selectedLibrarySteps;
  }, [selectedLibrary, selectedLibrarySteps, computeLibraries]);

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
                {operation.operationId} ({operationComputeCounts[operation.operationId] ?? 0} compute)
              </option>
            ))}
          </select>
        </label>
        <label>
          Library
          <select
            value={selectedLibrary}
            onChange={(event) => setSelectedLibrary(event.target.value)}
            disabled={isWorking || libraryLoading || libraryNames.length === 0}
          >
            {libraryNames.length === 0 ? (
              <option value="">No compute libraries</option>
            ) : (
              <>
                <option value={ALL_LIBRARIES_KEY}>
                  All libraries (
                  {libraryNames.reduce((sum, libraryName) => sum + (computeLibraries[libraryName]?.length ?? 0), 0)}
                  {' '}steps)
                </option>
                {libraryNames.map((libraryName) => (
                  <option key={libraryName} value={libraryName}>
                    {libraryName} ({computeLibraries[libraryName]?.length ?? 0} steps)
                  </option>
                ))}
              </>
            )}
          </select>
        </label>
      </div>

      {error ? <p className="compute-error">Error: {error}</p> : null}
      {libraryError ? <p className="compute-error">Library error: {libraryError}</p> : null}

      {explain || selectedLibrary ? (
        <div className="compute-panels">
          {explain ? (
            <>
              <article className="compute-panel">
                <h3>Operation Pseudo JS</h3>
                <pre>{operationPseudoFunction}</pre>
              </article>
              <article className="compute-panel">
                <h3>Operation Raw Compute</h3>
                <pre>{JSON.stringify(explain.compute, null, 2)}</pre>
              </article>
            </>
          ) : null}
          {selectedLibrary ? (
            <>
              <article className="compute-panel">
                <h3>Library Pseudo JS</h3>
                <pre>{libraryPseudoFunction}</pre>
              </article>
              <article className="compute-panel">
                <h3>Library Raw Compute</h3>
                <pre>{JSON.stringify(libraryRawCompute, null, 2)}</pre>
              </article>
            </>
          ) : null}
        </div>
      ) : (
        <p className="compute-empty">{loading || libraryLoading ? 'Loading compute spec...' : 'Select a protocol and operation.'}</p>
      )}
    </section>
  );
}
