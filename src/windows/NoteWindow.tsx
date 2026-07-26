/**
 * 메모 창 — M0 스텁 겸 **리스크 스파이크 확인 화면**.
 *
 * **소유: 트랙 C (M1 · M4).** 트랙 C가 컨트롤 바·색상 팝오버·유휴 상태·
 * 드래그/리사이즈·Ctrl+Shift+휠을 채운다.
 *
 * M0에서 이 파일이 증명해야 하는 것 (plan.md M0 스파이크 1~4):
 *   1. 투명 + 프레임리스 + always-on-top 창에서 종이 루트의 CSS `opacity`가
 *      아티팩트 없이 보이는가                    → 컨트롤 바의 OPACITY 슬라이더
 *   2. `border-radius: 10px` 코너에 검은 테두리가 없는가
 *      → DWM 라운딩은 src-tauri/src/win.rs 가 창 생성 시 끈다
 *   3. `drop-shadow`가 사방 24px 투명 여백 안에서 잘리지 않는가
 *      → --note-margin
 *   4. 드래그/리사이즈 중 깜빡임
 *      → 컨트롤 바 드래그 + 우하단 그립
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import NoteEditor from '../components/NoteEditor'
import {
  clampOpacity,
  paletteStyle,
  PALETTE,
  OPACITY_MIN,
  OPACITY_MAX,
  OPACITY_STEP,
  type ColorIndex,
} from '../lib/palette'
import { getNote, isTauri, type Note } from '../lib/ipc'

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

async function startResizing() {
  if (!isTauri()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().startResizeDragging('SouthEast')
}

export default function NoteWindow({ noteId, opacityOverride }: NoteWindowProps) {
  const [note, setNote] = useState<Note | null>(null)
  const [body, setBody] = useState('')
  const [color, setColor] = useState<ColorIndex>(0)
  const [opacity, setOpacity] = useState(clampOpacity(opacityOverride ?? 96))
  const [pinned, setPinned] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    let alive = true
    getNote(noteId).then((n) => {
      if (!alive || !n) return
      setNote(n)
      setBody(n.body)
      setColor(n.color)
      if (opacityOverride === null) setOpacity(clampOpacity(n.opacity))
      setPinned(n.pinned)
    })
    return () => {
      alive = false
    }
  }, [noteId, opacityOverride])

  // 스파이크 확인용 — Ctrl+Shift+휠로 5%씩. 정식 구현은 M1(트랙 C).
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return
      e.preventDefault()
      setOpacity((v) => clampOpacity(v + (e.deltaY < 0 ? OPACITY_STEP : -OPACITY_STEP)))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  const rootStyle = useMemo(
    () => ({
      ...paletteStyle(color),
      '--note-opacity': String(opacity / 100),
    }),
    [color, opacity],
  )

  const onEditorChange = useCallback((v: string) => {
    setBody(v)
    // TODO(M2): 400ms 디바운스 → saveNote(id, body) → 푸터 `저장 중` → `저장됨 · HH:mm`
  }, [])

  return (
    <div
      style={{
        ...(rootStyle as React.CSSProperties),
        height: '100%',
        // 창 크기 = 종이 + 사방 24px 투명 여백.
        // 이 여백이 drop-shadow가 그려질 자리이자 네이티브 리사이즈 그랩 존이다.
        padding: 'var(--note-margin)',
      }}
    >
      {/* 그림자 + 투명도는 종이 래퍼에 건다. 창 자체가 아니다. */}
      <div
        style={{
          height: '100%',
          opacity: 'var(--note-opacity)' as unknown as number,
          filter: 'drop-shadow(var(--shadow-note))',
          transition: 'opacity var(--fade-duration) var(--fade-ease)',
        }}
      >
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            borderRadius: 'var(--radius-note)',
            overflow: 'hidden',
            background: 'var(--paper-bg)',
            border: '1px solid var(--paper-border)',
            color: 'var(--ink)',
          }}
        >
          {/* ── 컨트롤 바 ─────────────────────────────────── */}
          <div
            onMouseDown={(e) => {
              if (e.button === 0 && e.target === e.currentTarget) void startDragging()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 'var(--control-bar-h)',
              flex: 'none',
              padding: '0 8px 0 12px',
              background: 'var(--chrome-bg)',
              borderBottom: '1px solid var(--chrome-border)',
            }}
          >
            <button
              title="항상 위에 고정"
              onClick={() => setPinned((p) => !p)}
              style={{
                width: 'var(--control-btn)',
                height: 'var(--control-btn)',
                borderRadius: 'var(--radius-button)',
                display: 'grid',
                placeItems: 'center',
                background: pinned ? 'var(--pin-active-bg)' : 'transparent',
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: pinned ? 'var(--accent)' : 'var(--on-paper-ghost)',
                }}
              />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-mono-inline)',
                  letterSpacing: 'var(--ls-mono-inline)',
                  color: 'var(--on-paper-faint)',
                }}
              >
                OPACITY
              </span>
              <input
                type="range"
                min={OPACITY_MIN}
                max={OPACITY_MAX}
                value={opacity}
                onChange={(e) => setOpacity(clampOpacity(Number(e.target.value)))}
                style={{ flex: 1, height: 14 }}
              />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-mono-value)',
                  color: 'var(--on-paper)',
                  width: 30,
                  textAlign: 'right',
                }}
              >
                {opacity}%
              </span>
            </div>

            <div style={{ display: 'flex', gap: 2 }}>
              <button
                title="색상"
                onClick={() => setPaletteOpen((v) => !v)}
                style={{
                  width: 'var(--control-btn)',
                  height: 'var(--control-btn)',
                  borderRadius: 'var(--radius-button)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <span
                  style={{
                    width: 'var(--control-swatch)',
                    height: 'var(--control-swatch)',
                    borderRadius: 3,
                    background: 'var(--paper-bg)',
                    border: '1px solid var(--swatch-border-sm)',
                  }}
                />
              </button>
              <button
                title="새 메모"
                style={{
                  width: 'var(--control-btn)',
                  height: 'var(--control-btn)',
                  borderRadius: 'var(--radius-button)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 15,
                  lineHeight: 1,
                  color: 'var(--on-paper-mid)',
                }}
              >
                +
              </button>
              <button
                title="닫기"
                style={{
                  width: 'var(--control-btn)',
                  height: 'var(--control-btn)',
                  borderRadius: 'var(--radius-button)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 13,
                  lineHeight: 1,
                  color: 'var(--on-paper-mid)',
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* ── 색상 팔레트 팝오버 ─────────────────────────── */}
          {paletteOpen && (
            <div
              style={{
                position: 'absolute',
                right: 60,
                top: 40,
                zIndex: 5,
                display: 'flex',
                gap: 'var(--palette-gap)',
                padding: 'var(--palette-pad)',
                borderRadius: 'var(--radius-popover)',
                background: 'var(--popover-bg)',
                border: '1px solid var(--paper-border)',
                boxShadow: 'var(--shadow-popover)',
              }}
            >
              {PALETTE.map((p) => (
                <button
                  key={p.index}
                  title={p.name}
                  onClick={() => {
                    setColor(p.index)
                    setPaletteOpen(false)
                  }}
                  style={{
                    width: 'var(--palette-swatch)',
                    height: 'var(--palette-swatch)',
                    borderRadius: 'var(--radius-swatch)',
                    background: `var(${p.paperVar})`,
                    border: '1px solid var(--swatch-border)',
                    boxShadow: p.index === color ? '0 0 0 2px var(--accent)' : 'none',
                  }}
                />
              ))}
            </div>
          )}

          {/* ── 본문 ─────────────────────────────────────── */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              padding:
                'var(--note-body-pad-y) var(--note-body-pad-x) var(--note-body-pad-bottom)',
            }}
          >
            <NoteEditor value={body} onChange={onEditorChange} />
          </div>

          {/* ── 저장 푸터 ─────────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flex: 'none',
              padding: 'var(--footer-pad-y) var(--footer-pad-x)',
              background: 'var(--footer-bg)',
              borderTop: '1px solid var(--chrome-border)',
            }}
          >
            <span
              style={{
                width: 'var(--status-dot)',
                height: 'var(--status-dot)',
                borderRadius: '50%',
                background: 'var(--green-done)',
              }}
            />
            <span style={{ fontSize: 'var(--fs-small)', color: 'var(--on-paper)' }}>
              {note?.title ?? '제목 없음'}
            </span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-mono-value)',
                color: 'var(--on-paper-dim)',
              }}
            >
              {/* TODO(M2): 저장 상태 — `저장 중` / `저장됨 · HH:mm` */}
              저장됨
            </span>
          </div>

          {/* ── 리사이즈 그립 ─────────────────────────────── */}
          <div
            onMouseDown={(e) => {
              if (e.button === 0) void startResizing()
            }}
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              width: 'var(--grip-size)',
              height: 'var(--grip-size)',
              cursor: 'nwse-resize',
              background:
                'linear-gradient(135deg, rgba(0,0,0,0) 50%, var(--grip-color) 50%, var(--grip-color) 62%, rgba(0,0,0,0) 62%, rgba(0,0,0,0) 76%, var(--grip-color) 76%)',
            }}
          />
        </div>
      </div>
    </div>
  )
}
