//! 트레이 아이콘 + 메뉴 6항목.
//!
//! 디자인 `trayItems` 기준. 단, `지금 볼트와 동기화` → `모든 메모 저장`으로 재해석
//! (`plan.md` "디자인 대비 변경점").
//!
//! ```text
//! 새 메모              Ctrl+Alt+N
//! 모든 메모 보기        Ctrl+Alt+M
//! 항상 위 전환          Ctrl+Alt+T
//! 모든 메모 저장
//! 설정
//! 종료
//! ```
//!
//! 좌클릭 → 보드 토글. 메뉴 동작은 `shortcuts::run_action`을 단축키와 공유한다.
//!
//! **소유: 트랙 C (M4).**

use tauri::menu::{IsMenuItem, Menu, MenuEvent, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Runtime};

use crate::shortcuts::{run_action, ShortcutAction};

/// 메뉴 항목 id — 트랙 C가 이벤트 핸들러에서 매칭한다.
pub const ID_NEW_NOTE: &str = "tray_new_note";
pub const ID_SHOW_BOARD: &str = "tray_show_board";
pub const ID_TOGGLE_TOP: &str = "tray_toggle_top";
pub const ID_SAVE_ALL: &str = "tray_save_all";
pub const ID_SETTINGS: &str = "tray_settings";
pub const ID_QUIT: &str = "tray_quit";

/// UI 문자열은 한국어 (`CLAUDE.md` 절대규칙 6).
pub const LABELS: [(&str, &str, &str); 6] = [
    (ID_NEW_NOTE, "새 메모", "Ctrl+Alt+N"),
    (ID_SHOW_BOARD, "모든 메모 보기", "Ctrl+Alt+M"),
    (ID_TOGGLE_TOP, "항상 위 전환", "Ctrl+Alt+T"),
    (ID_SAVE_ALL, "모든 메모 저장", ""),
    (ID_SETTINGS, "설정", ""),
    (ID_QUIT, "종료", ""),
];

pub const TRAY_ID: &str = "sticky-notes-tray";
pub const TOOLTIP: &str = "스티커 메모";

/// `종료` — 저장 요청을 뿌리고 잠깐 기다린 뒤 끝낸다.
/// 프론트의 flush가 IPC를 왕복하므로 즉시 exit하면 마지막 편집이 날아간다.
const QUIT_GRACE_MS: u64 = 300;

/// 앱 setup에서 1회 호출.
pub fn init<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let items: Vec<MenuItem<R>> = LABELS
        .iter()
        .map(|(id, label, accel)| {
            let accelerator = if accel.is_empty() { None } else { Some(*accel) };
            MenuItem::with_id(app, *id, *label, true, accelerator)
        })
        .collect::<Result<_, _>>()?;

    let refs: Vec<&dyn IsMenuItem<R>> = items.iter().map(|i| i as &dyn IsMenuItem<R>).collect();
    let menu = Menu::with_items(app, &refs)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(TOOLTIP)
        .menu(&menu)
        // 좌클릭은 메뉴가 아니라 보드 토글이다.
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(on_tray_icon_event);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        ID_NEW_NOTE => run_action(app, ShortcutAction::NewNote),
        ID_SHOW_BOARD => run_action(app, ShortcutAction::ShowBoard),
        ID_TOGGLE_TOP => run_action(app, ShortcutAction::ToggleAlwaysOnTop),
        ID_SAVE_ALL => save_all(app),
        ID_SETTINGS => {
            if let Err(e) = crate::windows::show_settings_window(app.clone()) {
                eprintln!("[tray] 설정 창 열기 실패: {e}");
            }
        }
        ID_QUIT => quit(app),
        other => eprintln!("[tray] 알 수 없는 메뉴 항목: {other}"),
    }
}

/// 트레이 좌클릭(버튼을 뗄 때) → 보드 토글.
fn on_tray_icon_event<R: Runtime>(tray: &tauri::tray::TrayIcon<R>, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        if let Err(e) = crate::windows::toggle_board_window(tray.app_handle().clone()) {
            eprintln!("[tray] 보드 창 토글 실패: {e}");
        }
    }
}

/// `모든 메모 저장` — 열린 메모 창에 flush를 브로드캐스트한다.
fn save_all<R: Runtime>(app: &AppHandle<R>) {
    if let Err(e) = crate::windows::request_save_all(app.clone()) {
        eprintln!("[tray] 저장 요청 실패: {e}");
    }
}

fn quit<R: Runtime>(app: &AppHandle<R>) {
    save_all(app);
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(QUIT_GRACE_MS));
        handle.exit(0);
    });
}
