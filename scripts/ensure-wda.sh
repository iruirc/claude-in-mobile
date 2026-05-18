#!/usr/bin/env bash
#
# ensure-wda.sh — idempotent persistent WebDriverAgent bootstrap for the
# iOS Simulator. Makes the MCP server's fast-reuse path (discoverRunningWDA /
# tryReuseRunningWDA) reliably hit, so the fragile in-process build path
# (buildWDAIfNeeded → runBuildWithProgress, capped by buildTimeout) is never
# exercised under the MCP stdio server.
#
# Behaviour:
#   - If WDA already serves on :PORT  -> exit 0 (no-op).
#   - Else: pick a target iPhone simulator (booted, else first available),
#     boot it, ensure the WDA runner is built, then launch
#     `xcodebuild test` DETACHED so it survives across MCP tool calls,
#     and poll until /status is ready.
#
# Idempotent + concurrency-safe (mkdir lock). Safe to call on every MCP
# server init and/or manually via `npm run wda`.
#
# Env overrides:
#   WDA_PORT      (default 8100)
#   WDA_PATH      (explicit WebDriverAgent project dir)
#   WDA_SIM_NAME  (preferred simulator name substring, e.g. "iPhone 17 Pro Max")
#   WDA_READY_TIMEOUT (seconds to wait for /status, default 360)

set -u

PORT="${WDA_PORT:-8100}"
READY_TIMEOUT="${WDA_READY_TIMEOUT:-360}"
LOG_DIR="${TMPDIR:-/tmp}/claude-in-mobile-wda"
LOG_FILE="$LOG_DIR/wda-$PORT.log"
LOCK_DIR="$LOG_DIR/ensure-$PORT.lock"
mkdir -p "$LOG_DIR"

log() { echo "[ensure-wda] $*" >&2; }

wda_status_ok() {
  curl -s -m 3 "http://localhost:$PORT/status" 2>/dev/null | grep -q '"state"'
}

# 0. Already serving — nothing to do.
if wda_status_ok; then
  log "WDA already serving on :$PORT — no-op."
  exit 0
fi

# Concurrency guard: only one bootstrap at a time. Stale lock (>15 min) is
# reclaimed.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -d "$LOCK_DIR" ]; then
    age=$(( $(date +%s) - $(stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0) ))
    if [ "$age" -lt 900 ]; then
      log "Another ensure-wda is bootstrapping (lock age ${age}s) — waiting for it."
      for _ in $(seq 1 "$READY_TIMEOUT"); do
        wda_status_ok && { log "WDA came up via the other bootstrap."; exit 0; }
        sleep 1
      done
      log "Timed out waiting for the concurrent bootstrap."; exit 1
    fi
    log "Reclaiming stale lock (age ${age}s)."
    rm -rf "$LOCK_DIR"; mkdir "$LOCK_DIR" 2>/dev/null || true
  fi
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

# 1. Resolve WDA project dir.
resolve_wda_path() {
  if [ -n "${WDA_PATH:-}" ] && [ -e "$WDA_PATH/WebDriverAgent.xcodeproj" ]; then
    echo "$WDA_PATH"; return 0
  fi
  local candidates=(
    "$HOME/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent"
    "/opt/homebrew/lib/node_modules/appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent"
    "/usr/local/lib/node_modules/appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent"
  )
  local c
  for c in "${candidates[@]}"; do
    [ -e "$c/WebDriverAgent.xcodeproj" ] && { echo "$c"; return 0; }
  done
  return 1
}

WDA_DIR="$(resolve_wda_path)" || {
  log "WebDriverAgent project not found. Install: npm i -g appium && appium driver install xcuitest (or set WDA_PATH)."
  exit 1
}
log "WDA project: $WDA_DIR"

# 2. Resolve a target iPhone simulator (booted preferred, else first available).
pick_sim() {
  python3 - "$@" <<'PY'
import json, subprocess, sys
pref = (sys.argv[1] if len(sys.argv) > 1 else "") or ""
def devs(state):
    out = subprocess.run(["xcrun","simctl","list","devices",state,"-j"],
                          capture_output=True,text=True)
    if out.returncode != 0: return []
    data = json.loads(out.stdout).get("devices",{})
    r=[]
    for runtime, lst in data.items():
        if "iOS" not in runtime: continue
        for d in lst:
            if "iPhone" in d.get("name",""):
                r.append((d["udid"], d.get("name",""), d.get("state","")))
    return r
booted = devs("booted")
avail  = devs("available")
def choose(cands):
    if pref:
        for u,n,s in cands:
            if pref.lower() in n.lower(): return u,n,s
    return cands[0] if cands else None
c = choose(booted) or choose(avail)
if not c:
    print("NONE"); sys.exit(0)
print(f"{c[0]}\t{c[1]}\t{c[2]}")
PY
}

SIM_LINE="$(pick_sim "${WDA_SIM_NAME:-}")"
if [ "$SIM_LINE" = "NONE" ] || [ -z "$SIM_LINE" ]; then
  log "No iPhone simulator available. Add one in Xcode → Devices & Simulators."
  exit 1
fi
SIM_UDID="$(echo "$SIM_LINE" | cut -f1)"
SIM_NAME="$(echo "$SIM_LINE" | cut -f2)"
SIM_STATE="$(echo "$SIM_LINE" | cut -f3)"
log "Target simulator: $SIM_NAME ($SIM_UDID) state=$SIM_STATE"

if [ "$SIM_STATE" != "Booted" ]; then
  log "Booting $SIM_NAME ..."
  xcrun simctl boot "$SIM_UDID" 2>/dev/null || true
  open -a Simulator 2>/dev/null || true
fi

# 3. Launch WDA detached via `xcodebuild test` (builds if needed — no
#    in-process timeout cap). Reuses a stable derivedDataPath so repeat
#    runs are fast (test-without-building effectively).
DERIVED="$HOME/Library/Developer/Xcode/DerivedData/WebDriverAgent-claude-in-mobile"
log "Launching WebDriverAgentRunner detached (log: $LOG_FILE) ..."
nohup xcodebuild \
  -project "$WDA_DIR/WebDriverAgent.xcodeproj" \
  -scheme WebDriverAgentRunner \
  -destination "id=$SIM_UDID" \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  USE_PORT="$PORT" \
  test >"$LOG_FILE" 2>&1 &
WDA_BG_PID=$!
disown "$WDA_BG_PID" 2>/dev/null || true
echo "$WDA_BG_PID" > "$LOG_DIR/wda-$PORT.pid"
log "xcodebuild pid=$WDA_BG_PID"

# 4. Poll /status until ready or the build/launch dies.
for _ in $(seq 1 "$READY_TIMEOUT"); do
  if wda_status_ok; then
    log "WDA ready on :$PORT (sim: $SIM_NAME)."
    exit 0
  fi
  if ! kill -0 "$WDA_BG_PID" 2>/dev/null; then
    log "xcodebuild exited before WDA came up. Tail:"; tail -n 25 "$LOG_FILE" >&2
    exit 1
  fi
  sleep 1
done

log "WDA did not become ready within ${READY_TIMEOUT}s. Tail:"; tail -n 25 "$LOG_FILE" >&2
exit 1
