# Codex Auto Memory

> 面向 Codex 的 Markdown-first 本地记忆运行层。

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` 用本地 Markdown 保存 durable memory，并把 session continuity、reviewer surface、MCP / hooks / skills 接入放进同一条可审计工作流里。当前最稳的主路径仍然是 `cam run` wrapper，但仓库方向已经明确扩展到更低摩擦的集成入口。

## 为什么用它

- 把未来仍然有用的信息从 Codex 会话里提取出来，并在后续会话里带回来。
- 保持 `MEMORY.md` 与 topic files 作为可读、可改、可审计的主表面，而不是把真相藏进数据库。
- 在 wrapper、CLI、MCP、skills、hooks 之间维持同一套 reviewer-friendly memory contract。

## 你会得到什么

- 自动 durable memory sync 与 startup recall。
- 分层的 session continuity 与 durable memory。
- `cam memory`、`cam recall`、`cam session`、`cam audit` 这组检查入口。
- 面向 Codex 的 project-scoped MCP / integration 安装与诊断命令。

## 快速开始

1. 源码安装并构建：

```bash
pnpm install
pnpm build
pnpm link --global
```

2. 使用 GitHub Release tarball 安装：

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

3. npm 安装命令（首次公开 npm 发布后再使用）：

```bash
npm install --global codex-auto-memory
```

推送 `v<package.json.version>` tag 会触发自动发布流程：workflow 会先验证、打包同一份 release tarball，再把这一个 tarball 同时挂到 GitHub Release，并在仓库配置了 `NPM_TOKEN` 时用于 `npm publish --provenance --access public`。但 `codex-auto-memory` 这个包名当前还没有公开出现在 npm registry，所以现在默认可用路径仍然是源码安装或 GitHub Release tarball；上面的 npm 命令留给第一次公开 npm 发布之后使用。

4. 在目标项目中初始化：

```bash
cam init
```

5. 通过 wrapper 启动 Codex：

```bash
cam run
```

6. 查看或修正记忆：

```bash
cam memory
cam recall search "<query>"
cam session status
cam remember "<memory>"
cam forget "<memory>" --archive
```

## 文档导航

- [文档中心（简体中文）](./docs/README.md)
- [架构设计（简体中文）](./docs/architecture.md)
- [集成演进策略（简体中文）](./docs/integration-strategy.md)
- [宿主能力面（简体中文）](./docs/host-surfaces.md)
- [Session continuity（English）](./docs/session-continuity.md)
- [Release checklist（English）](./docs/release-checklist.md)

## 社区与仓库健康

- [SUPPORT.md](./SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [Issue Templates](./.github/ISSUE_TEMPLATE/config.yml)

## 当前状态

仓库目前仍以 Codex-first、Markdown-first、wrapper-first 为主，不把自己描述成通用知识库产品，也不把多宿主统一平台直接塞进当前主仓。更细的能力边界、宿主差异和迁移说明已经放进文档中心，不再堆在首页。

## 许可

[Apache-2.0](./LICENSE)
