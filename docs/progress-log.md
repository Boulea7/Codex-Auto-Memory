# Progress Log

This document tracks implementation progress in a format that is easy to consume during external review or handoff to other tools and agents.

## Current completion snapshot

- Approximate overall progress toward a strong Claude-style alpha: `88%`
- Approximate progress toward a working local MVP: `96%`
- Current phase: `Phase 6 - topic-on-demand startup and security guardrails`

## Completed milestones

### Milestone 1: Repository bootstrap

- Project initialized as a TypeScript CLI with `pnpm`, `vitest`, and CI.
- Core runtime skeleton added:
  - config loading
  - worktree-aware project identity
  - Markdown memory storage
  - startup memory compilation
  - CLI wrapper commands
- Initial docs added:
  - README
  - architecture
  - Claude reference contract
  - native migration strategy

### Milestone 2: Sync reliability hardening

- Rollout matching upgraded from loose time-only heuristics toward metadata-aware selection.
- Rollout parser now preserves `call_id` and stitches outputs to the correct tool calls.
- Audit logs now capture project and extractor context.
- Rollout regression tests added.

### Milestone 3: Extractor quality and memory inspection UX

- Heuristic extraction now handles explicit remember, forget, and correction flows more realistically.
- A shared safety filter now removes obviously sensitive memory candidates before they reach the Markdown store.
- `cam memory` now exposes scope filtering, recent audit summaries, and local enable/disable controls.
- Additional tests now cover extractor behavior and memory inspection behavior.

### Milestone 4: Native compatibility seams

- Explicit compatibility interfaces now exist for session source, extractor, and runtime injector concerns.
- The runtime now names and uses its companion session source and wrapper injector explicitly.
- `cam doctor` now reports native-readiness in a more reviewer-friendly way instead of dumping raw feature flags only.

### Milestone 6: Security hygiene and review automation

- Added `cam audit` to scan tracked files and Git history for privacy and secret-hygiene issues.
- Replaced scanner-triggering synthetic secret literals with safer forward-only fixture forms.
- Verified that `.claude/` remains untracked and that no real secrets are currently present in tracked files.
- Added a dedicated reviewer handoff packet for external agents and review tools.
- Current audit result: no `high` or `medium` findings, only expected `info` local-path references and `low` historical synthetic fixtures.
- Chosen remediation strategy: fix forward only, no history rewrite.

## Reviewer checkpoints

If you are reviewing the repository now, start here:

1. `README.md`
2. `docs/claude-reference.md`
3. `docs/architecture.md`
4. `docs/review-guide.md`
5. `src/lib/domain/rollout.ts`
6. `src/lib/domain/sync-service.ts`
7. `src/lib/domain/memory-store.ts`

### Milestone 7: Phase 3 comprehensive hardening

- Fixed `matchesProjectContext` sibling-directory false match (now uses separator-aware prefix check).
- Fixed `JSON.parse` without try/catch in `parseEntryBlocks` — corrupted entry metadata now skips gracefully.
- Fixed `fs.rm` without `{ force: true }` when removing empty topic files.
- Removed `currently` and `I will` false-positive volatile patterns from the safety filter.
- Added AWS access key, Slack token, npm token, and database connection string patterns to the sensitive content filter.
- Added `make`, `docker compose`, `gradle`, `mvn`, `dotnet test`, `rake` to the heuristic command extractor filter.
- Added `continue` after the `rememberMatch` block to prevent duplicate upserts when a message matches both `rememberMatch` and `insightMatch`.
- Simplified `extractOperations` signature from complex conditional type to `MemoryEntry[]`.
- Converted `auditRules` from a hardcoded static constant to a `buildAuditRules()` function with dynamic username detection.
- Updated `absolute-user-path` regex to cover Linux `/home/` and Windows `C:\Users\` paths.
- Replaced project-specific `isFixturePath` checks with generic test/fixture/mock pattern detection.

### Milestone 8: Topic-on-demand startup and guardrails

- Startup injection now quotes each scope's `MEMORY.md` as local editable data instead of interpolating raw summary text into the prompt body.
- Startup injection now adds a structured `### Topic files` manifest so Codex can read topic files on demand through normal file-read tools.
- `compileStartupMemory()` no longer parses topic entry bodies at startup; it enumerates topic file paths only.
- `MemoryStore.getTopicFile()` now validates topic names as lowercase kebab-case, closing path traversal and basename confusion gaps.
- `readRecentAuditEntries()` now skips corrupted JSONL lines instead of crashing on a damaged audit log.
- `matchesProjectContext()` now normalizes trailing separators and compares case-insensitively on case-insensitive platforms.
- `cam audit` now detects AWS-style access keys in addition to the existing token patterns and no longer flags generic `/home/` / `C:\Users\` documentation examples as medium findings.

## Known gaps

- Extractor quality is stronger, but still needs broader real-world rollout fixtures and more nuanced contradiction handling.
- `cam memory` is more audit-friendly now, but still below Claude Code’s `/memory` interaction depth.
- Native Codex memory and hook support is still companion-first; no native path is activated. Codex now ships native memory but parity verification against our contract is pending.
- Topic files are now surfaced for on-demand reads, but the companion runtime still relies on generic file-read tools rather than a native lazy topic loader.
- Release hygiene is stronger now, but still needs a per-release reviewer packet refresh discipline.
- `cam audit` is rule-based and conservative; it reduces obvious risk but is not a substitute for human review.
- Earlier commits still contain a small number of synthetic secret-like fixtures because the repository intentionally avoided git history rewrite.

### Milestone 5: Bug fixes, parity hardening, and native compat update

- Fixed per-line try-catch in rollout JSONL parsing to survive corrupted lines.
- Added support for nested `session_meta` payload format (`payload.meta.id`).
- Fixed `schemaRoot` default to use `fileURLToPath(import.meta.url)` instead of `process.cwd()`.
- Fixed hook scripts to set executable permissions (`chmod 0o755`) after generation.
- Removed `picocolors` unused dependency; added `schemas/` to published package files.
- Fixed base64 safety filter false-positive on git SHA hashes.
- Fixed `commandSucceeded()` to default `false` when tool output is missing.
- Removed per-scope line slicing in `compileStartupMemory`; budget enforced by final `limitLines()`.
- Removed `## Highlights` section from `MEMORY.md` index to align with Claude's concise index contract.
- Updated native migration docs to reflect the difference between official Codex documentation and local implementation observations.
- Clarified Claude reference: manual edit/delete is officially documented, while subagent sharing/isolation semantics remain only partially specified in the public docs.

### Milestone 5 audit outcome

- **Accepted**:
  - corrupted rollout line skipping
  - nested `session_meta` parsing
  - schema path resolution via `import.meta.url`
  - executable hook scripts
  - shipping `schemas/` in the published package
  - false-positive reduction in the safety filter
  - treating missing tool output as unknown success
  - concise `MEMORY.md` index direction
- **Accepted with caveat**:
  - the earlier move to index-only startup injection was the right short-term parity correction, but it needed a follow-up path for safe topic lookup
- **Corrected in docs**:
  - stronger-than-supported claims about Claude forget semantics
  - stronger-than-supported claims about Claude subagent memory sharing/isolation
  - stronger-than-supported claims about Codex native memory layout and config contract

## Next planned milestones

### Milestone 9: Extractor quality and `/memory` parity

- Expand rollout fixtures for harder extractor regression coverage.
- Improve contradiction handling for stale memory replacement.
- Narrow the remaining UX gap between `cam memory` and Claude Code’s `/memory`.
- Use `docs/next-phase-brief.md` as the execution brief for the next implementation window.

## Review-ready habits

- Keep milestone commits focused and descriptive.
- Update `CHANGELOG.md` with every milestone commit.
- Update this progress log whenever phase status changes.
- Record any temporary compromises so other tools do not mistake them for intentional final behavior.
