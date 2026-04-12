# Native Migration Strategy

[简体中文](./native-migration.md) | [English](./native-migration.en.md)

> This document now has a narrower job: it records how `codex-auto-memory` evaluates native Codex memory and hook signals without treating them as the only future direction. The repository is still Codex-first, but its broader product evolution now also includes non-native hook, skill, and MCP-aware integration paths.

## One-page conclusion

Three conclusions matter most right now:

- native Codex memory and hooks are still not ready to become the trusted primary path
- the current wrapper-driven implementation remains the strongest end-user path today
- native readiness is only one branch of the roadmap now, not the entire roadmap

## What changed in positioning

Historically, this document mainly justified why the repository stayed companion-first.

That remains true operationally, but the repository direction is now wider:

- keep the current Codex wrapper path stable
- continue evaluating native Codex capabilities conservatively
- separately prepare hook, skill, and MCP-friendly integration surfaces that preserve the same Markdown-first contract

This means “do not switch to native yet” is still correct, but it no longer implies “do not expand the integration surface in other ways.”

## Current reality

Official Codex public materials already confirm some useful building blocks:

- `AGENTS.md`
- project-level `.codex/config.toml`
- multi-agent workflows
- resume and fork flows
- MCP server configuration

Local runtime behavior and `cam doctor --json` also expose readiness signals:

- rollout JSONL
- `memories`
- `codex_hooks`
- the current app-server signal from `codex features list` (which may appear as `tui` or `tui_app_server`, depending on the local build)

That local feature truth should still be described conservatively:

- the official app-server docs describe a stable default API surface plus explicit experimental subfeatures
- the local `codex features list` output may still show `tui_app_server` as `removed`
- so app-server should remain a host/UI readiness signal here, not a stable primary foundation for this repository

But those signals are still not enough to retire the current wrapper path or claim a stable native memory contract.

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

Those can inform integration strategy, but they should not be promoted into public guarantees.

## Why the project does not switch to a native-first path today

| Question | Current answer |
| :-- | :-- |
| Are native memories publicly stable? | Not yet |
| Are native hooks rich enough to replace the current end-to-end flow? | Not yet |
| Can native behavior be validated reliably in CI? | Not yet |
| Can it preserve the current Markdown contract cleanly? | Not yet |

That is why the default operating rule remains:

- keep the current wrapper-first implementation as the primary path
- treat native memory and hooks as re-evaluation targets, not active foundations

## What must stay stable if native Codex surfaces improve later

Even if the plumbing changes, the user mental model should stay as stable as possible:

- Markdown-first memory
- `MEMORY.md` as the compact entrypoint
- topic files as the detail layer
- project and project-local scope boundaries
- strict separation between session continuity and durable memory
- inspect, audit, correction, and reviewer-visible memory lifecycle

If a future native path cannot preserve those behaviors, it should not replace the current contract.

## Required compatibility seam

To make later migration possible, the current implementation should keep these boundaries explicit:

- `SessionSource`
- `MemoryExtractor`
- `MemoryStore`
- `RuntimeInjector`

Those seams now support two kinds of future work:

1. native Codex re-evaluation
2. integration-aware expansion through hooks, skills, and MCP-friendly surfaces

## Current operating rule

- keep rollout JSONL as the primary session source
- keep wrapper-based startup injection
- keep Markdown as the primary memory surface
- keep session continuity as a separate companion layer
- keep the temporary continuity startup contract explicit about rendered provenance, section trimming, and the future compaction seam
- keep native migration conservative
- allow non-native integration expansion as long as it preserves the same Markdown contract

## Decision rule

Do not rewrite the roadmap simply because a native flag exists.

Native re-evaluation becomes reasonable only when all of the following are true:

- official public documentation is sufficiently explicit
- behavior is stable across releases
- the behavior can be validated in CI or deterministic local automation
- the native path preserves the current user contract
- Markdown-first auditability is not lost

Separately, non-native integration work such as hook, skill, or MCP-based access may proceed earlier if:

- it does not require native Codex guarantees
- it preserves the current durable-memory and continuity boundaries
- it remains auditable and reviewer-friendly

## Official references

- Codex CLI overview: <https://developers.openai.com/codex/cli>
- Codex feature maturity: <https://developers.openai.com/codex/feature-maturity>
- Codex changelog: <https://developers.openai.com/codex/changelog>
- Codex config basics: <https://developers.openai.com/codex/config-basic>
- Codex config reference: <https://developers.openai.com/codex/config-reference>

<!-- Last verified: 2026-03 against developers.openai.com/codex/* official pages. -->
