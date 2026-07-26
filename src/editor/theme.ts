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
      // 스크롤바 폭을 **항상** 예약한다. 내용이 넘치는 순간 본문이 밀리는 것을
      // 막는 유일한 방법이다 (M1 DoD "레이아웃 시프트 없이"와 같은 기준).
      // 예약 폭 = 아래 ::-webkit-scrollbar 의 width 와 같다.
      scrollbarGutter: 'stable',
    },

    /* ── 스크롤바 ────────────────────────────────────────────
     * 디자인 원본에 스크롤바 그림은 없다. 기준은 Windows 11 스티커 메모 —
     * 트랙은 보이지 않고 썸만 가늘게, 포인터가 올라오면 굵고 진해진다.
     * WebView2(Chromium 150) 기본값은 폭 15px + 회색 트랙 + 화살표 버튼이라
     * 종이 위에서 지나치게 크다.
     *
     * ▸ 왜 `::-webkit-scrollbar` 인가 (표준 `scrollbar-width`/`scrollbar-color` 가 아니라)
     *   · 표준 쪽은 폭이 `auto|thin|none` 셋뿐이라 치수를 정할 수 없고,
     *     라운드(알약 썸)도 유휴↔호버 굵기 변화도 표현할 수 없다.
     *   · 한 엘리먼트에 둘을 함께 쓰면 **Chromium 은 표준 속성을 채택하고
     *     ::-webkit-scrollbar 규칙 전체를 무시한다.** 그래서 이 저장소에서는
     *     `scrollbar-width`/`scrollbar-color` 를 **어디에도 쓰지 않는다**
     *     (render.test.ts 가 회귀를 막는다).
     *
     * ▸ 왜 `editor.css` 가 아니라 여기인가
     *   · `.cm-scroller` 는 CodeMirror 가 만드는 엘리먼트다 — 이 파일의 담당 범위
     *     ("여기에는 CodeMirror 구조에 걸리는 것만 둔다", 파일 머리말).
     *   · style-mod 는 <style> 을 head.firstChild **앞**에 넣으므로 일반 CSS 가
     *     문서 순서상 뒤라 명시도가 같으면 이긴다. 즉 editor.css 에 둬도 적용은
     *     되지만, 테마 클래스가 붙는 이 경로가 DOM 구조 변화에 더 안전하고
     *     `render.test.ts` 의 `injectedCss()` 로 주입 여부를 검증할 수 있다.
     *
     * ▸ 레이아웃 시프트 0
     *   · 트랙 폭(--scrollbar-w)은 유휴·호버가 **같다.** 썸 굵기는 투명 border 로만
     *     바뀌므로 문서 폭에 영향이 없다.
     *   · 위 `scrollbar-gutter: stable` 이 스크롤바가 생기는 순간의 시프트를 막는다.
     *
     * ▸ 색은 --on-paper-* 알파 잉크다. 종이색이 5종이라 불투명 회색을 쓰면
     *   어떤 색 위에서는 뜨고 어떤 색 위에서는 묻는다. 알파는 5색 전부에서 성립한다.
     *
     * ▸ 치수는 tokens.css 의 --scrollbar-* 3종이다 (2026-07-26 계약 추가).
     */
    '.cm-scroller::-webkit-scrollbar': {
      width: 'var(--scrollbar-w)',
      height: 'var(--scrollbar-w)',
    },
    '.cm-scroller::-webkit-scrollbar-track, .cm-scroller::-webkit-scrollbar-corner': {
      background: 'transparent',
    },
    // 화살표 버튼 — Windows 11 스크롤바에는 없다.
    '.cm-scroller::-webkit-scrollbar-button': { display: 'none' },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      backgroundColor: 'var(--on-paper-ghost)',
      // 투명 border + padding-box 로 트랙 안에서 썸만 가늘게 그린다.
      backgroundClip: 'padding-box',
      border: 'calc((var(--scrollbar-w) - var(--scrollbar-thumb-w)) / 2) solid transparent',
      borderRadius: 'var(--radius-pill)',
    },
    /* 포인터가 본문 위에 있거나(=스크롤할 참) 썸을 직접 잡았을 때만 또렷해진다.
       CSS 로는 "스크롤 중"을 알 수 없어 :active(드래그)까지가 한계다. */
    '.cm-scroller:hover::-webkit-scrollbar-thumb, .cm-scroller::-webkit-scrollbar-thumb:hover, .cm-scroller::-webkit-scrollbar-thumb:active':
      {
        backgroundColor: 'var(--on-paper-mid)',
        borderWidth: 'calc((var(--scrollbar-w) - var(--scrollbar-thumb-w-hover)) / 2)',
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

    /* ── 줄 ──────────────────────────────────────────────────
     * 기본 테마는 `.cm-line { padding: 0 2px 0 6px }` (dist/index.js:6844).
     * 종이 여백은 `.note-body` 가 --note-body-pad-x 로 이미 주므로 그 6px 는
     * 필요 없다 — **다만 0 으로 만들면 줄 맨 앞의 캐럿이 잘린다.**
     *
     * 확정된 경위 (@codemirror/view 6.43.6):
     *   1. 캐럿 div 의 left 는 `pos.left - base.left` 다 (RectangleMarker.forRange,
     *      dist:9276). base 는 `.cm-scroller` 의 좌측 경계(getBase, dist:9288)이고
     *      `.cm-content{padding:0}` + `.cm-line{padding-left:0}` 이면 줄 첫 글자의
     *      pos.left 가 정확히 그 경계와 같다 → left = 0.
     *   2. 캐럿은 `margin-left: calc(var(--caret-w) / -2)` 로 경계를 **가운데 두고**
     *      걸친다(기본 테마도 -0.6px 로 같은 방식, dist:6881). 즉 상자가
     *      x ∈ [-0.75px, +0.75px] 를 차지한다.
     *   3. `.cm-scroller` 는 `overflow-x: hidden` 이라 스크롤 컨테이너다. LTR 에서
     *      음수 x 는 스크롤로 닿을 수도 없고 패딩 상자 경계에서 **잘린다.**
     *      → 줄 맨 앞에서만 캐럿이 절반(0.75px)으로 깎여 사실상 안 보인다.
     *
     * 그래서 **깎이던 절반만큼만** 왼쪽에 돌려준다. 0.75px 라 본문 시작 위치는
     * 눈으로 구분되지 않고(20px → 20.75px), 캐럿은 경계를 가운데 둔 채 온전히 그려진다.
     * `.cm-code-line`(editor.css)의 padding-left:13px 은 문서 순서상 뒤라 그대로 이긴다.
     */
    '.cm-line': { padding: '0 0 0 calc(var(--caret-w) / 2)' },

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

    /* 현재 줄 강조는 **없다.** 사용자 요청으로 걷어냈다 (2026-07-26).
     * `cm-activeLine` 클래스를 붙이는 곳은 `highlightActiveLine()` 하나뿐이고
     * (@codemirror/view 6.43.6 · dist/index.js:10008), editor/index.ts 에서 그 확장을
     * 뺐으므로 기본 테마의 하늘색 규칙(`&light .cm-activeLine`, dist:6923)도
     * **매칭될 엘리먼트가 없다.** 그것을 끄는 규칙을 따로 둘 필요가 없다. */
  },
  { dark: false },
)

/**
 * 코드블록 안의 언어별 하이라이트.
 *
 * `markdown({ codeLanguages: languages })` (editor/index.ts) 가 `@codemirror/language-data`
 * 를 물려 놓았으므로, 펜스의 언어 태그(```` ```ts ````)에 맞는 lezer 파서가 붙고
 * 그 파서가 내보내는 `@lezer/highlight` 태그를 여기서 클래스로 바꾼다.
 * 실제 색은 `editor.css` 가 `--code-*` 토큰으로 지정한다 — 여기에 색을 쓰지 않는다.
 *
 * ▸ **디자인에 없는 의도적 확장이다.** 디자인 원본(94~97행)이 정한 코드블록 색은
 *   배경 `#2a2521` · 본문 `#d8d2c8` · 키워드 `#c8a2ff` 셋뿐이고, 그 톤(어두운 웜 배경
 *   + 보라 키워드)에 맞춰 8계열로 넓혔다. 색의 근거·대비 계산은 `tokens.css` 의
 *   "코드 블록" 절에 적어 두었다. 사용자 요청 "코드블럭 스타일 언어별로 적용해줘"
 *   (2026-07-26).
 *
 * ▸ **상위 태그 하나로 하위 태그가 전부 걸린다.** `@lezer/highlight` 의 태그는
 *   부모를 갖고(`lineComment = t(comment)`), 스타일 탐색은 태그의 `set`(자기 →
 *   부모 순)을 훑는다. 그래서 `comment` 하나면 line/block/docComment 가 같이 잡히고,
 *   더 구체적인 태그에 규칙을 주면 그쪽이 이긴다 — 아래 `atom`/`null` 이 그 경우다
 *   (둘 다 `keyword` 의 자식이지만 상수 색으로 뽑아낸다).
 *
 * ▸ 주의: `bracket` 은 `punctuation` 의 자식이 **아니다.** 둘 다 적어야 한다.
 */
export const codeHighlightStyle = HighlightStyle.define([
  // ── 키워드 (if/for/class/import/self …) — 디자인이 정한 유일한 신택스 색
  { tag: tags.keyword, class: 'cm-hl-keyword' },

  // ── 타입 · 클래스 · 네임스페이스 · HTML 태그명
  //    typeName 이 tagName 의 부모, name 은 className/namespace 의 부모다.
  { tag: tags.typeName, class: 'cm-hl-type' },
  { tag: tags.className, class: 'cm-hl-type' },
  { tag: tags.namespace, class: 'cm-hl-type' },

  // ── 함수 · 매크로. `function(...)` 은 수식자라 정의·호출 양쪽에 붙는다.
  { tag: tags.function(tags.variableName), class: 'cm-hl-function' },
  { tag: tags.function(tags.propertyName), class: 'cm-hl-function' },
  { tag: tags.macroName, class: 'cm-hl-function' },

  // ── 변수 · 속성 · 속성명 · 라벨 (propertyName 이 attributeName 의 부모)
  { tag: tags.variableName, class: 'cm-hl-variable' },
  { tag: tags.propertyName, class: 'cm-hl-variable' },
  { tag: tags.labelName, class: 'cm-hl-variable' },

  // ── 문자열 (docString · character · attributeValue 가 string 의 자식)
  { tag: tags.string, class: 'cm-hl-string' },
  { tag: tags.regexp, class: 'cm-hl-string' },

  // ── 숫자 · 상수 (integer/float 는 number 의 자식)
  { tag: tags.number, class: 'cm-hl-number' },
  { tag: tags.bool, class: 'cm-hl-number' },
  { tag: tags.null, class: 'cm-hl-number' },
  { tag: tags.atom, class: 'cm-hl-number' },
  { tag: tags.escape, class: 'cm-hl-number' },

  // ── 주석 · 메타(#!/셔뱅, 데코레이터, 어트리뷰트)
  { tag: tags.comment, class: 'cm-hl-comment' },
  { tag: tags.meta, class: 'cm-hl-comment' },

  // ── 연산자 · 구두점 · 괄호
  { tag: tags.operator, class: 'cm-hl-operator' },
  { tag: tags.punctuation, class: 'cm-hl-operator' },
  { tag: tags.bracket, class: 'cm-hl-operator' },
])
