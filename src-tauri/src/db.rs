//! SQLite 레이어 — 스키마 · 마이그레이션 · 설정 key/value.
//!
//! **소유: 트랙 A (M2).**
//!
//! - 커넥션은 `Mutex<Option<Connection>>`을 `tauri::State`로 관리한다
//! - 스키마 변경은 `MIGRATIONS` 배열에 **뒤로만 추가**한다. `PRAGMA user_version`이 진행도다
//! - 검색은 FTS5가 아니라 `LIKE '%q%'` (`CLAUDE.md` "흔한 함정" — 한국어 부분 일치)

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::CmdResult;

/// `tauri::State`로 관리하는 커넥션.
#[derive(Default)]
pub struct Db(pub Mutex<Option<rusqlite::Connection>>);

impl Db {
    /// 커넥션을 잠그고 클로저를 실행한다.
    ///
    /// 트랜잭션을 열 수 있도록 `&mut Connection`을 넘긴다.
    /// **클로저 안에서 다시 `with`를 부르지 않는다** (재진입 = 데드락).
    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T, String>) -> CmdResult<T> {
        let mut guard = self
            .0
            .lock()
            .map_err(|e| format!("DB 잠금 실패: {e}"))?;
        let conn = guard
            .as_mut()
            .ok_or_else(|| "DB가 아직 열리지 않았습니다".to_string())?;
        f(conn)
    }
}

/// `plan.md` 데이터 모델 절의 스키마.
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

/// 조회 경로용 인덱스. 스키마와 함께 v1에 들어간다.
const INDEXES_V1: &str = r#"
CREATE INDEX IF NOT EXISTS idx_notes_updated  ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_open     ON notes(open);
CREATE INDEX IF NOT EXISTS idx_tags_tag       ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_links_target   ON links(target);
"#;

// ─────────────────────────────────────────────────────────────
// 마이그레이션 — 배열 인덱스 = PRAGMA user_version
// ─────────────────────────────────────────────────────────────

type Migration = fn(&rusqlite::Transaction<'_>) -> rusqlite::Result<()>;

/// **뒤로만 추가한다.** 이미 배포된 항목을 고치면 기존 DB가 깨진다.
const MIGRATIONS: &[Migration] = &[m001_initial];

/// 최신 스키마 버전 = 적용된 마이그레이션 개수.
pub const LATEST_VERSION: i64 = MIGRATIONS.len() as i64;

fn m001_initial(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(SCHEMA_V1)?;
    tx.execute_batch(INDEXES_V1)?;
    Ok(())
}

/// `PRAGMA user_version`을 보고 남은 마이그레이션만 순서대로 적용한다.
///
/// **멱등**하다 — 두 번 호출해도 두 번째는 아무 일도 하지 않는다.
pub fn migrate(conn: &mut Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("PRAGMA 설정 실패: {e}"))?;

    let mut version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| format!("user_version 조회 실패: {e}"))?;

    if version > LATEST_VERSION {
        return Err(format!(
            "DB 스키마 버전({version})이 앱({LATEST_VERSION})보다 높습니다. 최신 버전을 설치하세요."
        ));
    }

    while version < LATEST_VERSION {
        let idx = version as usize;
        let tx = conn
            .transaction()
            .map_err(|e| format!("마이그레이션 트랜잭션 실패: {e}"))?;
        MIGRATIONS[idx](&tx).map_err(|e| format!("마이그레이션 {}단계 실패: {e}", idx + 1))?;
        tx.pragma_update(None, "user_version", version + 1)
            .map_err(|e| format!("user_version 갱신 실패: {e}"))?;
        tx.commit()
            .map_err(|e| format!("마이그레이션 커밋 실패: {e}"))?;
        version += 1;
    }
    Ok(())
}

/// 테스트·진단용 인메모리 DB. 스키마까지 적용해서 돌려준다.
pub fn open_memory() -> Result<Connection, String> {
    let mut conn =
        Connection::open_in_memory().map_err(|e| format!("인메모리 DB 열기 실패: {e}"))?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// 파일 DB를 열고 마이그레이션까지 끝낸다.
pub fn open_at(path: &std::path::Path) -> Result<Connection, String> {
    let mut conn = Connection::open(path)
        .map_err(|e| format!("DB 열기 실패({}): {e}", path.display()))?;
    migrate(&mut conn)?;
    Ok(conn)
}

// ─────────────────────────────────────────────────────────────
// 경로
// ─────────────────────────────────────────────────────────────

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

/// 앱 setup에서 1회 호출 — 커넥션을 열고 마이그레이션을 적용한다.
pub fn init<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let path = db_path(&handle)?;
    let conn = open_at(&path)?;
    let state = app.state::<Db>();
    *state.0.lock().map_err(|e| e.to_string())? = Some(conn);
    Ok(())
}

// ─────────────────────────────────────────────────────────────
// 설정 (settings 테이블)
// ─────────────────────────────────────────────────────────────

/// 악센트 색 — 디자인 `$props.accent` 의 4개 옵션 중 하나.
pub const ACCENT_OPTIONS: [&str; 4] = ["#0067C0", "#7a5cd6", "#3a8a4f", "#c05621"];

/// 투명도 하한/상한 (`notes.rs`와 동일).
const OPACITY_MIN: u8 = 35;
const OPACITY_MAX: u8 = 100;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// SHORTCUTS — `새 메모`
    pub shortcut_new_note: String,
    /// SHORTCUTS — `모든 메모 보기`
    pub shortcut_show_board: String,
    /// SHORTCUTS — `항상 위 전환`
    pub shortcut_toggle_always_on_top: String,
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
            shortcut_new_note: crate::shortcuts::DEFAULT_NEW_NOTE.to_string(),
            shortcut_show_board: crate::shortcuts::DEFAULT_SHOW_BOARD.to_string(),
            shortcut_toggle_always_on_top: crate::shortcuts::DEFAULT_TOGGLE_TOP.to_string(),
        }
    }
}

/// `settings` 테이블의 key — `src/lib/ipc.ts`의 `keyof Settings`와 1:1 (camelCase).
///
/// 단축키 3개가 여기 있는 이유는 `shortcuts.rs`의 모듈 주석 참조 —
/// 쓰기만 하고 읽는 경로가 없어 재바인딩이 재시작 때 사라지던 문제를 막는다.
pub const SETTING_KEYS: [&str; 10] = [
    "alwaysOnTop",
    "autoFade",
    "defaultOpacity",
    "accent",
    "filenameDatePrefix",
    "exportDir",
    "autostart",
    "shortcutNewNote",
    "shortcutShowBoard",
    "shortcutToggleAlwaysOnTop",
];

fn parse_bool(key: &str, value: &str) -> Result<bool, String> {
    match value.trim() {
        "true" | "1" => Ok(true),
        "false" | "0" => Ok(false),
        other => Err(format!("설정 '{key}'의 값이 올바르지 않습니다: {other}")),
    }
}

/// key/value 한 쌍을 `Settings`에 반영한다. 알 수 없는 key는 오류.
pub fn apply_setting(s: &mut Settings, key: &str, value: &str) -> Result<(), String> {
    match key {
        "alwaysOnTop" => s.always_on_top = parse_bool(key, value)?,
        "autoFade" => s.auto_fade = parse_bool(key, value)?,
        "defaultOpacity" => {
            let v: i64 = value
                .trim()
                .parse()
                .map_err(|_| format!("기본 투명도가 숫자가 아닙니다: {value}"))?;
            s.default_opacity = v.clamp(OPACITY_MIN as i64, OPACITY_MAX as i64) as u8;
        }
        "accent" => {
            let v = value.trim();
            if !ACCENT_OPTIONS.contains(&v) {
                return Err(format!("악센트 색 선택지에 없습니다: {v}"));
            }
            s.accent = v.to_string();
        }
        "filenameDatePrefix" => s.filename_date_prefix = parse_bool(key, value)?,
        "exportDir" => {
            let v = value.trim();
            s.export_dir = if v.is_empty() {
                None
            } else {
                Some(v.to_string())
            };
        }
        "autostart" => s.autostart = parse_bool(key, value)?,
        "shortcutNewNote" => s.shortcut_new_note = parse_accelerator(key, value)?,
        "shortcutShowBoard" => s.shortcut_show_board = parse_accelerator(key, value)?,
        "shortcutToggleAlwaysOnTop" => {
            s.shortcut_toggle_always_on_top = parse_accelerator(key, value)?
        }
        other => return Err(format!("알 수 없는 설정 key: {other}")),
    }
    Ok(())
}

/// 단축키 문자열 — 빈 값만 거른다.
///
/// `Ctrl+Alt+N` 형식이 실제로 유효한지는 여기서 판정하지 않는다. 파싱은
/// `tauri-plugin-global-shortcut`이 하고, 실패하면 `shortcuts::init`이
/// 기본값으로 되돌리며 그 사실을 `get_shortcut_failures`에 남긴다.
fn parse_accelerator(key: &str, value: &str) -> Result<String, String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(format!("설정 '{key}'의 단축키가 비어 있습니다"));
    }
    Ok(v.to_string())
}

/// 저장된 key/value를 기본값 위에 병합한다.
/// 값이 깨져 있으면 그 항목만 기본값을 유지한다 (설정 창이 열리지 않는 사태를 막는다).
pub fn merge_settings(pairs: &BTreeMap<String, String>) -> Settings {
    let mut s = Settings::default();
    for (k, v) in pairs {
        if let Err(e) = apply_setting(&mut s, k, v) {
            eprintln!("[db] 설정 무시: {e}");
        }
    }
    s
}

/// `settings` 테이블 전체를 읽어 병합한다.
pub fn load_settings(conn: &Connection) -> Result<Settings, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| format!("설정 조회 준비 실패: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| format!("설정 조회 실패: {e}"))?;

    let mut map = BTreeMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| format!("설정 행 읽기 실패: {e}"))?;
        map.insert(k, v.unwrap_or_default());
    }
    Ok(merge_settings(&map))
}

/// 검증 후 upsert.
pub fn put_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    // 값 검증 — 잘못된 값은 저장하지 않는다
    let mut probe = Settings::default();
    apply_setting(&mut probe, key, value)?;

    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("설정 저장 실패: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(db: tauri::State<'_, Db>) -> CmdResult<Settings> {
    db.with(|c| load_settings(c))
}

#[tauri::command]
pub fn set_setting(db: tauri::State<'_, Db>, key: String, value: String) -> CmdResult<()> {
    db.with(|c| put_setting(c, &key, &value))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_names(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    fn user_version(conn: &Connection) -> i64 {
        conn.pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn migration_creates_five_tables() {
        let conn = open_memory().unwrap();
        let names = table_names(&conn);
        for t in ["notes", "note_geometry", "tags", "links", "settings"] {
            assert!(names.contains(&t.to_string()), "{t} 테이블이 없다: {names:?}");
        }
        assert_eq!(user_version(&conn), LATEST_VERSION);
    }

    /// DoD — 마이그레이션 멱등성: 두 번 돌려도 안전해야 한다.
    #[test]
    fn migration_is_idempotent() {
        let mut conn = open_memory().unwrap();
        let before = table_names(&conn);

        conn.execute(
            "INSERT INTO notes(id,title,body,color,opacity,pinned,open,created_at,updated_at)
             VALUES('keep','t','b',0,96,1,1,'2026-07-26T00:00:00Z','2026-07-26T00:00:00Z')",
            [],
        )
        .unwrap();

        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();

        assert_eq!(table_names(&conn), before);
        assert_eq!(user_version(&conn), LATEST_VERSION);
        // 기존 데이터가 살아 있어야 한다
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes WHERE id='keep'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn migration_rejects_future_schema() {
        let mut conn = open_memory().unwrap();
        conn.pragma_update(None, "user_version", LATEST_VERSION + 5)
            .unwrap();
        assert!(migrate(&mut conn).is_err());
    }

    #[test]
    fn settings_merge_defaults_and_overrides() {
        let conn = open_memory().unwrap();
        assert_eq!(load_settings(&conn).unwrap(), Settings::default());

        put_setting(&conn, "autoFade", "false").unwrap();
        put_setting(&conn, "defaultOpacity", "42").unwrap();
        put_setting(&conn, "accent", "#3a8a4f").unwrap();
        put_setting(&conn, "exportDir", r"C:\note").unwrap();

        let s = load_settings(&conn).unwrap();
        assert!(!s.auto_fade);
        assert!(s.always_on_top); // 건드리지 않은 값은 기본값
        assert_eq!(s.default_opacity, 42);
        assert_eq!(s.accent, "#3a8a4f");
        assert_eq!(s.export_dir.as_deref(), Some(r"C:\note"));

        // upsert — 같은 key를 다시 써도 행이 늘지 않는다
        put_setting(&conn, "accent", "#c05621").unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 4);
        assert_eq!(load_settings(&conn).unwrap().accent, "#c05621");
    }

    #[test]
    fn settings_reject_bad_values() {
        let conn = open_memory().unwrap();
        assert!(put_setting(&conn, "accent", "#ff0000").is_err());
        assert!(put_setting(&conn, "autoFade", "아마도").is_err());
        assert!(put_setting(&conn, "없는키", "1").is_err());
        // 저장되지 않았어야 한다
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn setting_keys_cover_every_field() {
        // ipc.ts의 keyof Settings와 어긋나면 여기서 걸린다
        let mut s = Settings::default();
        for k in SETTING_KEYS {
            let v = match k {
                "defaultOpacity" => "50",
                "accent" => "#7a5cd6",
                "exportDir" => "D:\\vault",
                _ if k.starts_with("shortcut") => "Ctrl+Alt+J",
                _ => "true",
            };
            apply_setting(&mut s, k, v).unwrap_or_else(|e| panic!("{k}: {e}"));
        }
        assert_eq!(s.default_opacity, 50);
        assert!(s.autostart);
    }

    #[test]
    fn opacity_setting_is_clamped() {
        let mut s = Settings::default();
        apply_setting(&mut s, "defaultOpacity", "5").unwrap();
        assert_eq!(s.default_opacity, OPACITY_MIN);
        apply_setting(&mut s, "defaultOpacity", "300").unwrap();
        assert_eq!(s.default_opacity, OPACITY_MAX);
    }
}
