import { describe, expect, it } from 'vitest'

import { extractLinks, extractTags, maskCode } from './markdown'

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

  it('들여쓰기 코드블록 내부는 추출하지 않는다', () => {
    const body = ['본문 #진짜', '', '    indented code // #가짜', '', '끝 #진짜2'].join('\n')
    expect(extractTags(body)).toEqual(['진짜', '진짜2'])
  })

  it('리스트 하위 항목은 코드블록으로 오인하지 않는다', () => {
    const body = ['- 상위', '    - 하위 #진짜'].join('\n')
    expect(extractTags(body)).toEqual(['진짜'])
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

/**
 * 통합 게이트 #3 — 펜스 들여쓰기 규칙.
 *
 * CommonMark에서 펜스 앞에 올 수 있는 것은 **스페이스 3칸까지**다. 탭은 4칸으로
 * 펼쳐지므로 탭으로 들여쓴 줄은 펜스가 아니라 들여쓰기 코드블록이다.
 * 여기가 정답이고, `src-tauri/src/notes.rs`의 `fence_info`를 여기에 맞췄다.
 * **아래 기대값이 바뀌면 Rust `tab_indented_fence_is_not_a_fence`도 같이 바뀌어야 한다.**
 */
describe('펜스 들여쓰기 (Rust notes.rs와 같은 규칙)', () => {
  it('탭으로 들여쓴 여는 펜스는 펜스가 아니다', () => {
    expect(extractTags('\t```\n#진짜태그')).toEqual(['진짜태그'])
  })

  it('탭으로 들여쓴 닫는 펜스는 블록을 닫지 않는다', () => {
    expect(extractTags('```\n#코드안\n\t```\n#바깥태그')).toEqual([])
  })

  it('물결 펜스도 탭 들여쓰기는 인정하지 않는다', () => {
    expect(extractTags('\t~~~\n#태그티엘')).toEqual(['태그티엘'])
  })

  it('스페이스 3칸까지는 펜스다', () => {
    expect(extractTags('   ```\n#코드안\n   ```')).toEqual([])
  })

  it('스페이스 4칸은 펜스가 아니라 들여쓰기 코드블록이다', () => {
    expect(extractTags('    ```\n#진짜태그2')).toEqual(['진짜태그2'])
  })

  it('링크 추출도 같은 규칙을 쓴다', () => {
    expect(extractLinks('\t```\n[[진짜링크]]')).toEqual(['진짜링크'])
  })
})
