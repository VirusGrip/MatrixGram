use matrixgram_core::models::RoomSummary;
#[cfg(windows)]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(windows)]
static COUNT: AtomicU64 = AtomicU64::new(u64::MAX);

pub fn update(app: &tauri::AppHandle, rooms: &[RoomSummary]) {
    let count = rooms.iter().fold(0u64, |sum, room| {
        sum.saturating_add(if room.membership == "invited" {
            room.unread.max(1)
        } else {
            room.unread
        })
    });
    set_count(app, count);
}
pub fn set_count(app: &tauri::AppHandle, count: u64) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        if COUNT.swap(count, Ordering::AcqRel) == count {
            return;
        }
        let icon = (count > 0).then(|| tauri::image::Image::new_owned(badge(count), 32, 32));
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_overlay_icon(icon.clone());
        }
        if let Some(tray) = app.tray_by_id("matrixgram") {
            let _ = tray.set_icon(icon.or_else(|| app.default_window_icon().cloned()));
            let _ = tray.set_tooltip(Some(if count == 0 {
                "MatrixGram".into()
            } else {
                format!("MatrixGram · непрочитанных: {count}")
            }));
        }
    }
    #[cfg(not(windows))]
    let _ = (app, count);
}

#[cfg(any(windows, test))]
fn badge(count: u64) -> Vec<u8> {
    const FONT: [[u8; 5]; 11] = [
        [7, 5, 5, 5, 7],
        [2, 6, 2, 2, 7],
        [7, 1, 7, 4, 7],
        [7, 1, 7, 1, 7],
        [5, 5, 7, 1, 1],
        [7, 4, 7, 1, 7],
        [7, 4, 7, 5, 7],
        [7, 1, 2, 2, 2],
        [7, 5, 7, 5, 7],
        [7, 5, 7, 1, 7],
        [0, 2, 7, 2, 0],
    ];
    let mut data = vec![0; 32 * 32 * 4];
    for y in 0i32..32 {
        for x in 0i32..32 {
            if (x - 16).pow(2) + (y - 16).pow(2) <= 15 * 15 {
                let i = (y as usize * 32 + x as usize) * 4;
                data[i..i + 4].copy_from_slice(&[224, 64, 78, 255]);
            }
        }
    }
    let label = if count > 99 {
        "99+".into()
    } else {
        count.to_string()
    };
    let width = label.len() * 8 - 2;
    let left = (32 - width) / 2;
    for (index, c) in label.chars().enumerate() {
        let glyph = if c == '+' {
            10
        } else {
            c.to_digit(10).unwrap() as usize
        };
        for (y, row) in FONT[glyph].iter().enumerate() {
            for x in 0..3 {
                if row & (1 << (2 - x)) != 0 {
                    for dy in 0..2 {
                        for dx in 0..2 {
                            let p = ((11 + y * 2 + dy) * 32 + left + index * 8 + x * 2 + dx) * 4;
                            data[p..p + 4].copy_from_slice(&[255; 4]);
                        }
                    }
                }
            }
        }
    }
    data
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn badges_have_bounded_rgba_and_distinct_counts() {
        let one = badge(1);
        assert_eq!(one.len(), 4096);
        assert_ne!(one, badge(2));
        assert_eq!(badge(100), badge(u64::MAX));
        assert!(one.as_chunks::<4>().0.iter().any(|p| p == &[255; 4]));
        assert_eq!(&one[..4], &[0; 4]);
    }
}
