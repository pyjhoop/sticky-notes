/**
 * 에디터 테마 — 종이 위에 얹히는 투명 배경, 거터 없음, 본문 14px/1.5.
 *
 * **소유: 트랙 B (M3).**
 *
 * 색·치수는 **전부 `src/styles/tokens.css` 변수 참조**다. 하드코딩하지 않는다
 * (CLAUDE.md "디자인 토큰"). 데코레이션 클래스의 겉모습은
 * `src/styles/editor.css`에 있고, 여기에는 CodeMirror 구조에 걸리는 것만 둔다.
 */

import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/**
 * CodeMirror 구조 스타일.
 *
 * 배경은 반드시 `transparent` — 뒤의 종이색(`--paper-bg`)이 그대로 비쳐야 한다.
 */
export const noteEditorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--ink)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-body)',
      height: '100%',
    },
    '&.cm-focused': { outline: 'none' },

    '.cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: 'var(--lh-body)',
      overflowY: 'auto',
      overflowX: 'hidden',
    },

    '.cm-content': {
      padding: '0',
      // 이 선언은 **무력하다.** drawSelection() 이 Prec.highest 로
      // `.cm-content { caret-color: transparent !important }` 를 깔기 때문이다
      // (@codemirror/view 6.43.6 · dist/index.js:9592 hideNativeSelection).
      // 즉 화면의 캐럿은 전적으로 아래 `.cm-cursor` div 하나에 달려 있다.
      // 그래도 남겨 둔다 — drawSelection() 을 빼는 날 네이티브 캐럿 색이 필요하다.
      caretColor: 'var(--ink)',
      // 종이 여백은 NoteWindow가 --note-body-pad-* 로 이미 준다.
    },

    '.cm-line': { padding: '0' },

    // 거터 없음 — 메모지에 줄번호는 없다.
    '.cm-gutters': { display: 'none' },

    /* ── 캐럿 ────────────────────────────────────────────────
     * 기본 테마의 캐럿은 `border-left: 1.2px`(dist/index.js:6881)라 종이 위에서
     * 눈에 잘 안 띈다. 굵기는 --caret-w(1.5px).
     */
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--ink)',
      borderLeftStyle: 'solid',
      borderLeftWidth: 'var(--caret-w)',
      marginLeft: 'calc(var(--caret-w) / -2)',
    },

    /*
     * 캐럿을 켜는 규칙을 **자손 셀렉터로 한 번 더** 둔다.
     *
     * 기본 테마는 `&.cm-focused > .cm-scroller > .cm-cursorLayer .cm-cursor` 라는
     * 직계 자식 체인으로만 `display:block` 을 준다(dist/index.js:6910). 에디터 루트와
     * 스크롤러 사이에 래퍼가 하나라도 끼면 캐럿이 **조용히** 사라진다 — 화면에는
     * 아무 오류도 안 나고 그냥 커서가 없다. 같은 규칙을 자손 셀렉터로 복제해 두면
     * DOM 구조가 바뀌어도 캐럿이 계속 그려진다.
     */
    '&.cm-focused .cm-cursorLayer .cm-cursor': { display: 'block' },
    '&.cm-focused .cm-cursorLayer': {
      animationName: 'cm-blink',
      animationTimingFunction: 'steps(1)',
      animationIterationCount: 'infinite',
      // 지속 시간은 CodeMirror가 setBlinkRate()로 인라인 지정한다 (기본 1200ms).
    },

    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--selection-bg)',
    },

    '.cm-placeholder': { color: 'var(--on-paper-ghost)' },

    /* ── 현재 줄 ─────────────────────────────────────────────
     * `highlightActiveLine()` (editor/index.ts) 이 붙이는 클래스다.
     *
     * 왜 필요한가: 캐럿은 `.cm-focused` 안에서만 그려진다. 그런데 이 앱의 메모는
     * 항상 위에 떠 있어서 **다른 앱을 쓰는 동안 창이 OS 포커스를 잃는 시간이 훨씬 길다.**
     * 그때 캐럿이 사라지는 건 정상 동작이지만, 화면에 위치를 알려주는 게 아무것도 남지
     * 않으면 "커서가 없다" 로 읽힌다. 줄 강조는 선택 상태에서 나오는 것이라
     * 포커스와 무관하게 **유지된다** — 그래서 위치는 항상 보이고,
     * 깜빡이는 캐럿의 유무가 "지금 입력을 받을 수 있는가" 를 가른다.
     *
     * 코드블록 줄은 제외한다 — --code-bg 로 이미 어두워서 겹치면 지저분해진다.
     */
    // ① 기본 테마의 하늘색 강조(`&light .cm-activeLine { #cceeff44 }`)를 끈다.
    '.cm-activeLine': { backgroundColor: 'transparent' },
    // ② 포커스가 없어도 위치는 남긴다 (옅게).
    '.cm-line.cm-activeLine:not(.cm-code-line)': { backgroundColor: 'var(--active-line-bg)' },
    // ③ 포커스가 있으면 한 단계 진하게 — "지금 여기에 입력된다".
    '&.cm-focused .cm-line.cm-activeLine:not(.cm-code-line)': {
      backgroundColor: 'var(--active-line-bg-focused)',
    },
    // ④ 코드블록 줄은 ①이 배경을 지워 버리므로 --code-bg 를 명시적으로 되돌린다.
    //    (editor.css 의 `.cm-code-line` 은 명시도 1이라 테마 규칙 ①에 진다)
    '.cm-line.cm-activeLine.cm-code-line': { backgroundColor: 'var(--code-bg)' },
  },
  { dark: false },
)

/**
 * 코드블록 안의 언어별 하이라이트.
 *
 * 토큰이 `--code-fg` / `--code-keyword` 두 개뿐이므로 색을 새로 만들지 않고
 * 클래스만 부여한다. 실제 색은 `editor.css`에서 토큰으로 지정한다.
 * (디자인 94~97행: 본문 `#d8d2c8`, 키워드 `#c8a2ff`)
 */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, class: 'cm-hl-keyword' },
  { tag: tags.controlKeyword, class: 'cm-hl-keyword' },
  { tag: tags.moduleKeyword, class: 'cm-hl-keyword' },
  { tag: tags.definitionKeyword, class: 'cm-hl-keyword' },
  { tag: tags.operatorKeyword, class: 'cm-hl-keyword' },
  { tag: tags.self, class: 'cm-hl-keyword' },
  { tag: tags.atom, class: 'cm-hl-keyword' },
  { tag: tags.bool, class: 'cm-hl-keyword' },
  { tag: tags.null, class: 'cm-hl-keyword' },
  { tag: tags.function(tags.variableName), class: 'cm-hl-keyword' },
  { tag: tags.function(tags.propertyName), class: 'cm-hl-keyword' },
  { tag: tags.typeName, class: 'cm-hl-keyword' },
  { tag: tags.className, class: 'cm-hl-keyword' },
  { tag: tags.tagName, class: 'cm-hl-keyword' },

  { tag: tags.comment, class: 'cm-hl-comment' },
  { tag: tags.lineComment, class: 'cm-hl-comment' },
  { tag: tags.blockComment, class: 'cm-hl-comment' },

  { tag: tags.string, class: 'cm-hl-string' },
  { tag: tags.special(tags.string), class: 'cm-hl-string' },
  { tag: tags.number, class: 'cm-hl-string' },
  { tag: tags.regexp, class: 'cm-hl-string' },
])
