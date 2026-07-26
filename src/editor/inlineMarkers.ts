/**
 * 마크다운 문법에 이미 있는 노드들의 라이브 프리뷰.
 *
 * **소유: 트랙 B (M3).**
 *
 * - `FencedCode` — 라인 데코레이션으로 코드블록 배경(`--code-bg`)
 * - `InlineCode` — 알약 + 백틱 숨김
 * - `StrongEmphasis` / `Emphasis` — 굵게·기울임 + `**`·`*` 숨김
 * - `ATXHeading1..6` — 제목 크기 + `#` 마커 숨김
 *
 * 마커 숨김 판정은 전부 `cursorInside()` 하나로 통일한다 (plan.md M3).
 * 숨긴다는 것은 `Decoration.replace`로 **화면에서만** 지운다는 뜻이고,
 * 문서 텍스트는 사용자가 친 그대로 남는다 (CLAUDE.md 절대규칙 3).
 */

import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { Decoration } from '@codemirror/view'

import { childrenNamed, cursorInside, hiddenMarker, type DecoRange } from './shared'

const ATX_HEADING = /^ATXHeading([1-6])$/

const inlineCodeMark = Decoration.mark({ class: 'cm-inline-code' })
const strongMark = Decoration.mark({ class: 'cm-strong' })
const emphasisMark = Decoration.mark({ class: 'cm-em' })
const strikeMark = Decoration.mark({ class: 'cm-strike' })

/** 코드블록 라인 — 첫/마지막 줄만 라운드 처리한다. */
const codeLine = Decoration.line({ class: 'cm-code-line' })
const codeLineFirst = Decoration.line({ class: 'cm-code-line cm-code-line-first' })
const codeLineLast = Decoration.line({ class: 'cm-code-line cm-code-line-last' })
const codeLineOnly = Decoration.line({
  class: 'cm-code-line cm-code-line-first cm-code-line-last',
})

const headingLines = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `cm-heading cm-h${level}` }),
)

/**
 * `from`~`to` 구간의 인라인/블록 마커 데코레이션을 `out`에 채운다.
 *
 * `seenFences`는 뷰포트가 여러 조각으로 나뉘었을 때 같은 코드블록에
 * 라인 데코레이션을 두 번 넣지 않기 위한 것이다 (중복 시 RangeSet이 깨진다).
 */
export function buildInlineDecorations(
  state: EditorState,
  from: number,
  to: number,
  out: DecoRange[],
  seenFences: Set<number>,
): void {
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      switch (node.name) {
        case 'FencedCode':
        case 'CodeBlock': {
          if (seenFences.has(node.from)) return false
          seenFences.add(node.from)
          addCodeBlockLines(state, node.from, node.to, out)
          // 코드 안쪽은 언어별 하이라이트(syntaxHighlighting)가 담당한다.
          return false
        }

        case 'InlineCode': {
          out.push(inlineCodeMark.range(node.from, node.to))
          if (!cursorInside(state, node.from, node.to)) {
            for (const mark of childrenNamed(node.node, 'CodeMark')) {
              out.push(hiddenMarker.range(mark.from, mark.to))
            }
          }
          return false
        }

        case 'StrongEmphasis':
        case 'Emphasis':
        case 'Strikethrough': {
          const deco =
            node.name === 'StrongEmphasis'
              ? strongMark
              : node.name === 'Emphasis'
                ? emphasisMark
                : strikeMark
          out.push(deco.range(node.from, node.to))
          if (!cursorInside(state, node.from, node.to)) {
            const markName = node.name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark'
            for (const mark of childrenNamed(node.node, markName)) {
              out.push(hiddenMarker.range(mark.from, mark.to))
            }
          }
          return undefined // 안쪽 중첩 강조도 계속 훑는다
        }

        default: {
          const heading = ATX_HEADING.exec(node.name)
          if (!heading) return undefined
          const level = Number(heading[1])
          const line = state.doc.lineAt(node.from)
          out.push(headingLines[level - 1].range(line.from))

          if (!cursorInside(state, node.from, node.to)) {
            const mark = node.node.firstChild
            if (mark && mark.name === 'HeaderMark') {
              // `#` 뒤 공백까지 함께 감춰야 본문이 왼쪽 정렬된다.
              let end = mark.to
              while (end < node.to && /[ \t]/.test(state.doc.sliceString(end, end + 1))) end++
              out.push(hiddenMarker.range(mark.from, end))
            }
          }
          return undefined
        }
      }
    },
  })
}

function addCodeBlockLines(
  state: EditorState,
  from: number,
  to: number,
  out: DecoRange[],
): void {
  const first = state.doc.lineAt(from).number
  const last = state.doc.lineAt(to).number
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n)
    const deco =
      first === last
        ? codeLineOnly
        : n === first
          ? codeLineFirst
          : n === last
            ? codeLineLast
            : codeLine
    out.push(deco.range(line.from))
  }
}
