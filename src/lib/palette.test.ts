import { describe, expect, it } from 'vitest'

import {
  clampOpacity,
  normalizeColor,
  paletteOf,
  paletteStyle,
  OPACITY_MAX,
  OPACITY_MIN,
  PALETTE,
} from './palette'

describe('팔레트', () => {
  it('디자인 v2의 6색 순서를 그대로 유지한다 (DB notes.color 인덱스)', () => {
    expect(PALETTE.map((p) => p.name)).toEqual([
      'yellow',
      'lime',
      'mint',
      'blue',
      'lavender',
      'white',
    ])
    expect(PALETTE.map((p) => p.paper)).toEqual([
      'oklch(0.935 0.075 95)',
      'oklch(0.93 0.06 130)',
      'oklch(0.93 0.05 195)',
      'oklch(0.925 0.05 265)',
      'oklch(0.925 0.05 320)',
      'oklch(0.965 0.004 90)',
    ])
    expect(PALETTE.map((p) => p.chrome)).toEqual([
      'oklch(0.97 0.045 95 / 0.85)',
      'oklch(0.965 0.036 130 / 0.85)',
      'oklch(0.965 0.03 195 / 0.85)',
      'oklch(0.96 0.03 265 / 0.85)',
      'oklch(0.96 0.03 320 / 0.85)',
      'oklch(0.99 0.002 90 / 0.85)',
    ])
  })

  it('범위를 벗어난 색 인덱스는 0으로 떨어진다', () => {
    expect(normalizeColor(-1)).toBe(0)
    expect(normalizeColor(6)).toBe(0)
    expect(normalizeColor(null)).toBe(0)
    expect(normalizeColor(undefined)).toBe(0)
    expect(normalizeColor(3)).toBe(3)
  })

  it('6번째 색(white, 인덱스 5)까지 유효한 범위다', () => {
    expect(normalizeColor(5)).toBe(5)
    expect(paletteOf(5).name).toBe('white')
  })

  it('paletteStyle이 종이/크롬/그림자 CSS 변수를 내보낸다', () => {
    expect(paletteStyle(2)).toEqual({
      '--paper-bg': 'oklch(0.93 0.05 195)',
      '--chrome-bg': 'oklch(0.965 0.03 195 / 0.85)',
      '--shadow-note': 'var(--shadow-paper-2)',
    })
  })

  it('paletteOf는 항상 엔트리를 돌려준다', () => {
    expect(paletteOf(99).name).toBe('yellow')
  })
})

describe('투명도', () => {
  it('35~100으로 클램프된다', () => {
    expect(clampOpacity(0)).toBe(OPACITY_MIN)
    expect(clampOpacity(200)).toBe(OPACITY_MAX)
    expect(clampOpacity(70)).toBe(70)
  })

  it('숫자가 아니면 기본값으로 떨어진다', () => {
    expect(clampOpacity(Number.NaN)).toBe(96)
  })
})
