//! 마크다운 내보내기 · DB 백업 · 경로 열기.
//!
//! v1에서 옵시디언으로 이어지는 **유일한 다리**다 (`CLAUDE.md` 절대규칙 5).
//! 본문을 마크다운 원문 그대로 저장하는 이유가 여기에 있다.
//!
//! **소유: 트랙 A (M6).**

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::db::Db;
use crate::CmdResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// 실제로 쓴 파일 수
    pub count: usize,
    /// 대상 폴더
    pub dir: String,
    /// 건너뛴 메모 (id, 사유)
    #[serde(default)]
    pub skipped: Vec<String>,
}

/// 폴더를 골라 메모마다 `.md` 파일을 쓴다.
///
/// `date_prefix`가 참이면 파일명이 `2026-07-26 스프린트24.md` 형태가 된다
/// (설정 DATA 섹션의 "파일명에 생성일 프리픽스" 토글).
#[tauri::command]
// TODO(M6): 트랙 A
pub fn export_markdown<R: Runtime>(
    _app: AppHandle<R>,
    _db: tauri::State<'_, Db>,
    dir: String,
    date_prefix: bool,
) -> CmdResult<ExportResult> {
    let _ = (dir, date_prefix);
    Err("미구현: export_markdown (M6 · 트랙 A)".into())
}

/// `sticky-notes.db`를 타임스탬프 붙여 복사한다. 반환값은 만들어진 파일 경로.
#[tauri::command]
// TODO(M6): 트랙 A
pub fn backup_db<R: Runtime>(_app: AppHandle<R>, dir: Option<String>) -> CmdResult<String> {
    let _ = dir;
    Err("미구현: backup_db (M6 · 트랙 A)".into())
}

/// 설정 DATA 섹션에 표시할 DB 경로.
#[tauri::command]
pub fn get_db_path<R: Runtime>(app: AppHandle<R>) -> CmdResult<String> {
    crate::db::db_path(&app).map(|p| p.to_string_lossy().into_owned())
}

/// 탐색기에서 경로를 연다 (파일이면 폴더를 열고 선택).
#[tauri::command]
pub fn reveal_path<R: Runtime>(app: AppHandle<R>, path: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let p = std::path::PathBuf::from(&path);
    let target = if p.is_file() {
        p.parent().map(|d| d.to_path_buf()).unwrap_or(p)
    } else {
        p
    };
    app.opener()
        .open_path(target.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("경로를 열 수 없습니다: {e}"))
}
