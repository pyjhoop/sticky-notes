/**
 * 실제 `EditorView`를 띄워 보는 스모크 테스트.
 *
 * 데코레이션이 서로 겹치면(특히 `replace` 끼리) CodeMirror는 **렌더 시점에**
 * 예외를 던진다. `buildDecorations` 단위 테스트만으로는 잡히지 않으므로
 * jsdom에 붙여서 한 번 그려 본다.
 */

import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
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
 * **우리 코드를 통째로 지워도 통과한다.**
 *
 * 시트 단위로는 못 가른다 — style-mod 는 모든 `StyleModule` 을 `<style>` **하나에**
 * 몰아 넣는다(기본 테마·drawSelection·우리 테마가 같은 노드에 있다). 대신
 * style-mod 는 규칙 하나를 한 줄로 쓰고 모듈마다 다른 생성 클래스(`.ͼo` 등)를
 * 앞에 붙이므로, **CSS 변수를 쓰는 규칙은 우리 것뿐**이라는 점을 지렛대로
 * 우리 클래스를 알아낸 뒤 그 클래스로 시작하는 줄만 남긴다.
 */
function injectedCss(): string {
  const lines = Array.from(document.head.querySelectorAll('style')).flatMap((el) =>
    (el.textContent ?? '').split('\n'),
  )
  const ours = lines.find((line) => line.startsWith('.') && line.includes('var(--'))
  expect(ours, '우리 테마가 주입되지 않았다').toBeDefined()
  const themeClass = /^\.[^\s.,{]+/.exec(ours as string)?.[0] as string
  return lines.filter((line) => line.startsWith(themeClass)).join('\n')
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
 * 커서(캐럿).
 *
 * 사용자 신고 재발분 — "메모에 커서가 없어서 입력 받을 준비가 됐는지 모르겠다".
 * 캐럿은 `drawSelection()` 이 그리는 `.cm-cursor` div 하나뿐이고 그것은
 * `.cm-focused` 안에서만 보인다. jsdom 에는 레이아웃이 없어서 실제 캐럿 사각형
 * (`RectangleMarker`)은 그려지지 않으므로, 여기서는 **캐럿이 나오기 위한 구조와
 * CSS 규칙이 살아 있는지**를 지킨다.
 */
describe('캐럿', () => {
  it('drawSelection 의 커서 레이어가 스크롤러 직계 자식으로 붙는다', () => {
    const editor = mount('한 줄')
    const layer = editor.dom.querySelector('.cm-cursorLayer')
    expect(layer).not.toBeNull()
    // 기본 테마는 `&.cm-focused > .cm-scroller > .cm-cursorLayer` 로만 캐럿을 켠다.
    // 이 직계 관계가 깨지면 캐럿이 조용히 사라진다.
    expect(layer!.parentElement).toBe(editor.scrollDOM)
    expect(editor.scrollDOM.parentElement).toBe(editor.dom)
  })

  it('테마가 캐럿 규칙을 실제로 주입한다', () => {
    mount('한 줄')
    const css = injectedCss()

    // 캐럿: 자손 셀렉터 복제본 + --ink 색 + 굵기
    expect(css).toContain('.cm-cursorLayer .cm-cursor')
    expect(css).toContain('border-left-color: var(--ink)')
    expect(css).toContain('border-left-width: var(--caret-w)')
    // 깜빡임 — 기본 테마는 `animation` 단축 속성이라 롱핸드는 우리 것뿐이다.
    // (`@keyframes cm-blink` 는 기본 테마가 정의하므로 단언하지 않는다 — 늘 통과한다)
    expect(css).toContain('animation-name: cm-blink')
  })

  /**
   * 줄 맨 앞 캐럿이 잘리는 회귀를 막는다.
   *
   * 캐럿 div 는 글자 경계를 **가운데 두고** 걸친다(`margin-left: -캐럿굵기/2`).
   * 줄 첫 글자의 x 는 `.cm-scroller` 의 좌측 경계와 같으므로, 왼쪽 절반이 음수 x 로
   * 나가고 `overflow-x: hidden` 이 그걸 잘라낸다 → 맨 앞에서만 캐럿이 반쪽이 된다.
   * 그래서 잘리던 만큼을 `.cm-line` 왼쪽 여백으로 돌려준다.
   *
   * jsdom 에는 레이아웃이 없어 실제 픽셀을 잴 수 없다. 대신 이 세 규칙이
   * **함께** 성립해야 한다는 관계를 고정한다 — 하나라도 되돌리면 실패한다.
   */
  it('줄 맨 앞에서도 캐럿이 잘리지 않도록 .cm-line 이 캐럿 절반을 비워 둔다', () => {
    mount('한 줄')

    expect(ruleFor('border-left-width: var(--caret-w)')).toContain(
      'margin-left: calc(var(--caret-w) / -2)',
    )
    expect(ruleFor('.cm-scroller {')).toContain('overflow-x: hidden')
    expect(ruleFor('.cm-line {')).toContain('padding: 0 0 0 calc(var(--caret-w) / 2)')
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
  })

  /**
   * 현재 줄 강조는 **없다** (사용자 요청, 2026-07-26).
   * `cm-activeLine` 클래스를 붙이는 곳은 `highlightActiveLine()` 하나뿐이므로
   * (@codemirror/view 6.43.6 · dist/index.js:10008) 확장을 빼면 클래스 자체가
   * 생기지 않는다 — 기본 테마의 하늘색 규칙(dist:6923)도 매칭될 대상이 없다.
   * 그래서 그것을 끄는 CSS 를 따로 두지 않는다.
   */
  it('현재 줄 강조를 넣지 않는다', () => {
    const editor = mount('첫 줄\n둘째 줄\n셋째 줄')
    editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.line(2).from + 1) })

    expect(editor.dom.querySelector('.cm-activeLine')).toBeNull()
    expect(injectedCss()).not.toContain('cm-activeLine')
  })
})

/**
 * 코드블록 안에서의 캐럿·선택.
 *
 * 사용자 신고 — "마크다운 내에서 캐럿이 안 보이고 다크 모드여서."
 * 캐럿 색 `--ink` 와 코드블록 배경 `--code-bg` 가 **둘 다 #2a2521** 이라 묻힌다.
 *
 * 캐럿 div 는 `.cm-cursorLayer` 안에 있고 그건 `.cm-line` 의 자손이 아니므로
 * (`.cm-code-line .cm-cursor` 는 **절대 매칭되지 않는다**) 상태 판정 → 에디터 루트
 * class 로 우회한다. 그래서 여기서 지키는 것은 두 가지다:
 *   ① 커서 위치에 따라 루트 class 가 실제로 붙고 떨어지는가 (동작)
 *   ② 그 class 에 걸린 색 규칙이 주입되는가 (CSS)
 * ①이 본체다 — ②만 있으면 판정 로직을 통째로 지워도 통과한다.
 */
const CODE_DOC = ['본문 한 줄', '', '```js', 'const x = 1', '```', '', '뒤 본문'].join('\n')

describe('코드블록 안 캐럿·선택', () => {
  /** 지정한 줄(1-based)의 지정 칸에 커서를 두고 루트 class 목록을 돌려준다. */
  function caretAt(editor: EditorView, lineNumber: number, column = 0): DOMTokenList {
    const line = editor.state.doc.line(lineNumber)
    editor.dispatch({ selection: EditorSelection.cursor(line.from + column) })
    return editor.dom.classList
  }

  it('커서가 코드블록 줄 위일 때만 cm-caret-in-code 가 붙는다', () => {
    const editor = mount(CODE_DOC)

    // 종이 본문 — 붙지 않는다
    expect(caretAt(editor, 1, 2).contains('cm-caret-in-code')).toBe(false)
    // 여는 펜스 · 코드 본문 · 닫는 펜스 — 전부 어두운 배경 안이므로 붙는다
    expect(caretAt(editor, 3, 1).contains('cm-caret-in-code')).toBe(true)
    expect(caretAt(editor, 4, 5).contains('cm-caret-in-code')).toBe(true)
    expect(caretAt(editor, 5, 0).contains('cm-caret-in-code')).toBe(true)
    // 블록 뒤 빈 줄 · 뒤 본문 — 다시 떨어진다
    expect(caretAt(editor, 6, 0).contains('cm-caret-in-code')).toBe(false)
    expect(caretAt(editor, 7, 1).contains('cm-caret-in-code')).toBe(false)
  })

  it('클래스가 붙는 줄과 어두운 배경이 깔리는 줄이 정확히 같다', () => {
    const editor = mount(CODE_DOC)
    const codeLines = new Set<number>()
    for (const el of Array.from(editor.dom.querySelectorAll('.cm-code-line'))) {
      const pos = editor.posAtDOM(el)
      codeLines.add(editor.state.doc.lineAt(pos).number)
    }
    expect(codeLines.size).toBeGreaterThan(0)

    for (let n = 1; n <= editor.state.doc.lines; n++) {
      expect(caretAt(editor, n).contains('cm-caret-in-code'), `${n}번째 줄`).toBe(codeLines.has(n))
    }
  })

  it('코드블록 안에서만 선택 영역 색을 바꾼다 — 걸친 선택은 건드리지 않는다', () => {
    const editor = mount(CODE_DOC)
    const code = editor.state.doc.line(4)

    // 코드블록 한 줄 안의 선택
    editor.dispatch({ selection: EditorSelection.range(code.from, code.to) })
    expect(editor.dom.classList.contains('cm-selection-in-code')).toBe(true)

    // 종이 본문에서 코드블록으로 걸친 선택 — 한쪽에서 반드시 묻히므로 기본색을 쓴다
    editor.dispatch({
      selection: EditorSelection.range(editor.state.doc.line(1).from, code.to),
    })
    expect(editor.dom.classList.contains('cm-selection-in-code')).toBe(false)

    // 빈 커서는 선택이 아니다
    editor.dispatch({ selection: EditorSelection.cursor(code.from) })
    expect(editor.dom.classList.contains('cm-selection-in-code')).toBe(false)
  })

  it('테마가 코드블록 전용 캐럿·선택 색을 주입한다', () => {
    mount(CODE_DOC)

    // 캐럿은 코드 본문색으로 바뀐다 (종이에서 --ink 인 것과 같은 규칙)
    const caret = ruleFor('.cm-caret-in-code .cm-cursor')
    expect(caret).toContain('border-left-color: var(--code-fg)')
    // 기본 캐럿 규칙은 그대로 --ink 여야 한다 — 종이 위 캐럿을 망가뜨리면 안 된다
    expect(ruleFor('border-left-width: var(--caret-w)')).toContain(
      'border-left-color: var(--ink)',
    )

    // 선택은 전용 토큰. --selection-bg 를 그대로 쓰면 어두운 배경에서 묻힌다
    const selection = ruleFor('.cm-selection-in-code .cm-selectionBackground')
    expect(selection).toContain('background-color: var(--selection-bg-code)')
  })

  it('자손 셀렉터로 캐럿을 고치려 들지 않는다 (구조상 매칭되지 않는다)', () => {
    // `.cm-cursorLayer` 는 `.cm-line` 의 형제의 부모 쪽에 있다. 아래 셀렉터는
    // 어떤 DOM 에서도 매칭되지 않으므로, 누가 다시 넣으면 조용히 죽는 규칙이 된다.
    mount(CODE_DOC)
    expect(injectedCss()).not.toContain('.cm-code-line .cm-cursor')
    expect(injectedCss()).not.toContain('.cm-code-line .cm-selectionBackground')
  })
})

/**
 * Tab / Shift-Tab 들여쓰기.
 *
 * 사용자 신고 — "코드블록 내부에 탭이 안 먹는데 이건 어쩔 수 없나?"
 * `defaultKeymap`은 Tab을 일부러 비워 둔다(포커스 이동 규약). 코드블록·목록
 * 안에서만 들여쓰기로 쓰고 그 밖에서는 흘려보낸다 — 근거는 `editor/indent.ts`.
 *
 * **CSS를 보는 테스트가 아니다.** 실제 keydown 이벤트를 만들어 문서 텍스트가
 * 바뀌는지로 검증한다.
 */
describe('Tab 들여쓰기', () => {
  /** 진짜 keydown을 흘려보내고, CodeMirror가 기본 동작을 막았는지 돌려준다. */
  function pressTab(editor: EditorView, shift = false): boolean {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      keyCode: 9,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    })
    editor.contentDOM.dispatchEvent(event)
    return event.defaultPrevented
  }

  /** `line`번째 줄의 `column`칸에 커서를 둔다. */
  function put(editor: EditorView, line: number, column = 0): void {
    editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.line(line).from + column) })
  }

  it('코드블록 안에서 Tab이 줄을 들여쓴다', () => {
    const editor = mount('```js\nconst x = 1\n```')
    put(editor, 2, 5)
    expect(pressTab(editor)).toBe(true)
    expect(editor.state.doc.toString()).toBe('```js\n  const x = 1\n```')
  })

  it('Shift-Tab이 되돌린다', () => {
    const editor = mount('```js\n    const x = 1\n```')
    put(editor, 2, 6)
    expect(pressTab(editor, true)).toBe(true)
    expect(editor.state.doc.toString()).toBe('```js\n  const x = 1\n```')
  })

  it('목록 안에서도 먹는다 — 할 일·순서 목록 포함', () => {
    const editor = mount('- 항목\n- [ ] 할 일\n\n1. 첫째')
    put(editor, 1, 3)
    expect(pressTab(editor)).toBe(true)
    put(editor, 2, 3)
    expect(pressTab(editor)).toBe(true)
    put(editor, 4, 3)
    expect(pressTab(editor)).toBe(true)
    expect(editor.state.doc.toString()).toBe('  - 항목\n  - [ ] 할 일\n\n  1. 첫째')
  })

  /**
   * 접근성 탈출구. 문단에서 Tab이 먹히면 키보드만으로 에디터를 못 빠져나가고,
   * 스페이스 2칸이 두 번 쌓이면 CommonMark의 들여쓴 코드블록이 되어 문단이
   * 검은 상자로 변한다.
   */
  it('문단·제목·인용에서는 먹지 않는다 — 문서도 안 바뀌고 기본 동작도 안 막는다', () => {
    const doc = '# 제목\n\n그냥 문단\n\n> 인용'
    const editor = mount(doc)
    for (const line of [1, 3, 5]) {
      put(editor, line, 1)
      expect(pressTab(editor), `${line}번째 줄`).toBe(false)
    }
    expect(editor.state.doc.toString()).toBe(doc)
  })

  it('코드블록과 문단에 걸친 선택은 들여쓰지 않는다', () => {
    const doc = '문단\n\n```js\nconst x = 1\n```'
    const editor = mount(doc)
    editor.dispatch({
      selection: EditorSelection.range(0, editor.state.doc.line(4).to),
    })
    expect(pressTab(editor)).toBe(false)
    expect(editor.state.doc.toString()).toBe(doc)
  })

  /**
   * 탭 문자 금지. `process.md` 통합 게이트 #3 — Rust `after_space_indent()`와
   * 프론트 `FENCE_OPEN_RE`는 **스페이스만** 0~3칸을 펜스 들여쓰기로 인정하는데
   * lezer-markdown은 CommonMark대로 탭을 4칸으로 확장한다. 탭을 넣으면 세 파서가
   * 갈린다. 스페이스 2칸이면 한 번(2칸)은 셋 다 펜스, 두 번(4칸)은 셋 다 펜스 아님.
   */
  it('넣는 것은 스페이스 2칸이다 — 탭 문자를 쓰지 않는다', () => {
    const editor = mount('```js\nx\n```')
    put(editor, 2)
    pressTab(editor)
    pressTab(editor)
    expect(editor.state.doc.toString()).toBe('```js\n    x\n```')
    expect(editor.state.doc.toString()).not.toContain('\t')
  })

  it('펜스 줄을 한 번 들여써도 프론트·Rust의 펜스 판정이 유지된다', () => {
    const editor = mount('```js\nx\n```')
    put(editor, 1)
    pressTab(editor)
    // src/lib/markdown.ts 의 FENCE_OPEN_RE 와 src-tauri/src/notes.rs 의
    // after_space_indent() 가 함께 인정하는 범위 = 스페이스 0~3칸
    const fenceOpen = /^ {0,3}(`{3,}|~{3,})/
    expect(fenceOpen.test(editor.state.doc.line(1).text)).toBe(true)
    // 여전히 코드블록으로 파싱된다 (lezer 쪽도 같은 판정)
    expect(editor.dom.querySelectorAll('.cm-code-line').length).toBe(3)
  })

  it('선택한 여러 줄을 한 번에 들여쓴다', () => {
    const editor = mount('```js\na\nb\n```')
    editor.dispatch({
      selection: EditorSelection.range(
        editor.state.doc.line(2).from,
        editor.state.doc.line(3).to,
      ),
    })
    expect(pressTab(editor)).toBe(true)
    expect(editor.state.doc.toString()).toBe('```js\n  a\n  b\n```')
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

  /**
   * 사용자 신고 — "스크롤과 우측 끝 여백이 많다. 스크롤을 우측 끝으로 붙여줘."
   *
   * 원인은 여백을 **누가 주느냐**였다. `.note-body` 가 좌우 20px 을 주면 그 안에
   * 들어가는 `.cm-scroller` 의 오른쪽 경계가 종이 끝에서 20px 안으로 밀리고,
   * 스크롤바는 스크롤러 경계에 그려지므로 함께 밀린다. 여백을 없앨 수는 없으니
   * (글자가 종이에 붙는다) 여백을 스크롤러 **안쪽**(`.cm-content`)으로 옮겼다.
   *
   * jsdom 에는 레이아웃도 스크롤바도 없고 `note.css` 는 로드되지도 않는다.
   * 여기서 지킬 수 있는 것은 **여백이 스크롤러 안쪽에 있다**는 구조 하나다 —
   * 그것이 스크롤바가 끝에 붙는 유일한 조건이다.
   */
  it('본문 여백은 스크롤러 바깥이 아니라 안쪽(.cm-content)에 있다', () => {
    mount('한 줄')

    const content = ruleFor('.cm-content {')
    expect(content).toContain('padding-left: var(--note-body-pad-x)')
    expect(content).toContain('padding-top: var(--note-body-pad-y)')
    expect(content).toContain('padding-bottom: var(--note-body-pad-bottom)')
    // 오른쪽만 스크롤바 예약 폭을 뺀다 — 그래야 글자 좌우 여백이 20px 로 같아진다
    expect(content).toContain(
      'padding-right: calc(var(--note-body-pad-x) - var(--scrollbar-w))',
    )

    // 스크롤러가 여백을 갖는 순간 스크롤바가 다시 안쪽으로 밀린다
    const scroller = ruleFor('.cm-scroller {')
    expect(scroller).not.toMatch(/(^|[;{ ])padding/)
    expect(scroller).not.toMatch(/(^|[;{ ])margin/)
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

/**
 * 코드블록 언어별 신택스 하이라이트.
 *
 * `markdown({ codeLanguages: languages })` (editor/index.ts) 가 펜스의 언어 태그에
 * 맞는 lezer 파서를 붙이고, `codeHighlightStyle` (editor/theme.ts) 이 그 파서가
 * 내보내는 태그를 `cm-hl-*` 클래스로 바꾼다. 색은 `editor.css` 가 `--code-*`
 * 토큰으로 준다 (jsdom 은 CSS 를 적용하지 않으므로 여기서는 **클래스**까지 본다 —
 * 클래스가 틀리면 색도 틀린다).
 *
 * ▸ 언어 파서는 **비동기로 로드된다.** `getCodeParser`(@codemirror/lang-markdown
 *   dist:75)는 `LanguageDescription.support` 가 채워지기 전에는 파싱을 건너뛴다.
 *   그래서 마운트 **전에** `load()` 를 기다린다. `languages` 배열은 우리 코드와
 *   같은 인스턴스라 로드 결과가 그대로 공유된다.
 */
const LANGUAGE_CASES: Array<{ lang: string; code: string; tokens: Record<string, string> }> = [
  {
    lang: 'js',
    code: 'const x = 1; // 메모\nfunction f(a) { return "s" }',
    tokens: {
      const: 'cm-hl-keyword',
      x: 'cm-hl-variable',
      '=': 'cm-hl-operator',
      '1': 'cm-hl-number',
      '// 메모': 'cm-hl-comment',
      f: 'cm-hl-function',
      '"s"': 'cm-hl-string',
    },
  },
  {
    lang: 'ts',
    code: 'type T = { a: number }\nexport const g = (x: T): string => x.a',
    tokens: {
      type: 'cm-hl-keyword',
      T: 'cm-hl-type',
      number: 'cm-hl-type',
      string: 'cm-hl-type',
      a: 'cm-hl-variable',
    },
  },
  {
    lang: 'python',
    code: '# 메모\nimport os\nclass A:\n    def f(self, n=1):\n        return "s"',
    tokens: {
      '# 메모': 'cm-hl-comment',
      import: 'cm-hl-keyword',
      A: 'cm-hl-type',
      f: 'cm-hl-function',
      self: 'cm-hl-variable',
      '1': 'cm-hl-number',
      '"s"': 'cm-hl-string',
    },
  },
  {
    lang: 'rust',
    code: '// 메모\nfn main() { let x: u32 = 1; println!("hi"); }',
    tokens: {
      '// 메모': 'cm-hl-comment',
      fn: 'cm-hl-keyword',
      main: 'cm-hl-function',
      u32: 'cm-hl-type',
      '1': 'cm-hl-number',
      '"hi"': 'cm-hl-string',
      ';': 'cm-hl-operator',
    },
  },
  {
    lang: 'json',
    code: '{ "a": 1, "b": [true, null, "s"] }',
    tokens: {
      '"a"': 'cm-hl-variable',
      '1': 'cm-hl-number',
      true: 'cm-hl-number',
      null: 'cm-hl-number',
      '"s"': 'cm-hl-string',
      '{': 'cm-hl-operator',
    },
  },
  {
    lang: 'bash',
    code: '# 메모\nexport A=1\nif [ -f x ]; then echo "hi"; fi',
    tokens: {
      '# 메모': 'cm-hl-comment',
      export: 'cm-hl-keyword',
      '1': 'cm-hl-number',
      if: 'cm-hl-keyword',
      '"hi"': 'cm-hl-string',
    },
  },
]

describe('코드블록 언어별 하이라이트', () => {
  /** 코드블록 줄 안에서 `text` 와 정확히 일치하는 첫 토큰의 클래스. */
  function tokenClass(editor: EditorView, text: string): string | null {
    for (const line of Array.from(editor.dom.querySelectorAll('.cm-code-line'))) {
      for (const span of Array.from(line.querySelectorAll('span'))) {
        if (span.textContent === text) return span.className
      }
    }
    return null
  }

  for (const { lang, code, tokens } of LANGUAGE_CASES) {
    it(`${lang} 코드블록의 토큰마다 계열에 맞는 클래스가 붙는다`, async () => {
      const desc = LanguageDescription.matchLanguageName(languages, lang, true)
      expect(desc, `${lang} 언어를 language-data 에서 못 찾았다`).toBeTruthy()
      await desc!.load()

      const editor = mount('```' + lang + '\n' + code + '\n```')

      for (const [text, expected] of Object.entries(tokens)) {
        expect(tokenClass(editor, text), `${lang}: ${text}`).toBe(expected)
      }
    })
  }

  it('위 케이스가 여덟 계열을 전부 덮는다', () => {
    // 한 계열이라도 실측 없이 늘어나면 "색은 있는데 아무도 안 쓰는" 상태가 된다.
    const covered = new Set(LANGUAGE_CASES.flatMap((c) => Object.values(c.tokens)))
    expect([...covered].sort()).toEqual([
      'cm-hl-comment',
      'cm-hl-function',
      'cm-hl-keyword',
      'cm-hl-number',
      'cm-hl-operator',
      'cm-hl-string',
      'cm-hl-type',
      'cm-hl-variable',
    ])
  })
})
