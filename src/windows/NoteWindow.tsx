/**
 * 메모 창 — 프레임리스 종이 + 컨트롤 바 + 저장 푸터.
 *
 * 근거: design/Sticky Notes for Windows.dc.html 37~121행 · 264~268행(유휴).
 *
 * M0 스파이크 결론(확정)대로 구현한다:
 *   투명도      CSS opacity — **종이 루트 엘리먼트**에 건다. 창 자체가 아니다
 *   라운드 코너  CSS border-radius 10px + DWMWA_WINDOW_CORNER_PREFERENCE=DONOTROUND
 *   그림자      **폐기.** 창 = 종이, 사방 여백 0 (2026-07-26 사용자 지시 · note.css 머리말)
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
import { failureNotice } from '../lib/errors'
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
/**
 * 투명도 미리보기 유지 시간 — 마지막 변경 이후.
 *
 * autoFade가 켜져 있으면 포커스된 창은 항상 100%다. 그런데 슬라이더를 잡거나
 * `Ctrl+Shift+휠`을 굴리는 순간에도 창은 **포커스 상태**라 목표값이 화면에 반영되지
 * 않고, 포커스를 잃어야 비로소 보였다(사용자 신고). 조절 중에는 autoFade override를
 * 건너뛰어 목표값을 즉시 보여주고, 조절이 끝나면 이 시간 뒤에 autoFade 규칙으로
 * 돌아간다(복귀도 `--transition-fade` 180ms를 그대로 탄다).
 */
const OPACITY_PREVIEW_MS = 1000

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
  // 백엔드 호출 실패 — 조용히 넘기지 않는다 (ipc 폴백 제거 · CLAUDE.md "흔한 함정")
  const [error, setError] = useState<string | null>(null)

  // ── 투명도 미리보기 ─────────────────────────────────────
  // held   : 슬라이더를 잡고 있는 동안 (pointerdown ~ pointerup/cancel)
  // recent : 마지막 변경 후 OPACITY_PREVIEW_MS 동안 (키보드 조작 · Ctrl+Shift+휠)
  // 둘 중 하나라도 참이면 autoFade override를 건너뛰고 목표값을 그대로 보여준다.
  const [opacityHeld, setOpacityHeld] = useState(false)
  const [opacityRecent, setOpacityRecent] = useState(false)
  const previewTimer = useRef<number | null>(null)

  const markOpacityAdjusted = useCallback(() => {
    setOpacityRecent(true)
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null
      setOpacityRecent(false)
    }, OPACITY_PREVIEW_MS)
  }, [])

  useEffect(
    () => () => {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
    },
    [],
  )

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
      setError(null)
    } catch (e) {
      // 저장 실패는 `저장 중`(노랑)으로 남기고 배너로도 알린다.
      // 푸터 점만으로는 "느린 저장"과 구분되지 않는다.
      dirtyRef.current = true
      setError(failureNotice('저장하지 못했습니다', e))
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
        setNoteMeta(noteId, next).catch((e) =>
          setError(failureNotice('색·투명도를 저장하지 못했습니다', e)),
        )
      }, META_DEBOUNCE_MS)
    },
    [noteId],
  )

  // ── 초기 로드 ───────────────────────────────────────────
  useEffect(() => {
    let alive = true
    getNote(noteId)
      .then((note) => {
        if (!alive) return
        if (!note) {
          setError(`메모를 찾을 수 없습니다 — id: ${noteId}`)
          return
        }
        setBody(note.body)
        bodyRef.current = note.body
        setTitle(note.title)
        setColor(normalizeColor(note.color))
        if (opacityOverride === null) setOpacity(clampOpacity(note.opacity))
        setPinned(note.pinned)
        setSavedAt(new Date(note.updatedAt))
      })
      .catch((e) => {
        if (alive) setError(failureNotice('메모를 불러오지 못했습니다', e))
      })
    getSettings()
      .then((s) => {
        if (alive) setAutoFade(s.autoFade)
      })
      .catch((e) => {
        if (alive) setError(failureNotice('설정을 불러오지 못했습니다', e))
      })
    // 단축키 등록 실패는 조용히 넘기지 않는다 (M4 DoD · CLAUDE.md "흔한 함정")
    getShortcutFailures()
      .then((f) => {
        if (alive) setFailures(f)
      })
      .catch((e) => {
        if (alive) setError(failureNotice('단축키 상태를 확인하지 못했습니다', e))
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
      // 휠은 pointerup이 없다 — 마지막 변경 기준 타이머만으로 미리보기를 유지한다.
      markOpacityAdjusted()
      setOpacity((prev) => {
        const next = clampOpacity(prev + (e.deltaY < 0 ? OPACITY_STEP : -OPACITY_STEP))
        if (next !== prev) pushMeta({ opacity: next })
        return next
      })
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [markOpacityAdjusted, pushMeta])

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
      setNoteAlwaysOnTop(noteId, next).catch((e) =>
        setError(failureNotice('항상 위 설정을 바꾸지 못했습니다', e)),
      )
      pushMeta({ pinned: next })
      return next
    })
  }, [noteId, pushMeta])

  const onOpacityChange = useCallback(
    (value: number) => {
      const next = clampOpacity(value)
      markOpacityAdjusted()
      setOpacity(next)
      pushMeta({ opacity: next })
    },
    [markOpacityAdjusted, pushMeta],
  )

  // 슬라이더를 잡고 있는 동안은 값이 안 바뀌어도 미리보기를 유지한다
  // (드래그가 길어져 타이머가 만료되면 화면이 100%로 튀어 오른다).
  const onOpacityHoldStart = useCallback(() => {
    setOpacityHeld(true)
    markOpacityAdjusted()
  }, [markOpacityAdjusted])

  const onOpacityHoldEnd = useCallback(() => {
    setOpacityHeld(false)
    markOpacityAdjusted()
  }, [markOpacityAdjusted])

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
      try {
        // 백엔드가 메모를 만들면서 창까지 띄운다.
        await newNoteWindow(color)
      } catch (e) {
        setError(failureNotice('새 메모를 만들지 못했습니다', e))
      }
    })()
  }, [color])

  const onClose = useCallback(() => {
    void (async () => {
      await flushRef.current()
      try {
        await closeNoteWindow(noteId)
      } catch (e) {
        setError(failureNotice('창을 닫지 못했습니다', e))
      }
    })()
  }, [noteId])

  const onDragStart = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault()
    void startDragging()
  }, [])

  // ── 렌더 ────────────────────────────────────────────────
  // autoFade OFF                → 항상 note.opacity (원래 경로, 손대지 않는다)
  // autoFade ON + 조절 중        → 목표값을 즉시 보여준다 (미리보기)
  // autoFade ON + 그 외 · 포커스 → 100%
  const adjustingOpacity = opacityHeld || opacityRecent
  const effectiveOpacity = autoFade && focused && !adjustingOpacity ? 100 : opacity

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
      {/* 리사이즈 그랩 존 — 종이 가장자리 안쪽 6px(코너 8px). 여백은 없앴다 (note.css 머리말) */}
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

      {/* 투명도는 종이 래퍼에 건다. 창 자체가 아니다. */}
      <div className="note-fade">
        <div className="note-paper">
          <ControlBar
            pinned={pinned}
            opacity={opacity}
            paletteOpen={paletteOpen}
            onTogglePin={onTogglePin}
            onOpacityChange={onOpacityChange}
            onOpacityHoldStart={onOpacityHoldStart}
            onOpacityHoldEnd={onOpacityHoldEnd}
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

          {error && (
            <div className="note-alert note-alert--error" role="alert">
              <span className="note-alert__dot" />
              <span className="note-alert__text">{error}</span>
              <button
                type="button"
                className="note-alert__dismiss"
                onClick={() => setError(null)}
              >
                닫기
              </button>
            </div>
          )}

          {showAlert && (
            <div className="note-alert" role="alert">
              <span className="note-alert__dot" />
              <span className="note-alert__text">
                {failures.some((f) => !f.registered)
                  ? '전역 단축키를 등록하지 못했습니다. 다른 앱이 사용 중일 수 있습니다.'
                  : '저장된 단축키를 쓸 수 없어 기본값으로 되돌렸습니다.'}
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
