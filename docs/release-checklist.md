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
- Run `pnpm test:docs-contract`
- Run `pnpm test:reviewer-smoke`
- Run `pnpm test:cli-smoke`
- Run `pnpm test:dist-cli-smoke`
- Run `pnpm test`
- Run `pnpm build`
- Run `pnpm pack:check`
- After `pnpm build`, prefer validating release-facing CLI behavior through `node dist/cli.js ...` rather than `tsx src/cli.ts`.
- Run `node dist/cli.js --version` and confirm it matches `package.json`.
- Run `node dist/cli.js audit` if you want the repository privacy scan; keep it as a manual release-time check instead of a CI gate.
- Run `node dist/cli.js session refresh --json` and confirm `action`, `writeMode`, and `rolloutSelection` reflect the selected provenance.
- Run `node dist/cli.js session load --json` and confirm older JSON consumers still receive the existing core fields.
- Run `node dist/cli.js session status --json` and confirm the latest explicit audit drill-down matches the newest audit-log entry when present.
- Run `node dist/cli.js memory --recent --json` and confirm suppressed conflict candidates remain reviewer-visible instead of being silently merged.
- Confirm `node dist/cli.js session load --json` / `status --json` still expose `confidence` and warnings when the rollout required a conservative continuity summary.
- Confirm continuity reviewer warnings stay in diagnostics / audit surfaces and are not written into continuity Markdown body text.
- Run a local smoke flow:
  - `node dist/cli.js init`
  - `node dist/cli.js remember "..."`
  - `node dist/cli.js memory --recent --print-startup`
  - `node dist/cli.js session status`
  - `node dist/cli.js session save`
  - `node dist/cli.js session refresh`
  - `node dist/cli.js session load --print-startup`
  - `node dist/cli.js forget "..."`
  - `node dist/cli.js doctor`

## Documentation checks

- Update the bilingual docs entry pages (`docs/README.md` and `docs/README.en.md`) if the public reading path changed.
- Re-check the current official Codex and Claude public docs before changing migration wording; if the public posture is unchanged, say so explicitly in the handoff.
- Ensure the latest milestone commit is focused enough to review independently.

## Native compatibility checks

- Run `cam doctor` and record the current `memories` / `codex_hooks` status.
- Run `pnpm exec tsx src/cli.ts audit` and record whether any medium/high findings remain.
- Confirm that any native-facing code still preserves companion fallback.
- Confirm that Markdown memory remains the user-facing source of truth.

## Release decision

Do not tag a release unless:

- tests are green
- docs are current
- review artifacts are in place
- the current milestone can be explained without reading every commit in the repository
- the tag format is `v<package.json.version>`

## Release automation notes

- A pushed `v*` tag now runs the GitHub Release workflow.
- The workflow verifies `GITHUB_REF_NAME === v${package.json.version}`, runs `pnpm verify:release`, and uploads the `npm pack` tarball to the GitHub Release.
- npm publish remains manual until registry credentials and approval posture are intentionally wired.
