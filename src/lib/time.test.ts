import { describe, expect, it } from 'vitest'
import { formatClock, formatDatePrefix, formatRelative } from './time'

/** 로컬 타임존 기준으로 Date를 만든다 — 테스트가 CI 타임존에 흔들리지 않게. */
function local(y: number, m: number, d: number, h = 0, min = 0, s = 0): Date {
  return new Date(y, m - 1, d, h, min, s)
}

const iso = (d: Date) => d.toISOString()

describe('formatClock', () => {
  it('로컬 24시간 HH:mm', () => {
    expect(formatClock(iso(local(2026, 7, 26, 12, 4)))).toBe('12:04')
    expect(formatClock(iso(local(2026, 7, 26, 0, 0)))).toBe('00:00')
    expect(formatClock(iso(local(2026, 7, 26, 23, 59)))).toBe('23:59')
  })

  it('잘못된 입력은 빈 문자열', () => {
    expect(formatClock('')).toBe('')
    expect(formatClock('not-a-date')).toBe('')
  })
})

describe('formatRelative', () => {
  const now = local(2026, 7, 26, 14, 0)

  it('1분 미만은 방금 전', () => {
    expect(formatRelative(iso(local(2026, 7, 26, 14, 0, 0)), now)).toBe('방금 전')
    expect(formatRelative(iso(local(2026, 7, 26, 13, 59, 30)), now)).toBe('방금 전')
  })

  it('미래 시각도 방금 전으로 접는다 (시계 오차)', () => {
    expect(formatRelative(iso(local(2026, 7, 26, 15, 0)), now)).toBe('방금 전')
  })

  it('분 단위', () => {
    expect(formatRelative(iso(local(2026, 7, 26, 13, 59)), now)).toBe('1분 전')
    expect(formatRelative(iso(local(2026, 7, 26, 13, 1)), now)).toBe('59분 전')
  })

  it('시간 단위', () => {
    expect(formatRelative(iso(local(2026, 7, 26, 13, 0)), now)).toBe('1시간 전')
    expect(formatRelative(iso(local(2026, 7, 26, 12, 0)), now)).toBe('2시간 전')
    expect(formatRelative(iso(local(2026, 7, 25, 15, 0)), now)).toBe('23시간 전')
  })

  it('24시간을 넘고 달력 하루 차이면 어제', () => {
    expect(formatRelative(iso(local(2026, 7, 25, 13, 0)), now)).toBe('어제')
    expect(formatRelative(iso(local(2026, 7, 25, 0, 30)), now)).toBe('어제')
  })

  it('2~6일은 N일 전', () => {
    expect(formatRelative(iso(local(2026, 7, 24, 14, 0)), now)).toBe('2일 전')
    expect(formatRelative(iso(local(2026, 7, 23, 9, 0)), now)).toBe('3일 전')
    expect(formatRelative(iso(local(2026, 7, 20, 9, 0)), now)).toBe('6일 전')
  })

  it('7~13일은 지난주', () => {
    expect(formatRelative(iso(local(2026, 7, 19, 9, 0)), now)).toBe('지난주')
    expect(formatRelative(iso(local(2026, 7, 13, 9, 0)), now)).toBe('지난주')
  })

  it('2주 이상', () => {
    expect(formatRelative(iso(local(2026, 7, 12, 9, 0)), now)).toBe('2주 전')
    expect(formatRelative(iso(local(2026, 7, 1, 9, 0)), now)).toBe('3주 전')
  })

  it('개월 · 년', () => {
    expect(formatRelative(iso(local(2026, 6, 20, 9, 0)), now)).toBe('1개월 전')
    expect(formatRelative(iso(local(2026, 1, 20, 9, 0)), now)).toBe('6개월 전')
    expect(formatRelative(iso(local(2025, 1, 20, 9, 0)), now)).toBe('1년 전')
  })

  it('자정 직전/직후 경계 — 23시간이어도 같은 날이 아니면 시간 단위를 유지한다', () => {
    const midnightish = local(2026, 7, 26, 0, 30)
    expect(formatRelative(iso(local(2026, 7, 25, 22, 30)), midnightish)).toBe('2시간 전')
  })

  it('잘못된 입력은 빈 문자열', () => {
    expect(formatRelative('', now)).toBe('')
    expect(formatRelative('nope', now)).toBe('')
  })
})

describe('formatDatePrefix', () => {
  it('YYYY-MM-DD', () => {
    expect(formatDatePrefix(iso(local(2026, 7, 26, 23, 30)))).toBe('2026-07-26')
    expect(formatDatePrefix(iso(local(2026, 1, 5, 0, 0)))).toBe('2026-01-05')
  })

  it('잘못된 입력은 빈 문자열', () => {
    expect(formatDatePrefix('')).toBe('')
  })
})
