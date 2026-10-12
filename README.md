# KBDV · 지역 뉴스 브리핑

세계 지도에서 국가 또는 지역을 터치하면, 그 지역의 최신 뉴스를 수집하고 LLM이 출처가 표시된 리포트를 작성합니다. 수집한 기사로 만든 차트도 함께 보여 줍니다. 터치 모니터에서 전체화면으로 시연하는 용도입니다.

- **지도:** MapLibre와 Natural Earth 행정구역 데이터를 씁니다.
  - 국가 251개, 1차 행정구역 3,017개를 지원합니다.
  - 축소하면 국가 단위로, 확대하면 지역 단위로 선택합니다.
- **뉴스:** Naver 검색 API와 Google News RSS를 사용합니다. Naver 키가 없으면 Google News만 사용합니다.
- **LLM:** OpenAI 호환 `/chat/completions` API에 `fetch`로 직접 요청합니다. SDK는 쓰지 않습니다.
- **캐시:** 브라우저 IndexedDB에 저장합니다. 관리자 설정에서 내보내기, 가져오기, 삭제, 미리 생성을 할 수 있습니다.

## 실행

```bash
pnpm install
cp .env.example .env.local   # 필요한 값만 수정
pnpm dev                     # http://localhost:5173
```

시연할 때는 빌드한 결과물을 쓰는 것을 권장합니다.

```bash
pnpm build && pnpm preview   # http://localhost:4173
```

키오스크 모드로 띄우려면 Chrome을 다음과 같이 실행합니다.

```bash
# macOS
open -na "Google Chrome" --args --kiosk --app=http://localhost:4173 --disable-pinch --overscroll-history-navigation=0
# Windows
chrome.exe --kiosk --app=http://localhost:4173 --disable-pinch --overscroll-history-navigation=0
```

Naver와 Google News는 CORS를 허용하지 않습니다. 그래서 `vite.config.ts`의 프록시(`/proxy/naver`, `/proxy/gnews`)를 거쳐 요청합니다. 프록시는 `dev`와 `preview`에서만 동작하므로, `dist`를 정적 파일로만 서빙하면 뉴스 검색이 되지 않습니다.

## 설정

설정은 아래 순서로 적용되며, 뒤에 있는 값이 앞의 값을 덮어씁니다.

1. 코드 기본값
2. `.env.local`의 `VITE_*` 값
3. 관리자 설정(브라우저 localStorage에 저장)

전체 목록은 [.env.example](.env.example)에 있습니다.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `VITE_LLM_BASE_URL` | `http://172.27.50.106:11434/v1` | OpenAI 호환 API의 `/v1` 경로까지 |
| `VITE_LLM_MODEL` | `granite4.2:8b` | |
| `VITE_LLM_REASONING_EFFORT` | `none` | 추론 모델의 생각 출력을 끕니다. 비워 두면 이 파라미터를 보내지 않습니다. |
| `VITE_LLM_CONTEXT_TOKENS` | `4096` | 서버의 컨텍스트 길이. 프롬프트를 이 길이에 맞게 줄입니다. |
| `VITE_NAVER_CLIENT_ID` / `_SECRET` | | [Naver Developers](https://developers.naver.com)의 검색 API 키 |
| `VITE_NEWS_PROVIDERS` | `naver,google` | |
| `VITE_NEWS_MAX` / `VITE_NEWS_DAYS` | `30` / `14` | 수집할 최대 기사 수와 검색 기간(일) |
| `VITE_AUTO_TOUR`, `VITE_IDLE_TOUR_SECONDS`, `VITE_TOUR_DWELL_SECONDS` | `false`, `90`, `25` | 자동 투어 |
| `VITE_HEATMAP` | `true` | |
| `VITE_UI_SCALE` | `1` | 전체 글자 크기 배율. 큰 모니터에서는 1.2~1.5를 권장합니다. |

### Ollama 서버 메모

- **CORS:** 브라우저가 LLM에 직접 요청합니다. Ollama는 기본적으로 `localhost` 출처만 허용합니다.
  - 시연 PC에서 `localhost`로 접속하면 별도 설정이 필요 없습니다.
  - 다른 주소로 접속한다면 서버에 `OLLAMA_ORIGINS`를 설정하세요.
- **컨텍스트 길이:** 기본값이 4096 토큰이고, 이보다 긴 요청은 거부됩니다.
  - 한국어는 대략 한 글자에 한 토큰이 듭니다. 그래서 앱이 기사 요약을 자르거나 오래된 기사를 빼서 이 한도에 맞춥니다.
  - 서버에 `OLLAMA_CONTEXT_LENGTH=16384` 정도를 설정하고 `VITE_LLM_CONTEXT_TOKENS`도 같은 값으로 맞추면 리포트 품질이 좋아집니다.
- **모델:** `granite4.2:8b`는 추론(thinking) 모델입니다. `reasoning_effort: none`을 보내야 빠르고 안정적으로 응답합니다.

## 화면 구성과 조작

- **지도**
  - 핀치로 확대·축소, 드래그로 이동합니다.
  - 탭하면 해당 국가나 지역이 선택됩니다. 작은 지역(광역시, 섬 등)은 근처를 눌러도 선택됩니다.
- **패널:** 세 단계(뉴스 검색 → 리포트 작성 → 기사 분석)의 진행 상황을 보여 줍니다.
  - 리포트는 스트리밍으로 바로 표시됩니다. 기사 분석이 끝나면 차트가 채워집니다.
  - 리포트 안의 `[n]` 표시를 누르면 기사 카드가 열립니다. 카드의 QR 코드로 휴대폰에서 원문을 열 수 있습니다.
  - 미리 정해 둔 질문 칩을 누르면, 수집한 기사만 근거로 답합니다(RAG).
- **상단 바:** 히트맵, 자동 투어, UI 언어, 리포트 언어(한/EN), 전체화면을 켜고 끕니다.
  - UI 언어와 리포트 언어는 따로 설정합니다. 리포트 기본 언어는 한국어입니다.
- **히트맵:** 이미 분석한 지역을 감성 지수(부정 ↔ 긍정)나 기사량으로 칠합니다.
- **자동 투어:** 입력이 없는 상태가 일정 시간 이어지면, 분석된 지역(3곳 미만이면 미리 정한 목록)을 돌아가며 보여 줍니다. 화면을 터치하면 즉시 멈춥니다.
- **관리자 설정:** 왼쪽 위 제목을 2초간 길게 누르거나 `Ctrl/⌘ + ,`를 누르면 열립니다.
  - LLM, 뉴스, 화면 설정을 바꿀 수 있고 LLM 연결을 테스트할 수 있습니다.
  - 캐시를 내보내거나 가져오고 삭제할 수 있습니다.
  - **미리 생성:** 한국 17개 시도와 주요 20개국의 리포트를 순서대로 만들어 둡니다. 시연 전에 실행해 두면 터치하자마자 결과가 나옵니다. 내보낸 JSON을 다른 PC에서 가져오면 오프라인으로도 시연할 수 있습니다.

## 지도 데이터 다시 만들기

```bash
pnpm map:build
```

`tools/mapbuild`가 Natural Earth 10m 데이터를 내려받아 `tools/mapbuild/.cache`에 저장합니다. 그 다음 아래 파일들을 만듭니다.

- `public/map/regions.geojson`
- `public/map/countries.geojson`
- `public/map/borders.geojson`
- `public/map/places.json`

이름과 검색어는 `tools/mapbuild/names.ts`에서 고칠 수 있습니다.

- 한국어 표기 보정 예: `강원특별자치도`
- 검색어 보정 예: `경상남도`를 `경남`으로
- 국가명 보정 예: `중화인민공화국`을 `중국`으로

## 구조

```
src/
  config.ts            설정(기본값 ← env ← 관리자 설정)
  places.ts            지명, 검색어, 확대 수준
  services/
    llm.ts             fetch 기반 chat, chatStream(SSE), chatJson(JSON schema)
    news/              naver.ts, googleRss.ts, index.ts(병합·중복 제거)
    prompts.ts         프롬프트, 토큰 예산에 맞춘 기사 목록
    pipeline.ts        검색 → 리포트(스트리밍) → 기사 분석
    qa.ts, cache.ts
  map/                 MapLibre 컨트롤러, 라벨 캔버스, 색상
  ui/                  패널, 차트, 인용 카드, 관리자 설정, 상단 바
  kiosk/               자동 투어, 미리 생성
tools/mapbuild/        Natural Earth → GeoJSON 변환
```
