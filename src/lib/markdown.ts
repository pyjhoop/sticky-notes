/**
 * 마크다운 파생 — 제목, `#태그`, `[[위키링크]]`.
 *
 * **소유: 트랙 B (M3).** M0에서는 시그니처만 확정한다.
 *
 * 주의 — `plan.md` 검증 절:
 * **코드블록(``` 펜스 / 인라인 코드) 내부의 `#태그`·`[[링크]]`는 추출되면 안 된다.**
 * 아래 M0 스텁은 그 규칙을 지키지 않는다. 트랙 B가 교체한다.
 */

/** 제목 파생 규칙: 첫 `# 제목` → 없으면 첫 비어있지 않은 줄 → 80자 절단 → 없으면 `제목 없음` */
export const UNTITLED = '제목 없음'
export const TITLE_MAX = 80

/**
 * 본문에서 보드용 제목을 파생한다.
 *
 * TODO(M3): 트랙 B — 코드블록으로 시작하는 본문 등 엣지케이스 처리
 */
export function deriveTitle(body: string): string {
  const lines = body.split(/\r?\n/)
  const heading = lines.find((l) => /^#{1,6}\s+\S/.test(l))
  const source = heading ?? lines.find((l) => l.trim().length > 0)
  if (!source) return UNTITLED
  const text = source.replace(/^#{1,6}\s+/, '').trim()
  if (!text) return UNTITLED
  return text.length > TITLE_MAX ? text.slice(0, TITLE_MAX) : text
}

/**
 * `#태그`를 추출한다. `#` 은 결과에 포함하지 않는다.
 *
 * TODO(M3): 트랙 B — 코드블록/인라인코드 내부 제외, ATX 제목(`# `)과 구분
 */
export function extractTags(_body: string): string[] {
  return []
}

/**
 * `[[위키링크]]`의 대상을 추출한다. 대괄호는 결과에 포함하지 않는다.
 *
 * TODO(M3): 트랙 B — 코드블록/인라인코드 내부 제외
 */
export function extractLinks(_body: string): string[] {
  return []
}

/** 보드 카드 미리보기 — 마크다운 마커를 걷어낸 평문 한 덩어리. */
export function derivePreview(_body: string, _maxLength = 120): string {
  // TODO(M3): 트랙 B
  return ''
}
