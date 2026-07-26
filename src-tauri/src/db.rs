//! SQLite 레이어 — 스키마 · 마이그레이션 · 설정 key/value.
//!
//! **소유: 트랙 A (M2).** M0에서는 커넥션 상태 + 스키마 상수 + 커맨드 시그니처만 둔다.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::CmdResult;

/// `tauri::State`로 관리하는 커넥션. 트랙 A가 `Some(Connection)`으로 채운다.
#[derive(Default)]
pub struct Db(pub Mutex<Option<rusqlite::Connection>>);

/// `plan.md` 데이터 모델 절의 스키마. 트랙 A가 마이그레이션 배열로 옮긴다.
pub const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  color       INTEGER NOT NULL DEFAULT 0,
  opacity     INTEGER NOT NULL DEFAULT 96,
  pinned      INTEGER NOT NULL DEFAULT 1,
  open        INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS note_geometry (
  note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  monitor TEXT NOT NULL,
  x REAL, y REAL,
  w REAL, h REAL,
  scale REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS tags  (note_id TEXT, tag    TEXT, PRIMARY KEY(note_id, tag));
CREATE TABLE IF NOT EXISTS links (note_id TEXT, target TEXT, PRIMARY KEY(note_id, target));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
"#;

/// `%APPDATA%\com.sticky-notes.app\sticky-notes.db`
pub fn db_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 경로를 찾을 수 없습니다: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("앱 데이터 폴더 생성 실패: {e}"))?;
    Ok(dir.join("sticky-notes.db"))
}

/// 첨부 폴더. M7에서 사용한다.
pub fn attachments_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 경로를 찾을 수 없습니다: {e}"))?
        .join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("첨부 폴더 생성 실패: {e}"))?;
    Ok(dir)
}

/// 앱 setup에서 1회 호출. M0에서는 아무것도 열지 않는다.
// TODO(M2): 트랙 A — 커넥션 열기 + PRAGMA user_version 마이그레이션
pub fn init<R: Runtime>(_app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

// ─────────────────────────────────────────────────────────────
// 설정 (settings 테이블)
// ─────────────────────────────────────────────────────────────

/// 악센트 색 — 디자인 `$props.accent` 의 4개 옵션 중 하나.
pub const ACCENT_OPTIONS: [&str; 4] = ["#0067C0", "#7a5cd6", "#3a8a4f", "#c05621"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// DISPLAY — 항상 다른 앱 위에 표시 (전역 기본값)
    pub always_on_top: bool,
    /// DISPLAY — 비활성 시 자동으로 흐려짐
    pub auto_fade: bool,
    /// DISPLAY — 기본 투명도 35..100
    pub default_opacity: u8,
    /// DISPLAY — 악센트 색 (`ACCENT_OPTIONS`)
    pub accent: String,
    /// DATA — 내보낸 파일명에 생성일 프리픽스 (`2026-07-26 스프린트24.md`)
    pub filename_date_prefix: bool,
    /// DATA — 마지막 내보내기 폴더
    pub export_dir: Option<String>,
    /// 시스템 시작 시 자동 실행
    pub autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            always_on_top: true,
            auto_fade: true,
            default_opacity: 96,
            accent: ACCENT_OPTIONS[0].to_string(),
            filename_date_prefix: false,
            export_dir: None,
            autostart: false,
        }
    }
}

#[tauri::command]
// TODO(M2): 트랙 A — settings 테이블에서 읽어 병합
pub fn get_settings(_db: tauri::State<'_, Db>) -> CmdResult<Settings> {
    Err("미구현: get_settings (M2 · 트랙 A)".into())
}

#[tauri::command]
// TODO(M2): 트랙 A — settings 테이블 upsert
pub fn set_setting(_db: tauri::State<'_, Db>, key: String, value: String) -> CmdResult<()> {
    let _ = (key, value);
    Err("미구현: set_setting (M2 · 트랙 A)".into())
}
