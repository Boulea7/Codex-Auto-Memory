# Claude Code / Gemini CLI 宿主接入边界

> 本文回答两个问题：  
> 1. Claude Code 与 Gemini CLI 当前公开了哪些值得对齐的宿主能力面。  
> 2. 在这些公开能力已经存在的前提下，`codex-auto-memory` 现在真正应该支持到哪一层。

## 一页结论

当前最稳的结论应固定为：

- `codex-auto-memory` 仍然是 **Codex-first Hybrid memory system**
- Claude Code 与 Gemini CLI 都是 **重要参考宿主**
- 当前仓库对 Claude / Gemini 的真实接入面仍是：
  - `cam mcp print-config --host <claude|gemini>`
  - `cam mcp doctor --host <claude|gemini>`
  - manual-only / snippet-first 的宿主接线指导
- 当前仓库 **不** 应在这一轮新增：
  - `claude` / `gemini` 的自动写配置 install/apply
  - Claude / Gemini host-native hooks/skills/extensions 的自动安装
  - 多宿主统一 runtime 抽象

## 证据分层

### A. 官方公开资料

应优先信任以下公开面：

- Claude Code 官方文档：
  - memory
  - settings
  - hooks
  - sub-agents
  - MCP
- Claude Code 官方仓库公开资料：
  - `anthropics/claude-code`
  - plugins 公开说明
- Gemini CLI 官方仓库公开资料：
  - `google-gemini/gemini-cli`
  - `settings.json` / project-scoped `.gemini/settings.json`
  - `GEMINI.md`
  - memory / `save_memory`
  - hooks
  - skills
  - extensions
  - MCP

### B. 当前仓库事实

当前仓库代码与测试已经明确表达：

- `cam mcp install` 只有 `codex` 可写
- `claude` / `gemini` / `generic` 继续保持 manual-only / snippet-first
- `cam mcp print-config --host <claude|gemini>` 可以给出宿主接线片段
- `cam mcp doctor --host <claude|gemini>` 只能检查 snippet/config truth，不冒充 Codex 级 operational readiness

### C. 非官方研究资料

例如：

- `Boulea7/ClaudeCode-Source-DeepDive`

这类资料可以帮助理解内部结构与未来可能的适配点，但不能单独升级为本仓的公开产品承诺。

## Claude Code：当前应如何看待

Claude Code 当前公开的能力面足够强，至少已经把以下内容放进了公开宿主表面：

- memory
- settings
- hooks
- sub-agents
- MCP
- plugins / commands / agents / skills / hooks / MCP 组合扩展

对当前仓库的含义：

- Claude 是 **产品契约参考宿主**
- Claude memory contract 继续是本仓 memory semantics 的高价值对齐对象
- Claude hooks / sub-agents / plugins 继续是未来 host adapter 设计的重要参照
- 但当前仓库不应把这些公开能力误写成“本仓已经支持 Claude host-native integration”

当前真实可做的 Claude 接入：

- 用 `cam mcp print-config --host claude` 生成 `.mcp.json` 片段
- 由用户手动粘贴到 Claude host config
- 用 `cam mcp doctor --host claude --cwd <path>` 检查当前 snippet/config 是否存在且 project-pinned

当前不应做的 Claude 接入：

- `cam mcp install --host claude`
- `cam integrations install/apply --host claude`
- 自动写 Claude hooks / plugins / skills / subagent 资产

## Gemini CLI：当前应如何看待

Gemini CLI 的公开宿主面已经明显超过“只有一个 MCP config file”的水平。当前公开能力至少包括：

- `~/.gemini/settings.json` 与 `.gemini/settings.json`
- `GEMINI.md` 分层上下文
- memory / `save_memory`
- hooks
- skills
- extensions
- MCP

这意味着 Gemini 不是“只够拿来对照 MCP 片段”的宿主，而是：

- 一个公开 surface 相当丰富的参考宿主
- 一个未来可能值得单独做 adapter 的宿主
- 但在当前仓库里，仍然不应直接升级成可写主宿主

当前真实可做的 Gemini 接入：

- 用 `cam mcp print-config --host gemini` 生成 `.gemini/settings.json` 里的 `mcpServers` 片段
- 保持 `trust=false` 这类 host-controlled 安全边界
- 用 `cam mcp doctor --host gemini --cwd <path>` 检查 project-scoped 或 user-scoped wiring truth
- 在文档里明确：Gemini 自己还有 `GEMINI.md`、hooks、skills、extensions、memory 这些 host-native surface，但本仓当前不接管它们的自动安装

当前不应做的 Gemini 接入：

- `cam mcp install --host gemini`
- `cam integrations install/apply --host gemini`
- 自动写 `.gemini/settings.json`
- 自动安装 Gemini hooks / skills / extensions

## 当前仓库的正式边界

当前仓库对外应保持以下一致表述：

- Codex 是唯一的 mutable host
- Claude / Gemini / generic 的当前策略都是 manual-only / snippet-first
- `mcp print-config` 与 `mcp doctor` 是非 Codex 宿主当前真实支持的边界
- 这条边界是有意收口，不是“忘了做”

更具体地说：

- Codex：
  - 可写 install / apply / integrations stack
  - 可管理 repo-level `AGENTS.md` guidance
  - 可汇总 Codex-only route truth
- Claude：
  - 当前只提供 manual-only MCP wiring guidance
  - 当前不提供自动写 config / hooks / plugins / skills
- Gemini：
  - 当前只提供 manual-only MCP wiring guidance
  - 当前不提供自动写 config / hooks / skills / extensions

## 这一轮可以直接做什么

可以直接做：

- 收紧文档与 README 里的宿主边界表述
- 明确区分：
  - 官方公开宿主能力
  - 本仓当前真正支持的接入面
  - deferred 的 host-native integration 面
- 保持 `mcp print-config` / `mcp doctor` 对 Claude/Gemini 的 manual-only 叙事稳定

应 deferred：

- Claude/Gemini 可写 install/apply
- host-native hooks / skills / extensions 自动安装
- 多宿主统一 memory runtime 抽象

需要额外验证后再动：

- 是否值得单独为 Gemini 再开一条更细的 manual-host contract PR
- Claude plugins / marketplace / skills 的哪些表面属于“稳定公开能力”，哪些仍应只作为参考面引用

## 推荐的后续动作

如果未来要继续推进 Claude / Gemini 适配，建议按以下顺序：

1. 先把文档、README、help、tests 对齐到当前真实边界
2. 再单独评估 `manual-only host snippet/doctor parity` 是否需要代码级 closure
3. 如果未来真的要做 host-native adapter，再在独立 PR 中分别处理 Claude 与 Gemini，而不是一次性摊平成多宿主统一层

## 参考来源

- Claude Code 官方文档：
  - <https://code.claude.com/docs/en/memory>
  - <https://code.claude.com/docs/en/settings>
  - <https://code.claude.com/docs/en/hooks>
  - <https://code.claude.com/docs/en/sub-agents>
- Claude Code 官方仓库：
  - <https://github.com/anthropics/claude-code>
- Gemini CLI 官方仓库：
  - <https://github.com/google-gemini/gemini-cli>
- 非官方研究参考：
  - <https://github.com/Boulea7/ClaudeCode-Source-DeepDive>
