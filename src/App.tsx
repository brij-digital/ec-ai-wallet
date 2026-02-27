import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import './App.css';
import { formatTokenAmount, listSupportedTokens, resolveToken } from './constants/tokens';
import { parseCommand } from './lib/commandParser';
import type { SwapCommand } from './lib/commandParser';
import { getPrimarySwapProtocol } from './lib/idlRegistry';
import { executeOrcaSwap, prepareOrcaSwap } from './lib/orcaWhirlpool';
import type { PreparedOrcaSwap } from './lib/orcaWhirlpool';

type Message = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
};

type PendingSwap = {
  command: SwapCommand;
  preparedSwap: PreparedOrcaSwap;
  protocolName: string;
};

const HELP_TEXT = [
  'Commands:',
  '/swap <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]',
  '/confirm',
  '/help',
  '',
  'Example:',
  '/swap SOL USDC 0.01 50',
].join('\n');

function App() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'assistant',
      text: 'Espresso Cash MVP ready. Use /help to see commands.',
    },
  ]);
  const [pendingSwap, setPendingSwap] = useState<PendingSwap | null>(null);
  const [commandInput, setCommandInput] = useState('');
  const [isWorking, setIsWorking] = useState(false);

  const supportedTokens = useMemo(
    () => listSupportedTokens().map((token) => `${token.symbol} (${token.mint})`).join(', '),
    [],
  );

  function pushMessage(role: 'user' | 'assistant', text: string) {
    setMessages((prev) => [...prev, { id: prev.length + 1, role, text }]);
  }

  async function handleSwapCommand(command: SwapCommand) {
    const protocol = await getPrimarySwapProtocol();
    const preparedSwap = await prepareOrcaSwap({
      command,
      connection,
      wallet,
    });

    const inputToken = resolveToken(command.inputMint);
    const outputToken = resolveToken(command.outputMint);

    if (!inputToken || !outputToken) {
      throw new Error('Token metadata not found in local token list.');
    }

    const inAmountUi = formatTokenAmount(preparedSwap.estimatedAmountInAtomic, inputToken.decimals);
    const outAmountUi = formatTokenAmount(preparedSwap.estimatedAmountOutAtomic, outputToken.decimals);

    setPendingSwap({ command, preparedSwap, protocolName: protocol.name });

    pushMessage(
      'assistant',
      [
        `Route found via ${protocol.name}.`,
        `Expected output: ${outAmountUi} ${outputToken.symbol} for ${inAmountUi} ${inputToken.symbol}.`,
        `Whirlpool pool: ${preparedSwap.poolAddress}`,
        `Tick spacing: ${preparedSwap.tickSpacing}`,
        'Run /confirm to sign and execute.',
      ].join('\n'),
    );
  }

  async function handleConfirmCommand() {
    if (!pendingSwap) {
      throw new Error('No pending swap. Submit /swap first.');
    }

    if (!wallet.publicKey || !wallet.signTransaction) {
      throw new Error('Connect a wallet that supports transaction signing first.');
    }

    const signature = await executeOrcaSwap({
      preparedSwap: pendingSwap.preparedSwap,
      connection,
      wallet,
    });

    const explorerUrl = `https://solscan.io/tx/${signature}`;
    pushMessage('assistant', `Swap executed. Signature: ${signature}\n${explorerUrl}`);
    setPendingSwap(null);
  }

  async function handleCommandSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const raw = commandInput.trim();
    if (!raw) {
      return;
    }

    pushMessage('user', raw);
    setCommandInput('');

    setIsWorking(true);
    try {
      const parsed = parseCommand(raw);

      if (parsed.kind === 'help') {
        pushMessage('assistant', `${HELP_TEXT}\n\nSupported tokens: ${supportedTokens}`);
        return;
      }

      if (parsed.kind === 'confirm') {
        await handleConfirmCommand();
        return;
      }

      await handleSwapCommand(parsed.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error while handling command.';
      pushMessage('assistant', `Error: ${message}`);
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card-shell">
        <header className="card-header">
          <div>
            <h1>Espresso Cash AI Wallet MVP</h1>
            <p>Mainnet demo: command-driven swaps with single-signature wallet approval.</p>
          </div>
          <WalletMultiButton />
        </header>

        <div className="chat-log" aria-live="polite">
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <p>{message.text}</p>
            </article>
          ))}
        </div>

        {pendingSwap && (
          <aside className="pending-block">
            <strong>Pending Swap</strong>
            <p>
              {pendingSwap.command.amountUi} {pendingSwap.command.inputToken} {'->'} {pendingSwap.command.outputToken} at{' '}
              {pendingSwap.command.slippageBps} bps
            </p>
          </aside>
        )}

        <form className="command-form" onSubmit={handleCommandSubmit}>
          <input
            type="text"
            value={commandInput}
            onChange={(event) => setCommandInput(event.target.value)}
            placeholder="/swap SOL USDC 0.01 50"
            disabled={isWorking}
            aria-label="Command input"
          />
          <button type="submit" disabled={isWorking}>
            {isWorking ? 'Running...' : 'Run'}
          </button>
        </form>
      </section>
    </main>
  );
}

export default App;
