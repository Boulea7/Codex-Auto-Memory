# Progress Log

This document tracks implementation progress in a format that is easy to consume during external review or handoff to other tools and agents.

## Current completion snapshot

- Approximate overall progress toward a strong Claude-style alpha: `98%`
- Approximate progress toward a working local MVP: `99%`
- Current phase: `Phase 16 - bilingual docs portal and README redesign`

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

### Milestone 6: Security hygiene and review automation

- Added `cam audit` to scan tracked files and Git history for privacy and secret-hygiene issues.
- Replaced scanner-triggering synthetic secret literals with safer forward-only fixture forms.
- Verified that `.claude/` remains untracked and that no real secrets are currently present in tracked files.
- Added a dedicated reviewer handoff packet for external agents and review tools.
- Current audit result: no `high` or `medium` findings, only expected `info` local-path references and `low` historical synthetic fixtures.
- Chosen remediation strategy: fix forward only, no history rewrite.

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

### Milestone 9: Session continuity companion layer

- Added a separate session continuity model so temporary working state stays distinct from durable auto memory.
- Added `cam session status|save|load|clear|open` for explicit continuity control.
- Added shared project continuity under the companion directory plus project-local continuity under hidden tool-specific paths.
- Default local path style is Codex-first (`.codex-auto-memory/sessions/active.md`), with optional Claude-compatible `.claude/sessions/<date>-<short-id>-session.tmp` support.
- Added optional `sessionContinuityAutoLoad` and `sessionContinuityAutoSave` wrapper behavior, both disabled by default.
- Added structured startup continuity compilation with a separate line budget from durable memory.
- Added local `.git/info/exclude` updates for project-local continuity files instead of relying on tracked `.gitignore` edits.
- Added Codex-backed continuity summarization with heuristic fallback.

### Milestone 10: Session continuity quality and handoff readiness

- Expanded heuristic summarizer to detect file-write tool calls (`apply_patch`, `write_file`, `create_file`, `edit_file`) as confirmed working evidence, not just `exec_command`.
- Expanded `commandSucceeded()` to recognize additional success patterns: "Tests passed", "0 errors", "All checks passed", "PASS", "compiled successfully", "Build succeeded".
- `compileSessionContinuity()` now includes the `filesDecisionsEnvironment` section in the compiled startup block.
- Heuristic summarizer now populates `filesDecisionsEnvironment` from detected file-write operations.
- Added regression tests for heuristic summarizer file-write detection, expanded success patterns, continuity merge behavior, sensitive content filtering within continuity, and `filesDecisionsEnvironment` in compiled output.
- Fixed progress log milestone ordering (milestones now appear in chronological order).
- Updated `docs/session-continuity.md` to document the 5th category and `sessionContinuityLocalPathStyle` config.
- Updated `AGENTS.md`, `CONTRIBUTING.md`, and `docs/reviewer-handoff.md` for current state.

### Milestone 11: Continuity layering, extractor contradiction coverage, and memory inspection UX

- Session continuity summarization now produces separate shared-project and project-local layers instead of writing the same summary into both files.
- Heuristic continuity extraction now derives `notYetTried` and `incompleteNext` from explicit rollout language instead of only preserving prior state.
- `cam session load` now renders shared continuity, local continuity, and the merged resume brief separately.
- Added real JSONL rollout fixtures for continuity layering and command correction scenarios.
- Heuristic durable extractor now deletes stale command memory when a newer successful command clearly supersedes it.
- `cam memory` now shows startup-loaded memory files, on-demand topic refs, and edit paths directly in the default output.
- `MemoryStore.ensureLayout()` now normalizes the legacy empty `MEMORY.md` template only when it exactly matches the old generated empty file.

### Milestone 12: Codex-first continuity hardening

- Added a shared continuity evidence-bucket helper so prompt construction, heuristic synthesis, and Codex low-signal fallback all reason over the same recent command, file-write, next-step, and untried evidence.
- `extractorMode=codex` continuity is now covered directly by mocked integration tests for valid layered output, malformed output fallback, and low-signal empty output fallback.
- Codex-backed continuity now performs local structural validation after JSON output and falls back to heuristic mode when the result is malformed or evidence-empty.
- Heuristic durable extraction now supports high-confidence stale replacement for explicit `preferences` and `workflow` corrections without widening deletion into broader fuzzy contradiction matching.
- Added real JSONL rollout fixtures for preferences correction, workflow correction, and mixed durable-memory plus continuity-noise sessions.
- `cam memory` now groups on-demand topic refs by scope in default output and exposes `startupFilesByScope` plus `topicFilesByScope` in JSON mode for reviewer tooling.
- Native migration and continuity docs now reflect the current public Codex surface more clearly while keeping native `memories` and `codex_hooks` outside the trusted implementation path.

### Milestone 13: Continuity diagnostics and reviewer observability

- Session continuity generation now produces structured diagnostics describing preferred vs actual path, fallback reason, Codex exit status, and evidence counts.
- `cam session save --json`, `cam session load --json`, and `cam session status --json` now expose the latest continuity diagnostics and the continuity audit-log path.
- Wrapper auto-save now records continuity generation events to a dedicated reviewer-oriented JSONL log at `projects/<project-id>/audit/session-continuity-log.jsonl`.
- `cam memory --json` now adds `startupBudget` and `refCountsByScope`, and the default output shows a compact startup-budget plus ref-count summary.
- Reviewer docs were refreshed so handoff packets and guides no longer lag behind the current alpha window.

### Milestone 14: Reviewer packet refresh and targeted ergonomics

- `cam session save --json`, `cam session load --json`, and `cam session status --json` now expose `recentContinuityAuditEntries` in addition to the existing latest diagnostics field.
- `cam session save` now declares `--json` on the real CLI command surface, removing a drift bug where the implementation supported JSON but Commander did not expose the flag.
- Default `cam session load` and `cam session status` output now include a compact `Recent generations` preview sourced from the continuity audit JSONL.
- Reviewer docs, handoff guidance, and migration notes were refreshed against the current CLI surface and the latest official Codex public materials.
- Added regression coverage for recent continuity audit previews and for the actual `cam session save --json` command surface.

### Milestone 15: Conservative contradiction hardening and public-surface precision

- Added real rollout fixtures plus negative tests so ambiguous explicit preference corrections no longer silently justify stale deletes.
- Generic `remember` overlap deletes are now constrained to supported `preferences` / `workflow` correction cases with explicit correction signals, keeping unsupported topics like `architecture` conservative by default.
- Added a command-layer regression proving recent continuity history still loads when the continuity audit JSONL contains a corrupted line.
- Replaced the CLI regression test's dependency on an internal `tsx` implementation path with the package binary path.
- README and reviewer docs now state more precisely that `cam memory` is an inspection/audit surface with exposed edit paths, not a full `/memory`-style in-command editor.

### Milestone 16: Bilingual docs portal and README redesign

- Replaced the default English-only README with a Chinese-first public landing page and added a switchable `README.en.md`.
- Added bilingual docs entry pages and bilingual core design docs for Claude parity, architecture, and native migration.
- Reworked the public docs around summary-first reading, stronger open-source landing-page structure, and clearer reading paths for users, maintainers, and reviewers.
- Added contributor and release guidance for bilingual docs maintenance so the two public language tracks do not drift silently.

## Reviewer checkpoints

If you are reviewing the repository now, start here:

1. `README.md`
2. `docs/claude-reference.md`
3. `docs/session-continuity.md`
4. `docs/architecture.md`
5. `docs/review-guide.md`
6. `src/lib/domain/rollout.ts`
7. `src/lib/domain/sync-service.ts`
8. `src/lib/domain/memory-store.ts`
9. `src/lib/domain/session-continuity-store.ts`

## Known gaps

- Extractor quality is stronger, and unsupported-topic auto-delete is now guarded more conservatively, but contradiction handling is still intentionally limited outside explicit commands, preferences, and workflow corrections.
- `cam memory` now exposes grouped startup/topic refs more directly, but it still remains below Claude Code's `/memory` interaction depth for edit / toggle ergonomics.
- Native Codex memory and hook support is still companion-first; local `cam doctor --json` on 2026-03-17 still reports `memories` and `codex_hooks` as `under development` and disabled.
- Topic files are now surfaced for on-demand reads, but the companion runtime still relies on generic file-read tools rather than a native lazy topic loader.
- bilingual public docs now exist, but they introduce a new maintenance burden: Chinese and English copies need active synchronization
- Session continuity diagnostics now expose the latest fallback plus a short recent preview, but the CLI still lacks a dedicated history browser, filtering, or export flow beyond the audit JSONL.
- Release hygiene is stronger now, but still needs a per-release reviewer packet refresh discipline.
- `cam audit` is rule-based and conservative; it reduces obvious risk but is not a substitute for human review.
- Earlier commits still contain a small number of synthetic secret-like fixtures because the repository intentionally avoided git history rewrite.

## Next planned milestones

### Milestone 17: Continuity drill-down and bilingual docs discipline

- Consider one more compact continuity drill-down step only if it materially reduces audit friction without becoming a browser.
- Keep Chinese / English public docs synchronized as a routine release discipline rather than a one-off cleanup.
- Keep official Codex migration guidance conservative until public docs and local readiness both move.

## Review-ready habits

- Keep milestone commits focused and descriptive.
- Update `CHANGELOG.md` with every milestone commit.
- Update this progress log whenever phase status changes.
- Record any temporary compromises so other tools do not mistake them for intentional final behavior.
