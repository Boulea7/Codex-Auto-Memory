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
cam dream build
cam dream inspect
cam dream candidates
cam dream review
cam dream adopt
cam dream proposal
cam dream promote-prep
cam dream promote
cam dream apply-prep
cam dream verify-apply
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
- `dreamSidecarEnabled`: 是否开启 dream sidecar reviewer surface
- `dreamSidecarAutoBuild`: 是否允许后续自动构建 dream sidecar
- `codexBinary`: 调用的 Codex 可执行文件

集成相关公开参数：

- `cam skills install --surface runtime|official-user|official-project`
- `cam integrations install/apply --skill-surface runtime|official-user|official-project`
- `cam ... --cwd <path>` 用于跨目录锚定目标项目

## 返回值说明

关键 JSON reviewer / integration contract：

- `cam memory --json`: 返回 startup files、topic refs、recent sync audit、`topicDiagnostics`、`layoutDiagnostics`、`instructionLayer`、`startupBudgetLedger`、`dreamSidecar` 等 inspect 信息
- `cam memory reindex --json`: 返回 rebuilt sidecar 摘要与对应 `indexPath` / `generatedAt`
- `cam recall search --json`: 返回 compact refs、`retrievalMode`、`stateResolution`、`executionSummary`、`diagnostics.checkedPaths`、`querySurfacing`
- `cam session status/load --json`: 额外暴露 additive `resumeContext`，包括 goal、instruction files、`suggestedDurableRefs`、`suggestedTeamEntries`，并保持 wrapper startup 叠层顺序为 continuity -> instruction files -> dream refs -> top durable refs -> team/shared refs
- `cam recall timeline --json`: 返回 lifecycle history、`warnings`、`lineageSummary`
- `cam recall details --json`: 返回 detail、`latestState`、`latestAudit`、`warnings`
- `cam dream build --json`: 返回 dream sidecar snapshot、`snapshotPaths`、`auditPath`、`recoveryPath`，其中可包含 read-only `teamMemory` reviewer hints
- `cam dream inspect --json`: 返回 shared / local dream sidecar 状态、`auditPath`、`recoveryPath`，以及 reviewer-facing queue / helper 元数据；inspect 保持只读，不隐式重建 sidecar 或 team index
- `cam dream candidates/review/adopt/proposal/promote-prep/promote/apply-prep/verify-apply`: 继续保持 sidecar reviewer lane；其中 subagent candidate 默认以 blocked 状态起步，需先显式 `adopt` 才能进入 primary review lane；`proposal` 只读查看 artifact，不改 reviewer 状态；`promote-prep` 与 `apply-prep` 都只做 reviewer / manual-apply 预演，不改 canonical memory 或 instruction files；durable-memory candidate 只能通过显式 `promote` + 现有 reviewer/audit 路径写入 canonical Markdown memory，而 instruction-like candidate 的 `proposal`、`promote`、`promote-prep`、`apply-prep` 都继续保持 `proposal-only`，只返回带有 `patchPreview`、`artifactPath`、`manualWorkflow`、`applyReadiness` 的 proposal artifact；`--target-file` 只适用于 `promote-prep` / `promote`；`promote` 之后进入 `manual-apply-pending` reviewer 状态，再由 `verify-apply` 显式收口，永不自动改 instruction files
- `cam mcp print-config --json`: 对 Codex 暴露 project-scoped MCP snippet、`workflowContract`、推荐 `AGENTS.md` guidance
- `cam mcp doctor --json`: 暴露 retrieval MCP wiring、fallback assets、`codexStack`、`retrievalSidecar`
- `cam integrations install/apply --json`: 暴露 staged subactions、rollback payload、`postInstallReadinessCommand` / `postApplyReadinessCommand`
- `cam integrations doctor --json`: 暴露 `recommendedRoute`、`currentlyOperationalRoute`、`workflowContract`、`applyReadiness`

## 项目规划

当前优先事项：

1. 继续保持 issue5 stack 的 reviewer contract、help surface、release-facing smoke 一致
2. 收紧 issue-tracker durable memory replacement key，避免不同 host 的 tracker URL 因相同 repo/path 或 ticket id 被误判为同一条 memory
3. 把 Claude Code / Gemini CLI 的官方公开宿主能力面，与本仓当前真实支持的 manual-only host 边界继续写清楚
4. 保持 `Markdown-first` canonical store 与 sidecar retrieval plane 的边界稳定
5. 把 `instruction memory` 与 `learned durable memory` 的 reviewer 分层继续收紧，但不让 instruction discovery 越界进 durable mutation
6. 把 `futureCompactionSeam` 继续演进成可审计、可关闭、fail-closed 的 `dream sidecar`，并保持 `dreamSidecarAutoBuild` 只吃 latest primary rollout
7. 保持 `cam integrations install` 与 `cam integrations apply` 的 AGENTS mutation boundary 清晰
8. 继续扩大 deterministic release gate：`lint`、`test`、`docs-contract`、`dist-cli-smoke`、`tarball-install-smoke`

下一阶段建议：

1. 继续做小步 stack closure，而不是重新摊大 remediation
2. 优先把 help / docs / smoke contract 固定成同一套公开语义
3. 在不扩张宿主边界的前提下，继续维持 Codex-first、manual-only 非 Codex host 的产品表述
4. 将 issue5 剩余 closeout seams 继续拆成小 PR：`cam init` 幂等/`--force`、`cam session status/load` 只读化、Vitest `.worktrees/**` 边界、docs/help parity
5. 继续把 shared/team memory 维持在 reviewer/recall additive surface，不让它越界变成第二 canonical truth
6. 保持发布面验证串行执行：`dist-cli-smoke` 与 `tarball-install-smoke` 不并行跑，避免 `prepack -> rimraf dist` 造成假阴性

## 变更记录

- 2026-04-13: docs 契约继续对齐当前 migration 方向：公开 dream reviewer lane 统一写为 `candidates -> review -> adopt -> promote-prep -> promote -> apply-prep`；subagent candidate 明确从 blocked 状态起步；instruction-like `promote/prep` 全部保持 `proposal-only`，只返回 proposal artifact / `manualWorkflow` / `applyReadiness` 这组结构化产物，永不自动改 instruction files；`resumeContext` / `querySurfacing` 补齐 read-only `suggestedTeamEntries` 口径；wrapper startup 顺序统一为 continuity -> instruction files -> dream refs -> top durable refs -> team/shared refs；release 文档继续强调 `dist-cli-smoke` 与 `tarball-install-smoke` 必须串行执行。
- 2026-04-13: Claude memory / dream R2 已继续往“真实工作流”推进：shared/team memory 以 repo-tracked `TEAM_MEMORY.md` + `team-memory/*.md` 进入 project-scoped read-only sidecar，并通过 `dreamSidecar.teamMemory`、`resumeContext.suggestedTeamEntries`、`querySurfacing.suggestedTeamEntries` 暴露 reviewer / recall surfacing；dream reviewer lane 新增 `cam dream adopt` 与 `cam dream promote-prep`，instruction-like `proposal-only` promote 也扩成结构化 proposal artifact（`selectedTarget`、`rankedTargets`、`guidanceBlock`、`patchPreview`、`artifactPath`、`manualWorkflow`、`applyReadiness`）；`dreamSidecarAutoBuild` 的当前公开契约则统一以 2026-04-14 closeout 为准，仅 wrapper startup 允许按需重建 latest primary dream snapshot，inspect / retrieval surfaces 保持只读。
- 2026-04-12: docs/help/release-smoke 切片已补齐 dream reviewer 文档与契约说明：四语 README、`docs/README.md`、`docs/session-continuity.md`、`docs/claude-memory-dream-r1.md`、`docs/release-checklist.md` 现在明确写出 additive `resumeContext` / `querySurfacing`、dream reviewer lane，以及“durable-memory promote 走显式 reviewer/audit 写入、instruction-like promote 保持 `proposal-only`”这条边界；同时 `test/docs-contract.test.ts`、`test/dist-cli-smoke.test.ts`、`test/tarball-install-smoke.test.ts` 补上对应的 docs/help/release-smoke 断言。
- 2026-04-12: 第一轮 Claude memory / dream 迁移已经落地：新增 `instruction memory` 与 `learned durable memory` 的 reviewer 分层；`MEMORY.md` 进一步收紧为 `index-only`，不再回写 latest summary preview；新增最小可用 `dream sidecar` 命令面 `cam dream build` / `cam dream inspect`，把 continuity compaction、relevant refs 与 pending promotion candidates 写入可审计 JSON sidecar，但不改 canonical Markdown memory；同时 `cam memory --json`、`cam session status/load --json` 与 `cam recall search --json` 分别补上 `instructionLayer` / `startupBudgetLedger` / `dreamSidecar`、`resumeContext` / `dreamSidecar`、`querySurfacing` 等 additive reviewer 字段。
- 2026-04-11: issue5 tail closeout 新增 cross-host issue-tracker 回归保护：`directive-utils` 现在用完整的 non-generic hostname 片段构造 issue-tracker resource key，避免不同 host 但相同 repo/path 或 ticket id 的 URL 互相覆盖；同时补强 `vitest.config.ts` 的默认 exclude contract 测试，并把 `integrations apply --cwd` 的 invalid-path fail-closed 行为纳入 source / dist / tarball 回归覆盖。
- 2026-04-10: issue5 PR14 收口了三类 runtime contract seam：`mcp` 命令的空 `--cwd` 现在 fail-closed；`workflowContract` 的 resolved launcher 与显式 `launcherOverride` 保持一致；delete-only 的 forget follow-up 文案不再硬编码裸 `cam recall timeline`。
- 2026-04-10: `test/recovery-records.test.ts` 已对齐当前 continuity 语义：`scope=both` continuity recovery marker 可以被后续 single-scope save/refresh 复用，并继续由 `session-command` 行为测试锁定。
- 2026-04-10: 新增根级 `AGENTS.md`，补齐仓库级功能说明、命令面、关键 JSON 契约与项目规划。
- 2026-04-10: 明确 `cam integrations install --help` 与四语 README 命令表的公开边界：install 编排 stack，但不更新 `AGENTS.md`。
- 2026-04-10: 新增 Claude Code / Gemini CLI 宿主接入边界文档，并同步收紧宿主策略文档与 README 入口，明确非 Codex 宿主当前仍是 manual-only / snippet-first。
- 2026-04-14: 收紧 Claude memory / dream R1 reviewer contract：`TEAM_MEMORY.md` 现在明确为 team pack 的 root manifest / index-only 入口，真实 team entry 只来自 `team-memory/*.md`；`cam memory`、`cam dream inspect`、`cam recall`、retrieval MCP、`cam session status/load` 这些 inspect / retrieval surface 不再因 `dreamSidecarAutoBuild=true` 隐式写 dream snapshot 或 team index，而是保持只读并返回 diagnostics / next steps；instruction-like proposal lane 新增 `manual-apply-pending` 状态，并补上显式 `--target-file` override、rejected/stale proposal follow-up 过滤，以及 release-facing `dream inspect/help` smoke。
- 2026-04-14: closeout docs wording 已统一收敛：四语 README、`docs/claude-memory-dream-r1.md`、`docs/release-checklist.md` 与本文件现在统一写成 proposal artifact，并在适用位置显式点名 `manualWorkflow`、`applyReadiness`、`--target-file`，避免 instruction-like manual apply contract 在不同文档里各说各话。
