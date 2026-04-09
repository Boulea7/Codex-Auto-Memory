# Codex Auto Memory Agent Notes

## 功能描述

`codex-auto-memory` 是一个面向 Codex 的 `Markdown-first` 本地记忆运行层。

当前产品边界：

- durable memory 与 session continuity 分层维护
- `cam memory` 提供 inspect / audit surface
- `cam session` 提供 temporary continuity surface
- canonical source of truth 仍然是 Markdown，而不是数据库
- 当前最稳入口仍然是 wrapper + CLI，同时继续向 hooks、skills、MCP-aware retrieval 演进

## 使用方法

常用开发命令：

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm test:docs-contract
pnpm test:dist-cli-smoke
pnpm test:tarball-install-smoke
```

常用产品命令：

```bash
cam run
cam sync
cam memory
cam memory reindex
cam recall search "<query>"
cam mcp serve
cam mcp install --host codex
cam mcp print-config --host codex
cam mcp apply-guidance --host codex
cam mcp doctor --host codex
cam integrations install --host codex
cam integrations apply --host codex
cam integrations doctor --host codex
cam session save
cam session refresh
cam session load
cam session status
```

## 参数说明

关键配置文件：

- `codex-auto-memory.json`
- `.codex-auto-memory.local.json`

关键配置字段：

- `autoMemoryEnabled`: 是否开启 durable memory sync
- `extractorMode`: `codex` 或 `heuristic`
- `defaultScope`: 默认 memory scope
- `maxStartupLines`: startup durable memory 行预算
- `sessionContinuityAutoLoad`: wrapper 是否自动注入 continuity
- `sessionContinuityAutoSave`: wrapper 是否自动保存 continuity
- `maxSessionContinuityLines`: continuity startup 行预算
- `codexBinary`: 调用的 Codex 可执行文件

集成相关公开参数：

- `cam skills install --surface runtime|official-user|official-project`
- `cam integrations install/apply --skill-surface runtime|official-user|official-project`
- `cam ... --cwd <path>` 用于跨目录锚定目标项目

## 返回值说明

关键 JSON reviewer / integration contract：

- `cam memory --json`: 返回 startup files、topic refs、recent sync audit、`topicDiagnostics`、`layoutDiagnostics` 等 inspect 信息
- `cam memory reindex --json`: 返回 rebuilt sidecar 摘要与对应 `indexPath` / `generatedAt`
- `cam recall search --json`: 返回 compact refs、`retrievalMode`、`stateResolution`、`executionSummary`、`diagnostics.checkedPaths`
- `cam recall timeline --json`: 返回 lifecycle history、`warnings`、`lineageSummary`
- `cam recall details --json`: 返回 detail、`latestState`、`latestAudit`、`warnings`
- `cam mcp print-config --json`: 对 Codex 暴露 project-scoped MCP snippet、`workflowContract`、推荐 `AGENTS.md` guidance
- `cam mcp doctor --json`: 暴露 retrieval MCP wiring、fallback assets、`codexStack`、`retrievalSidecar`
- `cam integrations install/apply --json`: 暴露 staged subactions、rollback payload、`postInstallReadinessCommand` / `postApplyReadinessCommand`
- `cam integrations doctor --json`: 暴露 `recommendedRoute`、`currentlyOperationalRoute`、`workflowContract`、`applyReadiness`

## 项目规划

当前优先事项：

1. 继续保持 issue5 stack 的 reviewer contract、help surface、release-facing smoke 一致
2. 保持 `Markdown-first` canonical store 与 sidecar retrieval plane 的边界稳定
3. 保持 `cam integrations install` 与 `cam integrations apply` 的 AGENTS mutation boundary 清晰
4. 继续扩大 deterministic release gate：`lint`、`test`、`docs-contract`、`dist-cli-smoke`、`tarball-install-smoke`

下一阶段建议：

1. 继续做小步 stack closure，而不是重新摊大 remediation
2. 优先把 help / docs / smoke contract 固定成同一套公开语义
3. 在不扩张宿主边界的前提下，继续维持 Codex-first、manual-only 非 Codex host 的产品表述

## 变更记录

- 2026-04-10: 新增根级 `AGENTS.md`，补齐仓库级功能说明、命令面、关键 JSON 契约与项目规划。
- 2026-04-10: 明确 `cam integrations install --help` 与四语 README 命令表的公开边界：install 编排 stack，但不更新 `AGENTS.md`。
