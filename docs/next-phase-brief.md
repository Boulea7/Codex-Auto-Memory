# Next Phase Brief

This brief prepares the next implementation window after `0.1.0-alpha.10`.

## Milestone 11 focus

The next phase should improve:

- extractor quality on harder real-world rollout patterns
- `cam memory` parity with Claude Code's `/memory` interaction model

Do **not** reopen startup injection or session continuity storage design unless a new regression is found. The current topic-aware startup path plus Codex-first session continuity layer (delivered in alpha.9 / alpha.10) are the baseline for this phase.

## Goals

1. Make stale replacement and contradiction handling more reliable.
2. Expand rollout fixtures so extractor regressions are caught before release.
3. Make `cam memory` more obviously useful as the audit and control entrypoint for local memory.
4. Improve the quality of session continuity summaries, especially the split between shared project state and worktree-local state.

## In scope

- Add harder synthetic rollout fixtures covering:
  - explicit correction of an older memory
  - conflicting commands or tool outcomes in one session
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
  - what exactly should happen next
- Update docs and reviewer materials when behavior changes.

## Out of scope

- native Codex memory adoption
- cloud sync or account-level memory
- GUI / TUI work
- another startup injection redesign

## Suggested implementation order

1. Expand fixtures and failing tests first.
2. Tighten extractor stale-replacement logic and prompt guidance.
3. Improve `cam memory` output around loaded files and topic refs.
4. Improve continuity extraction quality and section assignment.
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
