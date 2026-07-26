/**
 * `[[위키링크]]` 와 `#태그`.
 *
 * **소유: 트랙 B (M3).**
 *
 * 둘 다 CommonMark/GFM 문법에 없으므로 syntaxTree로는 잡히지 않는다.
 * (`[[X]]`는 lezer가 `Link`로 오인하고, `#태그`는 그냥 텍스트다.)
 * 그래서 **정규식 스캔**으로 따로 처리하되, 마커 숨김 규칙은
 * `inlineMarkers`와 동일하게 `cursorInside()` 하나로 판정한다.
 *
 * 디자인 근거 — `design/Sticky Notes for Windows.dc.html`
 *   91행 위키링크 `#6d4fc4` on `rgba(109,79,196,.10)` · radius 4px · padding 1px 4px
 *   105행 태그 11.5px · padding 3px 8px · radius 11px · `rgba(0,0,0,.06)`
 */

import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { Decoration } from '@codemirror/view'

import { cursorInside, hiddenMarker, type DecoRange } from './shared'

/** `[[대상]]` · `[[대상|별칭]]`. 개행과 중첩 대괄호는 허용하지 않는다. */
export const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g

/**
 * `#태그` — 한글·영숫자·`_`로 시작하고 이어서 `/`·`-`를 허용한다.
 *
 * 앞이 문자/숫자/`#`/`/`면 태그가 아니다 (`a#b`, `##`, `색#1` 등).
 * ATX 제목의 `#`는 뒤에 공백이 오므로 자연히 매치되지 않는다.
 */
export const TAG_RE = /(?<![\p{L}\p{N}_#/])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu

/** 코드로 취급해 스캔에서 통째로 제외할 노드. */
const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'Comment'])

const wikilinkMark = Decoration.mark({ class: 'cm-wikilink' })
const tagMark = Decoration.mark({ class: 'cm-tag' })

/**
 * 코드(펜스 블록 · 인라인 백틱) 범위를 모은다.
 *
 * 언어별 중첩 파서가 붙으면 `resolveInner`의 부모 체인이 바깥 마크다운 노드까지
 * 안 올라갈 수 있어서, 바깥 트리에서 코드 노드를 만나면 하위를 훑지 않고
 * 범위만 기록하는 방식을 쓴다.
 */
export function collectCodeRanges(
  state: EditorState,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (!CODE_NODES.has(node.name)) return undefined
      ranges.push({ from: node.from, to: node.to })
      return false
    },
  })
  return ranges
}

function overlapsAny(
  ranges: Array<{ from: number; to: number }>,
  from: number,
  to: number,
): boolean {
  for (const range of ranges) {
    if (range.from < to && range.to > from) return true
  }
  return false
}

/**
 * `from`~`to` 구간의 위키링크·태그 데코레이션을 `out`에 채운다.
 *
 * 스캔 단위는 줄이다 — 두 문법 모두 개행을 넘지 않는다.
 */
export function buildWikilinkTagDecorations(
  state: EditorState,
  from: number,
  to: number,
  out: DecoRange[],
): void {
  const codeRanges = collectCodeRanges(state, from, to)
  const firstLine = state.doc.lineAt(from).number
  const lastLine = state.doc.lineAt(to).number

  for (let n = firstLine; n <= lastLine; n++) {
    const line = state.doc.line(n)
    if (!line.text) continue

    const claimed: Array<{ from: number; to: number }> = []

    WIKILINK_RE.lastIndex = 0
    for (let m = WIKILINK_RE.exec(line.text); m; m = WIKILINK_RE.exec(line.text)) {
      const start = line.from + m.index
      const end = start + m[0].length
      if (overlapsAny(codeRanges, start, end)) continue
      claimed.push({ from: start, to: end })

      out.push(wikilinkMark.range(start, end))
      if (!cursorInside(state, start, end)) {
        out.push(hiddenMarker.range(start, start + 2))
        out.push(hiddenMarker.range(end - 2, end))
      }
    }

    TAG_RE.lastIndex = 0
    for (let m = TAG_RE.exec(line.text); m; m = TAG_RE.exec(line.text)) {
      const start = line.from + m.index
      const end = start + m[0].length
      if (overlapsAny(codeRanges, start, end)) continue
      // `[[노트#섹션]]` 안의 `#`는 태그가 아니다.
      if (overlapsAny(claimed, start, end)) continue
      out.push(tagMark.range(start, end))
    }
  }
}
