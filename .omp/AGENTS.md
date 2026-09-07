# OMP project configuration

@../CLAUDE.md

## OMP agent routing

This section is authoritative for OMP sessions and replaces the `## Agents` routing imported from `CLAUDE.md`. Use the exact `agent` names below when dispatching through the `task` tool.

### Consilium

Use these agents for independent read-only analysis or review before a consequential cross-layer change.

| Role | Agent | Responsibility |
|---|---|---|
| architecture | `architect-reviewer` | Boundaries, contracts, coupling, migration risk |
| MCP/API | `mcp-developer` | MCP protocol, SDK usage, schemas, transports |
| security | `security-auditor` | Threats, trust boundaries, input and secret handling |
| delivery | `devops-engineer` | GitHub Actions, packaging, Homebrew, release mechanics |
| quality | `code-reviewer` | Correctness, maintainability, performance regressions |

### Executing agents

| Scope | Agent |
|---|---|
| `src/**/*.ts`, `packages/**/*.ts` | `typescript-pro` |
| Cross-layer MCP protocol or SDK behavior | `mcp-developer` |
| `cli/src/**/*.rs` | `rust-engineer` |
| `cli/assets/*.swift` | `swift-expert` |
| `desktop-companion/**/*.kt`, Gradle Kotlin DSL | `kotlin-specialist` |
| `.github/workflows/**`, `Formula/**`, release scripts | `devops-engineer` |
| Security implementation and hardening | `security-engineer` |
| Test automation explicitly required by the task | `test-automator` |
| Profiling or performance work explicitly required by the task | `performance-engineer` |
| Final independent code review | `code-reviewer` |

### Model policy

Runtime assignments live in `.omp/config.yml`:

| Tier | Model | Effort | Agents |
|---|---|---|---|
| critical review | `openai-codex/gpt-5.6-sol` | `xhigh` | `architect-reviewer`, `security-auditor`, `code-reviewer` |
| implementation | `openai-codex/gpt-5.6-sol` | `high` | `mcp-developer`, language specialists, `security-engineer` |
| support | `openai-codex/gpt-5.6-terra` | `high` | `devops-engineer`, `test-automator`, `performance-engineer` |

Do not pass a task-level `effort` override unless the user explicitly requests a different effort for that dispatch.

### Selection rules

- Prefer the narrowest matching specialist; use `mcp-developer` over `typescript-pro` when the change is primarily an MCP contract or transport change.
- For mixed-language work, split execution by file ownership only when slices are genuinely independent.
- Consilium agents review and advise; executing agents own edits in their scope.
- Do not use `devops-orchestrator` in this repository: its roster contract only permits empty directories and forbids modifying existing files.
- Keep orchestration, decomposition, integration, and final verification in the main agent.
