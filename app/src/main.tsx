import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { AppProviders } from './AppProviders.tsx';
import { createLocalStorageStore } from './data/local-storage-store.ts';
import { registerServiceWorker } from './register-sw.ts';
import './styles.css';

const store = createLocalStorageStore();
const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <AppProviders store={store}>
      <App />
    </AppProviders>
  </StrictMode>,
);
registerServiceWorker();
