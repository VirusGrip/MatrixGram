use crate::models::{Result, RoomSummary};
use rusqlite::{Connection, params};
use serde_json::Value;
use std::{path::Path, sync::Mutex};

pub struct Cache(Mutex<Connection>);

impl Cache {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path)?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS events (
              room_id TEXT NOT NULL, event_id TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL,
              PRIMARY KEY(room_id, event_id));
            CREATE INDEX IF NOT EXISTS events_room_time ON events(room_id, ts);
            CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS drafts (room_id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS redactions (room_id TEXT NOT NULL, target TEXT NOT NULL, data TEXT NOT NULL,
              PRIMARY KEY(room_id,target));
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT NOT NULL);
            PRAGMA user_version=2;")?;
        Ok(Self(Mutex::new(db)))
    }

    pub fn save_events(&self, room_id: &str, events: &[Value]) -> Result<()> {
        let mut db = self.0.lock().expect("cache mutex poisoned");
        let tx = db.transaction()?;
        {
            let mut insert = tx.prepare_cached("INSERT INTO events(room_id,event_id,ts,data) VALUES(?1,?2,?3,?4)
                    ON CONFLICT(room_id,event_id) DO UPDATE SET
                    data=CASE WHEN json_type(events.data,'$.unsigned.redacted_because') IS NOT NULL THEN events.data ELSE excluded.data END,
                    ts=excluded.ts")?;
            let mut redact = tx.prepare_cached(
                "INSERT INTO redactions(room_id,target,data) VALUES(?1,?2,?3)
                            ON CONFLICT(room_id,target) DO UPDATE SET data=excluded.data",
            )?;
            for event in events {
                if let (Some(id), Some(ts)) = (
                    event["event_id"].as_str(),
                    event["origin_server_ts"].as_i64(),
                ) {
                    insert.execute(params![room_id, id, ts, serde_json::to_string(event)?])?;
                    if event["type"] == "m.room.redaction"
                        && let Some(target) = event["redacts"]
                            .as_str()
                            .or_else(|| event["content"]["redacts"].as_str())
                    {
                        redact.execute(params![room_id, target, serde_json::to_string(event)?])?;
                    }
                }
            }
        }
        tx.execute("UPDATE events SET data=json_set(data,'$.content',json('{}'),'$.unsigned.redacted_because',
            json((SELECT r.data FROM redactions r WHERE r.room_id=events.room_id AND r.target=events.event_id)))
            WHERE room_id=?1 AND event_id IN (SELECT target FROM redactions WHERE room_id=?1)", [room_id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn events(&self, room_id: &str) -> Result<Vec<Value>> {
        let db = self.0.lock().expect("cache mutex poisoned");
        let mut q = db.prepare_cached(
            "SELECT data FROM (SELECT data,ts,event_id FROM events WHERE room_id=?1
            ORDER BY ts DESC,event_id DESC LIMIT 500) ORDER BY ts ASC,event_id ASC",
        )?;
        let rows = q.query_map([room_id], |r| r.get::<_, String>(0))?;
        rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
    }

    pub fn save_rooms(&self, rooms: &[RoomSummary]) -> Result<()> {
        let mut db = self.0.lock().expect("cache mutex poisoned");
        let tx = db.transaction()?;
        tx.execute("DELETE FROM rooms", [])?;
        {
            let mut insert = tx.prepare_cached("INSERT INTO rooms(id,data) VALUES(?1,?2)")?;
            for room in rooms {
                insert.execute(params![room.id, serde_json::to_string(room)?])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn last_message(&self, room: &str) -> Result<(Option<String>, i64)> {
        let db = self.0.lock().expect("cache mutex poisoned");
        let mut query = db.prepare_cached("SELECT data,ts FROM events WHERE room_id=?1 AND json_extract(data,'$.type')='m.room.message'
            AND COALESCE(json_extract(data,'$.content.\"m.relates_to\".rel_type'),'')!='m.replace'
            ORDER BY ts DESC,event_id DESC LIMIT 1")?;
        let mut rows = query.query([room])?;
        let Some(row) = rows.next()? else {
            return Ok((None, 0));
        };
        let raw: String = row.get(0)?;
        let event: Value = serde_json::from_str(&raw)?;
        let preview = if event["unsigned"]["redacted_because"].is_object() {
            Some("Сообщение удалено".into())
        } else {
            event["content"]["body"]
                .as_str()
                .map(|s| s.chars().take(160).collect())
        };
        Ok((preview, row.get(1)?))
    }

    pub fn draft(&self, room_id: &str) -> Result<String> {
        let db = self.0.lock().expect("cache mutex poisoned");
        let mut q = db.prepare_cached("SELECT body FROM drafts WHERE room_id=?1")?;
        let mut rows = q.query([room_id])?;
        Ok(if let Some(row) = rows.next()? {
            row.get(0)?
        } else {
            String::new()
        })
    }

    pub fn save_draft(&self, room_id: &str, body: &str) -> Result<()> {
        self.0.lock().expect("cache mutex poisoned").execute(
            "INSERT INTO drafts(room_id,body) VALUES(?1,?2) ON CONFLICT(room_id) DO UPDATE SET body=excluded.body", params![room_id, body])?;
        Ok(())
    }

    pub fn setting<T: serde::de::DeserializeOwned + Default>(&self, key: &str) -> Result<T> {
        use rusqlite::OptionalExtension;
        let db = self.0.lock().expect("cache mutex poisoned");
        let value: Option<String> = db
            .query_row("SELECT data FROM settings WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        Ok(match value {
            Some(value) => serde_json::from_str(&value)?,
            None => T::default(),
        })
    }

    pub fn save_setting<T: serde::Serialize>(&self, key: &str, value: &T) -> Result<()> {
        self.0.lock().expect("cache mutex poisoned").execute(
            "INSERT INTO settings(key,data) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
            params![key, serde_json::to_string(value)?])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    #[ignore = "local SQLite load benchmark; run explicitly with --ignored --nocapture"]
    fn cache_load_100000_events() {
        use std::time::Instant;
        let dir = tempfile::tempdir().unwrap();
        let cache = std::sync::Arc::new(Cache::open(&dir.path().join("load.sqlite3")).unwrap());
        let start = Instant::now();
        for room in 0..200 {
            let events: Vec<Value> = (0..500)
                .map(|i| {
                    json!({
                        "event_id":format!("${room}-{i}"),"sender":"@load:test",
                        "origin_server_ts":i,"type":"m.room.message",
                        "content":{"msgtype":"m.text","body":format!("Load message {i}")}
                    })
                })
                .collect();
            cache
                .save_events(&format!("!{room}:test"), &events)
                .unwrap();
        }
        let write_ms = start.elapsed().as_millis();
        let start = Instant::now();
        for i in 0..1000 {
            let (body, ts) = cache.last_message(&format!("!{}:test", i % 200)).unwrap();
            assert_eq!(body.as_deref(), Some("Load message 499"));
            assert_eq!(ts, 499);
        }
        let preview_ms = start.elapsed().as_millis();
        let start = Instant::now();
        for room in 0..200 {
            assert_eq!(cache.events(&format!("!{room}:test")).unwrap().len(), 500);
        }
        let read_ms = start.elapsed().as_millis();
        let original = json!({"event_id":"$42-499","origin_server_ts":499,"type":"m.room.message","content":{"body":"must stay deleted"}});
        cache.save_events("!42:test", &[json!({"event_id":"$redact","origin_server_ts":1000,"type":"m.room.redaction","content":{"redacts":"$42-499"}})]).unwrap();
        cache
            .save_events("!42:test", &[original.clone(), original])
            .unwrap();
        assert_eq!(
            cache.last_message("!42:test").unwrap().0.as_deref(),
            Some("Сообщение удалено")
        );
        let count: i64 = cache
            .0
            .lock()
            .unwrap()
            .query_row("SELECT count(*) FROM events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 100001);
        // Concurrent history/sync retries must preserve de-duplication and redactions.
        let threads: Vec<_> = (0..4).map(|_| {
            let cache = cache.clone();
            std::thread::spawn(move || {
                for _ in 0..3 {
                    let stale: Vec<_> = (0..500).map(|i| json!({"event_id":format!("$42-{i}"),"origin_server_ts":i,"type":"m.room.message","content":{"body":format!("Load message {i}")}})).collect();
                    cache.save_events("!42:test", &stale).unwrap();
                    assert_eq!(cache.events("!42:test").unwrap().len(),500);
                }
            })
        }).collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(
            cache.last_message("!42:test").unwrap().0.as_deref(),
            Some("Сообщение удалено")
        );
        let count: i64 = cache
            .0
            .lock()
            .unwrap()
            .query_row("SELECT count(*) FROM events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 100001);
        println!(
            "LOAD_CACHE_JSON {}",
            json!({"events":100000,"rooms":200,"writeMs":write_ms,"preview1000Ms":preview_ms,"read100000Ms":read_ms,"profile":"cargo test dev; local SQLite, no Matrix network"})
        );
    }

    #[test]
    fn cache_is_durable_ordered_and_deduplicates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.sqlite3");
        {
            let cache = Cache::open(&path).unwrap();
            let event = json!({"event_id":"$b", "origin_server_ts":20,"type":"m.room.message","content":{"body":"hello"}});
            cache
                .save_events("!room:host", &[event.clone(), event])
                .unwrap();
            cache
                .save_events(
                    "!room:host",
                    &[json!({"event_id":"$a","origin_server_ts":10})],
                )
                .unwrap();
            cache.save_draft("!room:host", "черновик").unwrap();
        }
        let cache = Cache::open(&path).unwrap();
        let events = cache.events("!room:host").unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["event_id"], "$a");
        assert_eq!(cache.draft("!room:host").unwrap(), "черновик");
        assert!(cache.events("!other:host").unwrap().is_empty());
    }

    #[test]
    fn redaction_survives_later_history_pages_and_updates_preview() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::open(&dir.path().join("cache.db")).unwrap();
        let original = json!({"event_id":"$target","origin_server_ts":10,"type":"m.room.message","content":{"body":"private deleted text"}});
        let redaction = json!({"event_id":"$delete","origin_server_ts":20,"type":"m.room.redaction","content":{"redacts":"$target"}});
        // Redaction arrives before its target, then a stale copy of the target arrives again.
        cache.save_events("!r:host", &[redaction]).unwrap();
        cache
            .save_events("!r:host", std::slice::from_ref(&original))
            .unwrap();
        cache.save_events("!r:host", &[original]).unwrap();
        let event = &cache.events("!r:host").unwrap()[0];
        assert!(event["content"]["body"].is_null());
        assert!(event["unsigned"]["redacted_because"].is_object());
        assert_eq!(
            cache.last_message("!r:host").unwrap().0.as_deref(),
            Some("Сообщение удалено")
        );
    }
}
