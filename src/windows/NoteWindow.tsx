/**
 * 메모 창 — 프레임리스 종이 + 컨트롤 바 + 저장 푸터.
 *
 * 근거: design/Sticky Notes for Windows.dc.html 37~121행 · 264~268행(유휴).
 *
 * M0 스파이크 결론(확정)대로 구현한다:
 *   투명도      CSS opacity — **종이 루트 엘리먼트**에 건다. 창 자체가 아니다
 *   라운드 코너  CSS border-radius 10px + DWMWA_WINDOW_CORNER_PREFERENCE=DONOTROUND
 *   그림자      CSS drop-shadow + 사방 24px 투명 여백
 * 네이티브 폴백(`setWindowOpacity`)은 존재하지만 쓰지 않는다.
 *
 * **소유: 트랙 C (M1 · M4).**
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

import ColorPalette from '../components/ColorPalette'
import ControlBar from '../components/ControlBar'
import NoteEditor from '../components/NoteEditor'
import SaveFooter, { type SaveStatus } from '../components/SaveFooter'
import {
  clampOpacity,
  normalizeColor,
  paletteStyle,
  OPACITY_STEP,
  type ColorIndex,
} from '../lib/palette'
import {
  closeNoteWindow,
  getNote,
  getSettings,
  getShortcutFailures,
  isTauri,
  newNoteWindow,
  openNoteWindow,
  saveNote,
  setNoteAlwaysOnTop,
  setNoteMeta,
  EVENT_NOTE_META_CHANGED,
  EVENT_SAVE_ALL,
  type NoteMeta,
  type ShortcutBinding,
} from '../lib/ipc'

import '../styles/note.css'

/** 본문 저장 디바운스 */
const SAVE_DEBOUNCE_MS = 400
/** 메타(색·투명도·핀) 저장 디바운스 — 슬라이더가 초당 수십 번 바뀐다 */
const META_DEBOUNCE_MS = 300

/** `startResizeDragging()`이 받는 8방향. */
type ResizeDir =
  | 'North'
  | 'South'
  | 'East'
  | 'West'
  | 'NorthEast'
  | 'NorthWest'
  | 'SouthEast'
  | 'SouthWest'

const RESIZE_EDGES: ReadonlyArray<{ dir: ResizeDir; cls: string }> = [
  { dir: 'North', cls: 'n' },
  { dir: 'South', cls: 's' },
  { dir: 'West', cls: 'w' },
  { dir: 'East', cls: 'e' },
  { dir: 'NorthWest', cls: 'nw' },
  { dir: 'NorthEast', cls: 'ne' },
  { dir: 'SouthWest', cls: 'sw' },
  { dir: 'SouthEast', cls: 'se' },
]

interface NoteWindowProps {
  noteId: string
  /** `?opacity=35` — 스파이크 확인용 초기값 강제 */
  opacityOverride: number | null
}

async function startDragging() {
  if (!isTauri()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().startDragging()
}

async function startResizing(direction: ResizeDir) {
  if (!isTauri()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().startResizeDragging(direction)
}

export default function NoteWindow({ noteId, opacityOverride }: NoteWindowProps) {
  const [body, setBody] = useState('')
  const [title, setTitle] = useState('')
  const [color, setColor] = useState<ColorIndex>(0)
  const [opacity, setOpacity] = useState(clampOpacity(opacityOverride ?? 96))
  const [pinned, setPinned] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [autoFade, setAutoFade] = useState(true)
  const [focused, setFocused] = useState(true)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [failures, setFailures] = useState<ShortcutBinding[]>([])
  const [alertDismissed, setAlertDismissed] = useState(false)

  // ── 본문 저장 (400ms 디바운스 + 강제 flush) ─────────────
  const bodyRef = useRef('')
  const dirtyRef = useRef(false)
  const saveTimer = useRef<number | null>(null)

  const flush = useCallback(async () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (!dirtyRef.current) return
    dirtyRef.current = false
    setStatus('saving')
    try {
      const result = await saveNote(noteId, bodyRef.current)
      setTitle(result.title)
      setSavedAt(new Date(result.updatedAt))
      setStatus('saved')
    } catch (e) {
      // 저장 실패는 `저장 중`(노랑)으로 남겨 사용자가 알아챌 수 있게 한다.
      dirtyRef.current = true
      console.error('[note] 저장 실패', e)
    }
  }, [noteId])

  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  const onEditorChange = useCallback((value: string) => {
    setBody(value)
    bodyRef.current = value
    dirtyRef.current = true
    setStatus('saving')
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void flushRef.current()
    }, SAVE_DEBOUNCE_MS)
  }, [])

  // ── 메타 저장 (색 · 투명도 · 핀) ─────────────────────────
  const metaTimer = useRef<number | null>(null)
  const pendingMeta = useRef<NoteMeta>({})

  const pushMeta = useCallback(
    (meta: NoteMeta) => {
      pendingMeta.current = { ...pendingMeta.current, ...meta }
      if (metaTimer.current !== null) window.clearTimeout(metaTimer.current)
      metaTimer.current = window.setTimeout(() => {
        const next = pendingMeta.current
        pendingMeta.current = {}
        void setNoteMeta(noteId, next)
      }, META_DEBOUNCE_MS)
    },
    [noteId],
  )

  // ── 초기 로드 ───────────────────────────────────────────
  useEffect(() => {
    let alive = true
    void getNote(noteId).then((note) => {
      if (!alive || !note) return
      setBody(note.body)
      bodyRef.current = note.body
      setTitle(note.title)
      setColor(normalizeColor(note.color))
      if (opacityOverride === null) setOpacity(clampOpacity(note.opacity))
      setPinned(note.pinned)
      setSavedAt(new Date(note.updatedAt))
    })
    void getSettings().then((s) => {
      if (alive) setAutoFade(s.autoFade)
    })
    // 단축키 등록 실패는 조용히 넘기지 않는다 (M4 DoD · CLAUDE.md "흔한 함정")
    void getShortcutFailures().then((f) => {
      if (alive) setFailures(f)
    })
    return () => {
      alive = false
    }
  }, [noteId, opacityOverride])

  // ── Ctrl+Shift+휠 → 투명도 5%씩, 35/100 클램프 ───────────
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return
      e.preventDefault()
      setOpacity((prev) => {
        const next = clampOpacity(prev + (e.deltaY < 0 ? OPACITY_STEP : -OPACITY_STEP))
        if (next !== prev) pushMeta({ opacity: next })
        return next
      })
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [pushMeta])

  // ── 포커스/블러 ─────────────────────────────────────────
  // autoFade OFF → 항상 note.opacity
  // autoFade ON  → 포커스 시 100%, 블러 시 note.opacity (transition 180ms ease-out)
  useEffect(() => {
    if (!isTauri()) {
      const onFocus = () => setFocused(true)
      const onBlur = () => {
        setFocused(false)
        void flushRef.current()
      }
      window.addEventListener('focus', onFocus)
      window.addEventListener('blur', onBlur)
      return () => {
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('blur', onBlur)
      }
    }
    let unlisten: (() => void) | null = null
    let disposed = false
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const un = await getCurrentWindow().onFocusChanged(({ payload }) => {
        setFocused(payload)
        // 창 블러 시 강제 flush
        if (!payload) void flushRef.current()
      })
      if (disposed) un()
      else unlisten = un
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  // ── 트레이 "모든 메모 저장" + 전역 핀 토글 ────────────────
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    const unlisteners: Array<() => void> = []
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const a = await listen(EVENT_SAVE_ALL, () => {
        void flushRef.current()
      })
      const b = await listen<{ id: string | null; pinned: boolean | null }>(
        EVENT_NOTE_META_CHANGED,
        (e) => {
          const p = e.payload
          if (p.id !== null && p.id !== noteId) return
          if (p.pinned !== null) setPinned(p.pinned)
        },
      )
      if (disposed) {
        a()
        b()
      } else {
        unlisteners.push(a, b)
      }
    })
    return () => {
      disposed = true
      unlisteners.forEach((un) => un())
    }
  }, [noteId])

  // ── 창 종료 시 강제 flush ────────────────────────────────
  useEffect(() => {
    const onUnload = () => {
      void flushRef.current()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      onUnload()
    }
  }, [])

  // ── 컨트롤 핸들러 ───────────────────────────────────────
  const onTogglePin = useCallback(() => {
    setPinned((prev) => {
      const next = !prev
      void setNoteAlwaysOnTop(noteId, next).catch(() => undefined)
      pushMeta({ pinned: next })
      return next
    })
  }, [noteId, pushMeta])

  const onOpacityChange = useCallback(
    (value: number) => {
      const next = clampOpacity(value)
      setOpacity(next)
      pushMeta({ opacity: next })
    },
    [pushMeta],
  )

  const onPickColor = useCallback(
    (next: ColorIndex) => {
      setColor(next)
      setPaletteOpen(false)
      pushMeta({ color: next })
    },
    [pushMeta],
  )

  const onNewNote = useCallback(() => {
    void (async () => {
      const id = await newNoteWindow(color)
      // 백엔드가 창까지 띄우면 두 번째 호출은 포커스만 준다 (멱등).
      await openNoteWindow(id).catch(() => undefined)
    })()
  }, [color])

  const onClose = useCallback(() => {
    void (async () => {
      await flushRef.current()
      await closeNoteWindow(noteId).catch(() => undefined)
    })()
  }, [noteId])

  const onDragStart = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault()
    void startDragging()
  }, [])

  // ── 렌더 ────────────────────────────────────────────────
  const effectiveOpacity = autoFade && focused ? 100 : opacity

  const rootStyle = useMemo(
    () =>
      ({
        ...paletteStyle(color),
        '--note-opacity': String(effectiveOpacity / 100),
      }) as React.CSSProperties,
    [color, effectiveOpacity],
  )

  const showAlert = failures.length > 0 && !alertDismissed

  return (
    <div className={`note-root${paletteOpen ? ' is-palette-open' : ''}`} style={rootStyle}>
      {/* 투명 여백 = 네이티브 리사이즈 그랩 존 */}
      {RESIZE_EDGES.map(({ dir, cls }) => (
        <div
          key={cls}
          className={`note-resize note-resize--${cls}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            void startResizing(dir)
          }}
        />
      ))}

      {/* 그림자 + 투명도는 종이 래퍼에 건다. 창 자체가 아니다. */}
      <div className="note-shadow">
        <div className="note-paper">
          <ControlBar
            pinned={pinned}
            opacity={opacity}
            paletteOpen={paletteOpen}
            onTogglePin={onTogglePin}
            onOpacityChange={onOpacityChange}
            onTogglePalette={() => setPaletteOpen((v) => !v)}
            onNewNote={onNewNote}
            onClose={onClose}
            onDragStart={onDragStart}
          />

          {paletteOpen && <ColorPalette value={color} onPick={onPickColor} />}

          <div
            className="note-body"
            onMouseDown={(e) => {
              // 종이 배경(본문 패딩) mousedown → 창 드래그
              if (e.button === 0 && e.target === e.currentTarget) onDragStart(e)
            }}
          >
            <NoteEditor value={body} onChange={onEditorChange} />
          </div>

          {showAlert && (
            <div className="note-alert" role="alert">
              <span className="note-alert__dot" />
              <span className="note-alert__text">
                전역 단축키를 등록하지 못했습니다. 다른 앱이 사용 중일 수 있습니다.
                <span className="note-alert__keys">
                  {failures.map((f) => f.accelerator).join(' · ')}
                </span>
              </span>
              <button
                type="button"
                className="note-alert__dismiss"
                onClick={() => setAlertDismissed(true)}
              >
                닫기
              </button>
            </div>
          )}

          <SaveFooter
            title={title}
            status={status}
            savedAt={savedAt}
            onDragStart={onDragStart}
          />

          <div
            className="note-grip"
            onMouseDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault()
              void startResizing('SouthEast')
            }}
          />
        </div>
      </div>
    </div>
  )
}
