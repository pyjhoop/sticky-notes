/**
 * 보드 창 — M0 빈 스텁.
 *
 * **소유: 트랙 D (M5).** 커스텀 타이틀바(44px `—` `▢` `✕`), 검색 3모드,
 * 5색 필터 칩, 4열 카드 그리드(132px)를 트랙 D가 채운다.
 */

import { useEffect, useState } from 'react'
import { applyWindowBackdrop, isTauri, listNotes, type NoteSummary } from '../lib/ipc'

export default function BoardWindow() {
  const [notes, setNotes] = useState<NoteSummary[]>([])

  useEffect(() => {
    // mica → acrylic → 불투명 폴백. 결과를 body에 실어 배경 규칙을 전환한다.
    if (isTauri()) {
      applyWindowBackdrop().then((b) => {
        document.body.dataset.backdrop = b
      })
    }
    listNotes().then(setNotes)
  }, [])

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--radius-window)',
        overflow: 'hidden',
        background: 'var(--dark-bg)',
        border: '1px solid var(--dark-border)',
        color: 'var(--dark-text)',
      }}
    >
      {/* TODO(M5): 트랙 D — TitleBar 컴포넌트로 교체 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 'var(--titlebar-h)',
          flex: 'none',
          paddingLeft: 14,
          borderBottom: '1px solid var(--dark-divider)',
        }}
      >
        <span style={{ fontSize: 'var(--fs-meta)', fontWeight: 500, color: 'var(--dark-text-2)' }}>
          모든 메모
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          placeItems: 'center',
          padding: 'var(--board-pad)',
          fontSize: 'var(--fs-meta)',
          color: 'var(--dark-text-3)',
        }}
      >
        {/* TODO(M5): 트랙 D — 검색창 · 색상 필터 · 카드 그리드 */}
        메모 {notes.length}개 · M5에서 구현
      </div>
    </div>
  )
}
