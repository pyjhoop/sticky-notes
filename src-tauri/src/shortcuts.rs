//! 전역 단축키 3개 + 재바인딩 + 자동 시작.
//!
//! **등록 실패는 반드시 사용자에게 노출한다** (`CLAUDE.md` "흔한 함정").
//! `Ctrl+Alt+N`은 타 앱과 흔히 충돌하고, 조용한 무동작은 디버깅이 불가능하다.
//! 실패는 `ShortcutState`에 남고 `get_shortcut_failures`로 프론트가 읽어 배너로 띄운다
//! (`src/windows/NoteWindow.tsx`의 `.note-alert`).
//!
//! 트레이 메뉴와 단축키가 **같은 동작 함수**(`run_action`)를 공유한다.
//!
//! ## 영속화
//!
//! 재바인딩은 `settings` 테이블에 저장되고(`setting_key`), 다음 실행의 `init`이
//! `db::load_settings`로 읽어 **저장된 값을 먼저** 등록한다. 등록에 실패하면
//! 기본값으로 되돌리고 그 사실을 `error`에 남겨 `get_shortcut_failures`가 함께 돌려준다.
//!
//! 통합 게이트 전에는 쓰기만 있고 읽는 경로가 없어서 재시작하면 재바인딩이 사라졌다.
//! 게다가 key가 `shortcut.newNote`(점)라 `put_setting`이 거부해 **저장조차 되지 않았다.**
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
    ACTIONS
        .iter()
        .map(|&a| ShortcutBinding::new(a, default_accelerator(a)))
        .collect()
}

/// 동작의 기본 가속기.
pub fn default_accelerator(action: ShortcutAction) -> &'static str {
    match action {
        ShortcutAction::NewNote => DEFAULT_NEW_NOTE,
        ShortcutAction::ShowBoard => DEFAULT_SHOW_BOARD,
        ShortcutAction::ToggleAlwaysOnTop => DEFAULT_TOGGLE_TOP,
    }
}

/// `settings` 테이블에 쓸 키 이름.
///
/// **`db::SETTING_KEYS`·`src/lib/ipc.ts`의 `SHORTCUT_SETTING_KEY`와 글자까지 같아야 한다.**
/// 예전에는 `shortcut.newNote`처럼 점을 썼는데, `put_setting`이 알 수 없는 key라며
/// 저장을 거부해서 재바인딩이 **애초에 저장되지도 않았다.**
pub fn setting_key(action: ShortcutAction) -> &'static str {
    match action {
        ShortcutAction::NewNote => "shortcutNewNote",
        ShortcutAction::ShowBoard => "shortcutShowBoard",
        ShortcutAction::ToggleAlwaysOnTop => "shortcutToggleAlwaysOnTop",
    }
}

/// 저장된 설정에서 해당 동작의 가속기를 꺼낸다.
pub fn stored_accelerator(settings: &crate::db::Settings, action: ShortcutAction) -> &str {
    match action {
        ShortcutAction::NewNote => &settings.shortcut_new_note,
        ShortcutAction::ShowBoard => &settings.shortcut_show_board,
        ShortcutAction::ToggleAlwaysOnTop => &settings.shortcut_toggle_always_on_top,
    }
}

pub const ACTIONS: [ShortcutAction; 3] = [
    ShortcutAction::NewNote,
    ShortcutAction::ShowBoard,
    ShortcutAction::ToggleAlwaysOnTop,
];

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
///
/// `new_note_window`가 DB 생성 + 창 생성을 한 번에 한다. 실패는 DB 자체가
/// 열리지 않은 경우뿐이고, 그때는 띄울 창(=메시지를 보여줄 곳)도 없다.
pub fn new_note<R: Runtime>(app: &AppHandle<R>) {
    let db = app.state::<crate::db::Db>();
    if let Err(e) = crate::windows::new_note_window(app.clone(), db, None) {
        eprintln!("[shortcuts] 새 메모 생성 실패: {e}");
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

/// 저장된 가속기를 읽는다. DB를 못 읽으면 기본값으로 간다 (앱은 계속 뜬다).
fn stored_bindings<R: Runtime>(app: &AppHandle<R>) -> Vec<ShortcutBinding> {
    let settings = match app
        .state::<crate::db::Db>()
        .with(|c| crate::db::load_settings(c))
    {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[shortcuts] 저장된 단축키를 읽지 못해 기본값을 씁니다: {e}");
            return defaults();
        }
    };
    ACTIONS
        .iter()
        .map(|&a| ShortcutBinding::new(a, stored_accelerator(&settings, a)))
        .collect()
}

/// 하나를 등록하되, **저장된 값이 안 먹히면 기본값으로 되돌린다.**
///
/// 되돌렸다는 사실은 `error`에 남는다 — 등록에는 성공했으므로 `registered`는 참이지만
/// 사용자가 지정한 키가 아니므로 `get_shortcut_failures`가 함께 돌려준다.
/// 조용히 기본값으로 바뀌어 있으면 사용자는 영문을 모른다.
fn register_with_fallback<R: Runtime>(app: &AppHandle<R>, binding: &mut ShortcutBinding) {
    register_one(app, binding);
    if binding.registered {
        return;
    }
    let default = default_accelerator(binding.action);
    if binding.accelerator == default {
        return; // 기본값 자체가 실패했다 — 되돌릴 곳이 없다
    }

    let first = binding.error.clone().unwrap_or_default();
    let attempted = binding.accelerator.clone();
    let mut fallback = ShortcutBinding::new(binding.action, default);
    register_one(app, &mut fallback);

    fallback.error = Some(if fallback.registered {
        format!("저장된 단축키 '{attempted}'를 쓸 수 없어 기본값 '{default}'로 되돌렸습니다. {first}")
    } else {
        format!("저장된 단축키 '{attempted}'도 기본값 '{default}'도 등록하지 못했습니다. {first}")
    });
    *binding = fallback;
}

/// 앱 setup에서 1회 호출. **`db::init` 뒤에 불러야 한다** (저장된 값을 읽는다).
pub fn init<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let mut bindings = stored_bindings(&handle);
    for binding in bindings.iter_mut() {
        register_with_fallback(&handle, binding);
    }

    let attention = bindings.iter().filter(|b| needs_attention(b)).count();
    if attention > 0 {
        eprintln!("[shortcuts] 단축키 {attention}개 확인 필요 — 트레이 툴팁·메모 창 배너로 노출된다");
        // 메모 창이 하나도 없는 상태로 시작하면 배너를 볼 곳이 없다.
        // 트레이 툴팁은 창이 없어도 남는다.
        crate::tray::mark_shortcut_attention(&handle, attention);
    }

    let state = app.state::<ShortcutState>();
    *state.0.lock().map_err(|e| e.to_string())? = bindings;
    Ok(())
}

/// 사용자에게 알려야 하는 바인딩인가 — 등록 실패 또는 기본값 폴백.
fn needs_attention(b: &ShortcutBinding) -> bool {
    !b.registered || b.error.is_some()
}

/// 확인이 필요한 단축키가 있는가. 시작 시 노출 경로 결정에 쓴다 (`windows::bootstrap`).
pub fn has_attention<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(state) = app.try_state::<ShortcutState>() else {
        return false;
    };
    let Ok(bindings) = state.0.lock() else {
        return false;
    };
    bindings.iter().any(needs_attention)
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

    // 영속화 — `settings.shortcutNewNote` 등으로 저장되고, 다음 실행의
    // `init`이 `stored_bindings`로 그대로 읽어 등록한다.
    let db = app.state::<crate::db::Db>();
    if let Err(e) = crate::db::set_setting(db, setting_key(action).to_string(), accelerator) {
        // 저장에 실패하면 이번 실행에서만 동작하고 재시작 시 사라진다 — 사용자에게 알린다.
        eprintln!("[shortcuts] 단축키 저장 실패: {e}");
        let note = format!("단축키를 저장하지 못해 재시작하면 되돌아갑니다: {e}");
        binding.error = Some(match binding.error.take() {
            Some(prev) => format!("{prev} / {note}"),
            None => note,
        });
        let mut bindings = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(slot) = bindings.iter_mut().find(|b| b.action == action) {
            *slot = binding.clone();
        }
    }

    Ok(binding)
}

/// 사용자 확인이 필요한 단축키를 추린다. 배너로 노출하는 용도.
///
/// 두 가지가 섞여 온다:
/// - `registered: false` — 등록 자체가 실패했다 (그 단축키는 동작하지 않는다)
/// - `registered: true` + `error` — 저장된 값이 안 먹혀 **기본값으로 되돌렸다**
#[tauri::command]
pub fn get_shortcut_failures(
    state: tauri::State<'_, ShortcutState>,
) -> CmdResult<Vec<ShortcutBinding>> {
    Ok(state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .filter(|b| needs_attention(b))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{load_settings, open_memory, put_setting, Settings};

    /// 저장 → 재읽기 왕복. 이게 깨지면 재바인딩이 재시작 후 사라진다.
    #[test]
    fn shortcut_setting_round_trip() {
        let conn = open_memory().unwrap();

        // 저장된 값이 없으면 기본값이 나온다
        let fresh = load_settings(&conn).unwrap();
        for action in ACTIONS {
            assert_eq!(stored_accelerator(&fresh, action), default_accelerator(action));
        }

        // 재바인딩 저장 → 다시 읽으면 같은 값
        let rebound = [
            (ShortcutAction::NewNote, "Ctrl+Shift+F9"),
            (ShortcutAction::ShowBoard, "Ctrl+Shift+F10"),
            (ShortcutAction::ToggleAlwaysOnTop, "Ctrl+Shift+F11"),
        ];
        for (action, accel) in rebound {
            put_setting(&conn, setting_key(action), accel).unwrap();
        }
        let stored = load_settings(&conn).unwrap();
        for (action, accel) in rebound {
            assert_eq!(stored_accelerator(&stored, action), accel);
        }

        // 다시 써도 행이 늘지 않는다 (upsert)
        put_setting(&conn, setting_key(ShortcutAction::NewNote), "Ctrl+Alt+K").unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 3);
        assert_eq!(
            stored_accelerator(&load_settings(&conn).unwrap(), ShortcutAction::NewNote),
            "Ctrl+Alt+K"
        );
    }

    /// key 이름이 `db::SETTING_KEYS`(=`ipc.ts`의 `keyof Settings`)에 들어 있어야 한다.
    /// 예전 `shortcut.newNote`는 여기서 걸렸어야 했다.
    #[test]
    fn setting_keys_are_known_to_db() {
        for action in ACTIONS {
            let key = setting_key(action);
            assert!(
                crate::db::SETTING_KEYS.contains(&key),
                "{key}가 db::SETTING_KEYS에 없다"
            );
        }
    }

    #[test]
    fn empty_accelerator_is_rejected() {
        let conn = open_memory().unwrap();
        assert!(put_setting(&conn, setting_key(ShortcutAction::NewNote), "   ").is_err());
        assert_eq!(
            stored_accelerator(&load_settings(&conn).unwrap(), ShortcutAction::NewNote),
            DEFAULT_NEW_NOTE
        );
    }

    /// 폴백 판정 — 등록 실패든 기본값 복귀든 사용자에게 보여야 한다.
    #[test]
    fn attention_covers_failure_and_fallback() {
        let mut ok = ShortcutBinding::new(ShortcutAction::NewNote, DEFAULT_NEW_NOTE);
        ok.registered = true;
        assert!(!needs_attention(&ok));

        let mut failed = ok.clone();
        failed.registered = false;
        assert!(needs_attention(&failed));

        let mut fell_back = ok.clone();
        fell_back.error = Some("기본값으로 되돌렸습니다".into());
        assert!(needs_attention(&fell_back));
    }

    #[test]
    fn defaults_match_settings_defaults() {
        let s = Settings::default();
        for (b, action) in defaults().iter().zip(ACTIONS) {
            assert_eq!(b.accelerator, stored_accelerator(&s, action));
            assert!(!b.registered);
        }
    }
}
