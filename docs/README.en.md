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
- `cam integrations install --host codex` orchestrates MCP wiring plus hook and skill assets, and staged failures now also produce a structured rollback payload under `--json`; `cam integrations apply --host codex` adds the managed `AGENTS.md` guidance flow on top but now performs an AGENTS safety preflight before any writes, and `cam integrations doctor --host codex` remains the thin read-only readiness view with `workflowContract`, `applyReadiness`, `experimentalHooks`, and `layoutDiagnostics`; `cam mcp doctor` also reports alternate global wiring separately from the recommended project-scoped route and distinguishes installed hook helpers from operational ones
- `cam skills install` now has three public surfaces: `runtime`, `official-user`, and `official-project`; runtime stays the default target, while the official `.agents/skills` copies remain explicit opt-in installs
- non-Codex host wiring remains a boundary capability: the default product path only foregrounds `cam mcp install --host codex` and `cam mcp print-config --host codex`, while lower-priority host details stay collected in `docs/host-surfaces.md`, including the `manual-only` branch
- `cam recall search` now defaults to the active-first, archived-fallback read-only retrieval path with `state=auto, limit=8`, and `cam recall search --json` / `search_memories` now also surface `retrievalMode`, `retrievalFallbackReason`, `stateResolution`, `executionSummary`, `searchOrder`, `totalMatchedCount`, `returnedCount`, `globalLimitApplied`, `truncatedCount`, `resultWindow`, `globalRank`, and `diagnostics.checkedPaths[].returnedCount` / `droppedCount`
- `cam remember --json` / `cam forget --json` now also return manual-mutation reviewer payloads, so explicit correction and archive/delete flows become machine-readable without leaving the Markdown-first contract; the payload now also carries additive `mutationKind`, `matchedCount`, `appliedCount`, `noopCount`, `summary`, `reviewerSummary`, `followUp`, `nextRecommendedActions`, `entries[]`, `uniqueAuditCount`, `auditCountsDeduplicated`, and `warningsByEntryRef`, and, when at least one ref matched, top-level `latestAppliedLifecycle`, `latestLifecycleAttempt`, `latestLifecycleAction`, `latestState`, `latestSessionId`, `latestRolloutPath`, `latestAudit`, `timelineWarningCount`, `warnings`, and `entry` fields; delete flows distinguish timeline-only review refs from details-usable refs, while empty `forget --json` results keep `nextRecommendedActions` empty instead of emitting placeholder refs
- durable sync now fail-closes on subagent rollouts: child-session evidence can still inform continuity and reviewer analysis, but `cam sync` records a reviewer-visible `subagent-rollout` skip instead of mutating canonical durable memory
- session continuity persistence now also fail-closes on subagent rollouts, including explicit `--rollout`, matching recovery markers, and matching latest audit entries
- shared and project-local continuity writes are now committed atomically; when the summary-write phase fails, CAM records a `summary-write` recovery marker instead of leaving partial continuity behind
- `cam integrations apply --json` also exposes `postApplyReadinessCommand`, so “which doctor should I run after apply?” is now machine-readable instead of prose-only
- startup recall still stays Markdown-first and line-budgeted, but now also includes a few active-only content highlights; it is not a topic-body dump and does not bring archived memory back into default startup recall
- `cam memory --json` now also exposes `highlightCount`, `omittedHighlightCount`, `highlightsByScope`, `startupSectionsRendered`, `startupOmissions`, `startupOmissionCounts`, and the new `layoutDiagnostics`, so reviewers can tell whether startup highlights were budget-trimmed, which startup sections actually made it into the payload, why specific candidates were omitted, and whether canonical Markdown layout drift has appeared
- `cam memory` now formally supports `--cwd <path>`, so inspect/reindex/recent-review commands finally line up with hook helper guidance, doctor next steps, and workflowContract cross-directory teaching
- top-level `cam doctor --json` now surfaces the current app-server signal alongside `memories`, `codex_hooks`, retrieval-sidecar, unsafe-topic, and canonical-layout diagnostics instead of only showing the two native migration flags
- the shared `workflowContract` now also exposes launcher constraints explicitly through `commandName=cam`, `requiresPathResolution=true`, and `hookHelpersShellOnly=true`, so PATH and shell requirements stay aligned across hooks, skills, doctor, and print-config; hook helpers, doctor next steps, and retrieval-sidecar repair commands also prefer a verified `node <installed>/dist/cli.js` fallback when `cam` is unavailable on PATH
- `workflowContract.launcher` now also clarifies that it applies to direct CLI usage and installed helper assets, not to the canonical MCP host snippet; canonical host wiring still keeps the `cam mcp serve` command shape
- `workflowContract` now also keeps additive `executionContract`, `modelGuidanceContract`, and `hostWiringContract` sections so execution routing, agent guidance, and host wiring stay machine-readable without overloading one field group
- current official Codex skills discovery docs now use `.agents/skills`; this repository still supports `.codex/skills` / `CODEX_HOME` as runtime and historical compatibility surfaces, but not as the new official canonical discovery path
- multi-term `cam recall search` queries now match across `id/topic/summary/details` instead of requiring every term to appear in the same field, and startup highlights now deduplicate identical summaries across scopes so repeated low-signal notes do not consume the limited startup budget
- `cam integrations apply --host codex` now rolls back staged project-scoped MCP wiring, hook assets, and skill assets if AGENTS guidance blocks late or another staged write fails
- maintainers should avoid reverting to the older “companion-only and future-seam-only” wording unless the implementation direction changes again
- key `--help` text is part of the release-facing public contract and should stay aligned with the README, architecture docs, and release-facing smoke coverage

## Language policy

- the default public landing page remains the Chinese `README.md`
- English readers can switch through [README.en.md](../README.en.md) or this page
- core design docs should stay synchronized across Chinese and English when the product direction changes materially
- supplementary maintainer docs can remain English-first when that reduces drift
