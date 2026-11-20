import { Navigate, Route, Routes } from 'react-router';
import { Holdings } from './screens/Holdings.tsx';
import { Kit, NotFound, Unlock, Welcome } from './screens/stubs.tsx';
import { AppShell, useLogSheet } from './ui/AppShell.tsx';
import { lazy, Suspense, useEffect } from 'react';

// Everything except Holdings loads on demand, so the first screen stays small.
const WhatIf = lazy(() => import('./screens/whatif/WhatIf.tsx').then((m) => ({ default: m.WhatIf })));
const Records = lazy(() => import('./screens/records/Records.tsx').then((m) => ({ default: m.Records })));
const Tax = lazy(() => import('./screens/tax/Tax.tsx').then((m) => ({ default: m.Tax })));
const TaxSummary = lazy(() => import('./screens/tax/TaxSummary.tsx').then((m) => ({ default: m.TaxSummary })));
const WalletDetail = lazy(() => import('./screens/wallet/WalletDetail.tsx').then((m) => ({ default: m.WalletDetail })));
const GiftNotePage = lazy(() => import('./screens/log/GiftNote.tsx').then((m) => ({ default: m.GiftNotePage })));

/** `/log` opens the Log sheet over Holdings (a deep link for the + button). */
function LogRoute() {
  const { open } = useLogSheet();
  useEffect(() => open(), [open]);
  return <Navigate to="/" replace />;
}

export function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Holdings />} />
          <Route path="what-if" element={<WhatIf />} />
          <Route path="records" element={<Records />} />
          <Route path="tax" element={<Tax />} />
          <Route path="wallet/:id" element={<WalletDetail />} />
          <Route path="log" element={<LogRoute />} />
        </Route>
        <Route path="tax/summary/:year" element={<TaxSummary />} />
        <Route path="gift-note/:id" element={<GiftNotePage />} />
        <Route path="welcome" element={<Welcome />} />
        <Route path="unlock" element={<Unlock />} />
        <Route path="kit" element={<Kit />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
