/**
 * 이미지 첨부 — 붙여넣기 · 드래그 앤 드롭 저장 + 인라인 위젯. (M7)
 *
 * plan.md M7:
 *   붙여넣기 → 이미지 바이트를 `%APPDATA%\...\attachments\<uuid>.png` 에 저장
 *   → `![](attachments/x.png)` 삽입 → `convertFileSrc()` 로 인라인 위젯 렌더.
 *   디자인의 96×64 플레이스홀더(`--attach-w` / `--attach-h`) 스타일 재사용.
 *
 * 드래그 앤 드롭도 **같은 파이프라인**을 탄다 — `store.save()` → `imageInsertText()`
 *   → `view.dispatch`. 새 백엔드 커맨드는 없다.
 *
 *   `tauri.conf.json` 의 메모 창은 `dragDropEnabled: false` 다. 이 값이 곧
 *   "웹뷰가 HTML5 드롭을 직접 받는다" 는 뜻이고, 그래야 아래 `drop` 핸들러가 돈다.
 *   근거:
 *     · tauri-utils 2.9.3 `config.rs:1944` —
 *       "Whether the drag and drop is enabled or not on the webview. By default it is
 *        enabled. **Disabling it is required to use HTML5 drag and drop on the frontend
 *        on Windows.**"
 *     · wry 0.55.1 `src/webview2/mod.rs:150-157` — 네이티브 핸들러를 붙일 때만
 *       `SetAllowExternalDrop(false)` 를 호출한다("Disable file drops, so our handler
 *       can capture it"). 즉 `dragDropEnabled: false` 면 그 호출이 없고,
 *       WebView2 의 `AllowExternalDrop` 기본값(TRUE)이 그대로 남아 웹뷰가 드롭을 받는다.
 *     · WebView2 `ICoreWebView2Controller4::put_AllowExternalDrop` — "The default value
 *       is TRUE."
 *
 *   네이티브 경로(`dragDropEnabled: true`)를 쓰지 않는 이유:
 *     ① `tauri://drag-drop` 은 **파일 경로만** 준다 → 파일을 읽는 백엔드 커맨드를
 *        새로 만들어야 하고, 그러면 "경로에 사용자 문자열이 들어가지 않는다" 는
 *        `attachments.rs` 의 보안 전제가 깨진다
 *     ② 브라우저에서 이미지를 직접 끌어오는 경우는 파일 경로가 아예 없어 못 받는다
 *     ③ 붙여넣기와 파이프라인을 공유할 수 없다
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
  return collectFiles(data).images
}

/**
 * 백엔드(`attachments.rs`)의 확장자 화이트리스트와 같은 목록.
 *
 * 탐색기에서 끌어온 파일은 MIME 이 비어 있을 수 있어(웹뷰가 확장자를 모르는 경우)
 * 파일명으로도 판정한다. 최종 판정은 어차피 백엔드가 한다 — 여기서는 "이 드롭을
 * 우리가 가로챌 것인가" 만 정한다.
 */
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp)$/i

function isImageFile(file: PastedImage): boolean {
  if (file.type) return file.type.startsWith('image/')
  return IMAGE_EXT_RE.test(file.name ?? '')
}

/** 사용자에게 보여 줄 파일 이름. 이름이 없으면 MIME 이라도 보여 준다. */
function fileLabel(file: PastedImage): string {
  return file.name?.trim() || file.type || '알 수 없는 파일'
}

/** `DataTransfer` 안의 파일들을 이미지 / 그 외로 가른다. */
export interface SortedFiles {
  images: PastedImage[]
  /** 이미지가 아니라 건너뛴 파일의 이름 */
  skipped: string[]
}

function collectFiles(data: ClipboardLike): SortedFiles {
  const images: PastedImage[] = []
  const skipped: string[] = []

  const files = data.files
  if (files) {
    for (let i = 0; i < files.length; i += 1) {
      const file = files.item(i)
      if (!file) continue
      if (isImageFile(file)) images.push(file)
      else skipped.push(fileLabel(file))
    }
  }
  if (images.length > 0 || skipped.length > 0) return { images, skipped }

  // `files` 가 비어 있을 때만 `items` 로 폴백한다 — 같은 파일을 두 번 세지 않는다.
  const items = data.items
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      if (isImageFile(file)) images.push(file)
      else skipped.push(fileLabel(file))
    }
  }
  return { images, skipped }
}

/**
 * 드롭된 파일을 이미지 / 그 외로 가른다.
 *
 * **붙여넣기와 달리 `text/plain` 우선 규칙을 쓰지 않는다.** 그 규칙은 워드·엑셀이
 * 글과 함께 실어 보내는 비트맵 때문에 있는 것이고, 드래그에는 해당하지 않는다.
 * 드래그가 파일을 싣고 있는지는 `dragHasFiles()` 가 `types` 로 먼저 가른다.
 */
export function droppedFilesFrom(data: ClipboardLike | null | undefined): SortedFiles {
  if (!data) return { images: [], skipped: [] }
  return collectFiles(data)
}

/**
 * 이 드래그가 **파일**을 싣고 있는가.
 *
 * `dragover` 시점에는 브라우저가 `files` 를 감추므로(보호 모드) `types` 로만 알 수 있다.
 * 에디터 안에서 문자열을 끌어 옮기는 CodeMirror 기본 동작은 `Files` 를 싣지 않으므로,
 * 이 판정이 곧 "우리가 가로챌 드래그인가" 다.
 */
export function dragHasFiles(data: ClipboardLike | null | undefined): boolean {
  if (!data) return false
  if (data.types?.includes('Files')) return true
  if (data.files && data.files.length > 0) return true
  const items = data.items
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].kind === 'file') return true
    }
  }
  return false
}

/** `file.type` 이 비어 있으면 파일명 확장자를 힌트로 쓴다. */
function extHintOf(file: PastedImage): string {
  if (file.type) return file.type
  const dot = file.name?.lastIndexOf('.') ?? -1
  return dot >= 0 ? (file.name as string).slice(dot + 1) : ''
}

/** 실패 문구의 동사 — 붙여넣기와 드롭이 같은 함수를 쓰므로 호출자가 정한다. */
const PASTE_ACTION = '붙여넣지'
const DROP_ACTION = '가져오지'

export interface InsertImagesOptions {
  /**
   * 삽입 위치. 없으면 현재 선택을 대체한다(붙여넣기).
   *
   * 드롭은 커서가 아니라 **마우스가 가리킨 지점**에 넣으므로 이 값을 쓴다.
   */
  at?: number
  /** 이미지가 아니라 건너뛴 파일 이름들 */
  skipped?: readonly string[]
  /** 실패 문구의 동사 */
  action?: string
}

/** 저장 실패 + 건너뛴 파일을 한 줄로 묶는다. 둘 다 없으면 `null`(띠를 감춘다). */
function attachmentErrorMessage(
  errors: readonly string[],
  skipped: readonly string[],
  action: string,
): string | null {
  const parts: string[] = []
  if (errors.length > 0) parts.push(`이미지를 ${action} 못했습니다 — ${errors[0]}`)
  if (skipped.length > 0) {
    parts.push(`이미지 파일이 아니라 건너뛰었습니다 — ${skipped.join(', ')}`)
  }
  return parts.length > 0 ? parts.join(' / ') : null
}

/**
 * 이미지를 저장하고 마크다운을 **트랜잭션으로** 문서에 넣는다.
 * (CLAUDE.md 절대규칙 4 — DOM 을 직접 만지지 않는다)
 *
 * `paste` / `drop` 이벤트 핸들러에서 분리해 둔 이유는 테스트에서 가짜 클립보드로
 * 이 경로 전체를 돌려 보기 위해서다.
 */
export async function insertPastedImages(
  view: EditorView,
  store: AttachmentStore,
  files: readonly PastedImage[],
  options: InsertImagesOptions = {},
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

  // 여러 장은 한 줄에 하나씩. 삽입은 한 트랜잭션이라 undo 한 번으로 되돌아간다.
  const text = paths.map(imageInsertText).join('\n')
  let changes: Parameters<EditorView['dispatch']>[0] = {}
  if (text) {
    if (options.at === undefined) {
      changes = view.state.replaceSelection(text)
    } else {
      // 저장(await) 동안 문서가 줄었을 수 있다 — 문서 길이로 조인다.
      const at = Math.max(0, Math.min(options.at, view.state.doc.length))
      changes = { changes: { from: at, insert: text }, selection: { anchor: at + text.length } }
    }
  }

  view.dispatch({
    ...changes,
    effects: setAttachmentError.of(
      attachmentErrorMessage(errors, options.skipped ?? [], options.action ?? PASTE_ACTION),
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

// ─────────────────────────────────────────────────────────────
// 드래그 앤 드롭
// ─────────────────────────────────────────────────────────────

/** 드래그가 에디터 위에 올라와 있는가 — 시각 피드백용. */
export const setDropTarget = StateEffect.define<boolean>()

/**
 * 드롭 대상 표시.
 *
 * DOM 에 클래스를 직접 붙이지 않고 상태로 둔다 — CodeMirror 가 다시 그릴 때
 * 사라지지 않고, 테스트에서 상태로 검증할 수 있다.
 * `.cm-drop-target` 의 겉모습은 `src/styles/editor.css` 에 있다.
 */
export const dropTargetField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDropTarget)) return effect.value
    }
    return value
  },
  provide: (field) =>
    EditorView.editorAttributes.compute([field], (state): Record<string, string> =>
      state.field(field) ? { class: 'cm-drop-target' } : {},
    ),
})

/**
 * `dragenter` / `dragleave` 깊이.
 *
 * 두 이벤트는 에디터 안의 자식 엘리먼트를 지날 때마다 짝지어 오므로,
 * 세지 않으면 표시가 깜빡인다.
 */
const dragDepth = new WeakMap<EditorView, number>()

function setDropActive(view: EditorView, active: boolean): void {
  if (!active) dragDepth.delete(view)
  if (view.state.field(dropTargetField, false) === active) return
  view.dispatch({ effects: setDropTarget.of(active) })
}

/** 우리가 가로챌 드래그인가 — 저장소가 있고 파일이 실려 있어야 한다. */
function acceptsDrag(view: EditorView, data: ClipboardLike | null | undefined): boolean {
  return view.state.facet(attachmentStore) !== null && dragHasFiles(data)
}

/**
 * `drop` 이벤트 본체.
 *
 * @param pos 드롭 지점의 문서 위치. `null` 이면 현재 선택을 대체한다
 * @returns 우리가 처리했으면 `true`. `false` 면 CodeMirror 기본 동작(문자열 드래그)
 */
export function handleDrop(
  view: EditorView,
  data: ClipboardLike | null | undefined,
  pos: number | null,
): boolean {
  setDropActive(view, false)

  const store = view.state.facet(attachmentStore)
  if (!store) return false
  // 파일이 없는 드래그(에디터 안 문자열 이동 등)는 CodeMirror 에 넘긴다.
  if (!dragHasFiles(data)) return false

  const { images, skipped } = droppedFilesFrom(data)
  // `Files` 라고 광고했지만 실제로 꺼낼 파일이 없는 경우(브라우저의 지연 전송 등)도
  // CodeMirror 에 넘긴다 — 최소한 URL 텍스트라도 들어간다.
  if (images.length === 0 && skipped.length === 0) return false

  // 이미지가 없어도 `true` 다 — 그냥 넘기면 CodeMirror 기본 `drop` 이
  // pdf 를 텍스트로 읽어 본문에 쏟아붓는다.
  void insertPastedImages(view, store, images, {
    at: pos ?? undefined,
    skipped,
    action: DROP_ACTION,
  })
  return true
}

const dropHandlers = EditorView.domEventHandlers({
  // `dragover` 에서 preventDefault 하지 않으면 `drop` 이 아예 오지 않는다.
  dragover(event, view) {
    if (!acceptsDrag(view, event.dataTransfer)) return false
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    setDropActive(view, true)
    return true // → CodeMirror 가 preventDefault() 한다
  },

  dragenter(event, view) {
    if (!acceptsDrag(view, event.dataTransfer)) return false
    dragDepth.set(view, (dragDepth.get(view) ?? 0) + 1)
    setDropActive(view, true)
    return true
  },

  dragleave(_event, view) {
    const depth = (dragDepth.get(view) ?? 0) - 1
    if (depth > 0) dragDepth.set(view, depth)
    else setDropActive(view, false)
    return false // 표시만 끈다 — 기본 동작을 막지 않는다
  },

  drop(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
    if (!handleDrop(view, event.dataTransfer, pos)) return false
    event.preventDefault()
    return true
  },
})

/**
 * 첨부 확장 묶음.
 *
 * `store` 가 없으면(브라우저 개발 모드) 붙여넣기·드롭은 기본 동작으로 흐르고,
 * 이미 본문에 있는 `![](…)` 는 "첨부를 열 수 없음" 으로 보인다.
 */
export function imageAttachments(store?: AttachmentStore): Extension {
  return [
    attachmentStore.of(store ?? null),
    attachmentErrorField,
    dropTargetField,
    pasteHandler,
    dropHandlers,
    dismissErrorPanel,
  ]
}
