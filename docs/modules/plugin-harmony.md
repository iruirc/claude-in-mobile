# Platform Plugin: HarmonyOS Next

Automate HarmonyOS Next devices through HDC and ArkXTest.

---

## Prerequisites

Install DevEco Studio or an OpenHarmony SDK that includes `hdc`, then make the
binary available on `PATH`. For a non-default SDK layout, set `HDC_PATH` to the
binary path.

```sh
hdc version
hdc list targets -v
```

Enable developer options and HDC debugging on the target device. Authorize the
host when the device asks for confirmation.

## Install and enable

```sh
npm i -g mcp-devices @mcp-devices/plugin-harmony
mcp-devices install harmony
mcp-devices doctor harmony
```

Restart the MCP server after enabling the plugin. To select a stable target in
a multi-device setup, set `HARMONY_DEVICE_ID` or pass `deviceId` per action.

```sh
HDC_PATH="$HOME/Library/Huawei/Sdk/hmscore/4.0.0/toolchains/hdc" \
HARMONY_DEVICE_ID="device-serial" \
mcp-devices
```

## Supported surface

| Module | Actions | Transport |
|--------|---------|-----------|
| `device` | `list`, `set`, `set_target` | `hdc list targets -v` |
| `screen` | `capture`, `annotate` | ArkXTest `uitest screenCap` |
| `input` | `tap`, `double_tap`, `long_press`, `swipe`, `text`, `key` | ArkXTest `uitest uiInput` |
| `ui` | `tree`, `find`, `find_tap`, `wait`, assertions | ArkXTest `uitest dumpLayout` |
| `app` | `launch`, `stop`, `install`, `list`, `uninstall` | `aa`, `bm`, and HDC install commands |
| `system` | `shell`, `logs`, `wait_log`, `clear_logs`, `info`, `open_url`, permission management, `file_push`, `file_pull` | HDC shell, HiLog, ATM permissions, and file transfer |
| Harmony plugin | `harmony_launch_ability`, `harmony_arkweb_*`, `harmony_sandbox_*`, `harmony_test` | Ability launch, ArkWeb DevTools, debug sandbox, and ArkXTest |

## Examples

```json
// Select HarmonyOS Next and inspect the current UI
device(action: 'set_target', target: 'harmony')
ui(action: 'tree')

// Launch a bundle with its default EntryAbility
app(action: 'launch', package: 'com.example.demo')

// Launch a specific Ability from a specific HAP module
harmony_launch_ability(
  bundleId: 'com.example.demo',
  ability: 'MainAbility',
  moduleName: 'entry'
)

// Wait for an application marker in HiLog
system(
  action: 'wait_log',
  pattern: 'Ability.*ready',
  package: 'com.example.demo',
  timeoutMs: 10000
)

// Open a URL without routing the query string through a host shell
system(action: 'open_url', url: 'https://example.com/path?a=1&b=2')

// Transfer a file
system(
  action: 'file_push',
  localPath: '/local/fixture.json',
  remotePath: '/data/local/tmp/fixture.json'
)
system(
  action: 'file_pull',
  remotePath: '/data/local/tmp/result.json',
  localPath: '/local/result.json'
)
```

### Permissions

```json
system(
  action: 'permission_grant',
  package: 'com.example.demo',
  permission: 'ohos.permission.CAMERA'
)
system(action: 'permission_reset', package: 'com.example.demo')
```

HarmonyOS permission operations resolve the application's access-token ID with
`atm dump`, then use `atm perm`. Reset revokes only permissions currently
reported as granted.

### ArkWeb, sandbox, and ArkXTest

```json
// Requires WebviewController.setWebDebuggingAccess(true) in the application
harmony_arkweb_inspect(localPort: 9222)
harmony_arkweb_close(
  socket: 'webview_devtools_remote_123',
  localPort: 9222
)

// Requires a running, debug-signed application
harmony_sandbox_list(bundleId: 'com.example.demo', path: 'files')
harmony_sandbox_read(
  bundleId: 'com.example.demo',
  path: 'files/state.json',
  maxBytes: 65536
)
harmony_sandbox_push(
  bundleId: 'com.example.demo',
  localPath: '/local/fixture.json',
  remotePath: 'files/fixture.json'
)
harmony_sandbox_pull(
  bundleId: 'com.example.demo',
  remotePath: 'files/result.json',
  localPath: '/local/result.json'
)

harmony_test(
  bundleId: 'com.example.demo.test',
  moduleName: 'entry_test',
  className: 'LoginSuite#opens',
  timeoutMs: 30000
)
```

ArkWeb inspection discovers `webview_devtools_remote_*` sockets from
`/proc/net/unix`, creates an HDC `fport`, and returns the DevTools
`/json/list` targets. The forward is removed on errors and when the plugin is
disposed.

## Ability targets

`app(action:'launch')` accepts either a bundle ID or `bundleId/AbilityName`.
The platform-specific `harmony_launch_ability` tool is required when the
Ability belongs to an explicitly named module:

```json
harmony_launch_ability(
  bundleId: 'com.example.demo',
  moduleName: 'feature',
  ability: 'FeatureAbility',
  deviceId: 'device-serial'
)
```

Bundle IDs, Ability names, module names, device IDs, and file paths are
validated before HDC execution. HDC is always invoked with an argument array;
inputs are never interpolated into a host-shell command.

## Native CLI

The Rust CLI uses the same HarmonyOS flow dispatcher for direct commands,
JSON flows, and recorded-scenario playback:

```sh
mcp-devices-cli flow run harmony --file smoke.json --device device-serial
mcp-devices-cli recorder play login --platform harmony
mcp-devices-cli screen-size harmony --device device-serial
mcp-devices-cli permission-grant harmony com.example.demo ohos.permission.CAMERA
mcp-devices-cli sandbox-file-list com.example.demo --platform harmony --path files
mcp-devices-cli harmony-sandbox-push com.example.demo ./input.json files/input.json
mcp-devices-cli harmony-arkweb --port 9222
mcp-devices-cli harmony-test com.example.demo.test entry_test --dry-run
```

## Current boundaries

- UI inspection and gestures require the ArkXTest `uitest` commands available
  on the target image.
- App-sandbox access requires HDC 3.1.0e or newer, API 15 or newer, a running
  application, and a debug signature.
- ArkWeb inspection requires the application to enable
  `WebviewController.setWebDebuggingAccess(true)`.
- Sensor/network simulation and native debugger integration are not exposed
  for HarmonyOS Next yet.
- The current log adapter returns bounded HiLog snapshots and applies level,
  tag, and package filters in the MCP process.

## Official references

- [HDC command reference](https://gitee.com/openharmony/docs/blob/master/zh-cn/device-dev/subsystems/subsys-toolchain-hdc-guide.md)
- [ArkXTest UI Test](https://gitee.com/openharmony/testfwk_arkxtest/blob/master/README_zh.md)
- [AA tool](https://gitee.com/openharmony/docs/blob/master/zh-cn/application-dev/tools/aa-tool.md)
- [BM tool](https://gitee.com/openharmony/docs/blob/master/zh-cn/application-dev/tools/bm-tool.md)
- [ATM permission tool](https://gitee.com/openharmony/docs/blob/master/zh-cn/application-dev/tools/atm-tool.md)
- [ArkWeb DevTools debugging](https://gitee.com/openharmony/docs/blob/master/zh-cn/application-dev/web/web-debugging-with-devtools.md)
