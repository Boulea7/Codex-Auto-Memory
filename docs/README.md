# 文档中心

[简体中文](./README.md) | [English](./README.en.md)

> 这里是 `codex-auto-memory` 的中文文档入口页。  
> 当前仓库已经从“只描述 companion CLI”转向 **Codex-first Hybrid** 的文档口径：现有实现仍以 wrapper + Markdown store 为主，但 hook / skill / MCP-aware integration 已经是正式演进方向。

## 阅读路径

### 新用户

1. [README](../README.md)
2. [Claude Code 参考契约](./claude-reference.md)
3. [架构设计](./architecture.md)
4. [集成演进策略](./integration-strategy.md)

### 维护者

1. [架构设计](./architecture.md)
2. [集成演进策略](./integration-strategy.md)
3. [宿主能力面](./host-surfaces.md)
4. [Session continuity 设计](./session-continuity.md)
5. [Native migration 策略](./native-migration.md)
6. [Release checklist](./release-checklist.md)

### Reviewer / 外部审查工具

1. [README](../README.md)
2. [架构设计](./architecture.md)
3. [集成演进策略](./integration-strategy.md)
4. [宿主能力面](./host-surfaces.md)
5. [Session continuity 设计](./session-continuity.md)

## 核心设计文档

| 文档 | 作用 | 语言 |
| :-- | :-- | :-- |
| [Claude Code 参考契约](./claude-reference.md) | 说明本项目主动对齐的 Claude Code memory 契约边界 | 中文 / [English](./claude-reference.en.md) |
| [架构设计](./architecture.md) | 解释当前主实现：startup injection、sync、continuity 与 Markdown store | 中文 / [English](./architecture.en.md) |
| [集成演进策略](./integration-strategy.md) | 解释当前仓库如何从 Codex companion 演进为 Codex-first Hybrid memory system | 中文 |
| [宿主能力面](./host-surfaces.md) | 固化当前仓库对 Codex 及其他宿主的能力判断与边界 | 中文 |
| [Native migration 策略](./native-migration.md) | 说明何时才值得重评 Codex native memory / hooks 主路径 | 中文 / [English](./native-migration.en.md) |

## 运行时与维护文档

| 文档 | 作用 | 当前语言 |
| :-- | :-- | :-- |
| [Session continuity 设计](./session-continuity.md) | 临时 continuity layer 的边界、路径和 reviewer surface | English |
| [Release checklist](./release-checklist.md) | 发布前的产品、运行时和文档核查清单 | English |
| [ClaudeCode patch audit](./claudecode-patch-audit.md) | 历史 patch 迁移与对照记录 | English |

## 这套文档要回答什么

当前文档集需要同时回答 3 个层面的问题：

1. **今天已经稳定可用的是什么**
   - 以 `cam` 命令和 wrapper 为主的 Codex durable memory / continuity 路线
2. **接下来要补的是什么**
   - issue 中的 4 项核心能力：自动提取、自动召回、更新/去重/覆盖/归档、降低手动维护成本
3. **方向上为什么要补 hook / skill / MCP**
   - 因为当前仓库不再只服务显式 CLI 用户，而是也面向希望让代理自己自动使用记忆能力的用户
   - 当前最新的低摩擦接入面已经分层：`cam mcp install` 负责显式写入 project-scoped host config，并在安全前提下保留 `codex_auto_memory` entry 上的非 canonical 自定义字段；`cam mcp print-config` / `cam mcp doctor` 继续负责只打印 / 只检查，`cam mcp apply-guidance --host codex` 负责以 additive、fail-closed 的方式管理仓库级 `AGENTS.md` guidance block
   - `cam integrations install --host codex` 负责编排 MCP wiring、hook bridge bundle 与 skill assets；`cam integrations apply --host codex` 在此基础上额外编排 managed `AGENTS.md` guidance，并在写入前先做 AGENTS safety preflight；`cam integrations doctor --host codex` 则只读汇总推荐路由、推荐 preset、`workflowContract`、`applyReadiness`、subchecks 与 next steps；`cam mcp doctor` 也会把 alternate global wiring 与推荐的 project-scoped 路径分开表达
   - `cam skills install` 的公开 skill surface 现在固定为 `runtime|official-user|official-project`；其中 runtime 仍是默认 target，官方 `.agents/skills` 路径保持显式 opt-in
   - `generic` host 仍然保持 manual-only：不支持 `cam mcp install --host generic`，但继续支持 `cam mcp print-config --host generic`
   - `cam recall search` 现在默认补上了 active-first、archived-fallback 的只读 retrieval 搜索面，并对齐 `state=auto`、`limit=8`

## 语言策略

- 默认公开首页使用中文 `README.md`
- 英文访客可从 [README.en.md](../README.en.md) 或 [docs/README.en.md](./README.en.md) 进入英文入口
- 中文核心设计文档优先表达当前最新主线
- 英文文档与多语言 README 应同步核心定位，不得继续停留在旧的 companion-only 叙事

## 文档设计原则

- 首页优先服务新访客，而不是 reviewer 内部手册
- 必须区分 **当前实现**、**当前桥接资产**、**正式演进方向**
- `Markdown-first` 是文档中的最高层不变量
- `Codex-first` 是当前仓库的宿主边界，不把主仓直接写成多宿主统一平台
- claim-sensitive 内容必须与官方公开资料兼容
- 关键 `--help` 文案也属于 release-facing public contract，需要与 README、架构文档和 smoke 测试一起保持同步
