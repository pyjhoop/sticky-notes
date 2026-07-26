import { describe, expect, it } from 'vitest'
import { parseSearch } from './BoardWindow'

/** 디자인 검색창 `검색 · 태그 · [[백링크]]` — plan.md의 3모드 표. */
describe('parseSearch', () => {
  it('그 외 → text 모드 (title/body LIKE)', () => {
    expect(parseSearch('스프린트')).toEqual({ mode: 'text', term: '스프린트' })
    expect(parseSearch('  여백  ')).toEqual({ mode: 'text', term: '여백' })
    expect(parseSearch('')).toEqual({ mode: 'text', term: '' })
  })

  it('#접두사 → tag 모드', () => {
    expect(parseSearch('#릴리스')).toEqual({ mode: 'tag', term: '릴리스' })
    expect(parseSearch('  #win32 ')).toEqual({ mode: 'tag', term: 'win32' })
    // 접두사만 친 상태 — 모드는 tag, 검색어는 빈 문자열
    expect(parseSearch('#')).toEqual({ mode: 'tag', term: '' })
  })

  it('[[ ]] → backlink 모드', () => {
    expect(parseSearch('[[릴리스 절차]]')).toEqual({ mode: 'backlink', term: '릴리스 절차' })
    // 닫는 괄호를 아직 안 친 입력 중간 상태도 backlink로 본다
    expect(parseSearch('[[릴리스')).toEqual({ mode: 'backlink', term: '릴리스' })
    expect(parseSearch('[[]]')).toEqual({ mode: 'backlink', term: '' })
    expect(parseSearch('[[')).toEqual({ mode: 'backlink', term: '' })
  })

  it('문자열 중간의 # · [[ ]]는 모드를 바꾸지 않는다', () => {
    expect(parseSearch('메모 #태그')).toEqual({ mode: 'text', term: '메모 #태그' })
    expect(parseSearch('참고 [[링크]]')).toEqual({ mode: 'text', term: '참고 [[링크]]' })
  })
})
