# Repository Guidelines

## Project Mission

`codex-auto-memory` is an open-source companion CLI that recreates Claude-style auto memory behavior for Codex. The repository should optimize for three outcomes:

- a stable local Markdown memory system
- a clean Codex integration story for today's CLI
- a migration path toward future native Codex memory and hooks

## Source of Truth

Before making architectural changes, read these files in order:

1. `README.md`
2. `docs/claude-reference.md`
3. `docs/architecture.md`
4. `docs/native-migration.md`

If the implementation changes behavior, update the matching docs in the same task.

## Project Layout

- `src/`: CLI entrypoint and implementation
- `test/`: unit and integration coverage
- `schemas/`: structured output schemas for memory extraction
- `docs/`: product, architecture, and migration notes
- `.github/`: CI and collaboration templates

## Engineering Rules

- Keep implementations simple and local-first.
- Prefer plain TypeScript + Node standard library when the added abstraction does not clearly pay for itself.
- Treat Markdown memory files as a user-facing interface, not an opaque cache.
- Do not silently change repository-tracked files in user projects to inject memory.
- Preserve compatibility seams for future native Codex memory and hook support.
- Keep code comments in English and use them only when they clarify non-obvious logic.

## Documentation Rules

- Any change to config precedence, storage layout, startup injection, or migration strategy must update docs.
- README should remain suitable for new open-source visitors.
- `docs/claude-reference.md` should capture the Claude behavior this project is trying to mimic.

## Validation

Run the following before finishing a meaningful change:

```bash
pnpm lint
pnpm test
pnpm build
```

If any step is skipped, explain why in the final handoff.

## Planning Notes

Short-term priorities:

- ship the first working CLI wrapper and memory store
- validate the 200-line startup compiler
- verify project vs project-local behavior across git worktrees

Long-term priorities:

- native adapter for official Codex memory
- better memory inspection UX
- stronger extraction quality and conflict handling
