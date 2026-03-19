# Native Migration Strategy

[简体中文](./native-migration.md) | [English](./native-migration.en.md)

> This document records the compatibility seam and re-evaluation criteria that `codex-auto-memory` keeps while remaining companion-first. It does not imply a planned primary-path change.

## One-page conclusion

Three conclusions matter most right now:

- native Codex memory and hooks are not ready to be the trusted primary path
- companion mode is not a temporary hack; it is the current mainline implementation
- re-evaluation is only justified when public docs, local stability, and CI-verifiable behavior improve together

## Current reality

Official Codex public materials already confirm some useful building blocks:

- `AGENTS.md`
- project-level `.codex/config.toml`
- multi-agent workflows
- resume and fork flows

Local runtime behavior and `cam doctor --json` also expose readiness signals:

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

### Local observation is only a readiness signal

Source inspection or local runtime behavior may reveal:

- directory layouts
- feature flags
- config shapes

Those can guide integration re-evaluation, but they should not be presented as stable public guarantees.

## Why the project does not switch to native today

| Question | Current answer |
| :-- | :-- |
| Are native memories publicly stable? | Not yet |
| Are the local native-hook signals rich enough for the Claude-style lifecycle? | Not yet |
| Can native behavior be validated reliably in CI? | Not yet |
| Can it preserve the current Markdown contract? | Not yet |

That is why the default conclusion remains:

- companion-first
- keep only a compatibility seam while companion-first remains the default path

## What must stay stable if official surfaces change

Even if the plumbing changes later, the user mental model should stay as stable as possible:

- Markdown-first memory
- `MEMORY.md` as the compact entrypoint
- topic files as the detail layer
- project and project-local scope boundaries
- a strict separation between session continuity and durable memory
- inspect, audit, and explicit correction as part of the workflow

## Required compatibility seam

To make later migration possible, the current implementation should keep these boundaries explicit:

- `SessionSource`
- `MemoryExtractor`
- `MemoryStore`
- `RuntimeInjector`

As long as those seams remain real, the repository can re-evaluate integration choices without rewriting the product model.

## Current operating rule

- keep rollout JSONL as the primary session source
- keep wrapper-based startup injection
- keep Markdown as the primary memory surface
- keep session continuity as a separate companion layer
- keep only an explicit compatibility seam for future native surfaces, without implying a switch phase

## Decision rule

Do not rewrite the roadmap simply because a native flag exists.
Re-evaluation becomes reasonable only when all of the following are true:

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

<!-- Last verified: 2026-03 against developers.openai.com/codex/* official pages. -->
