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
use crate::win::WorkArea;
use crate::CmdResult;

/// `tauri.conf.json` 의 템플릿 label
pub const NOTE_TEMPLATE: &str = "note";
pub const BOARD_LABEL: &str = "board";
pub const SETTINGS_LABEL: &str = "settings";

/// 메모 창 = 종이 + 사방 24px 투명 여백.
/// 여백을 줄이면 `drop-shadow(0 26px 44px …)`가 잘린다.
pub const NOTE_PADDING: f64 = 24.0;

/// 복원 시 화면 안에 반드시 남겨둘 길이(논리 px).
/// **컨트롤 바 80px** + 창 가장자리의 투명 여백.
pub const MIN_VISIBLE: f64 = NOTE_PADDING + 80.0;

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
    // 저장된 위치로 옮긴 뒤에 보여준다 — 기본 위치에서 튀는 것을 막는다
    cfg.visible = false;
    cfg.url = WebviewUrl::App(format!("index.html?w=note&id={id}").into());

    let window = WebviewWindowBuilder::from_config(app, &cfg)
        .map_err(|e| format!("메모 창 빌더 생성 실패: {e}"))?
        .build()
        .map_err(|e| format!("메모 창 생성 실패: {e}"))?;

    // 스파이크 2 — DWM 라운드 코너를 끄고 CSS border-radius로 그린다.
    // 이걸 빼면 10px 라운드 바깥에 검은 테두리가 남는다.
    crate::win::disable_dwm_rounding(&window);

    restore_geometry(app, &window, id);

    let _ = window.show();
    Ok(window)
}

/// 저장된 지오메트리를 현재 모니터 구성에 맞춰 되돌린다.
/// 실패해도 창 생성 자체는 막지 않는다 (기본 위치로 뜬다).
fn restore_geometry<R: Runtime>(app: &AppHandle<R>, window: &tauri::WebviewWindow<R>, id: &str) {
    let geo = match app.state::<Db>().with(|c| load_geometry_in(c, id)) {
        Ok(Some(g)) => g,
        Ok(None) => return,
        Err(e) => {
            eprintln!("[windows] 지오메트리 조회 실패: {e}");
            return;
        }
    };
    let areas = match crate::win::get_work_areas() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("[windows] 모니터 정보를 얻지 못해 위치 복원을 건너뜁니다: {e}");
            return;
        }
    };
    let (x, y, w, h) = to_physical(&areas, &geo);
    let _ = window.set_size(tauri::PhysicalSize::new(
        w.round().max(1.0) as u32,
        h.round().max(1.0) as u32,
    ));
    let _ = window.set_position(tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

#[tauri::command]
pub fn open_note_window<R: Runtime>(app: AppHandle<R>, id: String) -> CmdResult<()> {
    ensure_note_window(&app, &id).map(|_| ())
}

/// 메모를 새로 만들고 창까지 띄운다 (`+` 버튼 · `Ctrl+Alt+N`).
#[tauri::command]
pub fn new_note_window<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    color: Option<u8>,
) -> CmdResult<String> {
    let note = db.with(|c| crate::notes::create_note_in(c, color))?;
    ensure_note_window(&app, &note.id)?;
    Ok(note.id)
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
        // 닫히기 전에 마지막 위치를 남긴다 (프론트 디바운스가 놓친 이동 대비)
        if let Some(g) = capture_geometry(&w) {
            if let Err(e) = app.state::<Db>().with(|c| save_geometry_in(c, &id, &g)) {
                eprintln!("[windows] 지오메트리 저장 실패: {e}");
            }
        }
        w.destroy().map_err(|e| e.to_string())?;
    }
    app.state::<Db>()
        .with(|c| crate::notes::set_open_in(c, &id, false))
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
///
/// 되살릴 메모가 하나도 없으면 새 메모 1개를 만들어 띄운다 — 빈 데스크톱으로
/// 시작하면 트레이를 모르는 사용자가 앱을 찾지 못한다.
pub fn restore_open_notes_in<R: Runtime>(app: &AppHandle<R>) -> CmdResult<Vec<String>> {
    let state = app.state::<Db>();
    let mut ids: Vec<String> = state.with(|c| crate::notes::open_note_ids_in(c))?;
    if ids.is_empty() {
        let note = state.with(|c| crate::notes::create_note_in(c, None))?;
        ids.push(note.id);
    }
    let mut opened = Vec::with_capacity(ids.len());
    for id in ids {
        match ensure_note_window(app, &id) {
            Ok(_) => opened.push(id),
            Err(e) => eprintln!("[windows] 메모 창 복원 실패({id}): {e}"),
        }
    }
    Ok(opened)
}

#[tauri::command]
pub fn restore_open_notes<R: Runtime>(
    app: AppHandle<R>,
    _db: tauri::State<'_, Db>,
) -> CmdResult<Vec<String>> {
    restore_open_notes_in(&app)
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
    app.state::<Db>().with(|c| {
        crate::notes::set_note_meta_in(
            c,
            &id,
            &crate::notes::NoteMeta {
                pinned: Some(pinned),
                ..Default::default()
            },
        )
        .map(|_| ())
    })
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

/// 창을 가장 많이 품고 있는 모니터. 겹치는 게 없으면 주 모니터.
fn pick_monitor(areas: &[WorkArea], x: f64, y: f64, w: f64, h: f64) -> Option<&WorkArea> {
    let mut best: Option<(&WorkArea, f64)> = None;
    for a in areas {
        let ox = (x + w).min(a.x as f64 + a.width as f64) - x.max(a.x as f64);
        let oy = (y + h).min(a.y as f64 + a.height as f64) - y.max(a.y as f64);
        let overlap = ox.max(0.0) * oy.max(0.0);
        if overlap > 0.0 && best.map(|(_, b)| overlap > b).unwrap_or(true) {
            best = Some((a, overlap));
        }
    }
    best.map(|(a, _)| a)
        .or_else(|| areas.iter().find(|a| a.is_primary))
        .or_else(|| areas.first())
}

/// 물리 좌표 → **모니터 work 원점 기준 논리 오프셋**.
///
/// `outerPosition()`(물리) → 포함 모니터 탐색 → `(물리 − work 원점) / scale`.
pub fn to_relative(areas: &[WorkArea], x: f64, y: f64, w: f64, h: f64) -> Geometry {
    match pick_monitor(areas, x, y, w, h) {
        Some(a) => Geometry {
            monitor: a.name.clone(),
            x: (x - a.x as f64) / a.scale,
            y: (y - a.y as f64) / a.scale,
            w: w / a.scale,
            h: h / a.scale,
            scale: a.scale,
        },
        None => Geometry {
            monitor: String::new(),
            x,
            y,
            w,
            h,
            scale: 1.0,
        },
    }
}

/// 논리 오프셋 → 현재 모니터 구성의 물리 좌표.
///
/// 이름으로 모니터를 찾고, 없으면 주 모니터로 폴백한 뒤
/// **컨트롤 바가 화면 안에 남도록 클램프**한다.
pub fn to_physical(areas: &[WorkArea], g: &Geometry) -> (f64, f64, f64, f64) {
    let area = areas
        .iter()
        .find(|a| a.name == g.monitor)
        .or_else(|| areas.iter().find(|a| a.is_primary))
        .or_else(|| areas.first());

    let Some(a) = area else {
        return (g.x, g.y, g.w, g.h);
    };

    let w = g.w * a.scale;
    let h = g.h * a.scale;
    let x = a.x as f64 + g.x * a.scale;
    let y = a.y as f64 + g.y * a.scale;
    let (x, y) = crate::win::clamp_into(a, x, y, w, h, MIN_VISIBLE * a.scale);
    (x, y, w, h)
}

/// 지금 창의 위치·크기를 상대 좌표로 읽어 온다.
fn capture_geometry<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Option<Geometry> {
    let pos = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let areas = crate::win::get_work_areas().ok()?;
    Some(to_relative(
        &areas,
        pos.x as f64,
        pos.y as f64,
        size.width as f64,
        size.height as f64,
    ))
}

pub fn save_geometry_in(
    conn: &rusqlite::Connection,
    note_id: &str,
    g: &Geometry,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO note_geometry(note_id, monitor, x, y, w, h, scale)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(note_id) DO UPDATE SET
           monitor = excluded.monitor, x = excluded.x, y = excluded.y,
           w = excluded.w, h = excluded.h, scale = excluded.scale",
        rusqlite::params![note_id, g.monitor, g.x, g.y, g.w, g.h, g.scale],
    )
    .map_err(|e| format!("지오메트리 저장 실패: {e}"))?;
    Ok(())
}

pub fn load_geometry_in(
    conn: &rusqlite::Connection,
    note_id: &str,
) -> Result<Option<Geometry>, String> {
    let r = conn.query_row(
        "SELECT monitor, x, y, w, h, scale FROM note_geometry WHERE note_id = ?1",
        rusqlite::params![note_id],
        |r| {
            Ok(Geometry {
                monitor: r.get(0)?,
                x: r.get(1)?,
                y: r.get(2)?,
                w: r.get(3)?,
                h: r.get(4)?,
                scale: r.get(5)?,
            })
        },
    );
    match r {
        Ok(g) => Ok(Some(g)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("지오메트리 조회 실패: {e}")),
    }
}

#[tauri::command]
pub fn save_note_geometry(
    db: tauri::State<'_, Db>,
    note_id: String,
    geometry: Geometry,
) -> CmdResult<()> {
    db.with(|c| save_geometry_in(c, &note_id, &geometry))
}

#[tauri::command]
pub fn load_note_geometry(
    db: tauri::State<'_, Db>,
    note_id: String,
) -> CmdResult<Option<Geometry>> {
    db.with(|c| load_geometry_in(c, &note_id))
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
/// **시작 시엔 `notes.open = 1` 인 메모 창만 되살린다.**
/// 보드/설정은 트레이·단축키로만 열린다 (M4 · 트랙 C).
pub fn bootstrap<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let opened = match restore_open_notes_in(&handle) {
        Ok(ids) => ids.len(),
        Err(e) => {
            eprintln!("[windows] 메모 창 복원 실패: {e}");
            0
        }
    };

    // 단축키 경고는 메모 창 배너로 뜬다. 그 창이 하나도 없으면 볼 곳이 없으므로
    // 설정 창을 열어 준다 — 거기에 실패 목록 배너와 재바인딩 UI가 같이 있다.
    // (트레이 툴팁에도 남지만 마우스를 올려야 보인다)
    if opened == 0 && crate::shortcuts::has_attention(&handle) {
        eprintln!("[windows] 메모 창이 없어 단축키 경고를 설정 창으로 노출합니다");
        if let Err(e) = show_settings_window(handle.clone()) {
            eprintln!("[windows] 설정 창 열기 실패: {e}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;
    use crate::notes::create_note_in;

    fn areas() -> Vec<WorkArea> {
        vec![
            WorkArea {
                name: r"\\.\DISPLAY1".into(),
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
                scale: 1.0,
                is_primary: true,
            },
            // 오른쪽에 붙은 150% 보조 모니터
            WorkArea {
                name: r"\\.\DISPLAY2".into(),
                x: 1920,
                y: 0,
                width: 2560,
                height: 1400,
                scale: 1.5,
                is_primary: false,
            },
        ]
    }

    /// DoD — 지오메트리 왕복: 물리 → 논리 → 물리가 원래 값으로 돌아온다
    #[test]
    fn geometry_round_trip_on_secondary_monitor() {
        let a = areas();
        let (px, py, pw, ph) = (1920.0 + 300.0, 200.0, 726.0, 702.0);

        let g = to_relative(&a, px, py, pw, ph);
        assert_eq!(g.monitor, r"\\.\DISPLAY2");
        assert_eq!(g.scale, 1.5);
        assert_eq!((g.x, g.y), (200.0, 133.33333333333334));
        assert_eq!((g.w, g.h), (484.0, 468.0)); // 논리 px = 디자인 창 크기

        let (x, y, w, h) = to_physical(&a, &g);
        assert_eq!((x, y, w, h), (px, py, pw, ph));
    }

    #[test]
    fn geometry_round_trip_on_primary_monitor() {
        let a = areas();
        let (px, py, pw, ph) = (120.0, 64.0, 484.0, 468.0);
        let g = to_relative(&a, px, py, pw, ph);
        assert_eq!(g.monitor, r"\\.\DISPLAY1");
        assert_eq!((g.x, g.y), (120.0, 64.0));
        assert_eq!(to_physical(&a, &g), (px, py, pw, ph));
    }

    /// 보조 모니터가 사라지면 주 모니터로 폴백하고 화면 안으로 클램프한다
    #[test]
    fn geometry_falls_back_to_primary_when_monitor_gone() {
        let full = areas();
        let g = to_relative(&full, 1920.0 + 2000.0, 100.0, 726.0, 702.0);
        assert_eq!(g.monitor, r"\\.\DISPLAY2");

        let only_primary = vec![full[0].clone()];
        let (x, y, w, h) = to_physical(&only_primary, &g);
        assert_eq!((w, h), (484.0, 468.0)); // scale 1.0로 다시 계산된다
        assert!(x + w >= MIN_VISIBLE, "왼쪽으로 완전히 사라지면 안 된다");
        assert!(x <= 1920.0 - MIN_VISIBLE, "오른쪽 화면 밖에 갇히면 안 된다");
        assert!((0.0..=1040.0).contains(&y));
    }

    #[test]
    fn pick_monitor_uses_largest_overlap() {
        let a = areas();
        // 경계에 걸친 창 — 오른쪽에 더 많이 걸쳐 있다
        let m = pick_monitor(&a, 1800.0, 0.0, 400.0, 400.0).unwrap();
        assert_eq!(m.name, r"\\.\DISPLAY2");
        // 어디에도 안 걸치면 주 모니터
        let m = pick_monitor(&a, -9000.0, -9000.0, 100.0, 100.0).unwrap();
        assert!(m.is_primary);
    }

    /// DB 왕복 — 저장한 값이 그대로 돌아오고, upsert가 행을 늘리지 않는다
    #[test]
    fn geometry_db_round_trip() {
        let conn = open_memory().unwrap();
        let note = create_note_in(&conn, None).unwrap();
        assert!(load_geometry_in(&conn, &note.id).unwrap().is_none());

        let g = Geometry {
            monitor: r"\\.\DISPLAY2".into(),
            x: 200.0,
            y: 133.5,
            w: 484.0,
            h: 468.0,
            scale: 1.5,
        };
        save_geometry_in(&conn, &note.id, &g).unwrap();
        assert_eq!(load_geometry_in(&conn, &note.id).unwrap().unwrap(), g);

        let g2 = Geometry {
            x: 10.0,
            ..g.clone()
        };
        save_geometry_in(&conn, &note.id, &g2).unwrap();
        assert_eq!(load_geometry_in(&conn, &note.id).unwrap().unwrap(), g2);

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_geometry", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    /// 메모가 지워지면 지오메트리도 따라 지워진다 (ON DELETE CASCADE)
    #[test]
    fn geometry_is_cascaded_on_hard_delete() {
        let conn = open_memory().unwrap();
        let note = create_note_in(&conn, None).unwrap();
        save_geometry_in(
            &conn,
            &note.id,
            &Geometry {
                monitor: "m".into(),
                x: 0.0,
                y: 0.0,
                w: 1.0,
                h: 1.0,
                scale: 1.0,
            },
        )
        .unwrap();
        conn.execute("DELETE FROM notes WHERE id = ?1", [&note.id])
            .unwrap();
        assert!(load_geometry_in(&conn, &note.id).unwrap().is_none());
    }

    #[test]
    fn label_round_trip() {
        assert_eq!(note_label("abc"), "note-abc");
        assert_eq!(note_id_from_label("note-abc"), Some("abc"));
        assert_eq!(note_id_from_label("board"), None);
    }
}
