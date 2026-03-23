<div align="center">
  <h1>Codex Auto Memory</h1>
  <p><strong>為 Codex 重現 Claude-style auto memory 工作流的 local-first companion CLI</strong></p>
  <p>
    <a href="./README.md">简体中文</a> |
    <a href="./README.zh-TW.md">繁體中文</a> |
    <a href="./README.en.md">English</a> |
    <a href="./README.ja.md">日本語</a>
  </p>
  <p>
    <a href="https://github.com/Boulea7/Codex-Auto-Memory/actions/workflows/ci.yml">
      <img alt="CI" src="https://github.com/Boulea7/Codex-Auto-Memory/actions/workflows/ci.yml/badge.svg" />
    </a>
    <a href="./LICENSE">
      <img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" />
    </a>
    <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" />
    <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10.11.0-F69220?logo=pnpm&logoColor=white" />
    <a href="https://github.com/Boulea7/Codex-Auto-Memory/stargazers">
      <img alt="GitHub stars" src="https://img.shields.io/github/stars/Boulea7/Codex-Auto-Memory?style=social" />
    </a>
    <a href="https://github.com/Boulea7/Codex-Auto-Memory/issues">
      <img alt="GitHub issues" src="https://img.shields.io/github/issues/Boulea7/Codex-Auto-Memory" />
    </a>
  </p>
</div>

> `codex-auto-memory` 不是通用筆記軟體，也不是雲端記憶服務。<br />
> 它的目標是在今天的 Codex CLI 上，以本地 Markdown、緊湊 startup injection、按需 topic file 讀取與 companion runtime，盡可能重現 Claude Code auto memory 的可觀察產品契約。

---

**先看三個重點：**

1. **它做什麼**：每次 Codex 會話結束後，自動把有用資訊提取出來，寫入本地 Markdown，下一次啟動時再注入給 Codex，讓它「記得」你的專案。
2. **它怎麼存**：全部都是本地 Markdown，放在 `~/.codex-auto-memory/`，你可以隨時檢視、編輯、納入 Git 審查。
3. **它和 Claude 的關係**：這是一個 companion CLI，目標是在 Codex 上重現 Claude Code auto memory 的工作方式。它不是 Claude 官方產品，也不依賴雲端。

---

## 目錄

- [為什麼這個專案存在](#為什麼這個專案存在)
- [這個專案適合誰](#這個專案適合誰)
- [核心能力](#核心能力)
- [能力對照](#能力對照)
- [快速開始](#快速開始)
- [常用命令](#常用命令)
- [工作方式](#工作方式)
- [儲存布局](#儲存布局)
- [文件導航](#文件導航)
- [目前狀態](#目前狀態)
- [路線圖](#路線圖)
- [貢獻與授權](#貢獻與授權)

## 為什麼這個專案存在

Claude Code 已經公開了一套相對清晰的 auto memory 產品契約：

- AI 會自動寫 memory
- memory 以本地 Markdown 保存
- `MEMORY.md` 是啟動入口
- 啟動時只讀前 200 行
- 細節寫入 topic files，按需讀取
- 同一個倉庫的不同 worktree 共享 project memory
- `/memory` 可用來審查與編輯 memory

而今天的 Codex CLI 已經具備不少有價值的基礎能力，但尚未公開同等完整的 memory product surface：

- `AGENTS.md`
- multi-agent workflows
- 本地 persistent sessions / rollout logs
- 本地 `cam doctor` / feature output 中可見的 `memories`、`codex_hooks` signal

`codex-auto-memory` 的價值，就是在官方 native memory 還沒有穩定公開之前，先提供一條乾淨、可審計、companion-first 的路線，只保留一條狹窄的 compatibility seam。近期 UX 重點仍是持續收緊 `cam memory` / `cam session` 的 reviewer 體驗。

## 這個專案適合誰

適合：

- 想在 Codex 中獲得更接近 Claude-style auto memory 工作流的使用者
- 希望 memory 完全本地、完全可編輯、可以直接放進 Git 審查語境的團隊
- 需要在多個 worktree 之間共享 project memory，同時保留 worktree-local continuity 的工程流
- 希望未來即使官方 surface 變化，也不需要重建使用者心智模型的維護者

不適合：

- 想把它當作通用知識庫、筆記軟體或雲端同步服務的人
- 期待現階段直接替代 Claude `/memory` 全部互動能力的人
- 需要帳號級個人化記憶或跨裝置雲端記憶的人

## 核心能力

| 能力 | 說明 |
| :-- | :-- |
| 自動 memory 同步 | 會話結束後從 Codex rollout JSONL 中提取穩定、未來有用的資訊並寫回 Markdown memory |
| Markdown-first | `MEMORY.md` 與 topic files 就是產品表面，而不是內部快取 |
| 緊湊啟動注入 | 啟動時只注入真正進入 payload 的 quoted `MEMORY.md` startup files，並附帶按需 topic refs，不做 eager topic loading |
| worktree-aware | project memory 在同一個 git 倉庫的 worktree 間共享，project-local 仍保持隔離 |
| session continuity | 臨時 working state 與 durable memory 分層儲存、分層載入 |
| reviewer surface | `cam memory` / `cam session` / `cam audit` 為維護者與 reviewer 提供可核查的審查入口 |

## 能力對照

| 能力 | Claude Code | Codex today | Codex Auto Memory |
| :-- | :-- | :-- | :-- |
| 自動寫 memory | Built in | 沒有完整公開契約 | 透過 companion sync flow 提供 |
| 本地 Markdown memory | Built in | 沒有完整公開契約 | 支援 |
| `MEMORY.md` 啟動入口 | Built in | 沒有 | 支援 |
| 200 行啟動預算 | Built in | 沒有 | 支援 |
| topic files 按需讀取 | Built in | 沒有 | 部分支援，啟動時暴露 topic refs，供後續按需讀取 |
| 跨會話 continuity | 社群方案較多 | 沒有完整公開契約 | 作為獨立 companion layer 支援 |
| worktree 共享 project memory | Built in | 沒有公開契約 | 支援 |
| inspect / audit memory | `/memory` | 無等價命令 | `cam memory` |
| native hooks / memory | Built in | Experimental / under development | 目前只保留 compatibility seam |

`cam memory` 目前是 inspection / audit surface：它會暴露真正進入 startup payload 的 quoted startup files、startup budget、按需 topic refs、edit paths，以及 `--recent [count]` 下的 recent durable sync audit。<br />
recent durable sync audit 也會顯式暴露被保守 suppress 的 conflict candidates，避免在同一個 rollout 或和現有 durable memory 衝突時靜默 merge。<br />
如果主 memory 檔案已寫入，但 reviewer sidecar 沒有完整落盤，`cam memory` 會盡力暴露 pending sync recovery marker，幫助 reviewer 辨識 partial-success 狀態。

## 快速開始

### 1. Clone 並安裝

```bash
git clone https://github.com/Boulea7/Codex-Auto-Memory.git
cd Codex-Auto-Memory
pnpm install
```

### 2. 建構並連結全域命令

```bash
pnpm build
pnpm link --global
```

> 連結之後，`cam` 命令就可以在任何目錄使用。

### 3. 在你的專案裡初始化

```bash
cd /你的專案目錄
cam init
```

這會在專案根目錄產生 `codex-auto-memory.json`（追蹤到 Git），並在本地建立 `.codex-auto-memory.local.json`（預設 gitignored）。

### 4. 透過 wrapper 啟動 Codex

```bash
cam run
```

每次會話結束後，`cam` 會自動從 Codex rollout 日誌中提取資訊並寫入 memory 檔案。

### 5. 檢視 memory 狀態

```bash
cam memory
cam session status
cam session refresh
cam remember "Always use pnpm instead of npm"
cam forget "old debug note"
cam audit
```

## 常用命令

| 命令 | 作用 |
| :-- | :-- |
| `cam run` / `cam exec` / `cam resume` | 編譯 startup memory 並透過 wrapper 啟動 Codex |
| `cam sync` | 手動把最近 rollout 同步進 durable memory |
| `cam memory` | 檢視真正進入 startup payload 的 quoted startup files、按需 topic refs、startup budget、edit paths，以及 `--recent [count]` 下的 durable sync audit 與 suppressed conflict candidates |
| `cam remember` / `cam forget` | 顯式新增或刪除 memory |
| `cam session save` | merge / incremental save；從 rollout 增量寫入 continuity |
| `cam session refresh` | replace / clean regeneration；從選定 provenance 重新生成 continuity 並覆蓋所選 scope |
| `cam session load` / `status` | continuity reviewer surface；顯示 latest continuity diagnostics、latest audit drill-down、compact prior preview 與 pending continuity recovery marker |
| `cam session clear` / `open` | 清理 current active continuity，或打開 local continuity 目錄 |
| `cam audit` | 做倉庫級隱私 / secret hygiene 審查 |
| `cam doctor` | 檢查目前 companion wiring 與 native readiness posture |

## 工作方式

### 設計原則

- `local-first and auditable`
- `Markdown files are the product surface`
- `companion-first, with a narrow compatibility seam`
- `session continuity` 與 `durable memory` 明確分離

### 為什麼現在不直接切到 native memory

- 官方公開文件仍未給出完整、穩定、等價於 Claude Code 的 native memory 契約
- 本地 `cam doctor --json` 仍將 `memories` / `codex_hooks` 視為 readiness signal，而非 trusted primary path
- 因此專案預設仍堅持 companion-first，直到公開文件、執行時穩定性與 CI 可驗證性都足夠強

## 儲存布局

Durable memory：

```text
~/.codex-auto-memory/
├── global/
│   └── MEMORY.md
└── projects/<project-id>/
    ├── project/
    │   ├── MEMORY.md
    │   └── commands.md
    └── locals/<worktree-id>/
        ├── MEMORY.md
        └── workflow.md
```

Session continuity：

```text
~/.codex-auto-memory/projects/<project-id>/continuity/project/active.md
<project-root>/.codex-auto-memory/sessions/active.md
```

更完整的結構與邊界說明，請參考架構文件。

## 文件導航

- [文檔首頁（中文）](docs/README.md)
- [Documentation Hub (English)](docs/README.en.md)
- [Claude Code 參考契約（中文）](docs/claude-reference.md) | [English](docs/claude-reference.en.md)
- [架構設計（中文）](docs/architecture.md) | [English](docs/architecture.en.md)
- [Native migration 策略（中文）](docs/native-migration.md) | [English](docs/native-migration.en.md)
- [Session continuity 設計](docs/session-continuity.md)
- [Release checklist](docs/release-checklist.md)
- [Contributing](CONTRIBUTING.md)

## 目前狀態

- durable memory companion path：可用
- topic-aware startup lookup：可用
- session continuity companion layer：可用
- reviewer audit surfaces：可用
- tagged GitHub Releases：release workflow 已定義並以 tarball artifact 為目標；推送首個真實 tag 前，應先確認預設分支上的該 workflow 已啟用且可觀測；npm publish 仍保持手動流程
- native memory / native hooks primary path：未啟用，仍非 trusted implementation path

## 路線圖

### v0.1

- companion CLI
- Markdown memory store
- 200-line startup compiler
- worktree-aware project identity
- 初始 reviewer / maintainer 文件體系

### v0.2

- 更穩的 contradiction handling
- 更清楚的 `cam memory` / `cam session` 審查 UX
- continuity diagnostics 與 reviewer packet 持續收緊資訊層次，並顯式暴露 confidence / warnings
- release-facing 驗證持續收緊到 tarball install smoke，確保 `.tgz` 安裝後的 `cam` bin shim 可直接工作
- 繼續保留對未來 hook surface 的 compatibility seam

### v0.3+

- 持續追蹤官方 Codex memory / hooks surfaces，不預設主路徑變更
- 可選 GUI / TUI browser
- 更強的跨會話 diagnostics 與 confidence surfaces

## 貢獻與授權

- 貢獻指南：[CONTRIBUTING.md](./CONTRIBUTING.md)
- License：[Apache-2.0](./LICENSE)

如果你在 README、官方文件與本地執行時觀察之間發現衝突，請優先相信：

1. 官方產品文件
2. 可重現的本地行為
3. 對不確定性的明確說明

而不是更自信但證據不足的表述。
