/**
 * 창 전체의 파일 드롭 방어막. (M7 — 드래그 앤 드롭)
 *
 * **왜 필요한가.** `tauri.conf.json` 의 세 창은 전부 `dragDropEnabled: false` 다.
 * 즉 드롭을 네이티브가 가로채지 않고 웹뷰가 직접 받는다. 크로미움의 기본 동작은
 * "파일을 페이지에 떨어뜨리면 그 파일로 네비게이션한다" 이므로, 아무도 막지 않으면
 * 컨트롤 바나 푸터에 사진을 떨어뜨리는 순간 SPA 가 통째로 날아가고
 * 프레임리스 창에는 돌아올 뒤로가기 버튼조차 없다.
 *
 * 그래서 **에디터 본문(`.cm-content`) 밖의 모든 드롭을 기본 동작만 막고 삼킨다.**
 * 삽입은 하지 않는다 — 그건 `src/editor/images.ts` 의 CodeMirror 핸들러 몫이다.
 * 보드·설정 창에는 에디터가 없으므로 전 영역이 여기서 막힌다.
 *
 * `.cm-content` 안쪽은 그대로 통과시킨다. 그래야
 *   · 이미지 드롭 → `images.ts` 의 `drop` 핸들러
 *   · 문자열 드래그 → CodeMirror 기본 동작
 * 둘 다 살아 있다.
 */

/** CodeMirror 본문 — 이 안은 에디터가 알아서 한다. */
const EDITOR_CONTENT = '.cm-content'

function insideEditor(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITOR_CONTENT) !== null
}

/**
 * `dragover` / `drop` 을 문서에 걸어 파일 네비게이션을 막는다.
 *
 * @returns 해제 함수 (테스트·HMR 용)
 */
export function installFileDropGuard(target: Document = document): () => void {
  const onDragOver = (event: Event) => {
    if (insideEditor(event.target)) return
    event.preventDefault()
    // 커서에 "여기엔 못 놓는다" 를 표시한다 — 조용히 무시하는 것보다 낫다.
    const dt = (event as DragEvent).dataTransfer
    if (dt) dt.dropEffect = 'none'
  }

  const onDrop = (event: Event) => {
    if (insideEditor(event.target)) return
    event.preventDefault()
  }

  target.addEventListener('dragover', onDragOver)
  target.addEventListener('drop', onDrop)

  return () => {
    target.removeEventListener('dragover', onDragOver)
    target.removeEventListener('drop', onDrop)
  }
}
