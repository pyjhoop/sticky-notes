/**
 * 본문 에디터 — CodeMirror 6 라이브 프리뷰 (M3 · 트랙 B).
 *
 * `{ value, onChange }` 시그니처는 M0 계약이다. 트랙 C의 `NoteWindow`가
 * 이 계약에 의존하므로 바꾸지 않는다.
 *
 * CLAUDE.md 절대규칙 3 — `value`는 사용자가 친 마크다운 원문 그대로이고,
 * 에디터 문서도 그 원문 그대로다. 라이브 프리뷰는 `Decoration`일 뿐이다.
 *
 * **소유: 트랙 B.**
 */

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'

import { createNoteEditorExtensions, externalUpdate } from '../editor'
import { attachmentStoreForRuntime } from '../lib/attachments'
import '../styles/editor.css'

/**
 * 바깥에서 커서를 넣기 위한 최소 핸들.
 *
 * 2026-07-26 사용자 결함 신고 #1 — "메모 클릭하면 커서 깜빡이 해줘야 해".
 * `drawSelection()` 이 그리는 캐럿은 **에디터가 포커스를 가진 동안에만** 보인다
 * (`.cm-focused` 안에서만 `cm-blink` 애니메이션이 돈다). 창만 활성화되고
 * 포커스가 `<body>` 에 남아 있으면 캐럿이 아예 없다. 그래서 창 쪽(NoteWindow)이
 * 포커스를 넘겨줄 수 있어야 한다.
 */
export interface NoteEditorHandle {
  /** 커서를 에디터로. 이미 포커스면 아무 일도 하지 않는다 */
  focus(): void
  /** 문서 끝에 커서를 두고 포커스 — 종이 여백을 클릭했을 때 */
  focusEnd(): void
  /** 화면 좌표에 가장 가까운 위치에 커서를 두고 포커스 */
  focusAt(x: number, y: number): void
  /** 지금 에디터가 포커스를 갖고 있는가 */
  hasFocus(): boolean
}

export interface NoteEditorProps {
  /** 마크다운 원문. CodeMirror의 문서가 될 값이다 (CLAUDE.md 절대규칙 3) */
  value: string
  /** 편집마다 호출. 디바운스는 호출자(NoteWindow)가 한다 */
  onChange: (value: string) => void
  /** 창이 뜨자마자 커서를 둘 것인가 */
  autoFocus?: boolean
  /** 접근성 레이블 */
  placeholder?: string
  /** 커서 제어용 핸들 (React 19 — `ref` 를 그냥 prop 으로 받는다) */
  ref?: Ref<NoteEditorHandle>
}

export default function NoteEditor({
  value,
  onChange,
  autoFocus = false,
  placeholder = '메모를 입력하세요',
  ref,
}: NoteEditorProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  // onChange 는 매 렌더 새 함수일 수 있다. 에디터를 다시 만들지 않으려고 ref로 받는다.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // 최초 마운트에서만 EditorView를 만든다. value/placeholder 변화는 아래 effect가 처리한다.
  const initialRef = useRef({ doc: value, placeholder, autoFocus })

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const initial = initialRef.current

    const view = new EditorView({
      state: EditorState.create({
        doc: initial.doc,
        extensions: createNoteEditorExtensions({
          placeholder: initial.placeholder,
          onChange: (next) => onChangeRef.current(next),
          // M7 — Tauri 밖(브라우저 개발 모드)에서는 undefined 라 붙여넣기가 기본 동작으로 흐른다
          attachments: attachmentStoreForRuntime(),
        }),
      }),
      parent,
    })
    viewRef.current = view
    if (initial.autoFocus) view.focus()

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // 바깥에서 value가 바뀐 경우(DB 로드 등)만 문서를 맞춘다.
  // 사용자가 방금 친 내용이 되돌아가지 않도록 현재 문서와 다를 때만 dispatch 한다.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      // 외부 반영은 사용자 입력이 아니므로 onChange를 되쏘지 않는다.
      annotations: externalUpdate.of(true),
    })
  }, [value])

  useImperativeHandle(
    ref,
    (): NoteEditorHandle => ({
      focus() {
        const view = viewRef.current
        if (view && !view.hasFocus) view.focus()
      },
      focusEnd() {
        const view = viewRef.current
        if (!view) return
        view.focus()
        view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true })
      },
      focusAt(x, y) {
        const view = viewRef.current
        if (!view) return
        view.focus()
        // 좌표가 본문 밖(여백)이면 `posAtCoords` 가 null 이다 — 그때는 문서 끝.
        const pos = view.posAtCoords({ x, y }, false) ?? view.state.doc.length
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
      },
      hasFocus() {
        return viewRef.current?.hasFocus ?? false
      },
    }),
    [],
  )

  return <div ref={host} className="cm-note-editor selectable" />
}
