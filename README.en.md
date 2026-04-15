# Codex Auto Memory

> A Markdown-first local memory runtime for Codex.

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` keeps durable memory in local Markdown and brings session continuity, reviewer surfaces, and MCP / hook / skill integration into one auditable workflow. The most mature path today is still the `cam run` wrapper, but the repository now explicitly supports lower-friction integration entry points as part of the product direction.

## Why use it

- Extract future-useful knowledge from Codex sessions and bring it back into later sessions.
- Keep `MEMORY.md` and topic files as the readable, editable source of truth instead of hiding state in a database.
- Preserve one reviewer-friendly memory contract across wrapper, CLI, MCP, skills, and hooks.

## What you get

- Automatic durable memory sync and startup recall.
- Layered session continuity and durable memory storage.
- Inspection surfaces through `cam memory`, `cam recall`, `cam session`, and `cam audit`.
- Project-scoped MCP and integration install / doctor commands for Codex.

## Quick start

1. Source install and build:

```bash
pnpm install
pnpm build
pnpm link --global
```

2. Install from a GitHub Release tarball:

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

3. npm install command (only after the first public npm release):

```bash
npm install --global codex-auto-memory
```

Pushing a `v<package.json.version>` tag now automatically verifies, packs, and publishes the same release tarball: the workflow creates a GitHub Release, attaches that archive, and publishes that exact `.tgz` with `npm publish --provenance --access public` when `NPM_TOKEN` is configured for the repository. The package name is not publicly available on npm yet, so the truthful packaged path today is still the GitHub Release tarball; keep the npm command above as the post-publish route once the first public npm release exists.

4. Initialize inside the target project:

```bash
cam init
```

5. Launch Codex through the wrapper:

```bash
cam run
```

6. Inspect or correct memory:

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
- [Integration strategy (Chinese)](./docs/integration-strategy.md)
- [Host surfaces (Chinese)](./docs/host-surfaces.md)
- [Session continuity (English)](./docs/session-continuity.md)
- [Release checklist (English)](./docs/release-checklist.md)

## Community and repository health

- [SUPPORT.md](./SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [Issue Templates](./.github/ISSUE_TEMPLATE/config.yml)

## Current status

The repository remains Codex-first, Markdown-first, and wrapper-first. It is not presented as a general knowledge-base product or a multi-host platform monorepo. Detailed capability boundaries, host differences, and migration notes now live in the documentation hub instead of the landing page.

## License

[Apache-2.0](./LICENSE)
