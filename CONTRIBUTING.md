# Contributing

Thanks for helping build `codex-auto-memory`.

## Development Setup

```bash
pnpm install
pnpm lint
pnpm test:docs-contract
pnpm test:reviewer-smoke
pnpm test:cli-smoke
pnpm test
pnpm build
pnpm test:dist-cli-smoke
pnpm test:tarball-install-smoke
```

Use Node 20+ and `pnpm`.

`pnpm test` is the default source-level suite. Build-dependent release checks stay explicit in
`pnpm test:dist-cli-smoke` and `pnpm test:tarball-install-smoke`.

## What to optimize for

`codex-auto-memory` is a Codex-first, Markdown-first local memory tool. Good changes usually make one of these things better without hiding behavior behind extra complexity:

- carrying useful context across sessions
- keeping memory files readable and editable
- making review, recall, and release surfaces easier to trust

## Branch and PR expectations

- Keep pull requests focused.
- Explain the user-facing behavior change, not just the code diff.
- Add or update tests for logic changes.
- Update docs whenever behavior, config, or file layout changes.
- Include screenshots or terminal output only when it helps explain the UX.
- If you touch release-facing CLI behavior, validate `node dist/cli.js` or `pnpm test:dist-cli-smoke`.
- If you touch packaging, release verification, or install-time CLI behavior, also validate `pnpm test:tarball-install-smoke`.
- If you touch `cam integrations`, `cam mcp doctor`, or shared readiness guidance, treat the change as release-facing even when the implementation is only additive.
- If you touch `cam mcp print-config`, `cam mcp apply-guidance`, `cam integrations apply`, Codex `AGENTS.md` guidance, or shared MCP/AGENTS snippet builders, treat the change as release-facing too.
- If you touch `cam skills install`, skill surface selection, or runtime vs official `.agents/skills` compatibility wording, treat the change as release-facing and verify both source tests and dist/tarball smoke.

## Current maintainer focus

- Prefer structural simplification over unnecessary sprawl, but treat the issue-level memory goals and the new integration surfaces as intentional product expansion.
- If you refactor repository structure, keep the command surface stable unless a behavior change is intentional and documented.
- Before borrowing ideas from other memory tools, first inspect their current public docs or repository context and extract only patterns that fit this project's Markdown-first and Codex-first posture.
- Use external research to improve module boundaries, reviewer surfaces, lifecycle semantics, and integration surfaces, while keeping the current repository out of multi-host platform sprawl.

## Coding Guidelines

- Prefer small modules with explicit responsibilities.
- Keep file formats human-readable.
- Avoid over-engineering. Start with the simplest version that keeps future migration possible.
- Keep comments in English.
- Keep reviewer-only warnings and confidence prose in audit/reviewer surfaces; they should not become continuity body content.
- Keep `src/cli.ts` narrow. New commands should be registered through `src/lib/cli/register-commands.ts` instead of expanding the main entrypoint again.
- Keep runtime composition in `src/lib/runtime/runtime-context.ts`; command files should depend on that runtime surface instead of rebuilding their own composition helpers.
- Keep `src/lib/commands/session.ts` thin. Provenance selection and action dispatch belong there; reviewer-facing text/json assembly belongs in `src/lib/commands/session-presenters.ts`.
- Keep shared continuity persistence in `src/lib/domain/session-continuity-persistence.ts` so session commands and wrapper auto-save do not drift into separate persistence code paths.
- When touching continuity persistence, preserve the current contract split:
  - `cam session save` = `merge`
  - `cam session refresh` = `replace`
  - wrapper auto-save = `merge`
- Do not hard-merge the rollout selection rules for `cam session refresh` and wrapper auto-save. They intentionally share persistence semantics, not identical provenance selection.
- If you split tests, keep `runSession` and wrapper continuity coverage in separate files and share helpers from `test/helpers/` rather than re-inlining temp-dir or mock-wrapper setup.

## Documentation Guidelines

If your change affects one of these areas, update the matching file:

- host behavior parity: `docs/host-reference.md`
- internals and storage model: `docs/architecture.md`
- reviewer continuity contract: `docs/session-continuity.md`
- release-time reviewer checks: `docs/release-checklist.md`
- future native compatibility: `docs/native-migration.md`
- integration direction and host boundaries: `docs/integration-strategy.md`, `docs/host-surfaces.md`
- onboarding and positioning: `README.md` and `README.en.md`

The repository now uses four public landing pages and four docs hubs:

- `README.md` is the default Chinese landing page
- `README.zh-TW.md` is the Traditional Chinese landing page
- `README.en.md` is the English landing page
- `README.ja.md` is the Japanese landing page
- `docs/README.md`, `docs/README.zh-TW.md`, `docs/README.en.md`, and `docs/README.ja.md` are the matching docs hubs
- `docs/architecture.*` and `docs/native-migration.*` currently provide the deepest technical overview in Chinese and English
- `docs/session-continuity.md` and `docs/release-checklist.md` are English-first maintainer/reviewer docs and should still be updated when reviewer surfaces or command contracts change
- `docs/integration-strategy.md` and `docs/host-surfaces.md` are currently Chinese-first strategy docs and should be kept aligned with the public README posture

If you change shared meaning in one of those files, update the sibling language version in the same task or explicitly note the follow-up gap in your handoff.

## Reporting Issues

When opening a bug, include:

- your OS
- Node and pnpm versions
- Codex CLI version
- whether the session ran through `cam run`, `cam exec`, `cam resume`, or `cam session`
- relevant memory directory structure or rollout path if safe to share
- output of `cam audit --json` and `cam doctor --json` if available

Please redact secrets before posting logs or memory files.
