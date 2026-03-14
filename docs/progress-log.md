# Progress Log

This document tracks implementation progress in a format that is easy to consume during external review or handoff to other tools and agents.

## Current completion snapshot

- Approximate overall progress toward a strong Claude-style alpha: `45%`
- Approximate progress toward a working local MVP: `70%`
- Current phase: `Phase 2 - Claude parity hardening`

## Completed milestones

### Milestone 1: Repository bootstrap

- Project initialized as a TypeScript CLI with `pnpm`, `vitest`, and CI.
- Core runtime skeleton added:
  - config loading
  - worktree-aware project identity
  - Markdown memory storage
  - startup memory compilation
  - CLI wrapper commands
- Initial docs added:
  - README
  - architecture
  - Claude reference contract
  - native migration strategy

### Milestone 2: Sync reliability hardening

- Rollout matching upgraded from loose time-only heuristics toward metadata-aware selection.
- Rollout parser now preserves `call_id` and stitches outputs to the correct tool calls.
- Audit logs now capture project and extractor context.
- Rollout regression tests added.

### Milestone 3: Extractor quality and memory inspection UX

- Heuristic extraction now handles explicit remember, forget, and correction flows more realistically.
- A shared safety filter now removes obviously sensitive memory candidates before they reach the Markdown store.
- `cam memory` now exposes scope filtering, recent audit summaries, and local enable/disable controls.
- Additional tests now cover extractor behavior and memory inspection behavior.

## Reviewer checkpoints

If you are reviewing the repository now, start here:

1. `README.md`
2. `docs/claude-reference.md`
3. `docs/architecture.md`
4. `docs/review-guide.md`
5. `src/lib/domain/rollout.ts`
6. `src/lib/domain/sync-service.ts`
7. `src/lib/domain/memory-store.ts`

## Known gaps

- Extractor quality is stronger, but still needs broader real-world rollout fixtures and more nuanced contradiction handling.
- `cam memory` is more audit-friendly now, but still below Claude Code’s `/memory` interaction depth.
- Native Codex memory and hook support is only prepared as a migration seam, not activated.
- Release hygiene is improving, but a formal release checklist and review packet are still needed.

## Next planned milestones

### Milestone 4: Native compatibility preparation

- Formalize compatibility seams around session source, extractor, store, and injector.
- Expand `cam doctor` to report native-readiness status more clearly.

### Milestone 5: Release and review packet hardening

- Add a release checklist and reviewer handoff packet.
- Tighten README status and changelog discipline around milestone commits.

## Review-ready habits

- Keep milestone commits focused and descriptive.
- Update `CHANGELOG.md` with every milestone commit.
- Update this progress log whenever phase status changes.
- Record any temporary compromises so other tools do not mistake them for intentional final behavior.
