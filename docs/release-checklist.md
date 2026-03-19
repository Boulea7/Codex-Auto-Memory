# Release Checklist

Use this checklist before cutting any alpha or beta release of `codex-auto-memory`.

## Product contract checks

- Confirm the README still matches current CLI behavior.
- Confirm the paired Chinese and English public docs still describe the same product boundary and command surface:
  - `README.md` and `README.en.md`
  - `docs/README.md` and `docs/README.en.md`
  - `docs/claude-reference.md` and `docs/claude-reference.en.md`
  - `docs/architecture.md` and `docs/architecture.en.md`
  - `docs/native-migration.md` and `docs/native-migration.en.md`
- Confirm `docs/claude-reference.md` still reflects the Claude-style contract the code is trying to mimic.
- Confirm `docs/native-migration.md` still matches the current compatibility seams in code.
- Confirm public wording still keeps `cam memory` as an inspect/audit surface, `cam session` as a compact continuity surface, and the project as companion-first rather than native-ready.
- Confirm `docs/session-continuity.md` matches the current `cam session` command surface and reviewer semantics, especially the wording split between `save`, `refresh`, and recovery markers.

## Code and runtime checks

- Run `pnpm lint`
- Run `pnpm test`
- Run `pnpm build`
- Run `cam audit`
- Run `cam session refresh --json` and confirm `action`, `writeMode`, and `rolloutSelection` reflect the selected provenance.
- Run `cam session load --json` and confirm older JSON consumers still receive the existing core fields.
- Run `cam session status --json` and confirm the latest explicit audit drill-down matches the newest audit-log entry when present.
- Run a local smoke flow:
  - `cam init`
  - `cam remember "..."`
  - `cam memory --recent --print-startup`
  - `cam session status`
  - `cam session save`
  - `cam session refresh`
  - `cam session load --print-startup`
  - `cam forget "..."`
  - `cam doctor`

## Documentation checks

- Update the bilingual docs entry pages (`docs/README.md` and `docs/README.en.md`) if the public reading path changed.
- Re-check the current official Codex and Claude public docs before changing migration wording; if the public posture is unchanged, say so explicitly in the handoff.
- Ensure the latest milestone commit is focused enough to review independently.

## Native compatibility checks

- Run `cam doctor` and record the current `memories` / `codex_hooks` status.
- Run `cam audit` and record whether any medium/high findings remain.
- Confirm that any native-facing code still preserves companion fallback.
- Confirm that Markdown memory remains the user-facing source of truth.

## Release decision

Do not tag a release unless:

- tests are green
- docs are current
- changelog is updated
- review artifacts are in place
- the current milestone can be explained without reading every commit in the repository
