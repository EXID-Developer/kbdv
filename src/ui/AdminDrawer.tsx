import { useRef, useState, type ReactNode } from 'react';
import type { Settings } from '../config.ts';
import { useT } from '../i18n/index.ts';
import { startPrewarm, stopPrewarm, usePrewarm } from '../kiosk/prewarm.ts';
import { clearReports, exportReports, importReports } from '../services/cache.ts';
import { chat } from '../services/llm.ts';
import { useApp } from '../store/app.ts';
import type { Provider } from '../types.ts';
import { Dialog } from './Dialog.tsx';
import { reloadSummaries } from './useReport.ts';
import ui from './ui.module.css';
import styles from './AdminDrawer.module.css';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextSetting({ k, label, type = 'text' }: { k: keyof Settings; label: string; type?: string }) {
  const value = useApp((s) => s.settings[k]);
  const setSetting = useApp((s) => s.setSetting);
  return (
    <Field label={label}>
      <input
        className={styles.input}
        type={type}
        value={String(value)}
        onChange={(e) => setSetting(k, (type === 'number' ? Number(e.target.value) : e.target.value) as never)}
        spellCheck={false}
        autoComplete="off"
      />
    </Field>
  );
}

function LlmTest() {
  const t = useT();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setResult(null);
    const start = performance.now();
    try {
      const reply = await chat(useApp.getState().settings, [{ role: 'user', content: 'Reply with the single word OK.' }], {
        maxTokens: 20,
        signal: AbortSignal.timeout(60_000),
      });
      setResult(`${t('admin.ok')} · ${((performance.now() - start) / 1000).toFixed(1)}s · "${reply.trim().slice(0, 40)}"`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.row}>
      <button className={`${ui.button} ${ui.small}`} onClick={() => void run()} disabled={busy}>
        {busy ? <span className={ui.spinner} /> : null} {t('admin.testLlm')}
      </button>
      {result && <span className={styles.result}>{result}</span>}
    </div>
  );
}

function Prewarm() {
  const t = useT();
  const [skip, setSkip] = useState(true);
  const { running, done, total, current, failed } = usePrewarm();
  return (
    <div className={styles.block}>
      <div className={styles.blockTitle}>{t('admin.prewarm')}</div>
      <p className={ui.hint}>{t('admin.prewarmHint')}</p>
      <label className={styles.check}>
        <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} disabled={running} />
        {t('admin.prewarmSkip')}
      </label>
      <div className={styles.row}>
        {running ? (
          <button className={`${ui.button} ${ui.small} ${ui.danger}`} onClick={stopPrewarm}>
            {t('admin.prewarmStop')}
          </button>
        ) : (
          <button className={`${ui.button} ${ui.small} ${ui.primary}`} onClick={() => void startPrewarm(skip)}>
            {t('admin.prewarmStart')}
          </button>
        )}
        {total > 0 && (
          <span className={styles.result}>
            {done}/{total} {current && `· ${current}`}
          </span>
        )}
      </div>
      {total > 0 && (
        <div className={styles.progress}>
          <span style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}
      {failed.length > 0 && (
        <ul className={styles.failed}>
          {failed.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CacheTools() {
  const t = useT();
  const count = useApp((s) => Object.keys(s.summaries).length);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const doExport = async () => {
    const url = URL.createObjectURL(await exportReports());
    const a = document.createElement('a');
    a.href = url;
    a.download = `kbdv-reports-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const doImport = async (file: File) => {
    try {
      const n = await importReports(file);
      await reloadSummaries();
      setMessage(`+${n}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const doClear = async () => {
    if (!window.confirm(t('admin.clearConfirm'))) return;
    await clearReports();
    useApp.getState().setSummaries({});
  };

  return (
    <div className={styles.block}>
      <div className={styles.row}>
        <span className={styles.result}>{t('admin.cacheCount', { n: count })}</span>
        <button className={`${ui.button} ${ui.small}`} onClick={() => void doExport()}>
          {t('admin.export')}
        </button>
        <button className={`${ui.button} ${ui.small}`} onClick={() => fileRef.current?.click()}>
          {t('admin.import')}
        </button>
        <button className={`${ui.button} ${ui.small} ${ui.danger}`} onClick={() => void doClear()}>
          {t('admin.clear')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = '';
          }}
        />
      </div>
      {message && <p className={ui.hint}>{message}</p>}
    </div>
  );
}

export function AdminDrawer() {
  const t = useT();
  const open = useApp((s) => s.adminOpen);
  const setOpen = useApp((s) => s.setAdminOpen);
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const reset = useApp((s) => s.resetSettings);
  if (!open) return null;

  const toggleProvider = (p: Provider) => {
    const list = settings.newsProviders.includes(p) ? settings.newsProviders.filter((x) => x !== p) : [...settings.newsProviders, p];
    setSetting('newsProviders', list);
  };

  return (
    <Dialog title={t('admin.title')} onClose={() => setOpen(false)} wide testId="admin">
      <div className={styles.grid}>
        <section>
          <h3>{t('admin.llm')}</h3>
          <TextSetting k="llmBaseUrl" label={t('admin.baseUrl')} />
          <TextSetting k="llmModel" label={t('admin.model')} />
          <TextSetting k="llmApiKey" label={t('admin.apiKey')} type="password" />
          <TextSetting k="llmReasoningEffort" label={t('admin.reasoning')} />
          <TextSetting k="llmTemperature" label={t('admin.temperature')} type="number" />
          <TextSetting k="llmContextTokens" label={t('admin.context')} type="number" />
          <LlmTest />
        </section>

        <section>
          <h3>{t('admin.news')}</h3>
          <TextSetting k="naverClientId" label={t('admin.naverId')} />
          <TextSetting k="naverClientSecret" label={t('admin.naverSecret')} type="password" />
          <Field label={t('admin.providers')}>
            <div className={styles.row}>
              {(['naver', 'google'] as const).map((p) => (
                <button key={p} className={`${ui.button} ${ui.small} ${ui.toggle}`} aria-pressed={settings.newsProviders.includes(p)} onClick={() => toggleProvider(p)}>
                  {p === 'naver' ? 'Naver' : 'Google News'}
                </button>
              ))}
            </div>
          </Field>
          <TextSetting k="newsMax" label={t('admin.newsMax')} type="number" />
          <TextSetting k="newsDays" label={t('admin.newsDays')} type="number" />
        </section>

        <section>
          <h3>{t('admin.display')}</h3>
          <Field label={t('admin.heatMetric')}>
            <div className={styles.row}>
              {(['sentiment', 'volume'] as const).map((m) => (
                <button key={m} className={`${ui.button} ${ui.small} ${ui.toggle}`} aria-pressed={settings.heatmapMetric === m} onClick={() => setSetting('heatmapMetric', m)}>
                  {t(m === 'sentiment' ? 'heat.sentiment' : 'heat.volume')}
                </button>
              ))}
            </div>
          </Field>
          <TextSetting k="idleTourSeconds" label={t('admin.idle')} type="number" />
          <TextSetting k="tourDwellSeconds" label={t('admin.dwell')} type="number" />
          <TextSetting k="scale" label={t('admin.scale')} type="number" />
          <button className={`${ui.button} ${ui.small}`} onClick={reset}>
            {t('admin.reset')}
          </button>
        </section>

        <section>
          <h3>{t('admin.cache')}</h3>
          <CacheTools />
          <Prewarm />
        </section>
      </div>
    </Dialog>
  );
}
