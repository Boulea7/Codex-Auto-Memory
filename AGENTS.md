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

## Current Notes

- Milestone 12 is complete: Codex-backed continuity now uses shared evidence buckets, explicit structural validation, and low-signal fallback to the heuristic summarizer.
- Durable contradiction handling now covers high-confidence explicit corrections in `preferences` and `workflow`, in addition to the earlier command replacement path.
- `cam memory --json` now exposes `startupFilesByScope` and `topicFilesByScope`, and default output groups on-demand topic refs by scope.
- Milestone 13 is complete: session continuity generation now writes reviewer-oriented diagnostics to `projects/<project-id>/audit/session-continuity-log.jsonl`, and `cam session` surfaces the latest generation path plus fallback reason in JSON mode.
- `cam memory --json` now also exposes `startupBudget` and `refCountsByScope` for reviewer tooling.
- Native Codex `memories` and `codex_hooks` still remain outside the trusted implementation path until `cam doctor --json` and public docs both show stable support.

## Planning Notes

Short-term priorities:

- keep Codex-backed continuity as the tested primary path and make diagnostics easy to review without polluting Markdown continuity files
- expand contradiction fixtures conservatively for explicit `preferences` / `workflow` replacement without broad fuzzy deletion
- keep `cam memory` useful as a grouped startup/topic-file audit surface with compact reviewer summaries
- keep startup injection limited to quoted `MEMORY.md` indexes plus topic-file references; do not reintroduce eager topic-entry loading
- keep session continuity separate from durable memory; optimize Codex compatibility first and treat Claude-style continuity as an adapter layer

Long-term priorities:

- native adapter for official Codex memory
- better memory inspection UX
- stronger extraction quality and conflict handling
