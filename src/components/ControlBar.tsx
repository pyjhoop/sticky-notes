/**
 * 메모 창 컨트롤 바 — 핀 · 투명도 슬라이더 · 색상 팝오버 · `+` · `✕`.
 *
 * 근거: design/Sticky Notes for Windows.dc.html 41~57행.
 * 높이 38px는 유휴 상태에서도 유지된다 (레이아웃 시프트 0) — 스타일은 `src/styles/note.css`.
 *
 * **소유: 트랙 C (M1).**
 */

import type { MouseEvent } from 'react'

import { OPACITY_MAX, OPACITY_MIN } from '../lib/palette'

export interface ControlBarProps {
  /** always-on-top */
  pinned: boolean
  /** 35..100 */
  opacity: number
  paletteOpen: boolean
  onTogglePin: () => void
  onOpacityChange: (value: number) => void
  onTogglePalette: () => void
  onNewNote: () => void
  onClose: () => void
  /** 바의 빈 영역 mousedown → `appWindow.startDragging()` */
  onDragStart: (e: MouseEvent<HTMLElement>) => void
}

export default function ControlBar({
  pinned,
  opacity,
  paletteOpen,
  onTogglePin,
  onOpacityChange,
  onTogglePalette,
  onNewNote,
  onClose,
  onDragStart,
}: ControlBarProps) {
  return (
    <div
      className="note-controls"
      onMouseDown={(e) => {
        // 버튼·슬라이더 위에서는 드래그를 시작하지 않는다.
        if (e.button === 0 && e.target === e.currentTarget) onDragStart(e)
      }}
    >
      <button
        type="button"
        className={`note-btn note-btn--pin${pinned ? ' is-on' : ''}`}
        title="항상 위에 고정"
        aria-pressed={pinned}
        onClick={onTogglePin}
      >
        <span className="note-pin-dot" />
      </button>

      <div className="note-opacity">
        <span className="note-opacity__label">OPACITY</span>
        <input
          type="range"
          className="note-opacity__range"
          min={OPACITY_MIN}
          max={OPACITY_MAX}
          value={opacity}
          aria-label="투명도"
          onChange={(e) => onOpacityChange(Number(e.target.value))}
        />
        <span className="note-opacity__value">{opacity}%</span>
      </div>

      <div style={{ display: 'flex', gap: 2, flex: 'none' }}>
        <button
          type="button"
          className="note-btn note-btn--color"
          title="색상"
          aria-expanded={paletteOpen}
          onClick={onTogglePalette}
        >
          <span className="note-swatch" />
        </button>
        <button type="button" className="note-btn note-btn--new" title="새 메모" onClick={onNewNote}>
          +
        </button>
        <button type="button" className="note-btn note-btn--close" title="닫기" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  )
}
