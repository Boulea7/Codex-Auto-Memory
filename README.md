# Codex Auto Memory

> 让 Codex 在后续会话里延续项目上下文，同时把记忆保留在你能直接查看和编辑的 Markdown 里。

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` 让 Codex 在跨会话协作里继续带着项目上下文、偏好和关键决策工作，同时保持 `MEMORY.md`、topic files 和相关检查入口都在本地。你不需要额外的数据库，也不用把“记忆”交给一个看不见的黑盒。

## 为什么用它

- 把未来仍然有用的信息从 Codex 会话里提取出来，并在后续会话里带回来。
- 保持 `MEMORY.md` 与 topic files 作为可读、可改、可审计的主表面。
- 通过 `cam memory`、`cam recall`、`cam session` 这组命令，在把记忆带回工作流之前先检查它。

## 安装前提

- `Node 20+`
- 源码安装路径需要 `pnpm`

## 安装

### npm

这是最省事的安装路径：

```bash
npm install --global codex-auto-memory
```

### GitHub Release tarball

如果你想安装指定版本的打包产物，使用 GitHub Release tarball：

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

### 源码安装并构建

如果你要改源码，或者想直接从仓库本地运行：

```bash
pnpm install
pnpm build
pnpm link --global
```

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

## 文档

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

项目目前仍然是 Codex-first、Markdown-first 的本地记忆工具。更细的集成边界、宿主差异和迁移说明都放在文档中心。

## 许可

[Apache-2.0](./LICENSE)
