# ClaudeCode Patch Audit

This document records the audit of the uncommitted ClaudeCode patch batch that landed after milestone `ec77073`.

## Audit scope

The patch batch was reviewed as four logical groups:

1. core bug fixes
2. extractor quality fixes
3. Claude parity adjustments
4. documentation updates

The goal of this audit is to separate:

- changes that are clearly correct and should stay
- changes that are good but have tradeoffs
- documentation claims that were stronger than the official evidence supports

## Outcome summary

### Accepted

- per-line `JSON.parse()` protection in rollout parsing
- support for nested `session_meta` payloads
- schema path resolution via `import.meta.url`
- making generated hook scripts executable
- shipping `schemas/` with the package
- reducing safety-filter false positives on git SHAs
- requiring explicit tool output before treating commands as reusable

### Accepted with caveat

- `MEMORY.md` is now index-only and no longer contains a highlights dump
- startup memory now injects index content rather than entry summaries

These changes are closer to the Claude mental model, but they also make the current implementation less informative until topic-on-demand loading is added.

### Corrected after audit

- docs no longer state that Claude exposes no forget contract at all; instead they say manual edit/delete is what the official docs clearly describe
- docs no longer claim blanket subagent memory isolation as a fully verified official rule
- docs no longer present a specific Codex native memory directory, config contract, or hook pipeline as officially documented facts

## Reviewer guidance

If you are reviewing this patch batch, focus on:

- whether the new rollout parser is resilient without becoming too permissive
- whether index-only startup memory is acceptable as a temporary parity tradeoff
- whether the repository now clearly distinguishes official facts from local observations

## Next follow-up

The most important follow-up after this audit is implementing topic-on-demand loading or a similarly compact-but-useful startup enrichment path, without breaking the concise `MEMORY.md` contract.
