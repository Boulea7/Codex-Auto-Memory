# Progress Log

This document tracks implementation progress in a format that is easy to consume during external review or handoff to other tools and agents.

## Current completion snapshot

- Approximate overall progress toward a strong Claude-style alpha: `75%`
- Approximate progress toward a working local MVP: `90%`
- Current phase: `Phase 3 - review and release hardening`

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

### Milestone 4: Native compatibility seams

- Explicit compatibility interfaces now exist for session source, extractor, and runtime injector concerns.
- The runtime now names and uses its companion session source and wrapper injector explicitly.
- `cam doctor` now reports native-readiness in a more reviewer-friendly way instead of dumping raw feature flags only.

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
- Native Codex memory and hook support is still companion-first; no native path is activated. Codex now ships native memory but parity verification against our contract is pending.
- Startup memory now injects only the MEMORY.md index (topic links + counts), not the actual entry content. Topic files are not loaded on-demand yet, which is a gap compared to Claude’s lazy topic loading.
- Release hygiene is stronger now, but still needs a formal reviewer handoff packet per release.

### Milestone 5: Bug fixes, parity hardening, and native compat update

- Fixed per-line try-catch in rollout JSONL parsing to survive corrupted lines.
- Added support for nested `session_meta` payload format (`payload.meta.id`).
- Fixed `schemaRoot` default to use `fileURLToPath(import.meta.url)` instead of `process.cwd()`.
- Fixed hook scripts to set executable permissions (`chmod 0o755`) after generation.
- Removed `picocolors` unused dependency; added `schemas/` to published package files.
- Fixed base64 safety filter false-positive on git SHA hashes.
- Fixed `commandSucceeded()` to default `false` when tool output is missing.
- Removed per-scope line slicing in `compileStartupMemory`; budget enforced by final `limitLines()`.
- Removed `## Highlights` section from `MEMORY.md` index to align with Claude's concise index contract.
- Updated native migration docs to reflect the difference between official Codex documentation and local implementation observations.
- Clarified Claude reference: manual edit/delete is officially documented, while subagent sharing/isolation semantics remain only partially specified in the public docs.

### Milestone 5 audit outcome

- **Accepted**:
  - corrupted rollout line skipping
  - nested `session_meta` parsing
  - schema path resolution via `import.meta.url`
  - executable hook scripts
  - shipping `schemas/` in the published package
  - false-positive reduction in the safety filter
  - treating missing tool output as unknown success
  - concise `MEMORY.md` index direction
- **Accepted with caveat**:
  - startup now injects only the index, which is safer for parity but currently weaker in usefulness until topic-on-demand loading is implemented
- **Corrected in docs**:
  - stronger-than-supported claims about Claude forget semantics
  - stronger-than-supported claims about Claude subagent memory sharing/isolation
  - stronger-than-supported claims about Codex native memory layout and config contract

## Next planned milestones

### Milestone 6: Release and review packet hardening

- Add a reviewer handoff packet per milestone or release.
- Tighten README status and changelog discipline around milestone commits.
- Implement on-demand topic file loading in startup memory (currently MEMORY.md index only).

## Review-ready habits

- Keep milestone commits focused and descriptive.
- Update `CHANGELOG.md` with every milestone commit.
- Update this progress log whenever phase status changes.
- Record any temporary compromises so other tools do not mistake them for intentional final behavior.
