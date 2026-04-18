# Codex Auto Memory

> Codex が次の会話でもプロジェクト文脈を持ち続けられるようにしつつ、記憶は手元の Markdown に残します。

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` は、Codex がプロジェクト文脈、好み、重要な判断を会話をまたいで引き継げるようにしつつ、`MEMORY.md` や topic files をローカルに残します。追加サービスや database に頼らず、チーム自身で読んで直せる形を保ちたいときのためのツールです。

## 使う理由

- Codex セッションから将来も使える知識を抽出し、次の会話へ戻せます。
- `MEMORY.md` と topic files を、読めて編集できる source file として維持します。
- `cam memory`、`cam recall`、`cam session` で、日々の作業に戻す前に内容を確認できます。

## 前提

- `Node 20+`
- source install では `pnpm` が必要です

## Install

### npm

これが最短の install path です。

```bash
npm install --global codex-auto-memory
```

### GitHub Release tarball

バージョンを固定した release artifact を入れたい場合はこちらです。

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

### Build from source

リポジトリ自体を触る場合やローカル実行をしたい場合はこちらです。

```bash
pnpm install
pnpm build
pnpm link --global
```

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
- [Architecture overview (English)](./docs/architecture.en.md)
- [Session continuity (English)](./docs/session-continuity.md)
- [Release checklist (English)](./docs/release-checklist.md)

## コミュニティとリポジトリ運用

- [SUPPORT.md](./SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [Issue Chooser](https://github.com/Boulea7/Codex-Auto-Memory/issues/new/choose)

## 現在の位置づけ

このリポジトリは引き続き Codex-first、Markdown-first のローカル memory tool です。詳細な統合境界、ホスト差分、移行メモは documentation hub にまとめています。

## ライセンス

[Apache-2.0](./LICENSE)
