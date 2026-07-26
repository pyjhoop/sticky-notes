import { describe, expect, it } from 'vitest'

import { deriveTitle, UNTITLED } from './markdown'

// TODO(M3): 트랙 B — 코드블록 내부 #태그·[[링크]] 제외 테스트를 여기에 추가한다.
//           process.md M3 DoD의 필수 항목이다.
describe('제목 파생', () => {
  it('첫 # 제목을 쓴다', () => {
    expect(deriveTitle('# 스프린트 24\n\n본문')).toBe('스프린트 24')
  })

  it('제목이 없으면 첫 비어있지 않은 줄을 쓴다', () => {
    expect(deriveTitle('\n\n장보기 목록\n커피')).toBe('장보기 목록')
  })

  it('빈 본문은 제목 없음', () => {
    expect(deriveTitle('')).toBe(UNTITLED)
    expect(deriveTitle('   \n\n  ')).toBe(UNTITLED)
  })

  it('80자에서 자른다', () => {
    expect(deriveTitle('가'.repeat(200))).toHaveLength(80)
  })
})
