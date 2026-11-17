use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemory {
    pid: u32,
    name: String,
    is_main: bool,
    private_bytes: Option<u64>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReport {
    supported: bool,
    sampled_at_ms: u64,
    total_private_bytes: Option<u64>,
    unavailable: usize,
    processes: Vec<ProcessMemory>,
}
#[derive(Default)]
pub struct MemoryMonitor(Arc<Mutex<Option<(Instant, MemoryReport)>>>);

#[tauri::command]
pub async fn memory_usage(state: tauri::State<'_, MemoryMonitor>) -> Result<MemoryReport, String> {
    let cache = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cached = cache
            .lock()
            .map_err(|_| "Не удалось прочитать счётчик памяти")?;
        if let Some((at, report)) = &*cached
            && at.elapsed() < Duration::from_secs(3)
        {
            return Ok(report.clone());
        }
        let report = sample()?;
        *cached = Some((Instant::now(), report.clone()));
        Ok(report)
    })
    .await
    .map_err(|_| "Не удалось измерить память приложения".to_owned())?
}
fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[cfg(not(windows))]
fn sample() -> Result<MemoryReport, String> {
    Ok(MemoryReport {
        supported: false,
        sampled_at_ms: timestamp(),
        total_private_bytes: None,
        unavailable: 0,
        processes: Vec::new(),
    })
}
#[cfg(windows)]
use platform::sample;

#[cfg(any(windows, test))]
#[derive(Clone)]
struct Entry {
    pid: u32,
    parent: u32,
    name: String,
    created: Option<u64>,
}

#[cfg(any(windows, test))]
fn tree(root: u32, entries: &[Entry]) -> Vec<(Entry, bool)> {
    use std::collections::{HashMap, HashSet};
    let Some(first) = entries.iter().find(|e| e.pid == root) else {
        return Vec::new();
    };
    let mut children = HashMap::<u32, Vec<&Entry>>::new();
    for entry in entries {
        children.entry(entry.parent).or_default().push(entry);
    }
    let mut result = vec![(first.clone(), first.created.is_some())];
    let mut seen = HashSet::from([root]);
    let mut index = 0;
    while index < result.len() {
        let (parent, verified) = result[index].clone();
        index += 1;
        for child in children.get(&parent.pid).into_iter().flatten() {
            if child
                .created
                .zip(parent.created)
                .is_some_and(|(c, p)| c < p)
                || !seen.insert(child.pid)
            {
                continue;
            }
            result.push(((*child).clone(), verified && child.created.is_some()));
        }
    }
    result
}

#[cfg(any(windows, test))]
fn indexed_instances(values: Vec<(String, Option<u64>)>) -> Vec<(u32, String)> {
    let mut counts = std::collections::HashMap::<String, usize>::new();
    let mut result = Vec::new();
    for (name, value) in values {
        let index = counts.entry(name.clone()).or_default();
        let instance = if *index == 0 {
            name.clone()
        } else {
            format!("{name}#{index}")
        };
        *index += 1;
        // These characters have special meaning in PDH paths. An unexpected
        // helper name is left unavailable rather than interpreted as a path.
        if name.contains(['(', ')', '\\', '/', '#']) {
            continue;
        }
        if let Some(pid) = value.and_then(|n| u32::try_from(n).ok()).filter(|&n| n > 0) {
            result.push((pid, instance));
        }
    }
    result
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::collections::HashMap;
    use windows::{
        Win32::{
            Foundation::{CloseHandle, ERROR_NO_MORE_FILES, FILETIME, HANDLE},
            System::{
                Diagnostics::ToolHelp::{
                    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
                    TH32CS_SNAPPROCESS,
                },
                Performance::*,
                Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
            },
        },
        core::{HSTRING, PCWSTR, w},
    };
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
    struct Query(PDH_HQUERY);
    impl Drop for Query {
        fn drop(&mut self) {
            unsafe {
                PdhCloseQuery(self.0);
            }
        }
    }
    fn status(code: u32) -> Result<(), String> {
        if code == 0 {
            Ok(())
        } else {
            Err(format!("Windows не вернула данные памяти (0x{code:08x})"))
        }
    }
    fn created(pid: u32) -> Option<u64> {
        let process =
            Handle(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()? });
        let (mut c, mut e, mut k, mut u) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        unsafe {
            GetProcessTimes(process.0, &mut c, &mut e, &mut k, &mut u).ok()?;
        }
        Some((u64::from(c.dwHighDateTime) << 32) | u64::from(c.dwLowDateTime))
    }
    fn entries() -> Result<Vec<Entry>, String> {
        let snapshot = Handle(
            unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
                .map_err(|_| "Не удалось получить дерево процессов")?,
        );
        let mut value = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        unsafe { Process32FirstW(snapshot.0, &mut value) }
            .map_err(|_| "Не удалось прочитать дерево процессов")?;
        let mut result = Vec::new();
        loop {
            let length = value
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(value.szExeFile.len());
            result.push(Entry {
                pid: value.th32ProcessID,
                parent: value.th32ParentProcessID,
                name: String::from_utf16_lossy(&value.szExeFile[..length]),
                created: None,
            });
            match unsafe { Process32NextW(snapshot.0, &mut value) } {
                Ok(()) => {}
                Err(error) if error.code() == ERROR_NO_MORE_FILES.to_hresult() => break,
                Err(_) => return Err("Не удалось дочитать дерево процессов".into()),
            }
        }
        Ok(result)
    }
    fn values(counter: PDH_HCOUNTER) -> Result<Vec<(String, Option<u64>)>, String> {
        let (mut bytes, mut count) = (0, 0);
        let code = unsafe {
            PdhGetFormattedCounterArrayW(counter, PDH_FMT_LARGE, &mut bytes, &mut count, None)
        };
        if code != PDH_MORE_DATA {
            status(code)?;
            return Ok(Vec::new());
        }
        for _ in 0..3 {
            if bytes == 0 || bytes > 16 * 1024 * 1024 {
                return Err("Некорректный размер счётчика Windows".into());
            }
            // usize storage provides the required alignment for the native array.
            let mut buffer = vec![0usize; (bytes as usize).div_ceil(std::mem::size_of::<usize>())];
            let capacity = buffer.len() * std::mem::size_of::<usize>();
            let code = unsafe {
                PdhGetFormattedCounterArrayW(
                    counter,
                    PDH_FMT_LARGE,
                    &mut bytes,
                    &mut count,
                    Some(buffer.as_mut_ptr().cast()),
                )
            };
            if code == PDH_MORE_DATA {
                continue;
            }
            status(code)?;
            if count as usize > capacity / std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>() {
                return Err("Повреждён ответ счётчика Windows".into());
            }
            let items = unsafe {
                std::slice::from_raw_parts(
                    buffer.as_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>(),
                    count as usize,
                )
            };
            let mut result = Vec::new();
            for item in items {
                if item.szName.is_null() {
                    return Err("Windows вернула процесс без имени счётчика".into());
                }
                let name = unsafe { item.szName.to_string() }
                    .map_err(|_| "Некорректное имя счётчика Windows")?;
                let value = if matches!(
                    item.FmtValue.CStatus,
                    PDH_CSTATUS_VALID_DATA | PDH_CSTATUS_NEW_DATA
                ) {
                    u64::try_from(unsafe { item.FmtValue.Anonymous.largeValue }).ok()
                } else {
                    None
                };
                // Keep duplicate names and unavailable slots: both contribute
                // to the instance index used in the individual counter path.
                result.push((name, value));
            }
            return Ok(result);
        }
        Err("Список процессов изменился во время измерения; повторите замер".into())
    }
    fn counter_value(counter: PDH_HCOUNTER) -> Option<u64> {
        let mut value = PDH_FMT_COUNTERVALUE::default();
        if unsafe { PdhGetFormattedCounterValue(counter, PDH_FMT_LARGE, None, &mut value) } != 0
            || !matches!(value.CStatus, PDH_CSTATUS_VALID_DATA | PDH_CSTATUS_NEW_DATA)
        {
            return None;
        }
        u64::try_from(unsafe { value.Anonymous.largeValue }).ok()
    }
    fn private_working_sets(wanted: &[(Entry, bool)]) -> Result<HashMap<u32, u64>, String> {
        let mut handle = PDH_HQUERY::default();
        status(unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut handle) })?;
        let query = Query(handle);
        let mut ids = PDH_HCOUNTER::default();
        // English paths work on localized Windows (including Russian).
        status(unsafe {
            PdhAddEnglishCounterW(query.0, w!("\\Process(*)\\ID Process"), 0, &mut ids)
        })?;
        status(unsafe { PdhCollectQueryData(query.0) })?;
        let instances = indexed_instances(values(ids)?);
        let mut selected = Vec::new();
        for (pid, instance) in instances {
            if !wanted
                .iter()
                .any(|(entry, verified)| *verified && entry.pid == pid)
            {
                continue;
            }
            let (mut identity, mut memory) = (PDH_HCOUNTER::default(), PDH_HCOUNTER::default());
            let id_path = HSTRING::from(format!(r"\Process({instance})\ID Process"));
            let memory_path = HSTRING::from(format!(r"\Process({instance})\Working Set - Private"));
            if unsafe { PdhAddEnglishCounterW(query.0, &id_path, 0, &mut identity) } == 0
                && unsafe { PdhAddEnglishCounterW(query.0, &memory_path, 0, &mut memory) } == 0
            {
                selected.push((pid, identity, memory));
            }
        }
        status(unsafe { PdhCollectQueryData(query.0) })?;
        let mut result = HashMap::new();
        for (pid, identity, memory) in selected {
            // Instance ordinals may move while processes start/exit. Verify
            // the actual PID in the SAME collection as the memory value.
            if counter_value(identity) == Some(u64::from(pid))
                && let Some(bytes) = counter_value(memory)
            {
                result.insert(pid, bytes);
            }
        }
        Ok(result)
    }
    pub(super) fn sample() -> Result<MemoryReport, String> {
        sample_for(std::process::id())
    }
    pub(super) fn sample_for(root: u32) -> Result<MemoryReport, String> {
        let snapshot = entries()?;
        // Open handles only for candidate descendants. System counters stay
        // native; IPC contains only this tree, with no paths or command lines.
        let candidates = tree(root, &snapshot);
        if candidates.len() > 256 {
            return Err("Слишком много процессов для одного замера".into());
        }
        let candidates = candidates
            .into_iter()
            .map(|(mut e, _)| {
                e.created = created(e.pid);
                e
            })
            .collect::<Vec<_>>();
        let candidates = tree(root, &candidates);
        let counters = private_working_sets(&candidates)?;
        let processes = candidates
            .into_iter()
            .map(|(entry, verified)| {
                let bytes = if verified && created(entry.pid) == entry.created {
                    counters.get(&entry.pid).copied()
                } else {
                    None
                };
                ProcessMemory {
                    pid: entry.pid,
                    name: entry.name,
                    is_main: entry.pid == root,
                    private_bytes: bytes,
                }
            })
            .collect::<Vec<_>>();
        let unavailable = processes
            .iter()
            .filter(|p| p.private_bytes.is_none())
            .count();
        if unavailable == processes.len() {
            return Err("Windows не вернула память процессов MatrixGram".into());
        }
        let total = processes
            .iter()
            .filter_map(|p| p.private_bytes)
            .try_fold(0u64, |sum, n| sum.checked_add(n))
            .ok_or("Некорректная сумма памяти")?;
        Ok(MemoryReport {
            supported: true,
            sampled_at_ms: timestamp(),
            total_private_bytes: Some(total),
            unavailable,
            processes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn e(pid: u32, parent: u32, created: Option<u64>) -> Entry {
        Entry {
            pid,
            parent,
            created,
            name: format!("process-{pid}"),
        }
    }
    #[test]
    fn duplicate_pdh_names_keep_each_instance_and_unavailable_slot() {
        let rows = vec![
            ("msedgewebview2".into(), Some(10)),
            ("msedgewebview2".into(), None),
            ("msedgewebview2".into(), Some(30)),
            ("matrixgram".into(), Some(40)),
        ];
        assert_eq!(
            indexed_instances(rows),
            vec![
                (10, "msedgewebview2".into()),
                (30, "msedgewebview2#2".into()),
                (40, "matrixgram".into())
            ]
        );
        assert!(indexed_instances(vec![("unsafe(*)".into(), Some(50))]).is_empty());
    }
    #[test]
    fn tree_excludes_other_apps_and_reused_parent_pids() {
        let entries = vec![
            e(10, 1, Some(100)),
            e(20, 10, Some(101)),
            e(30, 20, Some(102)),
            e(40, 1, Some(103)),
            e(50, 20, Some(90)),
            e(60, 50, Some(95)),
        ];
        assert_eq!(
            tree(10, &entries)
                .iter()
                .map(|(e, _)| e.pid)
                .collect::<Vec<_>>(),
            vec![10, 20, 30]
        );
    }
    #[test]
    fn inaccessible_ancestor_marks_the_subtree_as_incomplete_and_cycles_terminate() {
        let entries = vec![e(10, 30, Some(1)), e(20, 10, None), e(30, 20, Some(3))];
        let selected = tree(10, &entries);
        assert_eq!(selected.len(), 3);
        assert!(selected[0].1);
        assert!(!selected[1].1);
        assert!(!selected[2].1);
        assert!(tree(99, &entries).is_empty());
    }
    #[cfg(windows)]
    #[test]
    fn native_counter_measures_this_process_without_subprocesses() {
        let report = sample().unwrap();
        assert!(report.supported);
        let root = report.processes.iter().find(|p| p.is_main).unwrap();
        assert_eq!(root.pid, std::process::id());
        assert!(root.private_bytes.is_some_and(|bytes| bytes > 1024 * 1024));
        assert!(report.total_private_bytes.unwrap() >= root.private_bytes.unwrap());
    }
    #[cfg(windows)]
    #[test]
    fn repeated_samples_release_native_query_and_process_handles() {
        use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessHandleCount};
        fn handles() -> u32 {
            let mut count = 0;
            unsafe {
                GetProcessHandleCount(GetCurrentProcess(), &mut count).unwrap();
            }
            count
        }
        sample().unwrap();
        let before = handles();
        for _ in 0..8 {
            sample().unwrap();
        }
        assert!(
            handles() <= before + 4,
            "Memory sampling retained native handles"
        );
    }
    #[cfg(windows)]
    #[test]
    #[ignore = "manual comparison against an already running MatrixGram"]
    fn native_counter_live_client() {
        let pid = std::env::var("MATRIXGRAM_MEMORY_PID")
            .expect("Set MATRIXGRAM_MEMORY_PID")
            .parse::<u32>()
            .unwrap();
        let report = platform::sample_for(pid).unwrap();
        println!(
            "MEMORY_USAGE_JSON {}",
            serde_json::to_string(&report).unwrap()
        );
        let root = report.processes.iter().find(|p| p.is_main).unwrap();
        assert!(root.name.eq_ignore_ascii_case("matrixgram.exe"));
        assert!(
            report
                .processes
                .iter()
                .any(|p| p.name.eq_ignore_ascii_case("msedgewebview2.exe"))
        );
        assert_eq!(report.unavailable, 0);
    }
}
