import { useEffect, useMemo, useState } from 'react';
import { listIdlProtocols } from '@brij-digital/apppack-runtime/codamaFacade';
import {
  explainRuntimeOperation,
  listRuntimeOperations,
  loadRuntimePack,
  type RuntimePack,
  type RuntimeOperationExplain as MetaOperationExplain,
  type RuntimeOperationSummary as MetaOperationSummary,
} from '@brij-digital/apppack-runtime/runtimeOperationRuntime';

type ProtocolSummary = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
};

type ComputeDevTabProps = {
  isWorking: boolean;
};

type ExplainedTransformStep = Extract<MetaOperationExplain['steps'][number], { phase: 'transform' }>;
type ComputeSection = 'overview' | 'writes' | 'views' | 'transforms';
type RuntimeSpecOperation = {
  summary: MetaOperationSummary;
  explain: MetaOperationExplain;
  transformSteps: Record<string, unknown>[];
  pseudoFunction: string;
};
type RuntimeNamedTransform = {
  name: string;
  steps: Record<string, unknown>[];
  pseudoFunction: string;
};

function extractTransformSteps(explain: MetaOperationExplain): Record<string, unknown>[] {
  return Array.isArray(explain.steps)
    ? explain.steps
      .filter((entry): entry is ExplainedTransformStep =>
        !!entry
        && typeof entry === 'object'
        && !Array.isArray(entry)
        && (entry as { phase?: string }).phase === 'transform'
        && !!(entry as { step?: unknown }).step
        && typeof (entry as { step?: unknown }).step === 'object'
        && !Array.isArray((entry as { step?: unknown }).step),
      )
      .map((entry) => entry.step)
    : [];
}

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
  const kind = typeof step.kind === 'string' ? step.kind : 'unknown';
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
    .filter(([key]) => key !== 'name' && key !== 'kind')
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(', ');
  return `const ${name} = ${kind}({ ${args} });`;
}

function normalizeComputeStep(rawStep: Record<string, unknown>): Record<string, unknown> {
  if (typeof rawStep.kind === 'string') {
    return rawStep;
  }

  const name = typeof rawStep.name === 'string' ? rawStep.name : 'result';
  if ('add' in rawStep) {
    return { name, kind: 'math.add', values: rawStep.add };
  }
  if ('sum' in rawStep) {
    return { name, kind: 'math.sum', values: rawStep.sum };
  }
  if ('mul' in rawStep) {
    return { name, kind: 'math.mul', values: rawStep.mul };
  }
  if ('sub' in rawStep) {
    return { name, kind: 'math.sub', values: rawStep.sub };
  }
  if ('floor_div' in rawStep) {
    const values = Array.isArray(rawStep.floor_div) ? rawStep.floor_div : [];
    return {
      name,
      kind: 'math.floor_div',
      dividend: values[0],
      divisor: values[1],
    };
  }
  if ('if' in rawStep && rawStep.if && typeof rawStep.if === 'object' && !Array.isArray(rawStep.if)) {
    const ifSpec = rawStep.if as Record<string, unknown>;
    return {
      name,
      kind: 'logic.if',
      condition: ifSpec.condition,
      then: ifSpec.then,
      else: ifSpec.else,
    };
  }
  if ('coalesce' in rawStep) {
    return {
      name,
      kind: 'coalesce',
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
      kind: key ? kindMap[key] : 'unknown',
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
      kind: 'pda(seed_spec)',
      ...pda,
    };
  }
  if ('kind' in rawStep) {
    return rawStep;
  }

  return { ...rawStep, name, kind: 'unknown' };
}

function renderPseudoFunction(functionName: string, instruction: string | null, transformSteps: Record<string, unknown>[]): string {
  const lines: string[] = [];
  lines.push(`function ${functionName}(ctx) {`);
  lines.push(`  // instruction: ${instruction ?? 'read-only'}`);

  if (transformSteps.length === 0) {
    lines.push('  // no transform steps');
    lines.push('  return {};');
    lines.push('}');
    return lines.join('\n');
  }

  lines.push('');
  for (const rawStep of transformSteps) {
    const step = normalizeComputeStep(rawStep);
    lines.push(`  ${formatComputeStep(step)}`);
  }
  lines.push('');
  const names = transformSteps
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

function getDefaultSection(options: {
  writes: RuntimeSpecOperation[];
  views: RuntimeSpecOperation[];
  transforms: RuntimeNamedTransform[];
}): ComputeSection {
  if (options.writes.length > 0) {
    return 'writes';
  }
  if (options.views.length > 0) {
    return 'views';
  }
  if (options.transforms.length > 0) {
    return 'transforms';
  }
  return 'overview';
}

export function ComputeDevTab({ isWorking }: ComputeDevTabProps) {
  const [protocols, setProtocols] = useState<ProtocolSummary[]>([]);
  const [protocolId, setProtocolId] = useState('');
  const [runtimePack, setRuntimePack] = useState<RuntimePack | null>(null);
  const [operations, setOperations] = useState<RuntimeSpecOperation[]>([]);
  const [selectedSection, setSelectedSection] = useState<ComputeSection>('overview');
  const [selectedEntryId, setSelectedEntryId] = useState('');
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

  const selectedProtocol = useMemo(
    () => protocols.find((protocol) => protocol.id === protocolId) ?? null,
    [protocols, protocolId],
  );

  function handleProtocolSelect(nextProtocolId: string) {
    setProtocolId(nextProtocolId);
    setRuntimePack(null);
    setOperations([]);
    setSelectedSection('overview');
    setSelectedEntryId('');
    setError(null);
  }

  useEffect(() => {
    if (!protocolId) {
      setRuntimePack(null);
      setOperations([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRuntimePack(null);
    setOperations([]);
    void (async () => {
      try {
        const [pack, listed] = await Promise.all([
          loadRuntimePack(protocolId),
          listRuntimeOperations({ protocolId }),
        ]);
        const explainedOperations = await Promise.all(
          listed.operations.map(async (operation) => {
            const details = await explainRuntimeOperation({ protocolId, operationId: operation.operationId });
            const transformSteps = extractTransformSteps(details);
            return {
              summary: operation,
              explain: details,
              transformSteps,
              pseudoFunction: renderPseudoFunction(
                `${details.protocolId.replace(/[^a-zA-Z0-9]+/g, '_')}_${details.operationId}`,
                details.instruction ?? details.loadInstruction ?? null,
                transformSteps,
              ),
            } satisfies RuntimeSpecOperation;
          }),
        );
        if (cancelled) {
          return;
        }
        const nextNamedTransforms = Object.entries(pack.transforms ?? {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, steps]) => {
            const normalizedSteps = steps.filter(
              (step): step is Record<string, unknown> => !!step && typeof step === 'object' && !Array.isArray(step),
            );
            return {
              name,
              steps: normalizedSteps,
              pseudoFunction: renderPseudoFunction(
                `${pack.protocolId.replace(/[^a-zA-Z0-9]+/g, '_')}_${name}`,
                null,
                normalizedSteps,
              ),
            } satisfies RuntimeNamedTransform;
          });
        const nextWrites = explainedOperations.filter((operation) => operation.summary.executionKind === 'write');
        const nextViews = explainedOperations.filter((operation) => operation.summary.executionKind === 'view');
        const defaultSection = getDefaultSection({
          writes: nextWrites,
          views: nextViews,
          transforms: nextNamedTransforms,
        });
        setRuntimePack(pack);
        setOperations(explainedOperations);
        setSelectedSection(defaultSection);
        setSelectedEntryId(
          defaultSection === 'writes'
            ? (nextWrites[0]?.summary.operationId ?? '')
            : defaultSection === 'views'
              ? (nextViews[0]?.summary.operationId ?? '')
              : defaultSection === 'transforms'
                ? (nextNamedTransforms[0]?.name ?? '')
                : '',
        );
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : String(caught);
          setError(message);
          setRuntimePack(null);
          setOperations([]);
          setSelectedSection('overview');
          setSelectedEntryId('');
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

  const writes = useMemo(
    () => operations.filter((operation) => operation.summary.executionKind === 'write'),
    [operations],
  );

  const views = useMemo(
    () => operations.filter((operation) => operation.summary.executionKind === 'view'),
    [operations],
  );

  const namedTransforms = useMemo(
    () =>
      Object.entries(runtimePack?.transforms ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, steps]) => {
          const normalizedSteps = steps.filter(
            (step): step is Record<string, unknown> => !!step && typeof step === 'object' && !Array.isArray(step),
          );
          return {
            name,
            steps: normalizedSteps,
            pseudoFunction: renderPseudoFunction(
              `${runtimePack?.protocolId.replace(/[^a-zA-Z0-9]+/g, '_') ?? 'runtime'}_${name}`,
              null,
              normalizedSteps,
            ),
          } satisfies RuntimeNamedTransform;
        }),
    [runtimePack],
  );

  const selectedSectionOptions = useMemo(
    () => [
      { value: 'overview' as const, label: 'Overview' },
      { value: 'writes' as const, label: `Writes (${writes.length})` },
      { value: 'views' as const, label: `Views (${views.length})` },
      { value: 'transforms' as const, label: `Named Transforms (${namedTransforms.length})` },
    ],
    [namedTransforms.length, views.length, writes.length],
  );

  const selectedEntryOptions = useMemo(() => {
    if (selectedSection === 'writes') {
      return writes.map((operation) => ({
        value: operation.summary.operationId,
        label: `${operation.summary.operationId} (${operation.transformSteps.length} transform step${operation.transformSteps.length === 1 ? '' : 's'})`,
      }));
    }
    if (selectedSection === 'views') {
      return views.map((operation) => ({
        value: operation.summary.operationId,
        label: `${operation.summary.operationId} (${operation.transformSteps.length} transform step${operation.transformSteps.length === 1 ? '' : 's'})`,
      }));
    }
    if (selectedSection === 'transforms') {
      return namedTransforms.map((transform) => ({
        value: transform.name,
        label: `${transform.name} (${transform.steps.length} step${transform.steps.length === 1 ? '' : 's'})`,
      }));
    }
    return [];
  }, [namedTransforms, selectedSection, views, writes]);

  const selectedOperation = useMemo(() => {
    if (selectedSection === 'writes') {
      return writes.find((operation) => operation.summary.operationId === selectedEntryId) ?? null;
    }
    if (selectedSection === 'views') {
      return views.find((operation) => operation.summary.operationId === selectedEntryId) ?? null;
    }
    return null;
  }, [selectedEntryId, selectedSection, views, writes]);

  const selectedTransform = useMemo(() => {
    if (selectedSection !== 'transforms') {
      return null;
    }
    return namedTransforms.find((transform) => transform.name === selectedEntryId) ?? null;
  }, [namedTransforms, selectedEntryId, selectedSection]);

  function handleSectionSelect(nextSection: ComputeSection) {
    setSelectedSection(nextSection);
    if (nextSection === 'writes') {
      setSelectedEntryId(writes[0]?.summary.operationId ?? '');
      return;
    }
    if (nextSection === 'views') {
      setSelectedEntryId(views[0]?.summary.operationId ?? '');
      return;
    }
    if (nextSection === 'transforms') {
      setSelectedEntryId(namedTransforms[0]?.name ?? '');
      return;
    }
    setSelectedEntryId('');
  }

  return (
    <section className="compute-shell" aria-live="polite">
      <div className="compute-controls">
        <label>
          Protocol
          <select value={protocolId} onChange={(event) => handleProtocolSelect(event.target.value)} disabled={isWorking || loading}>
            {protocols.map((protocol) => (
              <option key={protocol.id} value={protocol.id}>
                {protocol.name} ({protocol.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          Section
          <select
            value={selectedSection}
            onChange={(event) => handleSectionSelect(event.target.value as ComputeSection)}
            disabled={isWorking || loading || !runtimePack}
          >
            {selectedSectionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {selectedSection !== 'overview' ? (
          <label>
            Entry
            <select
              value={selectedEntryId}
              onChange={(event) => setSelectedEntryId(event.target.value)}
              disabled={isWorking || loading || selectedEntryOptions.length === 0}
            >
              {selectedEntryOptions.length > 0 ? (
                selectedEntryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))
              ) : (
                <option value="">No entries</option>
              )}
            </select>
          </label>
        ) : null}
      </div>

      {error ? <p className="compute-error">Error: {error}</p> : null}
      {selectedProtocol ? (
        <p className="compute-empty">
          Runtime spec is loaded directly from `{selectedProtocol.id}.runtime.json` agent packs.
        </p>
      ) : null}
      {runtimePack ? (
        <div className="compute-spec">
          <article className="compute-panel">
            <h3>Runtime Pack</h3>
            <div className="compute-meta-grid">
              <div><strong>Protocol</strong><span>{runtimePack.protocolId}</span></div>
              <div><strong>Program</strong><code>{runtimePack.programId}</code></div>
              <div><strong>Codama</strong><code>{runtimePack.codamaPath}</code></div>
              <div><strong>Writes</strong><span>{writes.length}</span></div>
              <div><strong>Views</strong><span>{views.length}</span></div>
              <div><strong>Named transforms</strong><span>{namedTransforms.length}</span></div>
            </div>
          </article>

          {selectedSection === 'overview' ? (
            <article className="compute-panel">
              <h3>Pack JSON</h3>
              <pre>{JSON.stringify(runtimePack, null, 2)}</pre>
            </article>
          ) : null}

          {selectedSection === 'writes' ? (
            <article className="compute-panel">
              <h3>Write Operation</h3>
              {selectedOperation ? (
                <div className="compute-entry-body">
                  <p className="compute-empty">
                    <strong>{selectedOperation.summary.operationId}</strong>
                    {' '}
                    with
                    {' '}
                    {selectedOperation.transformSteps.length}
                    {' '}
                    transform step{selectedOperation.transformSteps.length === 1 ? '' : 's'}.
                  </p>
                  <pre>{selectedOperation.pseudoFunction}</pre>
                  <pre>{JSON.stringify(selectedOperation.explain, null, 2)}</pre>
                </div>
              ) : (
                <p className="compute-empty">No write operations in this runtime pack.</p>
              )}
            </article>
          ) : null}

          {selectedSection === 'views' ? (
            <article className="compute-panel">
              <h3>View Operation</h3>
              {selectedOperation ? (
                <div className="compute-entry-body">
                  <p className="compute-empty">
                    <strong>{selectedOperation.summary.operationId}</strong>
                    {' '}
                    with
                    {' '}
                    {selectedOperation.transformSteps.length}
                    {' '}
                    transform step{selectedOperation.transformSteps.length === 1 ? '' : 's'}.
                  </p>
                  <pre>{selectedOperation.pseudoFunction}</pre>
                  <pre>{JSON.stringify(selectedOperation.explain, null, 2)}</pre>
                </div>
              ) : (
                <p className="compute-empty">No view operations in this runtime pack.</p>
              )}
            </article>
          ) : null}

          {selectedSection === 'transforms' ? (
            <article className="compute-panel">
              <h3>Named Transform</h3>
              {selectedTransform ? (
                <div className="compute-entry-body">
                  <p className="compute-empty">
                    <strong>{selectedTransform.name}</strong>
                    {' '}
                    with
                    {' '}
                    {selectedTransform.steps.length}
                    {' '}
                    step{selectedTransform.steps.length === 1 ? '' : 's'}.
                  </p>
                  <pre>{selectedTransform.pseudoFunction}</pre>
                  <pre>{JSON.stringify(selectedTransform.steps, null, 2)}</pre>
                </div>
              ) : (
                <p className="compute-empty">No named reusable transforms in this runtime pack.</p>
              )}
            </article>
          ) : null}
        </div>
      ) : (
        <p className="compute-empty">{loading ? 'Loading runtime spec...' : 'Select a protocol.'}</p>
      )}
    </section>
  );
}
