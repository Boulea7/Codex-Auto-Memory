# Documentation Hub

[简体中文](./README.md) | [English](./README.en.md)

> This is the English documentation entry point for `codex-auto-memory`.  
> The repository is now documented as a Codex-first Hybrid memory runtime: still Markdown-first and local-first, still strongest through the current wrapper path, but now explicitly evolving toward hook, skill, and MCP-aware integration surfaces.

## Suggested reading paths

### New users

1. [README](../README.en.md)
2. [Claude reference contract](./claude-reference.en.md)
3. [Architecture](./architecture.en.md)
4. [Integration strategy](./integration-strategy.md) (Chinese)
5. [Native migration strategy](./native-migration.en.md)

### Maintainers

1. [Architecture](./architecture.en.md)
2. [Integration strategy](./integration-strategy.md) (Chinese)
3. [Host surfaces](./host-surfaces.md) (Chinese)
4. [Session continuity design](./session-continuity.md)
5. [Release checklist](./release-checklist.md)
6. [ClaudeCode patch audit](./claudecode-patch-audit.md)

### Reviewers and follow-up agents

1. [README](../README.en.md)
2. [Architecture](./architecture.en.md)
3. [Integration strategy](./integration-strategy.md) (Chinese)
4. [Host surfaces](./host-surfaces.md) (Chinese)
5. [Native migration strategy](./native-migration.en.md)
6. [Session continuity design](./session-continuity.md)

## Core design docs

| Document | Purpose | Language |
| :-- | :-- | :-- |
| [Claude reference contract](./claude-reference.en.md) | defines which public Claude Code memory behaviors this project intentionally mirrors, and where it now intentionally diverges | English / [中文](./claude-reference.md) |
| [Architecture](./architecture.en.md) | explains the current Codex-first Hybrid architecture: wrapper path today, broader integration surfaces tomorrow | English / [中文](./architecture.md) |
| [Integration strategy](./integration-strategy.md) | explains how the current repository expands from a Codex companion into a Codex-first Hybrid memory system | 中文 |
| [Host surfaces](./host-surfaces.md) | records host capability boundaries and future integration posture across Codex and adjacent ecosystems | 中文 |
| [Native migration strategy](./native-migration.en.md) | explains how native Codex memory signals are evaluated without treating them as the only future direction | English / [中文](./native-migration.md) |

## Runtime and maintainer docs

| Document | Purpose | Current language |
| :-- | :-- | :-- |
| [Session continuity design](./session-continuity.md) | continuity boundaries, paths, and reviewer surfaces | English |
| [Release checklist](./release-checklist.md) | release-time product, runtime, and docs checks | English |
| [ClaudeCode patch audit](./claudecode-patch-audit.md) | historical patch-migration and comparison notes | English |

## Documentation policy

- the public front page should optimize for first-time understanding and current product direction
- core product boundaries belong in the README and architecture docs
- claim-sensitive wording must stay aligned with official public documentation
- the repository now documents both present behavior and deliberate evolution toward hook, skill, and MCP-aware surfaces
- the latest low-friction MCP wiring surface is now layered: `cam mcp install` writes the recommended project-scoped host config while preserving non-canonical custom fields on the `codex_auto_memory` entry when safe, `cam mcp print-config` and `cam mcp doctor` stay print-only and inspect-only, and `cam mcp apply-guidance --host codex` manages the repository-level `AGENTS.md` guidance block through an additive fail-closed flow
- `cam integrations install --host codex` orchestrates MCP wiring plus hook and skill assets, `cam integrations apply --host codex` adds the managed `AGENTS.md` guidance flow on top but now performs an AGENTS safety preflight before any writes, and `cam integrations doctor --host codex` remains the thin read-only readiness view with `workflowContract` and `applyReadiness`; `cam mcp doctor` also reports alternate global wiring separately from the recommended project-scoped route
- `cam skills install` now has three public surfaces: `runtime`, `official-user`, and `official-project`; runtime stays the default target, while the official `.agents/skills` copies remain explicit opt-in installs
- the `generic` host remains manual-only: it is supported by `cam mcp print-config --host generic`, but intentionally rejected by `cam mcp install --host generic`
- `cam recall search` now defaults to the active-first, archived-fallback read-only retrieval path with `state=auto, limit=8`
- maintainers should avoid reverting to the older “companion-only and future-seam-only” wording unless the implementation direction changes again
- key `--help` text is part of the release-facing public contract and should stay aligned with the README, architecture docs, and release-facing smoke coverage

## Language policy

- the default public landing page remains the Chinese `README.md`
- English readers can switch through [README.en.md](../README.en.md) or this page
- core design docs should stay synchronized across Chinese and English when the product direction changes materially
- supplementary maintainer docs can remain English-first when that reduces drift
