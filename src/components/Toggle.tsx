/**
 * 40×22 스위치 — 설정 창 전용.
 *
 * 근거: design/Sticky Notes for Windows.dc.html line 222 / 226 / 254
 *   40×22 · radius 11 · padding 2 · knob 18×18
 *   ON  배경 {{ accent }},                 knob #fff
 *   OFF 배경 rgba(255,255,255,.14),        knob #d8d2c8
 *
 * **소유: 트랙 D.**
 */

export interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  /** 스크린리더용 — 시각 레이블은 행 왼쪽에 따로 있다 */
  label: string
  disabled?: boolean
}

export default function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="toggle"
      data-on={checked ? 'true' : 'false'}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="toggle__knob" />
    </button>
  )
}
