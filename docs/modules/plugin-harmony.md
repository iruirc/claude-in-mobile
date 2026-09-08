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
| `system` | `shell`, `logs`, `wait_log`, `clear_logs`, `info`, `open_url`, `file_push`, `file_pull` | HDC shell, HiLog, and file transfer |
| Harmony plugin | `harmony_launch_ability` | `aa start` with optional module selection |

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

## Current boundaries

- UI inspection and gestures require the ArkXTest `uitest` commands available
  on the target image.
- Runtime permission management, app sandbox inspection, ArkWeb inspection,
  sensor/network simulation, and native debugger integration are not exposed
  for HarmonyOS Next yet.
- The current log adapter returns bounded HiLog snapshots and applies level,
  tag, and package filters in the MCP process.

## Official references

- [HDC command reference](https://gitee.com/openharmony/docs/blob/master/zh-cn/device-dev/subsystems/subsys-toolchain-hdc-guide.md)
- [ArkXTest UI Test](https://gitee.com/openharmony/testfwk_arkxtest/blob/master/README_zh.md)
- [AA tool](https://gitee.com/openharmony/docs/blob/master/zh-cn/application-dev/tools/aa-tool.md)
- [BM tool](https://gitee.com/openharmony/docs/blob/master/zh-cn/application-dev/tools/bm-tool.md)
