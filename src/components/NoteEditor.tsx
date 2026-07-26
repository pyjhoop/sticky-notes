/**
 * 본문 에디터.
 *
 * **M0 스텁 — 내부는 textarea다.** 트랙 B(M3)가 CodeMirror 6 라이브 프리뷰로 교체한다.
 * 교체 시에도 이 `{ value, onChange }` 시그니처는 유지한다 —
 * 트랙 C의 `NoteWindow`가 이 계약에 의존한다.
 *
 * **소유: 트랙 B.**
 */

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
  // TODO(M3): 트랙 B — CodeMirror 6 + 라이브 프리뷰 확장으로 교체
  return (
    <textarea
      className="selectable"
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      style={{
        flex: 1,
        width: '100%',
        minHeight: 0,
        resize: 'none',
        border: 0,
        outline: 'none',
        background: 'transparent',
        color: 'var(--ink)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-body)',
        lineHeight: 'var(--lh-body)',
        padding: 0,
      }}
    />
  )
}
