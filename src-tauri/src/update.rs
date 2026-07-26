//! 자동 업데이트 — GitHub 릴리스의 `latest.json` 을 보고 새 버전을 받아 설치한다.
//!
//! 2026-07-26 사용자 요청 #4 — "릴리즈 버전 비교해서 자동 업데이트 되도록".
//!
//! ## 흐름
//!
//! ```text
//! 앱 시작 → bootstrap()  ── 백그라운드로 check ──┐
//!                                               ├→ 새 버전 있으면
//! 설정 창 "지금 확인" → check_update()  ─────────┘   UpdateState 에 담고
//!                                                   sticky://update-available 브로드캐스트
//!                                                        ↓
//!                                    메모 창 배너 / 설정 창 UPDATE 섹션
//!                                                        ↓
//!                                           install_update() → 다운로드 → 설치 → 재시작
//! ```
//!
//! ## 왜 프론트가 아니라 여기서 도는가
//!
//! `tauri.conf.json` 의 CSP 는 `connect-src 'self' ipc:` 라 웹뷰가 GitHub 에 직접
//! 요청할 수 없다(그리고 그래야 한다 — 데스크톱 앱이 임의 호스트를 부르지 않는 편이 낫다).
//! 업데이트 확인·다운로드는 전부 Rust 쪽 `tauri-plugin-updater` 가 하고, 프론트는
//! 결과만 받는다. 덕분에 웹뷰에 updater 권한을 열어 줄 필요도 없다.
//!
//! ## 서명
//!
//! `latest.json` 의 `signature` 는 릴리스 CI 가 개인키로 만든다(`TAURI_SIGNING_PRIVATE_KEY`).
//! 공개키는 `tauri.conf.json` 의 `plugins.updater.pubkey` 에 박혀 있고, 서명이 맞지
//! 않으면 플러그인이 설치를 거부한다. 즉 릴리스 자산이 바꿔치기돼도 설치되지 않는다.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::UpdaterExt;

use crate::CmdResult;

/// 새 버전이 확인됐음을 모든 창에 알린다. 페이로드는 `UpdateInfo`.
pub const EVENT_UPDATE_AVAILABLE: &str = "sticky://update-available";

/// 시작 직후에 바로 때리면 창 3종이 뜨는 구간과 겹친다. 조금 늦춘다.
const BOOTSTRAP_DELAY_MS: u64 = 4_000;

/// 설치 직전에 열린 메모 창의 저장을 기다리는 시간. `tray::QUIT_GRACE_MS` 와 같은 이유다.
const SAVE_GRACE_MS: u64 = 400;

/// 화면에 보여 줄 업데이트 정보. `src/lib/ipc.ts` 의 `UpdateInfo` 와 1:1.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// 새 버전 (`1.0.42`)
    pub version: String,
    /// 지금 설치돼 있는 버전
    pub current_version: String,
    /// 릴리스 노트. 없을 수 있다
    pub notes: Option<String>,
    /// 릴리스 시각 (RFC3339). 없을 수 있다
    pub date: Option<String>,
}

/// 마지막으로 확인된 "설치 가능한 업데이트".
///
/// 창은 언제든 새로 열린다(메모 창은 닫으면 destroy 다). 시작 시 한 번 확인한 결과를
/// 여기 담아 두면 나중에 열린 창도 `get_pending_update` 로 같은 배너를 띄울 수 있다.
#[derive(Default)]
pub struct UpdateState(pub Mutex<Option<UpdateInfo>>);

fn store<R: Runtime>(app: &AppHandle<R>, info: Option<UpdateInfo>) {
    match app.state::<UpdateState>().0.lock() {
        Ok(mut guard) => *guard = info,
        Err(e) => eprintln!("[update] 상태 잠금 실패: {e}"),
    }
}

/// 현재 설치된 앱 버전. 설정 창이 그대로 보여 준다.
#[tauri::command]
pub fn get_app_version<R: Runtime>(app: AppHandle<R>) -> String {
    app.package_info().version.to_string()
}

/// 시작 시 확인해 둔 결과. 나중에 열린 창이 배너를 띄우는 데 쓴다.
#[tauri::command]
pub fn get_pending_update(state: tauri::State<'_, UpdateState>) -> CmdResult<Option<UpdateInfo>> {
    state
        .0
        .lock()
        .map(|g| g.clone())
        .map_err(|e| format!("업데이트 상태를 읽지 못했습니다: {e}"))
}

/// 엔드포인트를 지금 확인한다. 새 버전이 없으면 `None`.
///
/// 네트워크 실패는 **삼키지 않는다** — 설정 창이 사유를 그대로 보여 준다.
/// "확인했는데 아무 일도 없음"과 "확인 자체가 실패"는 사용자에게 다른 사건이다.
#[tauri::command]
pub async fn check_update<R: Runtime>(app: AppHandle<R>) -> CmdResult<Option<UpdateInfo>> {
    let info = fetch(&app).await?;
    store(&app, info.clone());
    Ok(info)
}

/// 새 버전을 내려받아 설치하고 앱을 재시작한다.
///
/// 설치 직전에 열린 메모 창에 저장을 요청한다 — 인스톨러가 프로세스를 끝내므로
/// 디바운스 대기 중이던 마지막 편집이 그대로 날아갈 수 있다.
#[tauri::command]
pub async fn install_update<R: Runtime>(app: AppHandle<R>) -> CmdResult<()> {
    let updater = app
        .updater()
        .map_err(|e| format!("업데이터를 초기화하지 못했습니다: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("업데이트를 확인하지 못했습니다: {e}"))?
        .ok_or_else(|| "설치할 새 버전이 없습니다".to_string())?;

    let _ = app.emit(crate::windows::EVENT_SAVE_ALL, ());
    tokio_sleep(SAVE_GRACE_MS).await;

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| format!("업데이트 설치에 실패했습니다: {e}"))?;

    store(&app, None);
    app.restart();
}

/// 앱 setup에서 1회. 백그라운드로 한 번 확인하고, 있으면 브로드캐스트한다.
///
/// **실패해도 앱 기동을 막지 않는다.** 오프라인에서 메모 앱이 안 뜨면 안 된다.
pub fn bootstrap<R: Runtime>(app: &tauri::App<R>) {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio_sleep(BOOTSTRAP_DELAY_MS).await;
        match fetch(&handle).await {
            Ok(Some(info)) => {
                println!("[update] 새 버전 {} 확인", info.version);
                store(&handle, Some(info.clone()));
                if let Err(e) = handle.emit(EVENT_UPDATE_AVAILABLE, info) {
                    eprintln!("[update] update-available 전파 실패: {e}");
                }
            }
            Ok(None) => {}
            // 시작 시 확인 실패는 배너로 띄우지 않는다 — 오프라인이 정상 상태다.
            Err(e) => eprintln!("[update] 시작 시 업데이트 확인 실패: {e}"),
        }
    });
}

async fn fetch<R: Runtime>(app: &AppHandle<R>) -> Result<Option<UpdateInfo>, String> {
    let updater = app
        .updater()
        .map_err(|e| format!("업데이터를 초기화하지 못했습니다: {e}"))?;

    let found = updater
        .check()
        .await
        .map_err(|e| format!("업데이트를 확인하지 못했습니다: {e}"))?;

    Ok(found.map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    }))
}

async fn tokio_sleep(ms: u64) {
    tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
}
