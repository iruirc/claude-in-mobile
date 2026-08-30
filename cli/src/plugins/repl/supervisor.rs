//! Supervisor — owns a name → session map.
//!
//! The supervisor is a normal struct; the long-lived JSON-RPC stdio loop that
//! exposes it to the TS MCP server is wired in Phase 9 (REPL TS plugin).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use anyhow::{anyhow, bail, Result};
use serde::Serialize;

use super::expect::{ExpectOutcome, ExpectRules};
use super::prompt_profiles::{compile, pick_profile};
use super::session::{FilmstripFrame, PtySession, SessionState, SessionStatus, SpawnOptions};
use super::session::FILMSTRIP_CAP;

// ---------------------------------------------------------------------------
// Internal handle
// ---------------------------------------------------------------------------

/// One live session. `session` is the exclusive lock for mutating ops
/// (send/key/expect/kill/resize); `state` is a shared clone of the session's
/// read state so `list`/`snapshot` can report status/screen WITHOUT blocking
/// on a concurrent long-running `expect` that holds `session`.
struct SessionHandle {
    cmd: String,
    state: Arc<Mutex<SessionState>>,
    session: Mutex<PtySession>,
}

// ---------------------------------------------------------------------------
// Public request types
// ---------------------------------------------------------------------------

pub struct Supervisor {
    sessions: Mutex<HashMap<String, Arc<SessionHandle>>>,
}

#[derive(Debug, Clone)]
pub struct SpawnRequest {
    pub id: String,
    pub cmd: String,
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
    pub prompt_regex: Option<String>,
    /// Run `cmd` via `/bin/sh -c` instead of direct argv exec.
    pub shell: bool,
    /// When `Some`, enable asciicast v2 recording to this path.
    pub cast_path: Option<PathBuf>,
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// SYNC-ANCHOR: Rust FilmstripFrameDto ↔ TS types.ts FilmstripFrame
/// Fields MUST be named 'ts' (millis, u64) and 'grid' (NOT 'screen', NOT 'capturedAt').
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmstripFrameDto {
    /// Unix epoch milliseconds.
    pub ts: u64,
    pub grid: String,
}

impl From<&FilmstripFrame> for FilmstripFrameDto {
    fn from(f: &FilmstripFrame) -> Self {
        let ts = f
            .captured_at
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        Self {
            ts,
            grid: f.grid.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub cmd: String,
    pub status: SessionStatus,
    pub exit_code: Option<i32>,
}

/// SYNC-ANCHOR: matches SessionSnapshot in src/plugins/repl/types.ts.
/// New optional fields use `skip_serializing_if` so old clients never see them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub id: String,
    pub status: SessionStatus,
    /// vt100-rendered grid. Empty string when mode='raw' (for backward-compat
    /// of TS types — field must exist even if empty).
    pub screen: String,
    pub exit_code: Option<i32>,
    pub cols: u16,
    pub rows: u16,
    /// Present only when mode='raw' or mode='both'.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    /// Present only when history is truthy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frames: Option<Vec<FilmstripFrameDto>>,
}

/// Result of a spawn call.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnResult {
    pub id: String,
    /// Absolute path to the `.cast` file when recording was requested.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cast_file: Option<String>,
}

// ---------------------------------------------------------------------------
// Snapshot mode
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotMode {
    Grid,
    Raw,
    Both,
}

impl SnapshotMode {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "grid" => Ok(Self::Grid),
            "raw" => Ok(Self::Raw),
            "both" => Ok(Self::Both),
            other => bail!("invalid mode: {other}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Supervisor impl
// ---------------------------------------------------------------------------

impl Default for Supervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl Supervisor {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn handle(&self, id: &str) -> Result<Arc<SessionHandle>> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("no session: {id}"))
    }

    pub fn spawn(&self, req: SpawnRequest) -> Result<SpawnResult> {
        {
            let map = self.sessions.lock().unwrap();
            if let Some(existing) = map.get(&req.id) {
                if existing.session.lock().unwrap().status() != SessionStatus::Dead {
                    bail!("session already exists: {}", req.id);
                }
            }
        }
        let env: Vec<(String, String)> = req.env.clone();
        let cast_path = req.cast_path.clone();

        // Spawn outside the map lock — openpty/fork must not block other ops.
        let session = PtySession::spawn(SpawnOptions {
            id: req.id.clone(),
            cmd: &req.cmd,
            cwd: req.cwd.as_deref(),
            env: &env,
            cols: req.cols,
            rows: req.rows,
            shell: req.shell,
            cast_path: cast_path.clone(),
        })?;

        let cast_file = cast_path.map(|p| p.to_string_lossy().into_owned());

        let handle = Arc::new(SessionHandle {
            cmd: session.cmd.clone(),
            state: session.state(),
            session: Mutex::new(session),
        });
        self.sessions.lock().unwrap().insert(req.id.clone(), handle);

        Ok(SpawnResult {
            id: req.id,
            cast_file,
        })
    }

    pub fn send(&self, id: &str, text: &str, with_newline: bool) -> Result<()> {
        let h = self.handle(id)?;
        let mut s = h.session.lock().unwrap();
        if with_newline {
            s.write_line(text)
        } else {
            s.write_bytes(text.as_bytes())
        }
    }

    pub fn send_key(&self, id: &str, key: &str) -> Result<()> {
        let bytes = key_bytes(key)?;
        let h = self.handle(id)?;
        let mut s = h.session.lock().unwrap();
        s.write_bytes(bytes)
    }

    pub fn expect(
        &self,
        id: &str,
        regex: Option<&str>,
        idle_ms: u64,
        timeout_ms: u64,
    ) -> Result<ExpectOutcome> {
        let h = self.handle(id)?;
        let mut s = h.session.lock().unwrap();
        let regex_owned = regex
            .map(|r| r.to_string())
            .or_else(|| pick_profile(&s.cmd).map(|p| p.prompt_regex.to_string()));
        let prompt = regex_owned.as_deref().and_then(compile);
        let rules = ExpectRules::new(prompt, idle_ms, timeout_ms);
        s.wait_ready(&rules)
    }

    /// Take a snapshot of the session.
    ///
    /// `mode`    — which surfaces to return (grid / raw / both).
    /// `history` — if `Some(n)`, return the last `n` filmstrip frames
    ///             (clamped to `FILMSTRIP_CAP`). `Some(0)` → no frames.
    /// `tail_lines` — optional line-count clipping for the grid screen.
    pub fn snapshot(
        &self,
        id: &str,
        mode: SnapshotMode,
        history: Option<usize>,
        tail_lines: Option<usize>,
    ) -> Result<SessionSnapshot> {
        let h = self.handle(id)?;
        // Read the shared state, not the session lock — works even while the
        // session is mid-`expect`.
        let st = h.state.lock().unwrap();

        // Grid surface.
        let full_grid = st.screen_text();
        let screen = match mode {
            SnapshotMode::Raw => String::new(), // backward-compat empty string
            _ => match tail_lines {
                Some(n) => tail_lines_of(&full_grid, n),
                None => full_grid,
            },
        };

        // Raw surface.
        let raw = match mode {
            SnapshotMode::Raw | SnapshotMode::Both => Some(st.raw.clone()),
            SnapshotMode::Grid => None,
        };

        // Filmstrip / history surface.
        let frames: Option<Vec<FilmstripFrameDto>> = match history {
            None | Some(0) => None,
            Some(n) => {
                let cap = n.min(FILMSTRIP_CAP);
                let total = st.filmstrip.len();
                let start = total.saturating_sub(cap);
                let dtos: Vec<FilmstripFrameDto> = st.filmstrip
                    .iter()
                    .skip(start)
                    .map(FilmstripFrameDto::from)
                    .collect();
                Some(dtos) // empty vec when no frames yet (R8, S11)
            }
        };

        Ok(SessionSnapshot {
            id: id.into(),
            status: st.status,
            screen,
            exit_code: st.exit_code,
            cols: st.cols,
            rows: st.rows,
            raw,
            frames,
        })
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        let handles: Vec<(String, Arc<SessionHandle>)> = {
            let map = self.sessions.lock().unwrap();
            map.iter().map(|(k, v)| (k.clone(), Arc::clone(v))).collect()
        };
        handles
            .iter()
            .map(|(id, h)| {
                let st = h.state.lock().unwrap();
                SessionInfo {
                    id: id.clone(),
                    cmd: h.cmd.clone(),
                    status: st.status,
                    exit_code: st.exit_code,
                }
            })
            .collect()
    }

    pub fn kill(&self, id: &str) -> Result<()> {
        let h = self.handle(id)?;
        let mut s = h.session.lock().unwrap();
        s.kill()
    }

    /// Resize the PTY and vt100 grid for a live session.
    ///
    /// Order: PTY master first, then vt100 + SessionState under lock.
    /// Unknown id → `anyhow!("no session: {id}")`.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let h = self.handle(id)?;
        let mut s = h.session.lock().unwrap();
        s.resize(cols, rows)
    }

    pub fn drop_session(&self, id: &str) -> Result<()> {
        self.sessions
            .lock()
            .unwrap()
            .remove(id)
            .ok_or_else(|| anyhow!("no session: {id}"))?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Map a symbolic key name to the byte sequence it should send to the PTY.
///
/// The returned slice is `'static` so it can be passed directly to
/// [`PtySession::write_bytes`] without any allocation.
///
/// # Errors
///
/// Returns `Err` when `key` is not a recognised name, preserving the
/// contract that callers get an actionable message instead of silent nops.
///
/// # Examples
///
/// ```
/// # use mcp_devices::plugins::repl::supervisor::key_bytes;
/// assert_eq!(key_bytes("enter").unwrap(), b"\r");
/// assert_eq!(key_bytes("backspace").unwrap(), &[0x7f]);
/// assert!(key_bytes("rocket-launch").is_err());
/// ```
pub fn key_bytes(key: &str) -> Result<&'static [u8]> {
    let bytes: &[u8] = match key {
        // ── pre-existing keys (must not change) ──────────────────────────────
        "enter"   => b"\r",
        "ctrl-c"  => &[0x03],
        "ctrl-d"  => &[0x04],
        "ctrl-z"  => &[0x1a],
        "tab"     => b"\t",
        "up"      => b"\x1b[A",
        "down"    => b"\x1b[B",
        "left"    => b"\x1b[D",
        "right"   => b"\x1b[C",

        // ── editing / navigation ─────────────────────────────────────────────
        "backspace"        => &[0x7f],
        "esc" | "escape"   => &[0x1b],
        "delete"           => b"\x1b[3~",
        "home"             => b"\x1b[H",
        "end"              => b"\x1b[F",
        "pageup"           => b"\x1b[5~",
        "pagedown"         => b"\x1b[6~",
        "shift-tab"        => b"\x1b[Z",
        "space"            => b" ",

        // ── ctrl combos ──────────────────────────────────────────────────────
        "ctrl-a" => &[0x01],
        "ctrl-e" => &[0x05],
        "ctrl-u" => &[0x15],
        "ctrl-k" => &[0x0b],
        "ctrl-w" => &[0x17],
        "ctrl-l" => &[0x0c],
        "ctrl-o" => &[0x0f],
        "ctrl-p" => &[0x10],
        "ctrl-n" => &[0x0e],
        "ctrl-r" => &[0x12],

        _ => bail!("unknown key: {key}"),
    };
    Ok(bytes)
}

fn tail_lines_of(full: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = full.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    fn spawn_bash(sup: &Supervisor, id: &str) {
        sup.spawn(SpawnRequest {
            id: id.into(),
            cmd: "bash --norc --noprofile".into(),
            cwd: None,
            env: vec![
                ("PATH".into(), std::env::var("PATH").unwrap_or_default()),
                ("HOME".into(), std::env::var("HOME").unwrap_or_default()),
                ("PS1".into(), "$ ".into()),
            ],
            cols: 80,
            rows: 24,
            prompt_regex: None,
            shell: false,
            cast_path: None,
        })
        .expect("spawn bash failed");
    }

    #[test]
    fn spawn_send_expect_bash_roundtrip() {
        let sup = Supervisor::new();
        spawn_bash(&sup, "b1");
        let outcome = sup
            .expect("b1", Some(r"\$ $"), 300, 5_000)
            .expect("expect prompt failed");
        assert!(matches!(
            outcome,
            ExpectOutcome::PromptMatched | ExpectOutcome::Idle
        ));
        sup.send("b1", "echo mcp-devices", true).unwrap();
        let after = sup
            .expect("b1", Some(r"\$ $"), 300, 5_000)
            .expect("expect after echo failed");
        assert!(matches!(after, ExpectOutcome::PromptMatched | ExpectOutcome::Idle));
        let snap = sup
            .snapshot("b1", SnapshotMode::Grid, None, None)
            .unwrap();
        assert!(snap.screen.contains("mcp-devices"), "snapshot: {}", snap.screen);
        sup.kill("b1").unwrap();
    }

    #[test]
    fn duplicate_spawn_rejected_while_alive() {
        let sup = Supervisor::new();
        spawn_bash(&sup, "b2");
        let err = sup.spawn(SpawnRequest {
            id: "b2".into(),
            cmd: "bash --norc --noprofile".into(),
            cwd: None,
            env: vec![],
            cols: 80,
            rows: 24,
            prompt_regex: None,
            shell: false,
            cast_path: None,
        });
        assert!(err.is_err());
        sup.kill("b2").unwrap();
    }

    #[test]
    fn list_reports_active_session() {
        let sup = Supervisor::new();
        spawn_bash(&sup, "b3");
        sleep(Duration::from_millis(150));
        let infos = sup.list();
        assert_eq!(infos.len(), 1);
        assert_eq!(infos[0].id, "b3");
        sup.kill("b3").unwrap();
    }

    #[test]
    fn kill_marks_session_dead() {
        let sup = Supervisor::new();
        spawn_bash(&sup, "b4");
        sup.kill("b4").unwrap();
        sleep(Duration::from_millis(100));
        let snap = sup.snapshot("b4", SnapshotMode::Grid, None, None).unwrap();
        assert_eq!(snap.status, SessionStatus::Dead);
    }

    #[test]
    fn unknown_session_errors() {
        let sup = Supervisor::new();
        assert!(sup.snapshot("nope", SnapshotMode::Grid, None, None).is_err());
        assert!(sup.send("nope", "x", true).is_err());
        assert!(sup.kill("nope").is_err());
    }

    #[test]
    fn unknown_session_resize_error() {
        let sup = Supervisor::new();
        let err = sup.resize("nonexistent", 80, 24).unwrap_err();
        assert!(
            err.to_string().contains("no session: nonexistent"),
            "err: {err}"
        );
    }

    #[test]
    fn long_expect_does_not_block_other_sessions() {
        let sup = Arc::new(Supervisor::new());
        spawn_bash(&sup, "la");
        spawn_bash(&sup, "lb");
        sleep(Duration::from_millis(100));

        let sup2 = Arc::clone(&sup);
        let blocker = thread::spawn(move || {
            let _ = sup2.expect("la", Some("NEVER_MATCH_XYZ_QWE$"), 5_000, 1_500);
        });
        sleep(Duration::from_millis(150));

        let t = Instant::now();
        let infos = sup.list();
        let snap = sup.snapshot("lb", SnapshotMode::Grid, None, None).unwrap();
        let elapsed = t.elapsed();

        assert_eq!(infos.len(), 2);
        assert_eq!(snap.id, "lb");
        assert!(
            elapsed < Duration::from_millis(800),
            "list/snapshot blocked behind expect: {elapsed:?}"
        );

        blocker.join().unwrap();
        sup.kill("la").ok();
        sup.kill("lb").ok();
    }

    #[test]
    fn send_key_known_and_unknown() {
        let sup = Supervisor::new();
        spawn_bash(&sup, "b5");
        sleep(Duration::from_millis(100));
        sup.send_key("b5", "enter").unwrap();
        assert!(sup.send_key("b5", "rocket-launch").is_err());
        sup.kill("b5").unwrap();
    }

    // ── key_bytes unit tests (no live session needed) ─────────────────────

    /// Verify that legacy keys preserved their exact byte sequences.
    #[test]
    fn key_bytes_legacy_keys_unchanged() {
        assert_eq!(key_bytes("enter").unwrap(), b"\r");
        assert_eq!(key_bytes("ctrl-c").unwrap(), &[0x03]);
        assert_eq!(key_bytes("ctrl-d").unwrap(), &[0x04]);
        assert_eq!(key_bytes("ctrl-z").unwrap(), &[0x1a]);
        assert_eq!(key_bytes("tab").unwrap(), b"\t");
        assert_eq!(key_bytes("up").unwrap(), b"\x1b[A");
        assert_eq!(key_bytes("down").unwrap(), b"\x1b[B");
        assert_eq!(key_bytes("left").unwrap(), b"\x1b[D");
        assert_eq!(key_bytes("right").unwrap(), b"\x1b[C");
    }

    /// Parametrised coverage for every newly-added key.
    #[test]
    fn key_bytes_new_keys() {
        let cases: &[(&str, &[u8])] = &[
            ("backspace",  &[0x7f]),
            ("esc",        &[0x1b]),
            ("escape",     &[0x1b]),
            ("delete",     b"\x1b[3~"),
            ("home",       b"\x1b[H"),
            ("end",        b"\x1b[F"),
            ("pageup",     b"\x1b[5~"),
            ("pagedown",   b"\x1b[6~"),
            ("shift-tab",  b"\x1b[Z"),
            ("space",      b" "),
            ("ctrl-a",     &[0x01]),
            ("ctrl-e",     &[0x05]),
            ("ctrl-u",     &[0x15]),
            ("ctrl-k",     &[0x0b]),
            ("ctrl-w",     &[0x17]),
            ("ctrl-l",     &[0x0c]),
            ("ctrl-o",     &[0x0f]),
            ("ctrl-p",     &[0x10]),
            ("ctrl-n",     &[0x0e]),
            ("ctrl-r",     &[0x12]),
        ];
        for (name, expected) in cases {
            let got = key_bytes(name)
                .unwrap_or_else(|e| panic!("key_bytes({name:?}) failed: {e}"));
            assert_eq!(
                got, *expected,
                "key {name:?}: expected {expected:x?}, got {got:x?}",
            );
        }
    }

    /// Unknown key names must still produce a descriptive error.
    #[test]
    fn key_bytes_unknown_key_bails() {
        let err = key_bytes("rocket-launch").unwrap_err();
        assert!(
            err.to_string().contains("unknown key: rocket-launch"),
            "unexpected error message: {err}",
        );
    }

    #[test]
    fn expect_timeout_when_no_match() {
        let sup = Supervisor::new();
        spawn_bash(&sup, "b6");
        let outcome = sup
            .expect("b6", Some(r"NEVER_GONNA_MATCH$"), 50, 500)
            .unwrap();
        assert_eq!(outcome, ExpectOutcome::TimedOut);
        sup.kill("b6").unwrap();
    }

    #[test]
    fn snapshot_mode_raw_sets_screen_empty() {
        let sup = Supervisor::new();
        spawn_bash(&sup, "raw1");
        sleep(Duration::from_millis(200));
        let snap = sup
            .snapshot("raw1", SnapshotMode::Raw, None, None)
            .unwrap();
        assert_eq!(snap.screen, "", "mode:raw must set screen to empty string");
        assert!(snap.raw.is_some(), "mode:raw must include raw field");
        sup.kill("raw1").unwrap();
    }

    #[test]
    fn snapshot_mode_grid_omits_raw_and_frames() {
        let sup = Supervisor::new();
        spawn_bash(&sup, "grid1");
        sleep(Duration::from_millis(200));
        let snap = sup
            .snapshot("grid1", SnapshotMode::Grid, None, None)
            .unwrap();
        assert!(snap.raw.is_none(), "mode:grid must not include raw");
        assert!(snap.frames.is_none(), "mode:grid without history must not include frames");
        sup.kill("grid1").unwrap();
    }

    #[test]
    fn snapshot_empty_history_returns_empty_frames() {
        let sup = Supervisor::new();
        spawn_bash(&sup, "hist1");
        // Don't send anything — no frames captured yet.
        let snap = sup
            .snapshot("hist1", SnapshotMode::Grid, Some(10), None)
            .unwrap();
        assert!(snap.frames.is_some(), "history truthy must return frames (even if empty)");
        assert_eq!(snap.frames.unwrap().len(), 0);
        sup.kill("hist1").unwrap();
    }

    #[test]
    fn snapshot_cols_rows_from_session_state() {
        let sup = Supervisor::new();
        sup.spawn(SpawnRequest {
            id: "dim1".into(),
            cmd: "bash --norc --noprofile".into(),
            cwd: None,
            env: vec![("PATH".into(), std::env::var("PATH").unwrap_or_default())],
            cols: 100,
            rows: 30,
            prompt_regex: None,
            shell: false,
            cast_path: None,
        })
        .unwrap();
        sleep(Duration::from_millis(100));
        let snap = sup.snapshot("dim1", SnapshotMode::Grid, None, None).unwrap();
        assert_eq!(snap.cols, 100);
        assert_eq!(snap.rows, 30);
        sup.kill("dim1").unwrap();
    }

    #[test]
    fn spawn_result_no_cast_file_when_record_false() {
        let sup = Supervisor::new();
        let result = sup.spawn(SpawnRequest {
            id: "no_cast".into(),
            cmd: "bash --norc --noprofile".into(),
            cwd: None,
            env: vec![("PATH".into(), std::env::var("PATH").unwrap_or_default())],
            cols: 80,
            rows: 24,
            prompt_regex: None,
            shell: false,
            cast_path: None,
        }).unwrap();
        assert_eq!(result.id, "no_cast");
        assert!(result.cast_file.is_none(), "no record => no castFile");
        sup.kill("no_cast").unwrap();
    }
}
