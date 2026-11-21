import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { PageHeader } from '../../ui/PageHeader.tsx';
import { KitCard } from '../records/records-kit.tsx';
import { AppView, SecurityView } from '../records/records-security.tsx';
import { SettingsView } from '../records/records-settings.tsx';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-6 flex-col gap-3">
      <h2 id={`${id}-h`} className="m-0 font-display text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One place for everything you can change: taxes, security and devices, the emergency kit, the app. */
export function Settings() {
  const { today } = useLedger();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash.length < 2) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);
  return (
    <div className="flex flex-col gap-7 lg:gap-8">
      <PageHeader title="Settings" visibleOnPhone />
      <Section id="taxes" title="Taxes">
        <SettingsView />
      </Section>
      <Section id="security" title="Security and devices">
        <SecurityView />
      </Section>
      <Section id="kit" title="Emergency kit">
        <div className="max-w-[640px]">
          <KitCard today={today} always />
        </div>
      </Section>
      <Section id="app" title="App">
        <AppView />
      </Section>
    </div>
  );
}
