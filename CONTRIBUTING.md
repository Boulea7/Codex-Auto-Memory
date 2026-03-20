# Contributing

Thanks for helping build `codex-auto-memory`.

## What we are building

This project is not a generic note-taking tool. It is a Codex companion that tries to reproduce the observable behavior of Claude Code auto memory:

- automatic memory capture after work
- local Markdown storage
- compact startup injection through `MEMORY.md`
- topic files for detailed notes
- worktree-aware repository memory sharing
- temporary cross-session continuity through `cam session`
- repository privacy auditing through `cam audit`

When proposing changes, evaluate them against that product contract first.

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

## Branch and PR expectations

- Keep pull requests focused.
- Explain the user-facing behavior change, not just the code diff.
- Add or update tests for logic changes.
- Update docs whenever behavior, config, or file layout changes.
- Include screenshots or terminal output only when it helps explain the UX.
- If you touch release-facing CLI behavior, validate `node dist/cli.js` or `pnpm test:dist-cli-smoke`.
- If you touch packaging, release verification, or install-time CLI behavior, also validate `pnpm test:tarball-install-smoke`.

## Current maintainer focus

- Prefer structural simplification over feature expansion in the next phase.
- If you refactor repository structure, keep the command surface stable unless a behavior change is intentional and documented.
- Before borrowing ideas from similar tools such as `mem0`, first inspect their current public docs or repository context and extract only patterns that fit this project's companion-first posture.
- Use external research to improve module boundaries, reviewer surfaces, and maintainability, not to broaden the product scope by default.

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

- Claude behavior parity: `docs/claude-reference.md`
- internals and storage model: `docs/architecture.md`
- reviewer continuity contract: `docs/session-continuity.md`
- release-time reviewer checks: `docs/release-checklist.md`
- future native compatibility: `docs/native-migration.md`
- onboarding and positioning: `README.md` and `README.en.md`

The repository now uses a bilingual public-doc setup:

- `README.md` is the default Chinese landing page
- `README.en.md` is the English landing page
- `docs/claude-reference.*`, `docs/architecture.*`, and `docs/native-migration.*` are maintained in both Chinese and English
- `docs/session-continuity.md` and `docs/release-checklist.md` are English-first maintainer/reviewer docs and should still be updated when reviewer surfaces or command contracts change

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
