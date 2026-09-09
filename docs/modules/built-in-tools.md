# Built-in Tools Reference

The base `mcp-devices` package includes **20 built-in tool modules** for device control and testing. Two are always visible (`device`, `screen`); the other 18 can be hidden/shown via startup profile or enabled at runtime.

## Module Visibility

**Always visible (2 modules):**
- device
- screen

**Hideable (18 modules):**
- Core: input, ui, app, system, flow
- Platform: browser, desktop, store, intent
- Testing: visual, accessibility, performance, sandbox, sensor, network
- Automation: recorder, sync, autopilot

### Control Module Visibility

**At startup:** Set the `MOBILE_PROFILE` environment variable:
```sh
MOBILE_PROFILE=full mcp-devices         # all 20 modules
MOBILE_PROFILE=web mcp-devices          # web profile: core + browser
MOBILE_PROFILE=minimal mcp-devices      # only device + screen
```

**At runtime:** Use the `device` tool:
```
device(action:'enable_module', module:'visual')
device(action:'disable_module', module:'recorder')
device(action:'list_modules')           # check status of all modules
```

## Module Catalog

### Always Visible

#### device
**Device management, module loading, target switching**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `list` | `platform` (optional) | List connected/available devices (filtered by platform if specified) |
| `set` | `deviceId` | Switch to a specific device by ID |
| `set_target` | `target` (platform name) | Switch platform target (android, ios, web, desktop, aurora, harmony) |
| `get_target` | — | Get current platform target |
| `enable_module` | `module` (or `category`) | Enable a hidden module at runtime |
| `disable_module` | `module` | Disable a visible module at runtime |
| `list_modules` | — | Show visibility status of all modules |

**Examples:**

```json
// List Android devices
device(action: 'list', platform: 'android')

// Set target platform to iOS
device(action: 'set_target', target: 'ios')

// Enable visual regression module
device(action: 'enable_module', module: 'visual')

// Check module visibility
device(action: 'list_modules')
```

---

#### screen
**Screenshot capture, annotation, diff comparison**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `capture` | `preset` (low/medium/high), `compress`, `maxWidth`, `maxHeight`, `quality`, `diff` (optional), `waitForStable` | Capture screenshot with optional compression & diff |
| `annotate` | `preset`, `compress`, similar params | Screenshot with bounding boxes around UI elements |

**Examples:**

```json
// Low-quality screenshot (fast)
screen(action: 'capture', preset: 'low')
→ { image: 'data:image/png;base64,iVBORw0K...' }

// High-quality screenshot with diff
screen(action: 'capture', preset: 'high', diff: true)
→ { image: '...', diff: { changed: true, percentage: 5 } }

// Annotated screenshot (element bounding boxes)
screen(action: 'annotate', preset: 'medium')
```

---

### Core Modules

#### input
**Tap, swipe, type, key press — all input actions**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `tap` | `x`, `y` OR `text` / `resourceId` / `label` / `index` | Tap at coordinates or find element and tap |
| `double_tap` | same as tap + optional `interval` | Double-tap (default interval: 100ms) |
| `long_press` | same as tap + optional `duration` | Long press (default duration: 1000ms) |
| `swipe` | `direction` (up/down/left/right) OR `x1, y1, x2, y2` | Swipe in direction or between coordinates |
| `text` | `text` | Type text into focused field |
| `key` | `key` (e.g., BACK, ENTER, DELETE, TAB) | Press keyboard key |

**Examples:**

```json
// Tap at coordinates
input(action: 'tap', x: 540, y: 1200)

// Find element by text and tap
input(action: 'tap', text: 'Login Button')

// Double-tap
input(action: 'double_tap', x: 540, y: 1200)

// Long press
input(action: 'long_press', text: 'Menu Item', duration: 1500)

// Swipe up
input(action: 'swipe', direction: 'up')

// Custom swipe (coordinates)
input(action: 'swipe', x1: 540, y1: 1200, x2: 540, y2: 600)

// Type text
input(action: 'text', text: 'user@example.com')

// Press key
input(action: 'key', key: 'BACK')
```

---

#### ui
**Accessibility tree, element search, assertions, waits**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `tree` | `platform` (optional) | Return full UI accessibility tree as JSON |
| `find` | `text`, `resourceId`, `label`, `index` (filters) | Search for elements (returns element refs or details) |
| `find_tap` | same filters + optional `tap: false` | Find element and tap it (or just return ref) |
| `tap_text` | `text` | Find text and tap (shorthand for find_tap) |
| `wait` | `text` / `resourceId` / `label`, `timeout` | Wait for element to appear (default: 5000ms) |
| `assert_visible` | `text` / `resourceId` / `label` | Assert element is visible; fail if not |
| `assert_gone` | same | Assert element is NOT visible |
| `analyze` | — | Analyze UI structure (group elements, identify patterns) |

**Examples:**

```json
// Get full UI tree
ui(action: 'tree')
→ { root: { type: 'window', children: [...] } }

// Find elements by text
ui(action: 'find', text: 'Login')
→ { elements: [{ ref: 'e1', text: 'Login' }, ...] }

// Find and tap element
ui(action: 'find_tap', text: 'Sign In')

// Find by resourceId (Android)
ui(action: 'find_tap', resourceId: 'com.example:id/button_submit')

// Wait for element to appear
ui(action: 'wait', text: 'Welcome', timeout: 5000)

// Assert visibility
ui(action: 'assert_visible', text: 'Error Message')

// Assert element is gone
ui(action: 'assert_gone', text: 'Loading Spinner')
```

---

#### app
**Launch, stop, install, uninstall, and list applications**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `launch` | `package`, optional `platform`, `deviceId` | Launch an app by package or bundle ID |
| `stop` | `package`, optional `platform`, `deviceId` | Force-stop an app |
| `restart` | `package`, optional `delayMs`, `platform`, `deviceId` | Stop then relaunch an app |
| `install` | `path`, optional `platform`, `deviceId` | Install an APK, app bundle, RPM, or HAP supported by the platform |
| `uninstall` | `package`, optional `platform`, `deviceId` | Uninstall through an app-inventory-capable adapter |
| `list` | optional `platform`, `deviceId` | List installed IDs (Aurora and HarmonyOS Next) |

**Examples:**

```json
app(action: 'launch', package: 'com.example.myapp')
app(action: 'restart', package: 'com.example.myapp', delayMs: 250)
app(action: 'install', path: '/path/to/app.hap', platform: 'harmony')
app(action: 'list', platform: 'harmony')
app(action: 'uninstall', package: 'com.example.myapp', platform: 'harmony')
```

---

#### system
**Shell, logs, files, clipboard, permissions, URL, and device information**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `shell` | `command`, optional `platform`, `deviceId` | Execute a validated shell command on a device |
| `logs` | optional `level`, `tag`, `lines`, `package` | Read the current platform's log buffer |
| `wait_log` | `pattern`, optional `timeoutMs`, `pollIntervalMs`, `contextLines`, `clearFirst` | Wait for a regex in device logs |
| `clear_logs` | optional `platform`, `deviceId` | Clear the log buffer |
| `pid_of` | `package` | Get an Android process ID |
| `is_running` | `package` | Check whether an Android process is running |
| `info` | optional `platform`, `deviceId` | Get device information |
| `open_url` | `url`, optional `platform`, `deviceId` | Open a URL on Android, iOS, or HarmonyOS Next |
| `clipboard_get` | — | Read Android clipboard content |
| `permission_grant` | `package`, `permission` | Grant a runtime permission |
| `permission_revoke` | `package`, `permission` | Revoke a runtime permission |
| `permission_reset` | `package` | Reset runtime permissions |
| `file_push` | `localPath`, `remotePath`, optional `platform`, `deviceId` | Upload a file (Aurora or HarmonyOS Next) |
| `file_pull` | `remotePath`, optional `localPath`, `platform`, `deviceId` | Download a file (Aurora or HarmonyOS Next) |
| `metrics` | — | Get MCP operation metrics |
| `reset_metrics` | — | Reset MCP operation metrics |

**Examples:**

```json
system(action: 'shell', command: 'param get', platform: 'harmony')
system(action: 'logs', tag: 'Demo', lines: 50, platform: 'harmony')
system(action: 'wait_log', pattern: 'Ability.*ready', timeoutMs: 10000, platform: 'harmony')
system(action: 'open_url', url: 'https://example.com', platform: 'harmony')
system(action: 'file_push', localPath: '/local/data.json', remotePath: '/data/local/tmp/data.json', platform: 'harmony')
system(action: 'file_pull', remotePath: '/data/local/tmp/output.txt', localPath: '/local/output.txt', platform: 'harmony')
```

---

#### flow
**Batch commands, multi-step automation, parallel execution**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `batch` | `commands` (array) | Execute commands as atomic transaction (all-or-nothing) |
| `run` | `commands` (array) | Execute commands sequentially with error handling |
| `parallel` | `commands` (array) | Execute commands concurrently |

**Examples:**

```json
// Batch execution (atomic: all succeed or all roll back)
flow(action: 'batch', commands: [
  { tool: 'input', args: { action: 'tap', x: 100, y: 200 } },
  { tool: 'input', args: { action: 'text', text: 'hello' } },
  { tool: 'screen', args: { action: 'capture' } }
])

// Sequential execution (stop on first error, continue on others with flag)
flow(action: 'run', commands: [
  { tool: 'app', args: { action: 'launch', package: 'com.example.app' } },
  { tool: 'ui', args: { action: 'wait', text: 'Home', timeout: 5000 } },
  { tool: 'input', args: { action: 'find_tap', text: 'Menu' } }
])

// Parallel execution (all commands run concurrently)
flow(action: 'parallel', commands: [
  { tool: 'screen', args: { action: 'capture' } },
  { tool: 'system', args: { action: 'info' } },
  { tool: 'device', args: { action: 'list_modules' } }
])
```

---

### Platform Modules

#### browser
**Browser automation — navigate, evaluate JS, manage tabs**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `navigate` | `url` | Navigate to URL |
| `evaluate` | `script` | Evaluate JavaScript in page context and return result |
| `tabs` | — | List open tabs (URL, title) |
| `cookies` | optional `url` | Get cookies for URL (or all if no URL) |
| `network` | — | Inspect captured network requests/responses |
| `console` | `command` | Execute command in browser console |
| `screenshot` | preset, quality | Take screenshot of current page |

**Examples (Web platform):**

```json
// Navigate to URL
browser(action: 'navigate', url: 'https://example.com')

// Evaluate JavaScript
browser(action: 'evaluate', script: 'document.title')
→ { value: 'Example Domain' }

// Get all tabs
browser(action: 'tabs')
→ { tabs: [{ url: 'https://example.com', title: 'Example' }] }

// Get cookies
browser(action: 'cookies', url: 'https://example.com')
→ { cookies: [{ name: 'session', value: 'abc123' }] }

// Inspect network
browser(action: 'network')
→ { requests: [{ method: 'GET', url: 'https://...', status: 200 }] }

// Execute in console
browser(action: 'console', command: 'window.localStorage.getItem("user")')
```

**Applies to:** Web platform.

---

#### desktop
**Desktop app control — windows, clipboard, performance**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `launch` | `app` | Launch desktop application |
| `stop` | `app` | Stop/close application |
| `windows` | — | List open windows (id, title, bounds) |
| `focus` | `windowId` | Bring window to focus |
| `resize` | `windowId`, `width`, `height` | Resize window |
| `clipboard_get` | — | Read clipboard |
| `clipboard_set` | `text` | Set clipboard |
| `performance` | — | Get performance metrics |
| `monitors` | — | List monitors (resolution, position) |

**Examples (Desktop platform):**

```json
// Launch app
desktop(action: 'launch', app: 'MyDesktopApp')

// List windows
desktop(action: 'windows')
→ { windows: [{ id: 'w-1', title: 'Main Window', bounds: {...} }] }

// Focus window
desktop(action: 'focus', windowId: 'w-1')

// Resize
desktop(action: 'resize', windowId: 'w-1', width: 800, height: 600)

// Clipboard
desktop(action: 'clipboard_get')
desktop(action: 'clipboard_set', text: 'new text')

// Monitor info
desktop(action: 'monitors')
→ { monitors: [{ width: 1920, height: 1080, x: 0, y: 0 }] }
```

**Applies to:** Desktop platform.

---

#### store
**App store metadata — ratings, reviews, versions**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `search` | `query` | Search app store for apps |
| `details` | `package` (or `packageName`) | Get app details (version, rating, icon, etc.) |
| `reviews` | `package`, optional `limit` | Get app reviews |
| `similar` | `package` | Find similar apps |

**Examples (Android/iOS):**

```json
// Search app store
store(action: 'search', query: 'productivity')
→ { results: [{ package: 'com.todoist', name: 'Todoist', rating: 4.5 }, ...] }

// Get app details
store(action: 'details', package: 'com.todoist')
→ { version: '14.2.1', rating: 4.5, installs: '10M+', icon: 'https://...' }

// Get reviews
store(action: 'reviews', package: 'com.todoist', limit: 5)
→ { reviews: [{ author: 'User1', rating: 5, text: 'Great app!' }, ...] }

// Find similar apps
store(action: 'similar', package: 'com.todoist')
→ { similar: [{ package: 'com.microsoft.todos', name: 'Microsoft To Do' }, ...] }
```

**Applies to:** Android (Google Play), iOS (App Store), Huawei AppGallery, RuStore.

---

#### intent
**Intent & deep link engine — am start/broadcast with typed extras**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `start` | `action`, optional `uri`, `extras` | Launch intent (implicitly or by action) |
| `broadcast` | `action`, optional `extras` | Send broadcast intent |
| `deeplink` | `uri` | Deep link to a specific app/screen |
| `services` | — | List available services |

**Examples (Android only):**

```json
// Start intent by action
intent(action: 'start', action: 'android.intent.action.VIEW', uri: 'https://example.com')

// Start with typed extras
intent(action: 'start', action: 'android.intent.action.SEND', extras: { 'android.intent.extra.TEXT': 'Hello' })

// Deep link with path/query params
intent(action: 'deeplink', uri: 'myapp://home?user_id=123&mode=demo')

// Broadcast intent
intent(action: 'broadcast', action: 'com.example.MY_ACTION', extras: { 'key': 'value' })

// List services
intent(action: 'services')
→ { services: [{ name: 'MyService', package: 'com.example.app' }, ...] }
```

**Applies to:** Android only.

---

### Testing Modules

#### visual
**Visual regression testing — compare screenshots**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `baseline` | `name` | Establish baseline screenshot for regression testing |
| `compare` | `baseline` | Compare current screenshot against baseline |
| `diff` | `baseline1`, `baseline2` | Diff two baselines to show changes |
| `report` | — | Generate visual regression report |

**Examples:**

```json
// Set baseline
screen(action: 'capture', preset: 'medium')
visual(action: 'baseline', name: 'login-screen-v1')

// Compare current vs baseline
screen(action: 'capture', preset: 'medium')
visual(action: 'compare', baseline: 'login-screen-v1')
→ { match: true/false, percentage: 2.3 }  // % pixels different

// Generate report
visual(action: 'report')
→ { baselines: [...], diffs: [...] }
```

---

#### accessibility
**Accessibility audit — WCAG checks, element validation**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `audit` | — | Run full WCAG accessibility audit |
| `check` | `rule` (optional) | Check specific rule or all rules |
| `summary` | — | Get accessibility violations summary |
| `rules` | — | List available accessibility rules |

**Examples:**

```json
// Run full audit
accessibility(action: 'audit')
→ { violations: [{ rule: 'color-contrast', elements: [{ ref: 'e1' }] }, ...] }

// Check specific rule
accessibility(action: 'check', rule: 'color-contrast')
→ { violations: [...] }

// Get summary
accessibility(action: 'summary')
→ { total_issues: 3, critical: 1, warnings: 2 }

// List rules
accessibility(action: 'rules')
→ { rules: ['color-contrast', 'alt-text', 'heading-order', ...] }
```

---

#### performance
**Performance Lab — metrics, crash signals, frame statistics, native traces, and heap snapshots**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `snapshot` | `platform`, `packageName?`, `deviceId?` | Capture current memory, CPU, FPS, battery, and crash metrics |
| `baseline` | `name`, `samples?`, `overwrite?`, target fields | Save an averaged metrics baseline |
| `compare` | `name`, threshold fields, target fields | Compare current metrics with a baseline |
| `monitor` | `duration?`, `interval?`, target fields | Sample metrics over a bounded interval |
| `crashes` | target fields | Query recent crash and ANR signals |
| `framestats` | `packageName?`, `deviceId?` | Measure Android frame timing and jank |
| `trace_start` | `platform`, `duration?`, `preset?`, target fields | Start Android Perfetto, iOS xctrace, or browser CDP tracing |
| `trace_stop` | `traceId` | Finalize the native trace and return its summary/artifact metadata |
| `trace_status` | `traceId?` | List active traces and remaining capture time |
| `trace_delete` | `artifactId` | Delete a captured trace and its metadata |
| `heap_capture` | `platform`, target fields | Capture Android HPROF, iOS Allocations, or Chrome `.heapsnapshot` privately |
| `heap_diff` | `beforeArtifactId`, `afterArtifactId` | Compare compatible heap size/count metadata |
| `heap_delete` | `artifactId` | Delete a heap artifact and its metadata |

Native tracing supports Android, iOS Simulator, and Browser. `preset` is
`ui-jank` or `startup`; `duration` is 1,000–15,000 ms. Android records Perfetto
plus `dumpsys gfxinfo`; when the official `trace_processor` executable is
available, SQL analysis adds slice, scheduler, CPU-time, and jank counts. Set
`PERFETTO_TRACE_PROCESSOR_PATH` for a non-PATH installation. iOS requires a
running Simulator app and `bundleId`, and returns a zipped Instruments
`.trace` bundle. Because Animation Hitches cannot record against Simulator
runtimes, the `ui-jank` preset captures Time Profiler instead and returns an
explicit warning; this avoids a valid-looking archive with zero instrument
tables. Browser tracing reports long-task and rendering counts.

Trace bytes never enter the MCP JSON response. Trace artifacts use mode
`0600`, SHA-256 checksums, a 32 MiB per-artifact limit, a 256 MiB total limit,
and a 24-hour TTL.

Heap capture supports debuggable Android packages (ART HPROF), running iOS
Simulator apps (a one-second Instruments Allocations bundle), and active
browser sessions (CDP HeapProfiler). Raw heap/allocation bytes never enter MCP
JSON. Heap artifacts are secret-bearing, mode `0600`, limited to 128 MiB each
and 512 MiB total, and expire after 24 hours. `heap_diff` compares compatible
metadata; positive growth is not by itself proof of a leak.

**Examples:**

```json
// Existing metric workflow
performance(action: 'snapshot', platform: 'android', packageName: 'com.example.app')
performance(action: 'baseline', name: 'checkout', platform: 'android')
performance(action: 'compare', name: 'checkout', platform: 'android')

// Trace browser work, then open the returned Chrome JSON artifact offline
performance(action: 'trace_start', platform: 'browser', session: 'checkout', preset: 'ui-jank', duration: 5000)
→ { status: 'recording', traceId: '...' }
performance(action: 'trace_stop', traceId: '...')
→ {
  status: 'captured',
  format: 'chrome-json',
  path: '/private/tmp/mcp-devices-performance-traces/....json',
  summary: { eventCount: 1102, longTaskCount: 2, longestTaskMs: 182.7 }
}

// Trace an Android app. trace_stop waits for the configured Perfetto window.
performance(action: 'trace_start', platform: 'android', packageName: 'com.example.app', preset: 'startup', duration: 10000)
performance(action: 'trace_stop', traceId: '...')
→ {
  format: 'perfetto-proto',
  summary: { frameStats: { totalFrames: 240, jankyFrames: 18, p99Ms: 60 } }
}

// Trace a running iOS Simulator app and persist an Instruments bundle.
performance(action: 'trace_start', platform: 'ios', bundleId: 'com.example.app', preset: 'startup', duration: 5000)
performance(action: 'trace_stop', traceId: '...')
→ { format: 'xctrace-zip', summary: { instrumentCount: 22, analysisTool: 'xctrace Time Profiler' } }

// Compare two browser heaps around the same workload.
performance(action: 'heap_capture', platform: 'browser', session: 'checkout')
→ { artifactId: 'before-id', summary: { nodeCount: 29392, edgeCount: 121004 } }
// Run the workload, then capture again.
performance(action: 'heap_capture', platform: 'browser', session: 'checkout')
→ { artifactId: 'after-id', summary: { nodeCount: 349192, edgeCount: 1121020 } }
performance(action: 'heap_diff', beforeArtifactId: 'before-id', afterArtifactId: 'after-id')
performance(action: 'heap_delete', artifactId: 'before-id')
performance(action: 'heap_delete', artifactId: 'after-id')

// Capture and compare Instruments Allocations bundles for one iOS Simulator app.
performance(action: 'heap_capture', platform: 'ios', bundleId: 'com.example.app')
→ { artifactId: 'ios-before', format: 'xctrace-allocations' }
// Run the workload, capture again, then compare:
performance(action: 'heap_capture', platform: 'ios', bundleId: 'com.example.app')
performance(action: 'heap_diff', beforeArtifactId: 'ios-before', afterArtifactId: 'ios-after')

performance(action: 'trace_delete', artifactId: '...')
```

#### sandbox
**App sandbox access — SharedPreferences, SQLite, file operations via run-as**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `prefs_read` | `package`, `file` (SharedPreferences XML file) | Read app preferences |
| `prefs_write` | `package`, `file`, `key`, `value` | Write app preference |
| `sqlite_query` | `package`, `db`, `query` | Execute SQLite query on app database |
| `file_list` | `package`, `path` | List files in app sandbox |
| `file_read` | `package`, `path` | Read file from app sandbox |

**Examples (Android only):**

```json
// Read SharedPreferences
sandbox(action: 'prefs_read', package: 'com.example.myapp', file: 'user_prefs.xml')
→ { theme: 'dark', notif_enabled: 'true' }

// Write preference
sandbox(action: 'prefs_write', package: 'com.example.myapp', file: 'user_prefs.xml', key: 'theme', value: 'light')

// Query SQLite database
sandbox(action: 'sqlite_query', package: 'com.example.myapp', db: 'mydata.db', query: 'SELECT * FROM users LIMIT 5')
→ { rows: [{ id: 1, name: 'Alice', ... }, ...] }

// List files in sandbox
sandbox(action: 'file_list', package: 'com.example.myapp', path: '/data')
→ { files: ['cache/', 'files/', 'databases/', ...] }

// Read file
sandbox(action: 'file_read', package: 'com.example.myapp', path: '/files/config.json')
→ { content: '{"key": "value"}' }
```

**Applies to:** Android only.

---

#### sensor
**Sensor & environment simulation — GPS, battery, notifications, thermal**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `location` | `latitude`, `longitude` | Inject GPS coordinates |
| `battery` | `level` (0-100), optional `status` | Simulate battery level & status (charging/discharging) |
| `notifications` | `title`, `text` | Send system notification |
| `thermal` | `level` (none/light/moderate/severe) | Simulate thermal state |

**Examples (Android, iOS):**

```json
// Inject GPS location
sensor(action: 'location', latitude: 37.7749, longitude: -122.4194)

// Simulate low battery
sensor(action: 'battery', level: 15, status: 'discharging')

// Simulate full battery
sensor(action: 'battery', level: 100, status: 'charging')

// Send notification
sensor(action: 'notifications', title: 'Test', text: 'Notification message')

// Simulate thermal state
sensor(action: 'thermal', level: 'moderate')
```

---

#### network
**Network layer — traffic stats, connectivity, proxy, airplane mode**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `traffic` | — | Capture network traffic stats (bytes sent/received) |
| `connectivity` | `enabled` (boolean) | Enable/disable network connectivity |
| `proxy` | `host`, `port` | Set HTTP proxy |
| `airplane` | `enable` (boolean) | Toggle airplane mode |

**Examples (Android, iOS):**

```json
// Get traffic stats
network(action: 'traffic')
→ { sent: 1024000, received: 2048000 }  // bytes

// Disable connectivity (offline)
network(action: 'connectivity', enabled: false)

// Re-enable connectivity
network(action: 'connectivity', enabled: true)

// Set proxy
network(action: 'proxy', host: 'proxy.company.com', port: 8080)

// Toggle airplane mode
network(action: 'airplane', enable: true)

// Disable airplane mode
network(action: 'airplane', enable: false)
```

---

### Automation Modules

#### recorder
**Record and replay interaction sequences**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `start` | `name` | Start recording interaction sequence |
| `stop` | — | Stop recording (saves sequence) |
| `play` | `name`, optional `repeat` | Play back recorded sequence |
| `list` | — | List all recorded sequences |
| `delete` | `name` | Delete recorded sequence |

**Examples:**

```json
// Start recording a login flow
recorder(action: 'start', name: 'login-flow')

// ... user performs interactions (taps, types, etc.) ...

// Stop recording
recorder(action: 'stop')
→ { name: 'login-flow', actions: 5 }

// Play back recorded sequence
recorder(action: 'play', name: 'login-flow')

// Play with repeat
recorder(action: 'play', name: 'login-flow', repeat: 3)

// List all recorded sequences
recorder(action: 'list')
→ { sequences: [{ name: 'login-flow', actions: 5 }, ...] }

// Delete sequence
recorder(action: 'delete', name: 'login-flow')
```

---

#### sync
**Multi-device synchronization and coordination**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `pair` | `devices` (array of device IDs) | Pair devices for synchronized automation |
| `unpair` | `devices` | Unpair devices |
| `broadcast` | `command`, `devices` (array) | Broadcast command to multiple devices |
| `status` | — | Get sync status across devices |

**Examples:**

```json
// Pair two devices
sync(action: 'pair', devices: ['device1', 'device2'])

// Broadcast tap command to multiple devices
sync(action: 'broadcast', command: { tool: 'input', action: 'tap', x: 540, y: 1200 }, devices: ['device1', 'device2'])

// Check sync status
sync(action: 'status')
→ { paired: ['device1', 'device2'], synchronized: true }

// Unpair devices
sync(action: 'unpair', devices: ['device1', 'device2'])
```

---

#### autopilot
**AI-driven test generation and self-healing**

| Action | Parameters | Purpose |
|--------|-----------|---------|
| `explore` | `max_actions` (optional) | Automatically explore app UI and generate interaction graph |
| `generate` | — | Generate test cases from explored UI |
| `heal` | `test_name` | Self-heal failing test due to UI changes |
| `tests` | — | List generated tests |
| `status` | — | Get autopilot status |

**Examples:**

```json
// Explore app UI (AI learns app structure)
autopilot(action: 'explore', max_actions: 100)
→ { explored: true, screens: 12, elements: 145 }

// Generate tests from exploration
autopilot(action: 'generate')
→ { generated: 8, tests: ['test-1', 'test-2', ...] }

// List generated tests
autopilot(action: 'tests')
→ { tests: [{ name: 'test-login', steps: 5, success: true }, ...] }

// Self-heal failing test (AI fixes broken selectors/steps)
autopilot(action: 'heal', test_name: 'test-login')
→ { healed: true, changes: ['updated selector for element', ...] }

// Get status
autopilot(action: 'status')
→ { state: 'idle', generated_tests: 8, success_rate: 95 }
```

---

## Startup Profiles

Control which modules are visible at MCP server startup:

| Profile | Visible modules (+ always-visible) | Use case |
|---------|-----|----------|
| `minimal` | device, screen only | Minimal setup; enable modules on demand |
| `core` | device, screen, input, ui, app, system, flow | Android automation (default) |
| `android` | device, screen, input, ui, app, system, flow | Alias for core |
| `web` | device, screen, input, ui, app, system, flow, browser | Web automation |
| `full` | all 20 modules | Full functionality; all modules visible |

**Set at startup:**
```sh
MOBILE_PROFILE=full mcp-devices
```

**Default:** `core` (for Android). No platforms load by default; enable platforms separately via `mcp-devices install`.

## Quick Links

- [Modules & Tools Overview](./README.md) — Module types and architecture
- [Platform Plugins](./plugin-android.md) — Android, iOS, Web, Desktop, Aurora
- [Debug Tool Plugin](./plugin-debug.md) — Runtime debugging with JDWP + LLDB
- [MCP Client Configuration](../README.md) — How to configure your MCP client
