/**
 * M7 이미지 첨부 검증.
 *
 * - 붙여넣기가 삽입하는 **텍스트 형태** (`![](attachments/….png)`)
 * - `![](…)` → 인라인 위젯 데코레이션, 커서가 안이면 원문 노출
 * - 마크다운 원문 무손실 (CLAUDE.md 절대규칙 3)
 * - 삽입이 **트랜잭션 dispatch** 로 이뤄지는가 (절대규칙 4)
 * - 텍스트가 함께 실린 클립보드는 이미지로 가로채지 않는다
 */

import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, type DecorationSet } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDecorations,
  createNoteEditorExtensions,
  handlePaste,
  imageFilesFrom,
  imageInsertText,
  insertPastedImages,
  parseImageMarkdown,
  type AttachmentStore,
} from './index'
import { attachmentFileName, joinAttachmentPath } from '../lib/attachments'

// ─────────────────────────────────────────────────────────────
// 도구
// ─────────────────────────────────────────────────────────────

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

/** 저장 호출을 기록하는 가짜 저장소. */
function fakeStore(overrides: Partial<AttachmentStore> = {}) {
  const saved: Array<{ bytes: Uint8Array; extHint: string }> = []
  const store: AttachmentStore = {
    save: async (bytes, extHint) => {
      saved.push({ bytes, extHint })
      return `attachments/${saved.length}.png`
    },
    resolve: async (rel) => `asset://localhost/${rel}`,
    ...overrides,
  }
  return { store, saved }
}

function mount(doc: string, store?: AttachmentStore): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: createNoteEditorExtensions({ attachments: store }),
    }),
    parent,
  })
  return view
}

function pngFile(name = 'a.png', type = 'image/png') {
  return {
    type,
    name,
    arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
  }
}

function decorationsOf(doc: string, cursor?: number): DecorationSet {
  const state = EditorState.create({
    doc,
    selection: cursor === undefined ? undefined : EditorSelection.cursor(cursor),
    extensions: createNoteEditorExtensions(),
  })
  return buildDecorations(state, [{ from: 0, to: state.doc.length }])
}

/** 위젯을 가진 replace 데코레이션 범위들. */
function widgetRanges(decorations: DecorationSet): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const spec = cursor.value.spec as { widget?: { constructor: { name: string } } }
    if (spec.widget?.constructor.name === 'AttachmentWidget') out.push([cursor.from, cursor.to])
    cursor.next()
  }
  return out
}

// ─────────────────────────────────────────────────────────────

describe('마크다운 파싱', () => {
  it('`![](경로)` 를 읽는다', () => {
    expect(parseImageMarkdown('![](attachments/abc.png)')).toEqual({
      alt: '',
      url: 'attachments/abc.png',
    })
    expect(parseImageMarkdown('![스크린샷](attachments/abc.png)')).toEqual({
      alt: '스크린샷',
      url: 'attachments/abc.png',
    })
    expect(parseImageMarkdown('![](<attachments/a b.png>)')).toEqual({
      alt: '',
      url: 'attachments/a b.png',
    })
    expect(parseImageMarkdown('![](attachments/a.png "제목")')).toEqual({
      alt: '',
      url: 'attachments/a.png',
    })
  })

  it('이미지가 아니면 null', () => {
    for (const bad of ['[](a.png)', '![]()', '![](  )', '텍스트', '![alt](']) {
      expect(parseImageMarkdown(bad), bad).toBeNull()
    }
  })
})

describe('삽입 텍스트', () => {
  it('저장된 상대 경로를 그대로 마크다운으로 감싼다', () => {
    expect(imageInsertText('attachments/019826f0.png')).toBe('![](attachments/019826f0.png)')
    expect(imageInsertText('attachments/a.webp')).toBe('![](attachments/a.webp)')
  })

  it('공백만 퍼센트 인코딩한다 — 링크가 끊기지 않도록', () => {
    expect(imageInsertText('attachments/스크린 샷.png')).toBe('![](attachments/스크린%20샷.png)')
  })
})

describe('인라인 위젯 데코레이션', () => {
  it('`![](…)` 가 위젯으로 대체된다', () => {
    const doc = '앞\n![](attachments/a.png)\n뒤'
    const ranges = widgetRanges(decorationsOf(doc))
    expect(ranges).toHaveLength(1)
    expect(doc.slice(ranges[0][0], ranges[0][1])).toBe('![](attachments/a.png)')
  })

  it('커서가 안쪽이면 원문이 그대로 보인다', () => {
    const doc = '![](attachments/a.png)'
    expect(widgetRanges(decorationsOf(doc, 5))).toHaveLength(0)
    expect(widgetRanges(decorationsOf(doc, doc.length - 1))).toHaveLength(0)
  })

  it('커서가 경계에 있으면 위젯이 유지된다 — 붙여넣기 직후 상태', () => {
    const doc = '![](attachments/a.png)'
    // replaceSelection 은 커서를 삽입 텍스트 끝(= 노드의 to)에 둔다
    expect(widgetRanges(decorationsOf(doc, doc.length))).toHaveLength(1)
    expect(widgetRanges(decorationsOf(doc, 0))).toHaveLength(1)
  })

  it('코드블록 안의 `![](…)` 는 위젯이 되지 않는다', () => {
    const doc = '```\n![](attachments/a.png)\n```'
    expect(widgetRanges(decorationsOf(doc))).toHaveLength(0)
  })

  it('데코레이션이 겹치지 않고 실제로 그려진다', () => {
    const { store } = fakeStore()
    const doc = [
      '# 제목',
      '',
      '- [x] **굵게** 와 `코드`',
      '![**굵은 대체문구**](attachments/a.png)',
      '![](attachments/b.gif) 옆의 [[링크]] 와 #태그',
    ].join('\n')
    const editor = mount(doc, store)
    expect(editor.state.doc.toString()).toBe(doc)
    expect(editor.dom.querySelectorAll('.cm-attachment').length).toBe(2)
  })

  it('원문은 손실 없이 남는다 (절대규칙 3)', () => {
    const doc = '![](attachments/a.png)\n\n본문'
    const editor = mount(doc, fakeStore().store)
    expect(editor.state.doc.toString()).toBe(doc)
  })

  it('저장소가 없으면 실패 상태로 보인다 — 조용히 사라지지 않는다', () => {
    // 커서(기본 0)가 노드 밖에 있어야 위젯이 그려진다
    const editor = mount('앞\n![](attachments/a.png)')
    const box = editor.dom.querySelector('.cm-attachment') as HTMLElement
    expect(box).not.toBeNull()
    expect(box.dataset.state).toBe('error')
    expect(box.querySelector('.cm-attachment__label')?.textContent).toContain(
      'attachments/a.png',
    )
  })
})

describe('클립보드에서 이미지 고르기', () => {
  it('files 의 이미지를 집어낸다', () => {
    const file = pngFile()
    const data = { files: { length: 1, item: () => file } }
    expect(imageFilesFrom(data)).toEqual([file])
  })

  it('files 가 비면 items 로 폴백한다', () => {
    const file = pngFile()
    const data = {
      files: { length: 0, item: () => null },
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    }
    expect(imageFilesFrom(data)).toEqual([file])
  })

  it('이미지가 아닌 파일은 무시한다', () => {
    const doc = { type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(0) }
    expect(imageFilesFrom({ files: { length: 1, item: () => doc } })).toEqual([])
  })

  it('텍스트가 함께 실린 클립보드는 건드리지 않는다', () => {
    const data = {
      getData: (f: string) => (f === 'text/plain' ? '문단' : ''),
      files: { length: 1, item: () => pngFile() },
    }
    expect(imageFilesFrom(data)).toEqual([])
  })

  it('빈 클립보드', () => {
    expect(imageFilesFrom(null)).toEqual([])
    expect(imageFilesFrom(undefined)).toEqual([])
    expect(imageFilesFrom({})).toEqual([])
  })
})

describe('붙여넣기', () => {
  it('저장 후 `![](attachments/….png)` 를 트랜잭션으로 넣는다', async () => {
    const { store, saved } = fakeStore()
    const editor = mount('메모: ', store)
    editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) })

    await insertPastedImages(editor, store, [pngFile()])

    expect(editor.state.doc.toString()).toBe('메모: ![](attachments/1.png)')
    expect(saved).toHaveLength(1)
    expect(saved[0].extHint).toBe('image/png')
    expect(Array.from(saved[0].bytes)).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('여러 장은 줄바꿈으로 잇는다', async () => {
    const { store } = fakeStore()
    const editor = mount('', store)
    await insertPastedImages(editor, store, [pngFile(), pngFile('b.png')])
    expect(editor.state.doc.toString()).toBe('![](attachments/1.png)\n![](attachments/2.png)')
  })

  it('MIME 이 비면 파일명 확장자를 힌트로 쓴다', async () => {
    const { store, saved } = fakeStore()
    const editor = mount('', store)
    await insertPastedImages(editor, store, [pngFile('사진.webp', '')])
    expect(saved[0].extHint).toBe('webp')
  })

  it('선택 영역을 대체한다', async () => {
    const { store } = fakeStore()
    const editor = mount('여기를 바꾼다', store)
    editor.dispatch({ selection: EditorSelection.range(0, 3) })
    await insertPastedImages(editor, store, [pngFile()])
    expect(editor.state.doc.toString()).toBe('![](attachments/1.png) 바꾼다')
  })

  it('저장이 실패하면 본문을 바꾸지 않고 실패 띠를 띄운다', async () => {
    const { store } = fakeStore({
      save: async () => {
        throw new Error('지원하지 않는 이미지 형식입니다: svg')
      },
    })
    const editor = mount('원문', store)
    await insertPastedImages(editor, store, [pngFile()])

    expect(editor.state.doc.toString()).toBe('원문')
    const panel = editor.dom.querySelector('.cm-attachment-error')
    expect(panel?.textContent).toContain('붙여넣지 못했습니다')
    expect(panel?.textContent).toContain('지원하지 않는 이미지 형식')
  })

  it('저장소가 없으면 가로채지 않는다 (기본 텍스트 붙여넣기로 흐른다)', () => {
    const editor = mount('')
    const data = { files: { length: 1, item: () => pngFile() } }
    expect(handlePaste(editor, data)).toBe(false)
  })

  it('이미지가 있으면 가로챈다', async () => {
    const { store } = fakeStore()
    const editor = mount('', store)
    expect(handlePaste(editor, { files: { length: 1, item: () => pngFile() } })).toBe(true)
    await vi.waitFor(() => expect(editor.state.doc.toString()).toBe('![](attachments/1.png)'))
  })
})

describe('경로 해석 헬퍼', () => {
  it('마지막 조각만 파일명으로 쓴다 — 임의 경로를 열어 주지 않는다', () => {
    expect(attachmentFileName('attachments/a.png')).toBe('a.png')
    expect(attachmentFileName('../../etc/passwd')).toBe('passwd')
    expect(attachmentFileName('C:\\Windows\\evil.png')).toBe('evil.png')
    expect(attachmentFileName('attachments/%EC%82%AC%EC%A7%84.png')).toBe('사진.png')
    expect(attachmentFileName('  attachments/a.png  ')).toBe('a.png')
  })

  it('폴더가 쓰는 구분자로 잇는다', () => {
    expect(joinAttachmentPath('C:\\Users\\x\\attachments', 'a.png')).toBe(
      'C:\\Users\\x\\attachments\\a.png',
    )
    expect(joinAttachmentPath('C:\\Users\\x\\attachments\\', 'a.png')).toBe(
      'C:\\Users\\x\\attachments\\a.png',
    )
    expect(joinAttachmentPath('/home/x/attachments', 'a.png')).toBe('/home/x/attachments/a.png')
  })
})
