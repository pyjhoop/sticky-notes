import { describe, expect, it } from 'vitest'
import type { NoteSummary } from '../lib/ipc'
import {
  filterByFolderSelection,
  filterByText,
  folderCounts,
  parseSearch,
  sortNoteSummaries,
} from './BoardWindow'

/** 테스트용 `NoteSummary` — 필요한 필드만 덮어쓴다. */
function note(overrides: Partial<NoteSummary> & { id: string }): NoteSummary {
  return {
    title: '제목',
    preview: '미리보기',
    color: 0,
    open: false,
    pinned: false,
    updatedAt: '2026-07-26T00:00:00.000Z',
    createdAt: '2026-07-26T00:00:00.000Z',
    deletedAt: null,
    folderId: null,
    tags: [],
    ...overrides,
  }
}

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

/** 사이드바 개수 — folder/전체/미분류/휴지통을 `listNotes(true)` 하나에서 직접 센다. */
describe('folderCounts', () => {
  it('전체·미분류·휴지통·폴더별 개수를 센다', () => {
    const notes = [
      note({ id: '1', folderId: 'work' }),
      note({ id: '2', folderId: 'work' }),
      note({ id: '3', folderId: 'personal' }),
      note({ id: '4', folderId: null }),
      note({ id: '5', folderId: null }),
      note({ id: '6', deletedAt: '2026-07-01T00:00:00.000Z', folderId: 'work' }),
    ]
    expect(folderCounts(notes)).toEqual({
      all: 5,
      unfiled: 2,
      trash: 1,
      byFolder: { work: 2, personal: 1 },
    })
  })

  it('빈 목록은 전부 0', () => {
    expect(folderCounts([])).toEqual({ all: 0, unfiled: 0, trash: 0, byFolder: {} })
  })

  it('휴지통 메모는 folder_id가 있어도 byFolder에 잡히지 않는다', () => {
    const notes = [note({ id: '1', folderId: 'work', deletedAt: '2026-07-01T00:00:00.000Z' })]
    expect(folderCounts(notes)).toEqual({ all: 0, unfiled: 0, trash: 1, byFolder: {} })
  })
})

/** 사이드바 선택 → 목록 필터. */
describe('filterByFolderSelection', () => {
  const notes = [
    note({ id: 'a', folderId: 'work' }),
    note({ id: 'b', folderId: null }),
    note({ id: 'c', folderId: 'work', deletedAt: '2026-07-01T00:00:00.000Z' }),
    note({ id: 'd', folderId: null, deletedAt: '2026-07-01T00:00:00.000Z' }),
  ]

  it("'all' → 삭제되지 않은 전체", () => {
    expect(filterByFolderSelection(notes, 'all').map((n) => n.id)).toEqual(['a', 'b'])
  })

  it("'unfiled' → 삭제되지 않은 것 중 폴더 없음", () => {
    expect(filterByFolderSelection(notes, 'unfiled').map((n) => n.id)).toEqual(['b'])
  })

  it("'trash' → 삭제된 것만 (폴더 무관)", () => {
    expect(filterByFolderSelection(notes, 'trash').map((n) => n.id)).toEqual(['c', 'd'])
  })

  it('폴더 id → 삭제되지 않은 것 중 그 폴더', () => {
    expect(filterByFolderSelection(notes, 'work').map((n) => n.id)).toEqual(['a'])
  })

  it('존재하지 않는 폴더 id는 빈 배열', () => {
    expect(filterByFolderSelection(notes, '없는-폴더')).toEqual([])
  })
})

/** 휴지통 뷰의 클라이언트 검색 — 모드 구분 없이 제목/미리보기 부분일치. */
describe('filterByText', () => {
  const notes = [
    note({ id: 'a', title: '투명도 슬라이더', preview: '무단계 조절' }),
    note({ id: 'b', title: '오늘 할 일', preview: '투명도 관련 버그 재현' }),
    note({ id: 'c', title: '무관한 메모', preview: '상관없음' }),
  ]

  it('빈 검색어 — 전체 통과', () => {
    expect(filterByText(notes, '')).toEqual(notes)
    expect(filterByText(notes, '   ')).toEqual(notes)
  })

  it('제목 부분일치', () => {
    expect(filterByText(notes, '투명도').map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('미리보기 부분일치', () => {
    expect(filterByText(notes, '재현').map((n) => n.id)).toEqual(['b'])
  })

  it('대소문자 무시', () => {
    const upper = [note({ id: 'x', title: 'Sprint Review', preview: '' })]
    expect(filterByText(upper, 'sprint').map((n) => n.id)).toEqual(['x'])
  })
})

/** 리스트 정렬 — 수정일(기본) · 생성일 · 이름. */
describe('sortNoteSummaries', () => {
  const notes = [
    note({ id: 'a', title: '나중', updatedAt: '2026-07-25T00:00:00.000Z', createdAt: '2026-07-20T00:00:00.000Z' }),
    note({ id: 'b', title: '가나다', updatedAt: '2026-07-26T00:00:00.000Z', createdAt: '2026-07-10T00:00:00.000Z' }),
    note({ id: 'c', title: '다나까', updatedAt: '2026-07-24T00:00:00.000Z', createdAt: '2026-07-27T00:00:00.000Z' }),
  ]

  it('updated — 최신 수정 순', () => {
    expect(sortNoteSummaries(notes, 'updated').map((n) => n.id)).toEqual(['b', 'a', 'c'])
  })

  it('created — 최신 생성 순', () => {
    expect(sortNoteSummaries(notes, 'created').map((n) => n.id)).toEqual(['c', 'a', 'b'])
  })

  it('title — 가나다순', () => {
    expect(sortNoteSummaries(notes, 'title').map((n) => n.id)).toEqual(['b', 'a', 'c'])
  })

  it('원본 배열을 바꾸지 않는다', () => {
    const original = [...notes]
    sortNoteSummaries(notes, 'title')
    expect(notes).toEqual(original)
  })
})
