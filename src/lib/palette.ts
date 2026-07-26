/**
 * 메모 팔레트 — 인덱스 0..4 ↔ 종이/크롬 색.
 *
 * 근거: design/Sticky Notes for Windows.dc.html 의 `get colors()`.
 * DB의 `notes.color`가 이 배열의 인덱스다. **순서를 바꾸면 기존 데이터가 어긋난다.**
 *
 * 색 값 자체는 `src/styles/tokens.css`의 `--paper-N` / `--chrome-N`과 동일하다.
 * 컴포넌트는 가급적 CSS 변수를 쓰고, 여기 값은 인라인 스타일이 불가피할 때만 쓴다.
 */

export type ColorIndex = 0 | 1 | 2 | 3 | 4

export interface PaletteEntry {
  /** 팔레트 인덱스 */
  index: ColorIndex
  /** 내부 식별자 */
  name: 'yellow' | 'pink' | 'blue' | 'green' | 'purple'
  /** 종이 배경 */
  paper: string
  /** 컨트롤 바 배경 — 종이보다 한 단계 진한 같은 계열 */
  chrome: string
  /** CSS 변수 이름 */
  paperVar: `--paper-${ColorIndex}`
  chromeVar: `--chrome-${ColorIndex}`
}

export const PALETTE: readonly PaletteEntry[] = [
  { index: 0, name: 'yellow', paper: '#FFEFA8', chrome: '#F7E496', paperVar: '--paper-0', chromeVar: '--chrome-0' },
  { index: 1, name: 'pink', paper: '#FBD3DE', chrome: '#F3C4D2', paperVar: '--paper-1', chromeVar: '--chrome-1' },
  { index: 2, name: 'blue', paper: '#CFE4F7', chrome: '#BED8F1', paperVar: '--paper-2', chromeVar: '--chrome-2' },
  { index: 3, name: 'green', paper: '#D9EFCF', chrome: '#CAE6BE', paperVar: '--paper-3', chromeVar: '--chrome-3' },
  { index: 4, name: 'purple', paper: '#E4DAF6', chrome: '#D7C9F1', paperVar: '--paper-4', chromeVar: '--chrome-4' },
] as const

export const DEFAULT_COLOR: ColorIndex = 0

/** 범위를 벗어난 값이 DB에서 올라와도 앱이 죽지 않게 한다. */
export function normalizeColor(value: number | null | undefined): ColorIndex {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0 || n > 4) return DEFAULT_COLOR
  return n as ColorIndex
}

export function paletteOf(index: number | null | undefined): PaletteEntry {
  return PALETTE[normalizeColor(index)]
}

export function paperColor(index: number | null | undefined): string {
  return paletteOf(index).paper
}

export function chromeColor(index: number | null | undefined): string {
  return paletteOf(index).chrome
}

/**
 * 현재 메모 색을 CSS 변수로 노출한다.
 * 컴포넌트는 `--paper-bg` / `--chrome-bg`만 참조하면 된다.
 */
export function paletteStyle(index: number | null | undefined): Record<string, string> {
  const p = paletteOf(index)
  return {
    '--paper-bg': p.paper,
    '--chrome-bg': p.chrome,
  }
}

// ── 투명도 ───────────────────────────────────────────────
export const OPACITY_MIN = 35
export const OPACITY_MAX = 100
/** Ctrl+Shift+휠 한 칸 */
export const OPACITY_STEP = 5
export const OPACITY_DEFAULT = 96

export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return OPACITY_DEFAULT
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(value)))
}

// ── 악센트 ───────────────────────────────────────────────
export const ACCENTS = ['#0067C0', '#7a5cd6', '#3a8a4f', '#c05621'] as const
export type Accent = (typeof ACCENTS)[number]
export const DEFAULT_ACCENT: Accent = '#0067C0'
