# Codex Auto Memory

> 面向 Codex 的 Markdown-first 本地記憶運行層。

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` 以本地 Markdown 保存 durable memory，並把 session continuity、reviewer surface、MCP / hooks / skills 整合到同一條可審計工作流中。它適合希望讓 Codex 在跨會話協作裡保留專案上下文、偏好與決策線索，但又不想把 canonical truth 搬進資料庫的團隊。

## 為什麼用它

- 從 Codex 會話中提取未來仍然有用的知識，並在後續會話中帶回來。
- 讓 `MEMORY.md` 與 topic files 保持可讀、可改、可審計，而不是把真相藏進資料庫。
- 在 wrapper、CLI、MCP、skills、hooks 之間維持同一套 reviewer-friendly memory contract。

## 安裝前提

- `Node 20+`
- 原始碼安裝路徑需要 `pnpm`

## 安裝

### GitHub Release tarball

這是目前預設的打包安裝路徑。

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

### 原始碼安裝並建構

```bash
pnpm install
pnpm build
pnpm link --global
```

### npm

首次公開 npm 發佈之後才能使用：

```bash
npm install --global codex-auto-memory
```

`codex-auto-memory` 這個套件名稱目前還沒有公開出現在 npm registry，所以現在正確可用的安裝路徑仍是 GitHub Release tarball 或原始碼安裝。release workflow 會保留未來的 npm publish 路線，但這輪 `0.1.1` 的公開安裝標準仍以 GitHub Release tarball 為準。

## 第一個命令

```bash
cam init
cam run
```

安裝完成後，最常用的檢查命令是：

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
- [Session continuity（English）](./docs/session-continuity.md)
- [Release checklist（English）](./docs/release-checklist.md)

## 社群與倉庫健康

- [SUPPORT.md](./SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [Issue Chooser](https://github.com/Boulea7/Codex-Auto-Memory/issues/new/choose)

## 當前狀態

這個倉庫目前仍以 Codex-first、Markdown-first、wrapper-first 為主。更細的能力邊界、宿主差異與遷移說明，現在都收斂到文件中心，而不是堆在首頁。

## 授權

[Apache-2.0](./LICENSE)
