# Android-Only Commands

Commands exclusive to the Android platform.

---

### analyze-screen

Parse current screen and return categorized interactive elements as structured JSON. Groups elements into buttons, inputs, texts, etc. Useful for automated test flows.

```bash
mcp-devices-cli analyze-screen
mcp-devices-cli analyze-screen --device emulator-5554
```

**Platforms:** Android only

---

### find-and-tap

Fuzzy-match an element by description and tap it. Uses confidence scoring for inexact matches.

```bash
mcp-devices-cli find-and-tap "Submit Order" --min-confidence 50
mcp-devices-cli find-and-tap "Cancel" --min-confidence 30
```

| Flag | Description | Default |
|------|-------------|---------|
| `--min-confidence <0-100>` | Minimum match confidence threshold | 30 |

**Platforms:** Android only

---

### screen

Control screen power state (turn display on/off).

```bash
mcp-devices-cli screen on
mcp-devices-cli screen off
```

**Platforms:** Android only
