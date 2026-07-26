# 구현 플랜

> 규약은 `CLAUDE.md`, 진행 절차·트랙 소유권은 `process.md`. 이 문서는 **무엇을 만드는가**만 다룬다.

## Context

윈도우용 스티커 메모 데스크톱 앱. 핵심 요구사항 3가지:

1. **항상 위(always-on-top)** — 다른 앱 위에 떠 있는 프레임리스 메모 창
2. **투명도 조절** — 메모별 35~100%, 슬라이더 + `Ctrl+Shift+휠`, 포커스 잃으면 부드럽게 흐려짐
3. **마크다운 라이브 프리뷰** — 체크박스·코드블록·`[[위키링크]]`·`#태그`가 편집 중에도 렌더된 상태

디자인은 `design/Sticky Notes for Windows.dc.html`에 완성되어 있다 — 데스크톱 목업(떠 있는 메모 4개 + 활성 메모), 보드 창, 설정 창, 상태 3종(유휴·충돌·트레이 메뉴). **이 플랜의 목표는 그 디자인을 그대로 구현하는 것이다.**

**옵시디언 연동은 v1 범위에서 제외한다.** 데이터는 SQLite에 넣고 본문은 마크다운 텍스트 그대로 저장한다. 나중에 `.md` 동기화 레이어만 얹으면 되도록 설계하고, v1에는 그 다리로 "마크다운으로 내보내기"만 넣는다.

## 디자인 대비 변경점 (동기화 제거로 인한 재해석)

디자인의 동기화 관련 요소는 **레이아웃을 그대로 두고 의미만 바꾼다.**

| 디자인 요소 | v1에서의 의미 |
|---|---|
| 푸터 `● Vault / 05 메모 / 스프린트24.md · 저장됨 12:04` | `● 제목 · 저장됨 12:04` — 상태 점: 저장됨 `#3a8a4f` / 저장 중 `#c9a227` |
| 보드 `● Vault 동기화 · 방금 전` | `메모 N개 · 마지막 수정 방금 전` |
| 카드 메타 `동기화됨` / `로컬 전용` / `동기화 대기` | 상대 수정 시각 (`2시간 전`, `어제`, `지난주`) |
| 트레이 `지금 볼트와 동기화` | `모든 메모 저장` |
| 설정 `OBSIDIAN` 섹션 | `DATA` 섹션 — DB 경로/폴더 열기, 백업, **마크다운으로 내보내기**, 파일명 날짜 프리픽스 토글 |
| 충돌 배너 `볼트 버전이 더 최신` | **v1 제외.** 외부 편집자가 없으므로 발생하지 않는다. 컴포넌트를 만들지 않는다 |

---

## 아키텍처

### 창 구성

각 창은 같은 SPA 번들을 로드하고 `?w=` 쿼리로 분기한다.

| label | url | 설정 |
|---|---|---|
| `note-<id>` | `?w=note&id=<id>` | `decorations:false`, `transparent:true`, `alwaysOnTop:true`, `skipTaskbar:true`, `shadow:false`, `resizable:true` |
| `board` | `?w=board` | `decorations:false`, `transparent:false`, mica 적용, 작업표시줄에 표시 |
| `settings` | `?w=settings` | `board`와 동일, 싱글턴, 620px 고정폭 |

**메모 창 지오메트리**: 창 크기 = 종이 크기 + **사방 24px 투명 여백**. 디자인의 `drop-shadow(0 26px 44px rgba(0,0,0,.45))`를 CSS로 그리기 위한 공간이며, 동시에 네이티브 리사이즈 그랩 존 역할을 한다.

- 드래그: 컨트롤 바 / 종이 배경 mousedown → `appWindow.startDragging()`
- 리사이즈: 창 가장자리(투명 여백)에서 네이티브 리사이즈 + 우하단 그립 → `startResizeDragging('SouthEast')`

**창 수명**: `✕` = 창 destroy + `notes.open=0`. 메모 자체는 DB에 남아 보드에 계속 보인다. 삭제는 보드 우클릭 → soft delete. 보드/설정 창도 닫으면 destroy(hide 아님 — 메모리 목적).

### 투명도 — CSS 우선, 네이티브는 폴백

디자인은 `opacity:{{ opacity }}`를 메모 래퍼 전체에 건다. 즉 **투명 창 안에서 종이 루트 엘리먼트에 CSS `opacity`를 거는 것으로 충분**하다. Win32 호출 없이 되고 트랜지션도 공짜로 얻는다("부드럽게 감소").

```
autoFade OFF → 항상 note.opacity
autoFade ON  → 포커스 시 100%, 블러 시 note.opacity (transition 180ms ease-out)
```

M0 스파이크에서 아티팩트가 나오면 `src-tauri/src/win.rs`에 네이티브 폴백을 추가한다:

```rust
// 폴백 경로 — 스파이크 결과에 따라서만 구현
#[tauri::command]
fn set_window_opacity(window: tauri::Window, alpha: f64) -> Result<(), String>
// GetWindowLongPtrW(GWL_EXSTYLE) | WS_EX_LAYERED
// → SetLayeredWindowAttributes(hwnd, COLORREF(0), (alpha*255) as u8, LWA_ALPHA)
```

### 유휴 상태 구현

디자인의 "유휴 — 컨트롤 숨김, 종이만 남음"을 **레이아웃 시프트 없이** 만든다. 컨트롤 바의 38px 높이는 항상 유지하고, 포인터가 창 밖일 때:

1. 바 배경을 `chromeBg` → `paperBg`로 전환
2. 자식 요소를 `opacity: 0`
3. 하단 보더를 투명으로

---

## 데이터 모델

`%APPDATA%\com.sticky-notes.app\sticky-notes.db`

```sql
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,            -- uuid v7
  title       TEXT NOT NULL DEFAULT '',    -- body에서 파생, 보드용 비정규화
  body        TEXT NOT NULL DEFAULT '',    -- 원본 마크다운
  color       INTEGER NOT NULL DEFAULT 0,  -- 0..4 팔레트 인덱스
  opacity     INTEGER NOT NULL DEFAULT 96, -- 35..100
  pinned      INTEGER NOT NULL DEFAULT 1,  -- always-on-top
  open        INTEGER NOT NULL DEFAULT 1,  -- 데스크톱에 창이 떠 있는가
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE note_geometry (        -- DPI 상대 좌표
  note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  monitor TEXT NOT NULL,            -- Monitor.name (디바이스명)
  x REAL, y REAL,                   -- 해당 모니터 work-area 원점 기준 논리 px
  w REAL, h REAL,                   -- 논리 px
  scale REAL NOT NULL               -- 저장 시점 scale_factor
);

CREATE TABLE tags  (note_id TEXT, tag    TEXT, PRIMARY KEY(note_id, tag));
CREATE TABLE links (note_id TEXT, target TEXT, PRIMARY KEY(note_id, target)); -- [[위키링크]]
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
```

**검색은 FTS5 대신 `LIKE`.** FTS5의 `unicode61` 토크나이저는 한국어 어절 내부 부분 일치를 못 한다(`스프린트24`로 `프린트` 검색 실패). 메모 수백~수천 개 규모에서 `LIKE '%q%'` 스캔은 체감 즉시다. 규모가 커지면 그때 FTS5 + trigram으로 교체한다.

디자인 검색창의 `검색 · 태그 · [[백링크]]`는 접두사로 모드를 나눈다:

| 입력 | 동작 |
|---|---|
| `#태그` | `tags` 조인 |
| `[[제목]]` | `links` 조인 (백링크) |
| 그 외 | `title`/`body` LIKE |

**마이그레이션**: `PRAGMA user_version` + 순서 있는 마이그레이션 함수 배열. `Mutex<Connection>`을 `tauri::State`로 관리.

### DPI 상대 좌표

Tauri `Monitor`는 전체 화면 경계만 주고 작업표시줄을 제외한 work area를 주지 않는다. `win.rs`에 커맨드를 추가한다:

```rust
#[tauri::command]
fn get_work_areas() -> Vec<WorkArea>  // EnumDisplayMonitors + GetMonitorInfoW(.rcWork)
```

- **저장** (`tauri://move` / `tauri://resize`, 300ms 디바운스): `outerPosition()`(물리) → 포함 모니터 탐색 → `(물리좌표 − 모니터 work 원점) / scale_factor`를 논리 오프셋으로 저장 + 모니터 디바이스명
- **복원**: 이름으로 모니터 탐색 → 없으면 주 모니터 폴백 → `work원점 + 오프셋 × 현재 scale_factor` → **컨트롤 바 최소 80px이 화면 안에 남도록 클램프**

---

## 파일 구조

```
sticky-notes/
├─ design/
│  └─ Sticky Notes for Windows.dc.html    # 참조용 (읽기 전용)
├─ src/
│  ├─ main.tsx                            # ?w= 로 분기하는 단일 엔트리
│  ├─ windows/
│  │  ├─ NoteWindow.tsx                   # 종이 + 컨트롤 바 + 푸터
│  │  ├─ BoardWindow.tsx                  # 타이틀바 + 검색 + 색상 필터 + 카드 그리드
│  │  └─ SettingsWindow.tsx               # DISPLAY / DATA / SHORTCUTS
│  ├─ components/
│  │  ├─ ControlBar.tsx                   # 핀 · 투명도 슬라이더 · 색상 팝오버 · + · ✕
│  │  ├─ ColorPalette.tsx
│  │  ├─ SaveFooter.tsx
│  │  ├─ NoteEditor.tsx                   # M0 스텁 → 트랙 B가 CodeMirror로 교체
│  │  ├─ TitleBar.tsx                     # 보드/설정 공용 (— ▢ ✕, 44px)
│  │  └─ Toggle.tsx                       # 디자인의 40×22 스위치
│  ├─ editor/                             # ← 최대 작업량 (~500-700줄)
│  │  ├─ index.ts                         # createEditor(): 확장 조립
│  │  ├─ taskList.ts                      # [ ]/[x] → 체크박스 위젯 + 완료 시 취소선
│  │  ├─ wikilinkTag.ts                   # [[링크]] · #태그 + 커서 벗어나면 마커 숨김
│  │  ├─ inlineMarkers.ts                 # **굵게** · `코드` · # 제목 마커 토글
│  │  ├─ images.ts                        # 붙여넣기 → 첨부 저장 → 인라인 위젯
│  │  └─ theme.ts                         # 종이색 위 투명 배경, 거터 없음
│  ├─ lib/
│  │  ├─ ipc.ts                           # invoke 래퍼 (타입 지정)
│  │  ├─ markdown.ts                      # 제목 파생, #태그·[[링크]] 추출
│  │  ├─ palette.ts                       # 디자인 토큰
│  │  └─ time.ts                          # "2시간 전" 상대 시각
│  ├─ assets/fonts/                       # Noto Sans KR, JetBrains Mono (로컬 번들)
│  └─ styles/tokens.css
├─ src-tauri/
│  ├─ src/
│  │  ├─ lib.rs                           # 빌더, 플러그인, 커맨드 등록
│  │  ├─ db.rs                            # 스키마 + 마이그레이션 + 쿼리
│  │  ├─ notes.rs                         # note CRUD 커맨드
│  │  ├─ windows.rs                       # 메모 창 생성/포커스/파괴, 지오메트리
│  │  ├─ win.rs                           # get_work_areas, mica, (폴백) set_window_opacity
│  │  ├─ tray.rs
│  │  ├─ shortcuts.rs
│  │  └─ export.rs                        # 마크다운 내보내기 + DB 백업
│  ├─ Cargo.toml
│  └─ tauri.conf.json
└─ package.json
```

### 주요 의존성

**Rust** — `tauri` 2, `tauri-plugin-global-shortcut`, `tauri-plugin-dialog`, `tauri-plugin-opener`, `tauri-plugin-single-instance`, `tauri-plugin-autostart`, `rusqlite`(bundled), `uuid`(v7), `chrono`, `serde`, `window-vibrancy`, `windows`(Win32_UI_WindowsAndMessaging, Win32_Graphics_Dwm)

**JS** — `react` 19, `@codemirror/{state,view,commands,language,lang-markdown,language-data}`, `@lezer/markdown`, `@tauri-apps/api`, `@fontsource/noto-sans-kr`, `@fontsource/jetbrains-mono`

---

## 마일스톤

### M0 — 스캐폴드 + 계약 확정 + 리스크 스파이크 (단독 선행)

`git init` → `npm create tauri-app` (React + TS) → 디자인 HTML을 `design/`에 저장 → 폰트 로컬 번들 + `tokens.css`.

**M0에서 "계약"을 전부 확정한다.** 이후 트랙들이 서로를 기다리지 않고 병렬 진행하기 위한 전제다:

- `src-tauri/src/lib.rs` — 모든 모듈 선언 + `invoke_handler`에 전체 커맨드 등록 (본체는 `todo!()` 스텁)
- `src/lib/ipc.ts` — 모든 커맨드의 TypeScript 타입 + invoke 래퍼
- `src/styles/tokens.css`, `src/lib/palette.ts` — 디자인 토큰 전량
- `src-tauri/tauri.conf.json` — 3종 창 설정
- `src/components/NoteEditor.tsx` — `{ value, onChange }` 시그니처만 잡고 내부는 textarea 스텁

**리스크 스파이크 — 여기서 막히면 이후 전부 흔들린다:**

1. 투명 + 프레임리스 + always-on-top 창에서 CSS `opacity: 0.35`가 다른 앱 위에서 아티팩트 없이 보이는가
2. CSS `border-radius: 10px` 코너에 검은 테두리가 없는가 → `DWMWA_WINDOW_CORNER_PREFERENCE = DONOTROUND`
3. CSS `drop-shadow`가 24px 투명 여백 안에서 잘리지 않는가
4. 리사이즈/드래그 중 깜빡임 정도

실패 시 폴백: 불투명 창 + `SetLayeredWindowAttributes` + DWM 라운드/그림자 (CSS 그림자 포기).

### M1 — 메모 창 셸 · 트랙 C

프레임리스 종이, 5색 팔레트, 컨트롤 바(핀·투명도 슬라이더·색상 팝오버·`+`·`✕`), 유휴 상태 전환, 드래그/리사이즈, `Ctrl+Shift+휠` 투명도, 포커스/블러 페이드. 본문은 M0 textarea 스텁 그대로.

### M2 — SQLite 레이어 · 트랙 A

`db.rs` 스키마 + 마이그레이션, `notes.rs` 커맨드(`create_note`, `get_note`, `list_notes`, `save_note`, `set_note_meta`, `soft_delete_note`), 지오메트리 저장/복원(`win.rs::get_work_areas` 포함).

`save_note`는 **한 트랜잭션에서** body/title/tags/links/updated_at을 갱신하고 `updated_at`을 반환한다. 프론트는 CodeMirror `updateListener` → 400ms 디바운스 → invoke, 창 블러/종료 시 강제 flush. 푸터가 `저장 중` → `저장됨 · HH:mm`으로 전환.

제목 파생: 첫 `# 제목` → 없으면 첫 비어있지 않은 줄 → 80자 절단 → 없으면 `제목 없음`.

### M3 — CodeMirror 6 라이브 프리뷰 · 트랙 B

`markdown({ codeLanguages: languages })` + `lineWrapping` 위에, `syntaxTree` 순회로 `DecorationSet`을 만드는 `ViewPlugin`.

- **Task** — `[ ]`/`[x]` 범위를 체크박스 위젯으로 `Decoration.replace`. 완료 시 나머지 줄에 `cm-task-done`(취소선 + `rgba(42,37,33,.45)`). 위젯 클릭은 **트랜잭션 dispatch**로 `[ ]`↔`[x]` 텍스트 치환
- **FencedCode** — 라인 데코레이션으로 `#2a2521` 블록 배경 + 언어별 하이라이트
- **InlineCode / StrongEmphasis / ATXHeading** — 마크 데코레이션 + 커서가 노드 밖일 때 마커 문자 숨김
- **`[[위키링크]]` / `#태그`** — 마크다운 문법에 없으므로 정규식 스캔으로 별도 처리, 마커 숨김 규칙 동일

공통 헬퍼 `cursorInside(state, from, to)`로 "마커 노출" 판정을 일원화한다. 테마는 투명 배경·거터 없음·14px/1.5.

**구현 순서**: 체크박스 → 코드블록 → 인라인 마커 → 위키링크/태그. 각 단계가 독립적으로 동작해야 한다.

### M4 — 트레이 + 전역 단축키 · 트랙 C

`TrayIconBuilder` 메뉴 6항목:

```
새 메모              Ctrl+Alt+N
모든 메모 보기        Ctrl+Alt+M
항상 위 전환          Ctrl+Alt+T
모든 메모 저장
설정
종료
```

트레이 좌클릭 → 보드 토글. `tauri-plugin-global-shortcut`로 3개 등록.

**등록 실패는 반드시 사용자에게 노출한다** — `Ctrl+Alt+N`은 다른 앱과 흔히 충돌하고, 조용히 무동작이 되면 디버깅이 불가능하다. 설정에서 재바인딩 가능하게.

`tauri-plugin-single-instance`(중복 실행 시 기존 인스턴스 깨우기) + `tauri-plugin-autostart`(설정 토글).

### M5 — 보드 창 · 트랙 D

mica 배경(`window-vibrancy::apply_mica`), 커스텀 타이틀바(44px `—` `▢` `✕`, 제목 영역 `startDragging()`, 더블클릭 최대화), 검색창 3모드, 5색 필터 칩, 4열 카드 그리드(132px, hover `translateY(-2px)`), 카드 클릭 → 해당 메모 창 열기/포커스, 우클릭 → 삭제.

> mica가 리사이즈 중 검은 플래시를 내면 `apply_acrylic`으로 교체 시도, 둘 다 문제면 불투명 `rgba(32,30,28,1)`로 폴백.

### M6 — 설정 창 · 트랙 D

- **DISPLAY** — 항상 다른 앱 위에 표시(전역 기본값) / 비활성 시 자동으로 흐려짐 / 기본 투명도 슬라이더 / 악센트 색
- **DATA** — DB 경로 표시 + 폴더 열기 / 백업 만들기(.db 복사) / **마크다운으로 내보내기**(폴더 선택 → 메모당 `.md`) / 파일명에 생성일 프리픽스 토글(`2026-07-26 스프린트24.md`)
- **SHORTCUTS** — 3개 단축키 재바인딩

내보내기가 옵시디언을 나중에 붙일 때의 다리다 — 볼트 폴더를 대상으로 지정하면 즉시 옵시디언에서 열린다.

### M7 — 이미지 첨부 + 마감

붙여넣기 → 이미지 바이트를 `%APPDATA%\...\attachments\<uuid>.png`에 저장 → `![](attachments/x.png)` 삽입 → `convertFileSrc()`로 인라인 위젯 렌더. 디자인의 96×64 플레이스홀더 스타일 재사용.

NSIS 인스톨러 빌드, 앱 아이콘, 자동 시작.

---

## 검증

### 자동

**`cargo test`** (`src-tauri`) — 마이그레이션 멱등성, `save_note` 트랜잭션(title/tags/links 파생), 검색 쿼리 3모드, 지오메트리 왕복

**`npm test`** (vitest, `src/lib`) — 제목 파생 엣지케이스(빈 본문 / 코드블록으로 시작 / 제목만), `#태그`·`[[링크]]` 추출(**코드블록 내부는 제외되어야 함**), 상대 시각 포맷

### 수동 체크리스트

창 동작은 유닛 테스트 불가 — `npm run tauri dev`로 확인. 마일스톤별 활성 시점은 `process.md` 참조.

| # | 항목 |
|---|---|
| 1 | 메모를 브라우저/VSCode 위에 두고 다른 앱을 클릭 → 메모가 계속 보이는가 |
| 2 | 슬라이더 35% → 뒤 창이 비치는가, 텍스트 판독 가능한가 |
| 3 | `Ctrl+Shift+휠` 5%씩 증감, 35/100에서 클램프 |
| 4 | 자동 흐려짐 ON → 메모 클릭 시 100%, 다른 앱 클릭 시 설정값까지 부드럽게 감소 |
| 5 | 마우스를 메모 밖으로 → 컨트롤 바가 사라지고 종이만 남는가 (레이아웃 시프트 없이) |
| 6 | `- [ ] 할 일` 입력 → 즉시 체크박스 렌더, 클릭 → `[x]` + 취소선, DB 재조회 시 유지 |
| 7 | `[[링크]]` 안에 커서 → `[[ ]]` 노출, 밖으로 → 보라색 알약 |
| 8 | 메모를 보조 모니터로 드래그 → 재시작 → 같은 모니터 같은 위치. 보조 모니터 해제 후 재시작 → 주 모니터에 클램프 복원 |
| 9 | 메모 10개 띄우고 메모리 측정 (목표 300MB 이하) |
| 10 | `Ctrl+Alt+N/M/T` 3개, 트레이 메뉴 6항목 |
| 11 | 보드: 검색어/`#태그`/`[[제목]]` 3모드, 색상 필터, 카드 클릭 → 해당 창 포커스 |
| 12 | 설정 → 마크다운으로 내보내기 → `C:\note`(기존 옵시디언 볼트) 지정 → 옵시디언에서 정상 렌더 |

---

## 리스크

| 리스크 | 완화 |
|---|---|
| 투명 + always-on-top WebView2 렌더 아티팩트 | **M0에서 최우선 스파이크.** 실패 시 불투명 창 + `SetLayeredWindowAttributes` + DWM 그림자로 폴백 |
| 메모리가 예상(300MB)을 크게 초과 | 통합 게이트에서 10개 창으로 측정. 초과 시 열린 메모 창 수 상한 + 나머지는 보드에서만 |
| CodeMirror 라이브 프리뷰가 최대 작업량 | M3를 단독 트랙으로 분리. 데코레이션 종류별 점진 추가 |
| mica/acrylic 리사이즈 플래시 | mica → acrylic → 불투명 순으로 폴백 |
| 전역 단축키 충돌 | 등록 실패를 토스트로 노출 + 설정에서 재바인딩 |

---

## v1 제외 — 나중에

**옵시디언 양방향 동기화.** v1의 "마크다운으로 내보내기"를 확장하는 형태가 된다:

1. `notes` 테이블에 `file_path` / `synced_hash` 컬럼 추가
2. `notify` 크레이트로 볼트 감시
3. 디자인에 **이미 그려져 있는** 충돌 배너 + `conflict-{ts}.md` 규칙 되살리기

본문을 마크다운 원문 그대로 SQLite에 넣는 것이 이 확장의 전제이고, v1이 이미 그렇게 되어 있다.
