/**
 * 상대 시각 포맷 — 보드 카드 메타 (`2시간 전`, `어제`, `지난주`).
 *
 * 디자인의 `동기화됨` / `로컬 전용` / `동기화 대기` 자리를 상대 수정 시각이 대체한다
 * (`plan.md` "디자인 대비 변경점").
 *
 * **소유: 트랙 D (M5).** M0에서는 시그니처만 확정한다.
 */

/** `저장됨 · 12:04` 의 `12:04` */
export function formatClock(_iso: string, _now: Date = new Date()): string {
  // TODO(M5): 트랙 D
  return ''
}

/** `방금 전` · `2시간 전` · `어제` · `지난주` · `3일 전` */
export function formatRelative(_iso: string, _now: Date = new Date()): string {
  // TODO(M5): 트랙 D
  return ''
}

/** 내보내기 파일명 프리픽스 — `2026-07-26` */
export function formatDatePrefix(_iso: string): string {
  // TODO(M6): 트랙 D
  return ''
}
