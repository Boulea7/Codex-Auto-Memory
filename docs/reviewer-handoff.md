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

- a wrapper-based startup injector with quoted `MEMORY.md` indexes and structured topic file references
- a separate session continuity layer for temporary working-state handoff across conversations, split into shared project and project-local layers
- a rollout-backed post-session sync path
- a Markdown memory store with `MEMORY.md` indexes and topic files
- explicit compatibility seams for session source, extractor, and runtime injector
- review-oriented docs and changelog tracking
- a repository privacy audit command: `cam audit`
- a reviewer-oriented `cam memory` surface that shows startup-loaded files, topic refs, and edit paths

## Most recent milestone commits

- current implementation window: alpha.11 continuity layering, extractor contradiction coverage, and `cam memory` reviewer UX hardening
- `47871b6` `chore(test): reduce audit fixture scanner noise`
- `3b25bf1` `fix(session): correct file-write detection and confirmedWorking evidence gate`
- `b406163` `feat(session): improve heuristic summarizer and sync docs for alpha.10`
- `a8257b6` `feat(session): add codex-first continuity layer`
- `214022f` `feat(runtime): add topic-aware startup guardrails`
- `14060b2` `docs(review): add security audit workflow and handoff packet`
- `f0f079f` `fix(audit): reduce noise in history findings`
- `680fb2a` `fix(parity): retain reviewed claudecode hardening patch`
- `b142288` `feat(audit): add repository privacy scanner and scrub fixtures`

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
- extractor quality still needs broader contradiction handling beyond command replacement
- `cam memory` is still shallower than Claude Code’s `/memory`, especially around edit/toggle ergonomics
- heuristic continuity layering is now useful, but Codex-backed summaries still need better exact next-step quality
- `docs/next-phase-brief.md` captures the recommended Milestone 12 execution brief

## Recommended review sequence

1. Run `cam audit`
2. Run `pnpm test`
3. Read `README.md`
4. Read `docs/claude-reference.md`
5. Read `docs/session-continuity.md`
6. Read `docs/native-migration.md`
7. Read `docs/progress-log.md`
8. Read `docs/review-guide.md`
9. Inspect `src/lib/domain/rollout.ts`
10. Inspect `src/lib/domain/startup-memory.ts`
11. Inspect `src/lib/domain/session-continuity-store.ts`

## Suggested verification commands

```bash
pnpm lint
pnpm test
pnpm build
node dist/cli.js audit --json
node dist/cli.js doctor --json
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
