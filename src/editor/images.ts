/**
 * 이미지 첨부 — 붙여넣기 저장 + 인라인 위젯. (M7)
 *
 * plan.md M7:
 *   붙여넣기 → 이미지 바이트를 `%APPDATA%\...\attachments\<uuid>.png` 에 저장
 *   → `![](attachments/x.png)` 삽입 → `convertFileSrc()` 로 인라인 위젯 렌더.
 *   디자인의 96×64 플레이스홀더(`--attach-w` / `--attach-h`) 스타일 재사용.
 *
 * 디자인 근거 — `design/Sticky Notes for Windows.dc.html` 100~102행:
 *   96×64 · radius 6px · border 1px `rgba(0,0,0,.14)`
 *   배경 `repeating-linear-gradient(135deg, rgba(0,0,0,.055) 0 6px, transparent 6px 12px)`
 *   레이블 JetBrains Mono 8.5px `rgba(0,0,0,.45)` 가운데 정렬
 *
 * CLAUDE.md 절대규칙 3 — 문서 텍스트는 사용자가 친 마크다운 원문 그대로다.
 *   위젯은 `Decoration.replace` 로 겉모습만 바꾼다. 커서가 `![](…)` 안에 들어오면
 *   원문이 그대로 드러난다.
 * CLAUDE.md 절대규칙 4 — 붙여넣기는 DOM 을 만지지 않고 **트랜잭션을 dispatch** 해서
 *   문서에 마크다운을 넣는다.
 */

import { syntaxTree } from '@codemirror/language'
import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  showPanel,
  type Panel,
} from '@codemirror/view'

import { type DecoRange } from './shared'

/** 붙여넣은 이미지를 앱 저장소에 넣고 마크다운에 쓸 상대 경로를 돌려준다. */
export interface AttachmentStore {
  /**
   * @param bytes 원본 이미지 바이트
   * @param extHint `image/png` 같은 MIME 이나 `png` 같은 확장자. 판정은 백엔드가 한다
   * @returns `attachments/<uuid>.png` 형태의 상대 경로
   */
  save(bytes: Uint8Array, extHint: string): Promise<string>
  /**
   * 마크다운의 상대 경로 → 웹뷰가 로드할 수 있는 URL (`convertFileSrc`).
   *
   * 첨부 폴더 경로를 백엔드에 물어봐야 하므로 비동기다.
   */
  resolve(relativePath: string): Promise<string>
}

/**
 * 위젯이 저장소를 찾는 통로.
 *
 * 데코레이션 빌더(`buildImageDecorations`)는 저장소를 몰라도 되게 한다 —
 * 순수 함수로 남아야 DOM 없이 테스트할 수 있다.
 */
export const attachmentStore = Facet.define<AttachmentStore | null, AttachmentStore | null>({
  combine: (values) => values.find((v) => v) ?? null,
})

// ─────────────────────────────────────────────────────────────
// 마크다운 ↔ 경로
// ─────────────────────────────────────────────────────────────

/**
 * `![alt](url "title")` 한 개를 통째로 매칭한다.
 *
 * `<…>` 로 감싼 URL, 뒤따르는 title(`"…"` / `'…'` / `(…)`) 까지 받아 준다.
 */
const IMAGE_RE =
  /^!\[([^\]]*)\]\(\s*(?:<([^>]*)>|([^\s)]*))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)$/

export interface ParsedImage {
  alt: string
  url: string
}

/** `![](attachments/x.png)` → `{ alt: '', url: 'attachments/x.png' }`. 아니면 `null`. */
export function parseImageMarkdown(text: string): ParsedImage | null {
  const m = IMAGE_RE.exec(text)
  if (!m) return null
  const url = (m[2] ?? m[3] ?? '').trim()
  if (!url) return null
  return { alt: m[1] ?? '', url }
}

/**
 * 저장된 상대 경로 → 본문에 넣을 마크다운 한 줄.
 *
 * 공백만 퍼센트 인코딩한다 — 마크다운 링크 문법에서 공백이 URL 을 끊기 때문이다.
 * 우리가 만드는 경로는 uuid 라 애초에 공백이 없지만, 손으로 고친 경우를 대비한다.
 */
export function imageInsertText(relativePath: string): string {
  return `![](${relativePath.trim().replace(/ /g, '%20')})`
}

// ─────────────────────────────────────────────────────────────
// 인라인 위젯
// ─────────────────────────────────────────────────────────────

/** 로드 전/실패 시 보여 줄 문구. 실패를 조용히 감추지 않는다. */
const LOADING_LABEL = '불러오는 중'

class AttachmentWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super()
  }

  eq(other: AttachmentWidget): boolean {
    return other.url === this.url && other.alt === this.alt
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-attachment'
    box.dataset.state = 'loading'
    box.title = this.url

    const label = document.createElement('span')
    label.className = 'cm-attachment__label'
    label.textContent = LOADING_LABEL
    box.appendChild(label)

    const fail = (reason: string) => {
      box.dataset.state = 'error'
      box.title = `${reason} — ${this.url}`
      // 무엇이 깨졌는지 종이 위에 남긴다. 조용히 사라지지 않는다.
      label.textContent = `${reason}\n${this.url}`
    }

    const store = view.state.facet(attachmentStore)
    if (!store) {
      fail('첨부를 열 수 없음')
      return box
    }

    const img = document.createElement('img')
    img.className = 'cm-attachment__img'
    img.alt = this.alt
    img.draggable = false
    img.addEventListener('load', () => {
      box.dataset.state = 'ok'
    })
    img.addEventListener('error', () => fail('이미지를 불러올 수 없음'))

    store
      .resolve(this.url)
      .then((src) => {
        if (!src) {
          fail('이미지 경로를 알 수 없음')
          return
        }
        img.src = src
        box.appendChild(img)
      })
      .catch((e: unknown) => fail(`이미지 경로 확인 실패: ${String(e)}`))

    return box
  }

  /** 위젯 위의 클릭을 에디터가 먼저 삼키지 않도록 한다. */
  ignoreEvent(): boolean {
    return false
  }
}

/**
 * 커서가 노드 **안쪽**에 있는가 — 경계는 안으로 치지 않는다.
 *
 * `shared.cursorInside` 는 경계를 포함한다(`**굵게**` 바로 뒤에 커서를 두면
 * 마커가 보여야 편집할 수 있으므로). 이미지는 그 규칙을 쓰면 안 된다:
 * 붙여넣기 직후 커서가 `![](…)` 의 끝에 놓이는데, 경계를 안으로 치면
 * 방금 붙여넣은 이미지가 마크다운 원문으로 보인다.
 * 원문을 보려면 위젯 안으로 한 칸 들어가거나(←) 범위 선택을 하면 된다.
 */
function cursorStrictlyInside(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    if (range.from < to && range.to > from) return true
  }
  return false
}

/**
 * `from`~`to` 구간의 `![](…)` 를 인라인 위젯으로 바꾼다.
 *
 * 커서가 노드 안쪽이면 데코레이션을 만들지 않는다 — 마크다운 원문이 그대로 드러나
 * 경로를 고칠 수 있다 (CLAUDE.md 절대규칙 3).
 *
 * `covered` 에는 위젯이 덮은 범위를 남긴다. `buildDecorations` 가 그 안쪽의
 * 다른 데코레이션을 걸러 `replace` 끼리 겹치는 것을 막는다.
 */
export function buildImageDecorations(
  state: EditorState,
  from: number,
  to: number,
  out: DecoRange[],
  covered?: Array<[number, number]>,
): void {
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== 'Image') return
      const parsed = parseImageMarkdown(state.doc.sliceString(node.from, node.to))
      if (!parsed) return
      if (cursorStrictlyInside(state, node.from, node.to)) return

      out.push(
        Decoration.replace({
          widget: new AttachmentWidget(parsed.url, parsed.alt),
        }).range(node.from, node.to),
      )
      covered?.push([node.from, node.to])
    },
  })
}

// ─────────────────────────────────────────────────────────────
// 붙여넣기
// ─────────────────────────────────────────────────────────────

/** 붙여넣기 실패를 종이 아래 띠로 알린다. `null` 이면 띠를 감춘다. */
export const setAttachmentError = StateEffect.define<string | null>()

function errorPanel(message: string): Panel {
  const dom = document.createElement('div')
  dom.className = 'cm-attachment-error'
  dom.setAttribute('role', 'alert')
  dom.textContent = message
  dom.title = '눌러서 닫기'
  // `top` 을 주지 않으면 에디터 아래에 붙는다 — 저장 푸터 바로 위다.
  return { dom }
}

export const attachmentErrorField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setAttachmentError)) return effect.value
    }
    return value
  },
  provide: (field) =>
    showPanel.from(field, (message) => (message ? () => errorPanel(message) : null)),
})

/** 띠를 눌러 닫는다. */
const dismissErrorPanel = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement | null
    if (!target?.closest('.cm-attachment-error')) return false
    view.dispatch({ effects: setAttachmentError.of(null) })
    return true
  },
})

/** 붙여넣기에서 꺼낼 이미지 — `File` 중 테스트가 쓰는 부분만 요구한다. */
export interface PastedImage {
  type: string
  name?: string
  arrayBuffer(): Promise<ArrayBuffer>
}

/** `DataTransfer` 중 우리가 읽는 부분. jsdom 에 `DataTransfer` 가 없어 좁혀 둔다. */
export interface ClipboardLike {
  types?: readonly string[]
  files?: { length: number; item(i: number): PastedImage | null } | null
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): PastedImage | null }> | null
  getData?(format: string): string
}

/**
 * 클립보드에서 이미지만 골라 낸다.
 *
 * **텍스트가 함께 들어 있으면 이미지를 무시한다.** 워드·엑셀에서 글을 복사하면
 * 선택 영역을 그린 비트맵이 같이 실려 오는데, 그걸 첨부로 바꾸면 붙여넣기가 망가진다.
 * 스크린샷·이미지 복사에는 `text/plain` 이 없다.
 */
export function imageFilesFrom(data: ClipboardLike | null | undefined): PastedImage[] {
  if (!data) return []
  if (data.getData?.('text/plain')) return []

  const out: PastedImage[] = []
  const files = data.files
  if (files) {
    for (let i = 0; i < files.length; i += 1) {
      const file = files.item(i)
      if (file && file.type.startsWith('image/')) out.push(file)
    }
  }
  if (out.length > 0) return out

  const items = data.items
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) out.push(file)
    }
  }
  return out
}

/** `file.type` 이 비어 있으면 파일명 확장자를 힌트로 쓴다. */
function extHintOf(file: PastedImage): string {
  if (file.type) return file.type
  const dot = file.name?.lastIndexOf('.') ?? -1
  return dot >= 0 ? (file.name as string).slice(dot + 1) : ''
}

/**
 * 이미지를 저장하고 마크다운을 **트랜잭션으로** 문서에 넣는다.
 * (CLAUDE.md 절대규칙 4 — DOM 을 직접 만지지 않는다)
 *
 * `paste` 이벤트 핸들러에서 분리해 둔 이유는 테스트에서 가짜 클립보드로
 * 이 경로 전체를 돌려 보기 위해서다.
 */
export async function insertPastedImages(
  view: EditorView,
  store: AttachmentStore,
  files: readonly PastedImage[],
): Promise<void> {
  const paths: string[] = []
  const errors: string[] = []

  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      paths.push(await store.save(bytes, extHintOf(file)))
    } catch (e) {
      errors.push(String(e))
    }
  }

  const changes = paths.length > 0 ? view.state.replaceSelection(paths.map(imageInsertText).join('\n')) : {}
  view.dispatch({
    ...changes,
    effects: setAttachmentError.of(
      errors.length > 0 ? `이미지를 붙여넣지 못했습니다 — ${errors[0]}` : null,
    ),
  })
}

/** `paste` 이벤트 → 이미지가 있으면 가로챈다. 없으면 기본 동작에 맡긴다. */
export function handlePaste(view: EditorView, data: ClipboardLike | null | undefined): boolean {
  const store = view.state.facet(attachmentStore)
  if (!store) return false
  const files = imageFilesFrom(data)
  if (files.length === 0) return false
  void insertPastedImages(view, store, files)
  return true
}

const pasteHandler = EditorView.domEventHandlers({
  paste(event, view) {
    if (!handlePaste(view, event.clipboardData)) return false
    event.preventDefault()
    return true
  },
})

/**
 * 첨부 확장 묶음.
 *
 * `store` 가 없으면(브라우저 개발 모드) 붙여넣기는 기본 동작으로 흐르고,
 * 이미 본문에 있는 `![](…)` 는 "첨부를 열 수 없음" 으로 보인다.
 */
export function imageAttachments(store?: AttachmentStore): Extension {
  return [attachmentStore.of(store ?? null), attachmentErrorField, pasteHandler, dismissErrorPanel]
}
