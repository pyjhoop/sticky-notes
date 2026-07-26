/**
 * 마크다운 파생 — `#태그` · `[[위키링크]]` 추출.
 *
 * **소유: 트랙 B (M3).**
 *
 * 핵심 규칙 (`plan.md` 검증 절):
 * **코드블록(``` 펜스 / 인라인 백틱) 내부의 `#태그`·`[[링크]]`는 추출되면 안 된다.**
 *
 * 방식은 "마스킹"이다 — 코드 구간을 같은 길이의 공백으로 덮은 사본을 만들고
 * 그 사본에만 정규식을 돌린다. 원본 문자열은 절대 바꾸지 않는다
 * (CLAUDE.md 절대규칙 3 — 마크다운 원문이 진실이다).
 *
 * ─────────────────────────────────────────────────────────────
 * 제목·미리보기 파생은 여기에 없다
 *
 * 통합 게이트에서 `deriveTitle`/`derivePreview`를 **삭제했다.** 호출처가 0건인데
 * `src-tauri/src/notes.rs`의 `derive_title`/`derive_preview`와 규칙이 달랐다
 * (마커 제거 범위, 미리보기 상한 120 vs 160). 보드 카드가 그리는 값은 Rust가 파생한
 * `NoteSummary.title`/`preview`이므로 **진실의 원천은 Rust 하나**다.
 * 프론트에서 제목이 필요하면 `saveNote`가 돌려주는 `SaveResult.title`을 쓴다.
 * ─────────────────────────────────────────────────────────────
 */

/** `#태그` — 한글·영숫자·`_`로 시작, 이어서 `/`·`-` 허용. 앞에 문자/숫자/`#`/`/`가 오면 태그가 아니다. */
const TAG_RE = /(?<![\p{L}\p{N}_#/])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu

/** `[[대상]]` · `[[대상|별칭]]` · `[[대상#섹션]]` */
const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g

/** ``` 또는 ~~~ 로 시작하는 펜스 줄 */
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/

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

/** 공백 4칸(또는 탭) 들여쓰기로 시작하는 줄 */
const INDENTED_RE = /^(?: {4}|\t)/

/**
 * 들여쓰기 코드블록을 마스킹한다.
 *
 * CommonMark 규칙을 그대로 옮기면 리스트 문맥까지 따라가야 하므로,
 * **빈 줄(또는 문서 시작) 다음에 오는 4칸 들여쓰기 줄들의 연속**만 코드로 본다.
 * 리스트 하위 항목(`- 상위` 바로 다음 줄의 들여쓰기)은 앞줄이 비어 있지 않으므로
 * 코드로 오인하지 않는다.
 */
function maskIndentedCode(body: string): string {
  const lines = body.split('\n')
  let prevBlank = true
  let inBlock = false

  return lines
    .map((line) => {
      const isBlank = line.trim().length === 0
      const indented = INDENTED_RE.test(line)

      if (inBlock) {
        // 빈 줄은 블록을 끊지 않는다 — 다음 들여쓰기 줄이 오면 계속 코드다.
        if (!isBlank && !indented) inBlock = false
      } else if (indented && prevBlank) {
        inBlock = true
      }

      prevBlank = isBlank

      return inBlock && !isBlank ? blank(line) : line
    })
    .join('\n')
}

/** 펜스 블록 + 들여쓰기 블록 + 인라인 코드를 모두 마스킹한다. 추출 함수들이 쓰는 사본. */
export function maskCode(body: string): string {
  return maskIndentedCode(maskFencedCode(body))
    .split('\n')
    .map(maskInlineCodeLine)
    .join('\n')
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
