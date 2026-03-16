import { useMemo, useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import './App.css';
import { listSupportedTokens } from './constants/tokens';
import { BuilderTab } from './app/components/BuilderTab';
import { CommandTab } from './app/components/CommandTab';
import { useBuilderController } from './app/useBuilderController';
import { useBuilderSubmitController } from './app/useBuilderSubmitController';
import { useCommandController } from './app/useCommandController';

const DEFAULT_VIEW_API_BASE_URL = 'https://apppack-view-service.onrender.com';
const VIEW_API_BASE_URL = String(import.meta.env.VITE_VIEW_API_BASE_URL ?? DEFAULT_VIEW_API_BASE_URL)
  .trim()
  .replace(/\/+$/, '');
const QUICK_PREFILL_META_RUN_COMMAND =
  '/meta-run orca-whirlpool-mainnet swap_exact_in {"token_in_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","token_out_mint":"So11111111111111111111111111111111111111112","amount_in":"10000","slippage_bps":50,"estimated_out":"100000","whirlpool":"Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE","unwrap_sol_output":true} --simulate';

type AppTab = 'command' | 'builder';

function App() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [activeTab, setActiveTab] = useState<AppTab>('builder');
  const [isBuilderWorking, setIsBuilderWorking] = useState(false);

  const builder = useBuilderController();
  const {
    builderProtocols,
    builderProtocolId,
    builderApps,
    builderAppId,
    builderAppStepIndex,
    setBuilderAppStepCompleted,
    selectedBuilderApp,
    selectedBuilderAppStep,
    selectedBuilderStepActions,
    selectedBuilderAppSelectUi,
    selectedBuilderAppSelectableItems,
    selectedBuilderSelectedItemValue,
    showBuilderSelectableItems,
    selectedBuilderOperation,
    builderOperations,
    builderOperationId,
    builderViewMode,
    visibleBuilderInputs,
    hiddenBuilderInputsCount,
    isBuilderAppMode,
    builderAppSubmitMode,
    setBuilderAppSubmitMode,
    builderSimulate,
    setBuilderSimulate,
    builderStatusText,
    builderRawDetails,
    builderShowRawDetails,
    setBuilderStatusText,
    setBuilderRawDetails,
    setBuilderShowRawDetails,
    clearBuilderAppProgressFrom,
    applyBuilderAppStepResult,
    canOpenBuilderAppStep,
    setBuilderResult,
    builderInputValues,
    handleBuilderPrefillExample,
    handleBuilderModeEndUser,
    handleBuilderModeGeek,
    handleBuilderProtocolSelect,
    handleBuilderAppSelect,
    handleBuilderOperationSelect,
    handleBuilderAppOpenStep,
    handleBuilderAppBackStep,
    handleBuilderAppSelectItem,
    handleBuilderAppResetCurrentStep,
    handleBuilderInputChange,
    handleBuilderToggleRawDetails,
  } = builder;

  const supportedTokens = useMemo(
    () => listSupportedTokens().map((token) => `${token.symbol} (${token.mint})`).join(', '),
    [],
  );

  const command = useCommandController({
    connection,
    wallet,
    supportedTokens,
    viewApiBaseUrl: VIEW_API_BASE_URL,
    defaultViewApiBaseUrl: DEFAULT_VIEW_API_BASE_URL,
  });

  const {
    messages,
    commandInput,
    setCommandInput,
    isWorking: isCommandWorking,
    handleCommandSubmit,
    pushMessage,
  } = command;

  const { handleBuilderSubmit } = useBuilderSubmitController({
    connection,
    wallet,
    viewApiBaseUrl: VIEW_API_BASE_URL,
    pushMessage,
    setIsBuilderWorking,
    builderProtocolId,
    selectedBuilderOperation,
    builderInputValues,
    builderViewMode,
    selectedBuilderAppStep,
    selectedBuilderApp,
    builderAppStepIndex,
    setBuilderAppStepCompleted,
    clearBuilderAppProgressFrom,
    setBuilderStatusText,
    setBuilderRawDetails,
    setBuilderShowRawDetails,
    applyBuilderAppStepResult,
    setBuilderResult,
    isBuilderAppMode,
    builderAppSubmitMode,
    builderSimulate,
  });

  const isWorking = isBuilderWorking || isCommandWorking;

  return (
    <main className="page-shell">
      <section className="card-shell">
        <header className="card-header">
          <div>
            <h1>AppPack — AI Compatible by Design</h1>
            <p>Define once, execute everywhere: AppPack turns protocol specs into deterministic, verifiable on-chain read and transaction flows, so users and AI agents can discover options, simulate outcomes, and execute safely without external SDK lock-in, custom API glue, or fragile wallet-connection UX.</p>
          </div>
          <WalletMultiButton />
        </header>

        <div className="tab-switcher" role="tablist" aria-label="Mode">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'builder'}
            className={activeTab === 'builder' ? 'active' : ''}
            onClick={() => setActiveTab('builder')}
          >
            Forms
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'command'}
            className={activeTab === 'command' ? 'active' : ''}
            onClick={() => setActiveTab('command')}
          >
            Command
          </button>
        </div>

        {activeTab === 'command' ? (
          <CommandTab
            messages={messages}
            isWorking={isWorking}
            commandInput={commandInput}
            onCommandInputChange={setCommandInput}
            onSubmit={handleCommandSubmit}
            onPrefillMetaRun={() => setCommandInput(QUICK_PREFILL_META_RUN_COMMAND)}
          />
        ) : (
          <BuilderTab
            isWorking={isWorking}
            builderViewMode={builderViewMode}
            onModeEndUser={handleBuilderModeEndUser}
            onModeGeek={handleBuilderModeGeek}
            builderProtocols={builderProtocols}
            builderProtocolId={builderProtocolId}
            onSelectProtocol={handleBuilderProtocolSelect}
            builderApps={builderApps}
            builderAppId={builderAppId}
            onSelectApp={handleBuilderAppSelect}
            builderOperations={builderOperations}
            builderOperationId={builderOperationId}
            onSelectOperation={handleBuilderOperationSelect}
            selectedBuilderOperation={selectedBuilderOperation}
            selectedBuilderApp={selectedBuilderApp}
            selectedBuilderAppStep={selectedBuilderAppStep}
            selectedBuilderStepActions={selectedBuilderStepActions}
            builderAppStepIndex={builderAppStepIndex}
            canOpenBuilderAppStep={canOpenBuilderAppStep}
            onOpenBuilderAppStep={handleBuilderAppOpenStep}
            showBuilderSelectableItems={showBuilderSelectableItems}
            onBackStep={handleBuilderAppBackStep}
            onResetStep={handleBuilderAppResetCurrentStep}
            selectedBuilderAppSelectUi={selectedBuilderAppSelectUi}
            selectedBuilderAppSelectableItems={selectedBuilderAppSelectableItems}
            selectedBuilderSelectedItemValue={selectedBuilderSelectedItemValue}
            onSelectItem={handleBuilderAppSelectItem}
            hiddenBuilderInputsCount={hiddenBuilderInputsCount}
            visibleBuilderInputs={visibleBuilderInputs}
            builderInputValues={builderInputValues}
            onInputChange={handleBuilderInputChange}
            onPrefillExample={handleBuilderPrefillExample}
            isBuilderAppMode={isBuilderAppMode}
            builderAppSubmitMode={builderAppSubmitMode}
            onSetBuilderAppSubmitMode={setBuilderAppSubmitMode}
            builderSimulate={builderSimulate}
            onSetBuilderSimulate={setBuilderSimulate}
            onSubmit={handleBuilderSubmit}
            builderStatusText={builderStatusText}
            builderRawDetails={builderRawDetails}
            builderShowRawDetails={builderShowRawDetails}
            onToggleRawDetails={handleBuilderToggleRawDetails}
          />
        )}
      </section>
    </main>
  );
}

export default App;
