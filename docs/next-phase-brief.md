# Next Phase Brief

This brief prepares the next implementation window after `0.1.0-alpha.15`.

## Milestone 16 focus

The next phase should continue to stay compact and reviewer-oriented:

- consider one more lightweight continuity drill-down step only if it removes reviewer ambiguity without creating a dedicated history browser
- keep reviewer packet and release-checklist refresh discipline routine instead of treating it as a one-off cleanup
- keep public-facing wording precise where Codex Auto Memory intentionally stops short of Claude `/memory` parity
- keep monitoring native Codex memory and hooks, but remain companion-first until public docs and local readiness both improve

Do **not** reopen startup injection, session continuity storage layout, or broad command-surface expansion unless a concrete regression appears.

## Goals

1. Tighten reviewer continuity inspection only where it directly reduces audit friction.
2. Keep docs, changelog, handoff packets, and release checklist aligned as part of the normal milestone closeout.
3. Keep public claims about `cam memory` and session ergonomics precise relative to actual command surfaces.
4. Continue external research on official Codex memory and hook readiness without treating local observations as stable product contract.

## In scope

- Refresh reviewer-facing docs whenever implementation windows close.
- Add only small reviewer-oriented continuity drill-down if it clearly removes ambiguity.
- Keep release-facing wording precise whenever the CLI intentionally exposes inspect paths rather than richer in-command editing.
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
