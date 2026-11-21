import { useRef } from 'react';
import { useToast } from '../../ui/Toast.tsx';
import { cx } from '../../lib/cx.ts';
import { KeyIcon } from '../../ui/auth-icons.tsx';
import { CopyIcon, ShareIcon } from '../../ui/save-icons.tsx';
import { CODE_LABEL, saveToPasswordManager } from './save-code.ts';

const BTN = 'press flex min-h-12 items-center justify-center gap-2 rounded-[14px] border border-line bg-surface text-[15px] font-semibold text-text hover:bg-surface-2';

/**
 * Save, copy and share the recovery code. The hidden form is what Safari and Firefox read when
 * Credential Management isn't there: a username and a new password, "submitted" to this same page.
 */
export function SaveCode({ code, className }: { code: string; className?: string }) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const save = async () => {
    const r = await saveToPasswordManager(code, formRef.current);
    toast.show(r === 'failed' ? 'Could not reach your password manager. Try Copy.' : 'Saved, if your password manager asked.');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.show('Copied. Paste it somewhere safe.', { success: true });
    } catch {
      toast.show('Could not copy. Select the code and copy it by hand.');
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: CODE_LABEL, text: code });
    } catch {
      // Closing the share sheet rejects; that is not an error.
    }
  };

  return (
    <div className={cx('flex flex-col gap-2.5', className)}>
      <form
        ref={formRef}
        // POST, never GET: should it ever be submitted for real, the code must not land in a URL.
        method="post"
        aria-hidden="true"
        autoComplete="on"
        className="sr-only"
        onSubmit={(e) => {
          e.preventDefault();
          // A same-page "navigation" is what makes browsers offer to save the password.
          window.history.replaceState(window.history.state, '', window.location.href);
        }}
      >
        <input type="text" name="username" tabIndex={-1} autoComplete="username" value={CODE_LABEL} readOnly />
        <input type="password" name="password" tabIndex={-1} autoComplete="new-password" value={code} readOnly />
        <button type="submit" tabIndex={-1}>
          Save
        </button>
      </form>
      <button type="button" onClick={() => void save()} className={cx(BTN, 'border-accent/60')}>
        <KeyIcon size={20} className="text-accent" />
        Save to password manager
      </button>
      <div className={cx('grid gap-2.5', canShare ? 'grid-cols-2' : 'grid-cols-1')}>
        <button type="button" onClick={() => void copy()} className={BTN}>
          <CopyIcon size={18} />
          Copy
        </button>
        {canShare && (
          <button type="button" onClick={() => void share()} className={BTN}>
            <ShareIcon size={18} />
            Share
          </button>
        )}
      </div>
      <p className="m-0 text-center text-xs leading-[1.45] text-muted">Password managers keep it encrypted and synced.</p>
    </div>
  );
}
