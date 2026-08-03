/**
 * 색상 팝오버 — 6색 (2026-08-03 디자인 v2: 5색 → 6색, yellow/lime/mint/blue/lavender/white).
 *
 * 근거: design/StickyNote App.dc.html (버전 2) 74~80행 팔레트 팝오버.
 * 색은 `src/lib/palette.ts`의 `PALETTE`에서만 온다 (하드코딩 금지). `PALETTE.map`으로
 * 그리므로 배열 길이가 5→6으로 늘어난 것만으로 이 컴포넌트는 그대로 6개를 렌더한다 —
 * 로직 변경은 필요 없었다.
 *
 * **소유: 트랙 C (M1).**
 */

import { PALETTE, type ColorIndex } from '../lib/palette'

export interface ColorPaletteProps {
  /** 현재 선택된 팔레트 인덱스 0..5 */
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
