# Claude Memory / Dream Closeout Contract

> 本文记录 `codex-auto-memory` 当前对外公开的 Claude memory / dream closeout 契约。
> 它描述的是已经收口的 reviewer / retrieval 边界，不再按轮次追踪临时迁移过程。

## 已落地的公开边界

- `instruction memory` 与 `learned durable memory` 已明确分层：
  - instruction memory 只做发现、解释与 reviewer surfacing
  - learned durable memory 继续只由 `cam sync` / `cam remember` / `cam forget` 管理
- `MEMORY.md` 已继续收紧为 `index-only`：
  - 不再回写 latest summary preview
  - durable fact hints 继续通过 startup highlights 暴露
- dream sidecar 已作为最小可用、可审计、可关闭的 reviewer surface 落地：
  - `cam dream build`
  - `cam dream inspect`
  - sidecar 只写 JSON snapshot / audit / recovery，不直接改 canonical Markdown memory
- reviewer-facing additive 字段已经进入公开 JSON 面：
  - `cam memory --json`: `instructionLayer`、`loadReasons`、`startupBudgetLedger`、`dreamSidecar`
  - `cam session status --json` / `cam session load --json`: `resumeContext`、`dreamSidecar`
  - `cam recall search --json`: `querySurfacing`、`suggestedDreamRefs`、`suggestedInstructionFiles`、`suggestedTeamEntries`

## Dream sidecar contract

- 目标：为 continuity compaction、query-time surfacing 和 proposal review 提供可审计、fail-closed 的 sidecar
- 存储：
  - shared snapshot: `.../dream/shared/latest.json`
  - local snapshot: `.../dream/locals/<worktree-id>/latest.json`
  - audit: `.../audit/dream-sidecar-log.jsonl`
  - recovery: `.../audit/dream-sidecar-recovery.json`
- snapshot 结构保持稳定：
  - `continuityCompaction`
  - `relevantMemoryRefs`
  - `promotionCandidates`
  - `teamMemory`
- promotion candidates 继续按 reviewer lane 区分：
  - `instructionLikeCandidates`
  - `durableMemoryCandidates`

## Reviewer lane contract

- 公开命令面统一为 `cam dream candidates` / `cam dream review` / `cam dream adopt` / `cam dream promote-prep` / `cam dream promote` / `cam dream apply-prep`
- `candidates` 负责列出 sidecar 中待审条目，其中 subagent candidates 默认先 blocked
- `review` 负责 reviewer-facing inspection，不写 canonical memory
- `adopt` 只负责把 blocked subagent candidate 提升进 primary review lane，不直接写 durable memory
- `promote-prep` 只做只读预演：
  - durable-memory candidate 预演 lifecycle / target，不写 Markdown canonical store
  - instruction-like candidate 继续保持 `proposal-only`
- `promote` 继续保持双边界：
  - durable-memory candidate 只能通过显式 `promote` + 既有 reviewer/audit 路径写入 canonical memory
  - instruction-like candidate 继续保持 `proposal-only`，永不直接写 instruction files
- `apply-prep` 只负责整理 instruction-like proposal 的 manual apply 准备，不自动改 instruction files

## Instruction-like proposal contract

- instruction-like `promote` / `promote-prep` / `apply-prep` 全部保持 `proposal-only`
- proposal payload 现在统一写为 proposal artifact
- 当前稳定字段包括：
  - `selectedTarget`
  - `rankedTargets`
  - `guidanceBlock`
  - `patchPreview`
  - `artifactPath`
  - `manualWorkflow`
  - `applyReadiness`
- reviewer 可以通过显式 `--target-file` override 指定本次 proposal 指向的 instruction file，而不改变默认 target ranking
- instruction-like candidate 在 proposal-only `promote` 之后进入 `manual-apply-pending` reviewer 状态
- rejected / stale proposal artifacts 不应再被当作最新 follow-up 推荐

## Auto-build and read-only boundary

- `dreamSidecarAutoBuild` 的公开契约已经收紧为：
  - 只在允许写 sidecar 的运行路径中按需重建 latest primary dream snapshot
  - 当前对外公开保证的自动重建路径是 wrapper startup
  - auto-build 仍然只吃 primary rollout，不把 subagent rollout 升格成 durable sync 来源
- 下列 inspect / retrieval surfaces 保持只读：
  - `cam memory`
  - `cam dream inspect`
  - `cam recall`
  - retrieval MCP
  - `cam session status`
  - `cam session load`
- 当 snapshot 或 team index 缺失时，上述只读面只返回 diagnostics / next steps，不隐式写盘

## Team memory boundary

- `TEAM_MEMORY.md` 现在明确作为 repo-tracked team pack 的 root manifest / index-only 入口
- reviewer-visible team entries 只来自 `team-memory/*.md`
- 它们会被编进 project-scoped read-only sidecar index，并通过以下字段暴露 reviewer / recall 提示：
  - `dreamSidecar.teamMemory`
  - `resumeContext.suggestedTeamEntries`
  - `querySurfacing.suggestedTeamEntries`
- team memory 继续保持 non-canonical：
  - 不进入 canonical durable startup memory
  - 不开放 `timeline/details`
  - wrapper startup 只会把它作为 read-only team/shared refs 提示

## Wrapper startup alignment

- wrapper startup 的公开顺序统一为 `continuity -> instruction files -> dream refs -> top durable refs -> team/shared refs`
- `team/shared refs` 继续只是 read-only、non-canonical 的 reviewer hints，不是第二真相层

## 明确不做的事

- 不让 dream sidecar 直接写 `MEMORY.md` 或 topic files
- 不做后台常驻 dream daemon
- 不改变 `workflowContract`、MCP tool 名或现有 retrieval 核心枚举
- 不把 Claude / Gemini host-native 自动安装带回当前主仓

## 相关验证面

- `test/config-loader.test.ts`
- `test/dream-sidecar.test.ts`
- `test/memory-store.test.ts`
- `test/memory-command.test.ts`
- `test/session-command.test.ts`
- `test/recall-command.test.ts`

更大范围的 release-facing 验证继续走：

1. `pnpm test:docs-contract`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`
5. `pnpm test:dist-cli-smoke`
6. `pnpm pack:check`
7. `pnpm test:tarball-install-smoke`

注意：`pnpm test:dist-cli-smoke` 与 `pnpm test:tarball-install-smoke` 必须串行执行，避免 `prepack -> rimraf dist` 造成假阴性。
