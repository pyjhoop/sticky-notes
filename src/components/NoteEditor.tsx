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
import { useEffect, useRef } from 'react'

import { createNoteEditorExtensions, externalUpdate } from '../editor'
import { attachmentStoreForRuntime } from '../lib/attachments'
import '../styles/editor.css'

export interface NoteEditorProps {
  /** 마크다운 원문. CodeMirror의 문서가 될 값이다 (CLAUDE.md 절대규칙 3) */
  value: string
  /** 편집마다 호출. 디바운스는 호출자(NoteWindow)가 한다 */
  onChange: (value: string) => void
  /** 창이 뜨자마자 커서를 둘 것인가 */
  autoFocus?: boolean
  /** 접근성 레이블 */
  placeholder?: string
}

export default function NoteEditor({
  value,
  onChange,
  autoFocus = false,
  placeholder = '메모를 입력하세요',
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

  return <div ref={host} className="cm-note-editor selectable" />
}
