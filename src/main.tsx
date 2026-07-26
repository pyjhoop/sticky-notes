/**
 * 단일 엔트리 — `?w=` 쿼리로 창을 분기한다.
 *
 * 세 창이 같은 SPA 번들을 로드한다. WebView2가 번들을 캐싱하므로
 * 창마다 재다운로드하지 않는다.
 *
 *   ?w=note&id=<id>   메모 창
 *   ?w=board          보드 창
 *   ?w=settings       설정 창
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// 폰트는 전부 로컬 번들 — CDN 금지 (CLAUDE.md 절대규칙 2)
import '@fontsource/noto-sans-kr/400.css'
import '@fontsource/noto-sans-kr/500.css'
import '@fontsource/noto-sans-kr/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'

import './styles/tokens.css'
import './styles/global.css'

import NoteWindow from './windows/NoteWindow'
import BoardWindow from './windows/BoardWindow'
import SettingsWindow from './windows/SettingsWindow'

export type WindowKind = 'note' | 'board' | 'settings'

export interface WindowRoute {
  kind: WindowKind
  /** `?w=note` 일 때만 의미가 있다 */
  noteId: string | null
  /** M0 스파이크 확인용 — `?opacity=35` 로 초기 투명도를 강제한다 */
  opacityOverride: number | null
}

export function parseRoute(search: string): WindowRoute {
  const q = new URLSearchParams(search)
  const w = q.get('w')
  const kind: WindowKind = w === 'board' || w === 'settings' ? w : 'note'
  const opacity = q.get('opacity')
  return {
    kind,
    noteId: q.get('id'),
    opacityOverride: opacity !== null && opacity !== '' ? Number(opacity) : null,
  }
}

const route = parseRoute(window.location.search)
document.body.dataset.window = route.kind

function App() {
  switch (route.kind) {
    case 'board':
      return <BoardWindow />
    case 'settings':
      return <SettingsWindow />
    default:
      return <NoteWindow noteId={route.noteId ?? 'spike'} opacityOverride={route.opacityOverride} />
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
