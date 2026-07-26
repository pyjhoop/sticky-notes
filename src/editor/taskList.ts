/**
 * `- [ ]` / `- [x]` → 체크박스 위젯.
 *
 * **소유: 트랙 B (M3).**
 *
 * 디자인 근거 — `design/Sticky Notes for Windows.dc.html` 73~85행:
 *   체크박스 16px · radius 4px · border 1.5px `rgba(0,0,0,.30)`
 *   완료 시 배경 `#3a8a4f` + `✓`, 본문은 `rgba(42,37,33,.45)` + line-through
 *
 * CLAUDE.md 절대규칙 4 — 클릭은 **반드시 트랜잭션 dispatch**로 문서 텍스트를 바꾼다.
 * `widget.dom.checked = true` 같은 DOM 직접 조작은 하지 않는다.
 */

import { syntaxTree } from '@codemirror/language'
import type { ChangeSpec, EditorState, Text } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'

import type { DecoRange } from './shared'

/** `[ ]` · `[x]` · `[X]` 세 형태만 태스크 마커로 인정한다. */
const TASK_MARKER = /^\[[ xX]\]$/

/** 완료된 태스크의 나머지 본문 — 취소선 + 흐린 잉크. */
const doneMark = Decoration.mark({ class: 'cm-task-done' })

/** `- ` 불릿 숨김 — 체크박스가 불릿을 대신한다. */
const bulletHidden = Decoration.replace({})

/**
 * `pos`의 태스크 마커를 뒤집는 **변경 명세**를 만든다. 문서를 직접 바꾸지 않는다.
 * 마커가 아니면 `null`.
 *
 * 순수 함수로 분리해 둔 이유는 테스트에서 DOM 없이 검증하기 위해서다.
 */
export function taskMarkerToggle(doc: Text, pos: number): ChangeSpec | null {
  if (pos < 0 || pos + 3 > doc.length) return null
  const marker = doc.sliceString(pos, pos + 3)
  if (!TASK_MARKER.test(marker)) return null
  const checked = marker[1] !== ' '
  return { from: pos, to: pos + 3, insert: checked ? '[ ]' : '[x]' }
}

/** 체크박스 위젯. 문서의 `[ ]`/`[x]` 3글자를 대신 그린다. */
export class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = this.checked ? 'cm-task-checkbox cm-task-checkbox-done' : 'cm-task-checkbox'
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', this.checked ? 'true' : 'false')
    box.setAttribute('aria-label', this.checked ? '완료됨' : '할 일')
    // 체크 표시는 텍스트가 아니라 CSS(::after)로 그린다 — 복사 시 문서에 섞이지 않도록.
    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      toggleTaskFromDom(view, box)
    })
    return box
  }

  /** 위젯 안의 mousedown을 에디터가 먼저 삼키지 않도록 한다. */
  ignoreEvent(): boolean {
    return false
  }
}

/**
 * 위젯 DOM → 문서 위치를 역산해 토글 트랜잭션을 dispatch 한다.
 *
 * 위치를 위젯에 저장해 두지 않고 `posAtDOM`으로 매번 구하는 이유는,
 * 앞쪽이 편집돼 위치가 밀려도 항상 실제 마커를 가리키게 하기 위해서다.
 */
function toggleTaskFromDom(view: EditorView, dom: HTMLElement): void {
  const pos = view.posAtDOM(dom)
  const changes = taskMarkerToggle(view.state.doc, pos)
  if (!changes) return
  // CLAUDE.md 절대규칙 4 — 문서 텍스트를 트랜잭션으로 바꾼다.
  view.dispatch({ changes })
}

/**
 * `from`~`to` 구간의 태스크 데코레이션을 `out`에 채운다.
 *
 * - `TaskMarker`(+뒤 공백 1칸) → 체크박스 위젯으로 `replace`
 * - `- ` 불릿 → 숨김
 * - 완료된 태스크의 나머지 본문 → `cm-task-done`
 */
export function buildTaskDecorations(
  state: EditorState,
  from: number,
  to: number,
  out: DecoRange[],
): void {
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== 'TaskMarker') return
      const marker = state.doc.sliceString(node.from, node.to)
      if (!TASK_MARKER.test(marker)) return

      const checked = marker[1] !== ' '
      // 마커 뒤 공백 1칸까지 함께 감춘다 — 간격은 체크박스의 margin-right(9px)가 만든다.
      const trailing = state.doc.sliceString(node.to, node.to + 1)
      const replaceTo = trailing === ' ' || trailing === '\t' ? node.to + 1 : node.to

      out.push(
        Decoration.replace({ widget: new TaskCheckboxWidget(checked) }).range(node.from, replaceTo),
      )

      const task = node.node.parent
      const listItem = task?.parent

      // `- ` 불릿 숨김 — ListMark 시작부터 Task 시작 직전까지.
      if (task && listItem && listItem.name === 'ListItem') {
        const listMark = listItem.firstChild
        if (listMark && listMark.name === 'ListMark' && listMark.from < task.from) {
          out.push(bulletHidden.range(listMark.from, task.from))
        }
      }

      if (checked && task && task.to > replaceTo) {
        out.push(doneMark.range(replaceTo, task.to))
      }
    },
  })
}
