# Codex Auto Memory

> A Markdown-first local memory runtime for Codex.

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` keeps durable memory in local Markdown and brings session continuity, reviewer surfaces, and MCP / hook / skill integration into one auditable workflow. It is for teams that want Codex to keep useful project context across sessions without moving the canonical source of truth into a database.

## Why use it

- Extract future-useful knowledge from Codex sessions and bring it back into later sessions.
- Keep `MEMORY.md` and topic files as the readable, editable source of truth instead of hiding state in a database.
- Preserve one reviewer-friendly memory contract across wrapper, CLI, MCP, skills, and hooks.

## Prerequisites

- `Node 20+`
- `pnpm` for the source-install path

## Install

### GitHub Release tarball

This is the default packaged install path today.

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

### Build from source

```bash
pnpm install
pnpm build
pnpm link --global
```

### npm

Only after the first public npm release:

```bash
npm install --global codex-auto-memory
```

The package name is not publicly available on npm yet, so the truthful packaged path today is still the GitHub Release tarball or a source install. The release workflow still keeps the npm publish route for the future, but `0.1.1` release readiness is defined around the GitHub Release tarball path.

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

The repository remains Codex-first, Markdown-first, and wrapper-first. Detailed capability boundaries, host differences, and migration notes now live in the documentation hub instead of the landing page.

## License

[Apache-2.0](./LICENSE)
