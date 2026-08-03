# CLAUDE.md

윈도우용 스티커 메모 앱. **모든 세션은 작업 시작 전에 이 파일 + `plan.md` + `process.md`를 읽는다.**

- `plan.md` — 무엇을 만드는가 (아키텍처, 데이터 모델, 마일스톤)
- `process.md` — 어떻게 진행하는가 (실행 모델, 트랙 소유권, 완료 기준, 인계 절차)
- `design/StickyNote App.dc.html` — **디자인 원본 버전 2 (2026-08-03). 색·폰트·치수의 최종 근거.** 절대 수정하지 않는다.
  `design/Sticky Notes for Windows.dc.html`(버전 1)은 버전 2가 다시 그리지 않은 레이아웃 근거로만 남는다 — 색·폰트가 다르면 **버전 2가 옳다.** 자세한 관계는 `design/README.md` 참조

## 이 세션의 역할

**최상위 세션은 리더(오케스트레이터)다. 직접 구현하지 않는다.**

```
구현 에이전트 스폰  →  검증 에이전트 스폰  →  FAIL 시 수정 에이전트  →  PASS 시 다음 단계
```

개발이 완료될 때까지 이 루프를 자율적으로 돈다. 상세는 **`process.md`의 "실행 모델" 절**이며, 거기에 구현/검증/수정 에이전트의 프롬프트 템플릿이 있다.

세 가지만 여기서 못박아 둔다:

1. **검증은 구현한 에이전트가 하지 않는다.** 자기 작업을 자기가 채점하면 통과한다
2. **에이전트의 "완료했습니다"를 믿지 않는다.** 검증 에이전트의 항목별 PASS/FAIL만 신뢰한다
3. **같은 항목이 수정 3회 후에도 FAIL이면 멈추고 사용자에게 묻는다.** 접근 자체가 틀렸을 가능성이 크다

**서브에이전트로 스폰된 세션은** 위 내용이 아니라 자기 프롬프트에 지정된 트랙 범위만 수행한다. 다시 에이전트를 스폰하지 않는다.

---

## 무엇을 만드는가

다른 앱 위에 떠 있는 프레임리스 스티커 메모. 핵심 3가지:

1. **항상 위(always-on-top)**
2. **투명도 조절** — 메모별 35~100%, 슬라이더 + `Ctrl+Shift+휠`, 포커스 잃으면 부드럽게 흐려짐
3. **마크다운 라이브 프리뷰** — 체크박스·코드블록·`[[위키링크]]`·`#태그`가 편집 중에도 렌더된 상태

---

## 기술 스택 (확정 — 재논의 대상 아님)

| 항목 | 결정 | 근거 |
|---|---|---|
| 프레임워크 | **Tauri v2** | 상주형 트레이 앱이라 메모리가 1순위. Electron 대비 ~40% (메모 8개 기준 200~300MB vs 600MB~1GB), 설치본 ~10MB vs ~90MB |
| 프론트엔드 | **React 19 + TypeScript + Vite** | CodeMirror 6 커스텀 확장 사례가 가장 많고, 보드 창의 검색/필터/그리드 상태 관리가 편함 |
| 에디터 | **CodeMirror 6 라이브 프리뷰** | 마크다운 텍스트가 그대로 모델이라 원문 훼손 위험 없음 |
| 저장소 | **SQLite (rusqlite, `bundled` feature)** | 시스템 의존성 없음 |
| 진실의 원천 | **SQLite** | 본문은 마크다운 문자열 그대로 저장 |

**검증된 로컬 환경**: Node 24.18 / npm 11.16, Rust 1.97 + VS Build Tools, WebView2 150. .NET SDK 없음.

---

## 절대 규칙

### 1. M0 동결 파일 — 무단 수정 금지

아래 4개는 **트랙 간 계약**이다. 병렬 세션이 서로를 깨뜨리지 않는 유일한 근거이므로, 자기 트랙 작업 중에 임의로 고치지 않는다.

```
src-tauri/src/lib.rs      — 모듈 선언 + invoke_handler 커맨드 등록
src/lib/ipc.ts            — 커맨드 TypeScript 타입 + invoke 래퍼
src-tauri/tauri.conf.json — 3종 창 설정
src/styles/tokens.css     — 디자인 토큰
```

고쳐야 한다면 **작업을 멈추고 보고한다.** 에이전트는 리더에게, 리더는 사용자에게. 절대 자기 브랜치에서 몰래 고치고 진행하지 않는다 — 병합 시점에 다른 트랙이 전부 깨진다. 절차는 `process.md`의 "계약을 바꿔야 할 때".

검증 에이전트는 이 4개 파일이 diff에 들어갔으면 **무조건 FAIL**을 낸다.

### 2. 에셋은 전부 로컬 번들 — CDN 금지

디자인 원본은 `fonts.googleapis.com`을 참조하지만 **그대로 옮기지 않는다.** 데스크톱 앱은 오프라인에서 동작해야 하고 Tauri CSP가 외부 요청을 막는다.

```
@fontsource/ibm-plex-sans-kr   400 · 500 · 600 · 700
@fontsource/ibm-plex-mono      400 · 500 · 600 · italic 400
```

(2026-08-03 디자인 v2로 `@fontsource/noto-sans-kr` / `@fontsource/jetbrains-mono`에서 교체됨. 같은 CDN 금지 원칙이 적용된다.)

### 3. 마크다운 원문이 에디터 모델

CodeMirror의 문서는 **사용자가 친 마크다운 그대로**다. 라이브 프리뷰는 `Decoration`으로 겉모습만 바꾸는 것이지 텍스트를 치환하는 게 아니다. 이 원칙이 깨지면 나중에 마크다운 내보내기/옵시디언 연동이 전부 무너진다.

### 4. CodeMirror 위젯에서 DOM 직접 변형 금지

체크박스 클릭 같은 상호작용은 **반드시 트랜잭션을 dispatch**해서 문서 텍스트(`[ ]` ↔ `[x]`)를 바꾼다. `widget.dom.checked = true` 같은 직접 조작은 CodeMirror의 상태와 어긋나 다음 리렌더에 되돌아간다.

```ts
// 올바름
view.dispatch({ changes: { from, to, insert: checked ? '[ ]' : '[x]' } })

// 틀림
e.target.checked = !e.target.checked
```

### 5. 옵시디언 동기화는 v1 범위 밖

파일 감시(`notify`), YAML 프론트매터, 충돌 처리, `conflict-{ts}.md` — **전부 구현하지 않는다.** 디자인에 그려진 동기화 UI는 저장 상태 표시로 재해석됐다(`plan.md`의 "디자인 대비 변경점" 표 참조).

나중에 붙일 다리는 설정 창의 **"마크다운으로 내보내기"** 하나뿐이다. 이걸 위해 본문을 마크다운 원문으로 저장하는 것이므로 규칙 3과 연결된다.

### 6. UI 문자열은 한국어

디자인의 문구를 그대로 쓴다. 임의로 영어로 바꾸거나 의역하지 않는다. `OPACITY`, `DISPLAY`, `DATA`, `STATES` 같은 모노스페이스 섹션 레이블만 영문 대문자 그대로.

---

## 디자인 토큰

`src/styles/tokens.css` / `src/lib/palette.ts`에 정의. 하드코딩된 색을 컴포넌트에 쓰지 않는다.

**2026-08-03 디자인 v2로 색 체계가 hex → `oklch()`로 바뀌었다.** WebView2 150(Chromium 118+)이
`oklch()`를 네이티브 지원하므로 hex 환산 없이 디자인 값을 그대로 옮긴다.

### 메모 팔레트 (종이 / 크롬) — 5색 → 6색

크롬(컨트롤 바 배경)은 같은 hue를 유지하면서 `L' = min(L + 0.035, 0.99)`, `C' = C × 0.6`,
알파 0.85를 얹는 파생 공식이다 — 디자인의 유일한 실측 예시(노랑)와 정확히 일치한다.

| 인덱스 | 이름 | 종이 | 크롬 |
|---|---|---|---|
| 0 | yellow | `oklch(0.935 0.075 95)` | `oklch(0.97 0.045 95 / 0.85)` |
| 1 | lime | `oklch(0.93 0.06 130)` | `oklch(0.965 0.036 130 / 0.85)` |
| 2 | mint | `oklch(0.93 0.05 195)` | `oklch(0.965 0.03 195 / 0.85)` |
| 3 | blue | `oklch(0.925 0.05 265)` | `oklch(0.96 0.03 265 / 0.85)` |
| 4 | lavender | `oklch(0.925 0.05 320)` | `oklch(0.96 0.03 320 / 0.85)` |
| 5 | white | `oklch(0.965 0.004 90)` | `oklch(0.99 0.002 90 / 0.85)` |

DB의 `notes.color`는 이 순서의 인덱스 **0~5** (기존 0~4에서 확장). 기존 데이터의 재매핑은
`src-tauri/src/db.rs`의 `m003_repalette` 마이그레이션이 처리한다:

```
구 0 yellow → 신 0 yellow    (이름 동일 — 항등)
구 1 pink   → 신 4 lavender  (hue 거리 최소)
구 2 blue   → 신 2 mint      (hue 거리 최소)
구 3 green  → 신 1 lime      (hue 거리 최소, yellow는 이미 항등 매핑이 차지)
구 4 purple → 신 3 blue      (hue 거리 최소)
```

색상칩은 더 이상 각진 5px 라운드가 아니라 **완전한 원형**(`border-radius: 50%`)이다.

### 색

```
잉크          oklch(0.27 0.012 60)     본문 텍스트   oklch(0.36 0.012 70)
흐린 잉크     ink 에 알파 0.45          ← 완료된 할 일
완료 녹색     oklch(0.45 0.09 150)     저장 대기 노랑  oklch(0.7 0.13 89)
닫기 빨강     oklch(0.5 0.13 25)       위키링크      oklch(0.5 0.14 291) on 같은 색 알파 0.1
악센트        oklch(0.52 0.09 235)     (설정에서 채도를 완화한 purple/green/orange 3개 중 선택 —
                                        저장되는 식별자 자체는 여전히 hex, `src/lib/palette.ts` 참조)

코드블록 (design v2가 직접 준 값 — 배경/본문/키워드/함수/타입/주석)
  배경 oklch(0.27 0.014 250)   본문 oklch(0.89 0.01 250)
  키워드 oklch(0.74 0.11 320)   함수 oklch(0.79 0.11 200)   타입 oklch(0.81 0.1 140)
  주석 oklch(0.62 0.02 250)
  (string/number/operator/variable 4개는 v2에 예시가 없어 v1 hex 확장값을 그대로 유지 —
   자세한 판단 근거는 tokens.css 코드블록 블록 주석 참조)

⚠ 다크 크롬 (보드 · 설정 · 트레이 메뉴) — 미반영, 확인 필요
  design v2는 이 세 창을 전부 밝은 배경(oklch(0.985 0.003 90) 근방)으로 그렸고,
  디자인 문서 자체가 "코드블록만 다크 서피스"라고 명시한다. 즉 v1의 다크 테마
  (배경 rgba(32,30,28,.86) 등, 아래 값)가 v2에서 라이트로 바뀌었을 가능성이 있다 —
  tokens.css는 이 절을 **바꾸지 않고 그대로 뒀다.** 컴포넌트 리스킨(2단계) 전에
  리더/사용자가 판단해야 한다.
  배경 rgba(32,30,28,.86)   테두리 rgba(255,255,255,.10)
  텍스트 #eae5de / #cfc8bf / #8a8278
```

### 치수

```
라운드   메모 3px · 관리창/설정창 4px · 코드블록 4px · 트레이 6px · 팝오버 5px
         버튼/필드 4px · 체크박스 3px · 색상칩 완전 원형 · 토글/배지 20px
컨트롤 바 높이 32px      관리창·설정창 타이틀바 38px      타이틀바 버튼 44px
본문 14px/1.5   메모 제목 17px/700   보드 리스트 사이드바 208px · 검색창 28px
모노 레이블 letter-spacing .12em, 9.5px, uppercase
설정 창 토글 34×19, 노브 15px
```

**2026-08-03 이전(v1) 값과 비교해 크게 달라졌다** — 자세한 실측 근거(디자인 파일의 어느
줄에서 가져왔는지)는 `src/styles/tokens.css`의 각 블록 주석 참조. 보드 창(1040×620
목업 vs 실제 1040×640) · 설정 창(560×700 목업 vs 실제 620×640)은 목업과 `tauri.conf.json`
실측이 어긋나 있어 **의도적으로 반영하지 않았다** — 계약 변경 필요.

---

## 프로젝트 구조

```
sticky-notes/
├─ design/                          # 디자인 원본 (읽기 전용)
├─ src/
│  ├─ main.tsx                      # ?w= 쿼리로 창 분기하는 단일 엔트리
│  ├─ windows/                      # NoteWindow · BoardWindow · SettingsWindow
│  ├─ components/                   # ControlBar · ColorPalette · SaveFooter · TitleBar · Toggle
│  ├─ editor/                       # CodeMirror 6 확장 (최대 작업량)
│  ├─ lib/                          # ipc · markdown · palette · time
│  ├─ assets/fonts/
│  └─ styles/tokens.css
└─ src-tauri/src/
   ├─ lib.rs      db.rs      notes.rs
   ├─ windows.rs  win.rs     tray.rs
   ├─ shortcuts.rs           export.rs
   ├─ attachments.rs         update.rs
```

세 창 모두 같은 SPA 번들을 로드하고 `?w=note&id=…` / `?w=board` / `?w=settings`로 분기한다. WebView2가 번들을 캐싱하므로 창마다 재다운로드하지 않는다.

---

## 명령

```bash
npm run dev            # Vite만 — 에디터(트랙 B) 개발은 이걸로 충분
npm run tauri dev      # 전체 앱
npm run build          # 프론트 타입체크 + 번들
npm run tauri build    # NSIS 인스톨러
npm test               # vitest (src/lib)
cargo test             # src-tauri에서 실행 — DB 레이어
cargo clippy           # src-tauri
```

---

## 커밋 규약

```
<track>: <무엇을 했는가>

예)
editor: 체크박스 위젯 데코레이션 추가
backend: note_geometry 저장·복원 구현
note-window: 유휴 상태 컨트롤 바 페이드
board: 색상 필터 칩
m0: 계약 스텁 + 디자인 토큰
```

- 자기 트랙 브랜치에만 커밋한다 (`process.md` 참조)
- M0 동결 파일이 diff에 들어갔으면 커밋하지 말고 멈춘다

### 커밋 · 푸시 시점

**기능 하나가 완료될 때마다 커밋 + 푸시까지 끝낸다.** 마일스톤을 몰아서 한 번에 올리지 않는다.

| 주체 | 시점 | 동작 |
|---|---|---|
| 구현 에이전트 | 기능 단위 완료 | 자기 트랙 브랜치에 **커밋** (푸시는 하지 않는다 — 검증 전 코드다) |
| 리더 | 검증 **PASS** 직후 | 트랙 브랜치 푸시 → `main` 병합 → `main` 푸시 → 진행 표 갱신 |

검증 FAIL 상태의 코드는 푸시하지 않는다. 수정 후 PASS가 나면 그때 올린다.

---

## 흔한 함정

| 증상 | 원인 / 대응 |
|---|---|
| 메모 창 라운드 코너에 검은 테두리 | `DWMWA_WINDOW_CORNER_PREFERENCE = DONOTROUND` 적용 필요. 코너는 CSS `border-radius`로 그린다 |
| CSS `drop-shadow`가 잘림 | 창 크기 = 종이 + 사방 24px 투명 여백. 여백을 줄이면 그림자가 잘린다 |
| 투명도를 올려도 안 변함 | CSS `opacity`는 종이 루트 엘리먼트에 건다. 창 자체가 아니다 |
| 전역 단축키가 조용히 안 먹음 | `Ctrl+Alt+N`은 타 앱과 흔히 충돌. 등록 실패를 **반드시 사용자에게 노출**하고 재바인딩을 제공 |
| 보드 창 리사이즈 시 검은 플래시 | mica → acrylic → 불투명 순으로 폴백 |
| 한국어 검색이 부분 일치 안 됨 | FTS5 `unicode61`은 어절 내부를 못 쪼갠다. **`LIKE '%q%'`를 쓴다** (수천 개 규모까지 충분) |
| 메모 창 10개에 메모리 폭증 | 닫은 창은 hide가 아니라 destroy. 보드/설정도 닫으면 destroy |
| 메모를 전부 닫으면 앱이 통째로 죽는다 | tao는 마지막 창이 destroy되면 `ExitRequested { code: None }`을 올리고 기본 동작으로 종료한다. `lib.rs`의 `run` 콜백에서 **`code.is_none()`이면 `prevent_exit()`**. 트레이 `종료`만 `code: Some(0)`으로 통과한다 |
| 창을 만드는 커맨드에서 앱이 멈춘다 | Tauri는 `async`가 아닌 커맨드를 **메인 스레드에서** 실행한다 → 웹뷰 IPC 콜백 안에서 WebView2를 만드는 재진입이 된다. 창을 만들거나 없애는 커맨드는 **`#[tauri::command(async)]`** |
| 보드가 갱신되지 않는다 | 메모 집합을 바꾸는 커맨드는 반드시 `windows::emit_notes_changed()`로 끝낸다. 보드는 `sticky://notes-changed`와 창 포커스 두 경로로 재조회한다 |
