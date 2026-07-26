/**
 * 설정 창 — M0 빈 스텁.
 *
 * **소유: 트랙 D (M6).** DISPLAY / DATA / SHORTCUTS 세 섹션을 트랙 D가 채운다.
 * 디자인의 `OBSIDIAN` 섹션은 `DATA`로 재해석된다 (`plan.md` "디자인 대비 변경점").
 */

import { useEffect, useState } from 'react'
import { applyWindowBackdrop, getSettings, isTauri, type Settings } from '../lib/ipc'

const SECTIONS = ['DISPLAY', 'DATA', 'SHORTCUTS'] as const

export default function SettingsWindow() {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    if (isTauri()) {
      applyWindowBackdrop().then((b) => {
        document.body.dataset.backdrop = b
      })
    }
    getSettings().then(setSettings)
  }, [])

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--radius-window)',
        overflow: 'hidden',
        background: 'var(--dark-bg-settings)',
        border: '1px solid var(--dark-border)',
        color: 'var(--dark-text)',
      }}
    >
      {/* TODO(M6): 트랙 D — TitleBar 컴포넌트로 교체 */}
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
        <span style={{ fontSize: 'var(--fs-meta)', color: 'var(--dark-text-2)' }}>설정</span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--settings-section-gap)',
          padding: 'var(--settings-pad-y) var(--settings-pad-x) 26px',
        }}
      >
        {SECTIONS.map((s) => (
          <div key={s} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--settings-row-gap)' }}>
            <div className="mono-label">{s}</div>
            {/* TODO(M6): 트랙 D — 각 섹션 내용 */}
            <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--dark-text-3)' }}>
              M6에서 구현
            </div>
          </div>
        ))}
        <div style={{ fontSize: 'var(--fs-small)', color: 'var(--dark-text-3)' }}>
          기본 투명도 {settings?.defaultOpacity ?? '—'}%
        </div>
      </div>
    </div>
  )
}
