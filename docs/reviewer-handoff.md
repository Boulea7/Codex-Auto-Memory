# Reviewer Handoff

This document is the shortest complete handoff packet for external review tools and agents.

## Project intent

`codex-auto-memory` is a local-first companion CLI that tries to reproduce the observable product contract of Claude Code auto memory for current Codex releases.

It is **not**:

- a generic note-taking app
- a cloud memory service
- an account-level personalization layer

It is trying to prove:

- Markdown-first memory can remain user-auditable
- Codex can be given a Claude-style auto-memory workflow today via a companion architecture
- the project can later migrate toward native Codex memory without changing the user mental model

## Current state

The repository currently has:

- a Chinese-first public README plus an English switchable README for open-source visitors
- a bilingual docs entry page and bilingual core design docs for parity, architecture, and migration posture
- a wrapper-based startup injector with quoted `MEMORY.md` indexes and structured topic file references
- a separate session continuity layer for temporary working-state handoff across conversations, split into shared project and project-local layers
- a rollout-backed post-session sync path
- a Markdown memory store with `MEMORY.md` indexes and topic files
- explicit compatibility seams for session source, extractor, and runtime injector
- review-oriented docs and changelog tracking
- a repository privacy audit command: `cam audit`
- a reviewer-oriented durable sync audit log at `projects/<project-id>/audit/sync-log.jsonl` keyed by structured rollout identity
- a reviewer-oriented `cam memory` surface that shows startup-loaded index files, on-demand topic refs, edit paths, recent durable sync audit events, and configured-vs-actual extractor truth when fallback occurs
- a reviewer-oriented continuity audit log that records preferred vs actual generation path, fallback reasons, evidence counts, and written continuity paths
- a reviewer-oriented `cam session` surface that shows the latest continuity diagnostics, the latest evidence/written-path drill-down, and a compact recent generation preview
- conservative contradiction handling that now has extra negative-fixture coverage so unsupported topics do not auto-delete stale memory
- a release checklist that now explicitly calls out paired bilingual public-doc consistency checks

## Audit surface map

- `cam audit`: repository-level privacy and secret-hygiene audit
- `cam memory --recent [count]`: durable sync audit for recent `applied` / `no-op` / `skipped` sync events
- `cam session save|load|status`: continuity audit surface for the latest diagnostics; `load` / `status` text output adds compact recent history, and all three `--json` variants return recent audit entries

Manual `cam remember` / `cam forget` updates remain outside the durable sync audit stream by design.

## Most recent milestone commits

- current implementation window: alpha.19 sync identity hardening and extractor audit truth
- `91336e8` `feat(alpha.18): tighten durable sync audit contract`
- `d8e88f9` `feat(alpha.17): add continuity drill-down and docs discipline`
- `0f40277` `docs(alpha.16): redesign bilingual readme and docs portal`
- `34934fc` `feat(alpha.15): harden contradiction boundaries and review wording`
- `7cb6337` `fix(ci): rely on packageManager for pnpm version`

## Verified safety status

As of the latest audit pass:

- no real secrets or private keys were found in tracked files
- no `.claude/` local state is tracked by Git
- synthetic secret-like fixtures were converted to safer forward-only forms
- reviewer-visible docs now distinguish official facts from local observations
- the repository currently reports no `high` or `medium` audit findings
- remaining audit findings are expected `info` references to local-path contracts plus `low` synthetic fixtures still present in older commits

This does **not** mean the repository is permanently risk-free. It means the current tracked content passed the project’s current audit rules.

The project intentionally chose a **forward-only cleanup** strategy. Earlier commits may still contain synthetic scanner-triggering fixtures, but history was not rewritten because those strings are not real credentials and rewriting public hashes would create unnecessary churn.

## Highest-value remaining gaps

- topic files are now referenced for on-demand reads, but the runtime still relies on generic file-read tools rather than a native lazy-loading hook
- extractor quality still needs broader contradiction handling beyond explicit commands, preferences, and workflow corrections, even though unsupported-topic auto-delete is now guarded more conservatively
- `cam memory` is still shallower than Claude Code’s `/memory`, especially around edit/toggle ergonomics
- durable sync audit is now explicitly typed, keyed by structured rollout identity, and reviewer-visible, but it still intentionally stays separate from manual `remember` / `forget` edit history
- durable sync writes still are not fully transactional across memory files, audit append, and processed-state persistence
- bilingual public docs now exist, but they require disciplined co-maintenance to avoid Chinese / English drift
- continuity diagnostics now expose the latest generation, the latest evidence/written-path drill-down, and a short recent preview, but the CLI still does not provide a dedicated history browser beyond the audit JSONL
- `docs/next-phase-brief.md` now captures the recommended post-alpha.19 execution brief

## Recommended review sequence

1. Run `cam audit`
2. Run `cam doctor --json`
3. Run `pnpm test`
4. Read `README.md` or `README.en.md`
5. Read `docs/README.md` or `docs/README.en.md`
6. Read `docs/claude-reference.md`
7. Read `docs/session-continuity.md`
8. Read `docs/native-migration.md`
9. Read `docs/progress-log.md`
10. Read `docs/review-guide.md`
11. Inspect `src/lib/domain/memory-sync-audit.ts`
12. Inspect `src/lib/domain/sync-service.ts`
13. Inspect `src/lib/commands/memory.ts`
14. Inspect `src/lib/extractor/heuristic-extractor.ts`
15. Inspect `src/lib/commands/session.ts`
16. Inspect `src/lib/domain/rollout.ts`
17. Inspect `src/lib/domain/startup-memory.ts`
18. Inspect `src/lib/domain/session-continuity-store.ts`

## Suggested verification commands

```bash
pnpm lint
pnpm test
pnpm build
node dist/cli.js audit --json
node dist/cli.js doctor --json
node dist/cli.js session save --json
node dist/cli.js session status --json
node dist/cli.js session load --json
node dist/cli.js memory --json --recent 5
```

## Review stance

If a reviewer finds a difference between:

- official Claude docs
- official Codex docs
- local runtime observations
- current project docs

then the project should prefer:

1. official product docs
2. verified local behavior
3. explicit documentation of uncertainty

over confident but unsupported claims.
