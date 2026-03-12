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
import { parseCommand, type QuotePrefillCommand, type SwapPrefillCommand } from './lib/commandParser';
import {
  decodeIdlAccount,
  getInstructionTemplate,
  listIdlProtocols,
  previewIdlInstruction,
  sendIdlInstruction,
  simulateIdlInstruction,
} from './lib/idlDeclarativeRuntime';
import { explainMetaOperation, prepareMetaInstruction, type MetaOperationExplain } from './lib/metaIdlRuntime';

const ORCA_PROTOCOL_ID = 'orca-whirlpool-mainnet';
const ORCA_OPERATION_ID = 'swap_exact_in';
const QUICK_PREFILL_SWAP_COMMAND =
  '/swap EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v So11111111111111111111111111111111111111112 0.01 50';

type Message = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
};

type OrcaPoolCandidate = {
  whirlpool: string;
  tokenMintA: string;
  tokenMintB: string;
  tickSpacing: string;
  liquidity: string;
};

type PendingPoolSelection = {
  kind: 'swap' | 'quote';
  command: SwapPrefillCommand | QuotePrefillCommand;
  candidates: OrcaPoolCandidate[];
};

const HELP_TEXT = [
  'Commands:',
  '/swap <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]',
  '/quote <INPUT_TOKEN> <OUTPUT_TOKEN> <AMOUNT> [SLIPPAGE_BPS]',
  '/write-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>',
  '/read-raw <PROTOCOL_ID> <INSTRUCTION_NAME> | <ARGS_JSON> | <ACCOUNTS_JSON>',
  '/idl-list',
  '/idl-template <PROTOCOL_ID> <INSTRUCTION_NAME>',
  '/meta-explain <PROTOCOL_ID> <OPERATION_ID>',
  '/idl-view <PROTOCOL_ID> <ACCOUNT_TYPE> <ACCOUNT_PUBKEY>',
  '/help',
  '',
  'Notes:',
  'AMOUNT is UI amount (e.g. 0.1 for SOL).',
  'Pool discovery is on-chain via Orca program account scan.',
  'If multiple pools match a pair, the app asks you to pick one.',
  '',
  'Examples:',
  '/quote SOL USDC 0.1 50',
  '/swap SOL USDC 0.1 50',
  '/meta-explain orca-whirlpool-mainnet swap_exact_in',
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
  const [pendingPoolSelection, setPendingPoolSelection] = useState<PendingPoolSelection | null>(null);

  const supportedTokens = useMemo(
    () => listSupportedTokens().map((token) => `${token.symbol} (${token.mint})`).join(', '),
    [],
  );

  function pushMessage(role: 'user' | 'assistant', text: string) {
    setMessages((prev) => [...prev, { id: prev.length + 1, role, text }]);
  }

  function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label} must be an object.`);
    }
    return value as Record<string, unknown>;
  }

  function asString(value: unknown, label: string): string {
    if (typeof value !== 'string') {
      throw new Error(`${label} must be a string.`);
    }
    return value;
  }

  function asBoolean(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') {
      throw new Error(`${label} must be a boolean.`);
    }
    return value;
  }

  function normalizePoolCandidates(raw: unknown): OrcaPoolCandidate[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((entry, index) => {
      const candidate = asRecord(entry, `pool_candidates[${index}]`);
      return {
        whirlpool: asString(candidate.whirlpool, `pool_candidates[${index}].whirlpool`),
        tokenMintA: asString(candidate.tokenMintA, `pool_candidates[${index}].tokenMintA`),
        tokenMintB: asString(candidate.tokenMintB, `pool_candidates[${index}].tokenMintB`),
        tickSpacing: asString(candidate.tickSpacing, `pool_candidates[${index}].tickSpacing`),
        liquidity: asString(candidate.liquidity, `pool_candidates[${index}].liquidity`),
      };
    });
  }

  function asPrettyJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  function renderMetaExplain(explanation: MetaOperationExplain): string {
    const formatRequired = (spec: Record<string, unknown>): string => {
      const required = spec.required === false ? 'optional' : 'required';
      const defaultText = spec.default !== undefined ? `, default=${JSON.stringify(spec.default)}` : '';
      return `${required}${defaultText}`;
    };

    const discoverLines = explanation.discover.map((step, index) => {
      const name = String(step.name ?? `step_${index + 1}`);
      const kind = String(step.discover ?? 'unknown');
      return `${index + 1}. ${name} -> ${kind}`;
    });

    const deriveLines = explanation.derive.map((step, index) => {
      const name = String(step.name ?? `step_${index + 1}`);
      const resolver = String(step.resolver ?? 'unknown');
      return `${index + 1}. ${name} -> ${resolver}`;
    });

    const computeLines = explanation.compute.map((step, index) => {
      const name = String(step.name ?? `step_${index + 1}`);
      const compute = String(step.compute ?? 'unknown');
      return `${index + 1}. ${name} -> ${compute}`;
    });

    const inputLines = Object.entries(explanation.inputs).map(
      ([name, spec]) => `- ${name}: ${String(spec.type ?? 'unknown')} (${formatRequired(spec)})`,
    );

    return [
      `Meta operation: ${explanation.protocolId}/${explanation.operationId}`,
      `schema: ${explanation.schema ?? 'n/a'} | version: ${explanation.version}`,
      `instruction: ${explanation.instruction}`,
      `templates used: ${explanation.templateUse.length > 0 ? explanation.templateUse.map((entry) => String(entry.template ?? entry.macro ?? 'unknown')).join(', ') : 'none'}`,
      '',
      'Inputs:',
      ...(inputLines.length > 0 ? inputLines : ['- none']),
      '',
      'Discover phase:',
      ...(discoverLines.length > 0 ? discoverLines : ['none']),
      '',
      'Derive phase:',
      ...(deriveLines.length > 0 ? deriveLines : ['none']),
      '',
      'Compute phase:',
      ...(computeLines.length > 0 ? computeLines : ['none']),
      '',
      `Build args keys: ${Object.keys(explanation.args).join(', ') || 'none'}`,
      `Build accounts keys: ${Object.keys(explanation.accounts).join(', ') || 'none'}`,
      `Post steps: ${explanation.post.length}`,
      '',
      'Expanded JSON:',
      asPrettyJson(explanation),
    ].join('\n');
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

  function readU64Le(data: Uint8Array, offset: number): bigint {
    if (data.length < offset + 8) {
      return 0n;
    }

    let value = 0n;
    for (let i = 0; i < 8; i += 1) {
      value |= BigInt(data[offset + i]) << BigInt(i * 8);
    }
    return value;
  }

  function decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  function readSplTokenAmountFromSimAccount(dataBase64: string | null): bigint {
    if (!dataBase64) {
      return 0n;
    }

    const bytes = decodeBase64(dataBase64);
    return readU64Le(bytes, 64);
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

  function compactInteger(value: string): string {
    if (value.length <= 12) {
      return value;
    }
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  function formatPoolChoiceLine(pool: OrcaPoolCandidate, index: number): string {
    return `${index + 1}. ${compactPubkey(pool.whirlpool)} | tickSpacing ${pool.tickSpacing} | liquidity ${compactInteger(pool.liquidity)}`;
  }

  async function executeSwapOrQuote(options: {
    kind: 'swap' | 'quote';
    value: SwapPrefillCommand | QuotePrefillCommand;
    poolIndex?: number;
  }): Promise<void> {
    if (!wallet.publicKey) {
      throw new Error('Connect wallet first to derive owner token accounts.');
    }
    const walletPublicKey = wallet.publicKey;

    const prepared = await prepareMetaInstruction({
      protocolId: ORCA_PROTOCOL_ID,
      operationId: ORCA_OPERATION_ID,
      input: {
        token_in_mint: options.value.inputMint,
        token_out_mint: options.value.outputMint,
        amount_in: options.value.amountAtomic,
        slippage_bps: options.value.slippageBps,
        ...(options.poolIndex !== undefined ? { pool_index: options.poolIndex } : {}),
      },
      connection,
      walletPublicKey,
    });

    const poolCandidates = normalizePoolCandidates(prepared.derived.pool_candidates);
    if (poolCandidates.length > 1 && options.poolIndex === undefined) {
      setPendingPoolSelection({
        kind: options.kind,
        command: options.value,
        candidates: poolCandidates,
      });
      pushMessage(
        'assistant',
        [
          `Multiple pools found for ${options.value.inputToken}/${options.value.outputToken}.`,
          'Pick a pool by clicking a button below or typing its number:',
          ...poolCandidates.map((pool, index) => formatPoolChoiceLine(pool, index)),
        ].join('\n'),
      );
      return;
    }

    setPendingPoolSelection(null);

    const selectedPoolRaw = prepared.derived.selected_pool;
    if (!selectedPoolRaw || typeof selectedPoolRaw !== 'object') {
      throw new Error('Missing derived selected_pool from meta runtime.');
    }
    const selectedPool = asRecord(selectedPoolRaw, 'selected_pool');
    const whirlpoolData = prepared.derived.whirlpool_data as Record<string, unknown> | undefined;
    const inputTokenMeta = resolveToken(options.value.inputMint);
    const outputTokenMeta = resolveToken(options.value.outputMint);

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

    const aToB = asBoolean(prepared.derived.a_to_b, 'a_to_b');
    const inputAta = aToB ? prepared.accounts.token_owner_account_a : prepared.accounts.token_owner_account_b;
    const outputAta = aToB ? prepared.accounts.token_owner_account_b : prepared.accounts.token_owner_account_a;
    let inputBalanceAtomic = '0';
    try {
      const inputBalance = await connection.getTokenAccountBalance(new PublicKey(inputAta), 'confirmed');
      inputBalanceAtomic = inputBalance.value.amount;
    } catch {
      inputBalanceAtomic = '0';
    }
    let outputBalanceAtomic = '0';
    try {
      const outputBalance = await connection.getTokenAccountBalance(new PublicKey(outputAta), 'confirmed');
      outputBalanceAtomic = outputBalance.value.amount;
    } catch {
      outputBalanceAtomic = '0';
    }

    const requiredInputAtomic = BigInt(options.value.amountAtomic);
    const availableInputAtomic = BigInt(inputBalanceAtomic);
    if (availableInputAtomic < requiredInputAtomic) {
      const availableUi = inputTokenMeta
        ? formatTokenAmount(availableInputAtomic.toString(), inputTokenMeta.decimals)
        : availableInputAtomic.toString();
      const requiredUi = inputTokenMeta
        ? formatTokenAmount(requiredInputAtomic.toString(), inputTokenMeta.decimals)
        : requiredInputAtomic.toString();
      throw new Error(
        `Insufficient ${options.value.inputToken} balance in input token account. Required: ${requiredUi} (${requiredInputAtomic.toString()}), available: ${availableUi} (${availableInputAtomic.toString()}).`,
      );
    }

    const rawPreviewByArgs = new Map<string, Record<string, unknown>>();
    const getRawPreview = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const cacheKey = JSON.stringify(args);
      const cached = rawPreviewByArgs.get(cacheKey);
      if (cached) {
        return cached;
      }

      const preview = {
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
          args,
          accounts: prepared.accounts,
          walletPublicKey,
        }),
      };

      rawPreviewByArgs.set(cacheKey, preview);
      return preview;
    };

    const provisionalArgs = prepared.args as Record<string, unknown>;
    let simulation: Awaited<ReturnType<typeof simulateIdlInstruction>>;
    try {
      simulation = await simulateIdlInstruction({
        protocolId: prepared.protocolId,
        instructionName: prepared.instructionName,
        args: provisionalArgs,
        accounts: prepared.accounts,
        preInstructions,
        // Estimate output on token accounts before any optional close-account post steps.
        postInstructions: [],
        includeAccounts: [inputAta, outputAta],
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown simulation error.';
      const rawPreview = await getRawPreview(provisionalArgs);
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    if (!simulation.ok) {
      const rawPreview = await getRawPreview(provisionalArgs);
      const simError = simulation.error ?? 'unknown';
      const logs = simulation.logs.join('\n');
      throw new Error(`Simulation failed: ${simError}\n${logs}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    const simInputAccount = simulation.accounts.find((entry) => entry.address === inputAta);
    const simOutputAccount = simulation.accounts.find((entry) => entry.address === outputAta);
    const preInputAtomic = availableInputAtomic;
    const preOutputAtomic = BigInt(outputBalanceAtomic);
    const postInputAtomic = readSplTokenAmountFromSimAccount(simInputAccount?.dataBase64 ?? null);
    const postOutputAtomic = readSplTokenAmountFromSimAccount(simOutputAccount?.dataBase64 ?? null);

    const estimatedInAtomicBigint = preInputAtomic > postInputAtomic ? preInputAtomic - postInputAtomic : 0n;
    const estimatedOutAtomicBigint = postOutputAtomic > preOutputAtomic ? postOutputAtomic - preOutputAtomic : 0n;
    if (estimatedOutAtomicBigint <= 0n) {
      throw new Error('Could not estimate output from simulation (estimated output is zero).');
    }

    const minOutAtomicBigint = (estimatedOutAtomicBigint * BigInt(10_000 - options.value.slippageBps)) / 10_000n;
    const minOutAtomic = (minOutAtomicBigint > 0n ? minOutAtomicBigint : 1n).toString();
    const finalArgs = {
      ...provisionalArgs,
      other_amount_threshold: minOutAtomic,
    };

    const estimatedInAtomic = estimatedInAtomicBigint.toString();
    const estimatedOutAtomic = estimatedOutAtomicBigint.toString();
    const estimatedInUi = inputTokenMeta ? formatTokenAmount(estimatedInAtomic, inputTokenMeta.decimals) : estimatedInAtomic;
    const estimatedOutUi = outputTokenMeta ? formatTokenAmount(estimatedOutAtomic, outputTokenMeta.decimals) : estimatedOutAtomic;
    const minOutUi = outputTokenMeta ? formatTokenAmount(minOutAtomic, outputTokenMeta.decimals) : minOutAtomic;
    let impliedRateText = 'n/a';
    if (inputTokenMeta && outputTokenMeta && estimatedInAtomic !== '0') {
      const inUi = new Decimal(estimatedInAtomic).div(new Decimal(10).pow(inputTokenMeta.decimals));
      const outUi = new Decimal(estimatedOutAtomic).div(new Decimal(10).pow(outputTokenMeta.decimals));
      if (inUi.gt(0)) {
        impliedRateText = outUi.div(inUi).toSignificantDigits(8).toString();
      }
    }

    const selectedWhirlpool = asString(selectedPool.whirlpool, 'selected_pool.whirlpool');
    if (options.kind === 'quote') {
      pushMessage(
        'assistant',
        [
          'Quote (meta IDL + simulation):',
          `pair: ${options.value.inputToken}/${options.value.outputToken}`,
          `pool: ${selectedWhirlpool}`,
          `input: ${estimatedInUi} ${options.value.inputToken}`,
          `estimated output: ${estimatedOutUi} ${options.value.outputToken}`,
          `min output @ ${options.value.slippageBps} bps: ${minOutUi} ${options.value.outputToken}`,
          `implied rate: 1 ${options.value.inputToken} ≈ ${impliedRateText} ${options.value.outputToken}`,
          `tick arrays: ${compactPubkey(prepared.accounts.tick_array_0)}, ${compactPubkey(prepared.accounts.tick_array_1)}, ${compactPubkey(prepared.accounts.tick_array_2)}`,
          `simulation: ok${simulation.unitsConsumed ? ` (${simulation.unitsConsumed} CU)` : ''}`,
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
        args: finalArgs,
        accounts: prepared.accounts,
        preInstructions,
        postInstructions,
        connection,
        wallet,
      });
    } catch (error) {
      const base = error instanceof Error ? error.message : 'Unknown send error.';
      const rawPreview = await getRawPreview(finalArgs);
      throw new Error(`${base}\n\nRaw instruction preview:\n${asPrettyJson(rawPreview)}`);
    }

    pushMessage(
      'assistant',
      [
        'Swap sent (meta IDL -> write-raw).',
        `pair: ${options.value.inputToken}/${options.value.outputToken}`,
        `pool: ${selectedWhirlpool}`,
        `estimatedOut: ${estimatedOutUi} ${options.value.outputToken} (${estimatedOutAtomic})`,
        result.signature,
        result.explorerUrl,
      ].join('\n'),
    );
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
      if (pendingPoolSelection) {
        if (/^\d+$/.test(raw)) {
          const oneBasedIndex = Number(raw);
          const zeroBasedIndex = oneBasedIndex - 1;
          if (zeroBasedIndex < 0 || zeroBasedIndex >= pendingPoolSelection.candidates.length) {
            throw new Error(`Pool selection out of range. Choose 1-${pendingPoolSelection.candidates.length}.`);
          }
          await executeSwapOrQuote({
            kind: pendingPoolSelection.kind,
            value: pendingPoolSelection.command,
            poolIndex: zeroBasedIndex,
          });
          return;
        }

        if (!raw.startsWith('/')) {
          throw new Error(
            `Select a pool by number (1-${pendingPoolSelection.candidates.length}) or enter a new command starting with /.`,
          );
        }

        setPendingPoolSelection(null);
      }

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

      if (parsed.kind === 'meta-explain') {
        const explanation = await explainMetaOperation({
          protocolId: parsed.value.protocolId,
          operationId: parsed.value.operationId,
        });
        pushMessage('assistant', renderMetaExplain(explanation));
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
        await executeSwapOrQuote({
          kind: parsed.kind,
          value: parsed.value,
        });
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

  async function handlePoolOptionClick(index: number) {
    if (!pendingPoolSelection) {
      return;
    }

    const oneBased = index + 1;
    pushMessage('user', String(oneBased));
    setIsWorking(true);
    try {
      await executeSwapOrQuote({
        kind: pendingPoolSelection.kind,
        value: pendingPoolSelection.command,
        poolIndex: index,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error while selecting pool.';
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

        {pendingPoolSelection ? (
          <div className="pending-block" aria-live="polite">
            <strong>
              Choose a pool for {pendingPoolSelection.command.inputToken}/{pendingPoolSelection.command.outputToken}
            </strong>
            <p>Click one option, or type the number in chat.</p>
            <div className="option-list">
              {pendingPoolSelection.candidates.map((candidate, index) => (
                <button
                  key={`${candidate.whirlpool}-${index}`}
                  type="button"
                  onClick={() => {
                    void handlePoolOptionClick(index);
                  }}
                  disabled={isWorking}
                >
                  {formatPoolChoiceLine(candidate, index)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

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
