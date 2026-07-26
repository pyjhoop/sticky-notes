/**
 * IPC 실패를 **사용자에게 보이는 한국어 문장**으로 바꾼다.
 *
 * `src/lib/ipc.ts`의 폴백(더미 데이터)을 제거하면서 생긴 요구다.
 * 이제 invoke 실패는 그대로 던져지므로, 호출부는 반드시 잡아서 화면에 띄워야 한다.
 * **console.warn만 하고 넘어가면 조용한 무동작이다** (CLAUDE.md "흔한 함정").
 */

import { isTauri } from './ipc'

const UNKNOWN = '알 수 없는 오류'

/** 브라우저(`npm run dev`)에서는 백엔드가 아예 없다 — 실패 사유를 정확히 말한다. */
const NO_BACKEND = '앱(Tauri) 밖에서는 백엔드를 호출할 수 없습니다'

/** 배너 한 줄에 들어갈 길이. 넘치면 뒤를 자른다. */
const MAX_REASON = 200

/** 어떤 형태로 던져졌든 사람이 읽을 수 있는 한 줄로 만든다. */
export function errorText(e: unknown): string {
  let text: string
  if (typeof e === 'string') text = e
  else if (e instanceof Error) text = e.message
  else if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string')
    text = (e as { message: string }).message
  else if (e === null || e === undefined) text = ''
  else text = String(e)

  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return UNKNOWN
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text
}

/**
 * `<무엇을 못 했는지> — <사유>` 형태의 알림 문구.
 *
 * `what`은 이미 완결된 한국어 문장으로 넘긴다 (`'메모를 불러오지 못했습니다'`).
 */
export function failureNotice(what: string, e: unknown): string {
  const reason = isTauri() ? errorText(e) : NO_BACKEND
  return `${what} — ${reason}`
}
