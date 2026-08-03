/**
 * 메모 창 컨트롤 바 — 핀 · 투명도 슬라이더 · 색상 팝오버 · `+` · `✕`.
 *
 * 근거: design/StickyNote App.dc.html (버전 2) N-03 · 호버 툴바 예시(56~84행).
 * 높이 32px(2026-08-03 v2: 38px→32px)는 유휴 상태에서도 유지된다 (레이아웃 시프트 0)
 * — 스타일은 `src/styles/note.css`.
 *
 * **소유: 트랙 C (M1) · 2026-08-03 2단계는 A트랙이 시각만 리스킨.**
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
  /** 슬라이더를 잡았다 — 조절이 끝날 때까지 투명도 미리보기를 유지한다 */
  onOpacityHoldStart: () => void
  /** 슬라이더를 놓았다 */
  onOpacityHoldEnd: () => void
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
  onOpacityHoldStart,
  onOpacityHoldEnd,
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
        //
        // 예전엔 `e.target === e.currentTarget`(바 자신)만 통과시켰다. 그러면 실제
        // 드래그 가능한 영역이 컨트롤 사이 틈뿐이라 창을 잡기가 어렵다. 종이 본문이
        // 커서 배치로 바뀌면서(NoteWindow) 이 바가 주된 이동 손잡이가 됐으므로,
        // **상호작용 요소가 아닌 곳은 전부** 드래그로 친다 (`OPACITY` 레이블·`96%` 값 포함).
        if (e.button !== 0) return
        const target = e.target as HTMLElement
        if (target.closest('button, input, a, [role="button"]')) return
        onDragStart(e)
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
          // 잡고 있는 동안은 값이 안 변해도 미리보기를 유지한다.
          // range 입력은 pointerdown에서 포인터를 캡처하므로 pointerup도 이 요소로 온다.
          onPointerDown={onOpacityHoldStart}
          onPointerUp={onOpacityHoldEnd}
          onPointerCancel={onOpacityHoldEnd}
          onLostPointerCapture={onOpacityHoldEnd}
          // 키보드 조작(←/→)은 onChange → 타이머 경로를 탄다. 포커스가 빠지면 잡은 상태를 푼다.
          onBlur={onOpacityHoldEnd}
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
