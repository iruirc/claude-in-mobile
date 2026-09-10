# Release v4.3.0 — 2026-09-10

## Включено

- Исправлен запуск относительных REPL-команд в WSL: PTY-процессы наследуют безопасный allowlist переменных `PATH`, `HOME`, `LANG`, `LC_ALL` и `TZ` от native supervisor.
- Явные значения окружения конкретной REPL-сессии имеют приоритет над унаследованными.
- Версия `4.3.0` синхронизирована во всех 23 release-полях, npm lockfile и Cargo lockfile.
- CHANGELOG и GitHub Release содержат описание исправления и команды обновления.

## Закрытые issues

- Stage 0 gate: открытых issues перед релизом не было.
- Коммиты релиза не содержат `Closes #N`; follow-up комментарии не требовались.

## CI runs

- Release branch CI: [34534881566](https://github.com/AlexGladkov/claude-in-mobile/actions/runs/34534881566) — success, 6/6 jobs.
- Tag release workflow: [34534884593](https://github.com/AlexGladkov/claude-in-mobile/actions/runs/34534884593) — success, 8/8 jobs: setup, version verification, Darwin builds ×2, npm publish, GitHub Release, Homebrew update, checksum verification.
- Main CI after fast-forward: [34535811959](https://github.com/AlexGladkov/claude-in-mobile/actions/runs/34535811959) — success, 6/6 jobs.
- Local TypeScript verification: build passed; Vitest 74 files / 1501 tests passed.
- Local Rust verification: release build passed; required suites passed 165 tests total (`137 + 6 + 14 + 5 + 3`).
- Runtime smoke: Node `--version` and `--help` exited normally; release native supervisor returned ready/shutdown; a real `omp` TUI launched through the release supervisor in WSL and produced a ready snapshot.
- `npm pack` contained bundled `@mcp-devices/plugin-api`; installation into a clean `/tmp` project returned version `4.3.0`.

## Channels verification

- **GitHub:** [v4.3.0](https://github.com/AlexGladkov/claude-in-mobile/releases/tag/v4.3.0) is published with two native assets:
  - `claude-in-mobile-4.3.0-darwin-arm64.tar.gz` — 3,943,700 bytes, SHA-256 `edd38c6518ece0d04720b3630045e04086cd121114a16257a7445d21dbdc2a2f`.
  - `claude-in-mobile-4.3.0-darwin-x86_64.tar.gz` — 4,202,912 bytes, SHA-256 `95d292691e87db4b8fd62aeef7e7698474abe65e75dc87fa5376e35ace118304`.
- **npm:** `npm view mcp-devices@4.3.0 version` returned `4.3.0`; `latest` points to `4.3.0`; public `npx -y mcp-devices@4.3.0 --version` returned `4.3.0` from a clean directory.
- **Homebrew:** canonical `AlexGladkov/homebrew-tap/mcp-devices.rb` reports `4.3.0`; both formula checksums match the GitHub assets; release job `verify-checksums` passed.

## Известные ограничения / отложено

- Фактические `brew update`, `brew upgrade` и installed-binary smoke не запускались на этой WSL/Linux workstation: Homebrew/macOS недоступны. Публикация формулы и целостность обоих Darwin-архивов подтверждены release workflow и чтением канонической формулы.
- Матрица релиза публикует только Darwin ARM64 и x86_64 assets; Linux release asset отсутствует по текущей конфигурации workflow.
