# Next Phase Brief

This brief prepares the next implementation window after `0.1.0-alpha.11`.

## Milestone 12 focus

The next phase should improve:

- Codex-backed continuity summary quality
- `cam memory` parity with Claude Code's `/memory` interaction model

Do **not** reopen startup injection or session continuity storage design unless a new regression is found. The current topic-aware startup path plus split shared/local continuity model (delivered through alpha.9–alpha.11) are the baseline for this phase.

## Goals

1. Improve Codex-backed continuity summaries for exact next-step quality and cleaner project vs local separation.
2. Expand contradiction handling beyond command replacement.
3. Push `cam memory` closer to Claude `/memory` for review and editing workflows.
4. Expand rollout fixtures so regressions stay caught before release.

## In scope

- Add harder synthetic rollout fixtures covering:
  - architecture or workflow contradictions, not just command replacement
  - mixed durable-memory and continuity signals in one session
  - sensitive-looking noise adjacent to valid durable memory
  - repeated remember / forget flows across scopes
- Strengthen extractor behavior in:
  - `src/lib/extractor/heuristic-extractor.ts`
  - `src/lib/extractor/prompt.ts`
  - `src/lib/extractor/safety.ts`
- Improve `cam memory` so reviewers can more easily answer:
  - which files are active at startup
  - which topic files are available for on-demand reads
  - whether auto memory is enabled and where edits should happen
- Improve continuity extraction so `cam session load` better reflects:
  - what is truly confirmed working
  - what failed and why
  - what is still untried
  - what exactly should happen next, especially in Codex-backed mode
- Update docs and reviewer materials when behavior changes.

## Out of scope

- native Codex memory adoption
- cloud sync or account-level memory
- GUI / TUI work
- another startup injection redesign

## Suggested implementation order

1. Expand fixtures and failing tests first.
2. Improve Codex-backed continuity prompt/schema quality.
3. Tighten extractor stale-replacement logic beyond commands.
4. Improve `cam memory` output around editing and loaded-file visibility.
5. Sync `README.md`, `docs/progress-log.md`, `docs/reviewer-handoff.md`, and `CHANGELOG.md`.

## Acceptance checks

Run before closing the next phase:

```bash
pnpm lint
pnpm test
pnpm build
pnpm exec tsx src/cli.ts audit --json
pnpm exec tsx src/cli.ts doctor --json
```

Expected review outcome:

- no new medium/high audit findings
- broader extractor fixture coverage
- clearer `cam memory` reviewer workflow
- better continuity summaries with less overlap between shared and local state
- less heuristic fallback phrasing in `cam session load`
