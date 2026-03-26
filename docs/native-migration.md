# Native Migration 策略

[简体中文](./native-migration.md) | [English](./native-migration.en.md)

> 本文现在只回答一个问题：**什么时候才值得把 Codex native memory / hooks 从 readiness signal 提升为主路径？**  
> 它不再承担当前仓库的整体集成方向说明。整体方向请看 [集成演进策略](./integration-strategy.md)。

## 一页结论

当前最重要的判断只有三条：

- native Codex memory / hooks 还不能作为 trusted primary path
- 当前仓库的主实现仍然是 companion-first
- 但这不等于 hook / skill / MCP 方向被排除；它们可以在保持 Markdown-first 的前提下进入主线

## 当前现实

Codex 的官方公开资料已经能确认一些对本项目有价值的基础能力：

- `AGENTS.md`
- project-level `.codex/config.toml`
- multi-agent workflows
- sessions / resume / fork
- MCP server configuration
- skills / rules 等宿主能力面

本地运行时与 `cam doctor --json` 还能看到一些 readiness signal：

- rollout JSONL
- `memories`
- `codex_hooks`

但这些还不足以支撑“现在就把 current companion path 废掉”。

## 本文不再回答什么

以下内容不再由本文负责：

- 当前仓库如何演进成 `Codex-first Hybrid`
- 为什么 hook / skill / MCP 已经进入正式方向
- 当前仓库如何同时服务显式 CLI 用户与更自动化的代理用户

这些由 [集成演进策略](./integration-strategy.md) 统一解释。

## 为什么当前不能直接切到 native

| 问题 | 当前回答 |
| :-- | :-- |
| native memories 已稳定公开吗 | 还没有 |
| 本地 native hooks signal 已足够支撑 Claude-style lifecycle 吗 | 还没有 |
| 能在 CI 中可靠验证 native behavior 吗 | 还不够 |
| 能保证与当前 Markdown contract 等价吗 | 还不能 |
| 能替代当前 wrapper + rollout + audit 语义吗 | 还不能 |

因此当前默认结论仍然是：

- current implementation remains companion-first
- native path stays behind a strict re-evaluation gate

## 即使官方 surface 变化，也必须保持稳定的东西

无论未来底层是否切到 native，用户心智模型尽量不要变：

- Markdown-first memory
- `MEMORY.md` 作为紧凑入口
- topic files 作为细节层
- project / project-local scope 边界
- session continuity 与 durable memory 分离
- inspect / audit / explicit correction 的基本使用方式
- sidecar index 不能取代 canonical Markdown store

## 当前必须保留的 compatibility seam

为了保证未来可以重评 native path，当前实现必须继续显式保留：

- `SessionSource`
- `MemoryExtractor`
- `MemoryStore`
- `RuntimeInjector`

只要这些边界仍然真实存在，未来若需要重评接入方式，就可以替换 integration layer，而不是推翻产品模型。

## 当前运行规则

在 native path 未通过重评前，当前仓库继续遵循：

- 继续使用 rollout JSONL
- 继续使用 wrapper startup injection
- 继续把 Markdown 作为主存储表面
- 继续把 session continuity 当作独立 companion layer
- 允许 hook / skill / MCP 以并行入口进入主线
- 不允许任何新入口绕开 canonical Markdown contract

## 什么时候值得重评 native path

只有当以下条件同时成立时，才值得重新评估 integration choice：

- 官方公开文档足够明确
- 多个版本之间行为稳定
- 可以通过 CI 或可重复本地自动化验证
- 能保持当前核心用户契约
- 不会把 Markdown-first 和 companion auditability 直接丢掉
- 能与现有 `cam memory` / `cam session` reviewer surfaces 等价或更好

## 决策规则

不要因为“看到了某个 native flag”就重写路线图。

重评 native path 也不意味着：

- 当前仓库要改成 DB-first
- 当前仓库要放弃 CLI / wrapper 主入口
- 当前仓库要停止推进 hook / skill / MCP-aware integration

native migration 与 integration expansion 是两条不同问题，必须分开判断。

## 官方参考

- Codex CLI overview: <https://developers.openai.com/codex/cli>
- Codex feature maturity: <https://developers.openai.com/codex/feature-maturity>
- Codex changelog: <https://developers.openai.com/codex/changelog>
- Codex config basics: <https://developers.openai.com/codex/config-basic>
- Codex config reference: <https://developers.openai.com/codex/config-reference>

<!-- Last verified: 2026-03 against developers.openai.com/codex/* official pages. -->
