/**
 * 설정 창 (M6) — 620px 고정폭.
 *
 * 근거: design/Sticky Notes for Windows.dc.html line 210-258
 *   디자인의 `OBSIDIAN` 섹션은 v1 범위 밖이라 `DATA`로 재해석됐다
 *   (plan.md "디자인 대비 변경점"). 볼트/충돌 UI는 만들지 않는다.
 *
 * 섹션: DISPLAY / DATA / SHORTCUTS
 *
 * **소유: 트랙 D (M6).**
 */

import { useCallback, useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import TitleBar from '../components/TitleBar'
import Toggle from '../components/Toggle'
import { ACCENTS, clampOpacity, OPACITY_MAX, OPACITY_MIN, type Accent } from '../lib/palette'
import { formatDatePrefix } from '../lib/time'
import {
  applyWindowBackdrop,
  backupDb,
  exportMarkdown,
  getDbPath,
  getSettings,
  getShortcutFailures,
  getShortcuts,
  isTauri,
  revealPath,
  setSetting,
  setShortcut,
  type Settings,
  type ShortcutAction,
  type ShortcutBinding,
} from '../lib/ipc'
import '../styles/settings.css'

const ACTION_LABEL: Record<ShortcutAction, string> = {
  newNote: '새 메모',
  showBoard: '모든 메모 보기',
  toggleAlwaysOnTop: '항상 위 전환',
}

const ACCENT_LABEL: Record<Accent, string> = {
  '#0067C0': '파랑',
  '#7a5cd6': '보라',
  '#3a8a4f': '초록',
  '#c05621': '주황',
}

interface Notice {
  text: string
  warn?: boolean
}

export default function SettingsWindow() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [dbPath, setDbPath] = useState('')
  const [shortcuts, setShortcuts] = useState<ShortcutBinding[]>([])
  const [failures, setFailures] = useState<ShortcutBinding[]>([])
  const [drafts, setDrafts] = useState<Partial<Record<ShortcutAction, string>>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)

  // mica → acrylic → 불투명. 결과를 body에 실어 배경 규칙을 전환한다 (settings.css).
  useEffect(() => {
    if (!isTauri()) return
    applyWindowBackdrop()
      .then((b) => {
        document.body.dataset.backdrop = b
      })
      .catch((e) => console.warn('[settings] apply_window_backdrop 실패', e))
  }, [])

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s)
        document.documentElement.style.setProperty('--accent', s.accent)
      })
      .catch((e) => console.warn('[settings] get_settings 실패', e))
    getDbPath()
      .then(setDbPath)
      .catch((e) => console.warn('[settings] get_db_path 실패', e))
    getShortcuts()
      .then(setShortcuts)
      .catch((e) => console.warn('[settings] get_shortcuts 실패', e))
    getShortcutFailures()
      .then(setFailures)
      .catch((e) => console.warn('[settings] get_shortcut_failures 실패', e))
  }, [])

  /** 로컬 상태를 먼저 반영하고 백엔드에 흘린다. */
  const patch = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
      setSetting(key, String(value)).catch((e) =>
        console.warn(`[settings] set_setting(${String(key)}) 실패`, e),
      )
    },
    [],
  )

  const pickDirectory = useCallback(async (title: string): Promise<string | null> => {
    if (!isTauri()) {
      setNotice({ text: '폴더 선택은 앱에서만 동작합니다.', warn: true })
      return null
    }
    const picked = await openDialog({ directory: true, multiple: false, title })
    return typeof picked === 'string' ? picked : null
  }, [])

  const onRevealDb = async () => {
    if (!dbPath) return
    try {
      await revealPath(dbPath)
    } catch (e) {
      setNotice({ text: `폴더를 열지 못했습니다: ${String(e)}`, warn: true })
    }
  }

  const onBackup = async () => {
    setBusy(true)
    try {
      const path = await backupDb()
      setNotice({ text: `백업을 만들었습니다 · ${path}` })
    } catch (e) {
      setNotice({ text: `백업에 실패했습니다: ${String(e)}`, warn: true })
    } finally {
      setBusy(false)
    }
  }

  const onChooseExportDir = async () => {
    try {
      const dir = await pickDirectory('내보낼 폴더 선택')
      if (dir) patch('exportDir', dir)
    } catch (e) {
      setNotice({ text: `폴더를 선택하지 못했습니다: ${String(e)}`, warn: true })
    }
  }

  const onExport = async () => {
    if (!settings) return
    setBusy(true)
    try {
      let dir = settings.exportDir
      if (!dir) {
        dir = await pickDirectory('내보낼 폴더 선택')
        if (!dir) return
        patch('exportDir', dir)
      }
      const result = await exportMarkdown(dir, settings.filenameDatePrefix)
      const skipped = result.skipped.length > 0 ? ` · 건너뜀 ${result.skipped.length}개` : ''
      setNotice({ text: `${result.count}개를 내보냈습니다 · ${result.dir}${skipped}` })
    } catch (e) {
      setNotice({ text: `내보내기에 실패했습니다: ${String(e)}`, warn: true })
    } finally {
      setBusy(false)
    }
  }

  const commitShortcut = async (action: ShortcutAction) => {
    const accelerator = (drafts[action] ?? '').trim()
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[action]
      return next
    })
    if (!accelerator) return
    const current = shortcuts.find((s) => s.action === action)
    if (current && current.accelerator === accelerator && current.registered) return
    try {
      const updated = await setShortcut(action, accelerator)
      setShortcuts((prev) => prev.map((s) => (s.action === action ? updated : s)))
      setFailures((prev) => {
        const rest = prev.filter((s) => s.action !== action)
        return updated.registered ? rest : [...rest, updated]
      })
      if (!updated.registered) {
        setNotice({
          text: `${ACTION_LABEL[action]} 단축키 등록에 실패했습니다 — ${updated.error ?? '다른 앱과 충돌'}`,
          warn: true,
        })
      }
    } catch (e) {
      setNotice({
        text: `${ACTION_LABEL[action]} 단축키를 바꾸지 못했습니다: ${String(e)}`,
        warn: true,
      })
    }
  }

  const opacity = settings ? clampOpacity(settings.defaultOpacity) : OPACITY_MIN
  const samplePrefix = formatDatePrefix(new Date().toISOString())

  return (
    <div className="dark-window">
      <TitleBar title="설정" buttons={['close']} />

      <div className="settings__body">
        {failures.length > 0 && (
          <div className="settings__notice settings__notice--warn">
            {`단축키 ${failures.length}개가 등록되지 않았습니다 — ${failures
              .map((f) => `${ACTION_LABEL[f.action]}(${f.accelerator})`)
              .join(', ')}. 다른 앱과 충돌했을 수 있습니다. 아래에서 다시 지정하세요.`}
          </div>
        )}

        {notice && <div className={notice.warn ? 'settings__notice settings__notice--warn' : 'settings__notice'}>{notice.text}</div>}

        {/* ── DISPLAY ───────────────────────────────────────── */}
        <div className="settings__section">
          <div className="mono-label">DISPLAY</div>

          <div className="settings__row">
            <div className="settings__label">항상 다른 앱 위에 표시</div>
            <Toggle
              label="항상 다른 앱 위에 표시"
              checked={settings?.alwaysOnTop ?? false}
              disabled={!settings}
              onChange={(v) => patch('alwaysOnTop', v)}
            />
          </div>

          <div className="settings__row">
            <div className="settings__label">
              비활성 시 자동으로 흐려짐
              <div className="settings__sub">포커스를 잃으면 설정한 투명도까지 부드럽게 감소</div>
            </div>
            <Toggle
              label="비활성 시 자동으로 흐려짐"
              checked={settings?.autoFade ?? false}
              disabled={!settings}
              onChange={(v) => patch('autoFade', v)}
            />
          </div>

          <div className="settings__row">
            <div className="settings__label">기본 투명도</div>
            <input
              className="settings__range"
              type="range"
              min={OPACITY_MIN}
              max={OPACITY_MAX}
              value={opacity}
              disabled={!settings}
              aria-label="기본 투명도"
              onChange={(e) => patch('defaultOpacity', clampOpacity(Number(e.target.value)))}
            />
            <div className="settings__range-value">{opacity}%</div>
          </div>

          <div className="settings__row">
            <div className="settings__label">악센트 색</div>
            <div className="settings__accents">
              {ACCENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className="settings__accent"
                  style={{ background: a }}
                  aria-pressed={settings?.accent === a}
                  aria-label={`악센트 ${ACCENT_LABEL[a]}`}
                  title={ACCENT_LABEL[a]}
                  onClick={() => {
                    document.documentElement.style.setProperty('--accent', a)
                    patch('accent', a)
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="settings__divider" />

        {/* ── DATA ──────────────────────────────────────────── */}
        <div className="settings__section">
          <div className="mono-label">DATA</div>

          <div className="settings__field-group">
            <div style={{ fontSize: 'var(--fs-body-sm)' }}>데이터베이스 위치</div>
            <div className="settings__field-row">
              <div className="dark-field" title={dbPath}>
                {dbPath || '경로를 불러오는 중…'}
              </div>
              <button type="button" className="dark-btn" disabled={!dbPath} onClick={() => void onRevealDb()}>
                폴더 열기
              </button>
            </div>
          </div>

          <div className="settings__row">
            <div className="settings__label">
              백업 만들기
              <div className="settings__sub">데이터베이스 파일을 복사본으로 저장합니다</div>
            </div>
            <button type="button" className="dark-btn" disabled={busy} onClick={() => void onBackup()}>
              백업 만들기
            </button>
          </div>

          <div className="settings__field-group">
            <div style={{ fontSize: 'var(--fs-body-sm)' }}>마크다운으로 내보내기</div>
            <div className="settings__field-row">
              <div className="dark-field" title={settings?.exportDir ?? ''}>
                {settings?.exportDir || '폴더를 선택하세요'}
              </div>
              <button type="button" className="dark-btn" onClick={() => void onChooseExportDir()}>
                찾아보기
              </button>
              <button type="button" className="dark-btn" disabled={busy} onClick={() => void onExport()}>
                내보내기
              </button>
            </div>
          </div>

          <div className="settings__row">
            <div className="settings__label">
              파일명에 생성일 프리픽스
              <div className="settings__sub--mono">{samplePrefix} 스프린트24.md</div>
            </div>
            <Toggle
              label="파일명에 생성일 프리픽스"
              checked={settings?.filenameDatePrefix ?? false}
              disabled={!settings}
              onChange={(v) => patch('filenameDatePrefix', v)}
            />
          </div>
        </div>

        <div className="settings__divider" />

        {/* ── SHORTCUTS ─────────────────────────────────────── */}
        <div className="settings__section">
          <div className="mono-label">SHORTCUTS</div>

          {shortcuts.length === 0 && (
            <div className="settings__sub">단축키 정보를 불러오지 못했습니다.</div>
          )}

          {shortcuts.map((s) => (
            <div className="settings__row" key={s.action}>
              <div className="settings__label">
                {ACTION_LABEL[s.action]}
                {!s.registered && (
                  <div className="settings__error">
                    등록 실패 — {s.error ?? '다른 앱과 충돌했을 수 있습니다'}
                  </div>
                )}
              </div>
              <input
                className="settings__accel"
                type="text"
                spellCheck={false}
                aria-label={`${ACTION_LABEL[s.action]} 단축키`}
                value={drafts[s.action] ?? s.accelerator}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [s.action]: e.target.value }))}
                onBlur={() => void commitShortcut(s.action)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    setDrafts((prev) => {
                      const next = { ...prev }
                      delete next[s.action]
                      return next
                    })
                  }
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
