import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { useApp } from '../store/app.ts';
import { Dialog } from './Dialog.tsx';
import styles from './Panel.module.css';

export function CitationCard() {
  const t = useT();
  const article = useApp((s) => s.citation);
  const close = useApp((s) => s.openCitation);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    setQr(null);
    if (!article?.url) return;
    let live = true;
    QRCode.toDataURL(article.url, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#0d1117', light: '#ffffff' } })
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [article]);

  if (!article) return null;
  const date = new Date(article.publishedAt);
  return (
    <Dialog kicker={`[${article.n}] ${article.source}`} title={article.title} onClose={() => close(null)} testId="citation">
      <div className={styles.citation}>
        <div>
          <div className={styles.citationMeta}>
            {date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {article.provider === 'naver' ? 'Naver' : 'Google News'}
          </div>
          {article.snippet && <p className={styles.citationSnippet}>{article.snippet}</p>}
          {/^https?:\/\//i.test(article.url) && (
            <a className={styles.citationLink} href={article.url} target="_blank" rel="noopener noreferrer">
              {t('citation.link')} ↗
            </a>
          )}
        </div>
        {qr && (
          <figure className={styles.qr}>
            <img src={qr} alt="" width={180} height={180} />
            <figcaption>
              <strong>{t('citation.open')}</strong>
              <span>{t('citation.scan')}</span>
            </figcaption>
          </figure>
        )}
      </div>
    </Dialog>
  );
}
