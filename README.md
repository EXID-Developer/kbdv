# KBDV · 지역 뉴스 브리핑

세계 지도에서 국가나 지역을 고르거나, 보고 싶은 뉴스를 직접 입력하면 최신 뉴스를 모아 LLM이 출처가 표시된 리포트를 작성합니다. 백엔드 서버 한 대에 여러 컴퓨터가 브라우저로 동시에 접속해 쓰는 구성입니다.

- **백엔드(`backend/`):** Node.js 내장 기능만 쓰는 HTTP 서버입니다. 런타임 의존성이 없습니다.
  - 뉴스 수집(Naver 검색 API, Google News RSS), LLM 호출, 리포트 저장, 환율·증시 조회를 맡습니다.
  - 같은 리포트를 여러 화면이 동시에 요청하면 생성은 한 번만 하고, 진행 상황을 모든 화면에 함께 스트리밍합니다(SSE).
  - 리포트와 설정은 `backend/data/`에 JSON 파일로 저장되어 모든 화면이 공유합니다.
- **프론트엔드(`frontend/`):** React + MapLibre 화면입니다. 마우스·키보드 환경에 맞췄고 터치도 그대로 지원합니다.
- **공유 코드(`shared/`):** 두 쪽이 함께 쓰는 타입, 지명 처리, SSE 파서입니다.

## 실행

Node.js 22.18 이상(24 권장)과 pnpm이 필요합니다. 백엔드는 Node의 기본 TypeScript 실행 기능으로 빌드 없이 실행합니다.

```bash
pnpm install
cp backend/.env.example backend/.env   # 필요한 값만 수정
```

### 개발

```bash
pnpm dev        # 백엔드(:8787)와 Vite(:5173)를 함께 실행
```

`http://localhost:5173`으로 접속합니다. Vite가 `/api` 요청을 백엔드로 넘깁니다.

### 여러 컴퓨터에서 사용(운영)

```bash
pnpm build      # frontend/dist 생성
pnpm start      # 백엔드가 API와 빌드된 화면을 함께 서빙(:8787)
```

서버를 띄우면 다른 컴퓨터에서 접속할 주소(`http://<서버 IP>:8787`)가 콘솔에 표시됩니다. 각 컴퓨터는 브라우저로 그 주소에 접속하면 됩니다.

- 방화벽에서 8787 포트를 열어 두세요.
- 같은 네트워크의 누구나 접속할 수 있으므로 `backend/.env`에 `ADMIN_TOKEN`을 설정하는 것을 권장합니다. 설정하면 설정 변경, 캐시 삭제, 미리 생성에 토큰이 필요합니다(관리자 설정 화면에서 입력).
- LLM과 뉴스 API는 서버만 호출합니다. 브라우저 쪽 CORS 설정이나 API 키 배포가 필요 없습니다.

키오스크로 띄우려면:

```bash
open -na "Google Chrome" --args --kiosk --app=http://<서버 IP>:8787   # macOS
chrome.exe --kiosk --app=http://<서버 IP>:8787                         # Windows
```

## 설정

서버 설정(LLM, 뉴스, 리포트 갱신 주기)은 아래 순서로 적용되며, 뒤의 값이 앞의 값을 덮어씁니다. 관리자 설정에서 저장하면 연결된 모든 화면에 바로 반영됩니다.

1. 코드 기본값
2. `backend/.env`
3. 관리자 설정(`backend/data/settings.json`)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `ADMIN_TOKEN` | | 관리 기능 보호용 토큰 |
| `DATA_DIR` | `data` | 리포트·설정 저장 위치(`backend/` 기준) |
| `LLM_BASE_URL` | `http://172.27.50.106:11434/v1` | OpenAI 호환 API의 `/v1` 경로까지 |
| `LLM_MODEL` | `granite4.2:8b` | |
| `LLM_REASONING_EFFORT` | `none` | 비워 두면 이 파라미터를 보내지 않습니다 |
| `LLM_CONTEXT_TOKENS` | `4096` | 서버의 컨텍스트 길이. 프롬프트를 이 길이에 맞게 줄입니다 |
| `NAVER_CLIENT_ID` / `_SECRET` | | [Naver Developers](https://developers.naver.com) 검색 API 키 |
| `NEWS_PROVIDERS` | `naver,google` | |
| `NEWS_MAX` / `NEWS_DAYS` | `30` / `14` | 수집할 최대 기사 수와 검색 기간(일) |
| `REPORT_TTL_MINUTES` | `60` | 이보다 오래된 리포트는 열 때 새로 만듭니다. `0`이면 계속 재사용 |

화면 설정(히트맵, 자동 투어, UI·리포트 언어, 글자 크기)은 컴퓨터마다 따로 브라우저에 저장됩니다. 기본값은 `frontend/.env.example`의 `VITE_*` 값으로 바꿀 수 있습니다.

### Ollama 서버 메모

- **컨텍스트 길이:** 기본 4096 토큰입니다. 서버에 `OLLAMA_CONTEXT_LENGTH=16384` 정도를 설정하고 `LLM_CONTEXT_TOKENS`도 같은 값으로 맞추면 리포트 품질이 좋아집니다.
- **동시 요청:** 여러 화면이 동시에 다른 리포트를 요청하면 Ollama가 순서대로 처리합니다(`OLLAMA_NUM_PARALLEL`로 병렬 수 조절). 아무도 보지 않게 된 생성은 10초 뒤 자동으로 취소됩니다.
- **모델:** `granite4.2:8b`는 추론 모델이라 `reasoning_effort: none`을 보내야 빠르고 안정적입니다.

## 기능

- **종합 리포트:** 지도에서 국가·지역을 고르면 뉴스 검색 → 리포트 작성(스트리밍) → 이슈 추출 → 기사 분석 순서로 진행합니다. 리포트의 `[n]`을 누르면 기사 카드가 열리고, QR 코드나 링크로 원문을 볼 수 있습니다.
- **프롬프트 뉴스:** 상단 검색창에 보고 싶은 뉴스를 문장으로 입력하면(예: "일본 반도체 수출 규제 동향") LLM이 검색어를 뽑아 뉴스를 모으고, 그 요청에 답하는 리포트를 만듭니다. 같은 문장의 리포트는 모든 화면이 공유합니다.
- **실시간 이슈 필터:** 고정 질문 대신, 수집한 기사에서 지금 화제가 되는 이슈(3~6개)를 뽑아 칩으로 보여 줍니다. 칩에는 관련 기사 수가 표시되고, 6시간 안에 나온 기사가 있으면 `NEW`가 붙습니다. 누르면 그 이슈의 요약과 관련 기사만 보여 줍니다. 리포트가 갱신 주기를 넘기면 새로 만들어지므로 이슈도 함께 바뀝니다.
- **직접 질문:** 수집한 기사만 근거로 자유롭게 질문할 수 있습니다.
- **환율·증시:** 국가(지역은 소속 국가)의 통화, 원화·달러 환율, 1개월 환율 추이, 대표 주가지수(현재가, 등락률, 1개월 추이)를 보여 줍니다. 패널이 열려 있는 동안 2분마다 갱신합니다.
  - 환율: [ExchangeRate-API](https://www.exchangerate-api.com) 무료 엔드포인트(하루 1회 갱신)
  - 지수·추이: Yahoo Finance 차트 API(비공식, 지연 시세)
- **히트맵:** 분석된 지역을 감성 지수나 기사량으로 칠합니다. 다른 화면에서 만든 리포트도 실시간으로 반영됩니다.
- **자동 투어, 미리 생성:** 기존과 같습니다. 미리 생성은 서버에서 돌기 때문에 한 번 실행하면 모든 화면이 결과를 씁니다.

## 조작

| 입력 | 동작 |
|---|---|
| `/` 또는 `Ctrl/⌘ + K` | 검색창으로 이동 |
| 검색창에서 `↑` `↓`, `Enter` | 지역 후보 또는 "뉴스 리포트 만들기" 선택 |
| `Esc` | 입력창 비우기 → 대화상자 닫기 → 패널 닫기 순서 |
| `Ctrl/⌘ + ,` 또는 ⚙ 버튼 | 관리자 설정 |
| `Tab` | 모든 버튼·칩·입력창을 키보드로 이동(포커스 표시 있음) |
| 지도 | 휠로 확대·축소, 드래그로 이동, 클릭으로 선택. 지도에 포커스가 있으면 방향키·`+`/`-`도 동작 |

마우스 환경에서는 버튼 크기를 줄이고, 호버 표시와 리포트 텍스트 선택·복사, 브라우저 확대를 허용합니다. 터치 화면에서는 기존처럼 큰 버튼과 선택 방지가 적용됩니다.

## 테스트

```bash
pnpm test        # 백엔드 단위 테스트(파서, 설정 검증, 이슈 정리, 생성 공유)
pnpm typecheck
pnpm lint
```

## 지도 데이터 다시 만들기

```bash
pnpm map:build
```

`tools/mapbuild`가 Natural Earth 10m 데이터를 내려받아 `frontend/public/map/`에 `regions.geojson`, `countries.geojson`, `borders.geojson`, `places.json`을 만듭니다. 이름과 검색어 보정은 `tools/mapbuild/names.ts`에서 합니다.

## 구조

```
backend/src/
  server.ts       HTTP 라우팅, SSE, 정적 파일(gzip)
  config.ts       서버 설정(기본값 ← .env ← 관리자 설정)과 검증
  jobs.ts         리포트 생성 공유(여러 화면 → 생성 1회), 버려진 생성 취소
  pipeline.ts     검색 → 리포트 → 이슈 추출 → 기사 분석
  prompts.ts      프롬프트, 토큰 예산에 맞춘 기사 목록
  qa.ts           이슈 요약·질문 답변
  store.ts        리포트 저장(메모리 + 파일), 가져오기 검증
  market.ts       통화·환율·주가지수
  prewarm.ts      미리 생성
  news/           naver.ts, googleRss.ts, index.ts(병합·중복 제거)
frontend/src/
  api.ts          서버 API, 스트림 읽기
  map/            MapLibre 컨트롤러, 라벨, 색상
  ui/             패널, 검색창, 시장 정보, 차트, 관리자 설정
  kiosk/          자동 투어
shared/           타입, 지명 처리, 큐레이션 목록, SSE 파서
tools/mapbuild/   Natural Earth → GeoJSON 변환
```

## API

| 메서드·경로 | 설명 |
|---|---|
| `GET /api/report?scope=country\|region&code=…&lang=ko\|en[&force=1]` | 리포트 스트림(SSE) |
| `GET /api/report?scope=topic&prompt=…&lang=…` | 프롬프트 뉴스 리포트 스트림 |
| `POST /api/qa` `{key, issue}` 또는 `{key, question}` | 이슈 요약·질문 답변 스트림 |
| `GET /api/market/:cc` | 통화·환율·지수(ISO 3166 alpha-3) |
| `GET /api/events` | 히트맵 요약, 미리 생성 진행, 설정 변경 알림(SSE) |
| `GET/PUT/DELETE /api/settings` | 서버 설정(변경은 관리자) |
| `/api/admin/*` | LLM 테스트, 내보내기·가져오기·삭제, 미리 생성(관리자) |
