/**
 * 색상 팝오버 — 5색.
 *
 * 근거: design/Sticky Notes for Windows.dc.html 59~66행.
 * 색은 `src/lib/palette.ts`의 `PALETTE`에서만 온다 (하드코딩 금지).
 *
 * **소유: 트랙 C (M1).**
 */

import { PALETTE, type ColorIndex } from '../lib/palette'

export interface ColorPaletteProps {
  /** 현재 선택된 팔레트 인덱스 0..4 */
  value: ColorIndex
  onPick: (color: ColorIndex) => void
}

export default function ColorPalette({ value, onPick }: ColorPaletteProps) {
  return (
    <div className="note-palette" role="group" aria-label="메모 색상">
      {PALETTE.map((entry) => (
        <button
          type="button"
          key={entry.index}
          className={`note-palette__swatch${entry.index === value ? ' is-active' : ''}`}
          title={entry.name}
          aria-pressed={entry.index === value}
          style={{ background: `var(${entry.paperVar})` }}
          onClick={() => onPick(entry.index)}
        />
      ))}
    </div>
  )
}
