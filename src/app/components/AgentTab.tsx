import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  sendPreparedExecutionDraft,
  simulatePreparedExecutionDraft,
  type PreparedExecutionDraft,
} from '../runtimeSubmit';

const COLLAPSED_PREVIEW_LINE_COUNT = 20;

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_MODEL_PRESETS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-5-haiku-20241022',
] as const;
const AGENT_API_KEY_COOKIE = 'agent_anthropic_api_key';

type AgentTabProps = {
  viewApiBaseUrl: string;
};

type RegistryProtocol = {
  id: string;
  name?: string;
  status?: string;
};

type RegistryResponse = {
  protocols?: RegistryProtocol[];
};

type AgentTranscriptEntry =
  | {
      role: 'assistant';
      kind: 'text';
      text: string;
    }
  | {
      role: 'assistant';
      kind: 'tool_use';
      toolName: string;
      input: Record<string, unknown>;
    }
  | {
      role: 'tool';
      kind: 'tool_result';
      toolName: string;
      result: unknown;
    }
  | {
      role: 'system';
      kind: 'interaction';
      interactionId: string;
      interactionType: 'wallet_submit_draft';
      status: 'pending';
      label: string;
      draftId: string;
      operationId: string | null;
      instructionName: string | null;
      message: string | null;
    }
  | {
      role: 'system';
      kind: 'interaction_result';
      interactionId: string;
      interactionType: 'wallet_submit_draft';
      status: 'confirmed' | 'failed';
      signature: string | null;
      explorerUrl: string | null;
      error: string | null;
    };

type AgentRunResponse = {
  ok: boolean;
  session_id?: string;
  final_text?: string;
  transcript?: AgentTranscriptEntry[];
  error?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

function parsePreparedExecutionDraft(result: unknown): PreparedExecutionDraft | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const candidate = result as Record<string, unknown>;
  if (
    typeof candidate.protocolId === 'string'
    && typeof candidate.operationId === 'string'
    && typeof candidate.args === 'object'
    && candidate.args !== null
    && typeof candidate.accounts === 'object'
    && candidate.accounts !== null
  ) {
    return candidate as unknown as PreparedExecutionDraft;
  }
  return null;
}

function getDraftId(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const draftId = (result as Record<string, unknown>).draft_id;
  return typeof draftId === 'string' ? draftId : null;
}

type AgentStreamEvent =
  | {
      type: 'session';
      session_id: string;
      resumed: boolean;
    }
  | {
      type: 'status';
      message: string;
    }
  | {
      type: 'assistant_text';
      text: string;
    }
  | {
      type: 'tool_use';
      toolName: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      toolName: string;
      result: unknown;
    }
  | {
      type: 'interaction';
      interaction: Extract<AgentTranscriptEntry, { kind: 'interaction' }>;
    }
  | {
      type: 'interaction_result';
      interaction_result: Extract<AgentTranscriptEntry, { kind: 'interaction_result' }>;
    }
  | {
      type: 'usage';
      usage: AgentRunResponse['usage'] | null;
    }
  | {
      type: 'final';
      session_id: string;
      final_text: string;
      transcript: AgentTranscriptEntry[];
      usage: AgentRunResponse['usage'] | null;
    }
  | {
      type: 'error';
      error: string;
    };

function readCookie(name: string): string {
  if (typeof document === 'undefined') {
    return '';
  }
  const prefix = `${name}=`;
  const part = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(prefix));
  if (!part) {
    return '';
  }
  return decodeURIComponent(part.slice(prefix.length));
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${60 * 60 * 24 * 30}; Path=/; SameSite=Lax; Secure`;
}

function clearCookie(name: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
}

function ExpandablePre({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => text.split('\n'), [text]);
  const isExpandable = lines.length > COLLAPSED_PREVIEW_LINE_COUNT;
  const displayText = isExpandable && !expanded
    ? `${lines.slice(0, COLLAPSED_PREVIEW_LINE_COUNT).join('\n')}\n...`
    : text;

  return (
    <div>
      <pre>{displayText}</pre>
      {isExpandable ? (
        <div className="agent-actions">
          <button type="button" onClick={() => setExpanded((current) => !current)}>
            {expanded ? 'Collapse' : `Expand (${lines.length - COLLAPSED_PREVIEW_LINE_COUNT} more lines)`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

type VisibleTranscriptEntry =
  | {
      kind: 'assistant_text';
      key: string;
      text: string;
    };

export function AgentTab({ viewApiBaseUrl }: AgentTabProps) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { publicKey } = wallet;
  const [protocols, setProtocols] = useState<RegistryProtocol[]>([]);
  const [protocolId, setProtocolId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_ANTHROPIC_MODEL);
  const [prompt, setPrompt] = useState('Find the best capability to inspect a market, then compute a preview before drafting an execution.');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<AgentTranscriptEntry[]>([]);
  const [usageText, setUsageText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isDraftActionLoading, setIsDraftActionLoading] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const trimmedBaseUrl = useMemo(() => viewApiBaseUrl.trim().replace(/\/+$/, ''), [viewApiBaseUrl]);
  const walletPublicKey = publicKey?.toBase58() ?? null;
  const draftRecords = useMemo(() => transcript.flatMap((entry, index) => {
    if (entry.role !== 'tool' || entry.kind !== 'tool_result' || entry.toolName !== 'draft_execution') {
      return [];
    }
    const draft = parsePreparedExecutionDraft(entry.result);
    if (!draft) {
      return [];
    }
    return [{ index, draft, draftId: getDraftId(entry.result) }];
  }), [transcript]);
  const latestDraft = useMemo<PreparedExecutionDraft | null>(() => {
    return draftRecords.at(-1)?.draft ?? null;
  }, [draftRecords]);
  const draftById = useMemo(() => {
    return new Map(
      draftRecords
        .filter((record) => typeof record.draftId === 'string')
        .map((record) => [record.draftId as string, record.draft]),
    );
  }, [draftRecords]);
  const interactionResultById = useMemo(() => {
    return new Map(
      transcript.flatMap((entry) => (
        entry.role === 'system' && entry.kind === 'interaction_result'
          ? [[entry.interactionId, entry] as const]
          : []
      )),
    );
  }, [transcript]);
  const latestInteraction = useMemo(() => {
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      const entry = transcript[index];
      if (entry.role === 'system' && entry.kind === 'interaction') {
        return entry;
      }
    }
    return null;
  }, [transcript]);
  const latestInteractionResult = useMemo(() => {
    if (!latestInteraction) {
      return null;
    }
    return interactionResultById.get(latestInteraction.interactionId) ?? null;
  }, [interactionResultById, latestInteraction]);
  const latestInteractionDraft = useMemo(() => {
    if (!latestInteraction) {
      return latestDraft;
    }
    return draftById.get(latestInteraction.draftId) ?? latestDraft;
  }, [draftById, latestDraft, latestInteraction]);
  const visibleTranscript = useMemo<VisibleTranscriptEntry[]>(() => transcript.reduce<VisibleTranscriptEntry[]>((items, entry, index) => {
    if (entry.role === 'assistant' && entry.kind === 'text') {
      items.push({
        kind: 'assistant_text',
        key: `assistant-${index}`,
        text: entry.text,
      });
    }

    return items;
  }, []), [transcript]);

  useEffect(() => {
    setApiKey(readCookie(AGENT_API_KEY_COOKIE));
  }, []);

  useEffect(() => {
    if (apiKey.trim().length > 0) {
      writeCookie(AGENT_API_KEY_COOKIE, apiKey);
      return;
    }
    clearCookie(AGENT_API_KEY_COOKIE);
  }, [apiKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadProtocols() {
      const response = await fetch('/idl/registry.json');
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as RegistryResponse;
      const activeProtocols = (body.protocols ?? []).filter((protocol) => protocol.status !== 'inactive');
      if (cancelled) {
        return;
      }
      setProtocols(activeProtocols);
      if (activeProtocols.length > 0) {
        setProtocolId((current) => current || activeProtocols[0]!.id);
      }
    }
    void loadProtocols();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setErrorText(null);
    if (!sessionId) {
      setUsageText(null);
      setTranscript([]);
      setStatusText('Starting new session...');
    } else {
      setStatusText('Continuing session...');
    }

    try {
      const response = await fetch(`${trimmedBaseUrl}/agent/run/stream`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'anthropic',
          model,
          apiKey,
          sessionId,
          protocolId: protocolId || null,
          walletPublicKey,
          prompt,
        }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as AgentRunResponse | null;
        throw new Error(body?.error ?? `Agent run failed with ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) {
            continue;
          }
          const event = JSON.parse(line) as AgentStreamEvent;
          if (event.type === 'session') {
            setSessionId(event.session_id);
            setStatusText(event.resumed ? 'Session resumed.' : 'Session created.');
            continue;
          }
          if (event.type === 'status') {
            setStatusText(event.message);
            continue;
          }
          if (event.type === 'assistant_text') {
            setTranscript((current) => [
              ...current,
              {
                role: 'assistant',
                kind: 'text',
                text: event.text,
              },
            ]);
            continue;
          }
          if (event.type === 'tool_use') {
            setTranscript((current) => [
              ...current,
              {
                role: 'assistant',
                kind: 'tool_use',
                toolName: event.toolName,
                input: event.input,
              },
            ]);
            continue;
          }
          if (event.type === 'tool_result') {
            setTranscript((current) => [
              ...current,
              {
                role: 'tool',
                kind: 'tool_result',
                toolName: event.toolName,
                result: event.result,
              },
            ]);
            continue;
          }
          if (event.type === 'interaction') {
            setTranscript((current) => [...current, event.interaction]);
            continue;
          }
          if (event.type === 'interaction_result') {
            setTranscript((current) => [...current, event.interaction_result]);
            continue;
          }
          if (event.type === 'usage') {
            if (event.usage) {
              setUsageText(`input_tokens=${event.usage.input_tokens ?? 0} | output_tokens=${event.usage.output_tokens ?? 0}`);
            }
            continue;
          }
          if (event.type === 'final') {
            setSessionId(event.session_id);
            setTranscript(Array.isArray(event.transcript) ? event.transcript : []);
            if (event.usage) {
              setUsageText(`input_tokens=${event.usage.input_tokens ?? 0} | output_tokens=${event.usage.output_tokens ?? 0}`);
            }
            setStatusText('Completed.');
            continue;
          }
          if (event.type === 'error') {
            throw new Error(event.error);
          }
        }

        if (done) {
          break;
        }
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Agent run failed.');
      setStatusText(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewSession = () => {
    setSessionId(null);
    setErrorText(null);
    setTranscript([]);
    setUsageText(null);
    setStatusText(null);
  };

  const appendAssistantText = (text: string) => {
    setTranscript((current) => [
      ...current,
      {
        role: 'assistant',
        kind: 'text',
        text,
      },
    ]);
  };

  const reportInteractionResult = async (payload: {
    interactionId: string;
    status: 'confirmed' | 'failed';
    signature?: string;
    explorerUrl?: string;
    error?: string;
  }) => {
    if (!sessionId) {
      return;
    }
    const response = await fetch(`${trimmedBaseUrl}/agent/interaction-result`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        interactionId: payload.interactionId,
        status: payload.status,
        signature: payload.signature ?? null,
        explorerUrl: payload.explorerUrl ?? null,
        error: payload.error ?? null,
      }),
    });
    const body = await response.json().catch(() => null) as {
      ok?: boolean;
      error?: string;
      interaction_result?: Extract<AgentTranscriptEntry, { kind: 'interaction_result' }>;
    } | null;
    if (!response.ok || body?.ok === false || !body?.interaction_result) {
      throw new Error(body?.error ?? `Failed to record interaction result (${response.status}).`);
    }
    setTranscript((current) => [...current, body.interaction_result as Extract<AgentTranscriptEntry, { kind: 'interaction_result' }>]);
  };

  const handleSimulateDraft = async (draft = latestDraft) => {
    if (!draft) {
      return;
    }
    setIsDraftActionLoading(true);
    setErrorText(null);
    setStatusText('Simulating latest draft...');
    try {
      const simulation = await simulatePreparedExecutionDraft({
        draft,
        connection,
        wallet,
      });
      const text = simulation.ok
        ? `Draft simulation succeeded.\nunits: ${simulation.unitsConsumed ?? 'n/a'}`
        : `Draft simulation failed.\nerror: ${simulation.error ?? 'unknown'}\nunits: ${simulation.unitsConsumed ?? 'n/a'}`;
      appendAssistantText(text);
      setStatusText('Simulation completed.');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Simulation failed.');
      setStatusText(null);
    } finally {
      setIsDraftActionLoading(false);
    }
  };

  const handleSendDraft = async (draft = latestDraft, interactionId?: string | null) => {
    if (!draft) {
      return;
    }
    setIsDraftActionLoading(true);
    setErrorText(null);
    setStatusText('Sending latest draft...');
    try {
      const sent = await sendPreparedExecutionDraft({
        draft,
        connection,
        wallet,
      });
      if (interactionId) {
        await reportInteractionResult({
          interactionId,
          status: 'confirmed',
          signature: sent.signature,
          explorerUrl: sent.explorerUrl,
        });
      } else {
        const text = `Draft submitted.\nsignature: ${sent.signature}\nexplorer: ${sent.explorerUrl}`;
        appendAssistantText(text);
      }
      setStatusText('Submission completed.');
    } catch (error) {
      if (interactionId) {
        try {
          await reportInteractionResult({
            interactionId,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Submission failed.',
          });
        } catch (reportError) {
          setErrorText(reportError instanceof Error ? reportError.message : 'Failed to record interaction failure.');
        }
      }
      setErrorText(error instanceof Error ? error.message : 'Submission failed.');
      setStatusText(null);
    } finally {
      setIsDraftActionLoading(false);
    }
  };

  return (
    <section className="agent-shell">
      <div className="agent-header">
        <div>
          <h2>Agent</h2>
          <p>Bring your own Claude token and test the declarative runtime directly. The agent only gets spec-backed tools.</p>
          <p>{sessionId ? `Session: ${sessionId}` : 'Session: new'}</p>
        </div>
        <div className="agent-target">
          <span>Target</span>
          <code>{trimmedBaseUrl}</code>
        </div>
      </div>

      <datalist id="anthropic-model-presets">
        {ANTHROPIC_MODEL_PRESETS.map((preset) => (
          <option key={preset} value={preset} />
        ))}
      </datalist>

      {errorText ? <p className="view-playground-error">{errorText}</p> : null}
      {statusText ? <p className="view-playground-info">{statusText}</p> : null}
      {usageText ? <p className="view-playground-info">{usageText}</p> : null}

      <div className="agent-results">
        <section className="agent-panel">
          <h3>Transcript</h3>
          <div className="agent-transcript">
            {visibleTranscript.length === 0 ? (
              <p className="view-playground-empty">Run the agent to inspect its tool calls and responses.</p>
            ) : (
              visibleTranscript.map((entry) => {
                return (
                  <article key={entry.key} className="agent-entry">
                    {entry.kind === 'assistant_text' ? <ExpandablePre text={entry.text} /> : null}
                  </article>
                );
              })
            )}
          </div>
          {latestInteraction ? (
            <div className="agent-actions">
              {latestInteractionResult ? null : (
                <button
                  type="button"
                  onClick={() => void handleSendDraft(latestInteractionDraft, latestInteraction.interactionId)}
                  disabled={isLoading || isDraftActionLoading || !wallet.publicKey || !latestInteractionDraft}
                >
                  {isDraftActionLoading ? 'Opening Wallet...' : latestInteraction.label}
                </button>
              )}
              <p>
                {latestInteractionResult
                  ? latestInteractionResult.status === 'confirmed'
                    ? `Submitted${latestInteractionResult.signature ? `: ${latestInteractionResult.signature}` : ''}`
                    : `Failed: ${latestInteractionResult.error ?? 'unknown'}`
                  : latestInteraction.message ?? 'Wallet approval is required.'}
              </p>
              {latestInteractionResult?.status === 'confirmed' && latestInteractionResult.explorerUrl ? (
                <a href={latestInteractionResult.explorerUrl} target="_blank" rel="noreferrer">
                  View Explorer
                </a>
              ) : null}
            </div>
          ) : latestDraft ? (
            <div className="agent-actions">
              <button
                type="button"
                onClick={() => void handleSimulateDraft(latestDraft)}
                disabled={isLoading || isDraftActionLoading || !wallet.publicKey}
              >
                {isDraftActionLoading ? 'Working...' : 'Simulate Draft'}
              </button>
              <p>
                Draft ready: {latestDraft.operationId} / {latestDraft.instructionName ?? 'no instruction'}
              </p>
            </div>
          ) : null}
          {showDebug ? (
            <div className="agent-debug">
              <h4>Debug Trace</h4>
              <div className="agent-transcript">
                {transcript.length === 0 ? (
                  <p className="view-playground-empty">No raw agent events yet.</p>
                ) : (
                  transcript.map((entry, index) => (
                    <article key={`debug-${index}`} className="agent-entry">
                      <p>
                        <strong>{entry.role}</strong> / <strong>{entry.kind}</strong>
                        {'toolName' in entry ? ` / ${entry.toolName}` : null}
                        {'interactionType' in entry ? ` / ${entry.interactionType}` : null}
                      </p>
                      <ExpandablePre text={JSON.stringify(entry, null, 2)} />
                    </article>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <form className="agent-form agent-composer" onSubmit={handleRun}>
        <label className="agent-form-full">
          Prompt
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={2} />
        </label>
        <details className="agent-settings">
          <summary>Settings</summary>
          <div className="agent-settings-grid">
            <label>
              Provider
              <select value="anthropic" disabled>
                <option value="anthropic">Claude / Anthropic</option>
              </select>
            </label>
            <label>
              Model
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={DEFAULT_ANTHROPIC_MODEL}
                list="anthropic-model-presets"
              />
            </label>
            <label>
              Protocol
              <select value={protocolId} onChange={(event) => setProtocolId(event.target.value)}>
                {protocols.map((protocol) => (
                  <option key={protocol.id} value={protocol.id}>
                    {protocol.name ?? protocol.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Connected Wallet
              <input value={walletPublicKey ?? 'not connected'} disabled />
            </label>
            <label>
              Debug
              <input
                type="checkbox"
                checked={showDebug}
                onChange={(event) => setShowDebug(event.target.checked)}
              />
            </label>
            <label className="agent-form-full">
              Claude API Key
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-ant-..."
                autoComplete="off"
              />
            </label>
          </div>
        </details>
        <div className="agent-actions">
          <button type="submit" disabled={isLoading || apiKey.trim().length === 0 || prompt.trim().length === 0}>
            {isLoading ? 'Running...' : sessionId ? 'Send' : 'Start Session'}
          </button>
          <button type="button" onClick={handleNewSession} disabled={isLoading}>
            New Session
          </button>
          <p>Your key is used only for this request. Nothing is stored for now. Use an exact Anthropic model id.</p>
        </div>
      </form>
    </section>
  );
}
