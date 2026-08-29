# Proposal: TUI-Observability для REPL-плагина (release 4.1.0)

## Summary

TUI-observability для REPL-плагина: режимы snapshot (grid/raw/both), filmstrip ring-buffer,
asciicast v2 запись и PTY resize — всё с end-to-end редакцией секретов, без новых
Cargo/npm зависимостей и с полной обратной совместимостью с пре-4.1.0 контрактом.

PRIMARY-работа — РЕАЛЬНЫЙ Rust-сервер в `cli/src/plugins/repl/`, а не TS-моки.

## Зачем

LLM-агенты, использующие REPL-плагин, не могут наблюдать состояние TUI: они видят только
текущий vt100-рендер экрана через `repl_snapshot`. Четыре пробела блокируют agentic workflows:

| Пробел | Боль |
|--------|------|
| Нет raw PTY-потока | Агент не может отличить ожидание ввода от активного рендеринга |
| Нет временной истории | Агент должен делать snapshot синхронно после каждого действия |
| Нет записи | Нет audit trail того, что агент реально выполнил в TTY |
| Нет PTY resize | TUI-приложения (htop, vim) ломаются при неправильных размерах терминала |

## G5-провал — что было не так

Предыдущий прогон HELD на G5 именно потому, что:
- `git diff` по `cli/src/plugins/repl/*.rs` был **пустым** — Rust-сервер не трогали совсем
- TS-тесты работали на `StubBridge`/`CapturingBridge`, подставлявших уже-редактированные
  `raw`/`frames` — классическая ложная защита

Ground-truth проверен на реальных файлах репозитория:
- `redaction.rs` **ОТСУТСТВУЕТ** в `cli/src/plugins/repl/`
- `mod.rs` всё ещё `version="3.11.0"` с 7 тулами (НЕ 8)
- `session.rs:150-156`: reader-тред пишет СЫРЫЕ байты в `s.raw` без cap и без редакции под mutex
- `SessionState::new(cols,rows)` уже принимает размеры (миграция cols/rows в state тривиальна)
- `PtySession` хранит дублирующие stale `cols`/`rows` (`session.rs:71-72`)
- Фикстура лежит в РЕПО-КОРНЕ `tests/fixtures/secret-samples.txt` (НЕ в `cli/`)
- Интеграционные тесты идут в `cli/tests/`
- `ci.yml:52` = `cd cli && cargo test --lib && cargo test --test setup_grok`
- `cli/Cargo.toml` уже 4.1.0; regex/portable-pty/vt100 — runtime-деп; tempfile — ТОЛЬКО dev-dep

## Инварианты (нарушение = release-блокер)

1. **Ноль новых крейтов/npm**: portable-pty 0.9 + vt100 0.15 + regex 1.10 + serde_json 1.0 +
   (dev) tempfile 3 — все уже присутствуют
2. **apiVersion заморожен на '1'**: kernel-гейт регистрации; НЕ бампать ни в mod.rs,
   ни в bridge ready-фрейме, ни в index.ts
3. **Extend-only контракт**: все новые параметры опциональны с дефолтами;
   ни одно поле не удалено/переименовано; `serde skip_serializing_if=Option::is_none`
4. **Редакция на каждом egress и каждой записи на диск**: raw/cast/frame путь БЕЗ редакции = утечка
5. **Редакция fail-closed**: паника/ошибка → `[REDACTED]`, НИКОГДА сырой байт
6. **Критическая секция ограничена**: redaction и I/O ВНЕ SessionState Mutex (P1 <800ms)
7. **Ограниченная память**: raw cap 256KB, filmstrip cap 50 кадров

## Шаги реализации

### Шаг 0 — Routing по scope

Exec-agent scope:
- `cli/src/**/*.rs` → `voltagent-lang:rust-engineer` (PRIMARY)
- `src/**/*.ts` → `voltagent-lang:typescript-pro` (ВТОРИЧНО)

Rust ОБЯЗАН быть реализован первым; TS — только после.

### Шаг 1 (Rust, prerequisite) — Миграция cols/rows в SessionState

Добавить `cols:u16`, `rows:u16` в `SessionState`, заполнять в `SessionState::new`.
`supervisor.snapshot()` и `list()` читают размеры из `SessionState` под `state-lock`.
Убрать/задепрекейтить дублирующие поля `PtySession.cols`/`rows` (`session.rs:71-72`)
и `SessionHandle.cols`/`rows` (`supervisor.rs:21-22`).
Это prerequisite для корректности resize (S17) и фиксит баг stale-dimensions.

### Шаг 2 (Rust) — Новый модуль redaction.rs

Создать `cli/src/plugins/repl/redaction.rs`, объявить `pub mod redaction;` ПЕРВЫМ в `mod.rs`
(до session/supervisor/bridge — порядок разрешения зависимостей).

`REDACTION_PATTERNS = OnceLock<Vec<(&'static str,Regex)>>` — одна инициализация на все 9 паттернов.
Портировать 9 TS-паттернов в том же порядке:
1. aws-access-key
2. aws-secret
3. github-pat
4. anthropic-key
5. openai-key
6. bearer-token
7. jwt
8. google-api-key
9. slack-token

Экспортировать `pub fn redact(&str)->String`.

### Шаг 3 (Rust) — Lookaround-parity

`regex 1.10` не поддерживает lookbehind/lookahead:
- `aws-secret`: захват-группы `(?:^|([^A-Za-z0-9/+=]))([A-Za-z0-9/+=]{40})(?:([^A-Za-z0-9/+=])|$)`;
  `replace_all` с замыканием реконструирует `pre_boundary + '[REDACTED]' + post_boundary`,
  заменяя ТОЛЬКО captured group токена (не весь match — иначе съест соседний символ)
- `bearer-token`: `\b` поддерживается, `(?i)\bBearer\s+[A-Za-z0-9._\-]+`
- Тест: два back-to-back секрета через один разделитель — ОБА → `[REDACTED]`

### Шаг 4 (Rust) — fail-closed

```rust
std::panic::catch_unwind(|| redact_inner(input))
    .unwrap_or_else(|_| "[REDACTED]".to_string())
```

При любой панике/сбое — `[REDACTED]`, НИКОГДА сырой байт.
Regex `UnwindSafe` — замыкание не тащит Mutex/RefCell.

### Шаг 5 (Rust) — Filmstrip + raw-cap в session.rs

```rust
struct FilmstripFrame { captured_at: SystemTime, grid: String }
const FILMSTRIP_CAP: usize = 50;
const RAW_BUFFER_CAP_BYTES: usize = 256 * 1024;
```

Переписать reader-тред (`session.rs:145-160`):
1. `redacted = redaction::redact(&chunk)` ВНЕ mutex
2. Asciicast-запись `redacted` payload в локальный `BufWriter<File>` ВНЕ mutex
3. Под локом: `s.vt.process(RAW bytes)` → `grid=s.vt.screen().contents()` ПОСЛЕ process →
   `s.filmstrip.push_back(FilmstripFrame{captured_at:SystemTime::now(),grid})`; `pop_front` если `len>50`
4. `s.raw.push_str(&redacted)` с cap-drain до 256KB

Кадр снимается ПОСЛЕ `vt.process` (post-chunk grid, R3). Редакция+файловый I/O строго ВНЕ лока.

### Шаг 6 (Rust) — Asciicast v2 tee

Флаг `repl_spawn record:true|castPath`.

Path-guard СТРОГО в порядке (R7):
1. `parse castPath→PathBuf→parent()→canonicalize(parent)`
2. `base=std::env::temp_dir().canonicalize()` (macOS `/tmp→/private/tmp`)
3. Reject если `!canon_parent.starts_with(&base)` БЕЗ создания файла
4. `OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)` — атомарные права

Header `{version:2,width:cols,height:rows,timestamp:unix_ts}` БЕЗ env/title-блока.
Строки `[elapsed_sec_f64,"o",redacted_data]`.
`flush().ok()` через `take()` при выходе из reader-loop.
Best-effort `remove_file` на kill/Drop.

### Шаг 7 (Rust) — SessionSnapshot расширение

```rust
#[serde(skip_serializing_if = "Option::is_none")]
pub raw: Option<String>,

#[serde(skip_serializing_if = "Option::is_none")]
pub frames: Option<Vec<FilmstripFrameDto>>,

// SYNC-ANCHOR: Rust FilmstripFrameDto ↔ TS types.ts FilmstripFrame
// поля ОБЯЗАНЫ называться 'ts' (millis) и 'grid' (НЕ 'screen', НЕ 'capturedAt')
struct FilmstripFrameDto { ts: u64, grid: String }
```

`screen` остаётся всегда-присутствующим: при `mode:'raw'` → `screen:""` (backward-compat).
`snapshot()` обрабатывает `mode:'grid'|'raw'|'both'` и `history:true|N`.

### Шаг 8 (Rust) — bridge.rs dispatch

**(a)** Ветка `'resize'`: `ResizeRequest→supervisor.resize`; `MasterPty::resize` + `vt100 set_size`
   + обновить `cols`/`rows` в `SessionState`; clamp `1..=1000` на `as_u64()` ДО каста в u16.

**(b)** Snapshot-arm: валидировать `mode` в bridge:
   `match "grid"|"raw"|"both" => .., _ => bail!("invalid mode: {v}")` (S4).

**(c)** Spawn-arm: сериализовать `SpawnResult`-структуру с `cast_file:Option` (`skip_serializing_if`).

Ready-фрейм `bridge.rs:42` `json!({event:ready,apiVersion:'1'})` НЕ трогать.
`disableRedaction` из TS НЕ пробрасывать в bridge — ветки отключения редакции в Rust нет.

### Шаг 9 (Rust) — repl_resize как 8-й тул

Бампнуть `mod.rs version: "3.11.0"→"4.1.0"` (plugin-version, НЕ apiVersion).
Добавить `'repl_resize'` 8-м в `manifest.tools` (сейчас 7).
`api_version` ОСТАВИТЬ `'1'`.

Unit-тест в `mod.rs`:
```rust
assert_eq!(manifest.tools.len(), 8);
assert_eq!(manifest.version, "4.1.0");
```

### Шаг 10 (Rust-тесты — реальное поведение, НЕ моки)

**(a)** Parity-тест в `redaction.rs`:
- `EXPECTED_PATTERN_NAMES` == 9 имён из `mod.rs` (guard разошедшихся списков)
- Фикстура `include_str!("../../../../tests/fixtures/secret-samples.txt")` (репо-корень, 4 уровня вверх)
- Каждый сэмпл → `out.contains("[REDACTED]")` И `!out.contains(trimmed_live_token)`
- Back-to-back тест (два секрета через разделитель)

**(b)** `cli/tests/repl_observability.rs` (интеграция на реальном супервизоре):
- spawn bash → send строки с живым токеном → snapshot `mode:'both'/'raw'` → raw содержит `[REDACTED]`, НЕ токен
- `record:true` → прочитать ФИЗИЧЕСКИЕ байты `<id>.cast`, assert содержит `[REDACTED]` и НЕ токен
- filmstrip копит кадры, `history:N` отдаёт последовательность
- resize меняет размер grid
- unknown resize session → `'no session: <id>'`
- cap-тесты (raw≤256KB, filmstrip≤50)
- `../../etc/x` и `/etc/passwd` → `Err`, файла нет
- ВСЕ cast-пути через `tempfile::TempDir` с уникальными id (параллельный `cargo test` не коллизит)

### Шаг 11 (CI) — additive расширение

`ci.yml:52` additive-расширение:
```
cd cli && cargo test --lib && cargo test --test setup_grok && cargo test --test repl_observability
```

НЕ заменять на голый `cargo test` (подхватит будущие непреднамеренные тесты).
Без этого `repl_observability` (security-гейт физических cast-байтов) молча пропускается — G5-паттерн.

### Шаг 12 (TS — вторично, defense-in-depth)

`src/plugins/repl/`:
- `types.ts`: `FilmstripFrame{ts:number,grid:string}`, `SessionSnapshot` с optional raw/frames,
  `SpawnArgs.record`, `ResizeArgs`
- `index.ts`: `applyRedactionToSnapshot` покрывает `screen+raw+frames[].grid`,
  8 тулов в `toolDefinitions`, `manifest.version='4.1.0'`/`apiVersion='1'`
- `contract.test.ts`: массив ровно 8 тулов в каноническом порядке, `apiVersion==='1'`
- `security.test.ts`: `SHARED_SECRET_SAMPLES` == фикстура `tests/fixtures/secret-samples.txt`
- `repl_snapshot inputSchema`: добавить `history maximum:50`
- SYNC-ANCHOR комментарий: Rust `FilmstripFrameDto` ↔ `types.ts FilmstripFrame`

### Шаг 13 (Docs) — ADR ДО merge

`docs/security.md` + ADR: зафиксировать asciicast как САНКЦИОНИРОВАННОЕ исключение
control #3 ('scrollback never persisted'): opt-in (record:false default), path-confined
в `temp_dir`, 0600, `create_new`, redacted-payload, header-scrubbed, best-effort-removed.
Без этого спека помечает фичу как release-блокер (security exception).

### Шаг 14 (VALIDATION — evidence-based, НЕ mock-green)

1. `git diff cli/src/plugins/repl/` **непустой** — если Rust-diff пуст → HELD (рецидив G5)
2. `cd cli && cargo build --release` — зелёный
3. `cargo test --lib && cargo test --test repl_observability && cargo test --test setup_grok` — зелёные
4. Runtime-smoke реального супервизора:
   `printf '{"id":"r1","method":"shutdown"}' | cli/target/release/mcp-devices repl-supervisor`
   → `{event:ready,apiVersion:'1'}` + `{id:r1,result:ok}`
5. TS vitest — зелёный

Контейнер/tmux/ttyd НЕ трогаем.

## Затронутые слои

- `cli/src/plugins/repl/redaction.rs` (НОВЫЙ)
- `cli/src/plugins/repl/session.rs` (reader-тред, filmstrip, cap, asciicast, resize)
- `cli/src/plugins/repl/supervisor.rs` (SessionSnapshot, FilmstripFrameDto, resize)
- `cli/src/plugins/repl/bridge.rs` (dispatch: resize + snapshot mode + spawn SpawnResult)
- `cli/src/plugins/repl/mod.rs` (version→4.1.0, 8 тулов, unit-тест)
- `cli/tests/repl_observability.rs` (НОВЫЙ интеграционный тест)
- `.github/workflows/ci.yml` (additive расширение строки 52)
- `src/plugins/repl/` (TS — вторично)
- `tests/fixtures/secret-samples.txt` (общая фикстура Rust+TS)
- `docs/security.md` (ADR)

## Риски

| Риск | Митигация |
|------|-----------|
| **G5-рецидив**: Rust нетронут, TS-тесты зеленеют на моках | `git diff` Rust ОБЯЗАН быть непустым; integration-тест бьёт реальный супервизор |
| **False-closed редакция**: секрет в raw/cast/frame | `redaction::redact` в reader-треде ДО `push_str`/`BufWriter`; тесты читают ФИЗИЧЕСКИЕ байты `.cast` |
| **Path-traversal** в castPath | `canonicalize(parent)` + `starts_with(base)` ОБЕ стороны; тест `../../etc/x` и `/etc/passwd` → Err |
| **TOCTOU** при 0600 | `OpenOptions::mode(0o600)` атомарно + `create_new` (защита от symlink) |
| **aws-secret boundary** съедает соседний символ | `replace_all` замыкание реконструирует границы; тест back-to-back |
| **Wire-drift** `FilmstripFrameDto` поле `capturedAt` вместо `ts` | Явные serde-имена `'ts'`/`'grid'`; SYNC-ANCHOR; тест JSON-ключа |
| **tempfile крейт** в прод-пути → release не соберётся | Только `std::env::temp_dir()` в проде; `tempfile` — ТОЛЬКО в `cli/tests/` |
| **apiVersion бамп** → блокер B | `apiVersion='1'` в `mod.rs`, `bridge ready`, `index.ts` — не трогать |
| **CI silent-skip** repl_observability | Additive расширение `ci.yml:52` обязательно |
| **mutex poison** паника в reader-треде | Редакция+I/O строго ВНЕ лока (R13) |
| **Unbounded memory** (DoS) | raw cap 256KB drain, filmstrip cap 50 — оба обязательны |
| **Stale cols/rows** после resize | Единственный источник в `SessionState` (Шаг 1 prerequisite) |
| **best-effort remove** `.cast` не удаляется | `remove_file` на kill/Drop, ошибка игнорируется |
| **back-to-back секреты** (overlapping false-negative) | `replace_all` замыкание с реконструкцией границ; тест обязателен |
