/**
 * 캐럿·선택 영역이 **코드블록 안인지**를 에디터 루트의 클래스로 내보낸다.
 *
 * **소유: 트랙 B (M3).**
 *
 * ── 왜 이 우회로가 필요한가 (자손 셀렉터가 안 되는 구조적 이유)
 *
 * 사용자 신고: "마크다운 내에서 캐럿이 안 보인다. 다크 모드여서."
 * 원인은 색이 겹친 것이다 — 캐럿은 `var(--ink)`(#2a2521)인데 코드블록 배경
 * `var(--code-bg)`도 **정확히 같은 #2a2521**이다. 검정 위의 검정이라 아예 안 보인다.
 *
 * 그런데 `.cm-code-line .cm-cursor { … }` 같은 자손 셀렉터로는 고칠 수 없다.
 * `drawSelection()`이 그리는 캐럿은 `.cm-line`의 자손이 **아니기 때문**이다
 * (@codemirror/view 6.43.6):
 *
 *   .cm-editor
 *     └ .cm-scroller
 *         ├ .cm-cursorLayer      ← 캐럿 div (`.cm-cursor`)가 여기 산다
 *         ├ .cm-selectionLayer   ← 선택 사각형(`.cm-selectionBackground`)
 *         └ .cm-content
 *             └ .cm-line(.cm-code-line)   ← 코드블록 배경은 여기 붙는다
 *
 * `cursorLayer`는 `layer({ above: true, class: "cm-cursorLayer" })`(dist:9535)로
 * 만들어져 `.cm-scroller`의 **직계 자식**으로 붙고, 그 안의 마커는
 * `RectangleMarker.forRange`(dist:9218)가 계산한 좌표를 가진 절대 위치 div다.
 * 즉 캐럿과 코드블록 줄은 DOM 상에서 **형제의 자손끼리**라 어떤 조합자로도
 * "코드블록 위에 있는 캐럿"을 CSS만으로 고를 수 없다.
 *
 * ── 그래서 상태로 판정한다
 *
 * 커서가 코드블록 줄 위인지는 문서와 선택만으로 알 수 있다. `EditorView.editorAttributes`
 * 에 함수를 넣으면 매 업데이트마다 다시 불려(`attrsFromFacet`, dist:8992 ←
 * `updateAttrs`, dist:8250) 루트 엘리먼트의 class가 갱신되므로, 선택이 바뀔 때마다
 * 클래스가 따라붙는다. 실제 색은 `theme.ts`가 그 클래스로 지정한다.
 *
 * CLAUDE.md 절대규칙 4 — DOM을 직접 만지지 않는다. 여기서 하는 일은 상태를 읽어
 * facet 값을 내놓는 것뿐이고, 엘리먼트에 반영하는 것은 CodeMirror다.
 * 절대규칙 3 — 문서 텍스트는 건드리지 않는다.
 */

import type { EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { codeBlockAt } from './inlineMarkers'

/** 캐럿이 코드블록 안일 때 에디터 루트에 붙는 클래스. */
export const CARET_IN_CODE_CLASS = 'cm-caret-in-code'
/** 선택 영역이 통째로 코드블록 안일 때 에디터 루트에 붙는 클래스. */
export const SELECTION_IN_CODE_CLASS = 'cm-selection-in-code'

/**
 * 모든 커서(선택의 head)가 코드블록 줄 위인가.
 *
 * "모두"인 이유 — 멀티 커서에서 일부만 코드블록 안이면, 색을 바꾸는 순간
 * 종이 위의 나머지 캐럿이 밝은 색이 되어 **거꾸로** 안 보이게 된다.
 * 하나라도 종이 위에 있으면 기본색(`--ink`)을 유지하는 쪽이 안전하다.
 */
export function caretInCodeBlock(state: EditorState): boolean {
  return state.selection.ranges.every((range) => codeBlockAt(state, range.head) !== null)
}

/**
 * 비어 있지 않은 선택이 있고, 그 전부가 **하나의 코드블록 안**에 들어 있는가.
 *
 * 코드블록과 종이 본문에 걸친 선택은 일부러 제외한다. 어두운 배경에서 보이는
 * 선택색은 밝은 종이 위에서 묻히므로(그 반대도 마찬가지), 걸친 선택에 한쪽
 * 색을 쓰면 다른 쪽이 안 보인다. 걸쳤을 때는 기존 `--selection-bg`를 그대로 둔다.
 */
export function selectionInCodeBlock(state: EditorState): boolean {
  const ranges = state.selection.ranges.filter((range) => !range.empty)
  if (ranges.length === 0) return false
  return ranges.every((range) => {
    const start = codeBlockAt(state, range.from)
    return start !== null && start === codeBlockAt(state, range.to)
  })
}

/**
 * 위 두 판정을 에디터 루트 class로 내보내는 확장.
 *
 * 아무것도 해당하지 않으면 `null`을 돌려준다 — `attrsFromFacet`은 falsy 값을
 * 건너뛰므로(dist:8995) 클래스가 붙지 않는다.
 */
export const codeContextAttributes: Extension = EditorView.editorAttributes.of((view) => {
  const classes: string[] = []
  if (caretInCodeBlock(view.state)) classes.push(CARET_IN_CODE_CLASS)
  if (selectionInCodeBlock(view.state)) classes.push(SELECTION_IN_CODE_CLASS)
  return classes.length > 0 ? { class: classes.join(' ') } : null
})
