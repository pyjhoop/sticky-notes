/**
 * 라이브 프리뷰 확장들이 공유하는 헬퍼.
 *
 * **소유: 트랙 B (M3).**
 *
 * CLAUDE.md 절대규칙 3 — 여기 있는 어떤 함수도 문서 텍스트를 바꾸지 않는다.
 * 전부 `Decoration`(겉모습)만 만든다.
 */

import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

/** `Decoration.set()`에 넣을 범위. 정렬은 `Decoration.set(ranges, true)`가 한다. */
export type DecoRange = Range<Decoration>

/**
 * 마커 노출 판정의 단일 근거.
 *
 * 선택 영역이 `[from, to]`와 조금이라도 겹치면 "커서가 노드 안"으로 본다.
 * 경계 포함 — `**굵게**`의 바로 뒤에 커서를 두면 마커가 보여야 편집할 수 있다.
 */
export function cursorInside(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    if (range.from <= to && range.to >= from) return true
  }
  return false
}

/** 마커 문자를 화면에서만 지운다. 문서에는 그대로 남는다. */
export const hiddenMarker = Decoration.replace({})

/** 코드로 취급할 노드 — 이 안의 `#태그`·`[[링크]]`는 장식하지 않는다. */
const CODE_NODES = new Set([
  'FencedCode',
  'CodeBlock',
  'CodeText',
  'InlineCode',
  'CodeMark',
  'CommentBlock',
  'HTMLBlock',
])

/** `pos`가 코드(펜스 블록 · 인라인 백틱) 안인가. */
export function insideCode(state: EditorState, pos: number): boolean {
  const inner = syntaxTree(state).resolveInner(pos, 1)
  for (let node: SyntaxNode | null = inner; node; node = node.parent) {
    if (CODE_NODES.has(node.name)) return true
  }
  return false
}

/** 노드의 직계 자식 중 이름이 일치하는 것들. */
export function childrenNamed(node: SyntaxNode, name: string): SyntaxNode[] {
  const found: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) found.push(child)
  }
  return found
}
