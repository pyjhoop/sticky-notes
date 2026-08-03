/**
 * 보드 창 — 폴더 사이드바 + 리스트 뷰.
 *
 * 2026-08-03 전면 개편. 이전의 4열 카드 그리드(M5)를 대체한다 — 사용자가
 * 제공한 목업(사이드바 `전체 / 미분류 / 폴더들 / 휴지통` + 우측 검색/정렬/리스트)이
 * 근거다. `design/Sticky Notes for Windows.dc.html`은 카드 디자인의 원본이라
 * 건드리지 않았고, 이 화면은 그걸 대체하는 새 화면이다.
 *
 * 재사용한 기존 로직: refreshStats류 재조회 패턴 · EVENT_NOTES_CHANGED 리스너 ·
 * parseSearch(3모드 검색) · 우클릭 메뉴 패턴 · notice 배너.
 *
 * 폴더/정렬/카운팅은 순수 함수로 뽑아 `BoardWindow.test.ts`에서 유닛 테스트한다 —
 * `sortNoteSummaries` · `filterByFolderSelection` · `folderCounts` · `filterByText`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { listen } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import TitleBar from '../components/TitleBar'
import { failureNotice } from '../lib/errors'
import { paletteOf } from '../lib/palette'
import { formatRelative } from '../lib/time'
import {
  applyWindowBackdrop,
  closeNoteWindow,
  createFolder,
  deleteFolder,
  EVENT_NOTES_CHANGED,
  EVENT_NOTE_META_CHANGED,
  exportMarkdown,
  focusNoteWindow,
  getSettings,
  isTauri,
  listFolders,
  listNotes,
  moveNotesToFolder,
  newNoteWindow,
  openNoteWindow,
  permanentlyDeleteNotes,
  renameFolder,
  restoreNotes,
  searchNotes,
  softDeleteNotes,
  type Folder,
  type NoteSummary,
  type SearchMode,
} from '../lib/ipc'
import '../styles/board.css'

/** 디자인 검색창 플레이스홀더 `검색 · 태그 · [[백링크]]`의 3모드 파서. */
export function parseSearch(raw: string): { mode: SearchMode; term: string } {
  const s = raw.trim()
  if (s.startsWith('#')) return { mode: 'tag', term: s.slice(1).trim() }
  if (s.startsWith('[[')) {
    const end = s.endsWith(']]') && s.length >= 4 ? s.length - 2 : s.length
    return { mode: 'backlink', term: s.slice(2, end).trim() }
  }
  return { mode: 'text', term: s }
}

/** 사이드바 선택 상태 — `전체`/`미분류`/`휴지통`은 가상 폴더, 그 외는 실제 `folders.id`. */
export type FolderSelection = 'all' | 'unfiled' | 'trash' | string

/** 툴바 정렬 탭 — 기본 `updated`(수정일). */
export type SortKey = 'updated' | 'created' | 'title'

export interface FolderCountResult {
  all: number
  unfiled: number
  trash: number
  byFolder: Record<string, number>
}

/**
 * 사이드바 각 항목의 개수를 `listNotes(true)`(삭제 포함 전체) 결과에서 직접 센다.
 * 백엔드를 다시 치지 않는다 — 이미 갖고 있는 목록으로 충분하다.
 */
export function folderCounts(notes: NoteSummary[]): FolderCountResult {
  let all = 0
  let unfiled = 0
  let trash = 0
  const byFolder: Record<string, number> = {}
  for (const n of notes) {
    if (n.deletedAt) {
      trash += 1
      continue
    }
    all += 1
    if (n.folderId) {
      byFolder[n.folderId] = (byFolder[n.folderId] ?? 0) + 1
    } else {
      unfiled += 1
    }
  }
  return { all, unfiled, trash, byFolder }
}

/**
 * 사이드바 선택으로 목록을 거른다.
 *
 * `trash` 선택은 삭제된 것만, 그 외는 삭제되지 않은 것 중 폴더가 일치하는 것만.
 * `notes`에 이미 삭제/미삭제가 섞여 있어도, 섞여 있지 않아도(예: `searchNotes`가
 * 이미 삭제 제외) 안전하게 동작한다.
 */
export function filterByFolderSelection(
  notes: NoteSummary[],
  selection: FolderSelection,
): NoteSummary[] {
  if (selection === 'trash') return notes.filter((n) => n.deletedAt)
  const active = notes.filter((n) => !n.deletedAt)
  if (selection === 'all') return active
  if (selection === 'unfiled') return active.filter((n) => !n.folderId)
  return active.filter((n) => n.folderId === selection)
}

/** 휴지통 뷰 전용 — 제목/미리보기 부분일치, 모드 구분 없이 클라이언트에서 거른다. */
export function filterByText(notes: NoteSummary[], term: string): NoteSummary[] {
  const q = term.trim().toLowerCase()
  if (!q) return notes
  return notes.filter(
    (n) => n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q),
  )
}

/** 정렬 — 새 배열을 돌려준다(원본을 바꾸지 않는다). */
export function sortNoteSummaries(notes: NoteSummary[], key: SortKey): NoteSummary[] {
  const copy = [...notes]
  switch (key) {
    case 'created':
      copy.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      break
    case 'title':
      copy.sort((a, b) => a.title.localeCompare(b.title, 'ko'))
      break
    case 'updated':
    default:
      copy.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      break
  }
  return copy
}

const SORT_LABEL: Record<SortKey, string> = {
  updated: '수정일',
  created: '생성일',
  title: '이름',
}

interface RowMenu {
  x: number
  y: number
  note: NoteSummary
}

interface MoveMenu {
  x: number
  y: number
  ids: string[]
}

interface FolderMenu {
  x: number
  y: number
  folder: Folder
}

export default function BoardWindow() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [all, setAll] = useState<NoteSummary[]>([])
  const [results, setResults] = useState<NoteSummary[]>([])
  const [raw, setRaw] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [selection, setSelection] = useState<FolderSelection>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<RowMenu | null>(null)
  const [moveMenu, setMoveMenu] = useState<MoveMenu | null>(null)
  const [folderMenu, setFolderMenu] = useState<FolderMenu | null>(null)
  const [tick, setTick] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const searchSeq = useRef(0)

  const parsed = useMemo(() => parseSearch(raw), [raw])

  const refreshAll = useCallback(() => {
    listNotes(true)
      .then((rows) => {
        setAll(rows)
        setNotice(null)
      })
      .catch((e) => setNotice(failureNotice('메모 목록을 불러오지 못했습니다', e)))
  }, [])

  const refreshFolders = useCallback(() => {
    listFolders()
      .then(setFolders)
      .catch((e) => setNotice(failureNotice('폴더 목록을 불러오지 못했습니다', e)))
  }, [])

  // mica → acrylic → 불투명. 결과를 body에 실어 배경 규칙을 전환한다 (board.css).
  useEffect(() => {
    if (!isTauri()) return
    applyWindowBackdrop()
      .then((b) => {
        document.body.dataset.backdrop = b
      })
      .catch(() => {
        document.body.dataset.backdrop = 'opaque'
      })
  }, [])

  useEffect(() => {
    refreshAll()
    refreshFolders()
  }, [refreshAll, refreshFolders, tick])

  // 검색 — 입력 180ms 디바운스. 늦게 온 응답이 최신 결과를 덮지 않게 시퀀스로 막는다.
  // (휴지통 뷰는 이 결과를 쓰지 않는다 — filterByText로 클라이언트에서 따로 거른다)
  useEffect(() => {
    const seq = ++searchSeq.current
    const run = () => {
      searchNotes({ mode: parsed.mode, term: parsed.term, colors: [] })
        .then((rows) => {
          if (seq === searchSeq.current) setResults(rows)
        })
        .catch((e) => setNotice(failureNotice('검색에 실패했습니다', e)))
    }
    const t = window.setTimeout(run, parsed.term ? 180 : 0)
    return () => window.clearTimeout(t)
  }, [parsed.mode, parsed.term, tick])

  // 다른 창에서 메모/폴더가 바뀌면 보드를 갱신한다 (`sticky://notes-changed`).
  useEffect(() => {
    if (!isTauri()) return
    const bump = () => setTick((n) => n + 1)
    const disposers: Array<() => void> = []
    let disposed = false

    const track = (un: () => void) => {
      if (disposed) un()
      else disposers.push(un)
    }

    listen(EVENT_NOTES_CHANGED, bump)
      .then(track)
      .catch((e) =>
        setNotice(failureNotice('다른 창의 변경을 따라가지 못합니다. 창을 다시 여세요', e)),
      )
    listen(EVENT_NOTE_META_CHANGED, bump).then(track).catch(() => {})

    window.addEventListener('focus', bump)
    return () => {
      disposed = true
      window.removeEventListener('focus', bump)
      disposers.forEach((un) => un())
    }
  }, [])

  // 사이드바 선택이 바뀌면 다중 선택을 비운다 — 다른 폴더의 메모를 실수로 계속
  // 선택한 채로 폴더 이동/삭제 버튼을 누르는 사고를 막는다.
  useEffect(() => {
    setSelectedIds(new Set())
  }, [selection])

  // 팝업(우클릭 메뉴 · 폴더 이동 · 폴더 컨텍스트 메뉴) 바깥 클릭/Esc로 닫기.
  useEffect(() => {
    if (!menu && !moveMenu && !folderMenu) return
    const closeAll = () => {
      setMenu(null)
      setMoveMenu(null)
      setFolderMenu(null)
    }
    const onPointerDown = (e: Event) => {
      const target = e.target
      if (target instanceof Element && target.closest('.board__menu')) return
      closeAll()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll()
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('resize', closeAll)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('resize', closeAll)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, moveMenu, folderMenu])

  const counts = useMemo(() => folderCounts(all), [all])

  const displayList = useMemo(() => {
    if (selection === 'trash') {
      const trashNotes = filterByFolderSelection(all, 'trash')
      return sortNoteSummaries(filterByText(trashNotes, raw), sortKey)
    }
    const filtered = filterByFolderSelection(results, selection)
    return sortNoteSummaries(filtered, sortKey)
  }, [selection, all, results, raw, sortKey])

  const openCount = useMemo(() => all.filter((n) => n.open && !n.deletedAt).length, [all])
  const footline = `메모 ${counts.all}개 · 화면에 있음 ${openCount} · 휴지통 ${counts.trash} · 14일 자동 삭제`

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openNote = async (id: string) => {
    setMenu(null)
    try {
      await openNoteWindow(id)
      await focusNoteWindow(id)
    } catch (e) {
      setNotice(failureNotice('메모 창을 열지 못했습니다', e))
      return
    }
    setTick((n) => n + 1)
  }

  const closeNote = async (id: string) => {
    setMenu(null)
    try {
      await closeNoteWindow(id)
    } catch (e) {
      setNotice(failureNotice('메모 창을 닫지 못했습니다', e))
      return
    }
    setTick((n) => n + 1)
  }

  /** 보드에서 바로 새 메모. 지금 폴더를 보고 있으면 그 폴더로 바로 넣어 준다. */
  const createNote = async () => {
    let id: string
    try {
      id = await newNoteWindow()
    } catch (e) {
      setNotice(failureNotice('새 메모를 만들지 못했습니다', e))
      return
    }
    if (selection !== 'all' && selection !== 'unfiled' && selection !== 'trash') {
      try {
        await moveNotesToFolder([id], selection)
      } catch {
        // 새 메모 생성 자체는 성공했다 — 폴더 배정 실패로 되돌리지 않는다.
      }
    }
    setTick((n) => n + 1)
  }

  const deleteNoteSingle = async (id: string) => {
    setMenu(null)
    try {
      await softDeleteNotes([id])
    } catch (e) {
      setNotice(failureNotice('메모를 삭제하지 못했습니다', e))
      return
    }
    setTick((n) => n + 1)
  }

  const onDeleteSelected = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    try {
      await softDeleteNotes(ids)
    } catch (e) {
      setNotice(failureNotice('메모를 삭제하지 못했습니다', e))
      return
    }
    setSelectedIds(new Set())
    setTick((n) => n + 1)
  }

  const onRestoreSelected = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    try {
      await restoreNotes(ids)
    } catch (e) {
      setNotice(failureNotice('메모를 복원하지 못했습니다', e))
      return
    }
    setSelectedIds(new Set())
    setTick((n) => n + 1)
  }

  const onPermanentlyDeleteSelected = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!window.confirm(`${ids.length}개 메모를 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return
    try {
      await permanentlyDeleteNotes(ids)
    } catch (e) {
      setNotice(failureNotice('메모를 완전히 삭제하지 못했습니다', e))
      return
    }
    setSelectedIds(new Set())
    setTick((n) => n + 1)
  }

  const onExportSelected = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!isTauri()) {
      setNotice('내보내기는 앱에서만 동작합니다.')
      return
    }
    try {
      const dir = await openDialog({ directory: true, multiple: false, title: '내보낼 폴더 선택' })
      if (typeof dir !== 'string') return
      let datePrefix = false
      try {
        datePrefix = (await getSettings()).filenameDatePrefix
      } catch {
        // 설정을 못 읽으면 프리픽스 없이 계속한다.
      }
      const result = await exportMarkdown(dir, datePrefix, ids)
      const skipped = result.skipped.length > 0 ? ` · 건너뜀 ${result.skipped.length}개` : ''
      setNotice(`${result.count}개를 내보냈습니다 · ${result.dir}${skipped}`)
    } catch (e) {
      setNotice(failureNotice('내보내기에 실패했습니다', e))
    }
  }

  const openMoveMenu = (e: MouseEvent, ids: string[]) => {
    if (ids.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    setMoveMenu({
      x: Math.min(rect.left, window.innerWidth - 180),
      y: Math.min(rect.bottom + 4, window.innerHeight - 90),
      ids,
    })
  }

  const moveTo = async (folderId: string | null) => {
    const ids = moveMenu?.ids ?? []
    setMoveMenu(null)
    if (ids.length === 0) return
    try {
      await moveNotesToFolder(ids, folderId)
    } catch (e) {
      setNotice(failureNotice('폴더로 이동하지 못했습니다', e))
      return
    }
    setSelectedIds(new Set())
    setTick((n) => n + 1)
  }

  const onNewFolder = async () => {
    const name = window.prompt('새 폴더 이름')
    if (!name || !name.trim()) return
    try {
      await createFolder(name.trim())
    } catch (e) {
      setNotice(failureNotice('폴더를 만들지 못했습니다', e))
      return
    }
    setTick((n) => n + 1)
  }

  const onRenameFolder = async (f: Folder) => {
    setFolderMenu(null)
    const name = window.prompt('폴더 이름', f.name)
    if (!name || !name.trim() || name.trim() === f.name) return
    try {
      await renameFolder(f.id, name.trim())
    } catch (e) {
      setNotice(failureNotice('폴더 이름을 바꾸지 못했습니다', e))
      return
    }
    setTick((n) => n + 1)
  }

  const onDeleteFolder = async (f: Folder) => {
    setFolderMenu(null)
    if (!window.confirm(`'${f.name}' 폴더를 삭제할까요? 메모는 미분류로 이동합니다.`)) return
    try {
      await deleteFolder(f.id)
    } catch (e) {
      setNotice(failureNotice('폴더를 삭제하지 못했습니다', e))
      return
    }
    if (selection === f.id) setSelection('all')
    setTick((n) => n + 1)
  }

  const isTrash = selection === 'trash'

  return (
    <div className="dark-window">
      <TitleBar title="모든 메모" strongTitle />

      {notice && (
        <div className="board__notice" role="alert">
          <span className="board__notice-text">{notice}</span>
          <button type="button" className="dark-btn" onClick={() => setNotice(null)}>
            닫기
          </button>
        </div>
      )}

      <div className="board__toolbar">
        <div className="board__search">
          <span className="board__search-icon" aria-hidden="true" />
          <input
            type="text"
            value={raw}
            placeholder="검색 · 태그 · [[백링크]]"
            aria-label="검색"
            spellCheck={false}
            onChange={(e) => setRaw(e.target.value)}
          />
        </div>

        {raw.trim() && <div className="board__result-count">{displayList.length}건</div>}

        <div className="board__sort">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              className="board__sort-btn"
              aria-pressed={sortKey === k}
              onClick={() => setSortKey(k)}
            >
              {SORT_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="board__spacer" />

        {selectedIds.size > 0 ? (
          <div className="board__selection">
            <span className="board__selection-count">{selectedIds.size}개 선택</span>
            {isTrash ? (
              <>
                <button type="button" className="dark-btn" onClick={() => void onRestoreSelected()}>
                  복원
                </button>
                <button
                  type="button"
                  className="dark-btn"
                  onClick={() => void onPermanentlyDeleteSelected()}
                >
                  영구 삭제
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="dark-btn"
                  onClick={(e) => openMoveMenu(e, Array.from(selectedIds))}
                >
                  폴더 이동
                </button>
                <button type="button" className="dark-btn" onClick={() => void onExportSelected()}>
                  내보내기
                </button>
                <button type="button" className="dark-btn" onClick={() => void onDeleteSelected()}>
                  삭제
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              className="board__new"
              title="새 메모"
              aria-label="새 메모"
              onClick={() => void createNote()}
            >
              <span aria-hidden="true">+</span>
              <span>새 메모</span>
            </button>
            <div className="board__status">
              <span className="board__status-dot" />
              <span>{footline}</span>
            </div>
          </>
        )}
      </div>

      <div className="board__layout">
        <aside className="board__sidebar">
          <div className="board__sidebar-scroll">
            <div className="mono-label">폴더</div>

            <div className="board__folder-row">
              <button
                type="button"
                className="board__folder-item"
                data-active={selection === 'all'}
                onClick={() => setSelection('all')}
              >
                <span className="board__folder-dot" aria-hidden="true" />
                <span className="board__folder-name">전체</span>
                <span className="board__folder-count">{counts.all}</span>
              </button>
            </div>

            <div className="board__folder-row">
              <button
                type="button"
                className="board__folder-item"
                data-active={selection === 'unfiled'}
                onClick={() => setSelection('unfiled')}
              >
                <span className="board__folder-dot" aria-hidden="true" />
                <span className="board__folder-name">미분류</span>
                <span className="board__folder-count">{counts.unfiled}</span>
              </button>
            </div>

            {folders.map((f) => (
              <div
                key={f.id}
                className="board__folder-row"
                onContextMenu={(e) => {
                  e.preventDefault()
                  setFolderMenu({
                    x: Math.min(e.clientX, window.innerWidth - 150),
                    y: Math.min(e.clientY, window.innerHeight - 90),
                    folder: f,
                  })
                }}
              >
                <button
                  type="button"
                  className="board__folder-item"
                  data-active={selection === f.id}
                  onClick={() => setSelection(f.id)}
                >
                  <span className="board__folder-dot" aria-hidden="true" />
                  <span className="board__folder-name">{f.name}</span>
                  <span className="board__folder-count">{counts.byFolder[f.id] ?? 0}</span>
                </button>
              </div>
            ))}

            <div className="board__sidebar-divider" />

            <div className="board__folder-row">
              <button
                type="button"
                className="board__folder-item board__folder-item--trash"
                data-active={selection === 'trash'}
                onClick={() => setSelection('trash')}
              >
                <span aria-hidden="true">🗑</span>
                <span className="board__folder-name">휴지통</span>
                <span className="board__folder-count">{counts.trash}</span>
              </button>
            </div>

            <button type="button" className="board__new-folder" onClick={() => void onNewFolder()}>
              <span aria-hidden="true">+</span>
              <span>새 폴더</span>
            </button>
          </div>
        </aside>

        <section className="board__main">
          {displayList.length === 0 ? (
            <div className="board__empty">
              {raw.trim() ? '조건에 맞는 메모가 없습니다' : isTrash ? '휴지통이 비어 있습니다' : '메모가 없습니다'}
            </div>
          ) : (
            <div className="board__list">
              {displayList.map((n) => (
                <div
                  key={n.id}
                  className={selectedIds.has(n.id) ? 'board__row board__row--selected' : 'board__row'}
                  onContextMenu={
                    isTrash
                      ? undefined
                      : (e) => {
                          e.preventDefault()
                          setMenu({
                            x: Math.min(e.clientX, window.innerWidth - 150),
                            y: Math.min(e.clientY, window.innerHeight - 90),
                            note: n,
                          })
                        }
                  }
                >
                  <label className="board__row-check">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(n.id)}
                      aria-label={`${n.title || '제목 없음'} 선택`}
                      onChange={() => toggleSelect(n.id)}
                    />
                  </label>

                  <span
                    className="board__row-stripe"
                    aria-hidden="true"
                    style={{ background: `var(${paletteOf(n.color).paperVar})` }}
                  />

                  <div className="board__row-main">
                    <div className="board__row-top">
                      <span className="board__row-title">{n.title || '제목 없음'}</span>
                      {n.open && (
                        <span className="board__badge board__badge--live">
                          <span className="board__badge-dot" aria-hidden="true" />
                          화면에 떠 있음
                        </span>
                      )}
                      {n.pinned && <span className="board__badge">핀</span>}
                      <span className="board__row-time">{formatRelative(n.updatedAt)}</span>
                    </div>
                    <div className="board__row-preview">{n.preview}</div>
                  </div>

                  <div className="board__row-actions">
                    {!isTrash &&
                      (n.open ? (
                        <button type="button" className="dark-btn" onClick={() => void closeNote(n.id)}>
                          닫기
                        </button>
                      ) : (
                        <button type="button" className="dark-btn" onClick={() => void openNote(n.id)}>
                          열기
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="board__footer">{footline}</div>
        </section>
      </div>

      {menu && (
        <div className="board__menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => void (menu.note.open ? closeNote(menu.note.id) : openNote(menu.note.id))}
          >
            {menu.note.open ? '닫기' : '열기'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              const ids = [menu.note.id]
              setMenu(null)
              openMoveMenu(e, ids)
            }}
          >
            폴더 이동
          </button>
          <button type="button" role="menuitem" onClick={() => void deleteNoteSingle(menu.note.id)}>
            삭제
          </button>
        </div>
      )}

      {moveMenu && (
        <div className="board__menu" style={{ left: moveMenu.x, top: moveMenu.y }} role="menu">
          <button type="button" role="menuitem" onClick={() => void moveTo(null)}>
            미분류
          </button>
          {folders.map((f) => (
            <button key={f.id} type="button" role="menuitem" onClick={() => void moveTo(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
      )}

      {folderMenu && (
        <div className="board__menu" style={{ left: folderMenu.x, top: folderMenu.y }} role="menu">
          <button type="button" role="menuitem" onClick={() => void onRenameFolder(folderMenu.folder)}>
            이름 바꾸기
          </button>
          <button type="button" role="menuitem" onClick={() => void onDeleteFolder(folderMenu.folder)}>
            삭제
          </button>
        </div>
      )}
    </div>
  )
}
