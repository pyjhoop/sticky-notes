//! 창 수명 관리 + 지오메트리 저장/복원.
//!
//! 창 설정의 **진실의 원천은 `tauri.conf.json`의 `app.windows`** 다.
//! 세 항목 모두 `"create": false` 로 두고, 여기서 템플릿으로 읽어 런타임에 만든다.
//! (닫은 창은 hide가 아니라 destroy — `CLAUDE.md` "흔한 함정" 참조)
//!
//! **소유: 트랙 A(지오메트리) / 트랙 C(트레이 연동).**

use serde::{Deserialize, Serialize};
use tauri::utils::config::{WebviewUrl, WindowConfig};
use tauri::{AppHandle, Manager, Runtime, WebviewWindowBuilder};

use crate::db::Db;
use crate::CmdResult;

/// `tauri.conf.json` 의 템플릿 label
pub const NOTE_TEMPLATE: &str = "note";
pub const BOARD_LABEL: &str = "board";
pub const SETTINGS_LABEL: &str = "settings";

/// 메모 창 = 종이 + 사방 24px 투명 여백.
/// 여백을 줄이면 `drop-shadow(0 26px 44px …)`가 잘린다.
pub const NOTE_PADDING: f64 = 24.0;

/// 모든 메모 창에 브로드캐스트하는 이벤트 — 트레이 "모든 메모 저장"
pub const EVENT_SAVE_ALL: &str = "sticky://save-all";
/// 지오메트리 복원이 끝났음을 알리는 이벤트
pub const EVENT_NOTE_META_CHANGED: &str = "sticky://note-meta-changed";

pub fn note_label(id: &str) -> String {
    format!("note-{id}")
}

/// label에서 메모 id를 되돌린다. 메모 창이 아니면 `None`.
pub fn note_id_from_label(label: &str) -> Option<&str> {
    label.strip_prefix("note-")
}

/// `tauri.conf.json` 에서 label로 창 설정을 복제해 온다.
fn template<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<WindowConfig, String> {
    app.config()
        .app
        .windows
        .iter()
        .find(|w| w.label == label)
        .cloned()
        .ok_or_else(|| format!("tauri.conf.json에 '{label}' 창 설정이 없습니다"))
}

// ─────────────────────────────────────────────────────────────
// 메모 창
// ─────────────────────────────────────────────────────────────

/// 메모 창을 만든다. 이미 있으면 포커스만 준다.
pub fn ensure_note_window<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<tauri::WebviewWindow<R>, String> {
    let label = note_label(id);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(w);
    }

    let mut cfg = template(app, NOTE_TEMPLATE)?;
    cfg.label = label;
    cfg.create = true;
    cfg.visible = true;
    cfg.url = WebviewUrl::App(format!("index.html?w=note&id={id}").into());

    let window = WebviewWindowBuilder::from_config(app, &cfg)
        .map_err(|e| format!("메모 창 빌더 생성 실패: {e}"))?
        .build()
        .map_err(|e| format!("메모 창 생성 실패: {e}"))?;

    // 스파이크 2 — DWM 라운드 코너를 끄고 CSS border-radius로 그린다.
    // 이걸 빼면 10px 라운드 바깥에 검은 테두리가 남는다.
    crate::win::disable_dwm_rounding(&window);

    // TODO(M2): 트랙 A — load_note_geometry로 위치 복원 + work area 클램프
    Ok(window)
}

#[tauri::command]
pub fn open_note_window<R: Runtime>(app: AppHandle<R>, id: String) -> CmdResult<()> {
    ensure_note_window(&app, &id).map(|_| ())
}

/// 메모를 새로 만들고 창까지 띄운다 (`+` 버튼 · `Ctrl+Alt+N`).
#[tauri::command]
// TODO(M2): 트랙 A — create_note 결과의 id로 창을 연다
pub fn new_note_window<R: Runtime>(
    _app: AppHandle<R>,
    _db: tauri::State<'_, Db>,
    color: Option<u8>,
) -> CmdResult<String> {
    let _ = color;
    Err("미구현: new_note_window (M2 · 트랙 A)".into())
}

#[tauri::command]
pub fn focus_note_window<R: Runtime>(app: AppHandle<R>, id: String) -> CmdResult<()> {
    match app.get_webview_window(&note_label(&id)) {
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.show();
            w.set_focus().map_err(|e| e.to_string())
        }
        None => ensure_note_window(&app, &id).map(|_| ()),
    }
}

/// `✕` — 창 destroy + `notes.open = 0`. 메모 자체는 DB에 남는다.
#[tauri::command]
pub fn close_note_window<R: Runtime>(app: AppHandle<R>, id: String) -> CmdResult<()> {
    if let Some(w) = app.get_webview_window(&note_label(&id)) {
        w.destroy().map_err(|e| e.to_string())?;
    }
    // TODO(M2): 트랙 A — notes.open = 0 갱신
    Ok(())
}

#[tauri::command]
pub fn list_open_notes<R: Runtime>(app: AppHandle<R>) -> CmdResult<Vec<String>> {
    Ok(app
        .webview_windows()
        .keys()
        .filter_map(|l| note_id_from_label(l).map(str::to_owned))
        .collect())
}

/// 앱 시작 시 `notes.open = 1` 인 메모들의 창을 되살린다.
#[tauri::command]
// TODO(M2): 트랙 A — DB 조회 후 ensure_note_window 반복
pub fn restore_open_notes<R: Runtime>(
    _app: AppHandle<R>,
    _db: tauri::State<'_, Db>,
) -> CmdResult<Vec<String>> {
    Err("미구현: restore_open_notes (M2 · 트랙 A)".into())
}

/// 핀 토글 — always-on-top.
#[tauri::command]
pub fn set_note_always_on_top<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    pinned: bool,
) -> CmdResult<()> {
    if let Some(w) = app.get_webview_window(&note_label(&id)) {
        w.set_always_on_top(pinned).map_err(|e| e.to_string())?;
    }
    // TODO(M2): 트랙 A — notes.pinned 갱신
    Ok(())
}

/// 트레이 "모든 메모 저장" — 열린 메모 창에 flush를 요청한다.
#[tauri::command]
pub fn request_save_all<R: Runtime>(app: AppHandle<R>) -> CmdResult<()> {
    use tauri::Emitter;
    app.emit(EVENT_SAVE_ALL, ()).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────
// 보드 · 설정 창 (싱글턴, 닫으면 destroy)
// ─────────────────────────────────────────────────────────────

fn ensure_singleton<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    query: &str,
) -> Result<tauri::WebviewWindow<R>, String> {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(w);
    }
    let mut cfg = template(app, label)?;
    cfg.create = true;
    cfg.visible = true;
    cfg.url = WebviewUrl::App(format!("index.html?w={query}").into());

    let window = WebviewWindowBuilder::from_config(app, &cfg)
        .map_err(|e| format!("{label} 창 빌더 생성 실패: {e}"))?
        .build()
        .map_err(|e| format!("{label} 창 생성 실패: {e}"))?;

    // 보드/설정은 다크 크롬 + mica. 실패하면 acrylic → 불투명 순으로 폴백한다.
    let _ = crate::win::apply_backdrop(&window);
    Ok(window)
}

fn toggle_singleton<R: Runtime>(app: &AppHandle<R>, label: &str, query: &str) -> CmdResult<bool> {
    if let Some(w) = app.get_webview_window(label) {
        w.destroy().map_err(|e| e.to_string())?;
        return Ok(false);
    }
    ensure_singleton(app, label, query)?;
    Ok(true)
}

#[tauri::command]
pub fn show_board_window<R: Runtime>(app: AppHandle<R>) -> CmdResult<()> {
    ensure_singleton(&app, BOARD_LABEL, "board").map(|_| ())
}

/// 트레이 좌클릭 — 보드 토글. 반환값은 "지금 열려 있는가".
#[tauri::command]
pub fn toggle_board_window<R: Runtime>(app: AppHandle<R>) -> CmdResult<bool> {
    toggle_singleton(&app, BOARD_LABEL, "board")
}

#[tauri::command]
pub fn show_settings_window<R: Runtime>(app: AppHandle<R>) -> CmdResult<()> {
    ensure_singleton(&app, SETTINGS_LABEL, "settings").map(|_| ())
}

#[tauri::command]
pub fn toggle_settings_window<R: Runtime>(app: AppHandle<R>) -> CmdResult<bool> {
    toggle_singleton(&app, SETTINGS_LABEL, "settings")
}

// ─────────────────────────────────────────────────────────────
// 지오메트리 — DPI 상대 좌표
// ─────────────────────────────────────────────────────────────

/// `note_geometry` 한 행. 좌표는 **모니터 work-area 원점 기준 논리 px**.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    /// `WorkArea.name` — 모니터 디바이스명
    pub monitor: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// 저장 시점의 scale_factor
    pub scale: f64,
}

#[tauri::command]
// TODO(M2): 트랙 A
pub fn save_note_geometry(
    _db: tauri::State<'_, Db>,
    note_id: String,
    geometry: Geometry,
) -> CmdResult<()> {
    let _ = (note_id, geometry);
    Err("미구현: save_note_geometry (M2 · 트랙 A)".into())
}

#[tauri::command]
// TODO(M2): 트랙 A
pub fn load_note_geometry(
    _db: tauri::State<'_, Db>,
    note_id: String,
) -> CmdResult<Option<Geometry>> {
    let _ = note_id;
    Err("미구현: load_note_geometry (M2 · 트랙 A)".into())
}

// ─────────────────────────────────────────────────────────────
// 부트스트랩
// ─────────────────────────────────────────────────────────────

/// 중복 실행 감지 시 기존 인스턴스를 깨운다.
pub fn wake_existing_instance<R: Runtime>(app: &AppHandle<R>) {
    let _ = ensure_singleton(app, BOARD_LABEL, "board");
}

/// 앱 setup에서 1회.
///
/// M0에서는 **스파이크 확인 + DoD("빈 창 3종이 뜬다")** 를 위해 세 창을 모두 띄운다.
// TODO(M2/M4): 시작 시 창 생성은 `restore_open_notes` + 트레이 토글로 대체한다.
//              (보드·설정은 트레이/단축키로만 열린다)
pub fn bootstrap<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    if let Err(e) = ensure_note_window(&handle, "spike") {
        eprintln!("[m0] 메모 창 생성 실패: {e}");
    }
    if let Err(e) = ensure_singleton(&handle, BOARD_LABEL, "board") {
        eprintln!("[m0] 보드 창 생성 실패: {e}");
    }
    if let Err(e) = ensure_singleton(&handle, SETTINGS_LABEL, "settings") {
        eprintln!("[m0] 설정 창 생성 실패: {e}");
    }
    Ok(())
}
