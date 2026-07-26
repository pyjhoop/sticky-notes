//! 전역 단축키 3개 + 재바인딩 + 자동 시작.
//!
//! **등록 실패는 반드시 사용자에게 노출한다** (`CLAUDE.md` "흔한 함정").
//! `Ctrl+Alt+N`은 타 앱과 흔히 충돌하고, 조용한 무동작은 디버깅이 불가능하다.
//! 실패는 `ShortcutState`에 남고 `get_shortcut_failures`로 프론트가 읽어 배너로 띄운다
//! (`src/windows/NoteWindow.tsx`의 `.note-alert`).
//!
//! 트레이 메뉴와 단축키가 **같은 동작 함수**(`run_action`)를 공유한다.
//!
//! **소유: 트랙 C (M4).**

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState as PressState};

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

/// `settings` 테이블에 쓸 키 이름.
fn setting_key(action: ShortcutAction) -> &'static str {
    match action {
        ShortcutAction::NewNote => "shortcut.newNote",
        ShortcutAction::ShowBoard => "shortcut.showBoard",
        ShortcutAction::ToggleAlwaysOnTop => "shortcut.toggleAlwaysOnTop",
    }
}

// ─────────────────────────────────────────────────────────────
// 동작 — 트레이 메뉴와 단축키가 공유한다
// ─────────────────────────────────────────────────────────────

/// 전역 "항상 위" 상태. 트레이 `항상 위 전환` / `Ctrl+Alt+T`가 뒤집는다.
/// 기본값은 `notes.pinned` 기본값(1)과 맞춘다.
static ALWAYS_ON_TOP: AtomicBool = AtomicBool::new(true);

/// `sticky://note-meta-changed` 페이로드.
/// `id`가 `None`이면 열린 메모 창 **전체**에 적용된다는 뜻이다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaChanged {
    pub id: Option<String>,
    pub pinned: Option<bool>,
}

pub fn run_action<R: Runtime>(app: &AppHandle<R>, action: ShortcutAction) {
    match action {
        ShortcutAction::NewNote => new_note(app),
        ShortcutAction::ShowBoard => {
            if let Err(e) = crate::windows::toggle_board_window(app.clone()) {
                eprintln!("[shortcuts] 보드 창 토글 실패: {e}");
            }
        }
        ShortcutAction::ToggleAlwaysOnTop => toggle_always_on_top(app),
    }
}

/// 새 메모 — 메모를 만들고 창까지 띄운다.
pub fn new_note<R: Runtime>(app: &AppHandle<R>) {
    let db = app.state::<crate::db::Db>();
    match crate::windows::new_note_window(app.clone(), db, None) {
        Ok(id) => {
            if let Err(e) = crate::windows::open_note_window(app.clone(), id) {
                eprintln!("[shortcuts] 새 메모 창 열기 실패: {e}");
            }
        }
        Err(e) => {
            // TODO(M2): 트랙 A가 `new_note_window`를 채우면 이 경로에 도달하지 않는다.
            //           그때까지는 DB 없이 창만 띄워 `+` / 트레이 `새 메모`가 동작하게 한다.
            eprintln!("[shortcuts] new_note_window 미구현 → 임시 id로 창만 연다: {e}");
            let id = uuid::Uuid::now_v7().to_string();
            if let Err(e) = crate::windows::ensure_note_window(app, &id) {
                eprintln!("[shortcuts] 임시 메모 창 생성 실패: {e}");
            }
        }
    }
}

/// 항상 위 전환 — 열린 모든 메모 창에 적용하고 프론트에 알린다.
pub fn toggle_always_on_top<R: Runtime>(app: &AppHandle<R>) {
    let next = !ALWAYS_ON_TOP.load(Ordering::Relaxed);
    ALWAYS_ON_TOP.store(next, Ordering::Relaxed);

    for (label, window) in app.webview_windows() {
        if crate::windows::note_id_from_label(&label).is_some() {
            if let Err(e) = window.set_always_on_top(next) {
                eprintln!("[shortcuts] {label} always-on-top 설정 실패: {e}");
            }
        }
    }

    let payload = MetaChanged {
        id: None,
        pinned: Some(next),
    };
    if let Err(e) = app.emit(crate::windows::EVENT_NOTE_META_CHANGED, payload) {
        eprintln!("[shortcuts] note-meta-changed 전파 실패: {e}");
    }
}

// ─────────────────────────────────────────────────────────────
// 등록
// ─────────────────────────────────────────────────────────────

/// 하나를 등록하고 결과를 `binding`에 기록한다. **실패해도 앱을 죽이지 않는다.**
fn register_one<R: Runtime>(app: &AppHandle<R>, binding: &mut ShortcutBinding) {
    let parsed: Shortcut = match binding.accelerator.parse() {
        Ok(s) => s,
        Err(e) => {
            binding.registered = false;
            binding.error = Some(format!(
                "'{}' 형식을 해석할 수 없습니다: {e}",
                binding.accelerator
            ));
            eprintln!("[shortcuts] {}", binding.error.as_deref().unwrap_or(""));
            return;
        }
    };

    let action = binding.action;
    let result = app
        .global_shortcut()
        .on_shortcut(parsed, move |handle, _shortcut, event| {
            // 누를 때 한 번만. 떼는 이벤트까지 받으면 두 번 실행된다.
            if event.state() == PressState::Pressed {
                run_action(handle, action);
            }
        });

    match result {
        Ok(()) => {
            binding.registered = true;
            binding.error = None;
        }
        Err(e) => {
            binding.registered = false;
            binding.error = Some(format!(
                "'{}' 등록에 실패했습니다. 다른 앱이 사용 중일 수 있습니다: {e}",
                binding.accelerator
            ));
            eprintln!("[shortcuts] {}", binding.error.as_deref().unwrap_or(""));
        }
    }
}

fn unregister_one<R: Runtime>(app: &AppHandle<R>, accelerator: &str) {
    if let Ok(parsed) = accelerator.parse::<Shortcut>() {
        if let Err(e) = app.global_shortcut().unregister(parsed) {
            eprintln!("[shortcuts] '{accelerator}' 해제 실패: {e}");
        }
    }
}

/// 앱 setup에서 1회 호출.
///
/// 저장된 바인딩을 읽어 오지는 못한다 — `db::get_settings`가 돌려주는 `Settings`에
/// 단축키 필드가 없고, 임의 키를 읽는 커맨드도 계약에 없다. **계약 부족 사항으로 보고했다.**
/// 그때까지는 기본값 3개를 등록한다.
pub fn init<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let mut bindings = defaults();
    for binding in bindings.iter_mut() {
        register_one(&handle, binding);
    }

    let failed = bindings.iter().filter(|b| !b.registered).count();
    if failed > 0 {
        eprintln!("[shortcuts] {failed}개 단축키 등록 실패 — 메모 창 배너로 노출된다");
    }

    let state = app.state::<ShortcutState>();
    *state.0.lock().unwrap() = bindings;
    Ok(())
}

// ─────────────────────────────────────────────────────────────
// 커맨드
// ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_shortcuts(state: tauri::State<'_, ShortcutState>) -> CmdResult<Vec<ShortcutBinding>> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

/// 재바인딩. 기존 것을 해제하고 새로 등록한 결과를 돌려준다.
///
/// 등록에 실패해도 `Err`가 아니라 `registered: false` + `error`를 담은 바인딩을 돌려준다.
/// 설정 창이 사유를 그대로 보여줄 수 있어야 하기 때문이다.
#[tauri::command]
pub fn set_shortcut<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, ShortcutState>,
    action: ShortcutAction,
    accelerator: String,
) -> CmdResult<ShortcutBinding> {
    let accelerator = accelerator.trim().to_string();
    if accelerator.is_empty() {
        return Err("단축키가 비어 있습니다".into());
    }

    let previous = {
        let bindings = state.0.lock().map_err(|e| e.to_string())?;
        bindings
            .iter()
            .find(|b| b.action == action)
            .map(|b| (b.accelerator.clone(), b.registered))
    };

    // 다른 동작이 이미 쓰고 있는 조합인가
    {
        let bindings = state.0.lock().map_err(|e| e.to_string())?;
        if bindings
            .iter()
            .any(|b| b.action != action && b.accelerator.eq_ignore_ascii_case(&accelerator))
        {
            return Err(format!("'{accelerator}'는 다른 동작이 이미 사용 중입니다"));
        }
    }

    if let Some((old, registered)) = previous {
        if registered {
            unregister_one(&app, &old);
        }
    }

    let mut binding = ShortcutBinding::new(action, &accelerator);
    register_one(&app, &mut binding);

    {
        let mut bindings = state.0.lock().map_err(|e| e.to_string())?;
        match bindings.iter_mut().find(|b| b.action == action) {
            Some(slot) => *slot = binding.clone(),
            None => bindings.push(binding.clone()),
        }
    }

    // 영속화 — 트랙 A가 `set_setting`을 채우면 자동으로 저장된다.
    // TODO(M6): 읽기 경로(`get_settings`에 단축키 필드 또는 임의 키 조회)가 계약에 없다.
    let db = app.state::<crate::db::Db>();
    if let Err(e) = crate::db::set_setting(db, setting_key(action).to_string(), accelerator) {
        eprintln!("[shortcuts] 단축키 저장 실패(무시): {e}");
    }

    Ok(binding)
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
