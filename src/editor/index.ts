/**
 * 메모 본문 에디터 — CodeMirror 6 확장 조립.
 *
 * **소유: 트랙 B (M3).**
 *
 * plan.md M3:
 *   `markdown({ codeLanguages: languages })` + `lineWrapping` 위에,
 *   `syntaxTree` 순회로 `DecorationSet`을 만드는 `ViewPlugin`.
 *
 * CLAUDE.md 절대규칙 3 — 이 파일의 어떤 확장도 문서 텍스트를 건드리지 않는다.
 * 라이브 프리뷰는 전부 `Decoration`이다.
 */

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Annotation, type EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  keymap,
  placeholder as placeholderExt,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

import { buildInlineDecorations } from './inlineMarkers'
import { buildImageDecorations, imageAttachments, type AttachmentStore } from './images'
import { type DecoRange } from './shared'
import { buildTaskDecorations } from './taskList'
import { codeHighlightStyle, noteEditorTheme } from './theme'
import { buildWikilinkTagDecorations } from './wikilinkTag'

export { cursorInside } from './shared'
export { buildWikilinkTagDecorations } from './wikilinkTag'
export { buildTaskDecorations } from './taskList'
export { buildInlineDecorations } from './inlineMarkers'
export { taskMarkerToggle, TaskCheckboxWidget } from './taskList'
export {
  buildImageDecorations,
  handlePaste,
  imageFilesFrom,
  imageInsertText,
  insertPastedImages,
  parseImageMarkdown,
} from './images'
export type { AttachmentStore } from './images'

/**
 * 상태 하나로부터 전체 데코레이션을 만든다.
 *
 * 뷰 없이도 돌아가는 순수 함수라 테스트에서 DOM 없이 검증할 수 있다.
 * `ranges`는 보통 `view.visibleRanges` — 화면 밖은 계산하지 않는다.
 */
export function buildDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const out: DecoRange[] = []
  const seenFences = new Set<number>()

  // 이미지가 먼저다 — `![](…)` 는 통째로 위젯이 되므로, 그 안쪽에 다른 모듈이
  // 만든 `replace`(마커 숨김 등)가 겹치면 CodeMirror가 렌더 시점에 예외를 던진다.
  const covered: Array<[number, number]> = []
  for (const { from, to } of ranges) {
    buildImageDecorations(state, from, to, out, covered)
  }

  const rest: DecoRange[] = []
  for (const { from, to } of ranges) {
    buildTaskDecorations(state, from, to, rest)
    buildInlineDecorations(state, from, to, rest, seenFences)
    buildWikilinkTagDecorations(state, from, to, rest)
  }
  for (const deco of rest) {
    if (covered.some(([a, b]) => deco.from >= a && deco.to <= b)) continue
    out.push(deco)
  }

  // sort=true — 모듈별로 순서 없이 넣어도 RangeSet이 정렬한다.
  return Decoration.set(out, true)
}

/** 문서·뷰포트·선택이 바뀔 때마다 데코레이션을 다시 만든다. */
export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state, view.visibleRanges)
    }

    update(update: ViewUpdate) {
      // 선택이 바뀌면 마커 노출 여부가 바뀌므로 selectionSet도 트리거다.
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.state, update.view.visibleRanges)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/**
 * "이 트랜잭션은 사용자 입력이 아니라 외부(DB) 반영이다" 표시.
 *
 * `NoteEditor`가 바깥 `value`를 문서에 밀어 넣을 때 붙이고,
 * `onChange` 되먹임(저장 → 재로드 → 다시 저장)을 끊는 데 쓴다.
 */
export const externalUpdate = Annotation.define<boolean>()

export interface NoteEditorOptions {
  /** 편집마다 마크다운 원문을 그대로 넘긴다. 디바운스는 호출자 몫. */
  onChange?: (value: string) => void
  /** 빈 문서에 보여줄 안내 문구 */
  placeholder?: string
  /** M7 이미지 첨부. 없으면 붙여넣기가 기본 동작(텍스트)으로 흐른다 */
  attachments?: AttachmentStore
}

/**
 * 메모 창 본문 에디터의 확장 묶음.
 *
 * 순서가 의미를 가진다 — `livePreview`가 `markdown()` 뒤에 와야
 * `syntaxTree`가 채워진 상태로 데코레이션을 만든다.
 */
export function createNoteEditorExtensions(options: NoteEditorOptions = {}): Extension[] {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    keymap.of([...defaultKeymap, ...historyKeymap]),

    // base: markdownLanguage → GFM(태스크 리스트·취소선)까지 파싱한다.
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    EditorView.lineWrapping,

    livePreview,
    syntaxHighlighting(codeHighlightStyle),
    noteEditorTheme,
    EditorView.contentAttributes.of({ spellcheck: 'false' }),
    imageAttachments(options.attachments),
  ]

  if (options.placeholder) extensions.push(placeholderExt(options.placeholder))

  if (options.onChange) {
    const onChange = options.onChange
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        if (update.transactions.some((tr) => tr.annotation(externalUpdate))) return
        onChange(update.state.doc.toString())
      }),
    )
  }

  return extensions
}
