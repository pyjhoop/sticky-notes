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
import type { SyntaxNode } from '@lezer/common'

import { childrenNamed, cursorInside, hiddenMarker, type DecoRange } from './shared'

const ATX_HEADING = /^ATXHeading([1-6])$/

/**
 * 코드블록 배경(`--code-bg`)이 깔리는 노드.
 *
 * `buildInlineDecorations()`의 `case`와 `codeBlockAt()`이 **같은 집합**을 봐야 한다 —
 * 한쪽만 늘리면 "배경은 어두운데 캐럿 색은 안 바뀌는" 줄이 생긴다.
 */
const CODE_BLOCK_NODES = new Set(['FencedCode', 'CodeBlock'])

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

/**
 * `pos`가 놓인 **줄**이 코드블록 배경 안이면 그 블록의 시작 위치, 아니면 `null`.
 *
 * 판정 단위가 위치가 아니라 **줄**인 이유: `addCodeBlockLines()`가 배경을
 * `Decoration.line`으로, 즉 줄 단위로 깐다. 펜스 줄(```` ```ts ````, ```` ``` ````)도
 * 그 배경 안에 있으므로 여기서도 "안"으로 친다 — 화면에서 어두운 곳과 정확히 같다.
 *
 * 구현은 `line.from`에서 부모를 거슬러 올라간다. 줄 어디에 커서가 있든 그 줄이
 * 코드블록에 속하는지는 같으므로 줄머리 한 점만 보면 충분하고, 빈 줄
 * (`line.from === line.to`)에서도 성립한다. lezer의 `resolveInner`는 중첩 언어로
 * 마운트된 하위 트리까지 들어가지만 `.parent` 사슬은 바깥 트리로 이어지므로
 * ```` ```js ```` 안쪽에서도 `FencedCode`에 닿는다.
 *
 * 반환값을 boolean이 아니라 **블록 시작 위치**로 두는 것은 호출부가 "두 지점이
 * 같은 블록인가"를 볼 수 있게 하기 위해서다 (`caretContext.ts`의 선택 영역 판정).
 */
export function codeBlockAt(state: EditorState, pos: number): number | null {
  const line = state.doc.lineAt(pos)
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, 1)
  while (node) {
    if (CODE_BLOCK_NODES.has(node.name)) return node.from
    node = node.parent
  }
  return null
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
