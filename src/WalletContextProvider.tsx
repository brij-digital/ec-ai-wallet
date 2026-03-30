import { useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';

const RPC_ENDPOINT =
  import.meta.env.VITE_SOLANA_RPC_URL ?? 'https://api.brijmail.com/rpc';

export function WalletContextProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
