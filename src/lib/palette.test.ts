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
  it('디자인의 5색 순서를 그대로 유지한다 (DB notes.color 인덱스)', () => {
    expect(PALETTE.map((p) => p.paper)).toEqual([
      '#FFEFA8',
      '#FBD3DE',
      '#CFE4F7',
      '#D9EFCF',
      '#E4DAF6',
    ])
    expect(PALETTE.map((p) => p.chrome)).toEqual([
      '#F7E496',
      '#F3C4D2',
      '#BED8F1',
      '#CAE6BE',
      '#D7C9F1',
    ])
  })

  it('범위를 벗어난 색 인덱스는 0으로 떨어진다', () => {
    expect(normalizeColor(-1)).toBe(0)
    expect(normalizeColor(5)).toBe(0)
    expect(normalizeColor(null)).toBe(0)
    expect(normalizeColor(undefined)).toBe(0)
    expect(normalizeColor(3)).toBe(3)
  })

  it('paletteStyle이 종이/크롬 CSS 변수를 내보낸다', () => {
    expect(paletteStyle(2)).toEqual({ '--paper-bg': '#CFE4F7', '--chrome-bg': '#BED8F1' })
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
