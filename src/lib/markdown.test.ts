import { describe, expect, it } from 'vitest'

import {
  derivePreview,
  deriveTitle,
  extractLinks,
  extractTags,
  maskCode,
  UNTITLED,
} from './markdown'

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

  it('코드블록으로 시작하면 펜스 줄을 제목으로 쓰지 않는다', () => {
    const body = '```js\nconst a = 1\n```\n\n실제 제목'
    expect(deriveTitle(body)).toBe('실제 제목')
  })

  it('코드블록 안의 # 제목은 제목이 아니다', () => {
    const body = '```\n# 가짜 제목\n```\n진짜 첫 줄'
    expect(deriveTitle(body)).toBe('진짜 첫 줄')
  })

  it('본문이 코드블록뿐이면 제목 없음', () => {
    expect(deriveTitle('```\ncode\n```')).toBe(UNTITLED)
  })

  it('리스트·태스크 마커를 걷어낸다', () => {
    expect(deriveTitle('- [ ] 설치 관리자 서명 인증서 갱신')).toBe('설치 관리자 서명 인증서 갱신')
  })

  it('강조·인라인 코드 마커를 걷어낸다', () => {
    expect(deriveTitle('# **스프린트** `24`')).toBe('스프린트 24')
  })

  it('위키링크는 대상 텍스트만 남긴다', () => {
    expect(deriveTitle('[[릴리스 절차]] 확인')).toBe('릴리스 절차 확인')
  })
})

describe('코드 마스킹', () => {
  it('길이와 개행 위치를 유지한다', () => {
    const body = '앞\n```\ncode\n```\n뒤 `x` 끝'
    const masked = maskCode(body)
    expect(masked).toHaveLength(body.length)
    expect(masked.split('\n')).toHaveLength(body.split('\n').length)
  })

  it('닫히지 않은 백틱은 코드가 아니다', () => {
    expect(maskCode('a ` b')).toBe('a ` b')
  })
})

describe('#태그 추출', () => {
  it('본문의 태그를 순서대로 뽑는다', () => {
    expect(extractTags('릴리스 준비 #릴리스 #win32 #급함')).toEqual(['릴리스', 'win32', '급함'])
  })

  it('중복은 한 번만', () => {
    expect(extractTags('#a 그리고 #a')).toEqual(['a'])
  })

  it('ATX 제목의 #는 태그가 아니다', () => {
    expect(extractTags('# 제목\n## 소제목')).toEqual([])
  })

  it('펜스 코드블록 내부는 추출하지 않는다', () => {
    const body = ['#진짜', '```js', 'const a = 1 // #가짜 태그', '```', '#진짜2'].join('\n')
    expect(extractTags(body)).toEqual(['진짜', '진짜2'])
  })

  it('~~~ 펜스 내부도 추출하지 않는다', () => {
    const body = ['~~~', '#가짜', '~~~'].join('\n')
    expect(extractTags(body)).toEqual([])
  })

  it('인라인 코드 내부는 추출하지 않는다', () => {
    expect(extractTags('`#가짜` 지만 #진짜')).toEqual(['진짜'])
  })

  it('닫히지 않은 펜스는 끝까지 코드로 본다', () => {
    expect(extractTags('```\n#가짜\n아직 안 닫힘')).toEqual([])
  })

  it('단어 중간의 #은 태그가 아니다', () => {
    expect(extractTags('color#fff 와 a#b')).toEqual([])
  })

  it('슬래시 계층 태그를 지원한다', () => {
    expect(extractTags('#프로젝트/스프린트24')).toEqual(['프로젝트/스프린트24'])
  })
})

describe('[[위키링크]] 추출', () => {
  it('대상을 뽑는다', () => {
    expect(extractLinks('관련 [[릴리스 절차]] 와 [[벤더 연락처]]')).toEqual([
      '릴리스 절차',
      '벤더 연락처',
    ])
  })

  it('별칭·섹션은 떼고 대상만 남긴다', () => {
    expect(extractLinks('[[릴리스 절차|절차]] [[노트#섹션]]')).toEqual(['릴리스 절차', '노트'])
  })

  it('중복은 한 번만', () => {
    expect(extractLinks('[[A]] [[A]]')).toEqual(['A'])
  })

  it('펜스 코드블록 내부는 추출하지 않는다', () => {
    const body = ['[[진짜]]', '```', '[[가짜]]', '```', '[[진짜2]]'].join('\n')
    expect(extractLinks(body)).toEqual(['진짜', '진짜2'])
  })

  it('인라인 코드 내부는 추출하지 않는다', () => {
    expect(extractLinks('`[[가짜]]` 지만 [[진짜]]')).toEqual(['진짜'])
  })

  it('한쪽만 있는 대괄호는 링크가 아니다', () => {
    expect(extractLinks('[[열림 만 있음')).toEqual([])
    expect(extractLinks('[일반 링크](http://x)')).toEqual([])
  })
})

describe('미리보기 파생', () => {
  it('제목 줄을 빼고 나머지를 · 로 잇는다', () => {
    const body = ['# 오늘', '- [x] 디자인 리뷰 11:00', '- [ ] 옵시디언 플러그인 문서'].join('\n')
    expect(derivePreview(body)).toBe('디자인 리뷰 11:00 · 옵시디언 플러그인 문서')
  })

  it('코드블록은 미리보기에서 뺀다', () => {
    const body = ['본문 한 줄', '```js', 'const a = 1', '```', '다음 줄'].join('\n')
    expect(derivePreview(body)).toBe('다음 줄')
  })

  it('maxLength를 넘지 않는다', () => {
    const preview = derivePreview('# 제목\n' + '가'.repeat(300), 20)
    expect(preview.length).toBeLessThanOrEqual(20)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('빈 본문은 빈 문자열', () => {
    expect(derivePreview('')).toBe('')
    expect(derivePreview('# 제목만')).toBe('')
  })
})
