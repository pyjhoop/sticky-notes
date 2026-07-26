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
import { failureNotice } from '../lib/errors'
import { ACCENTS, clampOpacity, OPACITY_MAX, OPACITY_MIN, type Accent } from '../lib/palette'
import { formatDatePrefix } from '../lib/time'
import {
  applyWindowBackdrop,
  backupDb,
  checkUpdate,
  exportMarkdown,
  getAppVersion,
  getAutostart,
  getDbPath,
  getPendingUpdate,
  getSettings,
  getShortcutFailures,
  getShortcuts,
  installUpdate,
  isTauri,
  revealPath,
  setAutostart,
  setSetting,
  setShortcut,
  type Settings,
  type ShortcutAction,
  type ShortcutBinding,
  type UpdateInfo,
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
  /**
   * 자동 시작 (M7). 진실의 원천은 DB가 아니라 **OS 등록 상태**다 —
   * 사용자가 작업 관리자에서 껐을 수도 있으므로 `get_autostart` 로 읽는다.
   * `null` 이면 아직 읽지 못한 상태다.
   */
  const [autostart, setAutostartState] = useState<boolean | null>(null)

  // ── 자동 업데이트 ──────────────────────────────────────────
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  /** `idle` → `checking` → (`found` | `latest` | `failed`) → `installing` */
  const [updateState, setUpdateState] = useState<
    'idle' | 'checking' | 'found' | 'latest' | 'installing'
  >('idle')

  // mica → acrylic → 불투명. 결과를 body에 실어 배경 규칙을 전환한다 (settings.css).
  useEffect(() => {
    if (!isTauri()) return
    applyWindowBackdrop()
      .then((b) => {
        document.body.dataset.backdrop = b
      })
      .catch(() => {
        // 폴백 체인의 마지막 단계. 화면은 정상이므로 알리지 않는다.
        document.body.dataset.backdrop = 'opaque'
      })
  }, [])

  // 초기 로드 — 실패는 전부 배너로 보여준다 (ipc 폴백 제거로 더미가 뜨지 않는다)
  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s)
        document.documentElement.style.setProperty('--accent', s.accent)
      })
      .catch((e) => setNotice({ text: failureNotice('설정을 불러오지 못했습니다', e), warn: true }))
    getDbPath()
      .then(setDbPath)
      .catch((e) =>
        setNotice({ text: failureNotice('DB 경로를 불러오지 못했습니다', e), warn: true }),
      )
    getShortcuts()
      .then(setShortcuts)
      .catch((e) =>
        setNotice({ text: failureNotice('단축키를 불러오지 못했습니다', e), warn: true }),
      )
    getShortcutFailures()
      .then(setFailures)
      .catch(() => {
        // getShortcuts가 이미 같은 사유로 실패했다 — 배너를 덮어쓰지 않는다.
      })
    getAutostart()
      .then(setAutostartState)
      .catch((e) =>
        setNotice({ text: failureNotice('자동 시작 상태를 읽지 못했습니다', e), warn: true }),
      )
    getAppVersion()
      .then(setVersion)
      .catch(() => {
        // 버전 표시가 비는 것뿐이다. 배너를 띄울 일은 아니다.
      })
    // 시작 시 백엔드가 확인해 둔 결과가 있으면 바로 보여 준다.
    getPendingUpdate()
      .then((u) => {
        if (u) {
          setUpdate(u)
          setUpdateState('found')
        }
      })
      .catch(() => {})
  }, [])

  /** 지금 확인. 실패는 반드시 사유와 함께 노출한다 — 조용한 무동작이면 안 된다. */
  const onCheckUpdate = useCallback(async () => {
    setUpdateState('checking')
    try {
      const found = await checkUpdate()
      setUpdate(found)
      setUpdateState(found ? 'found' : 'latest')
    } catch (e) {
      setUpdateState('idle')
      setNotice({ text: failureNotice('업데이트를 확인하지 못했습니다', e), warn: true })
    }
  }, [])

  /**
   * 설치. 성공하면 앱이 재시작되므로 이 함수는 **돌아오지 않는다** —
   * 돌아왔다는 것은 실패했다는 뜻이다.
   */
  const onInstallUpdate = useCallback(async () => {
    setUpdateState('installing')
    try {
      await installUpdate()
    } catch (e) {
      setUpdateState('found')
      setNotice({ text: failureNotice('업데이트를 설치하지 못했습니다', e), warn: true })
    }
  }, [])

  /** 로컬 상태를 먼저 반영하고 백엔드에 흘린다. 저장 실패는 배너로 알린다. */
  const patch = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
      setSetting(key, String(value)).catch((e) =>
        setNotice({ text: failureNotice('설정을 저장하지 못했습니다', e), warn: true }),
      )
    },
    [],
  )

  /**
   * 자동 시작 토글 (M7).
   *
   * 레지스트리 쓰기가 실패할 수 있으므로 낙관적 반영을 하지 않는다 —
   * 백엔드가 돌려준 값만 화면에 쓰고, 실패는 notice 배너로 반드시 노출한다.
   */
  const onToggleAutostart = useCallback(async (next: boolean) => {
    try {
      const applied = await setAutostart(next)
      setAutostartState(applied)
      // DB의 `autostart` 설정도 맞춰 둔다 — 설정 화면 두 경로가 어긋나지 않도록.
      setSettings((prev) => (prev ? { ...prev, autostart: applied } : prev))
      void setSetting('autostart', String(applied)).catch((e) =>
        setNotice({ text: failureNotice('설정을 저장하지 못했습니다', e), warn: true }),
      )
      setNotice({
        text: applied
          ? '윈도우 시작 시 자동으로 실행됩니다.'
          : '윈도우 시작 시 자동 실행을 껐습니다.',
      })
    } catch (e) {
      setNotice({ text: failureNotice('자동 시작을 바꾸지 못했습니다', e), warn: true })
    }
  }, [])

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
      setNotice({ text: failureNotice('폴더를 열지 못했습니다', e), warn: true })
    }
  }

  const onBackup = async () => {
    setBusy(true)
    try {
      const path = await backupDb()
      setNotice({ text: `백업을 만들었습니다 · ${path}` })
    } catch (e) {
      setNotice({ text: failureNotice('백업에 실패했습니다', e), warn: true })
    } finally {
      setBusy(false)
    }
  }

  const onChooseExportDir = async () => {
    try {
      const dir = await pickDirectory('내보낼 폴더 선택')
      if (dir) patch('exportDir', dir)
    } catch (e) {
      setNotice({ text: failureNotice('폴더를 선택하지 못했습니다', e), warn: true })
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
      setNotice({ text: failureNotice('내보내기에 실패했습니다', e), warn: true })
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
        return updated.registered && !updated.error ? rest : [...rest, updated]
      })
      if (!updated.registered) {
        setNotice({
          text: `${ACTION_LABEL[action]} 단축키 등록에 실패했습니다 — ${updated.error ?? '다른 앱과 충돌'}`,
          warn: true,
        })
      }
    } catch (e) {
      setNotice({
        text: failureNotice(`${ACTION_LABEL[action]} 단축키를 바꾸지 못했습니다`, e),
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
            {`단축키 ${failures.length}개를 확인하세요 — ${failures
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
            <div className="settings__label">
              윈도우 시작 시 자동 실행
              <div className="settings__sub">로그인하면 트레이에서 바로 대기합니다</div>
            </div>
            <Toggle
              label="윈도우 시작 시 자동 실행"
              checked={autostart ?? false}
              disabled={autostart === null}
              onChange={(v) => void onToggleAutostart(v)}
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

        {/* ── UPDATE ────────────────────────────────────────── */}
        {/* 디자인에 없던 섹션이다. 모노 레이블 · settings__row 규칙은 그대로 따른다. */}
        <div className="settings__section">
          <div className="mono-label">UPDATE</div>

          <div className="settings__row">
            <div className="settings__label">
              현재 버전
              <div className="settings__sub--mono">{version || '읽는 중…'}</div>
            </div>
            <button
              type="button"
              className="dark-btn"
              disabled={updateState === 'checking' || updateState === 'installing'}
              onClick={() => void onCheckUpdate()}
            >
              {updateState === 'checking' ? '확인 중…' : '지금 확인'}
            </button>
          </div>

          {updateState === 'latest' && (
            <div className="settings__sub">최신 버전을 쓰고 있습니다.</div>
          )}

          {update && (
            <div className="settings__row">
              <div className="settings__label">
                새 버전 {update.version}
                <div className="settings__sub">
                  내려받아 설치한 뒤 앱을 다시 시작합니다. 열린 메모는 먼저 저장됩니다.
                </div>
              </div>
              <button
                type="button"
                className="dark-btn"
                disabled={updateState === 'installing'}
                onClick={() => void onInstallUpdate()}
              >
                {updateState === 'installing' ? '설치 중…' : '설치'}
              </button>
            </div>
          )}

          {update?.notes && <div className="settings__sub">{update.notes}</div>}
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
                {/* 등록은 됐지만 저장된 값이 아니라 기본값으로 되돌아간 경우 */}
                {s.registered && s.error && <div className="settings__error">{s.error}</div>}
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
