# Tasks: TUI-Observability — REPL Plugin 4.1.0

Change: claude-in-android
Capability: repl

---

## T0 — Verify baseline и routing агентов

**Plan step:** Шаг 0
**Requirements:** R1, R16, R17
**Scenarios:** S21, S24, S31

Exec-agent scope (из CLAUDE.md Executing):
- `cli/src/**/*.rs` → `voltagent-lang:rust-engineer` (PRIMARY)
- `src/**/*.ts` → `voltagent-lang:typescript-pro` (ВТОРИЧНО)

Верифицировать baseline факты (читать реальные файлы, не по памяти):
- `cli/src/plugins/repl/mod.rs` — текущий `version`, `api_version`, количество тулов
- `cli/src/plugins/repl/session.rs` — строки reader-треда (~145-160), поля `PtySession`, `SessionState`
- `cli/src/plugins/repl/supervisor.rs` — поля `SessionHandle`, `SessionSnapshot`
- `cli/src/plugins/repl/bridge.rs` — текущие dispatch-ветки, ready-фрейм
- `cli/Cargo.toml` — наличие regex/portable-pty/vt100 (runtime) и tempfile (dev)
- `.github/workflows/ci.yml:52` — текущая cargo test команда
- `src/plugins/repl/contract.test.ts` — текущий assert на количество тулов
- Подтвердить: `redaction.rs` ОТСУТСТВУЕТ в `cli/src/plugins/repl/`

### Acceptance (DoD)
- [ ] Все baseline факты задокументированы с точными номерами строк
- [ ] Подтверждено: `redaction.rs` не существует (PRIMARY задача создать)
- [ ] Scope-таблица агентов зафиксирована
- [ ] Код не изменён в этой таске

---

## T1 — Rust: миграция cols/rows в SessionState (PREREQUISITE)

**Plan step:** Шаг 1
**Requirements:** R5, R17
**Scenarios:** S17, S20, S21

**Агент:** `voltagent-lang:rust-engineer`

**Files:**
- EDIT `cli/src/plugins/repl/session.rs`
- EDIT `cli/src/plugins/repl/supervisor.rs`

**Ключевые ограничения:**
- Добавить `cols: u16, rows: u16` в `SessionState`; заполнять в `SessionState::new(cols, rows)`
- `supervisor.snapshot()` и `list()` читают размеры из `SessionState` под `state-lock`, НЕ из `PtySession.cols/rows` и НЕ из `SessionHandle`
- Убрать/задепрекейтить дублирующие поля `PtySession.cols`/`rows` (`session.rs:71-72`) и `SessionHandle.cols`/`rows` (`supervisor.rs:21-22`)
- Default `120x40` сохраняется (это prerequisite — НЕ менять дефолт)

### Acceptance (DoD)
- [ ] `SessionState` содержит `cols: u16, rows: u16`
- [ ] `supervisor.snapshot()` и `list()` читают из `SessionState` под локом
- [ ] Дублирующие поля в `PtySession`/`SessionHandle` убраны или помечены deprecated
- [ ] `cargo build --lib` зелёный

---

## T2 — Rust: создать redaction.rs (BLOCKER A — foundation)

**Plan step:** Шаги 2, 3, 4
**Requirements:** R3, R4, R16
**Scenarios:** S5, S6, S7, S27, S29

**Агент:** `voltagent-lang:rust-engineer`

**Files:**
- CREATE `cli/src/plugins/repl/redaction.rs`
- EDIT `cli/src/plugins/repl/mod.rs` — добавить `pub mod redaction;` ПЕРВЫМ

**Ключевые ограничения:**
- `REDACTION_PATTERNS = OnceLock<Vec<(&'static str, Regex)>>` — 9 паттернов, одна инициализация
- Порядок паттернов (EXPECTED_PATTERN_NAMES): aws-access-key, aws-secret, github-pat,
  anthropic-key, openai-key, bearer-token, jwt, google-api-key, slack-token
- `aws-secret` — НЕТ lookbehind/lookahead в `regex 1.10`:
  ```
  (?:^|([^A-Za-z0-9/+=]))([A-Za-z0-9/+=]{40})(?:([^A-Za-z0-9/+=])|$)
  ```
  с `replace_all` ЗАМЫКАНИЕМ реконструирующим `pre_boundary + "[REDACTED]" + post_boundary`,
  заменяя ТОЛЬКО captured group токена (НЕ весь match — иначе съест соседний символ)
- `bearer-token`: `(?i)\bBearer\s+[A-Za-z0-9._\-]+` (Rust regex поддерживает `\b`)
- fail-closed: `std::panic::catch_unwind(|| redact_inner(input)).unwrap_or_else(|_| "[REDACTED]".to_string())`
- `pub fn redact(input: &str) -> String`
- `pub mod redaction;` объявить ПЕРВЫМ в `mod.rs` (до session/supervisor/bridge)

### Acceptance (DoD)
- [ ] `redaction.rs` создан, 9 паттернов в порядке EXPECTED_PATTERN_NAMES
- [ ] `pub mod redaction;` — первая строка в mod.rs
- [ ] `redact("")` → `""`; `redact("no secrets")` → `"no secrets"`
- [ ] fail-closed: adversarial input → `"[REDACTED]"`, не panic и не raw byte
- [ ] `cargo build --lib` зелёный

---

## T3 — Rust: parity-тест и общая фикстура

**Plan step:** Шаг 10a
**Requirements:** R4, R15
**Scenarios:** S27, S29

**Агент:** `voltagent-lang:rust-engineer`

**Files:**
- EDIT `cli/src/plugins/repl/redaction.rs` — добавить `#[cfg(test)]` блок
- CREATE `tests/fixtures/secret-samples.txt` (репо-корень)

**Ключевые ограничения:**
- `#[test] fn pattern_names_parity()`: сравнить имена из `REDACTION_PATTERNS` с
  hardcoded `EXPECTED_PATTERN_NAMES` (9 имён — guard разошедшихся списков Rust/TS)
- `#[test] fn behaviour_parity_fixture()`:
  ```rust
  include_str!("../../../../tests/fixtures/secret-samples.txt")  // 4 уровня вверх от redaction.rs
  ```
  Каждая строка → `redact()` → `assert!(out.contains("[REDACTED]"))` И `assert!(!out.contains(trimmed_original))`
- `#[test] fn back_to_back_secrets()`: два секрета через один разделитель → ОБА `[REDACTED]`
- `secret-samples.txt` ОБЯЗАН включать: `sk-ant-api03-xxx`, `AKIAIOSFODNN7EXAMPLE`,
  `ghp_16C7e42F292c6912E7710c838347Ae178B4a`, `xoxb-111-222-aaaaa`, minimal JWT (`eyJhbGc...`),
  `Bearer abc.def.ghi`, `AIzaSyXXXXX`, 40-char `[A-Za-z0-9/+=]{40}` aws-secret

### Acceptance (DoD)
- [ ] `tests/fixtures/secret-samples.txt` создан, >= 8 строк сэмплов
- [ ] `cargo test --lib` зелёный (все 3 новых теста)
- [ ] `include_str!` путь корректен: 4 уровня вверх от `cli/src/plugins/repl/redaction.rs`

---

## T4 — Rust: session.rs — filmstrip ring-buffer + raw-cap + reader-тред

**Plan step:** Шаг 5
**Requirements:** R6, R13, R14
**Scenarios:** S6, S7, S8, S9, S25, S26

**Агент:** `voltagent-lang:rust-engineer`

**Files:**
- EDIT `cli/src/plugins/repl/session.rs`

**Ключевые ограничения:**
```rust
struct FilmstripFrame { captured_at: SystemTime, grid: String }
const FILMSTRIP_CAP: usize = 50;
const RAW_BUFFER_CAP_BYTES: usize = 256 * 1024;
// в SessionState:
filmstrip: VecDeque<FilmstripFrame>,
```
Reader-тред переписать (session.rs:145-160) в СТРОГОМ порядке:
1. `let redacted = redaction::redact(&chunk_str);` — ВНЕ mutex
2. Asciicast write `redacted` в LOCAL `BufWriter<File>` — ВНЕ mutex
3. Под локом:
   - `s.vt.process(&raw_bytes);`
   - `let grid = s.vt.screen().contents();` — ПОСЛЕ vt.process
   - `s.filmstrip.push_back(FilmstripFrame{captured_at:SystemTime::now(), grid});`
   - `if s.filmstrip.len() > FILMSTRIP_CAP { s.filmstrip.pop_front(); }`
   - `s.raw.push_str(&redacted);`
   - `if s.raw.len() > RAW_BUFFER_CAP_BYTES { /* drain from front */ }`

Кадр захватывается ТОЛЬКО здесь, НИКОГДА в send/key dispatch.

### Acceptance (DoD)
- [ ] `FilmstripFrame` определён, `FILMSTRIP_CAP=50`, `RAW_BUFFER_CAP_BYTES=256*1024`
- [ ] Редакция ВНЕ mutex, I/O ВНЕ mutex
- [ ] Кадр снимается ПОСЛЕ `vt.process` (post-chunk grid)
- [ ] Cap drain для raw реализован
- [ ] `cargo build --lib` зелёный

---

## T5 — Rust: asciicast v2 tee + castPath validation

**Plan step:** Шаги 6
**Requirements:** R9, R10
**Scenarios:** S12, S13, S14, S15, S16, S30

**Агент:** `voltagent-lang:rust-engineer`

**Files:**
- EDIT `cli/src/plugins/repl/session.rs`

**Ключевые ограничения:**

**castPath validation** (СТРОГО В ПОРЯДКЕ — path-traversal guard):
1. `cast_path.parent()` → `canonicalize(parent)` (файл ещё не создан — канонизировать РОДИТЕЛЯ)
2. `base = std::env::temp_dir().canonicalize().unwrap_or_else(|_| std::env::temp_dir())` — ОБЕ стороны
3. Reject если `!canon_parent.starts_with(&base)` — БЕЗ создания файла
4. `OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)` — атомарно

**Header** (scrub env-секретов):
```json
{"version":2,"width":cols,"height":rows,"timestamp":<unix_epoch_secs>}
```
БЕЗ `env` и `title` полей.

**JSONL events**: `[elapsed_secs_f64,"o",redacted_str]\n`

**EOF cleanup**: `cast_writer.take()` → `flush().ok()` → drop (НЕ полагаться на Drop)

**kill/Drop cleanup**: `let _ = std::fs::remove_file(&cast_path);` (best-effort, ignore error)

**Default path** при `record:true` без castPath: `temp_dir().join(format!("{}.cast", id))`

ВАЖНО: `std::env::temp_dir()` в проде, НЕ `tempfile::TempDir` (dev-only в `cli/tests/`)

### Acceptance (DoD)
- [ ] `../../etc/x` → Err, файл не создан вне temp_dir
- [ ] `/etc/passwd` → Err
- [ ] Default path = `temp_dir()/<id>.cast`
- [ ] 0600 права атомарно при создании (не set_permissions после)
- [ ] `create_new` защита от перезаписи/symlink
- [ ] Header без env-полей
- [ ] `flush().ok()` перед drop на EOF
- [ ] best-effort remove на kill/Drop
- [ ] `cargo build --lib` зелёный

---

## T6 — Rust: supervisor.rs — SessionSnapshot + resize + SpawnResult

**Plan step:** Шаги 7
**Requirements:** R2, R7, R8, R9, R11
**Scenarios:** S1, S2, S3, S10, S11, S12, S13, S17, S18

**Агент:** `voltagent-lang:rust-engineer`

**Files:**
- EDIT `cli/src/plugins/repl/supervisor.rs`

**Ключевые ограничения:**

```rust
// SYNC-ANCHOR: Rust FilmstripFrameDto ↔ TS types.ts FilmstripFrame
// поля ОБЯЗАНЫ называться 'ts' (millis) и 'grid' (НЕ 'screen', НЕ 'capturedAt')
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FilmstripFrameDto {
    ts: u64,     // millis: captured_at.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
    grid: String,
}

// SessionSnapshot расширение:
#[serde(skip_serializing_if = "Option::is_none")]
pub raw: Option<String>,

#[serde(skip_serializing_if = "Option::is_none")]
pub frames: Option<Vec<FilmstripFrameDto>>,
```

`snapshot(id, mode, history)` логика:
- `mode="grid"` (default) → `raw=None`, `frames=None` — legacy форма БЕЗ изменений
- `mode="raw"` → `raw=Some(capped_raw)`, `screen=""` (НЕ omit — backward-compat типов)
- `mode="both"` → и `screen` и `raw`
- `history=true` → последние ~10 кадров; `history=N` → clamp до FILMSTRIP_CAP=50; `history=false/0/absent` → `frames=None`
- Пустой буфер + `history truthy` → `frames=Some(vec![])` (R8, S11)

`SpawnResult`:
```rust
#[serde(skip_serializing_if = "Option::is_none")]
pub cast_file: Option<String>,
```

`supervisor.resize(id, cols, rows)`:
1. `session.pty.resize(PtySize{rows,cols,pixel_width:0,pixel_height:0})?`
2. ЗАТЕМ под локом: `s.vt.set_size(rows, cols); s.cols=cols; s.rows=rows;`
3. Неизвестный id → `anyhow!("no session: {id}")`

### Acceptance (DoD)
- [ ] `FilmstripFrameDto` с полями `ts` (millis) и `grid` (НЕ screen/capturedAt)
- [ ] `skip_serializing_if` на `raw` и `frames`
- [ ] `mode='grid'` → legacy форма (нет raw, нет frames)
- [ ] `mode='raw'` → `screen=""`
- [ ] Пустой буфер + history → `frames:[]` (не null, не ошибка)
- [ ] `SpawnResult.cast_file` absent при `record:false`
- [ ] `supervisor.resize` обновляет PTY ЗАТЕМ vt, порядок соблюдён
- [ ] unknown session → `"no session: <id>"`
- [ ] `cargo build --lib` зелёный

---

## T7 — Rust: bridge.rs dispatch + mod.rs manifest

**Plan step:** Шаги 8, 9
**Requirements:** R2, R11, R12, R17
**Scenarios:** S4, S18, S22, S23

**Агент:** `voltagent-lang:rust-engineer`

**Files:**
- EDIT `cli/src/plugins/repl/bridge.rs`
- EDIT `cli/src/plugins/repl/mod.rs`

**Ключевые ограничения:**

**bridge.rs** — новые/изменённые dispatch-ветки:
- `"resize"` ветка: parse `{id, cols, rows}`, clamp `as_u64().clamp(1,1000) as u16` ДО каста, call `supervisor.resize`
- `"snapshot"` arm: `match mode { "grid"|"raw"|"both" => .., _ => bail!("invalid mode: {v}") }` (S4);
  parse `history` (as_u64/as_bool) независимо от `mode`
- `"spawn"` arm: parse `record` и `cast_path`, сериализовать `SpawnResult`-структуру (НЕ `json!({id})` вручную)
- Ready-фрейм `json!({event:ready,apiVersion:'1'})` НЕ трогать
- `disableRedaction` НЕ пробрасывать в Rust (нет ветки отключения редакции)

**mod.rs**:
- Бампнуть `version: "3.11.0"` → `"4.1.0"` (plugin version, НЕ apiVersion)
- Добавить `"repl_resize"` 8-м в `manifest.tools`
- `api_version` ОСТАВИТЬ `"1"` — НЕ трогать
- Добавить unit-тест:
  ```rust
  #[test]
  fn manifest_tool_count_and_version() {
      assert_eq!(manifest.tools.len(), 8);
      assert_eq!(manifest.version, "4.1.0");
  }
  ```

### Acceptance (DoD)
- [ ] `"resize"` arm реализован, clamp 1..=1000
- [ ] `"snapshot"` arm валидирует mode, reject invalid
- [ ] `"spawn"` arm использует SpawnResult структуру (castFile опционален)
- [ ] Ready-фрейм неизменён (`apiVersion:'1'`)
- [ ] `manifest.tools.len() == 8`
- [ ] `version == "4.1.0"` в mod.rs
- [ ] `api_version == "1"` в mod.rs
- [ ] Unit-тест на manifest проходит
- [ ] `cargo build --lib` зелёный, `cargo test --lib` зелёный

---

## T8 — Rust: интеграционные тесты на реальном супервизоре

**Plan step:** Шаг 10b
**Requirements:** R1, R3, R4, R5, R6, R7, R10, R11, R14
**Scenarios:** S6, S12, S14, S15, S17, S18, S19, S26, S29, S31

**Агент:** `voltagent-lang:rust-engineer`

**Files:**
- CREATE `cli/tests/repl_observability.rs`

**Тест-кейсы (реальный супервизор, НЕ моки):**

**(a) cast redaction gate — security-гейт:**
Spawn `bash -c 'echo sk-ant-XXXXXX'` с `record:true` →
прочитать ФИЗИЧЕСКИЕ байты `.cast` (НЕ результат snapshot) →
`assert!(bytes.contains(b"[REDACTED]"))` И `assert!(!bytes.contains(b"sk-ant-XXXXXX"))`

**(b) mode:'both'/'raw' redacted:**
Snapshot с `mode:'both'` после вывода с секретом →
`raw` содержит `[REDACTED]`, НЕ токен

**(c) resize correctness (stale cols/rows guard):**
Spawn `80x24` → `resize(100, 30)` → snapshot →
`assert_eq!(snapshot.cols, 100)` и `assert_eq!(snapshot.rows, 30)`

**(d) path-traversal reject:**
`castPath="../../etc/x"` → Err, файл не создан;
`castPath="/etc/passwd"` → Err, файл не создан

**(e) filmstrip cap:**
`FILMSTRIP_CAP + 5` send/key с выводом →
`assert!(filmstrip.len() <= FILMSTRIP_CAP)`

**(f) fail-closed redaction:**
`redaction::redact("adversarial input")` → не panic, возвращает строку (или `[REDACTED]`)

**(g) unknown resize session:**
`supervisor.resize("nonexistent", 80, 24)` → Err содержит `"no session: nonexistent"`

**(h) raw cap:**
Большой вывод > 256KB → `snapshot mode:'raw'`.raw.len() <= 256*1024

**ВАЖНО:** все cast-пути через `tempfile::TempDir` с уникальными id (NOT `/tmp/static_id.cast`).

### Acceptance (DoD)
- [ ] `cli/tests/repl_observability.rs` создан
- [ ] Все 8 тест-кейсов реализованы
- [ ] `cargo test --test repl_observability` зелёный
- [ ] Нет статических `/tmp/<id>.cast` путей

---

## T9 — CI: additive расширение ci.yml

**Plan step:** Шаг 11
**Requirements:** R15, R16
**Scenarios:** S24

**Агент:** `voltagent-lang:typescript-pro`

**Files:**
- EDIT `.github/workflows/ci.yml`

**Ключевые ограничения:**
- Строка 52 сейчас: `cd cli && cargo test --lib && cargo test --test setup_grok`
- Заменить на: `cd cli && cargo test --lib && cargo test --test setup_grok && cargo test --test repl_observability`
- НЕ заменять на голый `cargo test` (подхватит будущие непреднамеренные тесты)
- Без этого `repl_observability` security-гейт молча пропускается в CI — G5-паттерн

### Acceptance (DoD)
- [ ] `ci.yml` расширен additive (setup_grok НЕ удалён)
- [ ] `repl_observability` добавлен следующим `&&`
- [ ] Минимальное изменение (только одна строка)

---

## T10 — TS: types.ts + index.ts (defense-in-depth)

**Plan step:** Шаг 12
**Requirements:** R2, R7, R9, R11, R12, R17
**Scenarios:** S1, S2, S3, S5, S21, S22

**Агент:** `voltagent-lang:typescript-pro`

**Files:**
- EDIT `src/plugins/repl/types.ts`
- EDIT `src/plugins/repl/index.ts`

**types.ts добавить:**
```typescript
// SnapshotArgs
mode?: 'grid' | 'raw' | 'both';
history?: boolean | number;

// SessionSnapshot
raw?: string;
// SYNC-ANCHOR: Rust FilmstripFrameDto ↔ TS FilmstripFrame
// поля: ts (millis, u64) и grid (НЕ screen, НЕ capturedAt)
frames?: Array<{ ts: number; grid: string }>;

// SpawnArgs
record?: boolean;
castPath?: string;

// SpawnResult
castFile?: string;

// Новый тип
export interface ResizeArgs { id: string; cols: number; rows: number; }
```

**index.ts:**
- `applyRedactionToSnapshot`: применить к `screen` (уже есть) + `raw` (если присутствует) + каждый `frames[i].grid`
- Добавить `repl_resize` в `toolDefinitions()` и `REPL_PLUGIN_MANIFEST.tools`
- `inputSchema` для `repl_snapshot`: `mode` enum default `'grid'`, `history` (boolean or integer 1..50 maximum:50)
- `version: '3.11.0'` → `'4.1.0'`
- `apiVersion` ОСТАВИТЬ `'1'`

### Acceptance (DoD)
- [ ] `types.ts`: все новые типы добавлены, SYNC-ANCHOR комментарий
- [ ] `applyRedactionToSnapshot` покрывает raw и frames[].grid
- [ ] `repl_resize` в toolDefinitions и REPL_PLUGIN_MANIFEST.tools
- [ ] `version: '4.1.0'`, `apiVersion: '1'`
- [ ] `vitest run` (существующие тесты) зелёный

---

## T11 — TS: тесты — contract, security, parity

**Plan step:** Шаг 12
**Requirements:** R4, R12, R15
**Scenarios:** S5, S22, S27

**Агент:** `voltagent-lang:typescript-pro`

**Files:**
- EDIT `src/plugins/repl/contract.test.ts`
- EDIT `src/plugins/repl/security.test.ts`
- EDIT `src/plugins/repl/index.test.ts` (если существует)

**contract.test.ts:**
- Обновить: `7 → 8` в assert на количество тулов
- Добавить `'repl_resize'` в ожидаемый массив
- Assert: `apiVersion === '1'` (сохранить)
- Assert: `version === '4.1.0'` (добавить)

**security.test.ts:**
- Добавить тесты: `snapshot mode:'raw'` и `mode:'both'` — поле raw не содержит живой токен
- Добавить тест: каждый `frames[i].grid` редактирован (не содержит токен)
- `SHARED_SECRET_SAMPLES` читать из `tests/fixtures/secret-samples.txt` (единый источник правды с Rust T3)
- Добавить anchor комментарий: `// Rust parity: cli/src/plugins/repl/redaction.rs REDACTION_PATTERNS must list same 9 names`
- Canonical `EXPECTED_PATTERN_NAMES` массив: те же 9 имён что в Rust

### Acceptance (DoD)
- [ ] `contract.test.ts` assert: 8 тулов, version `'4.1.0'`, apiVersion `'1'`
- [ ] `security.test.ts` тесты raw/both/frames redaction
- [ ] `SHARED_SECRET_SAMPLES` читает из `tests/fixtures/secret-samples.txt`
- [ ] Anchor комментарий добавлен
- [ ] `vitest run` зелёный на всех новых тестах

---

## T12 — Docs: security.md + ADR (ДО merge)

**Plan step:** Шаг 13
**Requirements:** R9, R10, R12
**Scenarios:** S16, S23

**Агент:** `voltagent-lang:typescript-pro`

**Files:**
- EDIT `docs/security.md`

**Ключевые ограничения:**
- Добавить раздел для 4.1.0: asciicast (`.cast`) = ЕДИНСТВЕННОЕ санкционированное
  исключение control #3 ('scrollback never persisted to disk')
- Задокументировать все controls: opt-in (record:false default), path-confined в `temp_dir`,
  0600 + `create_new` (атомарно), fail-closed redaction, header-scrubbed от env-секретов,
  best-effort `remove_file` на kill/Drop
- Задокументировать новые egress-поверхности `raw`/`filmstrip` и их редакцию
- Отметить риск split-token на `mode:'raw'` (ANSI escape sequences)
- Без этого спека помечает фичу как release-блокер

### Acceptance (DoD)
- [ ] `security.md` содержит раздел для 4.1.0
- [ ] Все 6 controls задокументированы
- [ ] Нет упоминания `apiVersion:'2'`

---

## T13 — VALIDATION (evidence-based, release gate)

**Plan step:** Шаг 14
**Requirements:** ВСЕ (R1-R17)
**Scenarios:** ВСЕ (S1-S31)

### Validation checklist

**ОБЯЗАТЕЛЬНО первым:**
- [ ] `git diff cli/src/plugins/repl/` **непустой** — содержит: `redaction.rs` (новый), `session.rs`, `supervisor.rs`, `bridge.rs`, `mod.rs` (изменены)
  - Если пуст → **HELD, рецидив G5** — фича не написана

**Build:**
- [ ] `cd cli && cargo build --release` зелёный
- [ ] `cd cli && cargo test --lib` зелёный
- [ ] `cd cli && cargo test --test repl_observability` зелёный
- [ ] `cd cli && cargo test --test setup_grok` зелёный

**Runtime smoke (реальный супервизор, не мок):**
- [ ] `printf '{"id":"r1","method":"shutdown"}' | cli/target/release/mcp-devices repl-supervisor`
  → первая строка: `{event:ready,apiVersion:'1'}`, вторая: `{id:r1,result:ok}`
- [ ] `apiVersion` в ready-фрейме == `'1'` (не `'2'`)
- [ ] Spawn + `snapshot({id})` без новых параметров → legacy форма (нет raw, нет frames, нет castFile)
- [ ] Spawn + `snapshot({id, mode:'raw'})` → raw присутствует, screen=""
- [ ] Spawn с `record:true` + kill → `.cast` файл существует, первая строка парсится как `{version:2,...}`

**TS тесты:**
- [ ] `vitest run` зелёный
- [ ] contract: ровно 8 тулов, version `'4.1.0'`, apiVersion `'1'`
- [ ] security parity: общая фикстура + name guard зелёные

**Backward-compat:**
- [ ] `repl_snapshot({id})` без новых параметров: ответ идентичен пре-4.1.0 форме
- [ ] `repl_spawn({id, cmd})` без `record`: ответ строго `{id}`, нет castFile
- [ ] apiVersion везде `'1'`
- [ ] Нет новых крейтов в `Cargo.lock` (только version-string бампы)
- [ ] `tempfile` не просочился в non-test прод-путь

**Out of scope (НЕ трогать):**
- [ ] Container/tmux/ttyd не изменены
- [ ] Нет новых Cargo или npm пакетов
