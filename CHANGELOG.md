# Changelog

All notable changes to `codex-auto-memory` will be documented in this file.

The format is intentionally simple and reviewer-friendly: each entry maps to a concrete implementation milestone and, when possible, a single Git commit.

## Unreleased

### In progress

- Reviewer handoff packet polish

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

- Pending commit for native compatibility seams and release-oriented docs

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

- Pending commit for extractor quality and memory inspection UX hardening

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
