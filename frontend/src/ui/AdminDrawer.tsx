import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PROVIDERS, type ServerSettings } from '../../../shared/types.ts';
import { api, getAdminToken, setAdminToken } from '../api.ts';
import type { Settings } from '../config.ts';
import { useT } from '../i18n/index.ts';
import { useApp } from '../store/app.ts';
import { Dialog } from './Dialog.tsx';
import ui from './ui.module.css';
import styles from './AdminDrawer.module.css';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** A per-screen setting, applied immediately. */
function LocalSetting({ k, label }: { k: keyof Settings; label: string }) {
  const value = useApp((s) => s.settings[k]);
  const setSetting = useApp((s) => s.setSetting);
  return (
    <Field label={label}>
      <input
        className={styles.input}
        type="number"
        value={String(value)}
        onChange={(e) => e.target.value !== '' && Number.isFinite(e.target.valueAsNumber) && setSetting(k, e.target.valueAsNumber as never)}
      />
    </Field>
  );
}

/** Form state: text fields hold strings until saved. */
type Draft = { [K in keyof ServerSettings]: K extends 'newsProviders' ? ServerSettings[K] : string };

const toDraft = (s: ServerSettings): Draft =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Array.isArray(v) ? v : String(v)])) as Draft;

function fromDraft(draft: Draft, base: ServerSettings): Partial<ServerSettings> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft) as Array<[keyof ServerSettings, Draft[keyof ServerSettings]]>) {
    const value = typeof base[k] === 'number' ? Number(v) : v;
    if (JSON.stringify(value) !== JSON.stringify(base[k])) patch[k] = value;
  }
  return patch as Partial<ServerSettings>;
}

/** Shared settings: one save applies to every connected screen. */
function ServerForm() {
  const t = useT();
  const server = useApp((s) => s.server);
  const setServer = useApp((s) => s.setServer);
  const [draft, setDraft] = useState<Draft | null>(() => (server ? toDraft(server) : null));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (server && !draft) setDraft(toDraft(server));
  }, [server, draft]);

  if (!server || !draft) return <span className={ui.spinner} />;

  const text = (k: Exclude<keyof ServerSettings, 'newsProviders'>, label: string, type: 'text' | 'number' | 'password' = 'text') => (
    <Field label={label}>
      <input
        className={styles.input}
        type={type}
        value={draft[k]}
        onChange={(e) => setDraft({ ...draft, [k]: e.target.value } as Draft)}
        spellCheck={false}
        autoComplete="off"
      />
    </Field>
  );

  const run = async (task: () => Promise<{ settings: ServerSettings }>) => {
    setBusy(true);
    setStatus(null);
    try {
      const { settings } = await task();
      setServer(settings);
      setDraft(toDraft(settings));
      setStatus(t('admin.saved'));
    } catch (e) {
      setStatus(message(e));
    } finally {
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const patch = fromDraft(draft, server);
    if (Object.values(patch).some((v) => typeof v === 'number' && !Number.isFinite(v))) {
      setStatus(t('admin.invalidNumber'));
      return;
    }
    void run(() => api.saveSettings(patch));
  };

  const toggleProvider = (p: (typeof PROVIDERS)[number]) => {
    const list = draft.newsProviders.includes(p) ? draft.newsProviders.filter((x) => x !== p) : [...draft.newsProviders, p];
    setDraft({ ...draft, newsProviders: list });
  };

  return (
    <form className={styles.serverForm} onSubmit={save}>
      <section>
        <h3>{t('admin.llm')}</h3>
        {text('llmBaseUrl', t('admin.baseUrl'))}
        {text('llmModel', t('admin.model'))}
        {text('llmApiKey', t('admin.apiKey'), 'password')}
        {text('llmReasoningEffort', t('admin.reasoning'))}
        {text('llmTemperature', t('admin.temperature'), 'number')}
        {text('llmContextTokens', t('admin.context'), 'number')}
        <LlmTest />
      </section>

      <section>
        <h3>{t('admin.news')}</h3>
        {text('naverClientId', t('admin.naverId'))}
        {text('naverClientSecret', t('admin.naverSecret'), 'password')}
        <Field label={t('admin.providers')}>
          <div className={styles.row}>
            {PROVIDERS.map((p) => (
              <button key={p} type="button" className={`${ui.button} ${ui.small} ${ui.toggle}`} aria-pressed={draft.newsProviders.includes(p)} onClick={() => toggleProvider(p)}>
                {p === 'naver' ? 'Naver' : 'Google News'}
              </button>
            ))}
          </div>
        </Field>
        {text('newsMax', t('admin.newsMax'), 'number')}
        {text('newsDays', t('admin.newsDays'), 'number')}
        {text('reportTtlMinutes', t('admin.ttl'), 'number')}
      </section>

      <div className={styles.saveRow}>
        <button type="submit" className={`${ui.button} ${ui.small} ${ui.primary}`} disabled={busy}>
          {t('admin.save')}
        </button>
        <button type="button" className={`${ui.button} ${ui.small}`} disabled={busy} onClick={() => void run(api.resetSettings)}>
          {t('admin.resetServer')}
        </button>
        {status && <span className={styles.result}>{status}</span>}
      </div>
    </form>
  );
}

function LlmTest() {
  const t = useT();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.testLlm();
      setResult(r.ok ? `${t('admin.ok')} · ${r.seconds.toFixed(1)}s · "${r.reply}"` : r.error);
    } catch (e) {
      setResult(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.row}>
      <button type="button" className={`${ui.button} ${ui.small}`} onClick={() => void run()} disabled={busy}>
        {busy ? <span className={ui.spinner} /> : null} {t('admin.testLlm')}
      </button>
      <span className={ui.hint}>{t('admin.testHint')}</span>
      {result && <span className={styles.result}>{result}</span>}
    </div>
  );
}

function Prewarm() {
  const t = useT();
  const [skip, setSkip] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { running, done, total, current, failed } = useApp((s) => s.prewarm);
  const lang = useApp((s) => s.settings.contentLang);
  const act = (task: () => Promise<unknown>) => {
    setError(null);
    task().catch((e: unknown) => setError(message(e)));
  };
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
          <button className={`${ui.button} ${ui.small} ${ui.danger}`} onClick={() => act(api.stopPrewarm)}>
            {t('admin.prewarmStop')}
          </button>
        ) : (
          <button className={`${ui.button} ${ui.small} ${ui.primary}`} onClick={() => act(() => api.startPrewarm(skip, lang))}>
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
        <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <span style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}
      {error && <p className={ui.error}>{error}</p>}
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
  const [status, setStatus] = useState<string | null>(null);

  const act = async (task: () => Promise<string | null>) => {
    setStatus(null);
    try {
      setStatus(await task());
    } catch (e) {
      setStatus(message(e));
    }
  };
  const doExport = async () => {
    const url = URL.createObjectURL(await api.exportReports());
    const a = document.createElement('a');
    a.href = url;
    a.download = `kbdv-reports-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return null;
  };
  const doClear = async () => {
    if (!window.confirm(t('admin.clearConfirm'))) return null;
    await api.clearReports();
    return null;
  };

  return (
    <div className={styles.block}>
      <div className={styles.row}>
        <span className={styles.result}>{t('admin.cacheCount', { n: count })}</span>
        <button className={`${ui.button} ${ui.small}`} onClick={() => void act(doExport)}>
          {t('admin.export')}
        </button>
        <button className={`${ui.button} ${ui.small}`} onClick={() => fileRef.current?.click()}>
          {t('admin.import')}
        </button>
        <button className={`${ui.button} ${ui.small} ${ui.danger}`} onClick={() => void act(doClear)}>
          {t('admin.clear')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void act(async () => `+${await api.importReports(f)}`);
            e.target.value = '';
          }}
        />
      </div>
      {status && <p className={ui.hint}>{status}</p>}
    </div>
  );
}

function TokenField() {
  const t = useT();
  const [token, setToken] = useState(getAdminToken);
  return (
    <Field label={t('admin.token')}>
      <input
        className={styles.input}
        type="password"
        value={token}
        onChange={(e) => {
          setToken(e.target.value);
          setAdminToken(e.target.value);
        }}
        autoComplete="off"
      />
    </Field>
  );
}

export function AdminDrawer() {
  const t = useT();
  const open = useApp((s) => s.adminOpen);
  const setOpen = useApp((s) => s.setAdminOpen);
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const reset = useApp((s) => s.resetSettings);
  const adminProtected = useApp((s) => s.adminProtected);
  if (!open) return null;

  return (
    <Dialog title={t('admin.title')} onClose={() => setOpen(false)} wide testId="admin">
      {adminProtected && (
        <div className={styles.token}>
          <TokenField />
          <p className={ui.hint}>{t('admin.tokenHint')}</p>
        </div>
      )}
      <p className={ui.hint}>{t('admin.sharedHint')}</p>
      <div className={styles.grid}>
        <ServerForm />

        <section>
          <h3>{t('admin.display')}</h3>
          <p className={ui.hint}>{t('admin.localHint')}</p>
          <Field label={t('admin.heatMetric')}>
            <div className={styles.row}>
              {(['sentiment', 'volume'] as const).map((m) => (
                <button key={m} className={`${ui.button} ${ui.small} ${ui.toggle}`} aria-pressed={settings.heatmapMetric === m} onClick={() => setSetting('heatmapMetric', m)}>
                  {t(m === 'sentiment' ? 'heat.sentiment' : 'heat.volume')}
                </button>
              ))}
            </div>
          </Field>
          <LocalSetting k="idleTourSeconds" label={t('admin.idle')} />
          <LocalSetting k="tourDwellSeconds" label={t('admin.dwell')} />
          <LocalSetting k="scale" label={t('admin.scale')} />
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
