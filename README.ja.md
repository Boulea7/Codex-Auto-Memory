# Codex Auto Memory

> Codex 向けの Markdown-first ローカル memory runtime。

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` は、durable memory をローカル Markdown に保存し、session continuity、reviewer surface、MCP / hooks / skills の統合を 1 つの監査可能な workflow にまとめます。Codex にプロジェクト文脈を跨会話で持たせたいが、canonical source of truth を database に移したくない場面向けです。

## 使う理由

- Codex セッションから将来も使える知識を抽出し、次の会話へ戻せます。
- `MEMORY.md` と topic files を、読めて編集できる source of truth として維持します。
- wrapper、CLI、MCP、skills、hooks のあいだで同じ reviewer-friendly な memory contract を保ちます。

## 前提

- `Node 20+`
- source install では `pnpm` が必要です

## Install

### GitHub Release tarball

今の標準 install path です。

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

### Build from source

```bash
pnpm install
pnpm build
pnpm link --global
```

### npm

最初の公開 npm release 後に使用します。

```bash
npm install --global codex-auto-memory
```

`codex-auto-memory` はまだ npm registry で公開されていないため、今の install path は GitHub Release tarball か source install が正しい案内です。release workflow には将来の npm publish も残していますが、今回の `0.1.1` は GitHub Release tarball を公開 install の基準にします。

## 最初のコマンド

```bash
cam init
cam run
```

install 後によく使う inspection command:

```bash
cam memory
cam recall search "<query>"
cam session status
cam remember "<memory>"
cam forget "<memory>" --archive
```

## ドキュメント

- [ドキュメントハブ（日本語）](./docs/README.ja.md)
- [Architecture (English)](./docs/architecture.en.md)
- [Session continuity (English)](./docs/session-continuity.md)
- [Release checklist (English)](./docs/release-checklist.md)

## コミュニティとリポジトリ運用

- [SUPPORT.md](./SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [Issue Chooser](https://github.com/Boulea7/Codex-Auto-Memory/issues/new/choose)

## 現在の位置づけ

このリポジトリは引き続き Codex-first、Markdown-first、wrapper-first です。詳細な能力境界、宿主差分、移行メモは landing page ではなく documentation hub にまとめています。

## ライセンス

[Apache-2.0](./LICENSE)
