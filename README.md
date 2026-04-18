# Codex Auto Memory

> 面向 Codex 的 Markdown-first 本地记忆运行层。

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` 用本地 Markdown 保存 durable memory，把 session continuity、reviewer surface、MCP / hooks / skills 接到同一条可审计工作流里。它适合想让 Codex 在跨会话协作里保留项目上下文、偏好和决策线索，但又不想把真相藏进数据库的团队。

## 为什么用它

- 把未来仍然有用的信息从 Codex 会话里提取出来，并在后续会话里带回来。
- 保持 `MEMORY.md` 与 topic files 作为可读、可改、可审计的主表面，而不是把真相藏进数据库。
- 在 wrapper、CLI、MCP、skills、hooks 之间维持同一套 reviewer-friendly memory contract。

## 安装前提

- `Node 20+`
- 源码安装路径需要 `pnpm`

## 安装

### GitHub Release tarball

这是当前默认的打包安装路径。

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

### 源码安装并构建

```bash
pnpm install
pnpm build
pnpm link --global
```

### npm

首次公开 npm 发布之后再使用：

```bash
npm install --global codex-auto-memory
```

当前 `codex-auto-memory` 这个包名当前还没有公开出现在 npm registry，所以现在真实可用的安装路径仍然是 GitHub Release tarball 或源码安装。release workflow 会继续保留 npm publish 路径，但这轮 `0.1.1` 的公开安装标准仍以 GitHub Release tarball 为准。

## 第一个命令

```bash
cam init
cam run
```

安装完成后，最常用的检查命令是：

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
- [Session continuity（English）](./docs/session-continuity.md)
- [Release checklist（English）](./docs/release-checklist.md)

## 社区与仓库健康

- [SUPPORT.md](./SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [Issue Chooser](https://github.com/Boulea7/Codex-Auto-Memory/issues/new/choose)

## 当前状态

仓库目前仍以 Codex-first、Markdown-first、wrapper-first 为主。更细的能力边界、宿主差异、集成策略和迁移说明已经收敛到文档中心，不再堆在首页。

## 许可

[Apache-2.0](./LICENSE)
