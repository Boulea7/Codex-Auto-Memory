# Codex Auto Memory

> Keep project context flowing across Codex sessions without hiding it behind a service or database.

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` helps Codex carry project context, preferences, and key decisions across sessions while keeping the memory files in local Markdown that your team can inspect and edit directly. It is built for teams that want continuity without giving up control of the source of truth.

## Why use it

- Extract future-useful knowledge from Codex sessions and bring it back into later sessions.
- Keep `MEMORY.md` and topic files as readable, editable source files instead of hiding state in a database.
- Review what will be surfaced through `cam memory`, `cam recall`, and `cam session` before it affects daily work.

## Prerequisites

- `Node 20+`
- `pnpm` for the source-install path

## Install

### Use Claude Code / OpenCode / Codex As Your Installer

If you prefer to let a coding agent do the setup, copy this prompt into Claude Code, OpenCode, or Codex:

```text
Install codex-auto-memory on this machine for me.

Use the npm install path from this README first:
npm install --global codex-auto-memory

After that:
1. Verify the install with `cam --version`
2. In the current repository, check whether codex-auto-memory is already initialized
3. If it is not initialized, run `cam init`
4. Show me the exact commands you ran and the results

If the npm package is unavailable, fall back to the GitHub Release tarball install path from this README instead of inventing another route.
Do not modify unrelated files.
```

### npm

This is the quickest install path:

```bash
npm install --global codex-auto-memory
```

### GitHub Release tarball

Use this when you want a versioned release artifact:

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

### Build from source

Use the source path when you want to work on the repository itself:

```bash
pnpm install
pnpm build
pnpm link --global
```

## First command

```bash
cam init
cam run
```

After install, the most common inspection commands are:

```bash
cam memory
cam recall search "<query>"
cam session status
cam remember "<memory>"
cam forget "<memory>" --archive
```

## Documentation

- [Documentation hub (English)](./docs/README.en.md)
- [Architecture (English)](./docs/architecture.en.md)
- [Session continuity (English)](./docs/session-continuity.md)
- [Release checklist (English)](./docs/release-checklist.md)

## Community and repository health

- [SUPPORT.md](./SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [Issue Chooser](https://github.com/Boulea7/Codex-Auto-Memory/issues/new/choose)

## Current status

The repository remains Codex-first and Markdown-first. Detailed integration boundaries, host differences, and migration notes live in the documentation hub.

## License

[Apache-2.0](./LICENSE)
