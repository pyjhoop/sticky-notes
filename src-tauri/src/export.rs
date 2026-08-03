//! 마크다운 내보내기 · DB 백업 · 경로 열기.
//!
//! v1에서 옵시디언으로 이어지는 **유일한 다리**다 (`CLAUDE.md` 절대규칙 5).
//! 본문을 마크다운 원문 그대로 저장하는 이유가 여기에 있다.
//!
//! **소유: 트랙 A (M6).**

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

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

/// 파일명 최대 길이(문자 수). 경로 260자 제한을 감안한 여유값.
const FILENAME_MAX_CHARS: usize = 80;

/// Windows 예약 장치명 — 확장자가 붙어도 파일로 만들 수 없다.
const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 파일명에 쓸 수 없는 문자를 걷어낸다.
///
/// `< > : " / \ | ? *` + 제어문자 → 공백, 연속 공백은 하나로, 앞뒤 공백·마침표 제거.
/// Windows 예약 장치명은 `_`를 앞에 붙인다. 전부 걸러져 비면 빈 문자열.
pub fn sanitize_filename(name: &str) -> String {
    let replaced: String = name
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                || (c as u32) < 0x20
            {
                ' '
            } else {
                c
            }
        })
        .collect();

    // 연속 공백 축약
    let mut out = String::with_capacity(replaced.len());
    let mut prev_space = false;
    for c in replaced.chars() {
        let is_space = c.is_whitespace();
        if is_space && prev_space {
            continue;
        }
        out.push(if is_space { ' ' } else { c });
        prev_space = is_space;
    }

    let mut out: String = out.trim().chars().take(FILENAME_MAX_CHARS).collect();
    // Windows는 마침표·공백으로 끝나는 이름을 저장할 수 없다
    while out.ends_with('.') || out.ends_with(' ') {
        out.pop();
    }
    if out.is_empty() {
        return out;
    }

    let stem_upper = out
        .split('.')
        .next()
        .unwrap_or(&out)
        .to_ascii_uppercase();
    if RESERVED.contains(&stem_upper.as_str()) {
        out.insert(0, '_');
    }
    out
}

/// `2026-07-26` — RFC3339 앞 10자. 파싱에 실패하면 `None`.
fn date_prefix_of(created_at: &str) -> Option<String> {
    let d: String = created_at.chars().take(10).collect();
    let ok = d.len() == 10
        && d.as_bytes()[4] == b'-'
        && d.as_bytes()[7] == b'-'
        && d.chars().filter(|c| c.is_ascii_digit()).count() == 8;
    ok.then_some(d)
}

/// 같은 이름이 이미 있으면 ` (2)`, ` (3)` … 을 붙인다.
fn unique_path(dir: &Path, stem: &str, used: &mut Vec<String>) -> PathBuf {
    let mut candidate = stem.to_string();
    let mut n = 2;
    while used.iter().any(|u| u.eq_ignore_ascii_case(&candidate))
        || dir.join(format!("{candidate}.md")).exists()
    {
        candidate = format!("{stem} ({n})");
        n += 1;
    }
    used.push(candidate.clone());
    dir.join(format!("{candidate}.md"))
}

/// 메모 하나의 파일명(확장자 제외)을 만든다.
pub fn export_stem(title: &str, id: &str, created_at: &str, date_prefix: bool) -> String {
    let base = sanitize_filename(title);
    let base = if base.is_empty() {
        sanitize_filename(id)
    } else {
        base
    };
    match (date_prefix, date_prefix_of(created_at)) {
        (true, Some(d)) => format!("{d} {base}"),
        _ => base,
    }
}

/// 메모마다 `.md` 파일을 쓴다. 커맨드가 아니라 여기를 테스트한다.
///
/// `ids`가 `Some`이면 그 id들만(삭제 여부 무관 — 휴지통에 있는 메모도 삭제 전에
/// 내보낼 수 있어야 한다) 내보낸다. `None`이면 기존 동작(삭제되지 않은 전체)이다.
pub fn export_markdown_in(
    conn: &rusqlite::Connection,
    dir: &Path,
    date_prefix: bool,
    ids: Option<&[String]>,
) -> Result<ExportResult, String> {
    if dir.as_os_str().is_empty() {
        return Err("내보낼 폴더를 선택하세요".into());
    }
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("폴더를 만들 수 없습니다({}): {e}", dir.display()))?;
    if !dir.is_dir() {
        return Err(format!("폴더가 아닙니다: {}", dir.display()));
    }

    let notes: Vec<(String, String, String, String)> = match ids {
        Some(ids) if !ids.is_empty() => {
            let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT id, title, body, created_at FROM notes
                 WHERE id IN ({placeholders}) ORDER BY created_at ASC"
            );
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("내보내기 조회 준비 실패: {e}"))?;
            let params_ref: Vec<&dyn rusqlite::ToSql> =
                ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            let rows = stmt
                .query_map(params_ref.as_slice(), |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| format!("내보내기 조회 실패: {e}"))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| format!("내보내기 행 읽기 실패: {e}"))?
        }
        // 빈 id 목록이 명시적으로 왔다 — 아무것도 내보내지 않는다
        Some(_) => Vec::new(),
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, title, body, created_at FROM notes
                     WHERE deleted_at IS NULL ORDER BY created_at ASC",
                )
                .map_err(|e| format!("내보내기 조회 준비 실패: {e}"))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| format!("내보내기 조회 실패: {e}"))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| format!("내보내기 행 읽기 실패: {e}"))?
        }
    };

    let mut used: Vec<String> = Vec::new();
    let mut count = 0usize;
    let mut skipped: Vec<String> = Vec::new();

    for (id, title, body, created_at) in notes {
        if body.trim().is_empty() {
            skipped.push(format!("{id} — 본문이 비어 있음"));
            continue;
        }
        let stem = export_stem(&title, &id, &created_at, date_prefix);
        let path = unique_path(dir, &stem, &mut used);
        // 본문은 마크다운 원문 그대로 — 가공하지 않는다 (끝 줄바꿈만 보정)
        let contents = if body.ends_with('\n') {
            body
        } else {
            format!("{body}\n")
        };
        match std::fs::write(&path, contents) {
            Ok(()) => count += 1,
            Err(e) => skipped.push(format!("{id} — 쓰기 실패: {e}")),
        }
    }

    // 다음 내보내기 때 같은 폴더를 기본값으로 쓴다
    if let Err(e) = crate::db::put_setting(conn, "exportDir", &dir.to_string_lossy()) {
        eprintln!("[export] 내보내기 폴더 기록 실패: {e}");
    }

    Ok(ExportResult {
        count,
        dir: dir.to_string_lossy().into_owned(),
        skipped,
    })
}

/// 폴더를 골라 메모마다 `.md` 파일을 쓴다.
///
/// `date_prefix`가 참이면 파일명이 `2026-07-26 스프린트24.md` 형태가 된다
/// (설정 DATA 섹션의 "파일명에 생성일 프리픽스" 토글).
///
/// `ids`가 있으면 그 메모들만 내보낸다(보드 리스트 뷰의 "선택 항목 내보내기").
/// 생략하면 기존 동작 — 삭제되지 않은 전체.
#[tauri::command]
pub fn export_markdown<R: Runtime>(
    _app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    dir: String,
    date_prefix: bool,
    ids: Option<Vec<String>>,
) -> CmdResult<ExportResult> {
    if dir.trim().is_empty() {
        return Err("내보낼 폴더를 선택하세요".into());
    }
    let target = PathBuf::from(dir.trim());
    db.with(|c| export_markdown_in(c, &target, date_prefix, ids.as_deref()))
}

/// `sticky-notes.db`를 타임스탬프 붙여 복사한다. 반환값은 만들어진 파일 경로.
#[tauri::command]
pub fn backup_db<R: Runtime>(app: AppHandle<R>, dir: Option<String>) -> CmdResult<String> {
    let src = crate::db::db_path(&app)?;
    if !src.exists() {
        return Err(format!("DB 파일이 없습니다: {}", src.display()));
    }

    let target_dir = match dir.as_deref().map(str::trim) {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => src
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "DB 폴더를 찾을 수 없습니다".to_string())?,
    };
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("백업 폴더를 만들 수 없습니다({}): {e}", target_dir.display()))?;

    let stamp = chrono::Local::now().format("%Y-%m-%d_%H%M%S");
    let dest = target_dir.join(format!("sticky-notes-{stamp}.db"));

    // 복사 중 다른 커맨드가 쓰지 못하도록 커넥션을 잡고 있는다
    let state = app.state::<Db>();
    let guard = state
        .0
        .lock()
        .map_err(|e| format!("DB 잠금 실패: {e}"))?;
    if let Some(conn) = guard.as_ref() {
        // WAL이 켜져 있어도 파일 하나로 복사되도록 체크포인트
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
    std::fs::copy(&src, &dest).map_err(|e| format!("백업 복사 실패: {e}"))?;
    drop(guard);

    Ok(dest.to_string_lossy().into_owned())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_illegal_characters() {
        assert_eq!(
            sanitize_filename(r#"보고서: 1/2 <초안> "v2" |검토?|"#),
            "보고서 1 2 초안 v2 검토"
        );
        assert_eq!(sanitize_filename("탭\t과\n줄바꿈"), "탭 과 줄바꿈");
        assert_eq!(sanitize_filename("끝에 점..."), "끝에 점");
        assert_eq!(sanitize_filename("   "), "");
        assert_eq!(sanitize_filename("/\\:*?\"<>|"), "");
    }

    #[test]
    fn sanitize_escapes_reserved_device_names() {
        assert_eq!(sanitize_filename("CON"), "_CON");
        assert_eq!(sanitize_filename("nul"), "_nul");
        assert_eq!(sanitize_filename("com1.backup"), "_com1.backup");
        assert_eq!(sanitize_filename("연결"), "연결"); // 예약어가 아니다
    }

    #[test]
    fn sanitize_limits_length() {
        let long = "가".repeat(300);
        assert_eq!(sanitize_filename(&long).chars().count(), FILENAME_MAX_CHARS);
    }

    #[test]
    fn stem_uses_date_prefix_and_falls_back_to_id() {
        let created = "2026-07-26T12:04:00.000Z";
        assert_eq!(
            export_stem("스프린트24", "abc", created, true),
            "2026-07-26 스프린트24"
        );
        assert_eq!(export_stem("스프린트24", "abc", created, false), "스프린트24");
        // 제목이 전부 걸러지면 id로 대체
        assert_eq!(export_stem("///", "abc", created, false), "abc");
        // 날짜가 깨져 있으면 프리픽스를 붙이지 않는다
        assert_eq!(export_stem("메모", "abc", "", true), "메모");
    }

    #[test]
    fn exports_one_md_per_note() {
        use crate::db::open_memory;
        use crate::notes::{create_note_in, save_note_in, soft_delete_note_in};

        let dir = std::env::temp_dir().join(format!(
            "sticky-export-{}",
            uuid::Uuid::now_v7().simple()
        ));
        let mut conn = open_memory().unwrap();

        let a = create_note_in(&conn, None).unwrap();
        save_note_in(&mut conn, &a.id, "# 스프린트24\n\n- [ ] 인증서 갱신").unwrap();
        let b = create_note_in(&conn, None).unwrap();
        save_note_in(&mut conn, &b.id, "# 보고서: 1/2 <초안>\n내용").unwrap();
        let empty = create_note_in(&conn, None).unwrap(); // 본문 없음 → 건너뛴다
        let gone = create_note_in(&conn, None).unwrap();
        save_note_in(&mut conn, &gone.id, "# 지운 것").unwrap();
        soft_delete_note_in(&conn, &gone.id).unwrap();

        let r = export_markdown_in(&conn, &dir, false, None).unwrap();
        assert_eq!(r.count, 2);
        assert_eq!(r.skipped.len(), 1);
        assert!(r.skipped[0].starts_with(&empty.id));

        let sprint = dir.join("스프린트24.md");
        assert!(sprint.exists());
        assert_eq!(
            std::fs::read_to_string(&sprint).unwrap(),
            "# 스프린트24\n\n- [ ] 인증서 갱신\n",
            "본문은 마크다운 원문 그대로여야 한다"
        );
        assert!(dir.join("보고서 1 2 초안.md").exists());
        assert!(!dir.join("지운 것.md").exists());

        // 내보내기 폴더가 설정에 기록된다
        assert!(crate::db::load_settings(&conn).unwrap().export_dir.is_some());

        // 날짜 프리픽스 토글
        let r2 = export_markdown_in(&conn, &dir, true, None).unwrap();
        assert_eq!(r2.count, 2);
        let names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            names.iter().any(|n| n.starts_with("20") && n.contains("스프린트24")),
            "날짜 프리픽스 파일이 없다: {names:?}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// DoD — `ids`가 있으면 그것만, 삭제 여부와 무관하게 내보낸다(휴지통 메모 포함).
    #[test]
    fn exports_only_given_ids_including_trashed() {
        use crate::db::open_memory;
        use crate::notes::{create_note_in, save_note_in, soft_delete_note_in};

        let dir = std::env::temp_dir().join(format!(
            "sticky-export-ids-{}",
            uuid::Uuid::now_v7().simple()
        ));
        let mut conn = open_memory().unwrap();

        let a = create_note_in(&conn, None).unwrap();
        save_note_in(&mut conn, &a.id, "# A\n본문A").unwrap();
        let b = create_note_in(&conn, None).unwrap();
        save_note_in(&mut conn, &b.id, "# B\n본문B").unwrap();
        let trashed = create_note_in(&conn, None).unwrap();
        save_note_in(&mut conn, &trashed.id, "# 휴지통 메모\n본문").unwrap();
        soft_delete_note_in(&conn, &trashed.id).unwrap();

        // A와 휴지통 메모만 선택 — B는 빠지고, 삭제된 것도 선택했으면 내보내진다
        let ids = vec![a.id.clone(), trashed.id.clone()];
        let r = export_markdown_in(&conn, &dir, false, Some(&ids)).unwrap();
        assert_eq!(r.count, 2);
        assert!(dir.join("A.md").exists());
        assert!(dir.join("휴지통 메모.md").exists());
        assert!(!dir.join("B.md").exists());

        // 빈 id 목록 — 아무것도 내보내지 않는다
        let dir2 = std::env::temp_dir().join(format!(
            "sticky-export-ids-empty-{}",
            uuid::Uuid::now_v7().simple()
        ));
        let r2 = export_markdown_in(&conn, &dir2, false, Some(&[])).unwrap();
        assert_eq!(r2.count, 0);

        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&dir2).ok();
    }

    #[test]
    fn unique_path_avoids_collisions() {
        let dir = std::env::temp_dir().join("sticky-export-test-unique");
        let mut used = Vec::new();
        let a = unique_path(&dir, "같은제목", &mut used);
        let b = unique_path(&dir, "같은제목", &mut used);
        assert_eq!(a.file_name().unwrap(), "같은제목.md");
        assert_eq!(b.file_name().unwrap(), "같은제목 (2).md");
    }
}
