//! # 계약 파일 — M0 동결
//!
//! 모듈 선언과 `invoke_handler` 커맨드 등록만 담당한다.
//! 커맨드 본체는 각 모듈에 있으며, 트랙 A/C가 채운다.
//!
//! **이 파일은 M0 종료와 동시에 동결된다.** 어떤 트랙도 임의로 수정하지 않는다.
//! 커맨드 추가/변경이 필요하면 작업을 멈추고 리더에게 보고한다.

pub mod attachments;
pub mod db;
pub mod export;
pub mod notes;
pub mod shortcuts;
pub mod tray;
pub mod update;
pub mod win;
pub mod windows;

/// 커맨드 결과 공통 타입. 프론트(`src/lib/ipc.ts`)는 실패를 문자열로 받는다.
pub type CmdResult<T> = std::result::Result<T, String>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 중복 실행 시 기존 인스턴스를 깨운다. (M4 · 트랙 C가 동작을 채운다)
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            crate::windows::wake_existing_instance(app);
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // 확인·다운로드·설치는 전부 `update.rs`(Rust)에서 돈다.
        // 웹뷰에 updater 권한을 열지 않으므로 CSP도 그대로 둘 수 있다.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(db::Db::default())
        .manage(shortcuts::ShortcutState::default())
        .manage(update::UpdateState::default())
        .setup(|app| {
            db::init(app)?;
            tray::init(app)?;
            shortcuts::init(app)?;
            windows::bootstrap(app)?;
            update::bootstrap(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ── notes.rs · 트랙 A (M2) ─────────────────────────────
            notes::create_note,
            notes::get_note,
            notes::list_notes,
            notes::save_note,
            notes::set_note_meta,
            notes::soft_delete_note,
            notes::search_notes,
            // ── db.rs · 설정 key/value · 트랙 A (M2) ───────────────
            db::get_settings,
            db::set_setting,
            // ── windows.rs · 창 수명 + 지오메트리 · 트랙 A/C ────────
            windows::open_note_window,
            windows::new_note_window,
            windows::focus_note_window,
            windows::close_note_window,
            windows::list_open_notes,
            windows::restore_open_notes,
            windows::set_note_always_on_top,
            windows::toggle_board_window,
            windows::show_board_window,
            windows::toggle_settings_window,
            windows::show_settings_window,
            windows::save_note_geometry,
            windows::load_note_geometry,
            windows::request_save_all,
            // ── win.rs · Win32 연동 · 트랙 A ───────────────────────
            win::get_work_areas,
            win::set_window_opacity,
            win::set_window_corner_preference,
            win::apply_window_backdrop,
            // ── export.rs · 내보내기/백업 · 트랙 A (M6) ─────────────
            export::export_markdown,
            export::backup_db,
            export::get_db_path,
            export::reveal_path,
            // ── attachments.rs · 이미지 첨부 · M7 ───────────────────
            attachments::save_attachment,
            attachments::get_attachments_dir,
            // ── shortcuts.rs · 전역 단축키 · 트랙 C (M4) ────────────
            shortcuts::get_shortcuts,
            shortcuts::set_shortcut,
            shortcuts::get_shortcut_failures,
            shortcuts::get_autostart,
            shortcuts::set_autostart,
            // ── update.rs · 자동 업데이트 ───────────────────────────
            update::get_app_version,
            update::check_update,
            update::install_update,
            update::get_pending_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            // 메모 창을 전부 ✕로 닫아도 앱은 살아 있어야 한다 — 상주형 트레이 앱이다.
            //
            // 2026-07-26 사용자 결함 신고 #2. Tauri 는 마지막 창이 사라지면
            // `ExitRequested` 를 올리고 기본 동작으로 프로세스를 끝낸다. 그래서 메모를
            // 전부 닫으면 트레이 아이콘까지 사라지고 앱을 다시 띄울 방법이 없었다.
            //
            // `code` 가 실린 종료(트레이 `종료` → `app.exit(0)`)만 그대로 통과시킨다.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
