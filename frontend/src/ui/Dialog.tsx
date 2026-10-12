import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import ui from './ui.module.css';

interface Props {
  title: ReactNode;
  kicker?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
  testId?: string;
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside the dialog, as `aria-modal` promises. */
function trapTab(e: ReactKeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'Tab') return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden && el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function Dialog({ title, kicker, onClose, children, wide, testId }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Move focus into the dialog and give it back to where it was on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={ui.backdrop} onClick={onClose} data-testid={testId}>
      <div className={`${ui.dialog} ${wide ? ui.wide : ''}`} role="dialog" aria-modal="true" tabIndex={-1} ref={ref} onKeyDown={trapTab} onClick={(e) => e.stopPropagation()}>
        <div className={ui.dialogHeader}>
          <div>
            {kicker && <div className={ui.kicker}>{kicker}</div>}
            <h2>{title}</h2>
          </div>
          {onClose && (
            <button className={ui.close} onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        <div className={ui.dialogBody}>{children}</div>
      </div>
    </div>
  );
}
