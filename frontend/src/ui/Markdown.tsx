import { Fragment, type ReactNode } from 'react';
import { useApp } from '../store/app.ts';
import type { Article } from '../../../shared/types.ts';
import styles from './Markdown.module.css';

const INLINE = /(\*\*[^*\n]+\*\*|\[\d+(?:\s*[,，]\s*\d+)*\])/g;

function Citation({ article }: { article: Article }) {
  const open = useApp((s) => s.openCitation);
  return (
    <button className={styles.cite} onClick={() => open(article)} aria-label={article.title}>
      {article.n}
    </button>
  );
}

function inline(text: string, byNumber: Map<number, Article>): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const cite = part.match(/^\[(.+)\]$/);
    if (cite) {
      const refs = cite[1].split(/[,，]/).map((s) => byNumber.get(Number(s.trim())));
      if (refs.every(Boolean)) {
        return (
          <span key={i} className={styles.cites}>
            {refs.map((a) => (
              <Citation key={a!.n} article={a!} />
            ))}
          </span>
        );
      }
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Renders the small Markdown subset the prompts ask for: `##` headings, bullet lists, paragraphs, bold and [n] citations. */
export function Markdown({ text, articles, streaming }: { text: string; articles: Article[]; streaming?: boolean }) {
  const byNumber = new Map(articles.map((a) => [a.n, a]));
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let para: string[] = [];

  const flushList = () => {
    if (list.length) blocks.push(<ul key={`ul${blocks.length}`}>{list}</ul>);
    list = [];
  };
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), byNumber)}</p>);
    para = [];
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (!line) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(<h3 key={`h${blocks.length}`}>{inline(heading[1].replace(/\*\*/g, ''), byNumber)}</h3>);
    } else if (item) {
      flushPara();
      list.push(<li key={list.length}>{inline(item[1], byNumber)}</li>);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return (
    <div className={`${styles.md} ${streaming ? styles.streaming : ''}`}>
      {blocks}
    </div>
  );
}
