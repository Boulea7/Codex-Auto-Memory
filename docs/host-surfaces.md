# 宿主能力面

> 本文回答当前仓库在产品与架构上应如何看待不同宿主。  
> 它不是多宿主承诺清单，而是当前仓库的 **宿主判断文档**。

## 一页结论

当前仓库的宿主判断应固定为：

- **Codex 是当前主宿主**
- Claude / Gemini / OpenCode / OpenClaw 是重要参考宿主
- 当前仓库不直接改写成多宿主统一平台
- 多宿主统一 memory core 应在独立新仓中设计

## 为什么当前仓库仍然是 Codex-first

因为这个仓库的现有实现与用户心智都已经围绕 Codex 形成：

- `cam run` / `cam exec` / `cam resume`
- wrapper 注入
- rollout JSONL 提取
- `cam memory` / `cam recall` / `cam session` / `cam audit`
- `cam hooks install` / `cam skills install`
- `cam mcp install` / `cam mcp print-config` / `cam mcp doctor`

其中当前 retrieval 边界也已经更明确：

- `cam recall` 是当前 CLI 侧的 read-only retrieval surface
- `cam mcp serve` 是同一套 contract 的 MCP retrieval surface
- `cam mcp install` 是显式、可选、project-scoped 的宿主接线安装面
- `generic` host 仍然保持 manual-only，只通过 `cam mcp print-config --host generic` 暴露手动接线片段
- `cam integrations install` / `apply` / `doctor` 把 Codex-only stack 明确拆成安装、一次性 apply 与只读检查三个公开入口
- `cam memory` 仍是 inspect / audit surface
- `cam session` 仍是 temporary continuity surface

这些都是 Codex-first 的产品面，而不是通用宿主抽象。

## 当前仓库如何看待其他宿主

### Claude Code

价值：

- 提供最完整的官方 auto memory、hooks、plugins、skills、subagents 参考契约
- 官方公开 surface 足够丰富，适合作为本仓 memory / host boundary 的高价值对照对象

在当前仓库里的角色：

- **参考对象**
- 用来定义产品体验与宿主能力边界
- 不作为当前仓库直接承诺支持的主宿主

当前真实可行的接入面：

- `cam mcp print-config --host claude`
- `cam mcp doctor --host claude`
- 用户手动维护 Claude host config

当前明确不做：

- `cam mcp install --host claude`
- `cam integrations install/apply --host claude`
- 自动写 Claude hooks / plugins / skills / subagent 资产

### Gemini CLI

价值：

- hooks、extensions、MCP、sub-agents 能力都很强
- 官方公开 surface 已不只是 MCP config file，还包括 `settings.json`、`GEMINI.md`、memory、skills 与 extensions
- 适合作为未来独立 memory runtime 的优先宿主之一

在当前仓库里的角色：

- **重要参考宿主**
- 帮助当前仓库设计未来 skill / hook / MCP surfaces
- 但不把当前仓库直接改写成 Gemini 主仓

当前真实可行的接入面：

- `cam mcp print-config --host gemini`
- `cam mcp doctor --host gemini`
- 用户手动维护 `.gemini/settings.json`

当前明确不做：

- `cam mcp install --host gemini`
- `cam integrations install/apply --host gemini`
- 自动写 Gemini hooks / skills / extensions / memory 配置

### OpenCode

价值：

- plugin、MCP、AGENTS、agents、client/server 架构都很强

在当前仓库里的角色：

- **重要参考宿主**
- 适合作为未来独立新仓的 adapter 目标
- 当前仓库只吸收其设计启发，不直接承担其适配工作

### OpenClaw

价值：

- 本身就是 plugin/gateway/platform
- 还支持 Claude / Codex / Cursor bundle compatibility

在当前仓库里的角色：

- **平台参考**
- 不是普通 coding CLI 宿主
- 如果未来支持，应按 native plugin 或 bundle 轨道处理，而不是把当前 CLI companion 平移过去

## 当前仓库要吸收什么，不吸收什么

应该吸收：

- Claude 的 memory 契约
- Gemini 的 extension + hooks + MCP 思路
- OpenCode 的 plugin + MCP + AGENTS 能力面
- OpenClaw 的“统一 memory core，不统一格式”思路
- 针对宿主差异提供清晰分层的接入面：`cam mcp install --host codex` 负责显式写入 project-scoped Codex host config，并在安全前提下保留 `codex_auto_memory` entry 上的非 canonical 自定义字段；`claude`、`gemini` 与 `generic` 继续保持 host-mutation manual-only，但仍通过 `cam mcp print-config` / `cam mcp doctor` 暴露只打印 / 只检查的 read-only wiring guidance，而不是完全隐藏 inspect surface；其中 `print-config` / `doctor` 现在还会显式暴露官方 Codex hooks 的实验性 guidance，继续把“公开可见”和“可作为默认主路径”区分开；`doctor` 也会把 alternate global wiring 与推荐的 project-scoped 路径分开表达，并区分 hook helper 是否只是 installed 还是在当前 shell 中真正 operational；`cam mcp apply-guidance --host codex` 负责 additive 管理 repo 级 `AGENTS.md` guidance block，`cam integrations install --host codex` 负责编排不改写 `AGENTS.md` 的 stack install，`cam integrations apply --host codex` 负责显式收口整套 Codex stack apply，`cam integrations doctor --host codex` 负责只读汇总整套 stack readiness；install/apply 完成后仍需要回到 doctor 判断当前环境里究竟是 MCP、local bridge 还是 resolved CLI 在实际生效；其中 skills 默认仍安装到 runtime target，但 `cam skills install --surface runtime|official-user|official-project` 与 `cam integrations install/apply --skill-surface ...` 已为官方 `.agents/skills` 路径准备显式 opt-in 兼容面；shell fallback 仍由 `cam hooks install` 提供；这条 hooks 线是本仓自带的 local bridge，不是官方 Codex hook surface
- `cam mcp doctor --host codex` 与 `cam integrations doctor --host codex` 现在还会把“偏好 route”和“当前可运行 route”分开表达：`recommendedRoute` 继续表示首选的 MCP-first 路径；`currentlyOperationalRoute`、`routeKind`、`routeEvidence`、`shellDependencyLevel`、`hostMutationRequired`、`preferredRouteBlockers`、`currentOperationalBlockers` 则表达当前环境里哪条 route 真正可跑、首选 route 为什么没跑起来、以及当前 fallback 自己是否还有 blocker。skills 继续被视为 guidance surface，而不是 executable fallback route
- `cam integrations doctor --host codex` 还会显式暴露 skill-surface steering：`preferredSkillSurface`、`recommendedSkillInstallCommand`、`installedSkillSurfaces`、`readySkillSurfaces`。这些字段表达的是“当前建议把 guidance 安装到哪里”，而不是技能已经成为 executable fallback route。
- release-facing `--help` 文案也视为宿主能力面的稳定公开接口，必须和上述 install / apply / doctor / manual-only 边界保持一致
- 对 Claude / Gemini 这类非 Codex 宿主，当前仓库只承接 manual-only / snippet-first 接入，不把官方更强的 host-native surface 误写成本仓已经自动接管的能力

不应该吸收：

- 直接把当前仓库定义成五宿主统一主仓
- 围绕统一 plugin format 做主抽象
- 为了兼容更多宿主而稀释当前 Codex 场景的产品完成度

## 当前仓库的正式边界

当前仓库对外应保持以下表述：

- `codex-auto-memory` 是 **Codex-first Hybrid memory system**
- 它当前服务于 Codex
- 它会正式吸收 hooks、skills、MCP-aware integration 方向
- 它不会在当前阶段直接承担多宿主统一平台职责
- Claude / Gemini 当前都属于“公开能力值得研究，但本仓只支持 manual-only wiring guidance”的范围

## 与独立新仓的接口边界

未来如果新仓承担统一 memory core，这个仓库最适合作为：

- `Codex adapter reference implementation`
- `Markdown-first product surface reference`
- `durable memory + continuity + reviewer contract` 的现实样例

这意味着当前仓库在设计上要尽量保留：

- 清晰的 memory semantics
- 明确的 audit surface
- 可抽离的 extractor / store / injector seam

但不需要提前重写成大平台结构。
