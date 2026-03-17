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
- a reviewer-oriented `cam memory` surface that shows startup-loaded files, topic refs, and edit paths
- a reviewer-oriented continuity audit log that records preferred vs actual generation path and fallback reasons
- a reviewer-oriented `cam session` surface that shows the latest continuity diagnostics plus a compact recent generation preview
- conservative contradiction handling that now has extra negative-fixture coverage so unsupported topics do not auto-delete stale memory

## Most recent milestone commits

- current implementation window: alpha.16 bilingual docs portal and README redesign
- `34934fc` `feat(alpha.15): harden contradiction boundaries and review wording`
- `7cb6337` `fix(ci): rely on packageManager for pnpm version`
- `7bacf9f` `feat(alpha.14): refresh reviewer packet and session history preview`

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
- bilingual public docs now exist, but they require disciplined co-maintenance to avoid Chinese / English drift
- continuity diagnostics now expose the latest generation plus a short recent preview, but the CLI still does not provide a dedicated history browser beyond the audit JSONL
- `docs/next-phase-brief.md` now captures the recommended post-alpha.16 execution brief

## Recommended review sequence

1. Run `cam audit`
2. Run `pnpm test`
3. Read `README.md` or `README.en.md`
4. Read `docs/README.md` or `docs/README.en.md`
5. Read `docs/claude-reference.md`
6. Read `docs/session-continuity.md`
7. Read `docs/native-migration.md`
8. Read `docs/progress-log.md`
9. Read `docs/review-guide.md`
10. Inspect `src/lib/extractor/heuristic-extractor.ts`
11. Inspect `src/lib/commands/session.ts`
12. Inspect `src/lib/domain/rollout.ts`
13. Inspect `src/lib/domain/startup-memory.ts`
14. Inspect `src/lib/domain/session-continuity-store.ts`

## Suggested verification commands

```bash
pnpm lint
pnpm test
pnpm build
node dist/cli.js audit --json
node dist/cli.js doctor --json
node dist/cli.js session load --json
node dist/cli.js memory --json
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
