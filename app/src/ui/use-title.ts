import { useEffect } from 'react';

export const APP_NAME = 'Bitcoin Basis';

/** The browser tab and history title: "Holdings · Bitcoin Basis", or just the app name. */
export function titleFor(screen?: string | null): string {
  return screen ? `${screen} · ${APP_NAME}` : APP_NAME;
}

/** Sets the document title while the screen is shown. */
export function useTitle(screen?: string | null): void {
  useEffect(() => {
    document.title = titleFor(screen);
  }, [screen]);
}
