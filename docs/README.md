# 文档中心

[简体中文](./README.md) | [English](./README.en.md)

> 这里是 `codex-auto-memory` 的文档入口页。  
> 如果你是第一次进入仓库，建议先读默认 [README](../README.md)；如果你要深入设计边界、迁移姿态或 reviewer 视角，再从这里进入对应文档。

## 阅读路径

### 新用户

1. [README](../README.md)
2. [Claude Code 参考契约](./claude-reference.md)
3. [架构设计](./architecture.md)
4. [Native migration 策略](./native-migration.md)

### 维护者

1. [架构设计](./architecture.md)
2. [Session continuity 设计](./session-continuity.md)
3. [Release checklist](./release-checklist.md)
4. [ClaudeCode patch audit](./claudecode-patch-audit.md)

### Reviewer / 外部审查工具

1. [Session continuity 设计](./session-continuity.md)
2. [Release checklist](./release-checklist.md)
3. [ClaudeCode patch audit](./claudecode-patch-audit.md)

## 核心设计文档

| 文档 | 作用 | 语言 |
| :-- | :-- | :-- |
| [Claude Code 参考契约](./claude-reference.md) | 说明本项目主动对齐的 Claude Code memory 契约边界 | 中文 / [English](./claude-reference.en.md) |
| [架构设计](./architecture.md) | 解释 startup injection、sync、continuity 与存储布局 | 中文 / [English](./architecture.en.md) |
| [Native migration 策略](./native-migration.md) | 说明为什么当前仍然 companion-first，以及未来何时可以迁移 | 中文 / [English](./native-migration.en.md) |

## 运行时与维护文档

| 文档 | 作用 | 当前语言 |
| :-- | :-- | :-- |
| [Session continuity 设计](./session-continuity.md) | 临时 continuity layer 的边界、路径和 reviewer surface | English |
| [Release checklist](./release-checklist.md) | 发布前的产品、运行时和文档核查清单 | English |
| [ClaudeCode patch audit](./claudecode-patch-audit.md) | 历史 patch 迁移与对照记录 | English |

## 语言策略

- 默认公开首页使用中文 `README.md`
- 英文访客可从 [README.en.md](../README.en.md) 或 [docs/README.en.md](./README.en.md) 进入英文入口
- 3 篇核心设计文档提供中英双版本
- 维护类补充文档当前仍以英文为主，以减少内部维护漂移

## 文档设计原则

- 首页优先服务新访客，而不是 reviewer 内部手册
- 关键产品边界优先出现在 README 与核心设计文档中
- claim-sensitive 内容必须与官方公开资料兼容
- 维护类文档允许更强的信息密度，但不应替代公开首页
