//! Win32 / DWM 연동.
//!
//! - `get_work_areas` — 작업표시줄을 제외한 모니터 영역 (Tauri `Monitor`는 전체 경계만 준다)
//! - `disable_dwm_rounding` — 스파이크 2. 라운드는 CSS `border-radius`로 그리므로 DWM 라운딩을 끈다
//! - `set_window_opacity` — 스파이크 1이 실패했을 때의 네이티브 폴백
//! - `apply_backdrop` — 보드/설정의 mica → acrylic → 불투명 폴백
//!
//! **소유: 트랙 A.**

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::CmdResult;

#[cfg(target_os = "windows")]
use ::windows::Win32::Foundation::{COLORREF, HWND, LPARAM, RECT, TRUE};
#[cfg(target_os = "windows")]
use ::windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DEFAULT, DWMWCP_DONOTROUND,
    DWM_WINDOW_CORNER_PREFERENCE,
};
#[cfg(target_os = "windows")]
use ::windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};

/// `MONITORINFOF_PRIMARY` — windows 크레이트가 노출하지 않아 직접 정의한다 (winuser.h).
#[cfg(target_os = "windows")]
const MONITORINFOF_PRIMARY: u32 = 0x0000_0001;
#[cfg(target_os = "windows")]
use ::windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
#[cfg(target_os = "windows")]
use ::windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE, LWA_ALPHA,
    WS_EX_LAYERED,
};

/// 작업표시줄을 제외한 모니터 영역. 좌표는 **물리 px**, `scale`은 배율.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkArea {
    /// 디바이스명 (`\\.\DISPLAY1`) — `note_geometry.monitor`에 그대로 저장한다
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale: f64,
    pub is_primary: bool,
}

// ─────────────────────────────────────────────────────────────
// HWND 헬퍼 — tauri가 쓰는 windows 크레이트 버전과 무관하게 변환한다
// ─────────────────────────────────────────────────────────────

/// tauri가 의존하는 `windows` 크레이트 버전이 우리 것과 달라질 수 있으므로
/// 포인터로 한 번 내렸다 올린다. 같은 버전이면 캐스트가 no-op이라 clippy가 경고한다.
#[cfg(target_os = "windows")]
#[allow(clippy::unnecessary_cast)]
fn hwnd_of<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Result<HWND, String> {
    let raw = window
        .hwnd()
        .map_err(|e| format!("HWND를 얻을 수 없습니다: {e}"))?;
    Ok(HWND(raw.0 as *mut core::ffi::c_void))
}

// ─────────────────────────────────────────────────────────────
// 스파이크 2 — 라운드 코너
// ─────────────────────────────────────────────────────────────

/// DWM 라운딩을 끈다.
///
/// Windows 11은 프레임리스 창에도 기본 라운드를 먹이는데, 투명 창에서는
/// 그 코너 바깥에 검은 잔상이 남는다. CSS `border-radius: 10px`로 직접 그리므로
/// **메모 창 생성 직후 반드시 호출한다.**
pub fn disable_dwm_rounding<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "windows")]
    {
        if let Err(e) = set_corner_preference(window, DWMWCP_DONOTROUND) {
            eprintln!("[win] DWMWA_WINDOW_CORNER_PREFERENCE 설정 실패: {e}");
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = window;
}

#[cfg(target_os = "windows")]
fn set_corner_preference<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    pref: DWM_WINDOW_CORNER_PREFERENCE,
) -> Result<(), String> {
    let hwnd = hwnd_of(window)?;
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &pref as *const _ as *const core::ffi::c_void,
            core::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        )
    }
    .map_err(|e| format!("DwmSetWindowAttribute 실패: {e}"))
}

/// `rounded = false` → `DWMWCP_DONOTROUND`
#[cfg(target_os = "windows")]
#[tauri::command]
pub fn set_window_corner_preference<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    rounded: bool,
) -> CmdResult<()> {
    let pref = if rounded {
        DWMWCP_DEFAULT
    } else {
        DWMWCP_DONOTROUND
    };
    set_corner_preference(&window, pref)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn set_window_corner_preference<R: Runtime>(
    _window: tauri::WebviewWindow<R>,
    _rounded: bool,
) -> CmdResult<()> {
    Ok(())
}

// ─────────────────────────────────────────────────────────────
// 스파이크 1 폴백 — 네이티브 투명도
// ─────────────────────────────────────────────────────────────

/// **폴백 경로.** 기본은 종이 루트 엘리먼트의 CSS `opacity`다.
/// 스파이크 1에서 WebView2 합성 아티팩트가 확인된 경우에만 쓴다.
///
/// `alpha`는 0.0..=1.0.
#[tauri::command]
pub fn set_window_opacity<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    alpha: f64,
) -> CmdResult<()> {
    #[cfg(target_os = "windows")]
    {
        let a = alpha.clamp(0.0, 1.0);
        let hwnd = hwnd_of(&window)?;
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED.0 as isize);
            SetLayeredWindowAttributes(hwnd, COLORREF(0), (a * 255.0).round() as u8, LWA_ALPHA)
                .map_err(|e| format!("SetLayeredWindowAttributes 실패: {e}"))?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, alpha);
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────
// 보드 · 설정 배경 — mica → acrylic → 불투명
// ─────────────────────────────────────────────────────────────

/// 적용된 효과 이름을 돌려준다: `"mica"` · `"acrylic"` · `"opaque"`.
/// 리사이즈 중 검은 플래시가 보이면 폴백 단계를 낮춘다.
pub fn apply_backdrop<R: Runtime>(window: &tauri::WebviewWindow<R>) -> String {
    #[cfg(target_os = "windows")]
    {
        if window_vibrancy::apply_mica(window, Some(true)).is_ok() {
            return "mica".into();
        }
        // 디자인 다크 크롬 rgba(32,30,28,.86)
        if window_vibrancy::apply_acrylic(window, Some((32, 30, 28, 219))).is_ok() {
            return "acrylic".into();
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = window;
    "opaque".into()
}

#[tauri::command]
pub fn apply_window_backdrop<R: Runtime>(window: tauri::WebviewWindow<R>) -> CmdResult<String> {
    Ok(apply_backdrop(&window))
}

// ─────────────────────────────────────────────────────────────
// 모니터 work area
// ─────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_monitor_proc(
    hmonitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    lparam: LPARAM,
) -> ::windows::core::BOOL {
    let out = &mut *(lparam.0 as *mut Vec<WorkArea>);

    let mut info = MONITORINFOEXW {
        monitorInfo: MONITORINFO {
            cbSize: core::mem::size_of::<MONITORINFOEXW>() as u32,
            ..Default::default()
        },
        ..Default::default()
    };

    if GetMonitorInfoW(hmonitor, &mut info as *mut _ as *mut MONITORINFO).as_bool() {
        let work = info.monitorInfo.rcWork;
        let name = String::from_utf16_lossy(&info.szDevice)
            .trim_end_matches('\0')
            .to_string();

        let mut dpi_x: u32 = 96;
        let mut dpi_y: u32 = 96;
        let _ = GetDpiForMonitor(hmonitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);

        out.push(WorkArea {
            name,
            x: work.left,
            y: work.top,
            width: work.right - work.left,
            height: work.bottom - work.top,
            scale: dpi_x as f64 / 96.0,
            is_primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
        });
    }

    TRUE
}

/// 작업표시줄을 제외한 모니터별 영역. 지오메트리 저장/복원의 기준점이다.
#[tauri::command]
pub fn get_work_areas() -> CmdResult<Vec<WorkArea>> {
    #[cfg(target_os = "windows")]
    {
        let mut out: Vec<WorkArea> = Vec::new();
        unsafe {
            let _ = EnumDisplayMonitors(
                None,
                None,
                Some(enum_monitor_proc),
                LPARAM(&mut out as *mut _ as isize),
            );
        }
        if out.is_empty() {
            return Err("모니터 정보를 얻지 못했습니다".into());
        }
        Ok(out)
    }
    #[cfg(not(target_os = "windows"))]
    Err("Windows 전용 커맨드입니다".into())
}

/// 컨트롤 바가 최소 `min_visible`px 만큼 화면 안에 남도록 클램프한다.
/// 보조 모니터가 사라진 뒤 복원할 때 창이 화면 밖에 갇히는 것을 막는다.
pub fn clamp_into(area: &WorkArea, x: f64, y: f64, w: f64, h: f64, min_visible: f64) -> (f64, f64) {
    let ax = area.x as f64;
    let ay = area.y as f64;
    let aw = area.width as f64;
    let ah = area.height as f64;

    let min_x = ax - (w - min_visible).max(0.0);
    let max_x = ax + aw - min_visible;
    let min_y = ay;
    let max_y = ay + ah - min_visible.min(h);

    (x.clamp(min_x, max_x), y.clamp(min_y, max_y))
}

/// 앱 전역에서 한 번 쓰는 편의 함수 — label로 창을 찾아 라운딩을 끈다.
pub fn disable_rounding_by_label<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        disable_dwm_rounding(&w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area() -> WorkArea {
        WorkArea {
            name: "\\\\.\\DISPLAY1".into(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
            scale: 1.0,
            is_primary: true,
        }
    }

    #[test]
    fn clamp_keeps_window_reachable() {
        let a = area();
        // 화면 오른쪽 한참 밖 → 최소 80px은 남아야 한다
        let (x, _) = clamp_into(&a, 5000.0, 100.0, 484.0, 400.0, 80.0);
        assert!(x <= 1920.0 - 80.0);
        // 화면 위쪽 밖 → work area 상단으로
        let (_, y) = clamp_into(&a, 100.0, -900.0, 484.0, 400.0, 80.0);
        assert_eq!(y, 0.0);
    }

    #[test]
    fn clamp_keeps_inbounds_window_untouched() {
        let a = area();
        let (x, y) = clamp_into(&a, 300.0, 200.0, 484.0, 400.0, 80.0);
        assert_eq!((x, y), (300.0, 200.0));
    }
}
