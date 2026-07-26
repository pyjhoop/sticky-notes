import { afterEach, describe, expect, it } from 'vitest'

import { errorText, failureNotice } from './errors'
import { IpcError } from './ipc'

/** `isTauri()`가 참이 되도록 흉내낸다 — 브라우저 분기와 앱 분기를 둘 다 본다. */
function pretendTauri(on: boolean) {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

afterEach(() => pretendTauri(false))

describe('errorText', () => {
  it('IpcError는 커맨드 이름과 사유를 함께 보여준다', () => {
    expect(errorText(new IpcError('save_note', '메모를 찾을 수 없습니다'))).toBe(
      'save_note: 메모를 찾을 수 없습니다',
    )
  })

  it('Tauri가 던지는 문자열을 그대로 쓴다', () => {
    expect(errorText('DB가 아직 열리지 않았습니다')).toBe('DB가 아직 열리지 않았습니다')
  })

  it('Error 객체는 message를 쓴다', () => {
    expect(errorText(new Error('창을 찾을 수 없습니다'))).toBe('창을 찾을 수 없습니다')
  })

  it('사유가 비어 있으면 알 수 없는 오류', () => {
    expect(errorText('')).toBe('알 수 없는 오류')
    expect(errorText(null)).toBe('알 수 없는 오류')
    expect(errorText(undefined)).toBe('알 수 없는 오류')
  })

  it('줄바꿈을 접어 한 줄로 만든다', () => {
    expect(errorText('첫 줄\n  둘째 줄')).toBe('첫 줄 둘째 줄')
  })

  it('배너를 넘치게 길면 자른다', () => {
    const text = errorText('가'.repeat(500))
    expect(text.length).toBeLessThanOrEqual(200)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('failureNotice', () => {
  it('앱 안에서는 무엇을 못 했는지 + 사유', () => {
    pretendTauri(true)
    expect(failureNotice('메모를 불러오지 못했습니다', 'no such note')).toBe(
      '메모를 불러오지 못했습니다 — no such note',
    )
  })

  it('브라우저에서는 백엔드가 없다고 정확히 말한다', () => {
    pretendTauri(false)
    expect(failureNotice('메모를 불러오지 못했습니다', 'no such note')).toBe(
      '메모를 불러오지 못했습니다 — 앱(Tauri) 밖에서는 백엔드를 호출할 수 없습니다',
    )
  })
})
