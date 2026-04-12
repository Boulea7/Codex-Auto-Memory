# Claude Code Auto Memory 参考契约

[简体中文](./claude-reference.md) | [English](./claude-reference.en.md)

> 本文记录的是 `codex-auto-memory` 主动对齐的 Claude Code memory 公开契约。  
> 它不是对 Anthropic 内部实现的逆向说明，也不应该把本地观察或社区经验写成官方稳定事实。

## 本文回答什么

- Claude Code 在公开文档里，把 auto memory 说成了什么
- 哪些行为是本项目应该尽量复现的核心契约
- 哪些表面虽然相关，但不能被过度宣称为“已完全对齐”

## 一页结论

| 公开契约 | 对本项目意味着什么 |
| :-- | :-- |
| memory 是本地 Markdown | 本项目必须坚持 Markdown-first，且允许用户直接审查与编辑 |
| `MEMORY.md` 是启动入口 | 首页索引必须保持紧凑，不能变成全文 dump |
| 启动只读前 200 行 | startup memory 必须服从 line budget，细节下沉到 topic files |
| topic files 按需读取 | 不能在启动时 eager load 全部 topic 内容 |
| 同仓库 worktree 共享 project memory | project identity 不能只靠当前目录路径推断 |
| `/memory` 提供审查与编辑能力 | 本项目至少要提供 inspect / audit surface，并保持 Markdown 可手工编辑 |
| `autoMemoryDirectory` 不能由 project-shared config 随意重定向 | 配置边界必须防止共享项目劫持用户 memory 路径 |

## 核心公开契约

根据 Claude Code 的官方 memory 文档，可以稳定提炼出以下几条：

- Claude 会自动为后续会话保存 memory notes
- memory 存储在本地文件系统，而不是账号级云端记忆
- `MEMORY.md` 是紧凑入口，topic files 承载细节层
- memory 对用户是可见、可编辑、可删除的

这些点构成了本项目最重要的对齐目标。

## 需要复现的产品行为

### 1. AI 管理、但用户可控的本地 memory

Claude Code 把 auto memory 描述为“Claude 写给自己看的后续工作笔记”。  
其中应保存的是稳定、未来有用的信息，例如：

- 构建与测试命令
- 调试前提与排障经验
- 架构决策
- 编码偏好
- 工作流习惯

它并不是：

- 全量对话回放
- 云端账号记忆
- 任意临时 task state 的堆积

### 2. `MEMORY.md` 是启动入口，不是细节仓库

每个 scope 都应该有：

- 一个紧凑的 `MEMORY.md`
- 若干 topic files，例如 `commands.md`、`workflow.md`

`MEMORY.md` 的职责是告诉运行时“有哪些 memory、应该去哪读细节”，而不是直接塞满所有内容。

### 3. 200 行启动预算是最重要的操作约束

Claude Code 文档明确说明：启动时只会读取 `MEMORY.md` 的前 200 行。

这直接要求：

- 启动索引必须保持 concise
- 细节必须进入 topic files
- topic files 必须按需读取

对 `codex-auto-memory` 来说，这也是为什么 startup injection 只注入 quoted indexes 与 topic refs，而不是 eager topic bodies。

### 4. project memory 应按仓库身份共享

Claude Code 文档强调：

- 同一 git 仓库的 worktree 共享 project memory
- 同仓库子目录也应共享 project memory
- 不同仓库之间不共享

这意味着 project identity 应基于 git common directory，而不是当前工作路径本身。

### 5. 用户必须能审查与编辑 memory

Claude Code 通过 `/memory` 暴露 inspect / edit / delete 能力。  
本项目现阶段不宣称已复制 `/memory` 的全部交互深度，但必须继续满足两件事：

- 用户可以看到实际 memory 文件与 active paths
- 用户可以通过 Markdown 文件本身或 companion commands 修改这些 memory

### 6. `autoMemoryDirectory` 有明确的安全边界

Claude 的公开配置边界强调：共享项目配置不应该把另一个用户的 memory 重定向到任意位置。

因此本项目也必须保持：

- user / local / managed config 可以控制 memory 目录
- shared project config 不能劫持全局或用户级 memory 路径

## 相关但不能过度宣称的表面

### Subagent memory

Claude Code 官方文档确认 subagents 存在独立 memory 路径。  
这说明 subagent memory 是值得关注的 parity surface，但不意味着本项目今天已经拥有等价能力。

### Hooks

Claude Code 的 hook 生命周期表面比当前 Codex 更丰富。  
这能帮助我们理解未来迁移方向，但不能据此把当前 Codex hooks 写成“几乎 ready”。

### `/memory` 深度

Claude `/memory` 是完整的交互入口；`codex-auto-memory` 当前更接近：

- `cam memory` 做 inspect / audit
- `cam remember` / `cam forget` 做显式更新
- 直接编辑 Markdown 做手工修正

这条边界必须写清楚，不能为了营销把它写成完全等价。

## 如何映射到 Codex Auto Memory

本项目当前应该坚持的 Claude-aligned 规则：

- memory 必须是本地、可审计、可编辑的 Markdown
- `MEMORY.md` 必须保持紧凑索引心智模型
- topic files 承载细节层，按需读取
- project memory 在 worktree 间共享
- session continuity 与 durable memory 严格分离
- native migration 只能是 seam，不能取代 companion-first 主线

## 官方参考

- Claude memory docs: <https://code.claude.com/docs/en/memory>
- Claude settings docs: <https://code.claude.com/docs/en/settings>
- Claude hooks docs: <https://code.claude.com/docs/en/hooks>
- Claude subagents docs: <https://code.claude.com/docs/en/sub-agents>
- Claude docs index: <https://code.claude.com/docs/llms.txt>

<!-- Note: canonical Claude Code docs are at https://docs.anthropic.com — verify these URLs if links appear broken -->
