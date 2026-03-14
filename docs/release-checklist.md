# Release Checklist

Use this checklist before cutting any alpha or beta release of `codex-auto-memory`.

## Product contract checks

- Confirm the README still matches current CLI behavior.
- Confirm `docs/claude-reference.md` still reflects the Claude-style contract the code is trying to mimic.
- Confirm `docs/native-migration.md` still matches the current compatibility seams in code.

## Code and runtime checks

- Run `pnpm lint`
- Run `pnpm test`
- Run `pnpm build`
- Run `cam audit`
- Run a local smoke flow:
  - `cam init`
  - `cam remember "..."`
  - `cam memory --recent --print-startup`
  - `cam forget "..."`
  - `cam doctor`

## Review packet checks

- Update `CHANGELOG.md` with the new milestone and commit hash.
- Update `docs/progress-log.md` to reflect the current phase and remaining gaps.
- Update `docs/review-guide.md` if a new high-risk area or review order is introduced.
- Update `docs/reviewer-handoff.md` so external review tools can pick up the current state quickly.
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
