//! 전역 단축키 3개 + 재바인딩 + 자동 시작.
//!
//! **등록 실패는 반드시 사용자에게 노출한다** (`CLAUDE.md` "흔한 함정").
//! `Ctrl+Alt+N`은 타 앱과 흔히 충돌하고, 조용한 무동작은 디버깅이 불가능하다.
//!
//! **소유: 트랙 C (M4).**

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Runtime;

use crate::CmdResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutAction {
    /// 새 메모
    NewNote,
    /// 모든 메모 보기 (보드 토글)
    ShowBoard,
    /// 항상 위 전환
    ToggleAlwaysOnTop,
}

pub const DEFAULT_NEW_NOTE: &str = "Ctrl+Alt+N";
pub const DEFAULT_SHOW_BOARD: &str = "Ctrl+Alt+M";
pub const DEFAULT_TOGGLE_TOP: &str = "Ctrl+Alt+T";

/// 하나의 단축키 바인딩과 그 등록 결과.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBinding {
    pub action: ShortcutAction,
    /// `Ctrl+Alt+N` 형식
    pub accelerator: String,
    /// 등록에 성공했는가. 거짓이면 설정 창과 토스트에 노출한다
    pub registered: bool,
    /// 실패 사유 (한국어)
    pub error: Option<String>,
}

impl ShortcutBinding {
    pub fn new(action: ShortcutAction, accelerator: &str) -> Self {
        Self {
            action,
            accelerator: accelerator.to_string(),
            registered: false,
            error: None,
        }
    }
}

#[derive(Default)]
pub struct ShortcutState(pub Mutex<Vec<ShortcutBinding>>);

pub fn defaults() -> Vec<ShortcutBinding> {
    vec![
        ShortcutBinding::new(ShortcutAction::NewNote, DEFAULT_NEW_NOTE),
        ShortcutBinding::new(ShortcutAction::ShowBoard, DEFAULT_SHOW_BOARD),
        ShortcutBinding::new(ShortcutAction::ToggleAlwaysOnTop, DEFAULT_TOGGLE_TOP),
    ]
}

/// 앱 setup에서 1회 호출.
// TODO(M4): 트랙 C — 저장된 바인딩을 읽어 등록하고 실패를 state에 기록
pub fn init<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    let state = app.state::<ShortcutState>();
    *state.0.lock().unwrap() = defaults();
    Ok(())
}

#[tauri::command]
pub fn get_shortcuts(state: tauri::State<'_, ShortcutState>) -> CmdResult<Vec<ShortcutBinding>> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

/// 재바인딩. 기존 것을 해제하고 새로 등록한 결과를 돌려준다.
#[tauri::command]
// TODO(M4): 트랙 C — unregister + register + settings 영속화
pub fn set_shortcut<R: Runtime>(
    _app: tauri::AppHandle<R>,
    _state: tauri::State<'_, ShortcutState>,
    action: ShortcutAction,
    accelerator: String,
) -> CmdResult<ShortcutBinding> {
    let _ = (action, accelerator);
    Err("미구현: set_shortcut (M4 · 트랙 C)".into())
}

/// 등록에 실패한 단축키만 추린다. 시작 직후 토스트로 노출하는 용도.
#[tauri::command]
pub fn get_shortcut_failures(
    state: tauri::State<'_, ShortcutState>,
) -> CmdResult<Vec<ShortcutBinding>> {
    Ok(state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .filter(|b| !b.registered)
        .cloned()
        .collect())
}

#[tauri::command]
pub fn get_autostart<R: Runtime>(app: tauri::AppHandle<R>) -> CmdResult<bool> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("자동 시작 상태를 읽을 수 없습니다: {e}"))
}

#[tauri::command]
pub fn set_autostart<R: Runtime>(app: tauri::AppHandle<R>, enabled: bool) -> CmdResult<bool> {
    use tauri_plugin_autostart::ManagerExt;
    let m = app.autolaunch();
    let r = if enabled { m.enable() } else { m.disable() };
    r.map_err(|e| format!("자동 시작 설정 실패: {e}"))?;
    Ok(enabled)
}
