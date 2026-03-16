# Next Phase Brief

This brief prepares the next implementation window after `0.1.0-alpha.13`.

## Milestone 14 focus

The next phase should continue to stay compact and reviewer-oriented:

- refresh reviewer packets and release-facing docs more systematically
- improve the highest-value memory review surfaces without reopening a larger `/memory` redesign
- keep monitoring native Codex memory and hooks, but remain companion-first until public docs and local readiness both improve

Do **not** reopen startup injection, session continuity storage layout, or broad command-surface expansion unless a concrete regression appears.

## Goals

1. Reduce reviewer drift between docs, changelog, handoff packets, and actual CLI output.
2. Tighten `cam memory` and `cam session` review surfaces only where they directly reduce audit friction.
3. Keep contradiction handling conservative unless new rollout fixtures justify a safe expansion.
4. Continue external research on official Codex memory and hook readiness without treating local observations as stable product contract.

## In scope

- Refresh reviewer-facing docs whenever implementation windows close.
- Add small reviewer-oriented CLI summaries if they clearly remove ambiguity.
- Add targeted fixtures that protect current behavior better than broad heuristic complexity.
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
