# Documentation Hub

[简体中文](./README.md) | [English](./README.en.md)

> This is the documentation entry point for `codex-auto-memory`.  
> If you are new to the repository, start with the main [README](../README.en.md). If you need design boundaries, migration posture, or reviewer guidance, use the routes below.

## Reading paths

### New users

1. [README](../README.en.md)
2. [Claude reference contract](./claude-reference.en.md)
3. [Architecture](./architecture.en.md)
4. [Native migration strategy](./native-migration.en.md)

### Maintainers

1. [Architecture](./architecture.en.md)
2. [Session continuity design](./session-continuity.md)
3. [Progress log](./progress-log.md)
4. [Next phase brief](./next-phase-brief.md)

### Reviewers and external tools

1. [Review guide](./review-guide.md)
2. [Reviewer handoff](./reviewer-handoff.md)
3. [Release checklist](./release-checklist.md)
4. [ClaudeCode patch audit](./claudecode-patch-audit.md)

## Core design docs

| Document | Purpose | Language |
| :-- | :-- | :-- |
| [Claude reference contract](./claude-reference.en.md) | defines which public Claude Code memory behaviors this project intentionally mirrors | English / [中文](./claude-reference.md) |
| [Architecture](./architecture.en.md) | explains startup injection, sync flow, continuity, and storage layout | English / [中文](./architecture.md) |
| [Native migration strategy](./native-migration.en.md) | explains why the project remains companion-first and what would justify migration later | English / [中文](./native-migration.md) |

## Runtime and maintainer docs

| Document | Purpose | Current language |
| :-- | :-- | :-- |
| [Session continuity design](./session-continuity.md) | continuity boundaries, paths, and reviewer surfaces | English |
| [Progress log](./progress-log.md) | milestone history, current state, and known gaps | English |
| [Review guide](./review-guide.md) | what reviewers should read first and which risks matter most | English |
| [Reviewer handoff](./reviewer-handoff.md) | shortest complete handoff packet for AI tools and external review | English |
| [Release checklist](./release-checklist.md) | release-time product, runtime, and docs checks | English |
| [Next phase brief](./next-phase-brief.md) | recommended next implementation window | English |

## Language policy

- the default public landing page is the Chinese `README.md`
- English readers can switch through [README.en.md](../README.en.md) or this page
- the three core design docs are maintained in both Chinese and English
- reviewer and maintainer docs currently stay English-first to avoid internal drift

## Documentation principles

- the public README should optimize for first-time understanding
- core product boundaries belong in the README and core design docs
- claim-sensitive wording must stay compatible with official public documentation
- dense maintainer docs are useful, but they should not replace the repository's public front page
