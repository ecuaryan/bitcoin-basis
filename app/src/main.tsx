import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { AppProviders } from './AppProviders.tsx';
import { captureInstallPrompt } from './data/install.ts';
import { createLocalStorageStore } from './data/local-storage-store.ts';
import { openVault } from './data/open-vault.ts';
import { incomingRecovery } from './data/recovery-handoff.ts';
import { registerServiceWorker } from './register-sw.ts';
import { takeRecoveryCodeFromUrl } from './vault/index.ts';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

// A recovery code in the address (`#recover=`, from the emergency kit's QR code) is read once and
// taken out of the address bar and history straight away.
incomingRecovery.set(takeRecoveryCodeFromUrl());
captureInstallPrompt();

const vault = await openVault();
const demoStore = createLocalStorageStore();

createRoot(root).render(
  <StrictMode>
    <AppProviders vault={vault} demoStore={demoStore}>
      <App />
    </AppProviders>
  </StrictMode>,
);
registerServiceWorker();
