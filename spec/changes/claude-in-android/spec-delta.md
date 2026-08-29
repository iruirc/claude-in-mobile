# Spec Delta: repl

Change: claude-in-android

## ADDED Requirements

### R1. The system SHALL реализовать в cli/src/plugins/repl/ (Rust) полный серверный слой observability: bridge.rs dispatch ОБЯЗАН добавить ветку 'resize', snapshot-arm — обрабатывать mode/history и валидировать mode; supervisor.rs SessionSnapshot ОБЯЗАН получить поля raw/frames; session.rs SessionState — filmstrip ring + raw-cap + redaction в reader-треде; НОВЫЙ redaction.rs. git diff по cli/src/plugins/repl/*.rs ОБЯЗАН быть непустым (иначе фича не написана — рецидив G5).

#### Scenario: S31 (error)
- WHEN после реализации выполнить git diff по cli/src/plugins/repl/
- THEN diff непустой: redaction.rs новый + session.rs/supervisor.rs/bridge.rs/mod.rs изменены; если пуст — HELD (рецидив G5), фича не написана

---

### R2. The system SHALL принимать опциональный параметр mode ('grid'|'raw'|'both', default 'grid') на repl_snapshot: 'grid' -> vt100-рендер в поле screen, 'raw' -> редактированный capped SessionState.raw в поле raw (screen=""), 'both' -> оба поля; при отсутствии mode форма ответа байт-идентична пре-4.1.0 {id,status,screen,exitCode,cols,rows}; невалидный mode отвергается на уровне bridge с ошибкой 'invalid mode: <v>' без мутации состояния.

#### Scenario: S1 (happy)
- WHEN вызвать repl_snapshot на живой сессии БЕЗ параметра mode
- THEN ответ = legacy-объект {id,status,screen,exitCode,cols,rows} с grid-контентом в screen, без полей raw/frames, форма байт-идентична пре-4.1.0

#### Scenario: S2 (happy)
- WHEN вызвать repl_snapshot с mode:'both' после вывода сессии
- THEN ответ содержит и screen (vt100-рендер) и raw (редактированный PTY-поток), не опуская ни одного

#### Scenario: S3 (edge)
- WHEN вызвать repl_snapshot с mode:'raw'
- THEN ответ содержит редактированный raw; screen="" (пустая строка для backward-compat типов, НЕ omit); frames отсутствует

#### Scenario: S4 (error)
- WHEN вызвать repl_snapshot с mode:'zzz' (невалидный enum)
- THEN запрос отвергнут на уровне bridge {id,error:'invalid mode: zzz'}, состояние не мутировано (НЕ тихий дефолт в grid)

#### Scenario: S28 (edge)
- WHEN секрет в raw физически расщеплён ANSI/vt100 escape-последовательностями (репозиционирование курсора в password-промпте), single-pass regex не матчит его на raw
- THEN mode:'grid' (дефолт) всё равно редактирует его через рендер-screen; редакция применена best-effort к raw; описание тула флагит mode:'raw' как менее защищённую поверхность

---

### R3. The system SHALL создать cli/src/plugins/repl/redaction.rs (объявить pub mod redaction ПЕРВЫМ в mod.rs), портировать 9 паттернов на regex 1.10 в OnceLock<Vec<(&'static str,Regex)>> в порядке EXPECTED_PATTERN_NAMES, экспортировать pub fn redact(&str)->String, и применять редакцию fail-closed (panic/ошибка -> [REDACTED], НИКОГДА сырой байт) в reader-треде ДО записи в raw/cast/frame.

#### Scenario: S5 (error)
- WHEN raw-поток и grid оба содержат токен паттерна (напр. ghp_...) и запрошен mode:'both'
- THEN токен заменён на [REDACTED] в ОБОИХ полях screen и raw ответа

#### Scenario: S6 (error)
- WHEN filmstrip-кадр или asciicast event-payload содержит секрет и record:true
- THEN токен [REDACTED] и в возвращённом кадре, и в ФИЗИЧЕСКИХ байтах .cast-файла (проверяется чтением байтов файла); живого токена нет

#### Scenario: S7 (error)
- WHEN Rust-редактор получает вход, вызывающий ошибку/панику на raw/cast/frame пути
- THEN путь отдаёт [REDACTED] fail-closed, НИКОГДА не эмитит сырой байт, сессия не повреждена

---

### R4. The system SHALL достичь поведенческого parity с TS-редактором на общей фикстуре tests/fixtures/secret-samples.txt: aws-secret и bearer-token (в TS используют lookbehind/lookahead, отсутствующий в Rust regex 1.10) переписать через захват-группы границ с реконструкцией в replace_all-замыкании, заменяя ТОЛЬКО captured-группу токена; ноль false-negative на общих сэмплах (лишние false-positive допустимы); два back-to-back секрета через один разделитель ОБА -> [REDACTED].

#### Scenario: S27 (error)
- WHEN общая фикстура secret-samples.txt (AKIA, aws-secret 40-char, ghp/gho/ghu, sk-ant, sk-, Bearer, JWT, AIza, xox) прогнана через Rust redact и TS redactScreen
- THEN каждый сэмпл -> [REDACTED] без живого токена на обеих сторонах; pattern-name guard (9 имён) подтверждает что списки не разошлись

#### Scenario: S29 (edge)
- WHEN два back-to-back секрета разделены одним символом-разделителем в raw (overlapping-match проблема regex crate)
- THEN ОБА токена -> [REDACTED], ни один не пропущен (zero false-negative на границах)

---

### R5. The system SHALL мигрировать cols/rows в SessionState как единый источник правды: добавить cols:u16,rows:u16 в SessionState (заполнять в SessionState::new), заставить supervisor.snapshot()/list() читать размеры из SessionState под state-lock, и убрать/задепрекейтить дублирующие PtySession.cols/rows (session.rs:62-63) и SessionHandle.cols/rows (supervisor.rs:21-22), чтобы после resize не осталось stale-источника.

#### Scenario: S17 (happy)
- WHEN repl_resize cols:100,rows:30 на живой сессии 80x24
- THEN PTY master ресайзнут (MasterPty::resize), vt100 grid стал 30x100 (set_size ПОСЛЕ pty.resize), последующий repl_snapshot репортит cols:100,rows:30 из SessionState

---

### R6. The system SHALL поддерживать bounded filmstrip ring-buffer FILMSTRIP_CAP=50 из FilmstripFrame{captured_at:SystemTime, grid:String} в SessionState; кадр снимается в reader-треде ПОСЛЕ vt.process (grid=screen_text()), НЕ в send/key dispatch; при переполнении вытесняется старейший (pop_front).

#### Scenario: S8 (happy)
- WHEN выполнить 3 repl_send, каждый производит вывод
- THEN ring-buffer держит >=3 grid-кадра с различными монотонными captured_at, каждый снят ПОСЛЕ vt.process (post-response grid)

#### Scenario: S9 (edge)
- WHEN выполнить FILMSTRIP_CAP+5 send/key действий с выводом
- THEN буфер удерживает ровно 50 последних кадров, старейшие 5 вытеснены (pop_front)

---

### R7. The system SHALL принимать опциональный history (bool|int N) на repl_snapshot: при отсутствии/false/0 -> legacy-форма без frames; при truthy -> поле frames как массив {ts:u64(millis),grid:String} в хронологическом порядке, до N (clamp до FILMSTRIP_CAP=50; true -> ~10) последних кадров, каждый grid редактирован. Rust FilmstripFrameDto ОБЯЗАН сериализовать поле как 'grid' (НЕ 'screen') и 'ts' в миллисекундах — иначе TS applyRedactionToSnapshot теряет поле (silent bypass).

#### Scenario: S10 (happy)
- WHEN вызвать repl_snapshot с history:2 после 4 захваченных кадров
- THEN ответ содержит frames — массив 2 последних {ts,grid} в хронологическом порядке, каждый grid редактирован; поле называется 'grid' и 'ts' в millis

---

### R8. The system SHALL возвращать пустой массив frames:[] (никогда null, никогда ошибка) когда history запрошен, но кадров ещё нет (нет send/key после spawn).

#### Scenario: S11 (edge)
- WHEN вызвать repl_snapshot с history:5 сразу после spawn без send/key
- THEN ответ содержит frames:[] (пустой массив), не ошибка и не null

---

### R9. The system SHALL принимать опциональный record:bool (default false) и опциональный castPath на repl_spawn; при record:true reader-тред tee-ит РЕДАКТИРОВАННЫЕ байты с таймингами в asciicast v2 (header {version:2,width,height,timestamp} + JSONL строки [elapsedSeconds,'o',data]) в ЛОКАЛЬНЫЙ BufWriter<File> ВНЕ mutex, flush/close на EOF; spawn-arm сериализует SpawnResult-структуру с cast_file:Option (skip_serializing_if) -> repl_spawn возвращает {id,castFile} при record:true и строго {id} иначе.

#### Scenario: S12 (happy)
- WHEN repl_spawn с record:true, прогнать вывод, kill сессии
- THEN существует <id>.cast: первая строка парсится как {version:2,width,height,...}, последующие как [number,'o',string]; spawn-результат содержал castFile

#### Scenario: S13 (happy)
- WHEN repl_spawn БЕЗ record
- THEN .cast файл не создан, spawn-результат строго {id} без поля castFile

#### Scenario: S14 (edge)
- WHEN супервизор умирает (закрытие родительского stdin) при открытом cast-файле
- THEN reader-тред flush/close cast чисто на EOF без битого/частичного header; runtime-smoke shutdown всё равно возвращает {id:r1,result:ok}

---

### R10. The system SHALL confine .cast файл в allowlisted temp-dir (std::env::temp_dir(), canonicalize ОБЕИХ сторон для macOS /var->/private/var symlink), отвергать path-traversal/absolute-escape в castPath (canonicalize parent, starts_with base) БЕЗ записи файла на отказ, создавать через OpenOptions create_new + mode(0o600) атомарно (НЕ set_permissions после — TOCTOU), скрабить env-секреты из header, best-effort remove_file на kill()/Drop.

#### Scenario: S15 (error)
- WHEN repl_spawn record:true с castPath='../../etc/x' или '/etc/passwd' вне base-dir
- THEN spawn отвергнут path-safety ошибкой, файл вне confined-директории не записан

#### Scenario: S16 (edge)
- WHEN .cast файл создан
- THEN права 0600 (атомарно через OpenOptions.mode, не set_permissions после), создан через create_new (падает если существует), header без env-секретов

#### Scenario: S30 (edge)
- WHEN сессия с record:true убита через repl_kill или Dropнута
- THEN best-effort remove_file удаляет <id>.cast; ошибка удаления игнорируется (не роняет kill)

---

### R11. The system SHALL добавить bridge.rs dispatch-ветку 'resize' (сейчас unknown method): ResizeRequest -> supervisor.resize -> MasterPty::resize ЗАТЕМ vt100 set_size (в этом порядке) + обновить cols/rows в SessionState под локом; clamp cols/rows в 1..=1000 на as_u64 ДО каста в u16; неизвестная сессия -> ошибка 'no session: <id>'; последующий snapshot репортит новый размер.

#### Scenario: S18 (error)
- WHEN repl_resize на несуществующем id сессии
- THEN bridge возвращает ошибку 'no session: <id>', состояние не мутировано

#### Scenario: S19 (edge)
- WHEN repl_spawn или repl_resize с rows:0 или cols:70000
- THEN значение clamp в 1..=1000 на as_u64 ДО каста в u16, grid/PTY не коллапсирует в ноль и не переполняется

---

### R12. The system SHALL зарегистрировать repl_resize как ОТДЕЛЬНЫЙ 8-й тул (не параметр key) атомарно в mod.rs manifest.tools (бампнуть version 3.11.0->4.1.0), index.ts toolDefinitions, contract.test.ts (массив 7->8); manifest apiVersion ОСТАЁТСЯ '1' и в mod.rs, и в bridge ready-фрейме (kernel-гейт, НЕ бампать — блокер B). Добавить в mod.rs unit-тест assert tools.len()==8 && version=="4.1.0".

#### Scenario: S22 (happy)
- WHEN запустить vitest contract-suite после изменения
- THEN REPL_PLUGIN_MANIFEST.tools == ровно 8 тулов [repl_spawn,repl_send,repl_key,repl_expect,repl_snapshot,repl_list,repl_kill,repl_resize], оба manifest.version == 4.1.0, apiVersion == '1'

#### Scenario: S23 (happy)
- WHEN runtime-smoke shutdown round-trip против release-бинаря: printf shutdown | mcp-devices repl-supervisor
- THEN ready-фрейм эмитит apiVersion:'1' (никогда '2'), shutdown возвращает {id:r1,result:ok}, без шага version-negotiation/handshake

---

### R13. The system SHALL держать критическую секцию reader-треда ограниченной: redaction и asciicast file-I/O (BufWriter локальный треду) выполняются ВНЕ SessionState Mutex, чтобы конкурентные list/snapshot/expect на других сессиях не стопорились сверх существующего <800ms бюджета (P1).

#### Scenario: S25 (edge)
- WHEN сессия A tee-ит большой cast, параллельно вызывается list/snapshot на сессии B
- THEN list/snapshot на B возвращается в пределах <800ms, доказывая что redaction и file-I/O шли ВНЕ shared SessionState lock

---

### R14. The system SHALL капить SessionState.raw на RAW_BUFFER_CAP_BYTES=256KB (drain от начала при переполнении) и filmstrip на 50 кадров, чтобы долгоживущие сессии не росли безгранично (OOM-защита).

#### Scenario: S26 (edge)
- WHEN долгоживущая сессия эмитит сильно больше 256KB вывода
- THEN SessionState.raw остаётся capped на 256KB (старейшие байты drain от начала), mode:'raw' возвращает capped tail без OOM

---

### R15. The system SHALL добавить cli/tests/repl_observability.rs (интеграция на реальном супервизоре, НЕ моки) и расширить ci.yml:52 additive до 'cd cli && cargo test --lib && cargo test --test setup_grok && cargo test --test repl_observability', чтобы security-гейт физических cast-байтов гонялся в CI (без этого — silent-skip, G5-паттерн).

---

### R16. The system SHALL ввести ноль новых Cargo/npm зависимостей: resize/asciicast/redaction используют только portable-pty 0.9, vt100 0.15, regex 1.10, serde_json 1.0 в проде; tempfile 3 остаётся dev-only и используется ИСКЛЮЧИТЕЛЬНО в cli/tests/ (прод-путь cast confinement — std::env::temp_dir()).

#### Scenario: S24 (happy)
- WHEN CI инспектирует Cargo.lock и package-lock diff vs main
- THEN не появляется ни одного нового крейта/npm-пакета (только version-string бампы); tempfile не просочился в non-test прод-путь (release собирается)

---

### R17. The system SHALL сохранить каждый существующий контракт repl_* (spawn/send/key/expect/snapshot/list/kill) неизменным: все новые параметры опциональны с дефолтами, ни одно существующее поле не удалено/переименовано, новые поля ответа используют serde skip_serializing_if=Option::is_none; snapshot без новых параметров держит точную legacy-форму; default 120x40 сохранён.

#### Scenario: S20 (happy)
- WHEN repl_spawn без cols/rows
- THEN сессия создана в дефолте 120x40 (>=80x24 floor), legacy-поведение сохранено

#### Scenario: S21 (happy)
- WHEN воспроизвести полную пре-4.1.0 последовательность spawn->send->expect->snapshot->list->kill без новых параметров
- THEN каждый ответ совпадает с пре-4.1.0 формой (snapshot без raw/frames, spawn только {id}), существующие supervisor-integration + contract тесты проходят

---

## States

| State | Description |
|-------|-------------|
| **loading** | Сессия только что заспавнена, status='starting': repl_snapshot возвращает пустой/почти пустой grid со status:'starting'; history возвращает frames:[] (буфер ещё не наполнен); при record:true записан только header .cast, ещё нет 'o'-событий. |
| **empty** | Нет filmstrip-кадров (нет send/key после spawn) -> repl_snapshot с history>0 возвращает frames:[]; нет сессий вообще -> repl_list возвращает []; mode:'raw' на сессии без вывода возвращает raw:'' (пустая строка, не null). |
| **error** | Невалидный mode-enum, resize/snapshot на неизвестном id сессии, castPath traversal/absolute-escape, unterminated-quote cmd, unknown key, или rows/cols вне 1..=1000 -> bridge возвращает {id,error:'<message>'}; нет частичной мутации состояния; нет .cast-файла на отвергнутом spawn. |
| **offline** | Процесс супервизора не запущен / вышел до ready или посреди запроса -> TS-клиент реджектит с ReplBridgeError('supervisor not running' / 'supervisor exited ...'); pending-запросы падают быстро; мёртвая сессия (status:'dead') всё равно отвечает snapshot/list с последним grid, exitCode и последними известными cols/rows. |
| **populated** | Живая сессия с выводом: mode:'grid' возвращает рендер-screen; mode:'both' -> grid+raw (оба редактированы); history>0 -> хронологический frames[] последних редактированных grid; при record:true валидный 0600 <id>.cast накапливает редактированные [elapsed,'o',data] события; snapshot репортит текущие cols/rows из SessionState, отражая любой resize. |

## Business Rules

- **ИНВАРИАНТ — ноль новых зависимостей**: только portable-pty 0.9 + vt100 0.15 + regex 1.10 + serde_json 1.0 + (dev) tempfile 3, все уже присутствуют; любой новый крейт/npm-пакет проваливает релиз. tempfile — ТОЛЬКО dev-dep -> прод-путь cast confinement использует `std::env::temp_dir()`, НЕ крейт tempfile.
- **ИНВАРИАНТ — extend-only контракт**: каждый существующий repl_* контракт расширяется только; новые параметры опциональны с дефолтами; ни одно поле не удалено/переименовано; snapshot без новых параметров держит точную legacy-форму; новые поля ответа используют `skip_serializing_if=Option::is_none`.
- **ИНВАРИАНТ (security) — редакция на КАЖДОМ egress и КАЖДОЙ записи на диск**: grid, raw, каждый grid filmstrip-кадра и каждое asciicast-событие редактированы; raw/cast/frame путь, пропускающий редакцию, — утечка и release-блокер. Редакция выполняется в Rust (портированные REDACTION_PATTERNS на regex 1.10) в reader-треде ДО того как данные достигнут raw/cast/frame; TS redactScreen остаётся defense-in-depth для screen.
- **ИНВАРИАНТ (security) — редакция fail-closed**: любая ошибка/паника в редакторе даёт [REDACTED], никогда сырой байт, на raw/cast/frame пути.
- **ИНВАРИАНТ (security exception) — asciicast-на-диск = ЕДИНСТВЕННОЕ санкционированное нарушение security.md control #3** ('scrollback never persisted to disk'); ОБЯЗАН быть opt-in (record:false default), path-confined в allowlisted base, 0600, create_new, редактирован, header scrubbed от env-секретов, best-effort removed на kill/Drop, задокументирован в security.md + ADR ДО merge.
- **ИНВАРИАНТ — размер PTY авторитетен в одном месте**: SessionState cols/rows — единственный источник правды; resize обновляет И PTY master И vt100 parser (pty.resize ЗАТЕМ vt.set_size) и рефрешит cols/rows атомарно относительно этого источника; дубли PtySession/SessionHandle убраны.
- **ИНВАРИАНТ — apiVersion заморожен на '1'**: manifest.apiVersion остаётся '1' в mod.rs, index.ts и bridge ready-фрейме; это hard kernel-гейт регистрации (must==PLUGIN_API_VERSION). Никакого wire-protocol versioning, negotiation, handshake или client warning. Бампится только поле version плагина -> 4.1.0.
- **ИНВАРИАНТ — критическая секция reader-треда ограничена**: редакция и cast file-I/O выполняются вне SessionState Mutex; гарантия P1 (блокирующий expect на одной сессии никогда не замораживает list/snapshot или другие сессии, <800ms) должна держаться.
- **ИНВАРИАНТ — ограниченная память**: SessionState.raw capped на 256KB (drain-from-front), filmstrip capped на 50 кадров; нет безграничного роста для долгоживущих сессий.
- **RULE — false-positive допустимы, false-negative нет**: поскольку Rust regex лишён lookaround, aws-secret/bearer-token принимают более широкие матчи; parity с TS — по поведению на общей secret-sample фикстуре плюс pattern-name guard, не по идентичности текста паттерна.
- **RULE — filmstrip-кадры захватываются только в reader-треде ПОСЛЕ vt.process**, никогда в send/key dispatch, так что кадр всегда отражает post-response (рендер) grid, а не pre-response состояние.
- **RULE — history-дефолт ограничивает размер ответа**: когда history truthy но N не задан, вернуть ~10 последних кадров, чтобы держать ответы тула предсказуемыми и избежать переполнения контекста агента.
- **RULE (evidence-based validation, не mock-green)** — приёмка ТОЛЬКО если git diff по cli/src/plugins/repl/*.rs непуст, cargo build --release + cargo test --lib + cargo test --test repl_observability + cargo test --test setup_grok зелёные, и runtime-smoke реального супервизора возвращает {event:ready,apiVersion:'1'}+{id:r1,result:ok}; TS-тесты на StubBridge/CapturingBridge НЕ засчитываются как доказательство серверной части.
