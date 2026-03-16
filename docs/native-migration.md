# Native Migration Strategy

`codex-auto-memory` is built to work today without depending on unfinished Codex memory APIs, while still preparing for a future native transition.

## Current reality

Codex already exposes useful foundations:

- persistent session artifacts in `~/.codex/sessions/`
- resume and fork flows
- public `AGENTS.md` layering rules
- public project-level `.codex/config.toml` overrides
- public multi-agent workflows and handoff-oriented transcript context improvements
- experimental `memories` and `codex_hooks` feature flags

### Codex native memory status (as of 2026-03-17)

Codex CLI ships with a native two-phase memory system (extraction + consolidation) implemented in Rust. The following details were observed from source and local runtime behavior. They are **not** backed by a stable official public API contract and may change without notice.

Observed layout at `~/.codex/memories/`:

- `MEMORY.md`: primary memory index
- `memory_summary.md`: consolidated summary
- `skills/`: skills extracted from sessions

Configuration is via the `[memories]` section in `config.toml`. The feature is gated behind the `memory_tool` / `MemoryTool` feature flag.

Hook events are currently limited to 2 experimental events: `SessionStart` and `Stop`. Hook configuration lives in `.codex/hooks.json`. This is substantially more limited than Claude Code's 22+ lifecycle events across 4 hook types.

Sessions are stored as JSONL rollout files at `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<UUID>.jsonl`.

Local readiness remains unchanged as of 2026-03-17:

- `cam doctor --json` still reports `memories` as `under development` and disabled
- `cam doctor --json` still reports `codex_hooks` as `under development` and disabled
- this project should therefore continue to treat companion mode as the primary implementation path, not as a temporary fallback to a nearly-ready native path

**Important**: the above is based on source inspection and local observations, not official OpenAI documentation. Treat it as a useful migration signal, not a stable API guarantee. In particular, the directory layout, config keys, and hook semantics may change in future Codex releases without notice.

## Migration objective

When official Codex memory and hooks stabilize, this project should migrate from a companion wrapper to a thinner native adapter with minimal user disruption.

## Non-negotiable compatibility seams

The implementation should keep these interfaces explicit:

- `SessionSource`: where session evidence comes from
- `MemoryExtractor`: how rollout evidence becomes memory operations
- `MemoryStore`: how Markdown memory is persisted
- `RuntimeInjector`: how startup memory reaches Codex

These seams allow us to replace only the native integration layer later.

Current code alignment:

- rollout-backed session sourcing is now isolated behind a named companion session source
- wrapper-based startup injection is now isolated behind a named runtime injector
- startup injection now compiles quoted `MEMORY.md` indexes plus structured topic-file references for on-demand reads
- optional session continuity injection now rides the same wrapper path but remains a distinct temporary layer
- extractor implementations expose explicit adapter identities
- `cam doctor` now reports native-readiness against these seams

## Planned migration phases

### Phase 1: Companion-first

- Use rollout JSONL as the session source
- Use wrapper commands to inject compact quoted startup memory plus topic-file references
- Use explicit command surfaces and optional wrapper automation for temporary session continuity
- Use local Markdown as the stable store

### Phase 2: Hybrid

- Detect stable Codex hook support with `cam doctor`
- Allow optional native event hookups while keeping wrapper fallback
- Continue using the same Markdown store and scope rules
- **Note**: local observations suggest that Codex native memory support may be emerging, but before adopting it, verify content quality parity, format compatibility with our Markdown contract, and scope model equivalence (global vs. project vs. project-local) against official docs or reproducible runtime behavior.

### Phase 3: Native-first

- Adopt official native memory or hook events for session boundaries
- Keep Markdown parity where possible
- Provide a migration command for any metadata or path adjustments

## What should stay stable across migration

- directory layout semantics
- scope semantics
- the 200-line startup contract
- topic file model
- user-facing commands for inspect / remember / forget

The goal is to preserve user trust. Native migration should change implementation plumbing, not the mental model of how memory works.

## Risks to monitor

- official Codex memory may choose a different startup loading model
- hook event shapes may differ from current assumptions
- native memory may not use Markdown as its primary surface
- locally observed directory or config details may change without notice because they are not yet backed by a public contract

If native behavior diverges from Claude parity, this project should support both:

- a strict Claude-compatible mode
- a native-optimized mode

## Public reference points

- Codex CLI overview: <https://developers.openai.com/codex/cli>
- Codex configuration basics: <https://developers.openai.com/codex/config>
- Codex `AGENTS.md` guide: <https://developers.openai.com/codex/guides/agents-md>
- Codex multi-agent guide: <https://developers.openai.com/codex/multi-agent>
- Codex changelog: <https://developers.openai.com/codex/changelog>

## Decision rule

Do not migrate purely because a native flag exists. Migrate when native Codex support is:

- publicly documented
- stable across releases
- testable in CI or deterministic local automation
- capable of preserving the core user contract this project promises
- verified for content quality parity: extraction quality, scope isolation, and the 200-line startup contract must all hold under the native system
- verified for format compatibility: if native memory does not use Markdown or does not support user-editable topic files, a strict Claude-compatible mode must remain available
