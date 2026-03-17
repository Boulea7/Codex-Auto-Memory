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
- Keep any machine-specific or private AI review handoff in `AI_REVIEW.local.md` at the repository root. That file must stay gitignored and untracked.

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
- Milestone 14 is complete: `cam session save|load|status --json` now also expose `recentContinuityAuditEntries`, and default `cam session load|status` output includes a compact recent generation preview sourced from the audit log.
- Milestone 15 is complete: contradiction handling now has extra negative-fixture guardrails, generic `remember` overlap deletes stay constrained to supported correction paths, and public docs are more precise about `cam memory` inspection vs in-command editing.
- Milestone 16 is complete: the default README is now Chinese-first, the repository ships an English `README.en.md`, and the three core design docs now have bilingual entry points.
- Milestone 17 is complete: `cam session save|load|status --json` now also expose `latestContinuityAuditEntry`, and the default `cam session` text output includes latest-generation evidence counts plus written continuity paths.
- Milestone 18 is complete: durable sync audit now uses an explicit reviewer contract, `cam memory --recent` now covers `applied` / `no-op` / `skipped` sync events, and `cam memory --json` now exposes `recentSyncAudit` plus `syncAuditPath` while keeping `recentAudit` as a compatibility alias.
- Milestone 19 is complete: durable sync processed state now uses structured rollout identity instead of path-only skip semantics, and durable sync audit now records configured vs actual extractor truth.
- Milestone 20 is complete: startup-loaded `MEMORY.md` index files now stay separate from on-demand topic refs in the reviewer surface, topic-entry metadata parsing skips invalid shapes safely, and continuity evidence no longer treats in-progress command output as a failed command.
- Milestone 21 is complete: partial-success durable sync and continuity saves now write explicit recovery markers, reviewer JSON/text surfaces expose pending recovery state additively, and `processedRolloutEntries` bounded compaction remains intentionally deferred.
- `cam memory --json` now also exposes `startupBudget` and `refCountsByScope` for reviewer tooling.
- Native Codex `memories` and `codex_hooks` still remain outside the trusted implementation path until `cam doctor --json` and public docs both show stable support.

## Planning Notes

Short-term priorities:

- keep Codex-backed continuity as the tested primary path and make diagnostics easy to review without polluting Markdown continuity files
- keep the latest continuity audit drill-down and recent previews compact and reviewer-friendly without turning `cam session` into a full history browser
- keep contradiction deletes conservative outside the supported command / explicit `preferences` / explicit `workflow` paths
- keep `cam memory` useful as a grouped startup/topic-file audit surface with compact reviewer summaries
- keep startup-loaded index files and on-demand topic refs semantically separate in both implementation and docs
- keep recovery markers separate from both durable sync audit history and continuity audit history
- keep durable sync audit explicit and typed without turning it into a manual-edit history browser
- keep structured processed-rollout identity and actual-vs-configured extractor audit stable without adding migration-heavy state machinery
- keep bounded `processedRolloutEntries` compaction deferred unless the repository explicitly accepts replay-triggered re-sync of evicted old rollouts
- keep in-progress command output out of continuity failure buckets unless the rollout later records an explicit failure
- keep public wording precise whenever `cam memory` exposes edit paths rather than richer in-command editing
- keep Chinese and English public docs aligned without turning the entire maintainer surface into full bilingual duplication
- keep release hygiene explicit about paired bilingual public-doc checks and companion-first wording
- keep startup injection limited to quoted `MEMORY.md` indexes plus topic-file references; do not reintroduce eager topic-entry loading
- keep session continuity separate from durable memory; optimize Codex compatibility first and treat Claude-style continuity as an adapter layer

Long-term priorities:

- native adapter for official Codex memory
- better memory inspection UX
- stronger extraction quality and conflict handling
