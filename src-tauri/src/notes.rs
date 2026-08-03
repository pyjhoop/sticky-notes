//! 메모 CRUD 커맨드 + 마크다운 파생(제목 · `#태그` · `[[위키링크]]`).
//!
//! **소유: 트랙 A (M2).** 타입은 `src/lib/ipc.ts`와 1:1로 대응한다 (serde camelCase).
//!
//! 커맨드는 전부 얇은 래퍼이고, 실제 로직은 `*_in(&Connection)` 함수에 있다.
//! `cargo test`가 Tauri 런타임 없이 인메모리 DB로 검증할 수 있는 이유다.

use std::collections::HashMap;

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::db::Db;
use crate::windows::emit_notes_changed;
use crate::CmdResult;

/// 팔레트 인덱스 0..4 (`src/lib/palette.ts` 순서와 동일)
pub type ColorIndex = u8;

pub const OPACITY_MIN: u8 = 35;
pub const OPACITY_MAX: u8 = 100;
pub const COLOR_MAX: ColorIndex = 4;

/// 제목 최대 길이 (문자 수).
pub const TITLE_MAX_CHARS: usize = 80;
/// 제목을 못 뽑았을 때.
pub const UNTITLED: &str = "제목 없음";
/// 보드 카드 미리보기 최대 길이 (문자 수).
const PREVIEW_MAX_CHARS: usize = 160;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
// 마크다운 파생 — 코드블록 인식 스캐너
//
// 프론트 `src/lib/markdown.ts`(트랙 B)와 같은 규칙이지만 별개 구현이다.
// `save_note`가 tags/links 테이블을 갱신해야 하므로 Rust에도 필요하다.
// ─────────────────────────────────────────────────────────────

/// 블록 마커 앞에 허용되는 들여쓰기 — **스페이스만** 센다.
///
/// `trim_start()`를 쓰면 탭도 걷어내서 탭 1개(길이 1)가 "3칸 이하"로 통과한다.
/// CommonMark에서 탭은 4칸으로 펼쳐지므로 탭으로 들여쓴 줄은 펜스가 아니라
/// **들여쓰기 코드블록**이다. 프론트 `src/lib/markdown.ts`의 `^ {0,3}`이 이미
/// 스페이스만 허용하고 있어, 이 함수가 규칙 불일치의 원인이었다.
///
/// 스페이스가 아닌 문자가 나오기 전까지의 스페이스 개수와, 그 위치의 나머지 문자열.
fn after_space_indent(line: &str) -> Option<&str> {
    let indent = line.chars().take_while(|&c| c == ' ').count();
    if indent > 3 {
        return None;
    }
    // 스페이스는 1바이트라 개수 = 바이트 오프셋이다
    Some(&line[indent..])
}

/// 펜스 줄이면 `(펜스 문자, 개수)`.
fn fence_info(line: &str) -> Option<(char, usize)> {
    let rest = after_space_indent(line)?;
    let c = rest.chars().next()?;
    if c != '`' && c != '~' {
        return None;
    }
    let n = rest.chars().take_while(|&x| x == c).count();
    if n < 3 {
        return None;
    }
    Some((c, n))
}

/// 닫는 펜스인가 — 같은 문자로 열 때보다 같거나 많이, 뒤에는 공백만.
fn is_closing_fence(line: &str, open_char: char, open_len: usize) -> bool {
    match fence_info(line) {
        Some((c, n)) if c == open_char && n >= open_len => {
            let rest = after_space_indent(line).unwrap_or(line);
            rest.chars().skip(n).all(char::is_whitespace)
        }
        _ => false,
    }
}

/// 인라인 코드(`` ` ``, ``` `` ``` …)를 공백 하나로 치환한다.
/// 닫히지 않은 백틱은 CommonMark대로 그냥 글자로 둔다.
fn strip_inline_code(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != '`' {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let open = run_len(&chars, i);
        let mut j = i + open;
        let mut close = None;
        while j < chars.len() {
            if chars[j] == '`' {
                let n = run_len(&chars, j);
                if n == open {
                    close = Some(j);
                    break;
                }
                j += n;
            } else {
                j += 1;
            }
        }
        match close {
            Some(end) => {
                out.push(' ');
                i = end + open;
            }
            None => {
                for _ in 0..open {
                    out.push('`');
                }
                i += open;
            }
        }
    }
    out
}

fn run_len(chars: &[char], from: usize) -> usize {
    let c = chars[from];
    let mut n = 0;
    while from + n < chars.len() && chars[from + n] == c {
        n += 1;
    }
    n
}

/// 공백 4칸(또는 탭 1개)으로 시작하는 줄 — 들여쓰기 코드블록 후보.
fn is_indented_line(line: &str) -> bool {
    line.starts_with("    ") || line.starts_with('\t')
}

/// 코드블록 **바깥**의 줄만, 인라인 코드를 제거한 상태로 돌려준다.
///
/// 제목 파생 · `#태그` · `[[링크]]` 추출은 전부 이 결과 위에서 돈다.
///
/// 제외 대상은 두 가지다.
/// 1. 펜스 코드블록 (```` ``` ````, `~~~`)
/// 2. **들여쓰기 코드블록** — 4칸(또는 탭 1개) 이상 들여쓴 줄
///
/// 2번은 CommonMark대로 **문단 안에서는 시작될 수 없다.** 앞줄이 비어 있거나
/// 문서 시작일 때만 블록이 열린다 (문단 연속줄의 들여쓰기는 코드가 아니다).
/// 한 번 열린 블록은 빈 줄로 끊기지 않고, 들여쓰지 않은 비어있지 않은 줄에서 닫힌다.
///
/// 리스트 문맥은 추적하지 않는다. `- 상위` 바로 다음 줄의 들여쓰기는 앞줄이
/// 비어 있지 않으므로 코드로 오인하지 않는다. 다만 `- 상위` + 빈 줄 + 들여쓴 줄
/// (느슨한 리스트의 두 번째 문단)은 여기서 코드로 본다 — 리스트 문맥을 따라가지
/// 않는 대신 프론트 `src/lib/markdown.ts`의 `maskIndentedCode`와 **결과가 같은
/// 쪽**을 택했다. tags/links의 진실의 원천이 Rust이므로 프론트와 규칙이
/// 어긋나는 쪽이 더 나쁘다.
pub fn plain_lines(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    // 문서 시작은 "앞에 빈 줄이 있는 것"과 같게 본다
    let mut prev_blank = true;
    let mut in_indented = false;

    for line in body.lines() {
        match fence {
            Some((c, n)) => {
                if is_closing_fence(line, c, n) {
                    fence = None;
                }
                // 펜스 줄은 프론트에서 공백으로 덮이므로 빈 줄로 센다
                prev_blank = true;
                continue;
            }
            None => {
                if let Some(info) = fence_info(line) {
                    fence = Some(info);
                    prev_blank = true;
                    continue;
                }
            }
        }

        let is_blank = line.trim().is_empty();
        if in_indented {
            // 빈 줄은 블록을 끊지 않는다 — 다음 들여쓰기 줄이 오면 계속 코드다
            if !is_blank && !is_indented_line(line) {
                in_indented = false;
            }
        } else if prev_blank && is_indented_line(line) {
            in_indented = true;
        }
        prev_blank = is_blank;

        if !in_indented {
            out.push(strip_inline_code(line));
        }
    }
    out
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '/')
}

fn push_unique(out: &mut Vec<String>, v: String) {
    if !out.iter().any(|x| x == &v) {
        out.push(v);
    }
}

fn scan_tags(line: &str, out: &mut Vec<String>) {
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '#' {
            // 앞이 글자면 태그가 아니다 (`색상#1`), 앞이 `#`이면 제목 마커다 (`## 소제목`)
            let prev_ok = i == 0
                || chars[i - 1].is_whitespace()
                || matches!(chars[i - 1], '(' | '[' | '{' | ',' | ';' | ':' | '"' | '\'');
            if prev_ok {
                let start = i + 1;
                let mut j = start;
                while j < chars.len() && is_tag_char(chars[j]) {
                    j += 1;
                }
                if j > start {
                    let tag: String = chars[start..j].iter().collect();
                    // 숫자만이면 이슈 번호로 보고 버린다 (`#1`)
                    if !tag.chars().all(|c| c.is_ascii_digit()) {
                        push_unique(out, tag);
                    }
                    i = j;
                    continue;
                }
            }
        }
        i += 1;
    }
}

fn scan_links(line: &str, out: &mut Vec<String>) {
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i + 3 < chars.len() {
        if chars[i] == '[' && chars[i + 1] == '[' {
            let start = i + 2;
            let mut j = start;
            let mut end = None;
            while j + 1 < chars.len() {
                if chars[j] == ']' && chars[j + 1] == ']' {
                    end = Some(j);
                    break;
                }
                // `[[` 안에 다시 `[[`가 나오면 앞의 것은 버린다
                if chars[j] == '[' && chars[j + 1] == '[' {
                    break;
                }
                j += 1;
            }
            if let Some(e) = end {
                let raw: String = chars[start..e].iter().collect();
                // `[[대상|별칭]]` → 대상만
                let target = raw.split('|').next().unwrap_or("").trim().to_string();
                if !target.is_empty() {
                    push_unique(out, target);
                }
                i = e + 2;
                continue;
            }
        }
        i += 1;
    }
}

/// `#태그` — 코드블록/인라인 코드 안은 제외한다.
pub fn extract_tags(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in plain_lines(body) {
        scan_tags(&line, &mut out);
    }
    out
}

/// `[[위키링크]]` — 코드블록/인라인 코드 안은 제외한다.
pub fn extract_links(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in plain_lines(body) {
        scan_links(&line, &mut out);
    }
    out
}

fn truncate_chars(s: &str, max: usize) -> String {
    let mut out: String = s.chars().take(max).collect();
    if s.chars().count() > max {
        while out.ends_with(' ') {
            out.pop();
        }
    }
    out
}

/// ATX 제목이면 `#`을 벗겨 돌려준다.
///
/// 들여쓰기는 펜스와 같은 규칙 — 스페이스 3칸까지만 (`^ {0,3}#{1,6}` · 프론트 `ATX_LINE_RE`).
fn heading_text(line: &str) -> Option<String> {
    let t = after_space_indent(line)?;
    let hashes = t.chars().take_while(|&c| c == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest: String = t.chars().skip(hashes).collect();
    // ATX 제목은 `#` 뒤에 공백이 있어야 한다 (`#태그`와 구분되는 지점)
    if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let text = rest.trim().trim_end_matches('#').trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

/// 제목 파생 — 첫 `# 제목` → 없으면 첫 비어있지 않은 줄 → 80자 절단 → 없으면 `제목 없음`.
///
/// 코드블록은 건너뛴다. 본문이 코드블록으로 시작해도 그 안의 코드가 제목이 되지 않는다.
pub fn derive_title(body: &str) -> String {
    let lines = plain_lines(body);

    for line in &lines {
        if let Some(h) = heading_text(line) {
            return truncate_chars(&h, TITLE_MAX_CHARS);
        }
    }
    for line in &lines {
        let t = line.trim();
        if !t.is_empty() {
            return truncate_chars(t, TITLE_MAX_CHARS);
        }
    }
    UNTITLED.to_string()
}

/// 줄 앞의 목록/인용 마커를 벗긴다 (미리보기 전용 — 원문은 건드리지 않는다).
fn strip_line_marker(line: &str) -> String {
    let mut t = line.trim();
    loop {
        let before = t;
        if let Some(r) = t.strip_prefix("> ") {
            t = r.trim_start();
        }
        for m in ["- [ ] ", "- [x] ", "- [X] ", "- ", "* ", "+ "] {
            if let Some(r) = t.strip_prefix(m) {
                t = r.trim_start();
                break;
            }
        }
        if t == before {
            break;
        }
    }
    t.to_string()
}

/// 보드 카드 미리보기 — 제목 줄을 뺀 나머지를 ` · `로 잇는다.
pub fn derive_preview(body: &str) -> String {
    let lines = plain_lines(body);
    let title = derive_title(body);

    let mut parts: Vec<String> = Vec::new();
    let mut skipped_title = false;
    for line in &lines {
        let t = strip_line_marker(line);
        if t.is_empty() {
            continue;
        }
        // 제목이 된 줄 하나만 건너뛴다
        if !skipped_title
            && (heading_text(line).as_deref() == Some(title.as_str()) || t == title)
        {
            skipped_title = true;
            continue;
        }
        parts.push(t);
        if parts.iter().map(|p| p.chars().count() + 3).sum::<usize>() > PREVIEW_MAX_CHARS {
            break;
        }
    }
    truncate_chars(&parts.join(" · "), PREVIEW_MAX_CHARS)
}

// ─────────────────────────────────────────────────────────────
// 시각
// ─────────────────────────────────────────────────────────────

/// RFC3339 (UTC, 밀리초). 프론트는 `new Date(...)`로 그대로 파싱한다.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

// ─────────────────────────────────────────────────────────────
// 행 매핑
// ─────────────────────────────────────────────────────────────

const NOTE_COLUMNS: &str =
    "id, title, body, color, opacity, pinned, open, created_at, updated_at, deleted_at";

fn row_to_note(r: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        title: r.get(1)?,
        body: r.get(2)?,
        color: r.get::<_, i64>(3)? as ColorIndex,
        opacity: r.get::<_, i64>(4)? as u8,
        pinned: r.get::<_, i64>(5)? != 0,
        open: r.get::<_, i64>(6)? != 0,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
        deleted_at: r.get(9)?,
    })
}

/// `LIKE '%q%'` 패턴. `%` `_` `\`를 이스케이프한다 (`ESCAPE '\'`와 함께 쓴다).
fn like_pattern(term: &str) -> String {
    let mut escaped = String::with_capacity(term.len() + 2);
    for c in term.chars() {
        if matches!(c, '%' | '_' | '\\') {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    format!("%{escaped}%")
}

fn tags_of(conn: &Connection, ids: &[String]) -> Result<HashMap<String, Vec<String>>, String> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    if ids.is_empty() {
        return Ok(map);
    }
    let mut stmt = conn
        .prepare("SELECT note_id, tag FROM tags ORDER BY rowid")
        .map_err(|e| format!("태그 조회 준비 실패: {e}"))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("태그 조회 실패: {e}"))?;
    for row in rows {
        let (note_id, tag) = row.map_err(|e| format!("태그 행 읽기 실패: {e}"))?;
        if ids.iter().any(|i| i == &note_id) {
            map.entry(note_id).or_default().push(tag);
        }
    }
    Ok(map)
}

fn summaries_from(conn: &Connection, notes: Vec<Note>) -> Result<Vec<NoteSummary>, String> {
    let ids: Vec<String> = notes.iter().map(|n| n.id.clone()).collect();
    let mut tag_map = tags_of(conn, &ids)?;
    Ok(notes
        .into_iter()
        .map(|n| NoteSummary {
            preview: derive_preview(&n.body),
            tags: tag_map.remove(&n.id).unwrap_or_default(),
            id: n.id,
            title: n.title,
            color: n.color,
            open: n.open,
            pinned: n.pinned,
            updated_at: n.updated_at,
        })
        .collect())
}

// ─────────────────────────────────────────────────────────────
// 코어 로직 — 커맨드가 아니라 여기를 테스트한다
// ─────────────────────────────────────────────────────────────

pub fn create_note_in(conn: &Connection, color: Option<ColorIndex>) -> Result<Note, String> {
    let settings = crate::db::load_settings(conn)?;
    let now = now_rfc3339();
    let note = Note {
        id: uuid::Uuid::now_v7().to_string(),
        title: UNTITLED.to_string(),
        body: String::new(),
        color: color.unwrap_or(0).min(COLOR_MAX),
        opacity: settings
            .default_opacity
            .clamp(OPACITY_MIN, OPACITY_MAX),
        pinned: settings.always_on_top,
        open: true,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
    };
    conn.execute(
        "INSERT INTO notes(id,title,body,color,opacity,pinned,open,created_at,updated_at,deleted_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL)",
        params![
            note.id,
            note.title,
            note.body,
            note.color as i64,
            note.opacity as i64,
            note.pinned as i64,
            note.open as i64,
            note.created_at,
            note.updated_at,
        ],
    )
    .map_err(|e| format!("메모 생성 실패: {e}"))?;
    Ok(note)
}

pub fn get_note_in(conn: &Connection, id: &str) -> Result<Option<Note>, String> {
    let sql = format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1");
    match conn.query_row(&sql, params![id], row_to_note) {
        Ok(n) => Ok(Some(n)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("메모 조회 실패: {e}")),
    }
}

pub fn list_notes_in(conn: &Connection, include_deleted: bool) -> Result<Vec<NoteSummary>, String> {
    let sql = format!(
        "SELECT {NOTE_COLUMNS} FROM notes {} ORDER BY updated_at DESC, id DESC",
        if include_deleted {
            ""
        } else {
            "WHERE deleted_at IS NULL"
        }
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("목록 조회 준비 실패: {e}"))?;
    let rows = stmt
        .query_map([], row_to_note)
        .map_err(|e| format!("목록 조회 실패: {e}"))?;
    let notes = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("목록 행 읽기 실패: {e}"))?;
    summaries_from(conn, notes)
}

/// body/title/tags/links/updated_at을 **한 트랜잭션에서** 갱신한다.
pub fn save_note_in(conn: &mut Connection, id: &str, body: &str) -> Result<SaveResult, String> {
    let title = derive_title(body);
    let tags = extract_tags(body);
    let links = extract_links(body);
    let updated_at = now_rfc3339();

    let tx = conn
        .transaction()
        .map_err(|e| format!("저장 트랜잭션 실패: {e}"))?;

    let changed = tx
        .execute(
            "UPDATE notes SET body = ?1, title = ?2, updated_at = ?3 WHERE id = ?4",
            params![body, title, updated_at, id],
        )
        .map_err(|e| format!("메모 저장 실패: {e}"))?;
    if changed == 0 {
        return Err(format!("메모를 찾을 수 없습니다: {id}"));
    }

    tx.execute("DELETE FROM tags WHERE note_id = ?1", params![id])
        .map_err(|e| format!("태그 정리 실패: {e}"))?;
    {
        let mut stmt = tx
            .prepare("INSERT OR IGNORE INTO tags(note_id, tag) VALUES(?1, ?2)")
            .map_err(|e| format!("태그 저장 준비 실패: {e}"))?;
        for t in &tags {
            stmt.execute(params![id, t])
                .map_err(|e| format!("태그 저장 실패: {e}"))?;
        }
    }

    tx.execute("DELETE FROM links WHERE note_id = ?1", params![id])
        .map_err(|e| format!("링크 정리 실패: {e}"))?;
    {
        let mut stmt = tx
            .prepare("INSERT OR IGNORE INTO links(note_id, target) VALUES(?1, ?2)")
            .map_err(|e| format!("링크 저장 준비 실패: {e}"))?;
        for l in &links {
            stmt.execute(params![id, l])
                .map_err(|e| format!("링크 저장 실패: {e}"))?;
        }
    }

    tx.commit().map_err(|e| format!("저장 커밋 실패: {e}"))?;

    Ok(SaveResult {
        id: id.to_string(),
        title,
        updated_at,
        tags,
        links,
    })
}

pub fn set_note_meta_in(conn: &Connection, id: &str, meta: &NoteMeta) -> Result<Note, String> {
    if let Some(c) = meta.color {
        conn.execute(
            "UPDATE notes SET color = ?1 WHERE id = ?2",
            params![c.min(COLOR_MAX) as i64, id],
        )
        .map_err(|e| format!("색상 갱신 실패: {e}"))?;
    }
    if let Some(o) = meta.opacity {
        conn.execute(
            "UPDATE notes SET opacity = ?1 WHERE id = ?2",
            params![o.clamp(OPACITY_MIN, OPACITY_MAX) as i64, id],
        )
        .map_err(|e| format!("투명도 갱신 실패: {e}"))?;
    }
    if let Some(p) = meta.pinned {
        conn.execute(
            "UPDATE notes SET pinned = ?1 WHERE id = ?2",
            params![p as i64, id],
        )
        .map_err(|e| format!("핀 갱신 실패: {e}"))?;
    }
    if let Some(o) = meta.open {
        conn.execute(
            "UPDATE notes SET open = ?1 WHERE id = ?2",
            params![o as i64, id],
        )
        .map_err(|e| format!("열림 상태 갱신 실패: {e}"))?;
    }
    get_note_in(conn, id)?.ok_or_else(|| format!("메모를 찾을 수 없습니다: {id}"))
}

/// `notes.open`만 바꾼다 (창 destroy / 복원 경로에서 쓴다).
pub fn set_open_in(conn: &Connection, id: &str, open: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE notes SET open = ?1 WHERE id = ?2",
        params![open as i64, id],
    )
    .map_err(|e| format!("열림 상태 갱신 실패: {e}"))?;
    Ok(())
}

/// `notes.open = 1` 이고 삭제되지 않은 메모 id (오래된 것부터).
pub fn open_note_ids_in(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM notes WHERE open = 1 AND deleted_at IS NULL ORDER BY updated_at ASC")
        .map_err(|e| format!("열린 메모 조회 준비 실패: {e}"))?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| format!("열린 메모 조회 실패: {e}"))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("열린 메모 행 읽기 실패: {e}"))
}

/// soft delete — 행은 남기고 `deleted_at`만 채운다. 창은 닫힌 것으로 표시한다.
pub fn soft_delete_note_in(conn: &Connection, id: &str) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE notes SET deleted_at = ?1, open = 0 WHERE id = ?2 AND deleted_at IS NULL",
            params![now_rfc3339(), id],
        )
        .map_err(|e| format!("삭제 실패: {e}"))?;
    if changed == 0 {
        // 이미 삭제됐거나 없는 메모 — 멱등하게 성공 처리
        return Ok(());
    }
    Ok(())
}

/// 검색 3모드. **FTS5를 쓰지 않는다** (`CLAUDE.md` "흔한 함정").
pub fn search_notes_in(conn: &Connection, q: &SearchQuery) -> Result<Vec<NoteSummary>, String> {
    let term = q.term.trim();
    let mut sql = format!("SELECT DISTINCT {} FROM notes n", prefixed_columns("n"));
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    match q.mode {
        SearchMode::Tag if !term.is_empty() => {
            sql.push_str(" JOIN tags t ON t.note_id = n.id");
        }
        SearchMode::Backlink if !term.is_empty() => {
            sql.push_str(" JOIN links l ON l.note_id = n.id");
        }
        _ => {}
    }

    sql.push_str(" WHERE n.deleted_at IS NULL");

    if !term.is_empty() {
        let pattern = like_pattern(term);
        match q.mode {
            SearchMode::Text => {
                sql.push_str(
                    r" AND (n.title LIKE ?1 ESCAPE '\' OR n.body LIKE ?1 ESCAPE '\')",
                );
                args.push(Box::new(pattern));
            }
            SearchMode::Tag => {
                sql.push_str(r" AND t.tag LIKE ?1 ESCAPE '\'");
                args.push(Box::new(pattern));
            }
            SearchMode::Backlink => {
                sql.push_str(r" AND l.target LIKE ?1 ESCAPE '\'");
                args.push(Box::new(pattern));
            }
        }
    }

    if !q.colors.is_empty() {
        let list: Vec<String> = q
            .colors
            .iter()
            .map(|c| (*c).min(COLOR_MAX).to_string())
            .collect();
        sql.push_str(&format!(" AND n.color IN ({})", list.join(",")));
    }

    sql.push_str(" ORDER BY n.updated_at DESC, n.id DESC");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("검색 준비 실패: {e}"))?;
    let params_ref: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let rows = stmt
        .query_map(params_ref.as_slice(), row_to_note)
        .map_err(|e| format!("검색 실패: {e}"))?;
    let notes = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("검색 행 읽기 실패: {e}"))?;
    summaries_from(conn, notes)
}

fn prefixed_columns(alias: &str) -> String {
    NOTE_COLUMNS
        .split(", ")
        .map(|c| format!("{alias}.{c}"))
        .collect::<Vec<_>>()
        .join(", ")
}

// ─────────────────────────────────────────────────────────────
// 커맨드 — 얇은 래퍼
// ─────────────────────────────────────────────────────────────

/// 메모 집합이 바뀌는 커맨드는 **반드시** `emit_notes_changed`로 끝난다.
///
/// 2026-07-26 사용자 결함 신고 #3 — 보드 창이 한 번 읽은 목록을 끝까지 들고 있었다.
/// 다른 창에서 메모를 만들거나 지워도 보드에는 아무 일도 일어나지 않아
/// "추가가 안 된다 / 삭제가 안 된다"로 보였다. 원인은 **바뀜을 알리는 쪽이 없었던 것**이다:
/// `sticky://note-meta-changed`는 `shortcuts.rs`의 전역 핀 토글에서만 emit 됐고,
/// create/save/set_meta/soft_delete 어디에서도 이벤트가 나가지 않았다.
#[tauri::command]
pub fn create_note<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    color: Option<ColorIndex>,
) -> CmdResult<Note> {
    let note = db.with(|c| create_note_in(c, color))?;
    emit_notes_changed(&app);
    Ok(note)
}

#[tauri::command]
pub fn get_note(db: tauri::State<'_, Db>, id: String) -> CmdResult<Option<Note>> {
    db.with(|c| get_note_in(c, &id))
}

#[tauri::command]
pub fn list_notes(
    db: tauri::State<'_, Db>,
    include_deleted: Option<bool>,
) -> CmdResult<Vec<NoteSummary>> {
    db.with(|c| list_notes_in(c, include_deleted.unwrap_or(false)))
}

/// body/title/tags/links/updated_at을 **한 트랜잭션에서** 갱신한다.
#[tauri::command]
pub fn save_note<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    id: String,
    body: String,
) -> CmdResult<SaveResult> {
    let result = db.with(|c| save_note_in(c, &id, &body))?;
    crate::windows::set_note_window_title(&app, &id, &result.title);
    emit_notes_changed(&app);
    Ok(result)
}

#[tauri::command]
pub fn set_note_meta<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    id: String,
    meta: NoteMeta,
) -> CmdResult<Note> {
    let note = db.with(|c| set_note_meta_in(c, &id, &meta))?;
    emit_notes_changed(&app);
    Ok(note)
}

// 창을 없애므로 `windows.rs` 의 창 커맨드들과 같은 이유로 `(async)` 다 —
// 메인 스레드(웹뷰 IPC 콜백) 안에서 다른 창을 destroy 하지 않는다.
#[tauri::command(async)]
pub fn soft_delete_note<R: Runtime>(
    app: AppHandle<R>,
    db: tauri::State<'_, Db>,
    id: String,
) -> CmdResult<()> {
    db.with(|c| soft_delete_note_in(c, &id))?;
    // 지워진 메모의 창이 떠 있으면 같이 닫는다 — 보드에서 지웠는데 데스크톱에
    // 그대로 남아 있으면 "삭제가 안 됐다"로 보인다.
    crate::windows::destroy_note_window(&app, &id);
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn search_notes(db: tauri::State<'_, Db>, query: SearchQuery) -> CmdResult<Vec<NoteSummary>> {
    db.with(|c| search_notes_in(c, &query))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;

    fn seed(conn: &mut Connection, body: &str) -> String {
        let n = create_note_in(conn, None).unwrap();
        save_note_in(conn, &n.id, body).unwrap();
        n.id
    }

    // ── 제목 파생 ────────────────────────────────────────────

    #[test]
    fn title_prefers_first_heading() {
        assert_eq!(
            derive_title("메모 첫 줄\n\n# 진짜 제목\n내용"),
            "진짜 제목"
        );
        assert_eq!(derive_title("### 소제목만 있음"), "소제목만 있음");
    }

    #[test]
    fn title_falls_back_to_first_nonempty_line() {
        assert_eq!(derive_title("\n\n  장보기 목록  \n- 우유"), "장보기 목록");
    }

    /// DoD 엣지케이스 — 빈 본문
    #[test]
    fn title_of_empty_body() {
        assert_eq!(derive_title(""), UNTITLED);
        assert_eq!(derive_title("\n\n   \n\t\n"), UNTITLED);
    }

    /// DoD 엣지케이스 — 코드블록으로 시작
    #[test]
    fn title_skips_leading_code_block() {
        let body = "```rust\n# 이건 주석이지 제목이 아니다\nfn main() {}\n```\n실제 첫 줄";
        assert_eq!(derive_title(body), "실제 첫 줄");

        // 코드블록만 있는 메모는 제목을 못 뽑는다
        assert_eq!(derive_title("```\nSELECT 1;\n```"), UNTITLED);
        // 물결 펜스도 동일
        assert_eq!(derive_title("~~~\n# 코드 안\n~~~\n바깥"), "바깥");
    }

    /// DoD 엣지케이스 — 제목만
    #[test]
    fn title_only_body() {
        assert_eq!(derive_title("# 제목만"), "제목만");
        assert_eq!(derive_title("# 닫는 마커도 벗긴다 ###"), "닫는 마커도 벗긴다");
        // `#` 뒤에 공백이 없으면 제목이 아니라 태그다
        assert_eq!(derive_title("#태그로시작"), "#태그로시작");
    }

    #[test]
    fn title_truncated_to_80_chars() {
        let long = "가".repeat(200);
        let t = derive_title(&format!("# {long}"));
        assert_eq!(t.chars().count(), TITLE_MAX_CHARS);
    }

    // ── 태그 / 링크 추출 ─────────────────────────────────────

    #[test]
    fn extracts_tags_and_links() {
        let body = "본문 [[릴리스 절차]] 참고\n\n#릴리스 #win32 #급함";
        assert_eq!(extract_tags(body), vec!["릴리스", "win32", "급함"]);
        assert_eq!(extract_links(body), vec!["릴리스 절차"]);
    }

    #[test]
    fn heading_marker_is_not_a_tag() {
        assert!(extract_tags("# 제목\n## 소제목").is_empty());
    }

    /// DoD — 코드블록 내부의 `#태그`·`[[링크]]`는 추출되지 않는다
    #[test]
    fn code_block_content_is_excluded() {
        let body = "\
바깥 #진짜태그 [[진짜링크]]

```rust
// #가짜태그 [[가짜링크]]
let x = 1;
```

인라인 `#인라인가짜 [[인라인가짜링크]]` 뒤

~~~
#물결가짜 [[물결가짜]]
~~~
";
        assert_eq!(extract_tags(body), vec!["진짜태그"]);
        assert_eq!(extract_links(body), vec!["진짜링크"]);
    }

    /// 4칸 들여쓰기 코드블록 내부의 `#태그`·`[[링크]]`도 추출되지 않는다.
    /// (프론트 `src/lib/markdown.ts`의 `maskIndentedCode`와 같은 규칙)
    #[test]
    fn indented_code_block_content_is_excluded() {
        let body = "\
일반 문단

    #태그 [[링크]]
";
        assert!(extract_tags(body).is_empty());
        assert!(extract_links(body).is_empty());

        // 탭 1개도 들여쓰기 코드블록이다
        assert!(extract_tags("문단\n\n\t#탭가짜").is_empty());

        // 빈 줄로 끊기지 않고, 들여쓰지 않은 줄에서 닫힌다
        let body = "\
문단

    #코드안1

    #코드안2
바깥 #진짜
";
        assert_eq!(extract_tags(body), vec!["진짜"]);

        // 문서 맨 처음의 들여쓰기도 블록을 연다
        assert!(extract_tags("    #문서시작코드").is_empty());
    }

    /// 문단 연속줄의 들여쓰기는 코드가 아니다 — 앞줄이 비어 있지 않으면 블록이 열리지 않는다.
    #[test]
    fn indented_continuation_line_is_not_code() {
        let body = "\
문단 첫 줄
    이어지는 줄 #진짜태그 [[진짜링크]]
";
        assert_eq!(extract_tags(body), vec!["진짜태그"]);
        assert_eq!(extract_links(body), vec!["진짜링크"]);

        // 리스트 하위 항목도 마찬가지 (앞줄이 비어 있지 않다)
        assert_eq!(extract_tags("- 상위\n    - 하위 #하위태그"), vec!["하위태그"]);

        // 3칸은 들여쓰기 코드가 아니다
        assert_eq!(extract_tags("문단\n\n   #세칸태그"), vec!["세칸태그"]);
    }

    /// 통합 게이트 #3 — 탭으로 들여쓴 펜스는 펜스가 아니다.
    ///
    /// `fence_info`가 `trim_start()`로 들여쓰기를 재던 시절엔 탭 1개가 "1칸"으로 계산돼
    /// 펜스로 인정됐다. 프론트 `FENCE_OPEN_RE`(`^ {0,3}`)는 스페이스만 허용하므로
    /// CommonMark 기준으로 **프론트가 옳다.** 아래 3개는 검증자가 실측한 불일치 입력이다.
    #[test]
    fn tab_indented_fence_is_not_a_fence() {
        // ① 여는 펜스가 탭 들여쓰기 → 코드블록이 열리지 않는다
        assert_eq!(extract_tags("\t```\n#진짜태그"), vec!["진짜태그"]);

        // ② 닫는 펜스가 탭 들여쓰기 → 블록이 닫히지 않고 끝까지 코드다
        assert!(extract_tags("```\n#코드안\n\t```\n#바깥태그").is_empty());

        // ③ 물결 펜스도 같다
        assert_eq!(extract_tags("\t~~~\n#태그티엘"), vec!["태그티엘"]);

        // 스페이스 3칸까지는 펜스다 / 4칸은 들여쓰기 코드블록이라 펜스가 아니다
        assert!(extract_tags("   ```\n#코드안\n   ```").is_empty());
        assert_eq!(extract_tags("    ```\n#진짜태그2"), vec!["진짜태그2"]);
    }

    /// ATX 제목도 같은 들여쓰기 규칙을 쓴다 (프론트 `ATX_LINE_RE`).
    #[test]
    fn tab_indented_heading_is_not_a_heading() {
        // 탭 들여쓰기 → 제목이 아니라 평문. 첫 비어있지 않은 줄로 떨어진다
        assert_eq!(derive_title("문단\n\t# 제목처럼 보이는 줄"), "문단");
        // 스페이스 3칸까지는 제목이다
        assert_eq!(derive_title("   # 세칸 제목"), "세칸 제목");
    }

    #[test]
    fn unclosed_backtick_is_literal_text() {
        // 닫히지 않은 백틱은 코드가 아니다 — 뒤의 태그가 살아 있어야 한다
        assert_eq!(extract_tags("` 안 닫힘 #살아있는태그"), vec!["살아있는태그"]);
    }

    #[test]
    fn tag_edge_cases() {
        assert!(extract_tags("색상#1 와 #2").is_empty()); // 숫자만 / 글자 뒤
        assert_eq!(extract_tags("(#괄호안) #중복 #중복"), vec!["괄호안", "중복"]);
    }

    #[test]
    fn link_alias_and_dedup() {
        assert_eq!(
            extract_links("[[대상|별칭]] 그리고 [[대상]] 또 [[다른 것]]"),
            vec!["대상", "다른 것"]
        );
        assert!(extract_links("[[ ]] [[미완성").is_empty());
    }

    // ── save_note 트랜잭션 ──────────────────────────────────

    /// DoD — save_note가 한 트랜잭션에서 title/tags/links/updated_at을 전부 갱신한다
    #[test]
    fn save_note_derives_everything() {
        let mut conn = open_memory().unwrap();
        let note = create_note_in(&conn, Some(2)).unwrap();
        assert_eq!(note.title, UNTITLED);

        let body = "# 스프린트 24\n\n- [ ] 할 일 [[릴리스 절차]]\n\n#릴리스 #win32";
        let r = save_note_in(&mut conn, &note.id, body).unwrap();

        assert_eq!(r.title, "스프린트 24");
        assert_eq!(r.tags, vec!["릴리스", "win32"]);
        assert_eq!(r.links, vec!["릴리스 절차"]);
        assert!(r.updated_at >= note.updated_at);

        let stored = get_note_in(&conn, &note.id).unwrap().unwrap();
        assert_eq!(stored.body, body, "본문은 마크다운 원문 그대로여야 한다");
        assert_eq!(stored.title, "스프린트 24");
        assert_eq!(stored.updated_at, r.updated_at);

        let tags: Vec<String> = conn
            .prepare("SELECT tag FROM tags WHERE note_id = ?1 ORDER BY rowid")
            .unwrap()
            .query_map(params![note.id], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(tags, vec!["릴리스", "win32"]);

        let links: Vec<String> = conn
            .prepare("SELECT target FROM links WHERE note_id = ?1")
            .unwrap()
            .query_map(params![note.id], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(links, vec!["릴리스 절차"]);
    }

    #[test]
    fn save_note_replaces_previous_tags_and_links() {
        let mut conn = open_memory().unwrap();
        let id = seed(&mut conn, "#옛태그 [[옛링크]]");
        let r = save_note_in(&mut conn, &id, "#새태그 [[새링크]]").unwrap();
        assert_eq!(r.tags, vec!["새태그"]);

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags WHERE note_id = ?1", params![id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(n, 1);
        let t: String = conn
            .query_row("SELECT tag FROM tags WHERE note_id = ?1", params![id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(t, "새태그");
        let l: String = conn
            .query_row(
                "SELECT target FROM links WHERE note_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(l, "새링크");
    }

    /// 없는 메모 저장은 실패하고, 실패한 트랜잭션은 tags를 건드리지 않는다
    #[test]
    fn save_note_rolls_back_on_missing_note() {
        let mut conn = open_memory().unwrap();
        let id = seed(&mut conn, "#유지태그");
        assert!(save_note_in(&mut conn, "없는-id", "#다른태그").is_err());

        let tags: Vec<String> = conn
            .prepare("SELECT tag FROM tags")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(tags, vec!["유지태그"]);
        assert!(get_note_in(&conn, &id).unwrap().is_some());
    }

    // ── 메타 / 삭제 / 목록 ──────────────────────────────────

    #[test]
    fn set_meta_updates_only_given_fields() {
        let conn = open_memory().unwrap();
        let note = create_note_in(&conn, None).unwrap();
        let updated = set_note_meta_in(
            &conn,
            &note.id,
            &NoteMeta {
                color: Some(3),
                opacity: Some(200), // 클램프되어야 한다
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(updated.color, 3);
        assert_eq!(updated.opacity, OPACITY_MAX);
        assert_eq!(updated.pinned, note.pinned);
        assert_eq!(updated.open, note.open);
    }

    #[test]
    fn soft_delete_hides_from_list_but_keeps_row() {
        let mut conn = open_memory().unwrap();
        let id = seed(&mut conn, "# 지울 메모");
        soft_delete_note_in(&conn, &id).unwrap();

        assert!(list_notes_in(&conn, false).unwrap().is_empty());
        assert_eq!(list_notes_in(&conn, true).unwrap().len(), 1);

        let n = get_note_in(&conn, &id).unwrap().unwrap();
        assert!(n.deleted_at.is_some());
        assert!(!n.open);
        // 멱등
        soft_delete_note_in(&conn, &id).unwrap();
    }

    #[test]
    fn list_returns_tags_and_preview() {
        let mut conn = open_memory().unwrap();
        seed(&mut conn, "# 오늘\n- 디자인 리뷰 11:00\n- 전기요금 자동이체\n\n#일간");
        let rows = list_notes_in(&conn, false).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "오늘");
        assert_eq!(rows[0].tags, vec!["일간"]);
        assert_eq!(rows[0].preview, "디자인 리뷰 11:00 · 전기요금 자동이체 · #일간");
    }

    #[test]
    fn open_ids_and_set_open() {
        let conn = open_memory().unwrap();
        let a = create_note_in(&conn, None).unwrap();
        let b = create_note_in(&conn, None).unwrap();
        set_open_in(&conn, &b.id, false).unwrap();
        let ids = open_note_ids_in(&conn).unwrap();
        assert_eq!(ids, vec![a.id]);
    }

    // ── 검색 3모드 ──────────────────────────────────────────

    fn search(conn: &Connection, mode: SearchMode, term: &str) -> Vec<String> {
        search_notes_in(
            conn,
            &SearchQuery {
                mode,
                term: term.to_string(),
                colors: vec![],
            },
        )
        .unwrap()
        .into_iter()
        .map(|s| s.title)
        .collect()
    }

    #[test]
    fn search_three_modes() {
        let mut conn = open_memory().unwrap();
        seed(&mut conn, "# 스프린트24\n본문에 릴리스 이야기\n#릴리스 #win32");
        seed(&mut conn, "# 릴리스 절차\n순서대로 진행\n#문서");
        seed(&mut conn, "# 읽을거리\n[[릴리스 절차]] 참고\n#링크모음");

        // 1) 텍스트 — 한국어 어절 내부 부분 일치가 되어야 한다 (FTS5로는 안 된다)
        let hits = search(&conn, SearchMode::Text, "프린트");
        assert_eq!(hits, vec!["스프린트24"]);

        // 본문도 검색 대상
        assert_eq!(search(&conn, SearchMode::Text, "순서대로"), vec!["릴리스 절차"]);

        // 2) 태그
        let hits = search(&conn, SearchMode::Tag, "릴리스");
        assert_eq!(hits, vec!["스프린트24"]);
        assert_eq!(search(&conn, SearchMode::Tag, "없는태그").len(), 0);

        // 3) 백링크 — "릴리스 절차"를 가리키는 메모
        let hits = search(&conn, SearchMode::Backlink, "릴리스 절차");
        assert_eq!(hits, vec!["읽을거리"]);
    }

    #[test]
    fn search_empty_term_returns_all_and_colors_filter() {
        let mut conn = open_memory().unwrap();
        let a = create_note_in(&conn, Some(0)).unwrap();
        save_note_in(&mut conn, &a.id, "# 노랑").unwrap();
        let b = create_note_in(&conn, Some(3)).unwrap();
        save_note_in(&mut conn, &b.id, "# 초록").unwrap();

        assert_eq!(search(&conn, SearchMode::Text, "   ").len(), 2);

        let only_green = search_notes_in(
            &conn,
            &SearchQuery {
                mode: SearchMode::Text,
                term: String::new(),
                colors: vec![3],
            },
        )
        .unwrap();
        assert_eq!(only_green.len(), 1);
        assert_eq!(only_green[0].title, "초록");
    }

    #[test]
    fn search_excludes_deleted() {
        let mut conn = open_memory().unwrap();
        let id = seed(&mut conn, "# 지운 것\n비밀");
        seed(&mut conn, "# 살아있는 것\n100% 완료");
        soft_delete_note_in(&conn, &id).unwrap();

        assert!(search(&conn, SearchMode::Text, "비밀").is_empty());
        assert_eq!(search(&conn, SearchMode::Text, "완료"), vec!["살아있는 것"]);
    }

    /// `like_pattern`의 와일드카드 이스케이프 증명.
    ///
    /// `%` `_` `\`는 LIKE 메타문자가 **아니라 글자**로 취급되어야 한다.
    /// 이스케이프가 없으면 아래 단언들은 전부 깨진다 —
    /// `%`는 "무엇이든", `_`는 "아무 한 글자"가 되어 엉뚱한 메모가 잡힌다.
    #[test]
    fn search_escapes_like_wildcards() {
        let mut conn = open_memory().unwrap();
        seed(&mut conn, "# 퍼센트\n진행률 50% 달성");
        seed(&mut conn, "# 언더바\n식별자 a_c 규칙");
        seed(&mut conn, "# 세글자\nabc 라고 쓴다");
        seed(&mut conn, "# 역슬래시\n경로 C:\\temp 참고");
        seed(&mut conn, "# 평범\n기호 없는 본문");

        // 기준선 — 필터가 없으면 5건 전부
        assert_eq!(search(&conn, SearchMode::Text, "").len(), 5);

        // `%` — 이스케이프가 없으면 `%%%`가 되어 5건 전부 잡힌다
        assert_eq!(search(&conn, SearchMode::Text, "%"), vec!["퍼센트"]);
        assert_eq!(search(&conn, SearchMode::Text, "50%"), vec!["퍼센트"]);
        // 글자 사이의 `%`도 "무엇이든"이 아니다 — 이스케이프가 없으면 퍼센트가 잡힌다
        assert_eq!(search(&conn, SearchMode::Text, "진행%달성").len(), 0);
        assert_eq!(search(&conn, SearchMode::Text, "없는말%").len(), 0);

        // `_` — 이스케이프가 없으면 `a_c`가 `abc`도 잡는다
        assert_eq!(search(&conn, SearchMode::Text, "a_c"), vec!["언더바"]);
        assert_eq!(search(&conn, SearchMode::Text, "abc"), vec!["세글자"]);
        // `_` 하나만 검색 — 이스케이프가 없으면 "한 글자 이상"이라 5건 전부 잡힌다
        assert_eq!(search(&conn, SearchMode::Text, "_"), vec!["언더바"]);

        // 이스케이프 문자 `\` 자체도 글자로 찾을 수 있어야 한다
        assert_eq!(search(&conn, SearchMode::Text, "\\"), vec!["역슬래시"]);
        assert_eq!(search(&conn, SearchMode::Text, "C:\\temp"), vec!["역슬래시"]);
        // `\` 다음 글자가 먹히지 않는다 (`\t`가 `t`로 붕괴하면 `C:temp`가 되어 0건)
        assert_eq!(search(&conn, SearchMode::Text, "C:\\t").len(), 1);
    }

    #[test]
    fn search_does_not_duplicate_rows_on_join() {
        let mut conn = open_memory().unwrap();
        seed(&mut conn, "# 다중 태그\n#릴리스a #릴리스b #릴리스c");
        assert_eq!(search(&conn, SearchMode::Tag, "릴리스").len(), 1);
    }
}
