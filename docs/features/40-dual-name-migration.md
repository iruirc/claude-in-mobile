# 4.0 — dual-name migration (claude-in-mobile → mcp-devices)

Date: 2026-08-13 · Branch: `release/4.0.0`

## Goal

4.0 renames the package `claude-in-mobile` → `mcp-devices`. Teaching every user
the new name is impractical, so **both names must keep installing AND updating**
on all three channels. Canonical name = `mcp-devices`; `claude-in-mobile` = a
maintained compatibility alias.

## Status

### Done (part 1 — npm core, committed `c0baa6f`)
- Root `mcp-devices` `bin` exposes **both** commands (`mcp-devices` +
  `claude-in-mobile`) → `dist/index.js`.
- Shim package `compat/claude-in-mobile` (published as `claude-in-mobile`):
  depends on `mcp-devices` at the same version, forwards the CLI in-process
  (`import("mcp-devices")`), one-time TTY migration notice. Locally validated:
  `--version` forwards to the real CLI.

### Done (part 2a — release.yml, this branch)
- `publish-npm` gains a "Publish claude-in-mobile compat shim" step: syncs the
  shim `version` and its `mcp-devices` dependency to the tag, then publishes
  (idempotent dist-tag move if already there). So `npm i -g claude-in-mobile@latest`
  always resolves the matching `mcp-devices` engine.

### Homebrew migration outcome

The canonical formula lives at the root of `AlexGladkov/homebrew-tap` as
`mcp-devices.rb`. Release automation updates only this unified tap.

The formula installs the `mcp-devices` binary and keeps both command aliases:

```ruby
def install
  bin.install "mcp-devices"
  bin.install_symlink bin/"mcp-devices" => "mcp-devices-cli"
  bin.install_symlink bin/"mcp-devices" => "claude-in-mobile"
end
```

Do not put `oldname` or `oldnames` in a Formula class. They are not supported
Formula DSL and make Homebrew reject the formula before installation. A
same-tap rename belongs in `formula_renames.json`; this project moved between
two external taps, so existing installations from
`AlexGladkov/homebrew-claude-in-mobile` must be reinstalled from
`AlexGladkov/homebrew-tap` manually.

The tarball asset name remains
`claude-in-mobile-<version>-<platform>.tar.gz`; the archive contains both
`mcp-devices` and `mcp-devices-cli`. This avoids churn in release URLs and
checksum verification.

## Net user experience after 4.0

| Channel | Old command still works? | Still updates? |
|---------|--------------------------|----------------|
| npm `claude-in-mobile` | yes (shim + bin alias) | yes (shim dep synced each release) |
| npm `mcp-devices` | n/a (new canon) | yes |
| brew `claude-in-mobile` | yes (binary alias in canonical formula) | reinstall from unified tap |
| brew `mcp-devices` | n/a (new canon) | yes |
| CLI command | both `mcp-devices` and `claude-in-mobile` available | — |

## Related 4.0-readiness note (separate)

The `release/4.0.0-dev` line has **5 pre-existing failing tests** in
`src/runtime/bootstrap.test.ts` (`getPlugin returns typed plugin instance` etc.)
— unrelated to dual-name, must be fixed before a real 4.0 release.
