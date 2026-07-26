/**
 * 저장 상태 푸터 — `● 제목 · 저장됨 12:04`.
 *
 * 디자인(114~119행)의 동기화 푸터를 **레이아웃 그대로 두고 의미만** 바꾼 것이다
 * (`plan.md` "디자인 대비 변경점"). 옵시디언 동기화는 v1 범위 밖이므로
 * `Vault` · `동기화` 같은 문구는 쓰지 않는다.
 *
 * 상태 점: 저장됨 `--green-done` / 저장 중 `--yellow-saving`.
 *
 * **소유: 트랙 C (M1).**
 */

import type { MouseEvent } from 'react'

export type SaveStatus = 'saved' | 'saving'

export interface SaveFooterProps {
  /** body에서 파생된 제목 */
  title: string
  status: SaveStatus
  /** 마지막 저장 시각. 없으면 시각을 표시하지 않는다 */
  savedAt: Date | null
  /** 푸터 빈 영역 mousedown → 창 드래그 */
  onDragStart?: (e: MouseEvent<HTMLElement>) => void
}

/** `12:04` — 24시간 2자리. */
export function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export default function SaveFooter({ title, status, savedAt, onDragStart }: SaveFooterProps) {
  const saving = status === 'saving'
  const label = saving ? '저장 중' : savedAt ? `저장됨 · ${formatClock(savedAt)}` : '저장됨'

  return (
    <div
      className="note-footer"
      onMouseDown={(e) => {
        // 푸터에는 상호작용 요소가 없다 — 제목·시각 위에서도 창이 끌려야 한다.
        // (본문 여백은 이제 커서 배치라 이 바가 컨트롤 바와 함께 이동 손잡이다)
        if (e.button === 0) onDragStart?.(e)
      }}
    >
      <span className={`note-footer__dot${saving ? ' is-saving' : ''}`} />
      <span className="note-footer__title">{title || '제목 없음'}</span>
      <span className="note-footer__spacer" />
      <span className="note-footer__state">{label}</span>
    </div>
  )
}
