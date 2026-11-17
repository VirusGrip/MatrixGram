//! Local WebView2 identity diagnostic. Never opens MatrixGram account data.
#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
fn main() {
    if let Err(error) = run() {
        // No chat, account or token data is present in this diagnostic.
        if let Some(base) = std::env::var_os("LOCALAPPDATA") {
            let base = std::path::PathBuf::from(base).join("MatrixGramGroupingProbe");
            let _ = std::fs::create_dir_all(&base);
            let _ = std::fs::write(base.join("error.txt"), error.to_string());
        }
        std::process::exit(1);
    }
}

#[cfg(windows)]
fn run() -> Result<(), Box<dyn std::error::Error>> {
    use std::{
        cell::Cell,
        path::PathBuf,
        rc::Rc,
        time::{Duration, Instant},
    };
    use tao::{
        event::{Event, WindowEvent},
        event_loop::{ControlFlow, EventLoop},
        platform::{run_return::EventLoopExtRunReturn, windows::WindowExtWindows},
        window::WindowBuilder,
    };
    use windows::{
        Win32::{
            Foundation::{APPMODEL_ERROR_NO_PACKAGE, ERROR_INSUFFICIENT_BUFFER, HWND},
            Storage::{
                EnhancedStorage::PKEY_AppUserModel_ID, Packaging::Appx::GetCurrentPackageFullName,
            },
            System::{
                Com::{
                    CoTaskMemFree,
                    StructuredStorage::{PROPVARIANT, PVCHF_DEFAULT, PropVariantChangeType},
                },
                Variant::VT_LPWSTR,
            },
            UI::Shell::{
                GetCurrentProcessExplicitAppUserModelID,
                PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow},
                SetCurrentProcessExplicitAppUserModelID,
            },
        },
        core::{BSTR, HSTRING, PWSTR},
    };

    fn process_id() -> Result<Option<String>, Box<dyn std::error::Error>> {
        let Ok(value) = (unsafe { GetCurrentProcessExplicitAppUserModelID() }) else {
            return Ok(None);
        };
        let result = unsafe { value.to_string() };
        unsafe { CoTaskMemFree(Some(value.0.cast())) };
        Ok(Some(result?))
    }
    fn window_id(store: &IPropertyStore) -> Result<Option<String>, windows::core::Error> {
        let value = unsafe { store.GetValue(&PKEY_AppUserModel_ID)? };
        if value.is_empty() {
            Ok(None)
        } else {
            BSTR::try_from(&value).map(|s| Some(s.to_string()))
        }
    }
    fn package_identity() -> Result<Option<String>, Box<dyn std::error::Error>> {
        let mut length = 0;
        let result = unsafe { GetCurrentPackageFullName(&mut length, None) };
        if result == APPMODEL_ERROR_NO_PACKAGE {
            return Ok(None);
        }
        if result != ERROR_INSUFFICIENT_BUFFER || length == 0 || length > 32768 {
            return Err(format!("Unexpected package identity status: {}", result.0).into());
        }
        let mut buffer = vec![0u16; length as usize];
        unsafe { GetCurrentPackageFullName(&mut length, Some(PWSTR(buffer.as_mut_ptr()))) }.ok()?;
        let end = buffer
            .iter()
            .position(|c| *c == 0)
            .ok_or("Unterminated package identity")?;
        Ok(Some(String::from_utf16(&buffer[..end])?))
    }
    struct WindowIdentity(IPropertyStore);
    impl Drop for WindowIdentity {
        fn drop(&mut self) {
            // Microsoft requires clearing window properties before HWND teardown.
            let _ = unsafe {
                self.0
                    .SetValue(&PKEY_AppUserModel_ID, &PROPVARIANT::default())
            };
        }
    }

    const ID: &str = "ru.madfrog.matrixgram.groupingprobe";
    let args: Vec<_> = std::env::args().skip(1).collect();
    let modes: Vec<_> = args
        .iter()
        .filter(|a| {
            matches!(
                a.as_str(),
                "--baseline" | "--process-id" | "--window-id" | "--native-grouping"
            )
        })
        .collect();
    if modes.len() != 1
        || args.iter().any(|a| {
            !matches!(
                a.as_str(),
                "--baseline" | "--process-id" | "--window-id" | "--native-grouping" | "--smoke"
            )
        })
    {
        return Err(
            "Choose --baseline, --process-id, --window-id OR --native-grouping; optionally --smoke"
                .into(),
        );
    }
    let mode = modes[0].trim_start_matches("--").to_owned();
    let smoke = args.iter().any(|a| a == "--smoke");
    if mode == "native-grouping" {
        if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_some() {
            return Err("Existing WebView2 environment override would invalidate this test".into());
        }
        // Diagnostic-only, undocumented runtime feature observed in 157.0.4341.46.
        // Process-local environment, set before EventLoop/threads; no registry or
        // global environment change. Never used by the MatrixGram client.
        unsafe {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--disable-features=msWindowsTaskManager",
            );
        }
    }
    let explicit = matches!(mode.as_str(), "process-id" | "window-id");
    if explicit {
        // Before EventLoop, HWND creation and WebView2 environment creation.
        unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(ID))? };
    }
    let actual_process_id = process_id()?;
    let package_identity = package_identity()?;
    if (!explicit && actual_process_id.is_some() && package_identity.is_none())
        || (explicit && actual_process_id.as_deref() != Some(ID))
    {
        return Err("Process identity verification failed".into());
    }
    let pid = std::process::id();
    let base = PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is missing")?)
        .join("MatrixGramGroupingProbe")
        .join(format!("{mode}-{pid}"));
    std::fs::create_dir_all(&base)?;
    let mut event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title(format!("MatrixGram — тест {mode}"))
        .with_visible(!smoke)
        .with_inner_size(tao::dpi::LogicalSize::new(700.0, 380.0))
        .build(&event_loop)?;
    let store: IPropertyStore = unsafe { SHGetPropertyStoreForWindow(HWND(window.hwnd() as _))? };
    let _window_identity = if mode == "window-id" {
        let mut value = PROPVARIANT::default();
        unsafe {
            PropVariantChangeType(&mut value, &PROPVARIANT::from(ID), PVCHF_DEFAULT, VT_LPWSTR)?;
            store.SetValue(&PKEY_AppUserModel_ID, &value)?;
        }
        Some(WindowIdentity(store.clone()))
    } else {
        None
    };
    let before = window_id(&store)?;
    if mode == "window-id" && before.as_deref() != Some(ID) {
        return Err("Window identity verification failed".into());
    }
    let mut context = wry::WebContext::new(Some(base.join("webview")));
    let loaded = Rc::new(Cell::new(false));
    let received = loaded.clone();
    let html = format!(
        "<!doctype html><html lang='ru'><head><meta charset='UTF-8'><title>MatrixGram тест {mode}</title><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-matrixgram-probe'\"></head><body style='background:#17212b;color:#e5eef7;font:16px Segoe UI;padding:22px'><h2>MatrixGram — проверка группировки</h2><p>Режим: {mode}; PID: {pid}</p><p>Это отдельный локальный тест. Аккаунты и чаты не открываются.</p><p>Проверьте, находятся ли основной процесс и его WebView2 в одной группе диспетчера задач при сортировке по памяти.</p><p>Этот тест не является обновлением клиента.</p><script nonce='matrixgram-probe'>window.ipc.postMessage('probe-dom-ready');</script></body></html>"
    );
    let _webview = wry::WebViewBuilder::new_with_web_context(&mut context)
        .with_html(html)
        .with_ipc_handler(move |request| {
            if request.body() == "probe-dom-ready" {
                received.set(true)
            }
        })
        .build(&window)?;
    let after = window_id(&store)?;
    let report_path = base.join("report.json");
    let report = serde_json::json!({
        "mode": mode, "pid": pid, "processAppUserModelId": actual_process_id,
        "windowAppUserModelIdBeforeWebview": before, "windowAppUserModelIdAfterWebview": after,
        "wryVersion": "0.57.1", "taoVersion": "0.37.2", "smoke": smoke,
        "diagnosticBrowserArguments": std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").ok(),
        "packageIdentity": package_identity,
        "taskManagerGroupingVerified": false,
    });
    std::fs::write(&report_path, serde_json::to_vec_pretty(&report)?)?;
    let started = Instant::now();
    let mut reported = false;
    let code = event_loop.run_return(|event, _, control_flow| {
        *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(100));
        if loaded.get() && !reported {
            let mut report = report.clone();
            report["webviewLoaded"] = true.into();
            report["documentReady"] = true.into();
            reported =
                std::fs::write(&report_path, serde_json::to_vec_pretty(&report).unwrap()).is_ok();
        }
        if smoke && reported {
            *control_flow = ControlFlow::Exit;
        } else if smoke && started.elapsed() > Duration::from_secs(20) {
            *control_flow = ControlFlow::ExitWithCode(2);
        } else if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
    if code != 0 {
        return Err(format!("Event loop returned {code}").into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn main() {
    eprintln!("This diagnostic requires Windows.");
    std::process::exit(1);
}
