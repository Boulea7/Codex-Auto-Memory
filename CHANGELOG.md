# Changelog

All notable changes to `codex-auto-memory` will be documented in this file.

The format is intentionally simple and reviewer-friendly: each entry maps to a concrete implementation milestone and, when possible, a single Git commit.

## 0.1.0-alpha.12 - 2026-03-17

### Added

- Added shared continuity evidence buckets for recent successful commands, recent failed commands, detected file writes, explicit next steps, and explicit untried ideas.
- Added Codex-mode continuity regression coverage for valid layered output, invalid model output fallback, low-signal model output fallback, and prompt bucket rendering.
- Added real JSONL rollout fixtures for preferences correction, workflow correction, and mixed durable-memory plus continuity-noise sessions.
- Added `startupFilesByScope` and `topicFilesByScope` to `cam memory --json` so reviewers no longer need to regroup startup and topic refs manually.

### Changed

- `extractorMode=codex` is now the tested primary continuity path instead of relying on heuristic-only indirect coverage.
- Continuity prompts now keep the existing schema-first structure but include short evidence buckets that make shared-vs-local assignment and exact next-step extraction more reliable.
- `cam memory` now groups on-demand topic refs by scope in the default output while preserving the existing command surface.
- Milestone planning docs now reflect the Codex-first continuity focus and the current public Codex surface more explicitly.

### Fixed

- Codex-backed continuity extraction now falls back to the heuristic summarizer when the model output is invalid JSON, misses required layers or fields, or returns a formally valid but evidence-empty summary.
- Heuristic durable extraction now supports high-confidence stale replacement for explicit `preferences` and `workflow` corrections without widening contradiction deletion into fuzzier topics.
- Durable extraction now keeps temporary next-step and local file-edit continuity noise out of durable memory more explicitly during mixed sessions.

### Review focus

- Confirm that Codex-mode continuity now degrades safely to heuristic output instead of silently accepting empty or malformed summaries.
- Confirm that explicit preferences and workflow corrections delete only the stale entry they clearly replace.
- Confirm that `cam memory --json` is easier to audit while staying backward compatible for existing consumers.

## 0.1.0-alpha.11 - 2026-03-15

### Added

- Added real JSONL rollout fixtures for continuity layering and command-correction scenarios.
- Added regression coverage for layered continuity extraction, stale command replacement, legacy empty-index normalization, and richer `cam memory` output.

### Changed

- Session continuity summaries now split into shared project and project-local layers instead of writing the same summary into both continuity files.
- Heuristic continuity extraction now derives `notYetTried` and `incompleteNext` from explicit rollout language and keeps file-edit notes in the local layer by default.
- `cam session load` now renders shared continuity, local continuity, and the effective merged resume brief separately.
- `cam memory` now reports startup-loaded memory files, on-demand topic refs, and edit paths directly in the default output and JSON mode.
- `MemoryStore.ensureLayout()` now rewrites the exact legacy empty `MEMORY.md` template into the current concise index form while leaving user-edited files untouched.
- Durable extractor prompt guidance now explicitly keeps unfinished next steps and local file-edit notes out of durable memory.

### Fixed

- Heuristic durable extraction now deletes stale command memory when a newer successful command clearly supersedes it in the same rollout.

### Review focus

- Confirm that shared continuity and project-local continuity now diverge in the intended way instead of receiving duplicate summaries.
- Confirm that `cam session load` and `cam memory` make reviewer workflows more obvious without bloating the startup contract.
- Confirm that command-level contradiction handling does not delete unrelated reusable commands.

## 0.1.0-alpha.10 - 2026-03-15

### Fixed

- Session continuity heuristic summarizer now detects file-write tool calls (`apply_patch`, `write_file`, `create_file`, `edit_file`) as confirmed working evidence, not just `exec_command`. Coding sessions that modify files but run no commands now produce meaningful continuity state.
- Session continuity heuristic summarizer now recognizes additional command success patterns: "Tests passed", "0 errors", "All checks passed", "PASS", "compiled successfully", "Build succeeded".
- `compileSessionContinuity()` now includes the "Files / Decisions / Environment" section in the compiled startup block, making file-modification context visible to the next session.
- Heuristic summarizer now populates `filesDecisionsEnvironment` from detected file-write operations instead of only preserving existing state.

### Added

- Tests for heuristic summarizer file-write detection and expanded success patterns.
- Tests for `applySessionContinuitySummary` merge behavior and timestamp refresh.
- Tests for sensitive content filtering within session continuity sanitization.
- Tests for `filesDecisionsEnvironment` inclusion in compiled startup block.

### Changed

- Progress log milestone ordering corrected (milestones now appear in chronological order 1–10).
- `docs/session-continuity.md` now documents the 5th category (`filesDecisionsEnvironment`) and the `sessionContinuityLocalPathStyle` config option.
- `AGENTS.md` planning notes updated to reflect current priorities.
- `CONTRIBUTING.md` now references `cam session` and `cam audit` commands.
- `docs/reviewer-handoff.md` updated with recent commits and current remaining gaps.

### Review focus

- Confirm that file-write tool call detection covers Codex's `apply_patch_freeform` naming convention.
- Confirm that the `\bPASS\b` word-boundary pattern does not over-match common words.
- Confirm that `filesDecisionsEnvironment` in the 60-line startup budget does not truncate the other 5 sections in typical usage.

## 0.1.0-alpha.9 - 2026-03-15

### Added

- Added a separate session continuity companion layer with `cam session status|save|load|clear|open`.
- Added shared project continuity storage under the companion root plus project-local continuity storage under hidden tool-specific directories.
- Added optional `sessionContinuityAutoLoad`, `sessionContinuityAutoSave`, `sessionContinuityLocalPathStyle`, and `maxSessionContinuityLines` config fields.
- Added a dedicated session continuity schema and Codex-backed summarizer with heuristic fallback.
- Added regression coverage for continuity parsing, storage, git exclude handling, command flow, and wrapper auto-load/auto-save.
- Added `docs/session-continuity.md` to document the durable-memory vs temporary-continuity split.

### Changed

- `cam init` now prepares local ignore entries for project-local continuity files through `.git/info/exclude` when running inside a git repository.
- Wrapper startup injection can now include a bounded `# Session Continuity` block when auto-load is enabled locally.
- Wrapper end-of-session flow can now refresh continuity state from relevant rollouts when auto-save is enabled locally.
- Shared project config can no longer force local session continuity behavior; those settings are ignored outside managed, user, and local config scopes.

### Review focus

- Confirm that session continuity remains clearly separate from durable `MEMORY.md`-based auto memory.
- Confirm that Codex-first local storage works well while Claude-compatible path style remains available as an adapter.
- Confirm that wrapper auto-load/auto-save only activates when explicitly enabled and does not regress existing startup behavior.

## 0.1.0-alpha.8 - 2026-03-15

### Fixed

- `MemoryStore.getTopicFile()` now validates topics as lowercase kebab-case, preventing path traversal or basename confusion when constructing topic paths.
- `readRecentAuditEntries()` now skips corrupted JSONL lines instead of crashing on a damaged audit log.
- `matchesProjectContext()` now normalizes trailing separators and compares case-insensitively on case-insensitive platforms.
- `cam audit` no longer flags generic `/home/` and `C:\Users\` documentation examples as medium findings.

### Changed

- `compileStartupMemory()` now quotes each scope's `MEMORY.md` as local editable data and injects a structured `### Topic files` manifest for on-demand topic lookup.
- Startup compilation now enumerates topic file paths without parsing topic entry bodies, keeping startup compact and closer to Claude's lazy topic-loading model.

### Added

- `cam audit` now detects AWS access key style literals alongside the existing token patterns.
- Added regression coverage for topic path validation, corrupted audit logs, topic-file deletion, volatile-debugging exemptions, the 12-operation safety cap, and normalized project-path matching.

### Review focus

- Confirm that quoted startup memory still gives Codex enough context without letting editable Markdown silently act like prompt instructions.
- Confirm that topic-on-demand lookup now works via structured path references and does not eagerly load topic entry bodies.
- Confirm that audit now catches AWS-style synthetic fixtures while avoiding generic documentation-path false positives.

## 0.1.0-alpha.7 - 2026-03-14

### Fixed

- `matchesProjectContext` now uses a separator-aware prefix check, preventing false matches on sibling directories like `/foo/bar-extra` when the project root is `/foo/bar`.
- `parseEntryBlocks` now wraps `JSON.parse` in try/catch; corrupted entry metadata blocks are skipped gracefully instead of crashing.
- `fs.rm` in `deleteEntry` now passes `{ force: true }` to avoid ENOENT errors on already-missing topic files.
- Removed `currently` and `I will` from volatile patterns in the safety filter; these incorrectly rejected legitimate entries like "Currently we use pnpm".
- Added `continue` after the `rememberMatch` block in the heuristic extractor to prevent duplicate upserts when a message matches both `rememberMatch` and `insightMatch`.
- Simplified `extractOperations` signature from a complex conditional type to `MemoryEntry[]`.

### Added

- Added AWS access key (`AKIA...`), Slack token (`xox...`), npm token (`npm_...`), and database connection string patterns to the sensitive content filter.
- Expanded heuristic command filter to include `make`, `docker compose`, `gradle`, `mvn`, `dotnet test`, and `rake`.
- `buildAuditRules()` replaces the static `auditRules` constant: the `hardcoded-username` rule now uses `os.userInfo().username` dynamically, eliminating the hardcoded personal username. The `absolute-user-path` regex now covers Linux `/home/` and Windows `C:\Users\` paths.
- `classifyAuditMatch` now uses generic test/fixture/mock path detection instead of project-specific file references.

### Review focus

- Confirm that `matchesProjectContext` sibling-directory fix does not break any rollout association for real sessions.
- Confirm that the dynamic `hardcoded-username` audit rule correctly fires for the current user and does not produce false positives.
- Confirm that the sensitive pattern additions do not produce false positives on common code patterns.

## 0.1.0-alpha.6 - 2026-03-14

### Added

- Added `cam audit` to scan tracked files and Git history for privacy and secret-hygiene issues.
- Added a dedicated reviewer handoff packet for external review tools and agents.

### Changed

- Replaced scanner-triggering synthetic secret-like fixtures with safer forward-only representations.
- Documented that the repository currently shows no real secret leakage in tracked content under the project’s audit rules.
- Updated release and review docs so `cam audit` is part of the normal verification flow.
- Chosen remediation strategy is forward-only cleanup; no git history rewrite was performed.

### Review focus

- Confirm that `cam audit` usefully distinguishes confirmed risks, synthetic fixtures, and generic local-path references.
- Confirm that no unnecessary local-state files are tracked or described as committed artifacts.
- Confirm that the reviewer handoff packet is sufficient for Claude Code or other tools to continue the next review cycle.
- Confirm that the current repository state has no medium/high audit findings.

### Git milestone

- `b142288` `feat(audit): add repository privacy scanner and scrub fixtures`

## 0.1.0-alpha.5 - 2026-03-14

### Fixed

- Rollout JSONL parsing now wraps each `JSON.parse()` call in a try-catch; corrupted lines are skipped rather than crashing the entire parse.
- Added support for nested `session_meta` payload format (`payload.meta.id` / `payload.meta.cwd`), covering both flat and nested Codex rollout formats.
- `schemaRoot` default in `SyncService` now resolves via `fileURLToPath(import.meta.url)` instead of `process.cwd()`, fixing the path after `pnpm link` or npm install.
- Added `schemas/` to the `files` array in `package.json` so the schema ships with the published package.
- Hook shell scripts generated by `cam hooks install` are now set executable (`0o755`) immediately after creation.
- Removed unused `picocolors` dependency.
- Base64 safety filter pattern now requires `=` padding suffix, eliminating false positives on 40-char hex git SHAs.
- `commandSucceeded()` in the heuristic extractor now returns `false` when tool output is absent or empty (was `true`), preventing extraction of commands with unknown exit status.

### Changed

- `compileStartupMemory()` no longer slices each scope's content to `maxLines` individually. The final `limitLines()` call enforces the budget across all scopes combined, giving each scope a fair share of the 200-line window.
- `rebuildIndex()` no longer generates a `## Highlights` section in `MEMORY.md`. The index now contains only `## Topics` with topic file links and entry counts, aligning with Claude's concise index contract. Actual entry content lives exclusively in topic files.
- Post-audit documentation now distinguishes official product facts from local observations for Claude and Codex memory behavior.

### Review focus

- Confirm that rollout parsing is resilient to partial or corrupted session files from real Codex sessions.
- Confirm that `MEMORY.md` is now a clean concise index matching Claude's startup contract.
- Note: startup memory now only injects the index, not entry summaries. Topic-on-demand loading is a known remaining gap.
- Confirm that native-memory claims in docs are treated as unverified unless backed by official OpenAI documentation.

## 0.1.0-alpha.4 - 2026-03-14

### Changed

- Formalized native compatibility seams with explicit runtime contracts for session sources, extractors, and startup injectors.
- Switched wrapper and sync internals to named companion adapters instead of implicit wiring.
- Expanded `cam doctor` with native-readiness reporting for `memories` and `codex_hooks`.
- Added release-oriented reviewer documentation and a release checklist.
- Added tests for Codex feature parsing and readiness reporting.

### Review focus

- Confirm that the new compatibility seams are real replacement boundaries, not cosmetic type wrappers.
- Confirm that `cam doctor` now gives a useful migration signal instead of only raw feature output.
- Confirm that release and progress docs are sufficient for external review tooling to pick up the project state.

### Git milestone

- `f78c07f` `feat(native-compat): formalize adapters and release guidance`

## 0.1.0-alpha.3 - 2026-03-14

### Changed

- Strengthened heuristic extraction with explicit remember/forget handling, correction-aware deletes, and better command classification.
- Added a shared post-extraction safety filter to drop obviously sensitive or low-value memory candidates.
- Expanded the Codex extractor prompt with stronger Claude-parity guidance and clearer memory selection constraints.
- Upgraded `cam memory` with scope filtering, recent audit inspection, local enable/disable controls, and richer topic summaries.
- Added dedicated extractor and memory command tests.

### Review focus

- Confirm that explicit user corrections now replace stale memory rather than creating duplicates.
- Confirm that sensitive material is filtered regardless of extractor mode.
- Confirm that `cam memory` is now useful as a review and audit entrypoint rather than a raw debug dump.

### Git milestone

- `13403f8` `feat(memory-ui): improve extraction controls and inspection UX`

## 0.1.0-alpha.2 - 2026-03-14

### Changed

- Hardened rollout matching using session metadata, project context, and session time windows.
- Fixed `call_id`-based tool output stitching for rollout parsing.
- Expanded audit log payloads with project, worktree, and extractor metadata.
- Added rollout-focused regression tests for session selection and tool output association.

### Review focus

- Confirm that sync logic does not accidentally absorb neighboring Codex sessions.
- Confirm that tool outputs are paired with the correct function calls even when names repeat.
- Confirm that audit data is sufficient for future forensic review.

### Git milestone

- `5161850` `fix(sync): harden rollout matching and audit tracing`

## 0.1.0-alpha.1 - 2026-03-14

### Added

- Bootstrapped the repository as a TypeScript CLI project with `cam` as the public entrypoint.
- Added the first Markdown-backed memory store with `MEMORY.md` indexes and topic files.
- Added worktree-aware project identity and startup memory compilation.
- Added initial CLI commands for `init`, `run`, `exec`, `resume`, `memory`, `remember`, `forget`, `sync`, `doctor`, and hook bridge scaffolding.
- Added initial tests, CI, README, architecture docs, and native migration notes.

### Review focus

- Confirm that the repository-level promises in `README.md` match the actual implementation.
- Confirm that Markdown files are treated as a user-facing contract rather than an opaque cache.

### Git milestone

- `b5e7479` `chore: bootstrap codex auto memory v0.1 alpha`
