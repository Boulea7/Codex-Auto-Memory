# Codex Auto Memory

> Codex 向けの Markdown-first ローカル memory runtime。

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

`codex-auto-memory` は、durable memory をローカル Markdown に保存し、session continuity、reviewer surface、MCP / hooks / skills の統合を 1 つの監査可能な workflow にまとめるためのプロジェクトです。現時点でもっとも安定している入口は `cam run` wrapper ですが、今後はより低摩擦な統合経路も正式な方向として扱います。

## 使う理由

- Codex セッションから将来も使える知識を抽出し、次の会話へ戻せます。
- `MEMORY.md` と topic files を、読めて編集できる source of truth として維持します。
- wrapper、CLI、MCP、skills、hooks のあいだで同じ reviewer-friendly な memory contract を保ちます。

## できること

- durable memory の自動 sync と startup recall。
- session continuity と durable memory の分離管理。
- `cam memory`、`cam recall`、`cam session`、`cam audit` による確認。
- Codex 向けの project-scoped MCP / integration install と doctor。

## クイックスタート

1. source install と build:

```bash
pnpm install
pnpm build
pnpm link --global
```

2. GitHub Release tarball から install:

```bash
curl -LO https://github.com/Boulea7/Codex-Auto-Memory/releases/download/v<version>/codex-auto-memory-<version>.tgz
npm install --global ./codex-auto-memory-<version>.tgz
```

3. npm install command（最初の公開 npm release 後に使用）:

```bash
npm install --global codex-auto-memory
```

`v<package.json.version>` tag を push すると自動 publish workflow が動き、同じ release tarball を検証・生成したうえで GitHub Release に添付し、repository に `NPM_TOKEN` が設定されている場合はその同じ `.tgz` を `npm publish --provenance --access public` に使います。ただし `codex-auto-memory` はまだ npm registry で公開されていないため、今の packaged install は GitHub Release tarball が正しい案内です。上の npm command は最初の公開 npm release 後の導線として残しています。

4. 対象プロジェクトで初期化:

```bash
cam init
```

5. wrapper 経由で Codex を起動:

```bash
cam run
```

6. memory を確認または修正:

```bash
cam memory
cam recall search "<query>"
cam session status
cam remember "<memory>"
cam forget "<memory>" --archive
```

## ドキュメント

- [Documentation hub (日本語 index)](./docs/README.ja.md)
- [Architecture (English)](./docs/architecture.en.md)
- [Integration strategy (中文)](./docs/integration-strategy.md)
- [Host surfaces (中文)](./docs/host-surfaces.md)
- [Session continuity (English)](./docs/session-continuity.md)
- [Release checklist (English)](./docs/release-checklist.md)

## コミュニティとリポジトリ運用

- [SUPPORT.md](./SUPPORT.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [Issue Templates](./.github/ISSUE_TEMPLATE/config.yml)

## 現在の位置づけ

このリポジトリは引き続き Codex-first、Markdown-first、wrapper-first です。Codex 以外の host は現時点では manual-only / snippet-first の案内にとどまります。汎用ナレッジベース製品でも、多宿主統合プラットフォームの本体でもありません。詳細な能力境界、宿主差分、移行メモは landing page ではなく documentation hub にまとめています。

## ライセンス

[Apache-2.0](./LICENSE)
