/**
 * 보드 창 (M5).
 *
 * 근거: design/Sticky Notes for Windows.dc.html line 155-195
 *   타이틀바(— ▢ ✕) · 검색 · 5색 필터 칩 · 4열 카드 그리드(132px)
 *
 * 디자인의 `● Vault 동기화 · 방금 전`은 v1에서 `메모 N개 · 마지막 수정 …`이고,
 * 카드 메타 `동기화됨`/`로컬 전용`은 상대 수정 시각이다 (plan.md "디자인 대비 변경점").
 *
 * **소유: 트랙 D (M5).**
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import TitleBar from '../components/TitleBar'
import { PALETTE, type ColorIndex } from '../lib/palette'
import { formatRelative } from '../lib/time'
import {
  applyWindowBackdrop,
  EVENT_NOTE_META_CHANGED,
  focusNoteWindow,
  isTauri,
  listNotes,
  openNoteWindow,
  searchNotes,
  softDeleteNote,
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

interface ContextMenu {
  x: number
  y: number
  note: NoteSummary
}

export default function BoardWindow() {
  const [results, setResults] = useState<NoteSummary[]>([])
  const [all, setAll] = useState<NoteSummary[]>([])
  const [raw, setRaw] = useState('')
  const [colors, setColors] = useState<ColorIndex[]>([])
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [tick, setTick] = useState(0)
  const searchSeq = useRef(0)

  const parsed = useMemo(() => parseSearch(raw), [raw])

  const refreshStats = useCallback(() => {
    listNotes()
      .then(setAll)
      .catch((e) => console.warn('[board] list_notes 실패', e))
  }, [])

  // mica → acrylic → 불투명. 결과를 body에 실어 배경 규칙을 전환한다 (board.css).
  useEffect(() => {
    if (!isTauri()) return
    applyWindowBackdrop()
      .then((b) => {
        document.body.dataset.backdrop = b
      })
      .catch((e) => console.warn('[board] apply_window_backdrop 실패', e))
  }, [])

  useEffect(refreshStats, [refreshStats, tick])

  // 검색 — 입력 180ms 디바운스. 늦게 온 응답이 최신 결과를 덮지 않게 시퀀스로 막는다.
  useEffect(() => {
    const seq = ++searchSeq.current
    const run = () => {
      searchNotes({ mode: parsed.mode, term: parsed.term, colors })
        .then((rows) => {
          if (seq === searchSeq.current) setResults(rows)
        })
        .catch((e) => console.warn('[board] search_notes 실패', e))
    }
    const t = window.setTimeout(run, parsed.term ? 180 : 0)
    return () => window.clearTimeout(t)
  }, [parsed.mode, parsed.term, colors, tick])

  // 다른 창에서 메모가 바뀌면 보드를 갱신한다.
  useEffect(() => {
    if (!isTauri()) return
    let dispose: (() => void) | undefined
    listen(EVENT_NOTE_META_CHANGED, () => setTick((n) => n + 1))
      .then((un) => {
        dispose = un
      })
      .catch((e) => console.warn('[board] 이벤트 구독 실패', e))
    return () => dispose?.()
  }, [])

  // 우클릭 메뉴 닫기
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const toggleColor = (c: ColorIndex) => {
    setColors((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  const openNote = async (id: string) => {
    try {
      await openNoteWindow(id)
      await focusNoteWindow(id)
    } catch (e) {
      console.warn('[board] 메모 창 열기 실패', e)
    }
  }

  const deleteNote = async (id: string) => {
    setMenu(null)
    try {
      await softDeleteNote(id)
    } catch (e) {
      console.warn('[board] soft_delete_note 실패', e)
    }
    setResults((prev) => prev.filter((n) => n.id !== id))
    setTick((n) => n + 1)
  }

  // 헤더 — 디자인의 동기화 문구 자리 (plan.md "디자인 대비 변경점")
  const lastUpdated = useMemo(() => {
    if (all.length === 0) return null
    return all.reduce((max, n) => (n.updatedAt > max ? n.updatedAt : max), all[0].updatedAt)
  }, [all])

  const headline = lastUpdated
    ? `메모 ${all.length}개 · 마지막 수정 ${formatRelative(lastUpdated)}`
    : `메모 ${all.length}개`

  return (
    <div className="dark-window">
      <TitleBar title="모든 메모" strongTitle />

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

        <div className="board__filters">
          {PALETTE.map((p) => (
            <button
              key={p.index}
              type="button"
              className="board__chip"
              style={{ background: `var(${p.paperVar})` }}
              aria-pressed={colors.includes(p.index)}
              aria-label={`${p.name} 색 필터`}
              title={`${p.name} 색 필터`}
              onClick={() => toggleColor(p.index)}
            />
          ))}
        </div>

        <div className="board__spacer" />

        <div className="board__status">
          <span className="board__status-dot" />
          <span>{headline}</span>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="board__empty">
          {raw.trim() || colors.length > 0 ? '조건에 맞는 메모가 없습니다' : '메모가 없습니다'}
        </div>
      ) : (
        <div className="board__grid">
          {results.map((n) => (
            <button
              key={n.id}
              type="button"
              className="board__card"
              style={{ background: `var(--paper-${n.color})` }}
              onClick={() => void openNote(n.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({
                  x: Math.min(e.clientX, window.innerWidth - 150),
                  y: Math.min(e.clientY, window.innerHeight - 90),
                  note: n,
                })
              }}
            >
              <div className="board__card-title">{n.title || '제목 없음'}</div>
              <div className="board__card-preview">{n.preview}</div>
              <div className="board__card-meta">
                {/* 디자인의 동기화 점 자리 — v1에서는 "창이 떠 있는가" */}
                <span
                  className="board__card-dot"
                  style={{ background: n.open ? 'var(--green-done)' : 'var(--on-paper-ghost)' }}
                />
                <span>{formatRelative(n.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {menu && (
        <div
          className="board__menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => void openNote(menu.note.id)}>
            열기
          </button>
          <button type="button" onClick={() => void deleteNote(menu.note.id)}>
            삭제
          </button>
        </div>
      )}
    </div>
  )
}
