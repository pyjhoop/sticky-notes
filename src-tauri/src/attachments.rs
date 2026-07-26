//! 이미지 첨부 저장 (M7).
//!
//! plan.md M7:
//!   붙여넣기 → 이미지 바이트를 `%APPDATA%\com.sticky-notes.app\attachments\<uuid>.png` 에 저장
//!   → 본문에 `![](attachments/x.png)` 삽입 → `convertFileSrc()` 로 인라인 위젯 렌더.
//!
//! ## 경로 탈출 방어
//!
//! 프론트가 넘기는 값은 **확장자 힌트 하나뿐**이고, 그마저도
//! [`normalize_extension`] 의 화이트리스트를 통과해야 한다.
//! 파일명은 언제나 서버가 만든 uuid 이므로 프론트 문자열이 경로에 섞이지 않는다.
//!
//! 바이트는 JSON 배열이 아니라 **raw IPC 바디**로 받는다.
//! 스크린샷 한 장이 수 MB 라 숫자 배열로 직렬화하면 붙여넣기마다 눈에 띄게 멈춘다.

use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Runtime};

use crate::CmdResult;

/// 저장을 허용하는 확장자. 여기에 없으면 파일을 만들지 않는다.
///
/// SVG 는 스크립트를 품을 수 있어 제외한다 — 웹뷰가 직접 렌더하는 경로다.
pub const ALLOWED_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

/// 첨부 하나의 상한. 클립보드 이미지가 이보다 크면 붙여넣기를 거부한다.
pub const MAX_ATTACHMENT_BYTES: usize = 32 * 1024 * 1024;

/// 확장자 힌트를 실은 IPC 헤더 이름.
pub const EXT_HEADER: &str = "x-attachment-ext";

/// 마크다운에 들어가는 상대 경로의 접두사. 구분자는 `/` 로 고정한다
/// (마크다운 원문이 옵시디언·깃허브에서도 그대로 열려야 한다).
pub const ATTACHMENT_PREFIX: &str = "attachments/";

/// `"image/png"` · `".PNG"` · `"png"` → `Some("png")`. 화이트리스트 밖이면 `None`.
///
/// `/` 가 있으면 **`image/…` 형태만** 인정한다. `"attachments/../png"` 처럼
/// 경로처럼 생긴 입력은 앞 조각이 `image` 가 아니므로 여기서 걸린다.
pub fn normalize_extension(raw: &str) -> Option<&'static str> {
    let lowered = raw.trim().to_ascii_lowercase();
    let tail = match lowered.split_once('/') {
        Some(("image", rest)) => rest,
        Some(_) => return None,
        None => lowered.as_str(),
    };
    let candidate = tail.trim_start_matches('.');
    ALLOWED_EXTENSIONS
        .iter()
        .copied()
        .find(|allowed| *allowed == candidate)
}

/// 바이트를 `dir` 에 uuid 파일명으로 쓰고 마크다운용 상대 경로를 돌려준다.
///
/// 커맨드가 아니라 여기를 테스트한다 — `AppHandle` 없이 돌아간다.
pub fn save_attachment_in(dir: &Path, bytes: &[u8], ext_hint: &str) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("빈 이미지입니다".into());
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "이미지가 너무 큽니다 — {}MB 까지만 첨부할 수 있습니다",
            MAX_ATTACHMENT_BYTES / (1024 * 1024)
        ));
    }
    let ext = normalize_extension(ext_hint).ok_or_else(|| {
        format!(
            "지원하지 않는 이미지 형식입니다: {ext_hint} (허용: {})",
            ALLOWED_EXTENSIONS.join(", ")
        )
    })?;

    std::fs::create_dir_all(dir)
        .map_err(|e| format!("첨부 폴더를 만들 수 없습니다({}): {e}", dir.display()))?;

    // 파일명은 전적으로 서버가 만든다 — 프론트 문자열이 경로에 섞이지 않는다.
    let name = format!("{}.{ext}", uuid::Uuid::now_v7().simple());
    let path: PathBuf = dir.join(&name);
    std::fs::write(&path, bytes).map_err(|e| format!("첨부 저장 실패: {e}"))?;

    Ok(format!("{ATTACHMENT_PREFIX}{name}"))
}

/// 붙여넣은 이미지를 저장하고 `attachments/<uuid>.<ext>` 를 돌려준다.
///
/// 프론트는 `invoke('save_attachment', bytes, { headers: { 'x-attachment-ext': … } })`
/// 형태로 부른다 (`src/lib/ipc.ts`).
#[tauri::command]
pub fn save_attachment<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> CmdResult<String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("이미지 바이트를 받지 못했습니다".into());
    };
    let ext_hint = request
        .headers()
        .get(EXT_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();

    let dir = crate::db::attachments_dir(&app)?;
    save_attachment_in(&dir, bytes, ext_hint)
}

/// 첨부 폴더의 절대 경로. 프론트가 `convertFileSrc()` 에 넘길 경로를 만드는 데 쓴다.
#[tauri::command]
pub fn get_attachments_dir<R: Runtime>(app: AppHandle<R>) -> CmdResult<String> {
    crate::db::attachments_dir(&app).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("sticky-attach-{tag}-{}", uuid::Uuid::now_v7().simple()))
    }

    #[test]
    fn normalize_accepts_whitelisted_extensions_and_mime_types() {
        for ext in ALLOWED_EXTENSIONS {
            assert_eq!(normalize_extension(ext), Some(ext), "{ext}");
            assert_eq!(normalize_extension(&format!("image/{ext}")), Some(ext));
            assert_eq!(normalize_extension(&format!(".{}", ext.to_uppercase())), Some(ext));
        }
        assert_eq!(normalize_extension("  IMAGE/PNG  "), Some("png"));
    }

    #[test]
    fn normalize_rejects_everything_else() {
        for bad in [
            "",
            "svg",
            "image/svg+xml",
            "exe",
            "image/bmp",
            "php",
            "png.exe",
            "p n g",
        ] {
            assert_eq!(normalize_extension(bad), None, "{bad} 는 거부되어야 한다");
        }
    }

    /// 경로 탈출 시도는 화이트리스트에서 전부 걸린다.
    #[test]
    fn normalize_rejects_path_traversal() {
        for evil in [
            "../../evil",
            "../../evil.png",
            "..\\..\\evil.png",
            "/etc/passwd",
            "png/../../evil",
            "C:\\Windows\\System32\\png",
            "attachments/../../png",
            "attachments/x.png",
            "image/../png",
        ] {
            assert_eq!(normalize_extension(evil), None, "{evil} 는 거부되어야 한다");
        }
    }

    #[test]
    fn saves_with_server_generated_uuid_name() {
        let dir = temp_dir("save");
        let rel = save_attachment_in(&dir, b"\x89PNG\r\n\x1a\n", "image/png").unwrap();

        assert!(rel.starts_with(ATTACHMENT_PREFIX), "{rel}");
        assert!(rel.ends_with(".png"), "{rel}");

        let name = rel.trim_start_matches(ATTACHMENT_PREFIX);
        assert!(
            !name.contains('/') && !name.contains('\\') && !name.contains(".."),
            "파일명에 경로 조각이 섞였다: {name}"
        );
        assert_eq!(
            std::fs::read(dir.join(name)).unwrap(),
            b"\x89PNG\r\n\x1a\n",
            "바이트가 그대로 저장되어야 한다"
        );

        // 같은 바이트를 두 번 넣어도 파일명이 겹치지 않는다
        let rel2 = save_attachment_in(&dir, b"\x89PNG\r\n\x1a\n", "png").unwrap();
        assert_ne!(rel, rel2);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_disallowed_extension_without_writing() {
        let dir = temp_dir("reject");
        let err = save_attachment_in(&dir, b"<svg/>", "image/svg+xml").unwrap_err();
        assert!(err.contains("지원하지 않는"), "{err}");
        assert!(
            !dir.exists() || std::fs::read_dir(&dir).unwrap().count() == 0,
            "거부된 첨부가 파일로 남았다"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_empty_and_oversized_payloads() {
        let dir = temp_dir("size");
        assert!(save_attachment_in(&dir, b"", "png")
            .unwrap_err()
            .contains("빈 이미지"));

        let huge = vec![0u8; MAX_ATTACHMENT_BYTES + 1];
        assert!(save_attachment_in(&dir, &huge, "png")
            .unwrap_err()
            .contains("너무 큽니다"));

        assert!(
            !dir.exists() || std::fs::read_dir(&dir).unwrap().count() == 0,
            "거부된 첨부가 파일로 남았다"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 마크다운에 들어가는 구분자는 플랫폼과 무관하게 `/` 다.
    #[test]
    fn relative_path_uses_forward_slash() {
        let dir = temp_dir("slash");
        let rel = save_attachment_in(&dir, b"gif", "gif").unwrap();
        assert!(!rel.contains('\\'), "{rel}");
        assert_eq!(rel.matches('/').count(), 1, "{rel}");
        std::fs::remove_dir_all(&dir).ok();
    }
}
