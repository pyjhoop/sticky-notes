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

/**
 * **우리 테마가 주입한** CSS만 모은다.
 *
 * head 전체를 합치면 CodeMirror 기본 테마까지 섞인다. 그러면
 * `@keyframes cm-blink` 나 `.cm-cursorLayer .cm-cursor` 같은 단언이
 * **우리 코드를 통째로 지워도 통과한다.** 기본 테마는 CSS 변수를 쓰지 않으므로
 * `var(--` 를 담은 시트만 남기면 우리 것만 걸러진다.
 */
function injectedCss(): string {
  return Array.from(document.head.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .filter((css) => css.includes('var(--'))
    .join('\n')
}

/**
 * 주입된 CSS에서 `fragment`를 포함하는 규칙 **한 줄**을 꺼낸다.
 * style-mod는 규칙 하나를 한 줄(`셀렉터 {a: b; c: d}`)로 쓴다.
 */
function ruleFor(fragment: string): string {
  const rule = injectedCss()
    .split('\n')
    .find((line) => line.includes(fragment))
  expect(rule, `${fragment} 규칙이 주입되지 않았다`).toBeDefined()
  return rule as string
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

/**
 * 커서(캐럿)와 현재 줄.
 *
 * 사용자 신고 재발분 — "메모에 커서가 없어서 어느 라인인지, 입력 받을 준비가 됐는지
 * 모르겠다". 캐럿은 `drawSelection()` 이 그리는 `.cm-cursor` div 하나뿐이고
 * 그것은 `.cm-focused` 안에서만 보인다. jsdom 에는 레이아웃이 없어서 실제 캐럿
 * 사각형(`RectangleMarker`)은 그려지지 않으므로, 여기서는 **캐럿과 현재 줄이
 * 나오기 위한 구조와 CSS 규칙이 살아 있는지**를 지킨다.
 */
describe('캐럿 · 현재 줄', () => {
  it('drawSelection 의 커서 레이어가 스크롤러 직계 자식으로 붙는다', () => {
    const editor = mount('한 줄')
    const layer = editor.dom.querySelector('.cm-cursorLayer')
    expect(layer).not.toBeNull()
    // 기본 테마는 `&.cm-focused > .cm-scroller > .cm-cursorLayer` 로만 캐럿을 켠다.
    // 이 직계 관계가 깨지면 캐럿이 조용히 사라진다.
    expect(layer!.parentElement).toBe(editor.scrollDOM)
    expect(editor.scrollDOM.parentElement).toBe(editor.dom)
  })

  it('커서가 있는 줄에만 cm-activeLine 이 붙는다', () => {
    const editor = mount('첫 줄\n둘째 줄\n셋째 줄')
    const secondLine = editor.state.doc.line(2)
    editor.dispatch({ selection: EditorSelection.cursor(secondLine.from + 1) })

    const lines = Array.from(editor.dom.querySelectorAll('.cm-line'))
    const active = lines.filter((el) => el.classList.contains('cm-activeLine'))
    expect(active).toHaveLength(1)
    expect(active[0]).toBe(lines[1])
  })

  it('커서를 옮기면 현재 줄 표시도 따라간다', () => {
    const editor = mount('첫 줄\n둘째 줄\n셋째 줄')
    const activeIndex = () =>
      Array.from(editor.dom.querySelectorAll('.cm-line')).findIndex((el) =>
        el.classList.contains('cm-activeLine'),
      )

    editor.dispatch({ selection: EditorSelection.cursor(0) })
    expect(activeIndex()).toBe(0)

    editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.line(3).from) })
    expect(activeIndex()).toBe(2)
  })

  it('코드블록 줄에서는 cm-activeLine 과 cm-code-line 이 함께 붙는다', () => {
    // 겹치면 CSS `:not(.cm-code-line)` 로 걸러낼 수 있어야 한다 —
    // 코드블록은 이미 어두운 배경이라 강조가 겹치면 지저분해진다.
    const editor = mount('```js\nlet a = 1\n```')
    const inside = editor.state.doc.line(2)
    editor.dispatch({ selection: EditorSelection.cursor(inside.from + 1) })

    const active = editor.dom.querySelector('.cm-activeLine')
    expect(active).not.toBeNull()
    expect(active!.classList.contains('cm-code-line')).toBe(true)
  })

  it('테마가 캐럿·현재 줄 규칙을 실제로 주입한다', () => {
    mount('한 줄')
    const css = injectedCss()

    // 캐럿: 자손 셀렉터 복제본 + --ink 색 + 굵기
    expect(css).toContain('.cm-cursorLayer .cm-cursor')
    expect(css).toContain('border-left-color: var(--ink)')
    expect(css).toContain('border-left-width: var(--caret-w)')
    // 깜빡임 — 기본 테마는 `animation` 단축 속성이라 롱핸드는 우리 것뿐이다.
    // (`@keyframes cm-blink` 는 기본 테마가 정의하므로 단언하지 않는다 — 늘 통과한다)
    expect(css).toContain('animation-name: cm-blink')

    // 현재 줄: 코드블록은 제외, 색은 tokens.css 변수만
    expect(css).toContain('.cm-line.cm-activeLine:not(.cm-code-line)')
    expect(css).toContain('background-color: var(--active-line-bg)')
    expect(css).toContain('background-color: var(--active-line-bg-focused)')
    // 코드블록 줄의 어두운 배경은 강조가 지워 버리면 안 된다
    expect(css).toContain('.cm-line.cm-activeLine.cm-code-line')
    expect(css).toContain('background-color: var(--code-bg)')
  })

  it('포커스가 들어가면 cm-focused 가 붙고, 빠지면 떨어진다', async () => {
    const editor = mount('한 줄')
    editor.focus()
    // jsdom 은 document.hasFocus() 가 true 라 EditorView.hasFocus 가 성립한다.
    expect(editor.hasFocus).toBe(true)
    // CodeMirror 는 focus/blur 를 10ms 뒤에 반영한다 (updateForFocusChange).
    await new Promise((r) => setTimeout(r, 30))
    expect(editor.dom.classList.contains('cm-focused')).toBe(true)

    // 포커스가 빠지면 캐럿도 같이 사라진다 — 이게 "커서가 없다" 의 정체다.
    editor.contentDOM.blur()
    await new Promise((r) => setTimeout(r, 30))
    expect(editor.dom.classList.contains('cm-focused')).toBe(false)
    // 그래도 현재 줄 표시는 남는다 (위치는 계속 보인다).
    expect(editor.dom.querySelector('.cm-activeLine')).not.toBeNull()
  })
})

/**
 * 스크롤바.
 *
 * 사용자 신고 — "스크롤 디자인이 너무 크다". 스타일이 하나도 없어서 WebView2
 * (Chromium) 기본 스크롤바(폭 15px + 회색 트랙 + 화살표 버튼)가 종이 위에 그대로
 * 나왔다. jsdom 에는 스크롤바가 없으므로 **규칙이 주입됐는지**만 지킨다.
 */
describe('스크롤바', () => {
  it('테마가 스크롤바 규칙을 주입한다', () => {
    mount('한 줄')
    const css = injectedCss()

    // 폭을 늘 예약해 스크롤바가 생기는 순간 본문이 밀리지 않게 한다
    expect(css).toContain('scrollbar-gutter: stable')

    // 트랙은 보이지 않고, 화살표 버튼도 없다 (Windows 11 기준)
    expect(ruleFor('.cm-scroller::-webkit-scrollbar-track')).toContain('background: transparent')
    expect(ruleFor('.cm-scroller::-webkit-scrollbar-button')).toContain('display: none')

    // 썸: 알약 라운드 + 종이 5색 어디에서도 성립하는 알파 잉크
    const thumb = ruleFor('.cm-scroller::-webkit-scrollbar-thumb {')
    expect(thumb).toContain('background-color: var(--on-paper-ghost)')
    expect(thumb).toContain('border-radius: var(--radius-pill)')
    // 투명 border + padding-box 가 "트랙 안의 가는 썸"을 만드는 장치다
    expect(thumb).toContain('background-clip: padding-box')

    // 호버·드래그에서만 또렷해진다
    expect(css).toContain('background-color: var(--on-paper-mid)')
  })

  it('표준 scrollbar-width / scrollbar-color 를 쓰지 않는다', () => {
    // 한 엘리먼트에 표준 속성과 ::-webkit-scrollbar 를 같이 쓰면 Chromium 은
    // 표준 쪽을 채택하고 ::-webkit-scrollbar 규칙을 **통째로 무시한다.**
    // 이 단언이 깨지면 위 테마가 화면에서 조용히 사라진다.
    mount('한 줄')
    const css = injectedCss()
    expect(css).not.toMatch(/scrollbar-width\s*:/)
    expect(css).not.toMatch(/scrollbar-color\s*:/)
  })

  it('유휴 ↔ 호버가 트랙 폭을 바꾸지 않는다 (레이아웃 시프트 0)', () => {
    mount('한 줄')

    // 트랙 폭은 한 곳에서만 정해진다
    expect(ruleFor('.cm-scroller::-webkit-scrollbar {')).toContain('width: var(--scrollbar-w')

    // 호버는 색과 **border 굵기**만 바꾼다. width 를 건드리면 본문 폭이 흔들린다.
    const hover = ruleFor('.cm-scroller:hover::-webkit-scrollbar-thumb')
    expect(hover).toContain('border-width:')
    expect(hover.replace(/border-width:/g, '')).not.toContain('width:')
  })
})
