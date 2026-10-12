import { useEffect, type ReactNode } from 'react';
import ui from './ui.module.css';

interface Props {
  title: ReactNode;
  kicker?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
  testId?: string;
}

export function Dialog({ title, kicker, onClose, children, wide, testId }: Props) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={ui.backdrop} onClick={onClose} data-testid={testId}>
      <div className={`${ui.dialog} ${wide ? ui.wide : ''}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
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
