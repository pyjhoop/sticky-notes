/**
 * 마크다운 파생 — 제목, `#태그`, `[[위키링크]]`, 보드 카드 미리보기.
 *
 * **소유: 트랙 B (M3).**
 *
 * 핵심 규칙 (`plan.md` 검증 절):
 * **코드블록(``` 펜스 / 인라인 백틱) 내부의 `#태그`·`[[링크]]`는 추출되면 안 된다.**
 *
 * 방식은 "마스킹"이다 — 코드 구간을 같은 길이의 공백으로 덮은 사본을 만들고
 * 그 사본에만 정규식을 돌린다. 원본 문자열은 절대 바꾸지 않는다
 * (CLAUDE.md 절대규칙 3 — 마크다운 원문이 진실이다).
 */

/** 제목 파생 규칙: 첫 `# 제목` → 없으면 첫 비어있지 않은 줄 → 80자 절단 → 없으면 `제목 없음` */
export const UNTITLED = '제목 없음'
export const TITLE_MAX = 80

/** `#태그` — 한글·영숫자·`_`로 시작, 이어서 `/`·`-` 허용. 앞에 문자/숫자/`#`/`/`가 오면 태그가 아니다. */
const TAG_RE = /(?<![\p{L}\p{N}_#/])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu

/** `[[대상]]` · `[[대상|별칭]]` · `[[대상#섹션]]` */
const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g

/** ``` 또는 ~~~ 로 시작하는 펜스 줄 */
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/

/** 수평선 — 미리보기에서 뺀다 */
const THEMATIC_BREAK_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$/

const ATX_LINE_RE = /^ {0,3}#{1,6}[ \t]+\S/

/** 같은 길이의 공백으로 덮는다 — 위치·개행이 어긋나지 않게. */
function blank(text: string): string {
  return ' '.repeat(text.length)
}

/**
 * 펜스 코드블록만 마스킹한다. 여는 줄·내용·닫는 줄 전부 공백이 된다.
 *
 * 닫히지 않은 펜스는 문서 끝까지 코드로 본다 (CommonMark와 같다).
 */
export function maskFencedCode(body: string): string {
  const lines = body.split('\n')
  let fence: string | null = null

  return lines
    .map((line) => {
      if (fence !== null) {
        const close = FENCE_CLOSE_RE.exec(line)
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null
        return blank(line)
      }
      const open = FENCE_OPEN_RE.exec(line)
      if (open) {
        fence = open[1]
        return blank(line)
      }
      return line
    })
    .join('\n')
}

/**
 * 한 줄 안의 인라인 코드(백틱 런)를 마스킹한다.
 *
 * CommonMark대로 N개짜리 여는 런은 정확히 N개짜리 런에서 닫힌다.
 * 닫는 런이 없으면 코드가 아니므로 그대로 둔다.
 */
function maskInlineCodeLine(line: string): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i]
      i += 1
      continue
    }
    let open = 0
    while (line[i + open] === '`') open += 1

    let j = i + open
    let closeAt = -1
    while (j < line.length) {
      if (line[j] === '`') {
        let run = 0
        while (line[j + run] === '`') run += 1
        if (run === open) {
          closeAt = j
          break
        }
        j += run
      } else {
        j += 1
      }
    }

    if (closeAt < 0) {
      out += line.slice(i, i + open)
      i += open
    } else {
      out += blank(line.slice(i, closeAt + open))
      i = closeAt + open
    }
  }
  return out
}

/** 펜스 블록 + 인라인 코드를 모두 마스킹한다. 추출 함수들이 쓰는 사본. */
export function maskCode(body: string): string {
  return maskFencedCode(body)
    .split('\n')
    .map(maskInlineCodeLine)
    .join('\n')
}

/** 제목으로 쓸 줄의 인덱스. 없으면 -1. 코드블록 줄은 후보에서 빠진다. */
function findTitleLineIndex(body: string): number {
  const masked = maskFencedCode(body).split('\n')
  for (let i = 0; i < masked.length; i += 1) {
    if (ATX_LINE_RE.test(masked[i])) return i
  }
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i].trim().length > 0) return i
  }
  return -1
}

/** 한 줄에서 마크다운 마커를 걷어내고 평문만 남긴다. */
function stripMarkers(line: string): string {
  return line
    .replace(/\r$/, '')
    .replace(/^ {0,3}#{1,6}[ \t]+/, '') // ATX 제목
    .replace(/^\s*>[ \t]?/, '') // 인용
    .replace(/^\s*(?:[-*+]|\d+[.)])[ \t]+/, '') // 리스트 불릿
    .replace(/^\[[ xX]\][ \t]*/, '') // 태스크 마커
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 이미지
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 링크 → 텍스트
    .replace(/\[\[([^[\]\n]+)\]\]/g, (_all, target: string) => {
      const parts = target.split('|')
      return (parts.length > 1 ? parts[parts.length - 1] : parts[0]).trim()
    })
    .replace(/`+([^`]*)`+/g, '$1') // 인라인 코드
    .replace(/(\*\*\*|___)(.+?)\1/g, '$2')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 본문에서 보드용 제목을 파생한다.
 *
 * 첫 `# 제목` → 없으면 첫 비어있지 않은 줄 → 80자 절단 → 없으면 `제목 없음`.
 * 코드블록으로 시작하는 본문은 펜스 줄을 제목으로 쓰지 않는다.
 */
export function deriveTitle(body: string): string {
  const index = findTitleLineIndex(body)
  if (index < 0) return UNTITLED

  const text = stripMarkers(body.split('\n')[index])
  if (!text) return UNTITLED
  return text.length > TITLE_MAX ? text.slice(0, TITLE_MAX) : text
}

/** 순서를 지키며 중복을 제거한다. */
function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/**
 * `#태그`를 추출한다. `#`은 결과에 포함하지 않는다.
 *
 * 코드블록·인라인 코드 내부는 제외된다. ATX 제목의 `#`는 뒤에 공백이 오므로
 * 애초에 매치되지 않는다.
 */
export function extractTags(body: string): string[] {
  const masked = maskCode(body)
  const found: string[] = []
  TAG_RE.lastIndex = 0
  for (let m = TAG_RE.exec(masked); m; m = TAG_RE.exec(masked)) {
    found.push(m[1])
  }
  return unique(found)
}

/**
 * `[[위키링크]]`의 대상을 추출한다. 대괄호는 결과에 포함하지 않는다.
 *
 * `[[대상|별칭]]`은 대상만, `[[대상#섹션]]`도 대상(`대상`)만 남긴다.
 * 코드블록·인라인 코드 내부는 제외된다.
 */
export function extractLinks(body: string): string[] {
  const masked = maskCode(body)
  const found: string[] = []
  WIKILINK_RE.lastIndex = 0
  for (let m = WIKILINK_RE.exec(masked); m; m = WIKILINK_RE.exec(masked)) {
    const target = m[1].split('|')[0].split('#')[0].trim()
    if (target) found.push(target)
  }
  return unique(found)
}

/**
 * 보드 카드 미리보기 — 마크다운 마커를 걷어낸 평문 한 덩어리.
 *
 * 제목으로 쓰인 줄과 코드블록은 빼고, 남은 줄을 ` · `로 잇는다
 * (디자인 354행 `디자인 리뷰 11:00 · 옵시디언 플러그인 문서 · 전기요금 자동이체`).
 * 결과 길이는 `maxLength`를 넘지 않는다 — 넘치면 끝에 `…`를 붙인다.
 */
export function derivePreview(body: string, maxLength = 120): string {
  if (maxLength <= 0) return ''

  const titleIndex = findTitleLineIndex(body)
  const masked = maskFencedCode(body).split('\n')
  const lines = body.split('\n')
  const parts: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    if (i === titleIndex) continue
    if (masked[i].trim().length === 0) continue // 빈 줄 · 코드블록
    if (THEMATIC_BREAK_RE.test(lines[i])) continue

    const text = stripMarkers(lines[i])
    if (text) parts.push(text)
  }

  const joined = parts.join(' · ')
  if (joined.length <= maxLength) return joined
  return joined.slice(0, maxLength - 1).trimEnd() + '…'
}
