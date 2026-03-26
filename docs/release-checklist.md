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
- Confirm public wording still keeps `cam memory` as an inspect/audit surface, `cam recall` as the progressive-disclosure retrieval surface, `cam session` as a compact continuity surface, and the repository as a `Codex-first Hybrid` system rather than a native-ready replacement.
- Confirm the newer direction docs still match the README and architecture posture:
  - `docs/integration-strategy.md`
  - `docs/host-surfaces.md`
- Confirm `docs/session-continuity.md` matches the current `cam session` command surface and reviewer semantics, especially the wording split between `save`, `refresh`, and recovery markers.

## Code and runtime checks

- Prefer `pnpm verify:release` as the canonical full milestone check; run the individual commands below when you need to isolate a failure.
- Run `pnpm lint`
- Run `pnpm test:docs-contract`
- Run `pnpm test:reviewer-smoke`
- Run `pnpm test:cli-smoke`
- Run `pnpm test:dist-cli-smoke`
- Run `pnpm test:tarball-install-smoke`
- Run `pnpm test`
- Run `pnpm build`
- Run `pnpm pack:check`
- Confirm `package.json.files` still whitelists the release-facing surfaces you intend to ship: `dist`, `docs`, `schemas`, the multilingual READMEs, and `LICENSE`.
- Confirm `pnpm build` still starts from a clean `dist/` directory so `npm pack` cannot accidentally pick up stale compiled artifacts from an older tree shape.
- If you add new generated outputs beyond `dist/`, keep their cleanup path aligned with the build and pack workflow instead of letting release tarballs accumulate leftovers.
- After `pnpm build`, prefer validating release-facing CLI behavior through `node dist/cli.js ...` rather than `tsx src/cli.ts`.
- Run `node dist/cli.js --version` and confirm it matches `package.json`.
- Run `pnpm test:tarball-install-smoke` and confirm the packed `.tgz` installs cleanly, `./node_modules/.bin/cam --version` works, and at least one lightweight reviewer path such as `cam session status --json` succeeds from the installed package.
- Run `node dist/cli.js audit` if you want the repository privacy scan; keep it as a manual release-time check instead of a CI gate.
- Run `node dist/cli.js session refresh --json` and confirm `action`, `writeMode`, and `rolloutSelection` reflect the selected provenance.
- Run `node dist/cli.js session load --json` and confirm older JSON consumers still receive the existing core fields.
- Run `node dist/cli.js session status --json` and confirm the latest explicit audit drill-down matches the newest audit-log entry when present.
- Run `node dist/cli.js memory --recent --json` and confirm suppressed conflict candidates remain reviewer-visible instead of being silently merged.
- Run `node dist/cli.js recall search pnpm --json` and confirm the default search contract stays aligned at `state=auto, limit=8`, returning compact refs before any full detail fetch.
- Run `node dist/cli.js recall details <ref> --json` for one returned ref and confirm the path resolves to Markdown-backed memory, including archived refs when relevant.
- Run a local MCP smoke against `node dist/cli.js mcp serve` and confirm `search_memories`, `timeline_memories`, and `get_memory_details` are exposed as a read-only retrieval plane.
- Run `node dist/cli.js mcp install --host <codex|claude|gemini> --json` and confirm the result contract includes `host`, `serverName`, `projectRoot`, `targetPath`, `action`, `projectPinned`, and `readOnlyRetrieval`.
- Re-run the same `node dist/cli.js mcp install --host <codex|claude|gemini> --json` command once and confirm it returns `action: "unchanged"` when the target host config is already canonical.
- Confirm `node dist/cli.js mcp install --host generic` fails explicitly and still points users to manual wiring.
- Run `node dist/cli.js mcp print-config --host <codex|claude|gemini|generic> --json` for each public host and confirm the snippet contract includes `serverName`, `targetFileHint`, and a project-pinned retrieval command without writing host config files.
- For `node dist/cli.js mcp print-config --host codex --json`, also confirm the payload includes an additive AGENTS.md snippet / guidance block that teaches MCP-first, `cam recall`-fallback durable memory usage.
- Run `node dist/cli.js mcp apply-guidance --host codex --json` and confirm it reports `created`, `updated`, `unchanged`, or `blocked` without overwriting unrelated AGENTS.md content outside the managed block.
- Confirm `node dist/cli.js mcp apply-guidance --host codex --json` ignores fenced-code examples of the managed markers, and that `node dist/cli.js mcp doctor --json` does not treat fenced examples as installed guidance.
- Run `node dist/cli.js mcp doctor --json` and confirm it reports project-scoped host wiring, project pinning, and hook / skill fallback assets without creating memory layout or mutating host config files.
- Run `node dist/cli.js integrations install --host codex --json` and confirm it orchestrates the existing Codex MCP wiring, hook bundle, and skill assets without touching the Markdown memory store.
- Run `node dist/cli.js integrations apply --host codex --json` and confirm it orchestrates MCP wiring, managed AGENTS guidance, hook assets, and skill assets while keeping `integrations install --host codex` non-mutating for AGENTS.md.
- Run `node dist/cli.js skills install --surface official-user` and confirm the explicit official `.agents/skills` copy is written without changing the runtime default target.
- Run `node dist/cli.js integrations install --host codex --skill-surface official-user --json` and confirm the skill subaction reports the selected surface while MCP and AGENTS boundaries stay unchanged.
- Run `node dist/cli.js integrations doctor --host codex --json` and confirm it reports the thin Codex-only stack readiness view with `recommendedRoute`, `recommendedPreset`, `subchecks`, and `nextSteps`.
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
- Update `docs/integration-strategy.md` and `docs/host-surfaces.md` when the repository adds or defers a new integration surface.
- Re-check the current official Codex and Claude public docs before changing migration wording; if the public posture is unchanged, say so explicitly in the handoff.
- Ensure the latest milestone commit is focused enough to review independently.

## Native compatibility checks

- Run `node dist/cli.js doctor` and record the current `memories` / `codex_hooks` status.
- Run `node dist/cli.js audit` and record whether any medium/high findings remain.
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

- A pushed `v*` tag is intended to run the GitHub Release workflow.
- The workflow verifies `GITHUB_REF_NAME === v${package.json.version}`, runs `pnpm verify:release`, and uploads the `npm pack` tarball to the GitHub Release.
- Before the first real tag validation, confirm that the remote default branch exposes `release.yml` in Actions and that the workflow is active.
- npm publish remains manual until registry credentials and approval posture are intentionally wired.
