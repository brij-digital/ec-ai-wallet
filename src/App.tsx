import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import './App.css';
import { formatTokenAmount, listSupportedTokens, resolveToken } from './constants/tokens';
import { parseCommand } from './lib/commandParser';
import type { SwapOldCommand } from './lib/commandParser';
import { getPrimarySwapProtocol } from './lib/idlRegistry';
import {
  decodeIdlAccount,
  getInstructionTemplate,
  listIdlProtocols,
  previewIdlInstruction,
  sendIdlInstruction,
  simulateIdlInstruction,
} from './lib/idlDeclarativeRuntime';
import { prepareMetaInstruction } from './lib/metaIdlRuntime';
import { executeOrcaSwap, prepareOrcaSwap } from './lib/orcaWhirlpool';
import type { PreparedOrcaSwap } from './lib/orcaWhirlpool';

const ORCA_PROTOCOL_ID = 'orca-whirlpool-mainnet';
const ORCA_ACTION_ID = 'swap_exact_in';

type Message = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
};

type PendingSwap = {
  command: SwapOldCommand;
  preparedSwap: PreparedOrcaSwap;
  protocolName: string;
};

const HELP_TEXT = [
  'Commands:',
  '/swap <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]',
  '/quote <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]',
  '/swap-old <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]',
  '/confirm',
  '/write-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>',
  '/read-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>',
  '/idl-list',
  '/idl-template <PROTOCOL_ID> <INSTRUCTION_NAME>',
  '/idl-view <PROTOCOL_ID> <ACCOUNT_TYPE> <ACCOUNT_PUBKEY>',
  '/help',
  '',
  'Notes:',
  'AMOUNT is UI amount (e.g. 0.1 for SOL).',
  'Pool + direction are resolved declaratively from local directory DB.',
  '',
  'Examples:',
  '/quote SOL USDC 0.1 50',
  '/swap SOL USDC 0.1 50',
  '/swap-old SOL USDC 0.1 50',
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

  function asPrettyJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  function encodeIxDataBase64(data: Uint8Array): string {
    let binary = '';
    for (const byte of data) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  function buildOwnerAtaPreInstructions(options: {
    owner: PublicKey;
    pairs: Array<{ ata: string; mint: string }>;
  }): TransactionInstruction[] {
    return options.pairs.map((pair) =>
      createAssociatedTokenAccountIdempotentInstruction(
        options.owner,
        new PublicKey(pair.ata),
        options.owner,
        new PublicKey(pair.mint),
      ),
    );
  }

  function buildMetaPostInstructions(
    postSpecs: Array<{
      kind: 'spl_token_close_account';
      account: string;
      destination: string;
      owner: string;
      tokenProgram: string;
    }>,
  ): TransactionInstruction[] {
    return postSpecs.map((spec) => {
      if (spec.kind !== 'spl_token_close_account') {
        throw new Error(`Unsupported meta post instruction kind: ${spec.kind}`);
      }

      return createCloseAccountInstruction(
        new PublicKey(spec.account),
        new PublicKey(spec.destination),
        new PublicKey(spec.owner),
        [],
        new PublicKey(spec.tokenProgram),
      );
    });
  }

  async function handleSwapOldCommand(command: SwapOldCommand) {
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
      throw new Error('No pending legacy swap. Submit /swap-old first.');
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
    pushMessage('assistant', `Legacy swap executed. Signature: ${signature}\n${explorerUrl}`);
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

      if (parsed.kind === 'idl-list') {
        const protocols = await listIdlProtocols();
        pushMessage('assistant', asPrettyJson(protocols));
        return;
      }

      if (parsed.kind === 'idl-template') {
        const template = await getInstructionTemplate({
          protocolId: parsed.value.protocolId,
          instructionName: parsed.value.instructionName,
        });
        pushMessage('assistant', asPrettyJson(template));
        return;
      }

      if (parsed.kind === 'idl-view') {
        const decoded = await decodeIdlAccount({
          protocolId: parsed.value.protocolId,
          accountType: parsed.value.accountType,
          address: parsed.value.address,
          connection,
        });
        pushMessage('assistant', asPrettyJson(decoded));
        return;
      }

      if (parsed.kind === 'swap' || parsed.kind === 'quote') {
        if (!wallet.publicKey) {
          throw new Error('Connect wallet first to derive owner token accounts.');
        }

        const prepared = await prepareMetaInstruction({
          protocolId: ORCA_PROTOCOL_ID,
          actionId: ORCA_ACTION_ID,
          input: {
            token_in_mint: parsed.value.inputMint,
            token_out_mint: parsed.value.outputMint,
            amount_in: parsed.value.amountAtomic,
            slippage_bps: parsed.value.slippageBps,
          },
          connection,
          walletPublicKey: wallet.publicKey,
        });

        const derivedQuote = prepared.derived.quote as Record<string, unknown> | undefined;
        const selectedPool = prepared.derived.selected_pool as Record<string, unknown> | undefined;
        const whirlpoolData = prepared.derived.whirlpool_data as Record<string, unknown> | undefined;
        const inputTokenMeta = resolveToken(parsed.value.inputMint);
        const outputTokenMeta = resolveToken(parsed.value.outputMint);
        const estimatedInAtomic = String(derivedQuote?.estimatedAmountIn ?? parsed.value.amountAtomic);
        const estimatedOutAtomic = String(derivedQuote?.estimatedAmountOut ?? '0');
        const estimatedInUi =
          inputTokenMeta ? formatTokenAmount(estimatedInAtomic, inputTokenMeta.decimals) : estimatedInAtomic;
        const estimatedOutUi =
          outputTokenMeta ? formatTokenAmount(estimatedOutAtomic, outputTokenMeta.decimals) : estimatedOutAtomic;

        if (!whirlpoolData) {
          throw new Error('Missing derived whirlpool data from meta runtime.');
        }

        const preInstructions = buildOwnerAtaPreInstructions({
          owner: wallet.publicKey,
          pairs: [
            {
              ata: prepared.accounts.token_owner_account_a,
              mint: String(whirlpoolData.token_mint_a),
            },
            {
              ata: prepared.accounts.token_owner_account_b,
              mint: String(whirlpoolData.token_mint_b),
            },
          ],
        });
        const postInstructions = buildMetaPostInstructions(prepared.postInstructions);

        const aToB = Boolean(selectedPool?.aToB);
        const inputAta = aToB ? prepared.accounts.token_owner_account_a : prepared.accounts.token_owner_account_b;
        let inputBalanceAtomic = '0';
        try {
          const inputBalance = await connection.getTokenAccountBalance(new PublicKey(inputAta), 'confirmed');
          inputBalanceAtomic = inputBalance.value.amount;
        } catch {
          inputBalanceAtomic = '0';
        }

        const requiredInputAtomic = BigInt(parsed.value.amountAtomic);
        const availableInputAtomic = BigInt(inputBalanceAtomic);
        if (availableInputAtomic < requiredInputAtomic) {
          const availableUi = inputTokenMeta
            ? formatTokenAmount(availableInputAtomic.toString(), inputTokenMeta.decimals)
            : availableInputAtomic.toString();
          const requiredUi = inputTokenMeta
            ? formatTokenAmount(requiredInputAtomic.toString(), inputTokenMeta.decimals)
            : requiredInputAtomic.toString();
          throw new Error(
            `Insufficient ${parsed.value.inputToken} balance in input token account. Required: ${requiredUi} (${requiredInputAtomic.toString()}), available: ${availableUi} (${availableInputAtomic.toString()}).`,
          );
        }

        const rawPreview = {
          preInstructions: preInstructions.map((ix) => ({
            programId: ix.programId.toBase58(),
            keys: ix.keys.map((key) => ({
              pubkey: key.pubkey.toBase58(),
              isSigner: key.isSigner,
              isWritable: key.isWritable,
            })),
            dataBase64: encodeIxDataBase64(ix.data),
          })),
          postInstructions: postInstructions.map((ix) => ({
            programId: ix.programId.toBase58(),
            keys: ix.keys.map((key) => ({
              pubkey: key.pubkey.toBase58(),
              isSigner: key.isSigner,
              isWritable: key.isWritable,
            })),
            dataBase64: encodeIxDataBase64(ix.data),
          })),
          mainInstruction: await previewIdlInstruction({
            protocolId: prepared.protocolId,
            instructionName: prepared.instructionName,
            args: prepared.args,
            accounts: prepared.accounts,
            walletPublicKey: wallet.publicKey,
          }),
        };

        if (parsed.kind === 'quote') {
          let sim: Awaited<ReturnType<typeof simulateIdlInstruction>>;
          try {
            sim = await simulateIdlInstruction({
              protocolId: prepared.protocolId,
              instructionName: prepared.instructionName,
              args: prepared.args,
              accounts: prepared.accounts,
              preInstructions,
              postInstructions,
              connection,
              wallet,
            });
          } catch (error) {
            const base = error instanceof Error ? error.message : 'Unknown simulation error.';
            throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
          }

          pushMessage(
            'assistant',
            [
              `Quote (meta IDL):`,
              `pair: ${parsed.value.inputToken}/${parsed.value.outputToken}`,
              `pool: ${String(selectedPool?.whirlpool ?? 'n/a')}`,
              `estimatedIn: ${estimatedInUi} ${parsed.value.inputToken} (${estimatedInAtomic})`,
              `estimatedOut: ${estimatedOutUi} ${parsed.value.outputToken} (${estimatedOutAtomic})`,
              `simulation ok: ${sim.ok}`,
              `units consumed: ${sim.unitsConsumed ?? 'n/a'}`,
              sim.error ? `error: ${sim.error}` : 'error: none',
              '',
              'Raw instruction preview:',
              asPrettyJson(rawPreview),
              'Run /swap with same params to execute.',
            ].join('\n'),
          );
          return;
        }

        let result: Awaited<ReturnType<typeof sendIdlInstruction>>;
        try {
          result = await sendIdlInstruction({
            protocolId: prepared.protocolId,
            instructionName: prepared.instructionName,
            args: prepared.args,
            accounts: prepared.accounts,
            preInstructions,
            postInstructions,
            connection,
            wallet,
          });
        } catch (error) {
          const base = error instanceof Error ? error.message : 'Unknown send error.';
          throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
        }

        pushMessage(
          'assistant',
          [
            'Swap sent (meta IDL -> write-raw).',
            `pair: ${parsed.value.inputToken}/${parsed.value.outputToken}`,
            `pool: ${String(selectedPool?.whirlpool ?? 'n/a')}`,
            `estimatedOut: ${estimatedOutUi} ${parsed.value.outputToken} (${estimatedOutAtomic})`,
            result.signature,
            result.explorerUrl,
          ].join('\n'),
        );
        return;
      }

      if (parsed.kind === 'read-raw') {
        const sim = await simulateIdlInstruction({
          protocolId: parsed.value.protocolId,
          instructionName: parsed.value.instructionName,
          args: parsed.value.args,
          accounts: parsed.value.accounts,
          connection,
          wallet,
        });
        pushMessage('assistant', asPrettyJson(sim));
        return;
      }

      if (parsed.kind === 'write-raw' || parsed.kind === 'idl-send') {
        const result = await sendIdlInstruction({
          protocolId: parsed.value.protocolId,
          instructionName: parsed.value.instructionName,
          args: parsed.value.args,
          accounts: parsed.value.accounts,
          connection,
          wallet,
        });
        pushMessage('assistant', `Raw instruction sent.\n${result.signature}\n${result.explorerUrl}`);
        return;
      }

      await handleSwapOldCommand(parsed.value);
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
            <strong>Pending Legacy Swap</strong>
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
            placeholder="/swap SOL USDC 0.1 50"
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
