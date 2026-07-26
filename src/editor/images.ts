/**
 * 이미지 첨부 인라인 위젯.
 *
 * **소유: 트랙 B. 구현은 M7 범위다 — 여기서는 인터페이스만 잡아 둔다.**
 *
 * plan.md M7:
 *   붙여넣기 → 이미지 바이트를 `%APPDATA%\...\attachments\<uuid>.png`에 저장
 *   → `![](attachments/x.png)` 삽입 → `convertFileSrc()`로 인라인 위젯 렌더.
 *   디자인의 96×64 플레이스홀더(`--attach-w` / `--attach-h`) 스타일 재사용.
 *
 * 저장 커맨드가 트랙 A(`src-tauri`)에 없으므로 M3에서는 확장을 등록하지 않는다.
 * `createNoteEditorExtensions({ attachments })`에 이 인터페이스를 넘기는 순간
 * M7 구현이 붙을 자리다.
 */

import type { Extension } from '@codemirror/state'

/** 붙여넣은 이미지를 앱 저장소에 넣고 마크다운에 쓸 상대 경로를 돌려준다. */
export interface AttachmentStore {
  /** @returns `attachments/<uuid>.png` 형태의 상대 경로 */
  save(bytes: Uint8Array, mimeType: string): Promise<string>
  /** 마크다운의 상대 경로 → 웹뷰가 로드할 수 있는 URL (`convertFileSrc`) */
  resolve(relativePath: string): string
}

/**
 * M7에서 채운다 — 지금은 확장을 만들지 않는다.
 *
 * 빈 배열을 돌려주므로 `createNoteEditorExtensions`가 그대로 펼쳐 넣어도 무해하다.
 */
export function imageAttachments(_store?: AttachmentStore): Extension {
  // TODO(M7): 붙여넣기 핸들러 + Image 노드 → 인라인 위젯 데코레이션
  return []
}
