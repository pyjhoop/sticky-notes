/**
 * 이미지 첨부 저장소 — 에디터(`src/editor/images.ts`)와 백엔드를 잇는다. (M7)
 *
 * 마크다운에 남는 것은 언제나 **상대 경로**(`attachments/<uuid>.png`)다.
 * 절대 경로를 본문에 넣으면 내보낸 `.md` 를 다른 PC 에서 열 수 없다
 * (CLAUDE.md 절대규칙 3·5 — 원문이 곧 모델이고, 내보내기가 유일한 다리다).
 */

import { convertFileSrc } from '@tauri-apps/api/core'

import type { AttachmentStore } from '../editor/images'
import { getAttachmentsDir, isTauri, saveAttachment } from './ipc'

/** 마크다운 상대 경로의 접두사 (`src-tauri/src/attachments.rs::ATTACHMENT_PREFIX`). */
export const ATTACHMENT_PREFIX = 'attachments/'

/** 웹뷰가 그대로 로드할 수 있는 스킴 — 파일 경로로 취급하지 않는다. */
const PASSTHROUGH_SCHEME = /^(?:https?|data|blob|asset):/i

/**
 * 첨부 폴더 경로를 한 번만 물어보고 캐싱한다.
 *
 * 메모 창 하나가 이미지 여러 장을 그리므로 매번 invoke 하지 않는다.
 * 실패하면 캐시를 비워 다음 렌더에서 다시 시도한다.
 */
let dirPromise: Promise<string> | null = null

export function attachmentsDir(): Promise<string> {
  dirPromise ??= getAttachmentsDir().catch((e) => {
    dirPromise = null
    throw e
  })
  return dirPromise
}

/** 테스트·창 전환용 — 캐시를 버린다. */
export function resetAttachmentsDirCache(): void {
  dirPromise = null
}

/**
 * `dir` 과 파일명을 그 폴더가 쓰는 구분자로 잇는다.
 *
 * 윈도우 전용 앱이지만 경로를 문자열로 다루므로 구분자를 추측하지 않고
 * 실제 값에서 읽는다.
 */
export function joinAttachmentPath(dir: string, name: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '')
  const sep = trimmed.includes('\\') ? '\\' : '/'
  return `${trimmed}${sep}${name}`
}

/**
 * 마크다운 URL에서 첨부 **파일명**만 뽑는다.
 *
 * 앞에 어떤 경로 조각이 붙어 있어도 마지막 조각만 쓴다 —
 * 파일은 언제나 첨부 폴더 안에 있고, 임의 경로를 열어 주지 않기 위해서다.
 */
export function attachmentFileName(url: string): string {
  let decoded = url.trim()
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // 잘못된 퍼센트 인코딩 — 원문 그대로 쓴다
  }
  const name = decoded.split(/[\\/]/).pop() ?? ''
  return name.trim()
}

/** Tauri 런타임에 붙는 실제 저장소. */
export const tauriAttachmentStore: AttachmentStore = {
  async save(bytes, extHint) {
    return saveAttachment(bytes, extHint)
  },

  async resolve(url) {
    const raw = url.trim()
    if (!raw) throw new Error('첨부 경로가 비어 있습니다')
    if (PASSTHROUGH_SCHEME.test(raw)) return raw

    const name = attachmentFileName(raw)
    if (!name) throw new Error(`첨부 파일명을 알 수 없습니다: ${url}`)

    const dir = await attachmentsDir()
    return convertFileSrc(joinAttachmentPath(dir, name))
  },
}

/** Tauri 밖(`npm run dev` 브라우저)에서는 첨부를 붙일 수 없다. */
export function attachmentStoreForRuntime(): AttachmentStore | undefined {
  return isTauri() ? tauriAttachmentStore : undefined
}
