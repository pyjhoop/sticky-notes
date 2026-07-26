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
