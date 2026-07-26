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
      caretColor: 'var(--ink)',
      // 종이 여백은 NoteWindow가 --note-body-pad-* 로 이미 준다.
    },

    '.cm-line': { padding: '0' },

    // 거터 없음 — 메모지에 줄번호는 없다.
    '.cm-gutters': { display: 'none' },

    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },

    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--selection-bg)',
    },

    '.cm-placeholder': { color: 'var(--on-paper-ghost)' },

    // 코드블록 안에서는 활성 줄 강조를 하지 않는다 (배경이 이미 어둡다).
    '.cm-activeLine': { backgroundColor: 'transparent' },
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
