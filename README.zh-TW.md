# Codex Auto Memory

> 讓 Codex 在後續會話裡延續專案上下文，同時把記憶保留在你能直接查看與編輯的 Markdown 中。

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` 讓 Codex 在跨會話協作裡繼續帶著專案上下文、偏好與關鍵決策工作，同時把 `MEMORY.md`、topic files 與相關檢查入口保留在本地。你不需要額外資料庫，也不必把「記憶」交給看不見的黑盒。

## 為什麼用它

- 從 Codex 會話中提取未來仍然有用的知識，並在後續會話中帶回來。
- 讓 `MEMORY.md` 與 topic files 保持可讀、可改、可審計。
- 透過 `cam memory`、`cam recall`、`cam session` 先檢查要帶回工作流的內容。

## 安裝前提

- `Node 20+`
- 原始碼安裝路徑需要 `pnpm`

## 安裝

### npm

這是最省事的安裝方式：

```bash
npm install --global codex-auto-memory
```

### GitHub Release tarball

如果你想安裝指定版本的打包產物，使用 GitHub Release tarball：

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

### 原始碼安裝並建構

如果你要修改原始碼，或想直接從倉庫本地執行：

```bash
pnpm install
pnpm build
pnpm link --global
```

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
- [架構概覽（English / 简体中文）](./docs/architecture.en.md)
- [Session continuity（English）](./docs/session-continuity.md)
- [Release checklist（English）](./docs/release-checklist.md)

## 社群與倉庫健康

- [SUPPORT.md](./SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [Issue Chooser](https://github.com/Boulea7/Codex-Auto-Memory/issues/new/choose)

## 當前狀態

這個倉庫目前仍以 Codex-first、Markdown-first 的本地記憶工具為主。更細的整合邊界、宿主差異與遷移說明，現在都收在文件中心。

## 授權

[Apache-2.0](./LICENSE)
