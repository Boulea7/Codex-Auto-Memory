# Changelog

All notable changes to `codex-auto-memory` will be documented in this file.

The format is intentionally simple and reviewer-friendly: each entry maps to a concrete implementation milestone and, when possible, a single Git commit.

## Unreleased

### In progress

- Extractor quality hardening
- Richer `cam memory` inspection and control surface
- Native compatibility seams and release-oriented docs

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
