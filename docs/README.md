# 文档中心

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

这里负责导航，不重复堆首页内容。README 负责第一跳理解，这里负责把你送到对应深度的文档。

## 从这里开始

### 初次了解项目

- [项目首页（简体中文）](../README.md)
- [架构设计（简体中文）](./architecture.md)
- [集成演进策略（简体中文）](./integration-strategy.md)
- [宿主能力面（简体中文）](./host-surfaces.md)

### 需要落地或维护

- [Session continuity（English）](./session-continuity.md)
- [Release checklist（English）](./release-checklist.md)
- [Claude memory / dream contract（简体中文）](./claude-memory-dream-r1.md)
- [Native migration（简体中文）](./native-migration.md)

### 需要英文入口

- [English landing page](../README.en.md)
- [English docs hub](./README.en.md)
- [Architecture in English](./architecture.en.md)
- [Native migration in English](./native-migration.en.md)

## 文档索引

| 文档 | 作用 | 语言可用性 |
| :-- | :-- | :-- |
| [architecture](./architecture.md) | 当前实现、运行路径与存储边界 | 中文 / [English](./architecture.en.md) |
| [integration-strategy](./integration-strategy.md) | 为什么仓库从 wrapper 主路径扩展到 integration-aware 方向 | 中文 |
| [host-surfaces](./host-surfaces.md) | Codex 与其他宿主的能力边界、默认路径与 manual-only 范围 | 中文 |
| [session-continuity](./session-continuity.md) | continuity layer 的设计与 reviewer surface | English |
| [claude-memory-dream-r1](./claude-memory-dream-r1.md) | dream reviewer lane 与相关 closeout contract | 中文 |
| [release-checklist](./release-checklist.md) | 发布前的验证与文档同步检查 | English |
| [native-migration](./native-migration.md) | 什么时候重评 native memory / hooks 主路径 | 中文 / [English](./native-migration.en.md) |

## 社区入口

- [SUPPORT.md](../SUPPORT.md)
- [SECURITY.md](../SECURITY.md)
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)
- [Issue template config](../.github/ISSUE_TEMPLATE/config.yml)

## 语言说明

- 首页提供四种语言入口。
- docs hub 现在也提供四种语言入口。
- 详细设计文档暂时不是四语全覆盖，所以每篇文档都在索引表里标明了当前可用语言。
- 如果你只想快速判断“先看哪篇”，先看上面的“从这里开始”。
