import { useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import './App.css';
import { AppsTab } from './app/components/AppsTab';
import { PumpWorkspaceTab } from './app/components/PumpWorkspaceTab';
import { ComputeDevTab } from './app/components/ComputeDevTab';
import { RawOperationsTab } from './app/components/RawOperationsTab';
import { TradingViewTestTab } from './app/components/TradingViewTestTab';
import { ViewPlaygroundTab } from './app/components/ViewPlaygroundTab';

const DEFAULT_VIEW_API_BASE_URL = 'https://apppack-view-service.onrender.com';
const VIEW_API_BASE_URL = String(import.meta.env.VITE_VIEW_API_BASE_URL ?? DEFAULT_VIEW_API_BASE_URL)
  .trim()
  .replace(/\/+$/, '');

type AppTab = 'views' | 'pump' | 'apps' | 'raw' | 'compute' | 'tv';
const DISABLED_TABS = ['Command', 'Explorer'] as const;

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('pump');

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
            aria-selected={activeTab === 'pump'}
            className={activeTab === 'pump' ? 'active' : ''}
            onClick={() => setActiveTab('pump')}
          >
            Pump
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'views'}
            className={activeTab === 'views' ? 'active' : ''}
            onClick={() => setActiveTab('views')}
          >
            Views
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'apps'}
            className={activeTab === 'apps' ? 'active' : ''}
            onClick={() => setActiveTab('apps')}
          >
            Apps
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'raw'}
            className={activeTab === 'raw' ? 'active' : ''}
            onClick={() => setActiveTab('raw')}
          >
            Raw Ops
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'compute'}
            className={activeTab === 'compute' ? 'active' : ''}
            onClick={() => setActiveTab('compute')}
          >
            Compute
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tv'}
            className={activeTab === 'tv' ? 'active' : ''}
            onClick={() => setActiveTab('tv')}
          >
            TradingView
          </button>
          {DISABLED_TABS.map((label) => (
            <button
              key={label}
              type="button"
              role="tab"
              className="disabled-tab"
              aria-disabled="true"
              disabled
              title={`${label} is disabled until the app spec is brought back into the active path.`}
            >
              {label}
              <span>off</span>
            </button>
          ))}
        </div>
        <p className="tab-status-note">Raw Ops run on `runtime` only. Apps use the lightweight `app` spec for UX and flow.</p>

        {activeTab === 'pump' ? (
          <PumpWorkspaceTab viewApiBaseUrl={VIEW_API_BASE_URL} />
        ) : activeTab === 'apps' ? (
          <AppsTab viewApiBaseUrl={VIEW_API_BASE_URL} />
        ) : activeTab === 'raw' ? (
          <RawOperationsTab viewApiBaseUrl={VIEW_API_BASE_URL} />
        ) : activeTab === 'compute' ? (
          <ComputeDevTab isWorking={false} />
        ) : activeTab === 'tv' ? (
          <TradingViewTestTab viewApiBaseUrl={VIEW_API_BASE_URL} />
        ) : activeTab === 'views' ? (
          <ViewPlaygroundTab viewApiBaseUrl={VIEW_API_BASE_URL} />
        ) : null}
      </section>
    </main>
  );
}

export default App;
