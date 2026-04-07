import { useEffect, useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import './App.css';
import { ComputeDevTab } from './app/components/ComputeDevTab';
import { RawOperationsTab } from './app/components/RawOperationsTab';
import { TradingViewTestTab } from './app/components/TradingViewTestTab';
import { ViewPlaygroundTab } from './app/components/ViewPlaygroundTab';
import { AgentTab } from './app/components/AgentTab';
import { RunnerTab } from './app/components/RunnerTab';

const VIEW_API_BASE_URL = 'https://api.brijmail.com';

type AppTab = 'indexViews' | 'raw' | 'compute' | 'tv' | 'agent' | 'runner';
type AppMode = 'normal' | 'advanced';
const NORMAL_TABS: AppTab[] = ['runner', 'indexViews', 'compute'];
const ADVANCED_TABS: AppTab[] = ['agent', 'raw', 'tv'];

const TAB_HASHES: Record<AppTab, string> = {
  agent: 'agent',
  runner: 'runner',
  indexViews: 'index-views',
  raw: 'raw',
  compute: 'compute',
  tv: 'tradingview',
};

function parseTabFromLocationHash(): AppTab {
  if (typeof window === 'undefined') {
    return 'runner';
  }
  const hash = window.location.hash.replace(/^#/, '').trim();
  const match = (Object.entries(TAB_HASHES) as Array<[AppTab, string]>).find(([, value]) => value === hash);
  return match?.[0] ?? 'runner';
}

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(parseTabFromLocationHash);
  const [appMode, setAppMode] = useState<AppMode>(() => {
    if (typeof window === 'undefined') {
      return 'normal';
    }
    const hash = window.location.hash.replace(/^#/, '').trim();
    if (!hash) {
      return 'normal';
    }
    return NORMAL_TABS.includes(parseTabFromLocationHash()) ? 'normal' : 'advanced';
  });

  const switchTab = (nextTab: AppTab) => {
    setActiveTab(nextTab);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${TAB_HASHES[nextTab]}`);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const onHashChange = () => {
      const nextTab = parseTabFromLocationHash();
      setActiveTab(nextTab);
      setAppMode(NORMAL_TABS.includes(nextTab) ? 'normal' : 'advanced');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (appMode === 'normal' && !NORMAL_TABS.includes(activeTab)) {
      switchTab('runner');
    }
  }, [activeTab, appMode]);

  const visibleTabs = appMode === 'normal' ? NORMAL_TABS : [...NORMAL_TABS, ...ADVANCED_TABS];

  return (
    <main className="page-shell">
      <section className="card-shell">
        <header className="card-header">
          <div className="card-header-copy">
            <h1>AppPack — AI Compatible by Design</h1>
            <p>Define once, execute everywhere: AppPack turns protocol specs into deterministic, verifiable on-chain read and transaction flows, so users and AI agents can discover options, simulate outcomes, and execute safely without external SDK lock-in, custom API glue, or fragile wallet-connection UX.</p>
          </div>
          <div className="card-header-wallet">
            <WalletMultiButton />
          </div>
        </header>

        <div className="mode-switcher" role="tablist" aria-label="Navigation mode">
          <button
            type="button"
            role="tab"
            aria-selected={appMode === 'normal'}
            className={appMode === 'normal' ? 'active' : ''}
            onClick={() => setAppMode('normal')}
          >
            Normal
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={appMode === 'advanced'}
            className={appMode === 'advanced' ? 'active' : ''}
            onClick={() => setAppMode('advanced')}
          >
            Advanced
          </button>
        </div>

        <div className="tab-switcher" role="tablist" aria-label="Mode">
          {visibleTabs.includes('agent') ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'agent'}
              className={activeTab === 'agent' ? 'active' : ''}
              onClick={() => switchTab('agent')}
            >
              Agent
            </button>
          ) : null}
          {visibleTabs.includes('runner') ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'runner'}
              className={activeTab === 'runner' ? 'active' : ''}
              onClick={() => switchTab('runner')}
            >
              Runner
            </button>
          ) : null}
          {visibleTabs.includes('indexViews') ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'indexViews'}
              className={activeTab === 'indexViews' ? 'active' : ''}
              onClick={() => switchTab('indexViews')}
            >
              Entities
            </button>
          ) : null}
          {visibleTabs.includes('raw') ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'raw'}
              className={activeTab === 'raw' ? 'active' : ''}
              onClick={() => switchTab('raw')}
            >
              Raw Ops
            </button>
          ) : null}
          {visibleTabs.includes('compute') ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'compute'}
              className={activeTab === 'compute' ? 'active' : ''}
              onClick={() => switchTab('compute')}
            >
              Compute
            </button>
          ) : null}
          {visibleTabs.includes('tv') ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'tv'}
              className={activeTab === 'tv' ? 'active' : ''}
              onClick={() => switchTab('tv')}
            >
              TradingView
            </button>
          ) : null}
        </div>
        <p className="tab-status-note">Active path is `Codama + runtime`. App packs are out of the contract.</p>

        {activeTab === 'raw' ? (
          <RawOperationsTab />
        ) : activeTab === 'compute' ? (
          <ComputeDevTab isWorking={false} />
        ) : activeTab === 'agent' ? (
          <AgentTab viewApiBaseUrl={VIEW_API_BASE_URL} />
        ) : activeTab === 'runner' ? (
          <RunnerTab />
        ) : activeTab === 'tv' ? (
          <TradingViewTestTab viewApiBaseUrl={VIEW_API_BASE_URL} />
        ) : activeTab === 'indexViews' ? (
          <ViewPlaygroundTab viewApiBaseUrl={VIEW_API_BASE_URL} viewKind="index" />
        ) : null}
      </section>
    </main>
  );
}

export default App;
