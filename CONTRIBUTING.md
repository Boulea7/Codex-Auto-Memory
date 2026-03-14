# Contributing

Thanks for helping build `codex-auto-memory`.

## What we are building

This project is not a generic note-taking tool. It is a Codex companion that tries to reproduce the observable behavior of Claude Code auto memory:

- automatic memory capture after work
- local Markdown storage
- compact startup injection through `MEMORY.md`
- topic files for detailed notes
- worktree-aware repository memory sharing

When proposing changes, evaluate them against that product contract first.

## Development Setup

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

Use Node 20+ and `pnpm`.

## Branch and PR expectations

- Keep pull requests focused.
- Explain the user-facing behavior change, not just the code diff.
- Add or update tests for logic changes.
- Update docs whenever behavior, config, or file layout changes.
- Include screenshots or terminal output only when it helps explain the UX.

## Coding Guidelines

- Prefer small modules with explicit responsibilities.
- Keep file formats human-readable.
- Avoid over-engineering. Start with the simplest version that keeps future migration possible.
- Keep comments in English.

## Documentation Guidelines

If your change affects one of these areas, update the matching file:

- Claude behavior parity: `docs/claude-reference.md`
- internals and storage model: `docs/architecture.md`
- future native compatibility: `docs/native-migration.md`
- onboarding and positioning: `README.md`

## Reporting Issues

When opening a bug, include:

- your OS
- Node and pnpm versions
- Codex CLI version
- whether the session ran through `cam run`, `cam exec`, or `cam resume`
- relevant memory directory structure or rollout path if safe to share

Please redact secrets before posting logs or memory files.
