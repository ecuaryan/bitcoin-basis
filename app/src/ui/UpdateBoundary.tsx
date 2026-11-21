import { Component, type ErrorInfo, type ReactNode } from 'react';
import { VaultError } from '../vault/errors.ts';

/**
 * A screen whose code failed to load is almost always a page left open across a deploy: its
 * chunk names are gone from the server. Say so and offer the reload, instead of a blank app.
 */
export function isChunkLoadError(e: unknown): boolean {
  const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch module|ChunkLoadError|Unable to preload CSS/i.test(text);
}

export const UPDATE_READY_TEXT = 'A new version of Bitcoin Basis is ready.';

interface State {
  readonly error: unknown;
}

/** Catches a render error below it (a lazy screen that failed to load, above all) and offers a reload. */
export class UpdateBoundary extends Component<{ children: ReactNode; reload?: () => void }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('screen failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const update = isChunkLoadError(this.state.error);
    return (
      <Problem
        title={update ? UPDATE_READY_TEXT : 'This screen could not open.'}
        text={update ? 'Reload to update. Your records are safe on this device.' : 'Reload to try again. Your records are safe on this device.'}
        action={update ? 'Reload to update' : 'Reload'}
        {...(this.props.reload === undefined ? {} : { reload: this.props.reload })}
      />
    );
  }
}

/** Shown instead of the app when it can't start (its on-device storage won't open). */
export function StartupProblem({ error, reload }: { error: unknown; reload?: () => void }) {
  const busy = error instanceof VaultError && error.code === 'storage-blocked';
  return (
    <Problem
      title={busy ? 'Bitcoin Basis is open somewhere else.' : 'Bitcoin Basis could not start.'}
      text={busy ? 'Close its other windows or tabs (or the installed app), then reload.' : 'It could not open its storage on this device. Reload to try again.'}
      action="Reload"
      {...(reload === undefined ? {} : { reload })}
    />
  );
}

function Problem({ title, text, action, reload = () => window.location.reload() }: { title: string; text: string; action: string; reload?: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="m-0 font-display text-[22px] font-semibold">{title}</h1>
      <p className="m-0 max-w-[300px] text-[15px] leading-normal text-soft">{text}</p>
      <button type="button" onClick={reload} className="min-h-[52px] rounded-2xl bg-accent px-6 text-[16px] font-bold text-bg">
        {action}
      </button>
    </main>
  );
}
