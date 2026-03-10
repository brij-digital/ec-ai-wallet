import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import Decimal from 'decimal.js';
import './App.css';
import { formatTokenAmount, listSupportedTokens, resolveToken } from './constants/tokens';
import { parseCommand } from './lib/commandParser';
import {
  decodeIdlAccount,
  getInstructionTemplate,
  listIdlProtocols,
  previewIdlInstruction,
  sendIdlInstruction,
  simulateIdlInstruction,
} from './lib/idlDeclarativeRuntime';
import { prepareMetaInstruction } from './lib/metaIdlRuntime';

const ORCA_PROTOCOL_ID = 'orca-whirlpool-mainnet';
const ORCA_ACTION_ID = 'swap_exact_in';
const QUICK_PREFILL_SWAP_COMMAND =
  '/swap EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v So11111111111111111111111111111111111111112 0.01 50';

type Message = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
};

const HELP_TEXT = [
  'Commands:',
  '/swap <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]',
  '/quote <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]',
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

  function compactPubkey(value: unknown): string {
    const text = String(value ?? 'n/a');
    if (text.length <= 12) {
      return text;
    }
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
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
        const walletPublicKey = wallet.publicKey;

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
          walletPublicKey,
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
          owner: walletPublicKey,
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

        let rawPreviewCache: Record<string, unknown> | null = null;
        const getRawPreview = async (): Promise<Record<string, unknown>> => {
          if (rawPreviewCache) {
            return rawPreviewCache;
          }

          rawPreviewCache = {
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
              walletPublicKey,
            }),
          };

          return rawPreviewCache;
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
            const rawPreview = await getRawPreview();
            throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
          }

          const minOutAtomic = String(
            derivedQuote?.otherAmountThreshold ??
              derivedQuote?.other_amount_threshold ??
              prepared.args.other_amount_threshold ??
              '0',
          );
          const minOutUi = outputTokenMeta ? formatTokenAmount(minOutAtomic, outputTokenMeta.decimals) : minOutAtomic;
          let impliedRateText = 'n/a';
          if (inputTokenMeta && outputTokenMeta && estimatedInAtomic !== '0') {
            const inUi = new Decimal(estimatedInAtomic).div(new Decimal(10).pow(inputTokenMeta.decimals));
            const outUi = new Decimal(estimatedOutAtomic).div(new Decimal(10).pow(outputTokenMeta.decimals));
            if (inUi.gt(0)) {
              impliedRateText = outUi.div(inUi).toSignificantDigits(8).toString();
            }
          }

          pushMessage(
            'assistant',
            [
              'Quote (meta IDL + simulation):',
              `pair: ${parsed.value.inputToken}/${parsed.value.outputToken}`,
              `pool: ${String(selectedPool?.whirlpool ?? 'n/a')}`,
              `input: ${estimatedInUi} ${parsed.value.inputToken}`,
              `estimated output: ${estimatedOutUi} ${parsed.value.outputToken}`,
              `min output @ ${parsed.value.slippageBps} bps: ${minOutUi} ${parsed.value.outputToken}`,
              `implied rate: 1 ${parsed.value.inputToken} ≈ ${impliedRateText} ${parsed.value.outputToken}`,
              `tick arrays: ${compactPubkey(prepared.accounts.tick_array_0)}, ${compactPubkey(prepared.accounts.tick_array_1)}, ${compactPubkey(prepared.accounts.tick_array_2)}`,
              `simulation: ${sim.ok ? 'ok' : 'failed'}${sim.unitsConsumed ? ` (${sim.unitsConsumed} CU)` : ''}`,
              sim.error ? `error: ${sim.error}` : 'error: none',
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
          const rawPreview = await getRawPreview();
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
        <div className="quick-actions">
          <button
            type="button"
            onClick={() => setCommandInput(QUICK_PREFILL_SWAP_COMMAND)}
            disabled={isWorking}
          >
            Prefill USDC-&gt;SOL 0.01
          </button>
        </div>
      </section>
    </main>
  );
}

export default App;
