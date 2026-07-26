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
//! **소유: 트랙 C (M4).**

use tauri::Runtime;

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

/// 앱 setup에서 1회 호출.
// TODO(M4): 트랙 C — TrayIconBuilder + 메뉴 + 좌클릭 보드 토글
pub fn init<R: Runtime>(_app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
