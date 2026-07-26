/**
 * 커스텀 타이틀바 — 보드 · 설정 공용.
 *
 * 근거: design/Sticky Notes for Windows.dc.html
 *   보드   line 156-164  height:40 / padding-left:14 / 버튼 44px(— ▢ ✕)
 *   설정   line 211-215  같은 바에 ✕ 하나만
 *
 * 제목 영역 mousedown → `startDragging()`, 더블클릭 → 최대화 토글.
 * 메모 창은 프레임리스라 이 컴포넌트를 쓰지 않는다.
 *
 * **소유: 트랙 D.**
 */

import type { MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '../lib/ipc'

export type TitleBarButton = 'minimize' | 'maximize' | 'close'

export interface TitleBarProps {
  title: string
  /** 왼쪽→오른쪽 순서 그대로 그린다. 기본값은 디자인의 보드 창(— ▢ ✕) */
  buttons?: readonly TitleBarButton[]
  /** 제목을 medium(500)으로 — 디자인상 보드는 500, 설정은 400 */
  strongTitle?: boolean
  /**
   * `✕` 동작 재정의. 기본은 `destroy()`
   * (닫은 창은 hide가 아니라 destroy — plan.md "창 수명").
   */
  onClose?: () => void
}

const DEFAULT_BUTTONS: readonly TitleBarButton[] = ['minimize', 'maximize', 'close']

const GLYPH: Record<TitleBarButton, string> = {
  minimize: '—',
  maximize: '▢',
  close: '✕',
}

const LABEL: Record<TitleBarButton, string> = {
  minimize: '최소화',
  maximize: '최대화',
  close: '닫기',
}

async function withWindow(fn: (w: ReturnType<typeof getCurrentWindow>) => Promise<unknown>) {
  if (!isTauri()) return
  try {
    await fn(getCurrentWindow())
  } catch (e) {
    console.warn('[titlebar] 창 조작 실패', e)
  }
}

export default function TitleBar({
  title,
  buttons = DEFAULT_BUTTONS,
  strongTitle = false,
  onClose,
}: TitleBarProps) {
  const canMaximize = buttons.includes('maximize')

  const onTitleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    // 왼쪽 버튼만. 더블클릭(detail 2)은 최대화 토글이 처리한다.
    if (e.button !== 0 || e.detail > 1) return
    void withWindow((w) => w.startDragging())
  }

  const onTitleDoubleClick = () => {
    if (!canMaximize) return
    void withWindow((w) => w.toggleMaximize())
  }

  const press = (kind: TitleBarButton) => {
    switch (kind) {
      case 'minimize':
        void withWindow((w) => w.minimize())
        break
      case 'maximize':
        void withWindow((w) => w.toggleMaximize())
        break
      case 'close':
        if (onClose) onClose()
        else void withWindow((w) => w.destroy())
        break
    }
  }

  return (
    <div className="titlebar">
      <div
        className="titlebar__drag"
        onMouseDown={onTitleMouseDown}
        onDoubleClick={onTitleDoubleClick}
      >
        <span className={strongTitle ? 'titlebar__title titlebar__title--strong' : 'titlebar__title'}>
          {title}
        </span>
      </div>
      <div className="titlebar__buttons">
        {buttons.map((b) => (
          <button
            key={b}
            type="button"
            title={LABEL[b]}
            aria-label={LABEL[b]}
            className={`titlebar__btn titlebar__btn--${b}`}
            onClick={() => press(b)}
          >
            {GLYPH[b]}
          </button>
        ))}
      </div>
    </div>
  )
}
