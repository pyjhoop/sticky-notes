/**
 * 메모 팔레트 — 인덱스 0..5 ↔ 종이/크롬 색.
 *
 * 근거: design/StickyNote App.dc.html (버전 2) 75~80행 팔레트 팝오버의 스와치.
 * DB의 `notes.color`가 이 배열의 인덱스다. **순서를 바꾸면 기존 데이터가 어긋난다.**
 *
 * 2026-08-03 — 디자인 v2로 5색(yellow/pink/blue/green/purple) → 6색(yellow/lime/
 * mint/blue/lavender/white) 전면 교체. 기존 DB 데이터의 색상 인덱스 재매핑은
 * `src-tauri/src/db.rs`의 `m003_repalette` 마이그레이션이 처리한다(구 인덱스는
 * 신 팔레트에서 색상환 거리가 가장 가까운 인덱스로 옮겨진다 — 근거는 그 파일 주석).
 *
 * 색 값 자체는 `src/styles/tokens.css`의 `--paper-N` / `--chrome-N`과 동일하다.
 * 컴포넌트는 가급적 CSS 변수를 쓰고, 여기 값은 인라인 스타일이 불가피할 때만 쓴다.
 */

export type ColorIndex = 0 | 1 | 2 | 3 | 4 | 5

export interface PaletteEntry {
  /** 팔레트 인덱스 */
  index: ColorIndex
  /** 내부 식별자 */
  name: 'yellow' | 'lime' | 'mint' | 'blue' | 'lavender' | 'white'
  /** 종이 배경 */
  paper: string
  /** 컨트롤 바 배경 — 종이보다 한 단계 밝고 채도 낮은 알파 오버레이 (tokens.css 팔레트 블록 공식 참조) */
  chrome: string
  /** CSS 변수 이름 */
  paperVar: `--paper-${ColorIndex}`
  chromeVar: `--chrome-${ColorIndex}`
}

export const PALETTE: readonly PaletteEntry[] = [
  {
    index: 0,
    name: 'yellow',
    paper: 'oklch(0.935 0.075 95)',
    chrome: 'oklch(0.97 0.045 95 / 0.85)',
    paperVar: '--paper-0',
    chromeVar: '--chrome-0',
  },
  {
    index: 1,
    name: 'lime',
    paper: 'oklch(0.93 0.06 130)',
    chrome: 'oklch(0.965 0.036 130 / 0.85)',
    paperVar: '--paper-1',
    chromeVar: '--chrome-1',
  },
  {
    index: 2,
    name: 'mint',
    paper: 'oklch(0.93 0.05 195)',
    chrome: 'oklch(0.965 0.03 195 / 0.85)',
    paperVar: '--paper-2',
    chromeVar: '--chrome-2',
  },
  {
    index: 3,
    name: 'blue',
    paper: 'oklch(0.925 0.05 265)',
    chrome: 'oklch(0.96 0.03 265 / 0.85)',
    paperVar: '--paper-3',
    chromeVar: '--chrome-3',
  },
  {
    index: 4,
    name: 'lavender',
    paper: 'oklch(0.925 0.05 320)',
    chrome: 'oklch(0.96 0.03 320 / 0.85)',
    paperVar: '--paper-4',
    chromeVar: '--chrome-4',
  },
  {
    index: 5,
    name: 'white',
    paper: 'oklch(0.965 0.004 90)',
    chrome: 'oklch(0.99 0.002 90 / 0.85)',
    paperVar: '--paper-5',
    chromeVar: '--chrome-5',
  },
] as const

export const DEFAULT_COLOR: ColorIndex = 0

/** 범위를 벗어난 값이 DB에서 올라와도 앱이 죽지 않게 한다. */
export function normalizeColor(value: number | null | undefined): ColorIndex {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0 || n > 5) return DEFAULT_COLOR
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
// 2026-08-03: 값은 의도적으로 hex 그대로 남겨뒀다 — 이 배열은 `src-tauri/src/db.rs`의
// `ACCENT_OPTIONS`와 문자열이 정확히 일치해야 `set_setting("accent", ...)` 검증을
// 통과한다(Rust가 exact-match로 검사). 디자인 v2에 맞춘 시각적 렌더 값(oklch, 채도 완화
// 등)은 `tokens.css`의 `--accent-blue`/`--accent-purple`/`--accent-green`/`--accent-orange`에
// 있다 — Settings.accent(hex 식별자) → 어떤 CSS 변수를 켤지 매핑하는 건 이 값을 그대로
// 재사용하는 스테이지 2의 몫이다. 이 배열 포맷을 oklch로 바꾸려면 db.rs의
// ACCENT_OPTIONS도 같이 바꿔야 하고 기존 저장된 사용자 설정과의 호환성 검토가 필요해
// 이번 "토대" 범위 밖으로 남겨뒀다.
export const ACCENTS = ['#0067C0', '#7a5cd6', '#3a8a4f', '#c05621'] as const
export type Accent = (typeof ACCENTS)[number]
export const DEFAULT_ACCENT: Accent = '#0067C0'
