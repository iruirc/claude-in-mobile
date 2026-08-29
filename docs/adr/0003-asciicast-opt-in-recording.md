# ADR-0003: Opt-in asciicast v2 recording for REPL sessions (4.1.0)

**Status:** Accepted  
**Date:** 2026-08-29  
**Deciders:** alex@gladkov.dev  
**Context document:** docs/security.md §control #3

---

## Context

Security control #3 in docs/security.md states that "session scrollback is
never persisted to disk". The 4.1.0 TUI observability milestone (R9, R10)
adds asciicast v2 recording as an opt-in feature that creates `.cast` files
containing timestamped PTY output. Without an explicit decision record, this
contradicts a committed control and would be flagged as a release blocker.

## Decision

Permit opt-in asciicast recording under the following invariants:

1. **Opt-in only.** `repl_spawn` accepts `record: bool | string` defaulting
   to `false`. No session records unless the caller explicitly sets
   `record: true` or supplies a `castPath`.

2. **Payload redaction.** All bytes written to `.cast` pass through
   `redaction::redact()` in the Rust reader thread *before* any write. The
   same `[REDACTED]` substitutions applied to `SessionState.raw` and the
   vt100 grid are applied to asciicast events. Integration tests in
   `cli/tests/repl_observability.rs` read the *physical bytes* of the
   resulting file and assert that no live token appears (S6).

3. **Path confinement.** The file path is validated server-side:
   - The parent directory is resolved via `canonicalize()` (resolves
     macOS `/tmp → /private/tmp`, `/var → /private/var` symlinks).
   - `std::env::temp_dir()` is also canonicalized as the base.
   - The request is rejected with an error if the resolved parent does not
     `starts_with(&base)`. No file is created on rejection (S15).

4. **Atomic 0600 creation.**
   `OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)`
   sets read/write permissions atomically at `open(2)` time. There is no
   `set_permissions` call after the fact, eliminating the TOCTOU window. The
   `create_new` flag additionally prevents symlink-substitution attacks (S16).

5. **Header scrubbing.** The asciicast v2 header is
   `{"version":2,"width":W,"height":H,"timestamp":T}` only. No `env` block,
   no `title`, no `shell` field that could carry credentials (S16).

6. **Best-effort cleanup.** When a session is killed via `repl_kill` or the
   supervisor shuts down, the reader thread calls `std::fs::remove_file` on
   the `.cast` path. Errors are silently ignored to avoid blocking the kill
   path (S30).

7. **Zero new dependencies.** The recording path uses only `std::fs`,
   `std::io::BufWriter`, and `std::time::SystemTime` — all present in the
   Rust standard library. No new Cargo crates are introduced (R16, S24).

## Consequences

### Positive

- Developers can capture reproducible terminal sessions for debugging without
  manually transcribing terminal output.
- The opt-in nature and path confinement preserve the default-secure posture
  for all existing sessions.
- Redaction in the Rust reader thread ensures `.cast` files contain no raw
  credentials even if the caller forgets to sanitize their terminal session
  before recording.

### Negative / accepted risks

- A `.cast` file *does* persist terminal output to disk for the lifetime of
  the session (and briefly after, pending `remove_file`). Operators on
  security-sensitive systems should be aware of this and avoid `record:true`
  on sessions that handle long-lived secrets.
- `remove_file` is best-effort; a crash or SIGKILL before the cleanup path
  runs can leave the file on disk. It remains 0600 and inside temp dir, but
  operators should configure tmpwatch/systemd-tmpfiles if stricter lifecycle
  control is required.
- ANSI escape sequences in the raw PTY stream can theoretically split a
  secret token across escape boundaries, defeating single-pass regex
  redaction on the raw bytes. The asciicast format captures the raw stream;
  for the strongest redaction guarantee use `mode:'grid'` on snapshot instead
  (the vt100 renderer resolves escapes before regex matching). This is
  documented in the `repl_snapshot` tool description (S28).

## Revision of security.md

Control #3 has been updated in-place to document this sanctioned exception.
No other controls are modified.
