/**
 * M3 DoD 검증 (process.md "완료 기준 > M3").
 *
 * - 마크다운 원문 무손실
 * - 체크박스 토글이 문서 텍스트를 바꾸는 트랜잭션인가
 * - 커서가 노드 안이면 마커 노출 / 밖이면 숨김 — `**` · `` ` `` · `#` · `[[ ]]` 4종
 *
 * 데코레이션 빌더가 `EditorState`만 받는 순수 함수라 DOM 없이 검증할 수 있다.
 */

import { EditorSelection, EditorState } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { buildDecorations, createNoteEditorExtensions, cursorInside, taskMarkerToggle } from './index'

function stateOf(doc: string, cursor?: number): EditorState {
  return EditorState.create({
    doc,
    selection: cursor === undefined ? undefined : EditorSelection.cursor(cursor),
    extensions: createNoteEditorExtensions(),
  })
}

function decorationsOf(doc: string, cursor?: number): DecorationSet {
  const state = stateOf(doc, cursor)
  return buildDecorations(state, [{ from: 0, to: state.doc.length }])
}

/**
 * 화면에서 지워진(=위젯 없는 replace) 범위들. 마커 숨김 판정에 쓴다.
 *
 * 라인 데코레이션도 point지만 `class`를 가지므로 걸러낸다.
 */
function hiddenRanges(decorations: DecorationSet): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const spec = cursor.value.spec as { widget?: unknown; class?: string }
    if (cursor.value.point && spec.widget === undefined && spec.class === undefined) {
      out.push([cursor.from, cursor.to])
    }
    cursor.next()
  }
  return out
}

/** 특정 클래스의 mark 데코레이션이 걸린 범위들. */
function markRanges(decorations: DecorationSet, className: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const spec = cursor.value.spec as { class?: string }
    if (spec.class?.split(' ').includes(className)) out.push([cursor.from, cursor.to])
    cursor.next()
  }
  return out
}

/** 위젯(체크박스) replace 범위들. */
function widgetRanges(decorations: DecorationSet): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const spec = cursor.value.spec as { widget?: unknown }
    if (cursor.value.point && spec.widget) out.push([cursor.from, cursor.to])
    cursor.next()
  }
  return out
}

function isHidden(decorations: DecorationSet, from: number, to: number): boolean {
  return hiddenRanges(decorations).some(([f, t]) => f <= from && t >= to)
}

// ─────────────────────────────────────────────────────────────────

const LONG_DOC = [
  '# 스프린트 24 · 릴리스 체크',
  '',
  '- [ ] 설치 관리자 서명 인증서 갱신',
  '- [x] 투명도 슬라이더 GPU 합성 이슈 확인',
  '- [ ] 볼트 충돌 시 `conflict-{ts}.md` 생성',
  '',
  '창 위치는 **모니터 DPI 기준 상대 좌표**로 저장. 관련 노트는 [[릴리스 절차]] 참고.',
  '',
  '```js',
  'SetWindowPos(hwnd, HWND_TOPMOST,',
  '  0, 0, 0, 0, SWP_NOMOVE); // #가짜태그 [[가짜링크]]',
  '```',
  '',
  '## 소제목',
  '',
  '> 인용문 *기울임* 그리고 ~~취소선~~',
  '',
  '| 표 | 헤더 |',
  '| --- | --- |',
  '| a | b |',
  '',
  '#릴리스 #win32 #급함',
  '',
  '    들여쓴 코드 블록',
  '',
  '마지막 줄 — 트레일링 공백 두 개  ',
].join('\n')

describe('마크다운 원문 무손실', () => {
  it('긴 문서를 그대로 담고 그대로 돌려준다', () => {
    const state = stateOf(LONG_DOC)
    expect(state.doc.toString()).toBe(LONG_DOC)
    expect(state.doc.toString().length).toBe(LONG_DOC.length)
  })

  it('붙여넣기(트랜잭션)로 넣어도 바이트가 같다', () => {
    let state = stateOf('')
    state = state.update({ changes: { from: 0, insert: LONG_DOC } }).state
    expect(state.doc.toString()).toBe(LONG_DOC)
  })

  it('데코레이션을 만들어도 문서가 바뀌지 않는다', () => {
    const state = stateOf(LONG_DOC)
    buildDecorations(state, [{ from: 0, to: state.doc.length }])
    expect(state.doc.toString()).toBe(LONG_DOC)
  })

  it('탭·유니코드·후행 공백이 보존된다', () => {
    const doc = '\t- [ ] 탭 들여쓰기 😀\n**굵게**  \n\n  들여쓴 줄'
    expect(stateOf(doc).doc.toString()).toBe(doc)
  })

  it('CRLF는 LF로 정규화된다 — CodeMirror Text의 고정 동작', () => {
    // Text.toString()이 항상 "\n"으로 잇는다. 개행 문자 외의 바이트는 전부 보존된다.
    expect(stateOf('가\r\n나\r\n').doc.toString()).toBe('가\n나\n')
  })

  it('커서를 옮겨도 문서는 그대로다', () => {
    let state = stateOf(LONG_DOC)
    for (let pos = 0; pos <= state.doc.length; pos += 7) {
      state = state.update({ selection: EditorSelection.cursor(pos) }).state
      buildDecorations(state, [{ from: 0, to: state.doc.length }])
    }
    expect(state.doc.toString()).toBe(LONG_DOC)
  })
})

describe('cursorInside', () => {
  const state = stateOf('012345678', 4)

  it('범위 안이면 true', () => {
    expect(cursorInside(state, 2, 6)).toBe(true)
  })

  it('경계에 붙어 있어도 true — 마커를 편집할 수 있어야 한다', () => {
    expect(cursorInside(state, 4, 8)).toBe(true)
    expect(cursorInside(state, 0, 4)).toBe(true)
  })

  it('범위 밖이면 false', () => {
    expect(cursorInside(state, 5, 8)).toBe(false)
    expect(cursorInside(state, 0, 3)).toBe(false)
  })
})

describe('체크박스', () => {
  it('[ ] 를 체크박스 위젯으로 대체한다', () => {
    const decorations = decorationsOf('- [ ] 할 일')
    // `- ` (0..2) 숨김, `[ ] ` (2..6) 위젯
    expect(widgetRanges(decorations)).toEqual([[2, 6]])
    expect(isHidden(decorations, 0, 2)).toBe(true)
  })

  it('완료된 항목은 나머지 줄에 cm-task-done 을 건다', () => {
    const doc = '- [x] 끝난 일'
    const decorations = decorationsOf(doc)
    expect(markRanges(decorations, 'cm-task-done')).toEqual([[6, doc.length]])
  })

  it('미완료 항목에는 cm-task-done 이 없다', () => {
    expect(markRanges(decorationsOf('- [ ] 아직'), 'cm-task-done')).toEqual([])
  })

  it('토글은 문서 텍스트를 바꾸는 변경 명세를 만든다 (DOM 조작 아님)', () => {
    const state = stateOf('- [ ] 할 일')
    const changes = taskMarkerToggle(state.doc, 2)
    expect(changes).toEqual({ from: 2, to: 5, insert: '[x]' })

    const next = state.update({ changes: changes! }).state
    expect(next.doc.toString()).toBe('- [x] 할 일')

    // 되돌리기
    const back = taskMarkerToggle(next.doc, 2)
    expect(back).toEqual({ from: 2, to: 5, insert: '[ ]' })
    expect(next.update({ changes: back! }).state.doc.toString()).toBe('- [ ] 할 일')
  })

  it('마커가 아닌 위치에서는 아무 변경도 만들지 않는다', () => {
    const state = stateOf('- [ ] 할 일')
    expect(taskMarkerToggle(state.doc, 0)).toBeNull()
    expect(taskMarkerToggle(state.doc, 7)).toBeNull()
    expect(taskMarkerToggle(state.doc, 999)).toBeNull()
  })
})

describe('코드블록', () => {
  it('블록의 모든 줄에 라인 데코레이션을 건다', () => {
    const doc = ['```js', 'const a = 1', '```'].join('\n')
    const decorations = decorationsOf(doc)
    const lines = markRanges(decorations, 'cm-code-line')
    expect(lines).toHaveLength(3)
    expect(lines.map(([from]) => from)).toEqual([0, 6, 18])
  })

  it('첫 줄과 마지막 줄만 라운드 클래스를 받는다', () => {
    const doc = ['```', 'a', 'b', '```'].join('\n')
    const decorations = decorationsOf(doc)
    expect(markRanges(decorations, 'cm-code-line-first')).toHaveLength(1)
    expect(markRanges(decorations, 'cm-code-line-last')).toHaveLength(1)
  })
})

// ── 마커 노출/숨김 4종 (M3 DoD) ────────────────────────────────

describe('마커 숨김 — 커서 밖', () => {
  it('** 굵게', () => {
    const doc = '앞 **굵게** 뒤'
    const decorations = decorationsOf(doc, 0)
    expect(markRanges(decorations, 'cm-strong')).toEqual([[2, 8]])
    expect(isHidden(decorations, 2, 4)).toBe(true)
    expect(isHidden(decorations, 6, 8)).toBe(true)
  })

  it('` 인라인 코드', () => {
    const doc = '앞 `코드` 뒤'
    const decorations = decorationsOf(doc, 0)
    expect(markRanges(decorations, 'cm-inline-code')).toEqual([[2, 6]])
    expect(isHidden(decorations, 2, 3)).toBe(true)
    expect(isHidden(decorations, 5, 6)).toBe(true)
  })

  it('# 제목', () => {
    const doc = '# 제목\n본문'
    const decorations = decorationsOf(doc, doc.length)
    expect(markRanges(decorations, 'cm-h1')).toEqual([[0, 0]])
    // `#` + 뒤 공백까지 숨긴다
    expect(isHidden(decorations, 0, 2)).toBe(true)
  })

  it('[[ ]] 위키링크', () => {
    const doc = '앞 [[링크]] 뒤'
    const decorations = decorationsOf(doc, 0)
    expect(markRanges(decorations, 'cm-wikilink')).toEqual([[2, 8]])
    expect(isHidden(decorations, 2, 4)).toBe(true)
    expect(isHidden(decorations, 6, 8)).toBe(true)
  })
})

describe('마커 노출 — 커서 안', () => {
  it('** 굵게', () => {
    const decorations = decorationsOf('앞 **굵게** 뒤', 5)
    expect(markRanges(decorations, 'cm-strong')).toEqual([[2, 8]])
    expect(hiddenRanges(decorations)).toEqual([])
  })

  it('` 인라인 코드', () => {
    const decorations = decorationsOf('앞 `코드` 뒤', 4)
    expect(markRanges(decorations, 'cm-inline-code')).toEqual([[2, 6]])
    expect(hiddenRanges(decorations)).toEqual([])
  })

  it('# 제목', () => {
    const decorations = decorationsOf('# 제목\n본문', 3)
    expect(markRanges(decorations, 'cm-h1')).toEqual([[0, 0]])
    expect(hiddenRanges(decorations)).toEqual([])
  })

  it('[[ ]] 위키링크', () => {
    const decorations = decorationsOf('앞 [[링크]] 뒤', 5)
    expect(markRanges(decorations, 'cm-wikilink')).toEqual([[2, 8]])
    expect(hiddenRanges(decorations)).toEqual([])
  })
})

describe('#태그 · [[위키링크]] 장식 범위', () => {
  it('태그는 # 을 포함해 알약이 된다', () => {
    const decorations = decorationsOf('배포 #릴리스 끝', 0)
    expect(markRanges(decorations, 'cm-tag')).toEqual([[3, 7]])
  })

  it('ATX 제목의 # 은 태그가 아니다', () => {
    expect(markRanges(decorationsOf('# 제목', 0), 'cm-tag')).toEqual([])
  })

  it('코드블록 안의 #태그·[[링크]]는 장식하지 않는다', () => {
    const doc = ['```', '#가짜 [[가짜]]', '```'].join('\n')
    const decorations = decorationsOf(doc, 0)
    expect(markRanges(decorations, 'cm-tag')).toEqual([])
    expect(markRanges(decorations, 'cm-wikilink')).toEqual([])
  })

  it('인라인 코드 안의 #태그는 장식하지 않는다', () => {
    const decorations = decorationsOf('`#가짜` 와 #진짜', 0)
    expect(markRanges(decorations, 'cm-tag')).toHaveLength(1)
  })
})
