import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { canonicalTarget } from '../../../shared/places.ts';
import type { Lang, Places, Target } from '../../../shared/types.ts';
import { useT } from '../i18n/index.ts';
import { useApp } from '../store/app.ts';
import styles from './SearchBar.module.css';

const MAX_PLACES = 7;
const MAX_PROMPT = 300;

interface PlaceOption {
  kind: 'place';
  target: Target;
  name: string;
  detail: string;
}
interface TopicOption {
  kind: 'topic';
  prompt: string;
}
type Option = PlaceOption | TopicOption;

interface Entry {
  target: Target;
  names: string[];
  label: Record<Lang, string>;
  country: Record<Lang, string> | null;
  /** Sort weight: countries first, then larger regions. */
  rank: number;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

function buildIndex(places: Places): Entry[] {
  const countries = places.countries.map((c, id) => ({
    target: { scope: 'country' as const, id },
    names: [norm(c.ko), norm(c.en)].filter(Boolean),
    label: { ko: c.ko || c.en, en: c.en },
    country: null,
    rank: 0,
  }));
  const regions = places.regions.flatMap((r, id) => {
    const c = places.countries[r.country];
    // Whole-country placeholders duplicate the country entry.
    if (r.key.endsWith('~all')) return [];
    return [
      {
        target: { scope: 'region' as const, id },
        names: [norm(r.ko), norm(r.en), r.q ? norm(r.q) : ''].filter(Boolean),
        label: { ko: r.ko || r.en, en: r.en || r.ko },
        country: { ko: c.ko || c.en, en: c.en },
        rank: 1,
      },
    ];
  });
  return [...countries, ...regions];
}

function matchPlaces(index: Entry[], query: string, lang: Lang): PlaceOption[] {
  const q = norm(query);
  if (!q) return [];
  const scored: Array<{ e: Entry; score: number }> = [];
  for (const e of index) {
    let best = Infinity;
    for (const n of e.names) {
      if (n === q) best = Math.min(best, 0);
      else if (n.startsWith(q)) best = Math.min(best, 1);
      else if (q.length >= 2 && n.includes(q)) best = Math.min(best, 2);
    }
    if (best < Infinity) scored.push({ e, score: best * 2 + e.rank });
  }
  scored.sort((a, b) => a.score - b.score || a.e.label[lang].length - b.e.label[lang].length);
  return scored.slice(0, MAX_PLACES).map(({ e }) => ({
    kind: 'place',
    target: e.target,
    name: e.label[lang],
    detail: e.country ? e.country[lang] : '',
  }));
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * Keyboard-first search: type a place to jump to it, or any request to build a news report on it.
 * `/` or Ctrl/⌘+K focuses it; arrows move through suggestions; Enter picks; Esc clears.
 */
export function SearchBar() {
  const t = useT();
  const places = useApp((s) => s.places);
  const lang = useApp((s) => s.settings.uiLang);
  const index = useMemo(() => (places ? buildIndex(places) : []), [places]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options = useMemo<Option[]>(() => {
    const text = query.replace(/\s+/g, ' ').trim();
    const found: Option[] = matchPlaces(index, text, lang);
    if (text.length >= 2) found.push({ kind: 'topic', prompt: text.slice(0, MAX_PROMPT) });
    return found;
  }, [index, query, lang]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (((e.ctrlKey || e.metaKey) && k === 'k') || (e.key === '/' && !isTyping(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const choose = (option: Option | undefined) => {
    if (!option) return;
    const app = useApp.getState();
    if (option.kind === 'topic') app.openTopic(option.prompt);
    else app.select(places ? canonicalTarget(places, option.target) : option.target, 'frame');
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // Hangul IME: Enter confirms the syllable first.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      setOpen(true);
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[Math.min(active, options.length - 1)]);
    } else if (e.key === 'Escape') {
      // Handled here so the global Esc (close panel) does not also fire.
      e.stopPropagation();
      if (query) setQuery('');
      else inputRef.current?.blur();
      setOpen(false);
    }
  };

  const expanded = open && options.length > 0;
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <div className={styles.wrap}>
      <span className={styles.icon} aria-hidden="true">
        ⌕
      </span>
      <input
        ref={inputRef}
        className={styles.input}
        type="search"
        role="combobox"
        aria-label={t('search.label')}
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? optionId(active) : undefined}
        placeholder={t('search.placeholder')}
        value={query}
        maxLength={MAX_PROMPT}
        spellCheck={false}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <kbd className={styles.kbd} aria-hidden="true">
        /
      </kbd>
      {expanded && (
        <ul id={listId} className={styles.list} role="listbox" aria-label={t('search.label')}>
          {options.map((o, i) => (
            <li
              key={o.kind === 'topic' ? 'topic' : `${o.target.scope}:${o.target.id}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={`${styles.option} ${i === active ? styles.active : ''} ${o.kind === 'topic' ? styles.topic : ''}`}
              // mousedown, not click: the input would blur and close the list before a click lands.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.kind === 'topic' ? (
                <>
                  <span className={styles.badge}>{t('search.topicBadge')}</span>
                  <span className={styles.name}>{t('search.topic', { q: o.prompt })}</span>
                </>
              ) : (
                <>
                  <span className={styles.name}>{o.name}</span>
                  <span className={styles.detail}>{o.detail || t('panel.country')}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
