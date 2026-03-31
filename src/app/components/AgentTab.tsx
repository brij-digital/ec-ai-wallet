import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_MODEL_PRESETS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-5-haiku-20241022',
] as const;

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
    };

type AgentRunResponse = {
  ok: boolean;
  final_text?: string;
  transcript?: AgentTranscriptEntry[];
  error?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function AgentTab({ viewApiBaseUrl }: AgentTabProps) {
  const { publicKey } = useWallet();
  const [protocols, setProtocols] = useState<RegistryProtocol[]>([]);
  const [protocolId, setProtocolId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_ANTHROPIC_MODEL);
  const [prompt, setPrompt] = useState('Find the best capability to inspect a market, then compute a preview before drafting an execution.');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [finalText, setFinalText] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<AgentTranscriptEntry[]>([]);
  const [usageText, setUsageText] = useState<string | null>(null);

  const trimmedBaseUrl = useMemo(() => viewApiBaseUrl.trim().replace(/\/+$/, ''), [viewApiBaseUrl]);
  const walletPublicKey = publicKey?.toBase58() ?? null;

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
    setFinalText(null);
    setUsageText(null);
    setTranscript([]);

    try {
      const response = await fetch(`${trimmedBaseUrl}/agent/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'anthropic',
          model,
          apiKey,
          protocolId: protocolId || null,
          walletPublicKey,
          prompt,
        }),
      });
      const body = (await response.json()) as AgentRunResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? `Agent run failed with ${response.status}.`);
      }
      setFinalText(body.final_text ?? null);
      setTranscript(Array.isArray(body.transcript) ? body.transcript : []);
      if (body.usage) {
        setUsageText(`input_tokens=${body.usage.input_tokens ?? 0} | output_tokens=${body.usage.output_tokens ?? 0}`);
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Agent run failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="agent-shell">
      <div className="agent-header">
        <div>
          <h2>Agent</h2>
          <p>Bring your own Claude token and test the declarative runtime directly. The agent only gets spec-backed tools.</p>
        </div>
        <div className="agent-target">
          <span>Target</span>
          <code>{trimmedBaseUrl}</code>
        </div>
      </div>

      <form className="agent-form" onSubmit={handleRun}>
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
        <label className="agent-form-full">
          Prompt
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={8} />
        </label>
        <div className="agent-actions">
          <button type="submit" disabled={isLoading || apiKey.trim().length === 0 || prompt.trim().length === 0}>
            {isLoading ? 'Running...' : 'Run Agent'}
          </button>
          <p>Your key is used only for this request. Nothing is stored for now. Use an exact Anthropic model id.</p>
        </div>
      </form>
      <datalist id="anthropic-model-presets">
        {ANTHROPIC_MODEL_PRESETS.map((preset) => (
          <option key={preset} value={preset} />
        ))}
      </datalist>

      {errorText ? <p className="view-playground-error">{errorText}</p> : null}
      {usageText ? <p className="view-playground-info">{usageText}</p> : null}

      <div className="agent-results">
        <section className="agent-panel">
          <h3>Final Answer</h3>
          <pre>{finalText ?? '// no final answer yet'}</pre>
        </section>
        <section className="agent-panel">
          <h3>Transcript</h3>
          <div className="agent-transcript">
            {transcript.length === 0 ? (
              <p className="view-playground-empty">Run the agent to inspect its tool calls and responses.</p>
            ) : (
              transcript.map((entry, index) => (
                <article key={index} className="agent-entry">
                  <strong>
                    {entry.role} / {entry.kind}
                    {'toolName' in entry ? ` / ${entry.toolName}` : ''}
                  </strong>
                  {'text' in entry ? <pre>{entry.text}</pre> : null}
                  {'input' in entry ? <pre>{formatJson(entry.input)}</pre> : null}
                  {'result' in entry ? <pre>{formatJson(entry.result)}</pre> : null}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
