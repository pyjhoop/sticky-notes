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
  dragHasFiles,
  droppedFilesFrom,
  dropTargetField,
  handleDrop,
  handlePaste,
  imageFilesFrom,
  imageInsertText,
  insertPastedImages,
  parseImageMarkdown,
  setDropTarget,
  type AttachmentStore,
} from './index'
import { attachmentFileName, joinAttachmentPath } from '../lib/attachments'
import { installFileDropGuard } from '../lib/dropGuard'

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

// ─────────────────────────────────────────────────────────────
// 드래그 앤 드롭
// ─────────────────────────────────────────────────────────────

/** 임의 타입의 가짜 파일. */
function fileOf(name: string, type: string) {
  return { type, name, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
}

/** `DataTransfer` 흉내 — 드롭 시점에는 `types` 에 `Files` 가 실린다. */
function dropData(files: ReturnType<typeof fileOf>[], types: string[] = ['Files']) {
  return {
    types,
    files: { length: files.length, item: (i: number) => files[i] ?? null },
  }
}

describe('드래그가 파일을 실었는가', () => {
  it('`types` 의 `Files` 로 판정한다 — dragover 에서는 이것만 볼 수 있다', () => {
    expect(dragHasFiles({ types: ['Files'], files: { length: 0, item: () => null } })).toBe(true)
    expect(dragHasFiles({ types: ['text/plain', 'text/html'] })).toBe(false)
  })

  it('`types` 가 없어도 files/items 로 판정한다', () => {
    expect(dragHasFiles(dropData([fileOf('a.png', 'image/png')], []))).toBe(true)
    expect(
      dragHasFiles({ items: [{ kind: 'file', type: '', getAsFile: () => pngFile() }] }),
    ).toBe(true)
    expect(dragHasFiles({ items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] })).toBe(
      false,
    )
    expect(dragHasFiles(null)).toBe(false)
  })
})

describe('드롭된 파일 가르기', () => {
  it('이미지와 그 외를 나눈다', () => {
    const png = fileOf('a.png', 'image/png')
    const pdf = fileOf('보고서.pdf', 'application/pdf')
    const sorted = droppedFilesFrom(dropData([png, pdf]))
    expect(sorted.images).toEqual([png])
    expect(sorted.skipped).toEqual(['보고서.pdf'])
  })

  it('MIME 이 비면 확장자로 판정한다 — 탐색기 드롭 대비', () => {
    const sorted = droppedFilesFrom(dropData([fileOf('사진.WEBP', ''), fileOf('메모.txt', '')]))
    expect(sorted.images.map((f) => f.name)).toEqual(['사진.WEBP'])
    expect(sorted.skipped).toEqual(['메모.txt'])
  })

  it('붙여넣기와 달리 text/plain 이 있어도 파일을 본다 — 브라우저에서 끌어온 이미지', () => {
    const png = fileOf('a.png', 'image/png')
    const data = {
      types: ['Files', 'text/plain'],
      files: { length: 1, item: () => png },
      getData: () => 'https://example.com/a.png',
    }
    expect(imageFilesFrom(data)).toEqual([]) // 붙여넣기는 텍스트 우선
    expect(droppedFilesFrom(data).images).toEqual([png]) // 드롭은 파일 우선
  })
})

describe('드롭', () => {
  it('드롭 지점에 `![](attachments/….png)` 를 넣는다', async () => {
    const { store, saved } = fakeStore()
    const editor = mount('가나다', store)

    expect(handleDrop(editor, dropData([fileOf('a.png', 'image/png')]), 2)).toBe(true)
    await vi.waitFor(() =>
      expect(editor.state.doc.toString()).toBe('가나![](attachments/1.png)다'),
    )
    // 커서 위치가 아니라 마우스 지점이다 — 커서는 기본값 0 이었다
    expect(saved).toHaveLength(1)
  })

  it('여러 장을 한 번에 드롭하면 전부 삽입한다', async () => {
    const { store } = fakeStore()
    const editor = mount('', store)
    const files = [fileOf('a.png', 'image/png'), fileOf('b.gif', 'image/gif')]

    expect(handleDrop(editor, dropData(files), 0)).toBe(true)
    await vi.waitFor(() =>
      expect(editor.state.doc.toString()).toBe(
        '![](attachments/1.png)\n![](attachments/2.png)',
      ),
    )
  })

  it('이미지가 아닌 파일은 삽입하지 않고 한국어로 알린다', async () => {
    const { store, saved } = fakeStore()
    const editor = mount('원문', store)

    // true 여야 한다 — false 면 CodeMirror 기본 drop 이 pdf 를 텍스트로 쏟아붓는다
    expect(handleDrop(editor, dropData([fileOf('보고서.pdf', 'application/pdf')]), 1)).toBe(true)
    await vi.waitFor(() => {
      const panel = editor.dom.querySelector('.cm-attachment-error')
      expect(panel?.textContent).toContain('이미지 파일이 아니라 건너뛰었습니다')
      expect(panel?.textContent).toContain('보고서.pdf')
    })
    expect(editor.state.doc.toString()).toBe('원문')
    expect(saved).toHaveLength(0)
  })

  it('이미지와 그 외를 섞어 떨어뜨리면 이미지는 넣고 나머지는 알린다', async () => {
    const { store } = fakeStore()
    const editor = mount('', store)
    const files = [fileOf('a.png', 'image/png'), fileOf('메모.txt', 'text/plain')]

    expect(handleDrop(editor, dropData(files), 0)).toBe(true)
    await vi.waitFor(() => expect(editor.state.doc.toString()).toBe('![](attachments/1.png)'))
    expect(editor.dom.querySelector('.cm-attachment-error')?.textContent).toContain('메모.txt')
  })

  it('이미지가 없는 드롭은 CodeMirror 기본 동작에 넘긴다 (문자열 드래그)', () => {
    const { store } = fakeStore()
    const editor = mount('원문', store)
    const data = { types: ['text/plain'], getData: () => '끌어온 글' }

    expect(handleDrop(editor, data, 1)).toBe(false)
    expect(editor.state.doc.toString()).toBe('원문')
  })

  it('`Files` 라고만 하고 실제 파일이 없으면 넘긴다', () => {
    const { store } = fakeStore()
    const editor = mount('원문', store)
    expect(handleDrop(editor, { types: ['Files'] }, 0)).toBe(false)
  })

  it('저장소가 없으면 가로채지 않는다', () => {
    const editor = mount('')
    expect(handleDrop(editor, dropData([fileOf('a.png', 'image/png')]), 0)).toBe(false)
  })

  it('드롭 지점이 문서 끝을 넘어도 안전하게 자른다', async () => {
    const { store } = fakeStore()
    const editor = mount('짧다', store)
    expect(handleDrop(editor, dropData([fileOf('a.png', 'image/png')]), 999)).toBe(true)
    await vi.waitFor(() => expect(editor.state.doc.toString()).toBe('짧다![](attachments/1.png)'))
  })

  it('원문은 손실 없이 남는다 (절대규칙 3)', async () => {
    const { store } = fakeStore()
    const doc = ['# 제목', '', '- [ ] 할 일 `코드`', '[[링크]] 와 #태그'].join('\n')
    const editor = mount(doc, store)

    handleDrop(editor, dropData([fileOf('a.png', 'image/png')]), doc.length)
    await vi.waitFor(() =>
      expect(editor.state.doc.toString()).toBe(`${doc}![](attachments/1.png)`),
    )
    // 삽입한 마크다운을 빼면 원문 그대로다
    expect(editor.state.doc.toString().slice(0, doc.length)).toBe(doc)
  })

  it('드롭 대상 표시가 상태로 켜지고 꺼진다', () => {
    const { store } = fakeStore()
    const editor = mount('', store)
    expect(editor.state.field(dropTargetField)).toBe(false)

    editor.dispatch({ effects: setDropTarget.of(true) })
    expect(editor.state.field(dropTargetField)).toBe(true)
    expect(editor.dom.classList.contains('cm-drop-target')).toBe(true)

    // 드롭이 끝나면 표시가 꺼진다
    handleDrop(editor, dropData([fileOf('a.png', 'image/png')]), 0)
    expect(editor.state.field(dropTargetField)).toBe(false)
    expect(editor.dom.classList.contains('cm-drop-target')).toBe(false)
  })
})

describe('창 전체 파일 드롭 방어막', () => {
  it('에디터 밖의 드롭은 기본 동작을 막는다 — 파일로 네비게이션 금지', () => {
    const uninstall = installFileDropGuard()
    const bar = document.createElement('div')
    document.body.appendChild(bar)

    for (const type of ['dragover', 'drop']) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      bar.dispatchEvent(event)
      expect(event.defaultPrevented, type).toBe(true)
    }

    bar.remove()
    uninstall()
  })

  it('에디터 본문 안은 그대로 통과시킨다 — CodeMirror 가 처리한다', () => {
    const uninstall = installFileDropGuard()
    const content = document.createElement('div')
    content.className = 'cm-content'
    const line = document.createElement('div')
    content.appendChild(line)
    document.body.appendChild(content)

    for (const type of ['dragover', 'drop']) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      line.dispatchEvent(event)
      expect(event.defaultPrevented, type).toBe(false)
    }

    content.remove()
    uninstall()
  })

  it('해제하면 더 이상 막지 않는다', () => {
    const uninstall = installFileDropGuard()
    uninstall()
    const event = new Event('drop', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
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
