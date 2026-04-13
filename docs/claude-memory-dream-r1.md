# Claude Memory / Dream Round 1

> 本文记录 `codex-auto-memory` 第一轮 Claude memory / dream 对齐的实际工程迁移。  
> 它描述的是本仓已经落地的实现，不重复本地 only 调研稿。

## 这轮已经落地的迁移

- 增加了 `instruction memory` 与 `learned durable memory` 的 reviewer 分层：
  - instruction memory 只做发现与解释
  - learned durable memory 继续由 `cam sync` / `cam remember` / `cam forget` 管理
- `MEMORY.md` 进一步收紧为 `index-only`：
  - 不再把 latest summary preview 回写进 `MEMORY.md`
  - durable fact hints 继续通过 startup highlights 暴露
- 新增最小可用 `dream sidecar`：
  - `cam dream build`
  - `cam dream inspect`
  - sidecar 只写 JSON snapshot / audit / recovery
  - 不直接改 canonical Markdown memory
- `cam memory --json` 现在会额外暴露：
  - `instructionLayer`
  - `loadReasons`
  - `startupBudgetLedger`
  - `dreamSidecar`
- `cam session status --json` / `cam session load --json` 现在会额外暴露：
  - `resumeContext`
  - `dreamSidecar`
- `cam recall search --json` 现在会额外暴露：
  - `querySurfacing`
  - `querySurfacing.suggestedDreamRefs`
  - `querySurfacing.suggestedInstructionFiles`

## Dream Sidecar Contract

- 目标：给 continuity compaction 和 query-time surfacing 一个可审计、可关闭、fail-closed 的 sidecar
- 存储：
  - shared snapshot: `.../dream/shared/latest.json`
  - local snapshot: `.../dream/locals/<worktree-id>/latest.json`
  - audit: `.../audit/dream-sidecar-log.jsonl`
  - recovery: `.../audit/dream-sidecar-recovery.json`
- snapshot 结构：
  - `continuityCompaction`
  - `relevantMemoryRefs`
  - `promotionCandidates`
  - `teamMemory`
- promotion candidates 继续保持 pending：
  - `instructionLikeCandidates`
  - `durableMemoryCandidates`
- reviewer 命令面继续朝 `cam dream candidates` / `cam dream review` / `cam dream promote` 收口：
  - candidates 负责列出 sidecar 中待审条目
  - review 负责做 reviewer-facing inspection
  - `cam dream adopt` 会把 blocked subagent candidate 提升进 primary review lane，但不会直接写 durable memory
  - `cam dream promote-prep` 负责给 approved candidate 做只读预演，不改 canonical memory
  - durable-memory candidate 的 `promote` 只会通过现有 reviewer/audit 路径显式写入 canonical memory
  - instruction-like candidate 的 `promote` 继续保持 `proposal-only`，不直接写 instruction files，而是返回结构化 proposal artifact（target ranking、guidance block、patch preview）

## Round 2 增量

- `dreamSidecarAutoBuild` 现在是实际能力，而不是只读配置：
  - 开启后，`session` / `recall` / `wrapper` / MCP 会在 snapshot 缺失、无效或落后于 latest primary rollout 时按需重建 dream sidecar
  - auto-build 仍然只吃 primary rollout，不把 subagent rollout 升格成 durable sync 来源
- `teamMemory` 不再只是 inspect stub：
  - 当前仓库支持 repo-tracked team pack：`TEAM_MEMORY.md` + `team-memory/*.md`
  - 它会被编进 project-scoped read-only sidecar index，并通过 `dreamSidecar.teamMemory`、`resumeContext.suggestedTeamEntries`、`querySurfacing.suggestedTeamEntries` 暴露 reviewer / recall 提示
  - 它仍然是 non-canonical，不直接进入 startup 注入，也不开放 `timeline/details`
- subagent candidate lane 现在补上了显式 adopt / prep：
  - blocked subagent candidate 需要先 `cam dream adopt`
  - adopt 之后仍然要走 `review --approve`
  - `cam dream promote-prep` 只预演 lifecycle / target，不写 Markdown canonical store
- instruction-like lane 继续保持 `proposal-only`，但 payload 更完整：
  - `selectedTarget`
  - `rankedTargets`
  - `guidanceBlock`
  - `patchPreview`
  - `artifactPath`

## 这轮明确不做的事

- 不让 dream sidecar 直接写 `MEMORY.md` 或 topic files
- 不做后台常驻 dream daemon
- 不改变 `workflowContract`、MCP tool 名或现有 retrieval 核心枚举
- 不把 Claude / Gemini host-native 自动安装带回当前主仓

## 最小验证

- `test/config-loader.test.ts`
- `test/dream-sidecar.test.ts`
- `test/memory-store.test.ts`
- `test/memory-command.test.ts`
- `test/session-command.test.ts`
- `test/recall-command.test.ts`

后续更大范围验证继续走：

1. `pnpm test:docs-contract`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`
5. `pnpm test:dist-cli-smoke`
6. `pnpm pack:check`
7. `pnpm test:tarball-install-smoke`
