/**
 * 실제 `EditorView`를 띄워 보는 스모크 테스트.
 *
 * 데코레이션이 서로 겹치면(특히 `replace` 끼리) CodeMirror는 **렌더 시점에**
 * 예외를 던진다. `buildDecorations` 단위 테스트만으로는 잡히지 않으므로
 * jsdom에 붙여서 한 번 그려 본다.
 */

import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { createNoteEditorExtensions } from './index'

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

function mount(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    state: EditorState.create({ doc, extensions: createNoteEditorExtensions() }),
    parent,
  })
  return view
}

const KITCHEN_SINK = [
  '# 스프린트 24 · 릴리스 체크',
  '',
  '- [ ] 설치 관리자 서명 인증서 갱신',
  '- [x] **굵게** 와 `코드` 와 [[릴리스 절차]]',
  '- [ ] 볼트 충돌 시 `conflict-{ts}.md` 생성 #릴리스',
  '',
  '창 위치는 **모니터 DPI 기준 상대 좌표**로. 관련 노트는 [[릴리스 절차|절차]] 참고.',
  '',
  '```js',
  'SetWindowPos(hwnd, HWND_TOPMOST, 0, 0); // #가짜 [[가짜]]',
  '```',
  '',
  '## 소제목 `인라인` **굵게**',
  '',
  '> 인용 *기울임* ~~취소선~~ #태그 [[링크]]',
  '',
  '***굵고 기울임***',
].join('\n')

describe('EditorView 렌더', () => {
  it('데코레이션이 겹치지 않고 그려진다', () => {
    const editor = mount(KITCHEN_SINK)
    expect(editor.state.doc.toString()).toBe(KITCHEN_SINK)
    expect(editor.dom.querySelectorAll('.cm-line').length).toBeGreaterThan(0)
  })

  it('체크박스 위젯이 DOM에 나온다', () => {
    const editor = mount('- [ ] 할 일\n- [x] 끝난 일')
    const boxes = editor.dom.querySelectorAll('.cm-task-checkbox')
    expect(boxes).toHaveLength(2)
    expect(boxes[1].classList.contains('cm-task-checkbox-done')).toBe(true)
  })

  it('커서를 문서 전체에 옮겨도 예외가 나지 않는다', () => {
    const editor = mount(KITCHEN_SINK)
    for (let pos = 0; pos <= editor.state.doc.length; pos += 3) {
      editor.dispatch({ selection: EditorSelection.cursor(pos) })
    }
    expect(editor.state.doc.toString()).toBe(KITCHEN_SINK)
  })

  it('한 글자씩 입력해도 원문이 그대로 쌓인다', () => {
    const editor = mount('')
    const typed = '- [ ] 할 일 **굵게** `코드` [[링크]] #태그'
    for (const ch of typed) {
      editor.dispatch({
        changes: { from: editor.state.doc.length, insert: ch },
        selection: EditorSelection.cursor(editor.state.doc.length + ch.length),
      })
    }
    expect(editor.state.doc.toString()).toBe(typed)
  })

  it('체크박스 mousedown 이 문서 텍스트를 바꾼다 (트랜잭션 dispatch)', () => {
    const editor = mount('- [ ] 할 일')
    const box = editor.dom.querySelector('.cm-task-checkbox') as HTMLElement
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(editor.state.doc.toString()).toBe('- [x] 할 일')

    const nextBox = editor.dom.querySelector('.cm-task-checkbox') as HTMLElement
    nextBox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(editor.state.doc.toString()).toBe('- [ ] 할 일')
  })
})
