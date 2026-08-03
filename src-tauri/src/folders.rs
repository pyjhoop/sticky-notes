//! 폴더 CRUD + 메모 이동 + 휴지통(soft delete/restore/영구 삭제) + 자동 만료 정리.
//!
//! **신설 모듈** — 보드 창 "폴더 사이드바 + 리스트 뷰" 개편.
//! `notes.rs`와 같은 관례: 커맨드는 얇은 래퍼이고, 본체는 `*_in(&Connection)`에 있다
//! (`cargo test`가 Tauri 런타임 없이 인메모리 DB로 검증할 수 있는 이유).
//!
//! `전체` / `미분류` / `휴지통`은 가상 폴더다 — DB 행이 아니라 프론트가
//! `notes.folder_id` / `notes.deleted_at`을 보고 계산한다.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::db::Db;
use crate::windows::emit_notes_changed;
use crate::CmdResult;

/// 휴지통 보관 기간 — 이보다 오래된 `deleted_at`은 영구 삭제된다.
pub const TRASH_RETENTION_DAYS: i64 = 14;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: String,
}

fn row_to_folder(r: &Row<'_>) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: r.get(0)?,
        name: r.get(1)?,
        sort_order: r.get(2)?,
        created_at: r.get(3)?,
    })
}

const FOLDER_COLUMNS: &str = "id, name, sort_order, created_at";

/// 빈 문자열/공백만 있는 이름은 거부한다.
fn validate_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("폴더 이름을 입력하세요".to_string());
    }
    Ok(trimmed.to_string())
}

// ─────────────────────────────────────────────────────────────
// 코어 로직 — 커맨드가 아니라 여기를 테스트한다
// ─────────────────────────────────────────────────────────────

pub fn list_folders_in(conn: &Connection) -> Result<Vec<Folder>, String> {
    let sql = format!(
        "SELECT {FOLDER_COLUMNS} FROM folders ORDER BY sort_order ASC, created_at ASC"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("폴더 목록 조회 준비 실패: {e}"))?;
    let rows = stmt
        .query_map([], row_to_folder)
        .map_err(|e| format!("폴더 목록 조회 실패: {e}"))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("폴더 행 읽기 실패: {e}"))
}

fn get_folder_in(conn: &Connection, id: &str) -> Result<Folder, String> {
    let sql = format!("SELECT {FOLDER_COLUMNS} FROM folders WHERE id = ?1");
    conn.query_row(&sql, params![id], row_to_folder)
        .map_err(|e| format!("폴더를 찾을 수 없습니다({id}): {e}"))
}

pub fn create_folder_in(conn: &Connection, name: &str) -> Result<Folder, String> {
    let name = validate_name(name)?;
    let id = uuid::Uuid::now_v7().to_string();
    let created_at = crate::notes::now_rfc3339();
    let next_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folders",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("정렬 순서 조회 실패: {e}"))?;
    conn.execute(
        "INSERT INTO folders(id, name, sort_order, created_at) VALUES(?1, ?2, ?3, ?4)",
        params![id, name, next_order, created_at],
    )
    .map_err(|e| format!("폴더 생성 실패: {e}"))?;
    Ok(Folder {
        id,
        name,
        sort_order: next_order,
        created_at,
    })
}

pub fn rename_folder_in(conn: &Connection, id: &str, name: &str) -> Result<Folder, String> {
    let name = validate_name(name)?;
    let changed = conn
        .execute(
            "UPDATE folders SET name = ?1 WHERE id = ?2",
            params![name, id],
        )
        .map_err(|e| format!("폴더 이름 변경 실패: {e}"))?;
    if changed == 0 {
        return Err(format!("폴더를 찾을 수 없습니다: {id}"));
    }
    get_folder_in(conn, id)
}

/// 폴더를 지운다. 그 폴더에 속했던 메모는 미분류(`folder_id = NULL`)로 되돌아간다.
pub fn delete_folder_in(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE notes SET folder_id = NULL WHERE folder_id = ?1",
        params![id],
    )
    .map_err(|e| format!("메모를 미분류로 되돌리는 데 실패했습니다: {e}"))?;
    let changed = conn
        .execute("DELETE FROM folders WHERE id = ?1", params![id])
        .map_err(|e| format!("폴더 삭제 실패: {e}"))?;
    if changed == 0 {
        return Err(format!("폴더를 찾을 수 없습니다: {id}"));
    }
    Ok(())
}

/// `folder_id: None`은 "미분류로 이동"을 뜻한다.
pub fn move_notes_to_folder_in(
    conn: &Connection,
    ids: &[String],
    folder_id: Option<&str>,
) -> Result<(), String> {
    for id in ids {
        conn.execute(
            "UPDATE notes SET folder_id = ?1 WHERE id = ?2",
            params![folder_id, id],
        )
        .map_err(|e| format!("폴더 이동 실패({id}): {e}"))?;
    }
    Ok(())
}

/// 여러 메모를 soft delete하고 창까지 닫는다 — 창 destroy는 커맨드 쪽에서 한다
/// (`Connection`만 받는 `*_in` 함수는 `AppHandle`이 없어 창을 건드릴 수 없다).
pub fn soft_delete_notes_in(conn: &Connection, ids: &[String]) -> Result<(), String> {
    for id in ids {
        crate::notes::soft_delete_note_in(conn, id)?;
    }
    Ok(())
}

/// `deleted_at`만 지운다 — `folder_id`는 그대로 유지된다(있던 폴더로 돌아간다).
pub fn restore_notes_in(conn: &Connection, ids: &[String]) -> Result<(), String> {
    for id in ids {
        conn.execute(
            "UPDATE notes SET deleted_at = NULL WHERE id = ?1",
            params![id],
        )
        .map_err(|e| format!("복원 실패({id}): {e}"))?;
    }
    Ok(())
}

/// notes 행 자체와 tags/links/note_geometry의 관련 행을 완전히 지운다.
pub fn permanently_delete_notes_in(conn: &Connection, ids: &[String]) -> Result<(), String> {
    for id in ids {
        conn.execute("DELETE FROM tags WHERE note_id = ?1", params![id])
            .map_err(|e| format!("태그 삭제 실패({id}): {e}"))?;
        conn.execute("DELETE FROM links WHERE note_id = ?1", params![id])
            .map_err(|e| format!("링크 삭제 실패({id}): {e}"))?;
        conn.execute("DELETE FROM note_geometry WHERE note_id = ?1", params![id])
            .map_err(|e| format!("지오메트리 삭제 실패({id}): {e}"))?;
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id])
            .map_err(|e| format!("메모 삭제 실패({id}): {e}"))?;
    }
    Ok(())
}

/// `deleted_at`이 `now - TRASH_RETENTION_DAYS`보다 오래된 메모를 완전히 지운다.
/// 반환값은 지운 개수.
pub fn purge_expired_trash_in(conn: &Connection) -> Result<usize, String> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(TRASH_RETENTION_DAYS))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1")
            .map_err(|e| format!("만료된 휴지통 조회 준비 실패: {e}"))?;
        let rows = stmt
            .query_map(params![cutoff], |r| r.get::<_, String>(0))
            .map_err(|e| format!("만료된 휴지통 조회 실패: {e}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("만료된 휴지통 행 읽기 실패: {e}"))?
    };
    let count = ids.len();
    permanently_delete_notes_in(conn, &ids)?;
    Ok(count)
}

/// 앱 setup에서 1회 — 실패해도 앱 기동을 막지 않는다(로그만 남긴다).
pub fn purge_on_startup<R: Runtime>(app: &tauri::App<R>) {
    let handle = app.handle().clone();
    match handle.state::<Db>().with(|c| purge_expired_trash_in(c)) {
        Ok(0) => {}
        Ok(n) => eprintln!("[folders] 휴지통 자동 정리 — {n}개 영구 삭제"),
        Err(e) => eprintln!("[folders] 휴지통 자동 정리 실패: {e}"),
    }
}

// ─────────────────────────────────────────────────────────────
// 커맨드 — 얇은 래퍼
// ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_folders(db: tauri::State<'_, Db>) -> CmdResult<Vec<Folder>> {
    db.with(|c| list_folders_in(c))
}

#[tauri::command]
pub fn create_folder<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    name: String,
) -> CmdResult<Folder> {
    let folder = db.with(|c| create_folder_in(c, &name))?;
    emit_notes_changed(&app);
    Ok(folder)
}

#[tauri::command]
pub fn rename_folder<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    id: String,
    name: String,
) -> CmdResult<Folder> {
    let folder = db.with(|c| rename_folder_in(c, &id, &name))?;
    emit_notes_changed(&app);
    Ok(folder)
}

#[tauri::command]
pub fn delete_folder<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    id: String,
) -> CmdResult<()> {
    db.with(|c| delete_folder_in(c, &id))?;
    emit_notes_changed(&app);
    Ok(())
}

// 메모 집합/창이 바뀌는 커맨드는 windows.rs 의 창 커맨드들과 같은 이유로 `(async)` 다 —
// 메인 스레드(웹뷰 IPC 콜백) 안에서 여러 DB 작업을 순회하거나 창을 destroy 하지 않는다
// (`CLAUDE.md` "흔한 함정").
#[tauri::command(async)]
pub fn move_notes_to_folder<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    ids: Vec<String>,
    folder_id: Option<String>,
) -> CmdResult<()> {
    db.with(|c| move_notes_to_folder_in(c, &ids, folder_id.as_deref()))?;
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn soft_delete_notes<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    ids: Vec<String>,
) -> CmdResult<()> {
    db.with(|c| soft_delete_notes_in(c, &ids))?;
    for id in &ids {
        crate::windows::destroy_note_window(&app, id);
    }
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn restore_notes<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    ids: Vec<String>,
) -> CmdResult<()> {
    db.with(|c| restore_notes_in(c, &ids))?;
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn permanently_delete_notes<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    ids: Vec<String>,
) -> CmdResult<()> {
    db.with(|c| permanently_delete_notes_in(c, &ids))?;
    emit_notes_changed(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;
    use crate::notes::{create_note_in, get_note_in, save_note_in, soft_delete_note_in};

    #[test]
    fn create_rename_delete_folder() {
        let conn = open_memory().unwrap();
        let f = create_folder_in(&conn, "업무").unwrap();
        assert_eq!(f.name, "업무");
        assert_eq!(f.sort_order, 0);

        let f2 = create_folder_in(&conn, "개인").unwrap();
        assert_eq!(f2.sort_order, 1);

        let renamed = rename_folder_in(&conn, &f.id, "업무2").unwrap();
        assert_eq!(renamed.name, "업무2");

        let all = list_folders_in(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "업무2");

        delete_folder_in(&conn, &f.id).unwrap();
        assert_eq!(list_folders_in(&conn).unwrap().len(), 1);
    }

    #[test]
    fn folder_name_rejects_blank() {
        let conn = open_memory().unwrap();
        assert!(create_folder_in(&conn, "").is_err());
        assert!(create_folder_in(&conn, "   ").is_err());
        assert!(create_folder_in(&conn, "\t\n").is_err());
        // 공백은 트리밍된다
        let f = create_folder_in(&conn, "  업무  ").unwrap();
        assert_eq!(f.name, "업무");
    }

    #[test]
    fn rename_unknown_folder_fails() {
        let conn = open_memory().unwrap();
        assert!(rename_folder_in(&conn, "없는-id", "이름").is_err());
    }

    /// DoD — 폴더를 지우면 그 폴더의 메모는 미분류로 돌아가고, 메모 자체는 남는다.
    #[test]
    fn deleting_folder_unfiles_its_notes() {
        let conn = open_memory().unwrap();
        let f = create_folder_in(&conn, "업무").unwrap();
        let n = create_note_in(&conn, None).unwrap();
        move_notes_to_folder_in(&conn, std::slice::from_ref(&n.id), Some(&f.id)).unwrap();
        assert_eq!(
            get_note_in(&conn, &n.id).unwrap().unwrap().folder_id,
            Some(f.id.clone())
        );

        delete_folder_in(&conn, &f.id).unwrap();
        assert!(get_note_in(&conn, &n.id).unwrap().unwrap().folder_id.is_none());
        assert!(list_folders_in(&conn).unwrap().is_empty());
    }

    #[test]
    fn delete_unknown_folder_fails() {
        let conn = open_memory().unwrap();
        assert!(delete_folder_in(&conn, "없는-id").is_err());
    }

    #[test]
    fn move_notes_to_folder_and_back_to_unfiled() {
        let conn = open_memory().unwrap();
        let f = create_folder_in(&conn, "개발 스니펫").unwrap();
        let a = create_note_in(&conn, None).unwrap();
        let b = create_note_in(&conn, None).unwrap();

        move_notes_to_folder_in(&conn, &[a.id.clone(), b.id.clone()], Some(&f.id)).unwrap();
        assert_eq!(get_note_in(&conn, &a.id).unwrap().unwrap().folder_id, Some(f.id.clone()));
        assert_eq!(get_note_in(&conn, &b.id).unwrap().unwrap().folder_id, Some(f.id.clone()));

        // None == 미분류로 이동
        move_notes_to_folder_in(&conn, std::slice::from_ref(&a.id), None).unwrap();
        assert!(get_note_in(&conn, &a.id).unwrap().unwrap().folder_id.is_none());
        assert_eq!(get_note_in(&conn, &b.id).unwrap().unwrap().folder_id, Some(f.id));
    }

    #[test]
    fn soft_delete_restore_and_permanently_delete() {
        let mut conn = open_memory().unwrap();
        let a = create_note_in(&conn, None).unwrap();
        save_note_in(&mut conn, &a.id, "#태그있음").unwrap();
        let b = create_note_in(&conn, None).unwrap();

        soft_delete_notes_in(&conn, &[a.id.clone(), b.id.clone()]).unwrap();
        assert!(get_note_in(&conn, &a.id).unwrap().unwrap().deleted_at.is_some());
        assert!(get_note_in(&conn, &b.id).unwrap().unwrap().deleted_at.is_some());

        restore_notes_in(&conn, std::slice::from_ref(&a.id)).unwrap();
        assert!(get_note_in(&conn, &a.id).unwrap().unwrap().deleted_at.is_none());
        assert!(get_note_in(&conn, &b.id).unwrap().unwrap().deleted_at.is_some());

        permanently_delete_notes_in(&conn, std::slice::from_ref(&b.id)).unwrap();
        assert!(get_note_in(&conn, &b.id).unwrap().is_none());

        // 태그도 완전히 지운 메모를 따라 사라진다
        permanently_delete_notes_in(&conn, std::slice::from_ref(&a.id)).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags WHERE note_id = ?1", params![a.id], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        assert!(get_note_in(&conn, &a.id).unwrap().is_none());
    }

    #[test]
    fn purge_expired_trash_removes_only_old_enough() {
        let conn = open_memory().unwrap();
        let old = create_note_in(&conn, None).unwrap();
        let recent = create_note_in(&conn, None).unwrap();
        soft_delete_note_in(&conn, &old.id).unwrap();
        soft_delete_note_in(&conn, &recent.id).unwrap();

        // 오래된 것은 15일 전에 지워진 것으로 되돌린다
        let old_ts = (chrono::Utc::now() - chrono::Duration::days(15))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        conn.execute(
            "UPDATE notes SET deleted_at = ?1 WHERE id = ?2",
            params![old_ts, old.id],
        )
        .unwrap();

        let purged = purge_expired_trash_in(&conn).unwrap();
        assert_eq!(purged, 1);
        assert!(get_note_in(&conn, &old.id).unwrap().is_none());
        // 방금 지운 것(14일 미만)은 살아 있다
        assert!(get_note_in(&conn, &recent.id).unwrap().is_some());

        // 멱등 — 더 지울 게 없으면 0
        assert_eq!(purge_expired_trash_in(&conn).unwrap(), 0);
    }
}
