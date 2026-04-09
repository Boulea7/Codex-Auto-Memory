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
  - `cam integrations install --host codex` 负责编排 MCP wiring、hook bridge bundle 与 skill assets；现在 staged failure 也会在 `--json` 下返回结构化 rollback payload；`cam integrations apply --host codex` 在此基础上额外编排 managed `AGENTS.md` guidance，并在写入前先做 AGENTS safety preflight；`cam integrations doctor --host codex` 则只读汇总推荐路由、推荐 preset、`workflowContract`、`applyReadiness`、`experimentalHooks`、`layoutDiagnostics`、subchecks 与 next steps；`cam mcp doctor` 也会把 alternate global wiring 与推荐的 project-scoped 路径分开表达，并把 hook helper 的 installed / operational 区分开
  - `cam skills install` 的公开 skill surface 现在固定为 `runtime|official-user|official-project`；其中 runtime 仍是默认 target，官方 `.agents/skills` 路径保持显式 opt-in
  - 非 Codex 宿主 wiring 仍属于边界化接线能力：默认产品路径只前台强调 `cam mcp install --host codex` / `cam mcp print-config --host codex`，其他 host 细节统一收口到 `docs/host-surfaces.md`，其中保留 `manual-only` 分支
- `cam recall search` 现在默认补上了 active-first、archived-fallback 的只读 retrieval 搜索面，并对齐 `state=auto`、`limit=8`；同时 `cam recall search --json` / `search_memories` 还会显式返回 `retrievalMode`、`retrievalFallbackReason`、`stateResolution`、`executionSummary`、`searchOrder`、`totalMatchedCount`、`returnedCount`、`globalLimitApplied`、`truncatedCount`、`resultWindow`、`globalRank` 与 `diagnostics.checkedPaths[].returnedCount` / `droppedCount`
- `cam remember --json` / `cam forget --json` 现在也会返回 manual mutation reviewer payload，把手工 correction/archive/delete 接进同一套 reviewer contract；最新 payload 会暴露 `mutationKind`、`matchedCount`、`appliedCount`、`noopCount`、`summary`、`reviewerSummary`、`followUp`、`nextRecommendedActions`、`entries[]`、`uniqueAuditCount`、`auditCountsDeduplicated`、`warningsByEntryRef`，并在至少命中一个 ref 时再补顶层 `latestAppliedLifecycle`、`latestLifecycleAttempt`、`latestLifecycleAction`、`latestState`、`latestSessionId`、`latestRolloutPath`、`latestAudit`、`timelineWarningCount`、`warnings` 与 `entry`；delete 分支继续区分 timeline-only 与 details-usable review routes，而空的 `forget --json` 结果现在会保持空的 `nextRecommendedActions`
- durable sync 现在会对 subagent rollout fail-closed：子线程 evidence 仍可供 continuity / reviewer 分析，但 `cam sync` 会留下 reviewer-visible 的 `subagent-rollout` skip，而不会把 child-session 噪音写进 canonical durable memory
- session continuity 持久化现在也会对 subagent rollout fail-closed：matching recovery marker、matching latest audit entry 与显式 `--rollout` 若指向 child-session rollout，会直接失败，而不是污染 shared/local continuity
- session continuity shared/local 双写现在以原子方式提交；若 summary 写入阶段失败，会留下 `summary-write` recovery marker 供 reviewer 处理
- `cam integrations apply --json` 现在也会显式暴露 `postApplyReadinessCommand`，把“apply 之后该回哪条 doctor 命令确认 route”提升成 machine-readable contract
- startup recall 仍保持 Markdown-first 和 line-budget discipline，但现在会额外注入少量 active-only content highlights；它不是 topic body dump，也不会让 archived memory 重新参与默认 startup recall
- `cam memory --json` 现在还会额外暴露 `highlightCount`、`omittedHighlightCount`、`highlightsByScope`、`startupSectionsRendered`、`startupOmissions`、`startupOmissionCounts` 与新的 `layoutDiagnostics`，让 reviewer 能直接看到 startup highlights 是否被 budget 裁掉、哪些 startup section 真正进入了 payload，以及 canonical Markdown layout 是否出现异常
- `cam memory` 现在正式支持 `--cwd <path>`，让 inspect/reindex/recent-review 这条命令面与 hooks helper、doctor next steps、workflowContract 的跨目录 guidance 真正一致
- 顶层 `cam doctor --json` 现在除了 `memories` / `codex_hooks` readiness signal 之外，也会补充 app-server signal、retrieval sidecar、unsafe topic 与 canonical layout 的只读诊断
- 共享 `workflowContract` 现在还会显式暴露 launcher 前提：`commandName=cam`、`requiresPathResolution=true`、`hookHelpersShellOnly=true`，避免 hooks / skills / doctor / print-config 对 PATH 与 shell 依赖产生新的 drift；另外 helper bundle、doctor next steps 与 retrieval sidecar repair command 现在都会在 `cam` 不可解析时优先给出 `node <installed>/dist/cli.js` 的 verified fallback
- `workflowContract.launcher` 现在还会明确区分 direct CLI / installed helpers 与 canonical MCP host snippet：前者可以收口到 resolved launcher fallback，后者仍保持 `cam mcp serve` 的 canonical 接线语义
- `workflowContract` 现在还会继续保留兼容顶层字段，同时额外拆出 `executionContract`、`modelGuidanceContract` 与 `hostWiringContract`，把执行路线、代理教学与宿主接线的 machine-readable contract 分开
- 当前官方 Codex skills discovery 文档以 `.agents/skills` 为准；本仓 runtime 仍兼容 `.codex/skills` / `CODEX_HOME`，但它更适合作为 runtime / historical compatibility surface，而不是新的官方 canonical path
- `cam recall search` 的多词查询现在会跨 `id/topic/summary/details` 聚合命中，不再要求所有 term 都落在同一字段；startup highlights 也会跨 scope 去重相同 summary，减少低信号重复项挤占 startup budget
- `cam integrations apply --host codex` 现在会在 AGENTS apply late-block 或 staged write failure 时回滚已写入的 project-scoped MCP wiring、hook bundle 与 skill assets，降低半成功状态

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
