# Next Phase Brief

This brief prepares the next implementation window after `0.1.0-alpha.12`.

## Milestone 13 focus

The next phase should stay small and reviewer-oriented:

- improve observability around Codex continuity fallback behavior
- keep `cam memory` easy to audit without reopening a much larger `/memory` UX expansion
- keep native Codex memory and hook work in the migration seam, not on the active implementation path

Do **not** reopen startup injection, continuity storage layout, or broader command-surface redesign unless a concrete regression appears.

## Goals

1. Make Codex continuity fallback reasons easier to inspect during review and smoke testing.
2. Tighten reviewer-facing `cam memory` output only where it directly helps startup and topic-file auditing.
3. Expand contradiction and mixed-signal rollout coverage only when it materially improves confidence in the current companion path.
4. Keep documentation aligned with the public Codex surface and the current native-readiness reality.

## In scope

- Add light observability or reviewer-facing diagnostics for:
  - why Codex continuity fell back to heuristic
  - whether the model output was malformed or merely low-signal
  - which startup/topic refs were actually active in a given review
- Add targeted fixtures when they protect the current Codex-first path better than broad heuristic expansion.
- Keep docs current when public Codex capabilities or local readiness checks materially change.

## Out of scope

- native Codex memory adoption
- broad `/memory` interaction redesign
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
- Codex continuity fallback is easier to reason about during review
- `cam memory` remains compact but more obviously reviewer-friendly
- companion-first behavior stays aligned with the current public Codex surface
