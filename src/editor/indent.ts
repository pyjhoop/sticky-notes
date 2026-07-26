/**
 * Tab / Shift-Tab 들여쓰기 — **코드블록과 목록 안에서만.**
 *
 * **소유: 트랙 B (M3).**
 *
 * ── 왜 아무것도 안 먹고 있었나
 *
 * "어쩔 수 없다"가 아니다. `defaultKeymap`은 Tab을 **일부러 바인딩하지 않는다.**
 * Tab이 포커스 이동이라는 접근성 규약을 깨지 않기 위해서고, 필요하면
 * `@codemirror/commands`의 `indentWithTab`(`{ key: "Tab", run: indentMore,
 * shift: indentLess }`, dist:1807)을 직접 붙이라는 설계다. `editor/index.ts`가
 * `defaultKeymap + historyKeymap`만 쓰고 있었으므로 Tab은 브라우저 기본 동작,
 * 즉 포커스 이동으로 흘렀다.
 *
 * ── 어디에 적용하는가 — 코드블록 + 목록. 문서 전체가 아니다
 *
 * `indentWithTab`을 그대로 붙이면 문서 어디서든 Tab이 먹힌다. 그러면 두 가지가
 * 깨진다:
 *
 *   1. **키보드만으로 에디터를 빠져나갈 수 없다.** CodeMirror 공식 문서가 경고하는
 *      바로 그 지점이다.
 *   2. **문단에서 Tab 두 번이면 코드블록이 된다.** 들여쓰기 단위가 스페이스 2칸이라
 *      두 번이면 4칸이고, CommonMark에서 앞 공백 4칸은 들여쓴 코드블록(`CodeBlock`)
 *      이다. 메모에 문단을 쓰다가 Tab을 눌렀더니 글이 검은 상자가 되는 것은
 *      "마크다운 원문이 모델"(CLAUDE.md 절대규칙 3)인 이 앱에서 특히 나쁘다.
 *
 * 그래서 커서가 **코드블록 / 목록** 안일 때만 들여쓰기로 쓰고, 그 밖(문단·제목·인용)
 * 에서는 커맨드가 `false`를 돌려준다. 키맵은 커맨드가 false면 `preventDefault`를
 * 하지 않으므로 Tab은 그대로 브라우저에 흘러 포커스가 이동한다 — **평범한 산문
 * 위에서는 Tab이 여전히 탈출구다.**
 *
 * 목록을 포함시킨 이유는 마크다운 메모에서 목록 중첩이 코드 들여쓰기만큼 흔하고,
 * 목록 안에서의 앞 공백은 "코드블록으로 변한다"는 위 2번 위험이 없기 때문이다
 * (목록 항목 안에서 공백은 중첩 깊이로 읽힌다).
 *
 * ── 탈출 경로 (전부 `defaultKeymap`에 이미 있다 — 새로 만들 필요가 없었다)
 *
 *   · **문단에서는 그냥 Tab** — 위에서 말한 대로 false로 흘려보낸다
 *   · **Escape 다음 Tab** — Escape를 누르면 `inputState.tabFocusMode`가 2초간 켜지고
 *     (@codemirror/view 6.43.6 · dist:4936), 그동안 Tab은 키맵을 아예 거치지 않고
 *     브라우저로 간다(dist:4588). CodeMirror가 권하는 표준 탈출구다
 *   · **Ctrl-m** — `toggleTabFocusMode`. `defaultKeymap`에 들어 있다(dist:1738)
 *   · **Ctrl-[ / Ctrl-]** — `indentLess`/`indentMore`. 코드블록·목록 밖에서도 쓸 수 있는
 *     들여쓰기 경로가 필요하면 이것이다. 역시 `defaultKeymap`에 있다
 *
 * ── 스페이스인가 탭 문자인가 — **스페이스 2칸**
 *
 * `indentMore`는 `indentUnit` 파셋 값을 줄머리에 넣는다(dist:1604). 기본값이 스페이스
 * 2칸이고, 여기서 그것을 **명시적으로** 못박는다. 탭 문자를 쓰지 않는 이유:
 *
 *   1. **펜스 판정이 어긋난다.** `process.md`의 통합 게이트 #3이 바로 그 사고였다.
 *      지금은 Rust `after_space_indent()`(src-tauri/src/notes.rs:126)와 프론트
 *      `FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/`(src/lib/markdown.ts:31)가 **둘 다
 *      스페이스만** 0~3칸 인정하도록 맞춰져 있다. 반면 lezer-markdown은 CommonMark
 *      대로 탭을 4칸으로 확장해 센다. 즉 탭으로 들여쓴 펜스는 세 파서가 서로 다르게
 *      읽는다 — 제목/태그 추출(Rust)과 화면(lezer)이 갈린다.
 *      스페이스 2칸이면 한 번 눌러도 2칸(≤3)이라 세 파서 모두 펜스로 읽고,
 *      두 번 눌러 4칸이 되면 세 파서 모두 펜스가 아니라고 읽는다. **일치한다.**
 *   2. **내보낸 `.md`가 다른 렌더러에서 같아야 한다.** CommonMark의 탭은 폭이
 *      "탭 스톱까지"라 앞에 무엇이 있느냐로 칸 수가 달라진다. 목록 중첩 깊이가
 *      옵시디언·GitHub에서 어긋날 수 있다 (CLAUDE.md 절대규칙 5의 유일한 다리가
 *      마크다운 내보내기다).
 *   3. CodeMirror 기본값과 같아 놀랄 일이 없다.
 *
 * 2칸인 이유: `- ` 목록의 내용 열이 2이므로 CommonMark에서 한 단계 중첩에 필요한
 * 최소 들여쓰기가 정확히 2칸이다.
 *
 * ── 커서 위치가 아니라 줄머리에 넣는다
 *
 * `indentMore`/`indentLess`는 선택에 걸친 **줄들의 맨 앞**을 건드린다(줄 중간에서
 * 눌러도 커서 자리에 공백이 들어가지 않는다). 공식 `indentWithTab`과 같은 동작이고,
 * 목록 중첩에서는 이쪽이 유일하게 맞는 동작이다.
 *
 * CLAUDE.md 절대규칙 3 — 문서는 사용자가 친 마크다운 원문 그대로다. 여기서 넣는
 * 공백도 데코레이션이 아니라 **사용자가 요청한 실제 텍스트 변경**이며, 변경은 전부
 * 트랜잭션(`indentMore`/`indentLess`가 `dispatch`)으로 간다 (절대규칙 4).
 */

import { indentLess, indentMore } from '@codemirror/commands'
import { indentUnit, syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import type { Command, KeyBinding } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

/**
 * Tab이 들여쓰기로 동작하는 문맥.
 *
 * `FencedCode`/`CodeBlock`은 `inlineMarkers.ts`의 코드블록 배경과 같은 집합이고,
 * `BulletList`/`OrderedList`/`ListItem`은 lezer-markdown의 목록 노드다
 * (`- [ ]` 할 일도 `ListItem` 안의 `Task`라 함께 걸린다).
 */
const INDENTABLE_NODES = new Set([
  'FencedCode',
  'CodeBlock',
  'BulletList',
  'OrderedList',
  'ListItem',
])

/** `pos`가 놓인 줄이 코드블록이나 목록 안인가. */
function indentableAt(state: EditorState, pos: number): boolean {
  // 줄머리 한 점만 본다 — 그 줄이 어느 블록에 속하는지는 줄 안 어디서든 같고,
  // 빈 줄(`line.from === line.to`)에서도 성립한다. (`codeBlockAt`과 같은 방식)
  const line = state.doc.lineAt(pos)
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, 1)
  while (node) {
    if (INDENTABLE_NODES.has(node.name)) return true
    node = node.parent
  }
  return false
}

/**
 * 모든 선택 범위가 들여쓰기 문맥 안인가.
 *
 * "모두"인 이유 — 하나라도 문단 위에 있으면 그 줄에 공백 4칸이 쌓여 코드블록으로
 * 변할 수 있다. 애매하면 Tab을 포커스 이동으로 넘기는 쪽이 안전하다.
 */
export function tabIndents(state: EditorState): boolean {
  return state.selection.ranges.every(
    (range) => indentableAt(state, range.from) && indentableAt(state, range.to),
  )
}

/** 코드블록·목록 안에서만 `indentMore`. 밖이면 `false` → Tab이 포커스 이동으로 흐른다. */
export const indentMoreInMarkdown: Command = (target) =>
  tabIndents(target.state) ? indentMore(target) : false

/** 위의 짝. Shift-Tab 내어쓰기. */
export const indentLessInMarkdown: Command = (target) =>
  tabIndents(target.state) ? indentLess(target) : false

/**
 * `editor/index.ts`의 `keymap.of([...])`에 그대로 펼쳐 넣는다.
 *
 * `preventDefault`를 **주지 않는다.** 커맨드가 false를 돌려줬을 때 CodeMirror가
 * 이벤트를 막지 않아야 Tab이 브라우저 기본 동작(포커스 이동)으로 흐른다.
 */
export const tabIndentKeymap: KeyBinding[] = [
  { key: 'Tab', run: indentMoreInMarkdown, shift: indentLessInMarkdown },
]

/** 들여쓰기 단위 — 스페이스 2칸. 근거는 이 파일 머리말. */
export const markdownIndentUnit: Extension = indentUnit.of('  ')
