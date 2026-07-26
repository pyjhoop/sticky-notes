import { describe, expect, it } from 'vitest'

import { SHORTCUT_SETTING_KEY, type ShortcutAction } from './ipc'

/**
 * 통합 게이트 #2 — 단축키 영속화.
 *
 * key 문자열은 `src-tauri/src/shortcuts.rs`의 `setting_key()`,
 * `src-tauri/src/db.rs`의 `SETTING_KEYS`와 **글자까지 같아야 한다.**
 * 어긋나면 `put_setting`이 "알 수 없는 설정 key"로 거부해서
 * 재바인딩이 조용히 저장되지 않는다 (실제로 그랬다 — 예전 key는 `shortcut.newNote`였다).
 */
describe('단축키 설정 key', () => {
  it('동작 3개가 전부 매핑돼 있다', () => {
    const actions: ShortcutAction[] = ['newNote', 'showBoard', 'toggleAlwaysOnTop']
    expect(Object.keys(SHORTCUT_SETTING_KEY).sort()).toEqual([...actions].sort())
  })

  it('Rust setting_key()와 같은 camelCase 문자열이다', () => {
    expect(SHORTCUT_SETTING_KEY).toEqual({
      newNote: 'shortcutNewNote',
      showBoard: 'shortcutShowBoard',
      toggleAlwaysOnTop: 'shortcutToggleAlwaysOnTop',
    })
  })

  it('점(.)이 들어간 옛 key 형식을 쓰지 않는다', () => {
    for (const key of Object.values(SHORTCUT_SETTING_KEY)) {
      expect(key).not.toContain('.')
    }
  })
})
