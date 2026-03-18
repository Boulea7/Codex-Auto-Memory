# Native Migration Strategy

[简体中文](./native-migration.md) | [English](./native-migration.en.md)

> `codex-auto-memory` is not designed to stay wrapper-only forever. The point is to remain companion-first until official native memory and hook surfaces are stable enough to trust, while preserving a clean migration seam for later.

## One-page conclusion

Three conclusions matter most right now:

- native Codex memory and hooks are not ready to be the trusted primary path
- companion mode is not a temporary hack; it is the current mainline implementation
- migration should happen only when public docs, local stability, and CI-verifiable behavior all improve together

## Current reality

Official Codex public materials already confirm some useful building blocks:

- `AGENTS.md`
- project-level `.codex/config.toml`
- multi-agent workflows
- resume and fork flows

Local runtime behavior and `cam doctor --json` also expose migration-related signals:

- rollout JSONL
- `memories`
- `codex_hooks`

But those signals are still not enough to retire the companion path.

## Keep public facts separate from local observations

### Publicly supportable facts

From official public materials, it is safe to say:

- Codex CLI is publicly documented
- feature maturity docs still place some capabilities in experimental or under-development categories
- the current public surface does not yet define a full, stable memory contract equivalent to Claude Code

### Local observation is only a migration signal

Source inspection or local runtime behavior may reveal:

- directory layouts
- feature flags
- config shapes

Those can guide migration planning, but they should not be presented as stable public guarantees.

## Why the project does not switch to native today

| Question | Current answer |
| :-- | :-- |
| Are native memories publicly stable? | Not yet |
| Are the local native-hook signals rich enough for the Claude-style lifecycle? | Not yet |
| Can native behavior be validated reliably in CI? | Not yet |
| Can it preserve the current Markdown contract? | Not yet |

That is why the default conclusion remains:

- companion-first
- native migration only when ready

## What must stay stable across migration

Even if the plumbing changes later, the user mental model should stay as stable as possible:

- Markdown-first memory
- `MEMORY.md` as the compact entrypoint
- topic files as the detail layer
- project and project-local scope boundaries
- a strict separation between session continuity and durable memory
- inspect, audit, and explicit correction as part of the workflow

## Required compatibility seams

To make later migration possible, the current implementation should keep these boundaries explicit:

- `SessionSource`
- `MemoryExtractor`
- `MemoryStore`
- `RuntimeInjector`

As long as those seams remain real, the repository can replace the integration layer without rewriting the product model.

## Recommended migration phases

### Phase 1: Companion-first

- keep rollout JSONL as the primary session source
- keep wrapper-based startup injection
- keep Markdown as the primary memory surface
- keep session continuity as a separate companion layer

### Phase 2: Hybrid

- only consider optional native bridges when both `cam doctor` and public docs improve
- keep wrapper fallback
- preserve the Markdown contract and scope model

### Phase 3: Native-first

- move only when native behavior is public, stable, and testable
- if native behavior cannot preserve the Markdown-first and topic-file model, keep a strict compatibility mode

## Decision rule

Do not migrate simply because a native flag exists.  
Migration becomes reasonable only when all of the following are true:

- official public documentation is sufficiently explicit
- behavior is stable across releases
- the behavior can be validated in CI or deterministic local automation
- the native path preserves the current user contract
- Markdown-first auditability is not lost in the process

## Official references

- Codex CLI overview: <https://developers.openai.com/codex/cli>
- Codex feature maturity: <https://developers.openai.com/codex/feature-maturity>
- Codex changelog: <https://developers.openai.com/codex/changelog>
- Codex config basics: <https://developers.openai.com/codex/config-basic>
- Codex config reference: <https://developers.openai.com/codex/config-reference>
