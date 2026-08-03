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
  /** 소속 폴더. `null`이면 미분류 */
  folderId: string | null
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
  /** 소속 폴더. `null`이면 미분류 — 보드 리스트 뷰의 사이드바 필터에 쓰인다 */
  folderId: string | null
  /** RFC3339 — 보드 리스트 뷰의 "생성일" 정렬 */
  createdAt: string
  /** 있으면 휴지통에 있는 메모다 */
  deletedAt: string | null
}

/** 보드 리스트 뷰의 실제 폴더. `전체`/`미분류`/`휴지통`은 가상 폴더라 여기 없다. */
export interface Folder {
  id: string
  name: string
  sortOrder: number
  createdAt: string
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

/**
 * 설치 가능한 새 버전. `src-tauri/src/update.rs` 의 `UpdateInfo` 와 1:1.
 *
 * 확인·다운로드·설치는 전부 백엔드가 한다 — 웹뷰 CSP 가 외부 호스트를 막고,
 * 그래야 updater 권한을 웹뷰에 열지 않아도 된다.
 */
export interface UpdateInfo {
  /** 새 버전 (`1.0.42`) */
  version: string
  /** 지금 설치돼 있는 버전 */
  currentVersion: string
  notes: string | null
  date: string | null
}

// ─────────────────────────────────────────────────────────────
// 이벤트 이름 (src-tauri/src/windows.rs · update.rs 와 동일)
// ─────────────────────────────────────────────────────────────

export const EVENT_SAVE_ALL = 'sticky://save-all'
export const EVENT_NOTE_META_CHANGED = 'sticky://note-meta-changed'
/**
 * **메모 집합이 바뀌었다** — 생성 · 저장 · 메타 변경 · 삭제 · 창 열기/닫기.
 *
 * 보드 창이 이걸 듣고 목록을 다시 읽는다. 이 이벤트가 없던 동안 보드는 처음 읽은
 * 목록을 끝까지 들고 있었고, 다른 창에서 메모를 만들거나 지워도 화면이 그대로였다.
 */
export const EVENT_NOTES_CHANGED = 'sticky://notes-changed'
/** 페이로드는 `UpdateInfo`. */
export const EVENT_UPDATE_AVAILABLE = 'sticky://update-available'

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
// folders — 보드 리스트 뷰 (폴더 사이드바 + 휴지통)
// ─────────────────────────────────────────────────────────────

export function listFolders(): Promise<Folder[]> {
  return call('list_folders')
}

export function createFolder(name: string): Promise<Folder> {
  return call('create_folder', { name })
}

export function renameFolder(id: string, name: string): Promise<Folder> {
  return call('rename_folder', { id, name })
}

/** 폴더를 지운다. 그 폴더의 메모는 미분류로 되돌아간다(메모 자체는 지워지지 않는다). */
export function deleteFolder(id: string): Promise<void> {
  return call('delete_folder', { id })
}

/** `folderId: null`은 "미분류로 이동"을 뜻한다. */
export function moveNotesToFolder(ids: string[], folderId: string | null): Promise<void> {
  return call('move_notes_to_folder', { ids, folderId })
}

/** 여러 메모를 한 번에 휴지통으로 보낸다(soft delete) — 떠 있는 창도 같이 닫힌다. */
export function softDeleteNotes(ids: string[]): Promise<void> {
  return call('soft_delete_notes', { ids })
}

/** 휴지통에서 복원한다. 있던 폴더로 그대로 돌아간다. */
export function restoreNotes(ids: string[]): Promise<void> {
  return call('restore_notes', { ids })
}

/** 휴지통에서 완전히 지운다 — 되돌릴 수 없다. */
export function permanentlyDeleteNotes(ids: string[]): Promise<void> {
  return call('permanently_delete_notes', { ids })
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

/** `ids`를 주면 그 메모들만(삭제 여부 무관) 내보낸다. 생략하면 기존 동작(삭제 안 된 전체). */
export function exportMarkdown(
  dir: string,
  datePrefix: boolean,
  ids?: string[],
): Promise<ExportResult> {
  return call('export_markdown', { dir, datePrefix, ids })
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

// ─────────────────────────────────────────────────────────────
// attachments — M7
// ─────────────────────────────────────────────────────────────

/** 확장자 힌트를 싣는 IPC 헤더 (`src-tauri/src/attachments.rs::EXT_HEADER`). */
const ATTACHMENT_EXT_HEADER = 'x-attachment-ext'

/**
 * 붙여넣은 이미지를 앱 저장소에 넣고 `attachments/<uuid>.<ext>` 를 받는다.
 *
 * 바이트는 JSON 숫자 배열이 아니라 **raw IPC 바디**로 보낸다 — 스크린샷 한 장이
 * 수 MB 라 배열로 직렬화하면 붙여넣기마다 눈에 띄게 멈춘다.
 * `extHint` 는 `image/png` 같은 MIME 이나 `png` 같은 확장자 둘 다 된다.
 * 최종 판정은 백엔드의 화이트리스트가 한다.
 */
export async function saveAttachment(bytes: Uint8Array, extHint: string): Promise<string> {
  try {
    return await tauriInvoke<string>('save_attachment', bytes, {
      headers: {
        'Content-Type': 'application/octet-stream',
        [ATTACHMENT_EXT_HEADER]: extHint,
      },
    })
  } catch (e) {
    throw new IpcError('save_attachment', typeof e === 'string' ? e : String(e))
  }
}

/** 첨부 폴더 절대 경로. `convertFileSrc()` 에 넘길 경로를 만드는 데 쓴다. */
export function getAttachmentsDir(): Promise<string> {
  return call('get_attachments_dir')
}

// ─────────────────────────────────────────────────────────────
// update — 자동 업데이트
// ─────────────────────────────────────────────────────────────

/** 지금 설치돼 있는 앱 버전 (`1.0.42`). */
export function getAppVersion(): Promise<string> {
  return call('get_app_version')
}

/** 엔드포인트를 지금 확인한다. 새 버전이 없으면 `null`. 네트워크 실패는 던진다. */
export function checkUpdate(): Promise<UpdateInfo | null> {
  return call('check_update')
}

/** 시작 시 확인해 둔 결과. 나중에 열린 창이 배너를 띄우는 데 쓴다. */
export function getPendingUpdate(): Promise<UpdateInfo | null> {
  return call('get_pending_update')
}

/**
 * 새 버전을 내려받아 설치하고 앱을 재시작한다.
 *
 * 성공하면 **이 Promise 는 resolve 되지 않는다** — 프로세스가 교체된다.
 */
export function installUpdate(): Promise<void> {
  return call('install_update')
}
