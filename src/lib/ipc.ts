/**
 * 계약 파일 — M0 동결
 *
 * `src-tauri/src/lib.rs`의 `invoke_handler`에 등록된 모든 커맨드의
 * TypeScript 타입 + invoke 래퍼.
 *
 * ─────────────────────────────────────────────────────────────
 * 개발 중 폴백에 대하여
 *
 * 백엔드 커맨드는 M2(트랙 A)/M4(트랙 C)까지 미구현 상태다.
 * 트랙 B/C/D가 프론트만으로 개발을 진행할 수 있도록,
 * invoke가 실패하면 **더미 데이터를 돌려주는 폴백**을 둔다.
 *
 * 폴백은 전부 `withFallback(...)`을 거치고 `// TODO(M2): 트랙 A 완료 시 제거`
 * 주석이 붙어 있다. 통합 게이트에서 이 주석을 전량 검색해 제거한다.
 * ─────────────────────────────────────────────────────────────
 *
 * 이 파일은 M0 종료와 동시에 동결된다.
 * 커맨드 추가/시그니처 변경이 필요하면 작업을 멈추고 리더에게 보고한다.
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { ColorIndex } from './palette'

export type { ColorIndex }

// ─────────────────────────────────────────────────────────────
// 타입 — src-tauri 의 serde(rename_all = "camelCase") 와 1:1
// ─────────────────────────────────────────────────────────────

/** `notes` 한 행. `body`는 사용자가 친 마크다운 원문 그대로다. */
export interface Note {
  id: string
  /** body에서 파생 — 보드용 비정규화 */
  title: string
  /** 원본 마크다운 */
  body: string
  color: ColorIndex
  /** 35..100 */
  opacity: number
  pinned: boolean
  /** 데스크톱에 창이 떠 있는가 */
  open: boolean
  /** RFC3339 */
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** 보드 카드용 축약 뷰. */
export interface NoteSummary {
  id: string
  title: string
  preview: string
  color: ColorIndex
  open: boolean
  pinned: boolean
  updatedAt: string
  tags: string[]
}

/** 부분 갱신. `undefined`인 필드는 건드리지 않는다. */
export interface NoteMeta {
  color?: ColorIndex
  opacity?: number
  pinned?: boolean
  open?: boolean
}

/** `saveNote` 결과. 푸터의 `저장됨 · HH:mm`에 쓰인다. */
export interface SaveResult {
  id: string
  title: string
  updatedAt: string
  tags: string[]
  links: string[]
}

/** 디자인 검색창의 `검색 · 태그 · [[백링크]]` 3모드. */
export type SearchMode = 'text' | 'tag' | 'backlink'

export interface SearchQuery {
  mode: SearchMode
  /** 접두사(`#`, `[[ ]]`)를 제거한 검색어 */
  term: string
  /** 색상 필터 칩. 비어 있으면 전체 */
  colors: ColorIndex[]
}

/** `note_geometry` — 좌표는 모니터 work-area 원점 기준 **논리 px**. */
export interface Geometry {
  /** `WorkArea.name` — 모니터 디바이스명 */
  monitor: string
  x: number
  y: number
  w: number
  h: number
  /** 저장 시점의 scaleFactor */
  scale: number
}

/** 작업표시줄을 제외한 모니터 영역. 좌표는 **물리 px**. */
export interface WorkArea {
  name: string
  x: number
  y: number
  width: number
  height: number
  scale: number
  isPrimary: boolean
}

/** 설정 창의 DISPLAY / DATA 값. */
export interface Settings {
  alwaysOnTop: boolean
  autoFade: boolean
  /** 35..100 */
  defaultOpacity: number
  /** `#0067C0` | `#7a5cd6` | `#3a8a4f` | `#c05621` */
  accent: string
  /** 내보낸 파일명에 생성일 프리픽스 (`2026-07-26 스프린트24.md`) */
  filenameDatePrefix: boolean
  exportDir: string | null
  autostart: boolean
}

export interface ExportResult {
  count: number
  dir: string
  skipped: string[]
}

export type ShortcutAction = 'newNote' | 'showBoard' | 'toggleAlwaysOnTop'

export interface ShortcutBinding {
  action: ShortcutAction
  /** `Ctrl+Alt+N` 형식 */
  accelerator: string
  /** 거짓이면 설정 창과 토스트에 반드시 노출한다 */
  registered: boolean
  error: string | null
}

/** `apply_window_backdrop` 결과 — mica → acrylic → 불투명 폴백 단계 */
export type Backdrop = 'mica' | 'acrylic' | 'opaque'

// ─────────────────────────────────────────────────────────────
// 이벤트 이름 (src-tauri/src/windows.rs 와 동일)
// ─────────────────────────────────────────────────────────────

export const EVENT_SAVE_ALL = 'sticky://save-all'
export const EVENT_NOTE_META_CHANGED = 'sticky://note-meta-changed'

// ─────────────────────────────────────────────────────────────
// invoke 래퍼
// ─────────────────────────────────────────────────────────────

/** Tauri 런타임 안에서 돌고 있는가. `npm run dev`(브라우저)에서는 거짓. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export class IpcError extends Error {
  constructor(
    public readonly command: string,
    message: string,
  ) {
    super(`${command}: ${message}`)
    this.name = 'IpcError'
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args)
  } catch (e) {
    throw new IpcError(command, typeof e === 'string' ? e : String(e))
  }
}

// TODO(M2): 트랙 A/C 완료 시 이 폴백 전체를 제거한다.
//           통합 게이트에서 `withFallback` 검색 결과가 0이어야 한다.
const fallbackWarned = new Set<string>()

/**
 * 백엔드가 아직 `미구현` 에러를 돌려주는 동안 프론트가 죽지 않게 한다.
 *
 * TODO(M2): 트랙 A 완료 시 제거 — `call()`을 직접 쓰도록 바꾼다.
 */
async function withFallback<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  dummy: () => T,
): Promise<T> {
  try {
    return await call<T>(command, args)
  } catch (e) {
    if (!fallbackWarned.has(command)) {
      fallbackWarned.add(command)
      console.warn(`[ipc] ${command} 폴백 — 더미 데이터를 사용합니다.`, e)
    }
    return dummy()
  }
}

// ─────────────────────────────────────────────────────────────
// 더미 데이터 (개발용)
// TODO(M2): 트랙 A 완료 시 제거
// ─────────────────────────────────────────────────────────────

const DUMMY_BODY = `# 스프린트 24 · 릴리스 체크

- [x] 설치 관리자 서명 인증서 갱신
- [ ] 투명도 슬라이더 GPU 합성 이슈 확인
- [ ] 볼트 충돌 시 \`conflict-{ts}.md\` 생성

창 위치는 **모니터 DPI 기준 상대 좌표**로 저장. 관련 노트는 [[릴리스 절차]] 참고.

\`\`\`rust
SetWindowPos(hwnd, HWND_TOPMOST,
    0, 0, 0, 0, SWP_NOMOVE);
\`\`\`

#릴리스 #win32 #급함
`

function dummyNote(id = 'spike'): Note {
  const now = new Date().toISOString()
  return {
    id,
    title: '스프린트 24 · 릴리스 체크',
    body: DUMMY_BODY,
    color: 0,
    opacity: 96,
    pinned: true,
    open: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

/** 디자인 `boardNotes` 8장 — 메타 문구는 v1 해석(상대 시각)으로 바꿨다. */
function dummySummaries(): NoteSummary[] {
  const now = Date.now()
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()
  const rows: Array<{
    id: string
    title: string
    preview: string
    color: ColorIndex
    minutes: number
    tags: string[]
  }> = [
    { id: 'n1', title: '오늘', preview: '디자인 리뷰 11:00 · 옵시디언 플러그인 문서 · 전기요금 자동이체', color: 0, minutes: 1, tags: ['일간'] },
    { id: 'n2', title: '전화 · 김PM', preview: 'API 키 만료 건 → 목요일까지 회신', color: 1, minutes: 120, tags: [] },
    { id: 'n3', title: '단축키', preview: 'Ctrl+Alt+N 새 메모 / Ctrl+Shift+휠 투명도', color: 2, minutes: 60 * 26, tags: [] },
    { id: 'n4', title: '장보기', preview: '커피 원두, 우유, 파스타면', color: 3, minutes: 60 * 50, tags: [] },
    { id: 'n5', title: '스프린트 24', preview: '설치 관리자 서명 인증서 갱신 · 볼트 충돌 처리', color: 4, minutes: 8, tags: ['릴리스', 'win32'] },
    { id: 'n6', title: '읽을거리', preview: '[[윈도우 합성기]] · DWM 투명도 문서', color: 0, minutes: 60 * 24 * 3, tags: [] },
    { id: 'n7', title: '인용', preview: '"창은 도구여야지 목적지가 아니다"', color: 2, minutes: 60 * 24 * 8, tags: [] },
    { id: 'n8', title: '아이디어', preview: '메모를 모니터 가장자리에 스냅해 도킹', color: 1, minutes: 60 * 24 * 12, tags: [] },
  ]
  return rows.map(({ id, title, preview, color, minutes, tags }) => ({
    id,
    title,
    preview,
    color,
    open: id === 'n1',
    pinned: true,
    updatedAt: iso(minutes),
    tags,
  }))
}

function dummySettings(): Settings {
  return {
    alwaysOnTop: true,
    autoFade: true,
    defaultOpacity: 96,
    accent: '#0067C0',
    filenameDatePrefix: false,
    exportDir: null,
    autostart: false,
  }
}

function dummyShortcuts(): ShortcutBinding[] {
  return [
    { action: 'newNote', accelerator: 'Ctrl+Alt+N', registered: false, error: '개발 중 — 미등록' },
    { action: 'showBoard', accelerator: 'Ctrl+Alt+M', registered: false, error: '개발 중 — 미등록' },
    { action: 'toggleAlwaysOnTop', accelerator: 'Ctrl+Alt+T', registered: false, error: '개발 중 — 미등록' },
  ]
}

// ─────────────────────────────────────────────────────────────
// notes — 트랙 A (M2)
// ─────────────────────────────────────────────────────────────

export function createNote(color?: ColorIndex): Promise<Note> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('create_note', { color }, () => dummyNote(`dev-${Date.now()}`))
}

export function getNote(id: string): Promise<Note | null> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('get_note', { id }, () => dummyNote(id))
}

export function listNotes(includeDeleted = false): Promise<NoteSummary[]> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('list_notes', { includeDeleted }, dummySummaries)
}

/** body/title/tags/links/updatedAt을 한 트랜잭션에서 갱신한다. */
export function saveNote(id: string, body: string): Promise<SaveResult> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('save_note', { id, body }, () => ({
    id,
    title: body.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 80) ?? '제목 없음',
    updatedAt: new Date().toISOString(),
    tags: [],
    links: [],
  }))
}

export function setNoteMeta(id: string, meta: NoteMeta): Promise<Note> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('set_note_meta', { id, meta }, () => ({ ...dummyNote(id), ...meta }))
}

export function softDeleteNote(id: string): Promise<void> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('soft_delete_note', { id }, () => undefined)
}

export function searchNotes(query: SearchQuery): Promise<NoteSummary[]> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('search_notes', { query }, () => {
    const all = dummySummaries()
    const term = query.term.trim().toLowerCase()
    const byColor = query.colors.length
      ? all.filter((n) => query.colors.includes(n.color))
      : all
    if (!term) return byColor
    if (query.mode === 'tag') return byColor.filter((n) => n.tags.some((t) => t.includes(term)))
    return byColor.filter(
      (n) => n.title.toLowerCase().includes(term) || n.preview.toLowerCase().includes(term),
    )
  })
}

// ─────────────────────────────────────────────────────────────
// settings — 트랙 A (M2)
// ─────────────────────────────────────────────────────────────

export function getSettings(): Promise<Settings> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('get_settings', undefined, dummySettings)
}

export function setSetting(key: keyof Settings, value: string): Promise<void> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('set_setting', { key, value }, () => undefined)
}

// ─────────────────────────────────────────────────────────────
// windows — 트랙 A / 트랙 C
// ─────────────────────────────────────────────────────────────

export function openNoteWindow(id: string): Promise<void> {
  return call('open_note_window', { id })
}

/** 메모를 새로 만들고 창까지 띄운다. 반환값은 새 메모의 id. */
export function newNoteWindow(color?: ColorIndex): Promise<string> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('new_note_window', { color }, () => `dev-${Date.now()}`)
}

export function focusNoteWindow(id: string): Promise<void> {
  return call('focus_note_window', { id })
}

/** `✕` — 창 destroy + `notes.open = 0`. 메모 자체는 남는다. */
export function closeNoteWindow(id: string): Promise<void> {
  return call('close_note_window', { id })
}

export function listOpenNotes(): Promise<string[]> {
  return call('list_open_notes')
}

export function restoreOpenNotes(): Promise<string[]> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('restore_open_notes', undefined, () => [])
}

export function setNoteAlwaysOnTop(id: string, pinned: boolean): Promise<void> {
  return call('set_note_always_on_top', { id, pinned })
}

/** 반환값은 "지금 열려 있는가". */
export function toggleBoardWindow(): Promise<boolean> {
  return call('toggle_board_window')
}

export function showBoardWindow(): Promise<void> {
  return call('show_board_window')
}

export function toggleSettingsWindow(): Promise<boolean> {
  return call('toggle_settings_window')
}

export function showSettingsWindow(): Promise<void> {
  return call('show_settings_window')
}

export function saveNoteGeometry(noteId: string, geometry: Geometry): Promise<void> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('save_note_geometry', { noteId, geometry }, () => undefined)
}

export function loadNoteGeometry(noteId: string): Promise<Geometry | null> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('load_note_geometry', { noteId }, () => null)
}

/** 트레이 "모든 메모 저장" — 열린 메모 창에 flush를 요청한다. */
export function requestSaveAll(): Promise<void> {
  return call('request_save_all')
}

// ─────────────────────────────────────────────────────────────
// win — Win32 (트랙 A)
// ─────────────────────────────────────────────────────────────

export function getWorkAreas(): Promise<WorkArea[]> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거 (브라우저 개발 모드 대비)
  return withFallback('get_work_areas', undefined, () => [
    {
      name: '\\\\.\\DISPLAY1',
      x: 0,
      y: 0,
      width: 1920,
      height: 1040,
      scale: 1,
      isPrimary: true,
    },
  ])
}

/**
 * **폴백 경로.** 기본 투명도 구현은 종이 루트 엘리먼트의 CSS `opacity`다.
 * M0 스파이크 1에서 아티팩트가 확인된 경우에만 쓴다.
 */
export function setWindowOpacity(alpha: number): Promise<void> {
  return call('set_window_opacity', { alpha })
}

/** `rounded = false` → `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_DONOTROUND` */
export function setWindowCornerPreference(rounded: boolean): Promise<void> {
  return call('set_window_corner_preference', { rounded })
}

export function applyWindowBackdrop(): Promise<Backdrop> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback('apply_window_backdrop', undefined, () => 'opaque' as Backdrop)
}

// ─────────────────────────────────────────────────────────────
// export — 트랙 A (M6)
// ─────────────────────────────────────────────────────────────

export function exportMarkdown(dir: string, datePrefix: boolean): Promise<ExportResult> {
  return call('export_markdown', { dir, datePrefix })
}

export function backupDb(dir?: string): Promise<string> {
  return call('backup_db', { dir })
}

export function getDbPath(): Promise<string> {
  // TODO(M2): 트랙 A 완료 시 폴백 제거
  return withFallback(
    'get_db_path',
    undefined,
    () => '%APPDATA%\\com.sticky-notes.app\\sticky-notes.db',
  )
}

/** 탐색기에서 경로를 연다. */
export function revealPath(path: string): Promise<void> {
  return call('reveal_path', { path })
}

// ─────────────────────────────────────────────────────────────
// shortcuts — 트랙 C (M4)
// ─────────────────────────────────────────────────────────────

export function getShortcuts(): Promise<ShortcutBinding[]> {
  // TODO(M4): 트랙 C 완료 시 폴백 제거
  return withFallback('get_shortcuts', undefined, dummyShortcuts)
}

export function setShortcut(
  action: ShortcutAction,
  accelerator: string,
): Promise<ShortcutBinding> {
  return call('set_shortcut', { action, accelerator })
}

/** 등록 실패 목록. **비어 있지 않으면 반드시 사용자에게 노출한다.** */
export function getShortcutFailures(): Promise<ShortcutBinding[]> {
  // TODO(M4): 트랙 C 완료 시 폴백 제거
  return withFallback('get_shortcut_failures', undefined, () => [])
}

export function getAutostart(): Promise<boolean> {
  // TODO(M4): 트랙 C 완료 시 폴백 제거
  return withFallback('get_autostart', undefined, () => false)
}

export function setAutostart(enabled: boolean): Promise<boolean> {
  return call('set_autostart', { enabled })
}
