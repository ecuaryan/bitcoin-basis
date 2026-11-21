import { Navigate, Route, Routes } from 'react-router';
import { Holdings } from './screens/Holdings.tsx';
import { NotFound } from './screens/stubs.tsx';
import { RequireVault } from './screens/auth/RequireVault.tsx';
import { ReadyGate } from './ui/ready-gate.tsx';
import { AppShell, useLogSheet } from './ui/AppShell.tsx';
import { lazy, Suspense, useEffect } from 'react';
import { useServiceWorkerUpdateToast } from './register-sw.ts';
import { UpdateBoundary } from './ui/UpdateBoundary.tsx';
import { useScrollBehavior } from './ui/scroll-behavior.ts';

// Everything except Holdings loads on demand, so the first screen stays small.
const WhatIf = lazy(() => import('./screens/whatif/WhatIf.tsx').then((m) => ({ default: m.WhatIf })));
const Settings = lazy(() => import('./screens/settings/Settings.tsx').then((m) => ({ default: m.Settings })));
const Records = lazy(() => import('./screens/records/Records.tsx').then((m) => ({ default: m.Records })));
const Tax = lazy(() => import('./screens/tax/Tax.tsx').then((m) => ({ default: m.Tax })));
const TaxSummary = lazy(() => import('./screens/tax/TaxSummary.tsx').then((m) => ({ default: m.TaxSummary })));
const LoanPage = lazy(() => import('./screens/loans/LoanPage.tsx').then((m) => ({ default: m.LoanPage })));
const WalletDetail = lazy(() => import('./screens/wallet/WalletDetail.tsx').then((m) => ({ default: m.WalletDetail })));
const Welcome = lazy(() => import('./screens/auth/Welcome.tsx').then((m) => ({ default: m.Welcome })));
const Kit = lazy(() => import('./screens/auth/Kit.tsx').then((m) => ({ default: m.Kit })));
const GiftNotePage = lazy(() => import('./screens/log/GiftNote.tsx').then((m) => ({ default: m.GiftNotePage })));

/** `/log` opens the Log sheet over Holdings (a deep link for the + button). */
function LogRoute() {
  const { open } = useLogSheet();
  useEffect(() => open(), [open]);
  return <Navigate to="/" replace />;
}

export function App() {
  useServiceWorkerUpdateToast();
  useScrollBehavior();
  return (
    // A screen's code that fails to load (a page left open across a deploy) offers "Reload to update", never a blank app.
    <UpdateBoundary>
      <Suspense fallback={null}>
        <Routes>
          <Route
            element={
              <RequireVault>
                <AppShell />
              </RequireVault>
            }
          >
            <Route index element={<Holdings />} />
            <Route path="what-if" element={<WhatIf />} />
            <Route path="records" element={<Records />} />
            <Route path="settings" element={<Settings />} />
            <Route path="tax" element={<Tax />} />
            <Route path="wallet/:id" element={<WalletDetail />} />
            <Route path="loans/:id" element={<LoanPage />} />
            <Route path="log" element={<LogRoute />} />
          </Route>
          <Route path="tax/summary/:year" element={<RequireVault><ReadyGate><TaxSummary /></ReadyGate></RequireVault>} />
          <Route path="gift-note/:id" element={<RequireVault><ReadyGate><GiftNotePage /></ReadyGate></RequireVault>} />
          <Route path="welcome" element={<Welcome />} />
          <Route path="unlock" element={<RequireVault><Navigate to="/" replace /></RequireVault>} />
          <Route path="kit" element={<RequireVault><Kit /></RequireVault>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </UpdateBoundary>
  );
}
