# 集成演进策略

> 本文解释当前仓库为什么从“companion CLI”演进为 **Codex-first Hybrid memory system**，以及 hook / skill / MCP 在这个仓库里的正式定位。

## 一页结论

当前仓库的方向已经从单一 companion CLI 扩展为：

- **当前实现仍以 wrapper + CLI 为主**
- **当前产品方向正式引入 hooks、skills、MCP-aware surfaces**
- **Markdown-first 是最高层不变量**
- **当前仓库仍以 Codex 为主宿主，不直接改写成多宿主统一平台**

## 为什么要引入 hook / skill / MCP

仅靠显式 CLI 虽然可靠，但会把一部分用户挡在外面：

- 有人喜欢 `cam run`、`cam sync`、`cam memory`
- 也有人更希望代理在宿主内部自动完成记忆提取、召回、检索与审计

因此当前仓库需要同时服务两类用户：

1. **显式工作流用户**
   - 通过 `cam` 命令控制 memory
2. **更自动化的代理工作流用户**
   - 希望通过 hooks、skills、MCP 让代理自己使用记忆能力

## 当前仓库的正式产品方向

当前仓库接下来的主方向是：

- 继续把 Codex durable memory 做稳
- 完成 issue 提到的 4 项核心能力
- 在当前仓库内补齐 3 类 integration surfaces

### A. Hooks

用途：

- 捕获生命周期事件
- 自动触发 sync / recall / audit
- 降低手动维护成本

当前状态：

- 已有 hook bridge 资产
- `cam hooks install` 现在会生成本仓自带的 local bridge / fallback helper bundle：`memory-recall.sh`、兼容 helper wrappers 与 `recall-bridge.md`
- 这条线当前仍是本地桥接层，不宣称自己是官方 Codex hook surface
- 还不是主入口

目标状态：

- 成为与 wrapper 并行的正式入口之一

### B. Skills

用途：

- 把 memory retrieval workflow 教给代理
- 让代理知道什么时候该搜索记忆、什么时候该读 topic file、什么时候该做审计

当前状态：

- 已进入代码主线
- 当前仓库已经提供 `cam recall search` / `timeline` / `details` 作为 retrieval workflow 的当前 CLI surface
- `cam recall search` 现在默认已经对齐推荐 preset：`state=auto`、`limit=8`，会先查 active，未命中再回退 archived，继续降低代理手动 widened search 的摩擦
- `cam skills install` 现在默认安装 runtime Codex skill，并支持显式 `--surface runtime|official-user|official-project`；无论安装到哪个 surface，都复用同一套 MCP-first、CLI-fallback 的 retrieval guidance 与推荐检索 preset：`state=auto`、`limit=8`

目标状态：

- 成为低摩擦、可分发、可复用的使用面

### C. MCP

用途：

- 提供低 token 的检索接口
- 为 search / timeline / detail retrieval 提供统一工具面

当前状态：

- 已有正式 retrieval MCP 主路径
- `cam mcp serve` 会暴露 `search_memories`、`timeline_memories`、`get_memory_details`
- `search_memories` 与 `cam recall search` 现在共享 active-first、archived-fallback 的默认检索语义
- 当前推荐的渐进式检索 preset 统一为：`state=auto`、`limit=8`
- `cam mcp install --host <codex|claude|gemini>` 会显式写入推荐的 project-scoped 宿主配置，继续降低接线摩擦，但不改变 retrieval 的只读语义
- `cam mcp print-config --host ...` 会打印 ready-to-paste 宿主接入片段；其中 `--host codex` 现在还会额外打印推荐的 `AGENTS.md` snippet，把 durable memory workflow 正式接到 Codex 当前公开稳定 surface 上
- `cam mcp apply-guidance --host codex` 会以 additive、可审计、fail-closed 的方式创建或更新 repo 根 `AGENTS.md` 中由本仓维护的 guidance block，继续降低手工粘贴成本
- `cam integrations apply --host codex` 现在提供显式的一次性 Codex stack apply 入口：在不改变 `integrations install` 边界的前提下，统一编排 project-scoped MCP wiring、managed `AGENTS.md` guidance block、hooks 与 skills；其中 skills 默认仍走 runtime target，但也支持显式 `--skill-surface runtime|official-user|official-project`
- `cam mcp doctor` 会只读检查推荐的 project-scoped MCP 接线、project pinning 与 shared fallback bridge assets
- 它仍然是只读 retrieval plane，不是新的 canonical store

目标状态：

- 与 skills 配合形成 progressive disclosure retrieval workflow

## 这 3 类能力如何分工

- hooks 解决“**什么时候触发**”
- skills 解决“**模型怎么使用**”
- MCP 解决“**模型具体能调用什么**”

三者都不应该直接拥有 canonical memory。

真正的主真相仍然是：

- `MEMORY.md`
- topic files
- continuity files
- audit / provenance logs

## 当前仓库不做什么

为了避免方向走歪，当前仓库明确不做以下事情：

- 不为了贴近 `claude-mem` 而改成 DB-first
- 不为了宿主兼容而把当前仓库直接升格成统一多宿主主仓
- 不围绕 plugin format 做统一抽象
- 不把 hooks / skills / MCP 的引入理解成“放弃 CLI 主线”

## 当前仓库应该优先完成的产品面

当前仓库需要把 issue 中的 4 个能力明确落到实现目标上：

1. 自动提取长期记忆
2. 自动召回长期记忆
3. 更新、去重、覆盖、归档
4. 降低手动维护 Markdown 成本

建议优先顺序：

1. 把 `update / dedupe / overwrite / archive` 语义做完整
2. 补 retrieval workflow：`search / timeline / detail`
3. 把 hooks 和 skill packs 接到 retrieval workflow 上
4. 再逐步降低用户显式调用 `cam` 命令的频率

## 当前仓库与未来新仓的关系

当前仓库的职责：

- 做 **Codex-first 产品**
- 把 Codex 场景下的 Markdown-first memory 体验做强
- 让当前实现可以逐步容纳 hook / skill / MCP surfaces

未来新仓的职责：

- 做 **host-adaptable memory core**
- 统一 memory semantics，而不是统一宿主格式

换句话说：

- 当前仓库是产品线
- 新仓是平台线

## 推荐的后续文档与实现边界

当前仓库内后续实现，应统一遵守：

- `cam` 命令继续保留并作为最稳主入口
- hooks / skills / MCP 进入主线时，不得绕开 canonical Markdown store
- SQLite / FTS / vector / graph 若引入，只能作为 sidecar retrieval plane
- session continuity 仍独立于 durable memory
- reviewer surface 不得因自动化增强而消失
