import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import type { ActionRunnerSpec } from '@brij-digital/apppack-runtime';
import { parseBuilderInputValue } from '../builderHelpers';
import { loadActionRunnerSpecs, runActionRunnerSpec } from '../actionRunnerClient';
import {
  sendPreparedExecutionDraft,
  simulatePreparedExecutionDraft,
  type PreparedExecutionDraft,
} from '../runtimeSubmit';

type RunnerResult = Awaited<ReturnType<typeof runActionRunnerSpec>>;

type RunnerActionStatus =
  | 'idle'
  | 'simulating'
  | 'preparing'
  | 'awaiting_wallet_approval'
  | 'submitting'
  | 'submitted'
  | 'confirmed'
  | 'error';

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function buildDefaultInputValues(spec: ActionRunnerSpec | null): Record<string, string> {
  if (!spec) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(spec.inputs).map(([inputName, inputSpec]) => [
      inputName,
      inputSpec.default === undefined ? '' : String(inputSpec.default),
    ]),
  );
}

function parseRunnerInput(rawValue: string, type: string, inputName: string): unknown {
  if (type === 'string') {
    return rawValue;
  }
  return parseBuilderInputValue(rawValue, type, inputName);
}

function asDraft(value: unknown): PreparedExecutionDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.protocolId !== 'string'
    || typeof candidate.operationId !== 'string'
    || typeof candidate.args !== 'object'
    || !candidate.args
    || typeof candidate.accounts !== 'object'
    || !candidate.accounts
  ) {
    return null;
  }
  return candidate as unknown as PreparedExecutionDraft;
}

export function RunnerTab() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [runnerSpecs, setRunnerSpecs] = useState<ActionRunnerSpec[]>([]);
  const [runnerId, setRunnerId] = useState('');
  const [runnerInputValues, setRunnerInputValues] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [result, setResult] = useState<RunnerResult | null>(null);
  const [actionStatus, setActionStatus] = useState<RunnerActionStatus>('idle');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionExplorerUrl, setActionExplorerUrl] = useState<string | null>(null);
  const [isActionWorking, setIsActionWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadActionRunnerSpecs();
        if (cancelled) {
          return;
        }
        setRunnerSpecs(loaded);
        const first = loaded[0] ?? null;
        setRunnerId(first?.actionId ?? '');
        setRunnerInputValues(buildDefaultInputValues(first));
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : 'Failed to load runner specs.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRunner = useMemo(
    () => runnerSpecs.find((entry) => entry.actionId === runnerId) ?? null,
    [runnerSpecs, runnerId],
  );

  const handleRunnerSelect = (nextRunnerId: string) => {
    setRunnerId(nextRunnerId);
    const nextRunner = runnerSpecs.find((entry) => entry.actionId === nextRunnerId) ?? null;
    setRunnerInputValues(buildDefaultInputValues(nextRunner));
    setResult(null);
    setErrorText(null);
    setActionStatus('idle');
    setActionMessage(null);
    setActionExplorerUrl(null);
  };

  const handleInputChange = (inputName: string, value: string) => {
    setRunnerInputValues((current) => ({
      ...current,
      [inputName]: value,
    }));
  };

  const handleRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRunner) {
      setErrorText('Select a runner first.');
      return;
    }
    setIsRunning(true);
    setErrorText(null);
    setResult(null);
    setActionStatus('idle');
    setActionMessage(null);
    setActionExplorerUrl(null);
    try {
      const parsedInput: Record<string, unknown> = {};
      for (const [inputName, inputSpec] of Object.entries(selectedRunner.inputs)) {
        const rawValue = runnerInputValues[inputName] ?? '';
        if (!rawValue.trim()) {
          if (inputSpec.required !== false && inputSpec.default === undefined) {
            throw new Error(`Missing required runner input ${inputName}.`);
          }
          continue;
        }
        parsedInput[inputName] = parseRunnerInput(rawValue, inputSpec.type, inputName);
      }

      const executed = await runActionRunnerSpec({
        spec: selectedRunner,
        input: parsedInput,
        connection,
        walletPublicKey: wallet.publicKey,
      });
      setResult(executed);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Runner failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const latestDraft = useMemo(() => asDraft(result?.output && typeof result.output === 'object' ? (result.output as Record<string, unknown>).draft : null), [result]);

  const actionZone = useMemo(() => {
    if (actionStatus === 'error') {
      return {
        tone: 'error' as const,
        title: 'Runner action failed',
        message: actionMessage ?? 'The wallet action failed.',
      };
    }
    if (actionStatus === 'simulating') {
      return {
        tone: 'pending' as const,
        title: 'Checking transaction',
        message: 'A quick preflight check is running.',
      };
    }
    if (actionStatus === 'preparing') {
      return {
        tone: 'pending' as const,
        title: 'Preparing transaction',
        message: 'The draft is being prepared for wallet submission.',
      };
    }
    if (actionStatus === 'awaiting_wallet_approval') {
      return {
        tone: 'pending' as const,
        title: 'Action from you needed',
        message: 'Approve the transaction in your wallet to continue.',
      };
    }
    if (actionStatus === 'submitting') {
      return {
        tone: 'pending' as const,
        title: 'Submitting transaction',
        message: 'Your signed transaction is being broadcast to Solana.',
      };
    }
    if (actionStatus === 'submitted' || actionStatus === 'confirmed') {
      return {
        tone: 'success' as const,
        title: 'Submitted',
        message: actionMessage ?? 'The transaction was sent successfully.',
      };
    }
    if (latestDraft) {
      return {
        tone: 'neutral' as const,
        title: 'Action from you needed',
        message: `This runner produced a draft for ${latestDraft.operationId}. You can simulate it or approve it in your wallet.`,
      };
    }
    return null;
  }, [actionMessage, actionStatus, latestDraft]);

  const handleSimulateDraft = async () => {
    if (!latestDraft) {
      return;
    }
    setIsActionWorking(true);
    setActionExplorerUrl(null);
    setActionStatus('simulating');
    setActionMessage(null);
    setErrorText(null);
    try {
      const simulation = await simulatePreparedExecutionDraft({
        draft: latestDraft,
        connection,
        wallet,
      });
      setActionStatus(simulation.ok ? 'idle' : 'error');
      setActionMessage(
        simulation.ok
          ? `Simulation succeeded. Units: ${simulation.unitsConsumed ?? 'n/a'}.`
          : (simulation.error ?? 'Simulation failed.'),
      );
    } catch (error) {
      setActionStatus('error');
      setActionMessage(error instanceof Error ? error.message : 'Simulation failed.');
    } finally {
      setIsActionWorking(false);
    }
  };

  const handleSubmitDraft = async () => {
    if (!latestDraft) {
      return;
    }
    setIsActionWorking(true);
    setActionExplorerUrl(null);
    setActionStatus('preparing');
    setActionMessage(null);
    setErrorText(null);
    try {
      const sent = await sendPreparedExecutionDraft({
        draft: latestDraft,
        connection,
        wallet,
        onStatus: (status) => {
          if (status === 'simulating') {
            setActionStatus('simulating');
            return;
          }
          if (status === 'preparing') {
            setActionStatus('preparing');
            return;
          }
          if (status === 'awaiting_wallet_approval') {
            setActionStatus('awaiting_wallet_approval');
            return;
          }
          if (status === 'submitting') {
            setActionStatus('submitting');
            return;
          }
          if (status === 'submitted' || status === 'confirming') {
            setActionStatus('submitted');
            return;
          }
          setActionStatus('confirmed');
        },
        onSubmitted: ({ explorerUrl, signature }) => {
          setActionStatus('submitted');
          setActionExplorerUrl(explorerUrl);
          setActionMessage(`Transaction sent: ${signature}`);
        },
      });
      setActionStatus('confirmed');
      setActionExplorerUrl(sent.explorerUrl);
      setActionMessage(`Transaction confirmed: ${sent.signature}`);
    } catch (error) {
      setActionStatus('error');
      setActionMessage(error instanceof Error ? error.message : 'Submission failed.');
    } finally {
      setIsActionWorking(false);
    }
  };

  return (
    <section className="view-playground-shell">
      <header className="view-playground-header">
        <div>
          <h2>Runner</h2>
          <p>Run a minimal linear action pipeline declared in a runner spec.</p>
        </div>
        <div className="view-playground-target">
          <span>Wallet</span>
          <code>{wallet.publicKey?.toBase58() ?? 'not connected'}</code>
        </div>
      </header>

      {isLoading ? (
        <div className="view-playground-info">Loading runner specs...</div>
      ) : null}
      {errorText ? (
        <div className="view-playground-error">{errorText}</div>
      ) : null}

      <form className="view-playground-form" onSubmit={handleRun}>
        <label>
          <span>Runner</span>
          <select value={runnerId} onChange={(event) => handleRunnerSelect(event.target.value)} disabled={isLoading || isRunning}>
            {runnerSpecs.map((spec) => (
              <option key={spec.actionId} value={spec.actionId}>
                {spec.title}
              </option>
            ))}
          </select>
        </label>
        {selectedRunner ? (
          <>
            {Object.entries(selectedRunner.inputs).map(([inputName, inputSpec]) => (
              <label key={inputName}>
                <span>{inputName}</span>
                <input
                  value={runnerInputValues[inputName] ?? ''}
                  onChange={(event) => handleInputChange(inputName, event.target.value)}
                  disabled={isRunning}
                  placeholder={inputSpec.description ?? inputSpec.type}
                />
              </label>
            ))}
            <div className="view-playground-actions">
              <button type="submit" disabled={isRunning}>
                {isRunning ? 'Running...' : 'Run Runner'}
              </button>
            </div>
          </>
        ) : null}
      </form>

      {actionZone ? (
        <div className="agent-action-zone" data-tone={actionZone.tone}>
          <div className="agent-action-zone-copy">
            <strong>{actionZone.title}</strong>
            <p>{actionZone.message}</p>
          </div>
          <div className="agent-actions">
            {latestDraft ? (
              <>
                <button type="button" onClick={handleSimulateDraft} disabled={isRunning || isActionWorking || !wallet.publicKey}>
                  {actionStatus === 'simulating' ? 'Simulating...' : 'Simulate Draft'}
                </button>
                <button type="button" onClick={handleSubmitDraft} disabled={isRunning || isActionWorking || !wallet.publicKey}>
                  {actionStatus === 'awaiting_wallet_approval'
                    ? 'Waiting for Wallet...'
                    : actionStatus === 'submitting' || actionStatus === 'submitted' || actionStatus === 'confirmed'
                      ? 'Submitted'
                      : 'Approve in Wallet'}
                </button>
              </>
            ) : null}
            {actionExplorerUrl ? (
              <a href={actionExplorerUrl} target="_blank" rel="noreferrer">
                View Explorer
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedRunner ? (
        <div className="view-playground-results">
          <section className="view-playground-panel">
            <h3>Spec</h3>
            <pre>{formatJson(selectedRunner)}</pre>
          </section>
          <section className="view-playground-panel">
            <h3>Final Output</h3>
            <pre>{result ? formatJson(result.output) : 'Run a runner to see the final output.'}</pre>
          </section>
          <section className="view-playground-panel">
            <h3>Steps</h3>
            <pre>{result ? formatJson(result.steps) : 'Step results will appear here.'}</pre>
          </section>
        </div>
      ) : null}
    </section>
  );
}
