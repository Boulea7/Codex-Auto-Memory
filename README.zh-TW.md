# Codex Auto Memory

> 面向 Codex 的 Markdown-first 本地記憶運行層。

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` 以本地 Markdown 保存 durable memory，並把 session continuity、reviewer surface、MCP / hooks / skills 整合到同一條可審計工作流中。現在最成熟的主入口仍是 `cam run` wrapper，但倉庫方向已正式擴展到更低摩擦的整合接入。

## 為什麼用它

- 從 Codex 會話中提取未來仍然有用的知識，並在後續會話中帶回來。
- 讓 `MEMORY.md` 與 topic files 保持可讀、可改、可審計，而不是把真相藏進資料庫。
- 在 wrapper、CLI、MCP、skills、hooks 之間維持同一套 reviewer-friendly memory contract。

## 你會得到什麼

- 自動 durable memory sync 與 startup recall。
- 分層的 session continuity 與 durable memory 儲存。
- `cam memory`、`cam recall`、`cam session`、`cam audit` 這組檢查入口。
- 面向 Codex 的 project-scoped MCP / integration 安裝與診斷命令。

## 快速開始

1. 原始碼安裝並建構：

```bash
pnpm install
pnpm build
pnpm link --global
```

2. 使用 GitHub Release tarball 安裝：

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

3. npm 安裝命令（首次公開 npm 發佈之後才能使用）：

```bash
npm install --global codex-auto-memory
```

推送 `v<package.json.version>` tag 會觸發自動發佈流程：workflow 會先驗證、打包同一份 release tarball，再把這一個 tarball 同時掛到 GitHub Release，並在倉庫已設定 `NPM_TOKEN` 時用它執行 `npm publish --provenance --access public`。但 `codex-auto-memory` 這個套件名稱目前還沒有公開出現在 npm registry，所以現在正確可用的打包安裝路徑仍是原始碼安裝或 GitHub Release tarball；上面的 npm 命令留給第一次公開 npm 發佈之後再使用。

4. 在目標專案中初始化：

```bash
cam init
```

5. 透過 wrapper 啟動 Codex：

```bash
cam run
```

6. 檢視或修正記憶：

```bash
cam memory
cam recall search "<query>"
cam session status
cam remember "<memory>"
cam forget "<memory>" --archive
```

## 文件導航

- [文件中心（繁體中文）](./docs/README.zh-TW.md)
- [架構設計（简体中文）](./docs/architecture.md)
- [整合演進策略（简体中文）](./docs/integration-strategy.md)
- [宿主能力面（简体中文）](./docs/host-surfaces.md)
- [Session continuity（English）](./docs/session-continuity.md)
- [Release checklist（English）](./docs/release-checklist.md)

## 社群與倉庫健康

- [SUPPORT.md](./SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [Issue Templates](./.github/ISSUE_TEMPLATE/config.yml)

## 當前狀態

這個倉庫目前仍以 Codex-first、Markdown-first、wrapper-first 為主，不把自己描述成通用知識庫產品，也不把多宿主統一平台直接塞進主倉。更細的能力邊界、宿主差異與遷移說明，現在都收斂到文件中心，而不是堆在 landing page。

## 授權

[Apache-2.0](./LICENSE)
