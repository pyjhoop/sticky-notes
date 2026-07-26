/**
 * 계약 파일 — 커맨드 TypeScript 타입 + invoke 래퍼
 *
 * `src-tauri/src/lib.rs`의 `invoke_handler`에 등록된 모든 커맨드와 1:1이다.
 *
 * ─────────────────────────────────────────────────────────────
 * 폴백은 없다 (통합 게이트에서 제거)
 *
 * M0~M4 동안에는 백엔드가 미완이라 invoke 실패 시 더미 데이터를 돌려주는 폴백이
 * 있었다. 트랙 A/C 병합으로 실데이터가 흐르므로 **전량 제거했다** —
 * 백엔드 에러가 조용히 삼켜지면 화면에 더미가 뜨고 디버깅이 불가능해진다.
 *
 * 이제 모든 래퍼는 실패 시 `IpcError`를 던진다. **호출부가 반드시 잡아서
 * 사용자에게 한국어로 보여준다** (`src/lib/errors.ts`의 `failureNotice`).
 * ─────────────────────────────────────────────────────────────
 *
 * 이 파일은 트랙 간 계약이다. 시그니처를 바꾸면 `process.md`의
 * "계약 변경 이력"에 반드시 한 줄 남긴다.
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

/**
 * 설정 창의 DISPLAY / DATA 값 + 저장된 단축키.
 *
 * 단축키 3개가 여기 있는 이유: `set_shortcut`이 `settings` 테이블에 쓰기만 하고
 * **읽는 경로가 없어** 재시작하면 재바인딩이 사라졌다. `Settings`의 필드로 만들면
 * 쓰기(`set_setting`)·읽기(`get_settings`)가 한 경로로 맞물리고,
 * `shortcuts::init`이 시작 시 저장된 값을 그대로 등록할 수 있다.
 */
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
  /** 저장된 `새 메모` 단축키. 기본 `Ctrl+Alt+N` */
  shortcutNewNote: string
  /** 저장된 `모든 메모 보기` 단축키. 기본 `Ctrl+Alt+M` */
  shortcutShowBoard: string
  /** 저장된 `항상 위 전환` 단축키. 기본 `Ctrl+Alt+T` */
  shortcutToggleAlwaysOnTop: string
}

export interface ExportResult {
  count: number
  dir: string
  skipped: string[]
}

export type ShortcutAction = 'newNote' | 'showBoard' | 'toggleAlwaysOnTop'

/**
 * 단축키 동작 → `settings` 테이블 key.
 * `src-tauri/src/shortcuts.rs`의 `setting_key()`와 **글자까지 같아야 한다**.
 */
export const SHORTCUT_SETTING_KEY: Record<ShortcutAction, keyof Settings> = {
  newNote: 'shortcutNewNote',
  showBoard: 'shortcutShowBoard',
  toggleAlwaysOnTop: 'shortcutToggleAlwaysOnTop',
}

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

// ─────────────────────────────────────────────────────────────
// notes
// ─────────────────────────────────────────────────────────────

export function createNote(color?: ColorIndex): Promise<Note> {
  return call('create_note', { color })
}

export function getNote(id: string): Promise<Note | null> {
  return call('get_note', { id })
}

export function listNotes(includeDeleted = false): Promise<NoteSummary[]> {
  return call('list_notes', { includeDeleted })
}

/** body/title/tags/links/updatedAt을 한 트랜잭션에서 갱신한다. */
export function saveNote(id: string, body: string): Promise<SaveResult> {
  return call('save_note', { id, body })
}

export function setNoteMeta(id: string, meta: NoteMeta): Promise<Note> {
  return call('set_note_meta', { id, meta })
}

export function softDeleteNote(id: string): Promise<void> {
  return call('soft_delete_note', { id })
}

export function searchNotes(query: SearchQuery): Promise<NoteSummary[]> {
  return call('search_notes', { query })
}

// ─────────────────────────────────────────────────────────────
// settings
// ─────────────────────────────────────────────────────────────

export function getSettings(): Promise<Settings> {
  return call('get_settings')
}

export function setSetting(key: keyof Settings, value: string): Promise<void> {
  return call('set_setting', { key, value })
}

// ─────────────────────────────────────────────────────────────
// windows — 트랙 A / 트랙 C
// ─────────────────────────────────────────────────────────────

export function openNoteWindow(id: string): Promise<void> {
  return call('open_note_window', { id })
}

/** 메모를 새로 만들고 창까지 띄운다. 반환값은 새 메모의 id. */
export function newNoteWindow(color?: ColorIndex): Promise<string> {
  return call('new_note_window', { color })
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
  return call('restore_open_notes')
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
  return call('save_note_geometry', { noteId, geometry })
}

export function loadNoteGeometry(noteId: string): Promise<Geometry | null> {
  return call('load_note_geometry', { noteId })
}

/** 트레이 "모든 메모 저장" — 열린 메모 창에 flush를 요청한다. */
export function requestSaveAll(): Promise<void> {
  return call('request_save_all')
}

// ─────────────────────────────────────────────────────────────
// win — Win32 (트랙 A)
// ─────────────────────────────────────────────────────────────

export function getWorkAreas(): Promise<WorkArea[]> {
  return call('get_work_areas')
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
  return call('apply_window_backdrop')
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
  return call('get_db_path')
}

/** 탐색기에서 경로를 연다. */
export function revealPath(path: string): Promise<void> {
  return call('reveal_path', { path })
}

// ─────────────────────────────────────────────────────────────
// shortcuts — 트랙 C (M4)
// ─────────────────────────────────────────────────────────────

export function getShortcuts(): Promise<ShortcutBinding[]> {
  return call('get_shortcuts')
}

export function setShortcut(
  action: ShortcutAction,
  accelerator: string,
): Promise<ShortcutBinding> {
  return call('set_shortcut', { action, accelerator })
}

/**
 * 사용자 확인이 필요한 단축키 목록. **비어 있지 않으면 반드시 노출한다.**
 *
 * 두 가지가 섞여 온다:
 * - `registered: false` — 등록 자체가 실패했다 (동작하지 않는다)
 * - `registered: true` + `error` — 저장된 값이 안 먹혀 **기본값으로 되돌렸다**
 */
export function getShortcutFailures(): Promise<ShortcutBinding[]> {
  return call('get_shortcut_failures')
}

export function getAutostart(): Promise<boolean> {
  return call('get_autostart')
}

export function setAutostart(enabled: boolean): Promise<boolean> {
  return call('set_autostart', { enabled })
}
