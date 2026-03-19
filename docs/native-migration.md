# Native Migration 策略

[简体中文](./native-migration.md) | [English](./native-migration.en.md)

> 本文记录的是 `codex-auto-memory` 在 companion-first 前提下保留的 compatibility seam 与重评条件，不预设主路径变更。

## 一页结论

当前最重要的判断只有三条：

- native Codex memory / hooks 还不能作为 trusted primary path
- companion mode 不是临时凑合方案，而是当前主线实现
- 只有在“公开文档 + 本地稳定性 + CI 可验证性”同时改善时，才值得重评 integration choice

## 当前现实

Codex 的官方公开资料已经能确认一些对本项目有价值的基础能力：

- `AGENTS.md`
- project-level `.codex/config.toml`
- multi-agent workflows
- resume / fork

本地运行时与 `cam doctor --json` 还能看到一些 readiness signal：

- rollout JSONL
- `memories`
- `codex_hooks`

但这些还不足以支撑“现在就把 companion path 废掉”。

## 公开事实与本地观察要分开写

### 公开可引用的事实

从官方公开资料可以安全说的是：

- Codex CLI 已公开发布
- feature maturity 页面把部分能力放在 experimental / under-development 语境里
- 当前公开面没有给出完整、稳定、等价于 Claude Code 的 memory 产品契约

### 本地观察只能作为 readiness signal

本地 source inspection 或 runtime observation 可能会显示：

- 某些目录布局
- 某些 feature flags
- 某些配置项

这些信息可以帮助我们判断是否值得重评接入方式，但不能在公开文档里写成稳定 API 保证。

## 为什么当前不能直接切到 native

| 问题 | 当前回答 |
| :-- | :-- |
| native memories 已稳定公开吗 | 还没有 |
| 本地 native hooks signal 已足够支撑 Claude-style lifecycle 吗 | 还没有 |
| 能在 CI 中可靠验证 native behavior 吗 | 还不够 |
| 能保证与当前 Markdown contract 等价吗 | 还不能 |

因此当前默认结论仍然是：

- companion-first
- 只保留 compatibility seam，主路径仍然默认 companion-first

## 即使官方 surface 变化，也必须保持稳定的东西

无论未来底层是否切到 native，用户心智模型尽量不要变：

- Markdown-first memory
- `MEMORY.md` 作为紧凑入口
- topic files 作为细节层
- project / project-local scope 边界
- session continuity 与 durable memory 分离
- inspect / audit / explicit correction 的基本使用方式

## 当前必须保留的 compatibility seam

为了保证未来可以迁移，当前实现必须继续显式保留：

- `SessionSource`
- `MemoryExtractor`
- `MemoryStore`
- `RuntimeInjector`

只要这些边界仍然真实存在，未来若需要重评接入方式，就可以替换 integration layer，而不是推翻产品模型。

## 当前运行规则

- 继续使用 rollout JSONL
- 继续使用 wrapper startup injection
- 继续把 Markdown 作为主存储表面
- 继续把 session continuity 当作独立 companion layer
- 对 future native surfaces 只保留显式 compatibility seam，不预设切换阶段

## 决策规则

不要因为“看到了某个 native flag”就重写路线图。
只有当以下条件同时成立时，才值得重新评估 integration choice：

- 官方公开文档足够明确
- 多个版本之间行为稳定
- 可以通过 CI 或可重复本地自动化验证
- 能保持当前核心用户契约
- 不会把 Markdown-first 和 companion auditability 直接丢掉

## 官方参考

- Codex CLI overview: <https://developers.openai.com/codex/cli>
- Codex feature maturity: <https://developers.openai.com/codex/feature-maturity>
- Codex changelog: <https://developers.openai.com/codex/changelog>
- Codex config basics: <https://developers.openai.com/codex/config-basic>
- Codex config reference: <https://developers.openai.com/codex/config-reference>

<!-- Last verified: 2026-03 against developers.openai.com/codex/* official pages. -->
