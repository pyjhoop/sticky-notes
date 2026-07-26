/**
 * 상대 시각 포맷 — 보드 카드 메타 (`2시간 전`, `어제`, `지난주`).
 *
 * 디자인의 `동기화됨` / `로컬 전용` / `동기화 대기` 자리를 상대 수정 시각이 대체한다
 * (`plan.md` "디자인 대비 변경점").
 *
 * **소유: 트랙 D (M5).**
 *
 * 경계 규칙 — 24시간 미만은 경과 시간, 그 이상은 **로컬 달력 일수** 기준이다.
 * 자정을 넘겼는지가 사람의 체감("어제")을 결정하므로 단순 나눗셈을 쓰지 않는다.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function parse(iso: string): Date | null {
  if (typeof iso !== 'string' || iso.trim() === '') return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 로컬 자정 기준 타임스탬프 — 달력 일수 비교용 */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** `저장됨 · 12:04` 의 `12:04` — 로컬 24시간 표기 */
export function formatClock(iso: string, _now: Date = new Date()): string {
  const d = parse(iso)
  if (!d) return ''
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** `방금 전` · `2시간 전` · `어제` · `지난주` · `3일 전` */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const d = parse(iso)
  if (!d) return ''

  const elapsed = now.getTime() - d.getTime()

  // 미래(시계 오차·타임존 흔들림)는 `방금 전`으로 접는다
  if (elapsed < MINUTE) return '방금 전'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}분 전`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}시간 전`

  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY)
  if (days <= 1) return '어제'
  if (days < 7) return `${days}일 전`
  if (days < 14) return '지난주'
  if (days < 30) return `${Math.floor(days / 7)}주 전`
  if (days < 365) return `${Math.floor(days / 30)}개월 전`
  return `${Math.floor(days / 365)}년 전`
}

/** 내보내기 파일명 프리픽스 — `2026-07-26` (로컬 날짜) */
export function formatDatePrefix(iso: string): string {
  const d = parse(iso)
  if (!d) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
