const parser = new DOMParser();

/** Strips tags and decodes entities. */
export function decodeHtml(html: string): string {
  return (parser.parseFromString(html, 'text/html').documentElement.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const OUTLETS: Record<string, string> = {
  'yna.co.kr': '연합뉴스',
  'yonhapnewstv.co.kr': '연합뉴스TV',
  'newsis.com': '뉴시스',
  'news1.kr': '뉴스1',
  'chosun.com': '조선일보',
  'joongang.co.kr': '중앙일보',
  'donga.com': '동아일보',
  'hani.co.kr': '한겨레',
  'khan.co.kr': '경향신문',
  'hankookilbo.com': '한국일보',
  'kmib.co.kr': '국민일보',
  'seoul.co.kr': '서울신문',
  'segye.com': '세계일보',
  'munhwa.com': '문화일보',
  'mk.co.kr': '매일경제',
  'hankyung.com': '한국경제',
  'sedaily.com': '서울경제',
  'mt.co.kr': '머니투데이',
  'edaily.co.kr': '이데일리',
  'fnnews.com': '파이낸셜뉴스',
  'heraldcorp.com': '헤럴드경제',
  'asiae.co.kr': '아시아경제',
  'kbs.co.kr': 'KBS',
  'imbc.com': 'MBC',
  'sbs.co.kr': 'SBS',
  'jtbc.co.kr': 'JTBC',
  'ytn.co.kr': 'YTN',
  'mbn.co.kr': 'MBN',
  'tvchosun.com': 'TV조선',
  'ichannela.com': '채널A',
  'nocutnews.co.kr': '노컷뉴스',
  'ohmynews.com': '오마이뉴스',
  'busan.com': '부산일보',
  'kookje.co.kr': '국제신문',
  'imaeil.com': '매일신문',
  'kwnews.co.kr': '강원일보',
  'jejunews.com': '제주일보',
  'kyeongin.com': '경인일보',
  'joongdo.co.kr': '중도일보',
  'kado.net': '강원도민일보',
  'knnews.co.kr': '경남신문',
  'idomin.com': '경남도민일보',
  'ksilbo.co.kr': '경상일보',
  'jnilbo.com': '전남일보',
  'kjdaily.com': '광주매일신문',
  'jjan.kr': '전북일보',
  'dt.co.kr': '디지털타임스',
  'etnews.com': '전자신문',
  'zdnet.co.kr': '지디넷코리아',
};

/** Outlet display name from an article URL. */
export function outletName(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^(www|m|news|n)\./, '');
  } catch {
    return '';
  }
  for (const [domain, name] of Object.entries(OUTLETS)) if (host === domain || host.endsWith(`.${domain}`)) return name;
  return host;
}

/** Key for detecting the same story reported twice. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 40);
}
