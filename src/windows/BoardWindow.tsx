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
import { failureNotice } from '../lib/errors'
import { formatRelative } from '../lib/time'
import {
  applyWindowBackdrop,
  EVENT_NOTES_CHANGED,
  EVENT_NOTE_META_CHANGED,
  focusNoteWindow,
  isTauri,
  listNotes,
  newNoteWindow,
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

/** 팔레트의 `name`은 내부 식별자다. 사용자에게 보이는 문자열은 한국어여야 한다 (CLAUDE.md 절대규칙 6). */
const COLOR_LABEL: Record<ColorIndex, string> = {
  0: '노랑',
  1: '분홍',
  2: '파랑',
  3: '초록',
  4: '보라',
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
  // 백엔드 호출 실패는 조용히 넘기지 않는다 (ipc 폴백 제거 · CLAUDE.md "흔한 함정")
  const [notice, setNotice] = useState<string | null>(null)
  const searchSeq = useRef(0)

  const parsed = useMemo(() => parseSearch(raw), [raw])

  const refreshStats = useCallback(() => {
    listNotes()
      .then((rows) => {
        setAll(rows)
        setNotice(null)
      })
      .catch((e) => setNotice(failureNotice('메모 목록을 불러오지 못했습니다', e)))
  }, [])

  // mica → acrylic → 불투명. 결과를 body에 실어 배경 규칙을 전환한다 (board.css).
  useEffect(() => {
    if (!isTauri()) return
    applyWindowBackdrop()
      .then((b) => {
        document.body.dataset.backdrop = b
      })
      .catch(() => {
        // 배경 효과는 폴백 체인의 마지막 단계(불투명)로 떨어뜨린다.
        // 사용자에게 알릴 일은 아니다 — 화면은 정상적으로 그려진다.
        document.body.dataset.backdrop = 'opaque'
      })
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
        .catch((e) => setNotice(failureNotice('검색에 실패했습니다', e)))
    }
    const t = window.setTimeout(run, parsed.term ? 180 : 0)
    return () => window.clearTimeout(t)
  }, [parsed.mode, parsed.term, colors, tick])

  // 다른 창에서 메모가 바뀌면 보드를 갱신한다.
  //
  // `sticky://notes-changed` 가 이 창의 생명선이다. 이게 없던 동안 보드는 처음 읽은
  // 목록을 끝까지 들고 있어서, 다른 창에서 메모를 만들거나 지워도 화면이 그대로였다
  // ("추가가 안 된다 / 삭제가 안 된다"로 보인 원인).
  //
  // 창 포커스에서도 한 번 더 읽는다 — 이벤트를 놓쳤거나 이 창이 열리기 전에 일어난
  // 변경까지 따라잡는 최후의 보루다.
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
    listen(EVENT_NOTE_META_CHANGED, bump).then(track).catch(() => {
      // 위 리스너가 이미 같은 사유로 실패했다 — 배너를 덮어쓰지 않는다.
    })

    window.addEventListener('focus', bump)
    return () => {
      disposed = true
      window.removeEventListener('focus', bump)
      disposers.forEach((un) => un())
    }
  }, [])

  // 우클릭 메뉴 닫기.
  //
  // 메뉴 **안쪽** 클릭은 target 으로 직접 걸러 낸다. 예전에는 메뉴 div 의
  // `onMouseDown` 에서 `stopPropagation()` 하는 데 기댔는데, 그러면 React 의 이벤트
  // 위임 경로(root 컨테이너)와 여기 window 리스너의 순서에 동작이 묶인다.
  // 항목을 누르자마자 메뉴가 닫혀 `열기`·`삭제` 가 먹지 않는 종류의 버그가 나오는 자리다.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onPointerDown = (e: Event) => {
      const target = e.target
      if (target instanceof Element && target.closest('.board__menu')) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const toggleColor = (c: ColorIndex) => {
    setColors((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
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
    // 창이 떴으면 `notes.open` 이 1이 됐다 — 카드의 점 색을 맞추려면 다시 읽어야 한다.
    setTick((n) => n + 1)
  }

  /** 보드에서 바로 새 메모. 백엔드가 메모를 만들면서 창까지 띄운다. */
  const createNote = async () => {
    try {
      await newNoteWindow()
    } catch (e) {
      setNotice(failureNotice('새 메모를 만들지 못했습니다', e))
      return
    }
    setTick((n) => n + 1)
  }

  const deleteNote = async (id: string) => {
    setMenu(null)
    try {
      await softDeleteNote(id)
    } catch (e) {
      // 실패했으면 목록에서 지우지 않는다 — 지워진 것처럼 보이면 안 된다
      setNotice(failureNotice('메모를 삭제하지 못했습니다', e))
      return
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

        <div className="board__filters">
          {PALETTE.map((p) => (
            <button
              key={p.index}
              type="button"
              className="board__chip"
              style={{ background: `var(${p.paperVar})` }}
              aria-pressed={colors.includes(p.index)}
              aria-label={`${COLOR_LABEL[p.index]} 색 필터`}
              title={`${COLOR_LABEL[p.index]} 색 필터`}
              onClick={() => toggleColor(p.index)}
            />
          ))}
        </div>

        <div className="board__spacer" />

        {/* 보드에서 메모를 만들 방법이 아예 없었다 — 트레이·단축키·다른 메모 창의
            `+` 를 거쳐야 했다. 툴바 오른쪽에 같은 동작을 둔다. */}
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
        <div className="board__menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button type="button" role="menuitem" onClick={() => void openNote(menu.note.id)}>
            열기
          </button>
          <button type="button" role="menuitem" onClick={() => void deleteNote(menu.note.id)}>
            삭제
          </button>
        </div>
      )}
    </div>
  )
}
