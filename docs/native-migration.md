# Native Migration Strategy

`codex-auto-memory` is built to work today without depending on unfinished Codex memory APIs, while still preparing for a future native transition.

## Current reality

Codex already exposes useful foundations:

- persistent session artifacts in `~/.codex/sessions/`
- resume and fork flows
- `AGENTS.md`, rules, skills, and project config
- experimental `memories` and `codex_hooks` feature flags

### Codex native memory status (as of early 2026)

The official OpenAI Codex materials reviewed for this repository do **not** currently provide a public product contract equivalent to Claude Code's auto memory page. In particular, we did **not** find official documentation that clearly specifies:

- a stable native memory directory layout
- a documented startup-loading contract comparable to Claude's `MEMORY.md` behavior
- a documented scope model equivalent to `global / project / project-local`
- a public hook-driven native memory pipeline contract

What we *do* have today are local implementation signals and experimental feature flags, such as `memories`, `codex_hooks`, and rollout metadata like `memory_mode`. Those are useful migration hints, but they should be treated as **local observations or emerging internals**, not as stable public API guarantees.

This is an important distinction. Native Codex memory may exist in some form, but until OpenAI publishes a clear contract, we should not present directory layouts, config keys, or hook semantics as confirmed product behavior.

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
- extractor implementations expose explicit adapter identities
- `cam doctor` now reports native-readiness against these seams

## Planned migration phases

### Phase 1: Companion-first

- Use rollout JSONL as the session source
- Use wrapper commands to inject startup memory
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

## Decision rule

Do not migrate purely because a native flag exists. Migrate when native Codex support is:

- publicly documented
- stable across releases
- testable in CI or deterministic local automation
- capable of preserving the core user contract this project promises
- verified for content quality parity: extraction quality, scope isolation, and the 200-line startup contract must all hold under the native system
- verified for format compatibility: if native memory does not use Markdown or does not support user-editable topic files, a strict Claude-compatible mode must remain available
