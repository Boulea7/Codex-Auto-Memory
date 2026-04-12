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
