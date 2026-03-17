# Next Phase Brief

This brief prepares the next implementation window after `0.1.0-alpha.18`.

## Milestone 19 focus

The next phase should continue to stay compact and reviewer-oriented:

- keep the durable sync audit contract stable and compact; only adjust it again if a concrete reviewer ambiguity remains
- keep manual `remember` / `forget` history separate from durable sync audit unless a clearly safer reviewer contract emerges
- keep the latest continuity drill-down stable and compact; only adjust it again if a concrete reviewer ambiguity remains
- keep bilingual public docs synchronized as a release discipline rather than a one-off cleanup
- keep reviewer packet and release-checklist refresh discipline routine in the same loop
- keep monitoring native Codex memory and hooks, but remain companion-first until public docs and local readiness both improve

Do **not** reopen startup injection, session continuity storage layout, or broad command-surface expansion unless a concrete regression appears.

## Goals

1. Preserve the durable sync audit contract without turning `cam memory` into a history browser or manual memory journal.
2. Preserve the latest-generation continuity drill-down without letting it expand into a browser.
3. Keep docs, changelog, handoff packets, and release checklist aligned as part of the normal milestone closeout.
4. Keep Chinese and English public docs semantically aligned without forcing full-repo double maintenance.
5. Continue external research on official Codex memory and hook readiness without treating local observations as stable product contract.

## In scope

- Refresh reviewer-facing docs whenever implementation windows close.
- Fix only concrete ambiguity or drift in the durable sync reviewer surface.
- Fix only concrete ambiguity or drift in the latest continuity reviewer surface.
- Keep bilingual public-doc wording precise whenever the CLI intentionally exposes inspect paths rather than richer in-command editing.
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
pnpm exec tsx src/cli.ts session status --json
pnpm exec tsx src/cli.ts memory --json
```

Expected review outcome:

- no new medium/high audit findings
- reviewer docs stay aligned with actual CLI behavior
- continuity and memory review surfaces remain compact but easier to trust
- companion-first behavior stays aligned with the current public Codex surface
