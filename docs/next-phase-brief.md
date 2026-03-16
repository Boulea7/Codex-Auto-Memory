# Next Phase Brief

This brief prepares the next implementation window after `0.1.0-alpha.14`.

## Milestone 15 focus

The next phase should continue to stay compact and reviewer-oriented:

- expand contradiction fixtures only where rollout evidence makes replacement behavior clearly safe
- consider one more lightweight continuity drill-down step only if it removes reviewer ambiguity without creating a dedicated history browser
- keep reviewer packet refresh discipline routine instead of treating it as a one-off cleanup
- keep monitoring native Codex memory and hooks, but remain companion-first until public docs and local readiness both improve

Do **not** reopen startup injection, session continuity storage layout, or broad command-surface expansion unless a concrete regression appears.

## Goals

1. Keep contradiction handling conservative while improving explicit correction coverage where fixtures justify it.
2. Tighten reviewer continuity inspection only where it directly reduces audit friction.
3. Keep docs, changelog, and handoff packets aligned as part of the normal milestone closeout.
4. Continue external research on official Codex memory and hook readiness without treating local observations as stable product contract.

## In scope

- Refresh reviewer-facing docs whenever implementation windows close.
- Add targeted fixtures that protect current behavior better than broad heuristic complexity.
- Add only small reviewer-oriented continuity drill-down if it clearly removes ambiguity.
- Re-check official Codex public docs and local `doctor` output before changing migration guidance.

## Out of scope

- native Codex memory adoption
- broad `/memory` UX redesign
- hook bridge feature work
- GUI / TUI work
- another startup injection redesign

## Acceptance checks

Run before closing the next phase:

```bash
pnpm lint
pnpm test
pnpm build
pnpm exec tsx src/cli.ts audit --json
pnpm exec tsx src/cli.ts doctor --json
pnpm exec tsx src/cli.ts session load --json
pnpm exec tsx src/cli.ts memory --json
```

Expected review outcome:

- no new medium/high audit findings
- reviewer docs stay aligned with actual CLI behavior
- continuity and memory review surfaces remain compact but easier to trust
- companion-first behavior stays aligned with the current public Codex surface
