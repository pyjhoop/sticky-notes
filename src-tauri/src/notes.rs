//! 메모 CRUD 커맨드.
//!
//! **소유: 트랙 A (M2).** M0에서는 타입과 시그니처만 확정한다.
//! 타입은 `src/lib/ipc.ts`와 1:1로 대응해야 한다 (serde camelCase).

use serde::{Deserialize, Serialize};

use crate::db::Db;
use crate::CmdResult;

/// 팔레트 인덱스 0..4 (`src/lib/palette.ts` 순서와 동일)
pub type ColorIndex = u8;

pub const OPACITY_MIN: u8 = 35;
pub const OPACITY_MAX: u8 = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// body에서 파생 — 보드용 비정규화
    pub title: String,
    /// 원본 마크다운. 절대 가공하지 않는다
    pub body: String,
    pub color: ColorIndex,
    /// 35..100
    pub opacity: u8,
    pub pinned: bool,
    /// 데스크톱에 창이 떠 있는가
    pub open: bool,
    /// RFC3339
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

/// 보드 카드용 축약 뷰 (body는 미리보기 길이로 잘린다).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub color: ColorIndex,
    pub open: bool,
    pub pinned: bool,
    pub updated_at: String,
    pub tags: Vec<String>,
}

/// 부분 갱신용. `None`인 필드는 건드리지 않는다.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub color: Option<ColorIndex>,
    pub opacity: Option<u8>,
    pub pinned: Option<bool>,
    pub open: Option<bool>,
}

/// `save_note`의 반환값. 푸터의 `저장됨 · HH:mm` 표시에 쓰인다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub id: String,
    /// 본문에서 새로 파생된 제목
    pub title: String,
    pub updated_at: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
}

/// 디자인 검색창의 `검색 · 태그 · [[백링크]]` 3모드.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchMode {
    /// title/body LIKE '%q%'
    Text,
    /// `#태그` → tags 조인
    Tag,
    /// `[[제목]]` → links 조인 (백링크)
    Backlink,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub mode: SearchMode,
    /// 접두사(`#`, `[[ ]]`)를 제거한 검색어
    pub term: String,
    /// 색상 필터 칩. 비어 있으면 전체
    #[serde(default)]
    pub colors: Vec<ColorIndex>,
}

// ─────────────────────────────────────────────────────────────
// 커맨드 — 전부 트랙 A(M2)가 채운다
// ─────────────────────────────────────────────────────────────

#[tauri::command]
// TODO(M2): 트랙 A
pub fn create_note(_db: tauri::State<'_, Db>, color: Option<ColorIndex>) -> CmdResult<Note> {
    let _ = color;
    Err("미구현: create_note (M2 · 트랙 A)".into())
}

#[tauri::command]
// TODO(M2): 트랙 A
pub fn get_note(_db: tauri::State<'_, Db>, id: String) -> CmdResult<Option<Note>> {
    let _ = id;
    Err("미구현: get_note (M2 · 트랙 A)".into())
}

#[tauri::command]
// TODO(M2): 트랙 A
pub fn list_notes(
    _db: tauri::State<'_, Db>,
    include_deleted: Option<bool>,
) -> CmdResult<Vec<NoteSummary>> {
    let _ = include_deleted;
    Err("미구현: list_notes (M2 · 트랙 A)".into())
}

/// body/title/tags/links/updated_at을 **한 트랜잭션에서** 갱신한다.
#[tauri::command]
// TODO(M2): 트랙 A
pub fn save_note(_db: tauri::State<'_, Db>, id: String, body: String) -> CmdResult<SaveResult> {
    let _ = (id, body);
    Err("미구현: save_note (M2 · 트랙 A)".into())
}

#[tauri::command]
// TODO(M2): 트랙 A
pub fn set_note_meta(_db: tauri::State<'_, Db>, id: String, meta: NoteMeta) -> CmdResult<Note> {
    let _ = (id, meta);
    Err("미구현: set_note_meta (M2 · 트랙 A)".into())
}

#[tauri::command]
// TODO(M2): 트랙 A
pub fn soft_delete_note(_db: tauri::State<'_, Db>, id: String) -> CmdResult<()> {
    let _ = id;
    Err("미구현: soft_delete_note (M2 · 트랙 A)".into())
}

#[tauri::command]
// TODO(M2): 트랙 A
pub fn search_notes(_db: tauri::State<'_, Db>, query: SearchQuery) -> CmdResult<Vec<NoteSummary>> {
    let _ = query;
    Err("미구현: search_notes (M2 · 트랙 A)".into())
}
