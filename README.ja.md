<div align="center">
  <h1>Codex Auto Memory</h1>
  <p><strong>Codex 向けに Claude-style auto memory ワークフローを再現する local-first companion CLI</strong></p>
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

> `codex-auto-memory` は汎用メモアプリでもクラウド型メモリサービスでもありません。<br />
> 現在の Codex CLI に対して、ローカル Markdown、コンパクトな startup injection、必要時のみの topic file 読み出し、そして companion runtime を使い、Claude Code auto memory の観測可能な契約をできるだけ再現することが目的です。

---

**まず押さえるべき 3 点**

1. **何をするか**：Codex セッション終了後に有用な情報を抽出し、ローカル Markdown に書き戻します。次回起動時にそれを注入し、Codex がプロジェクトを「覚えている」状態を作ります。
2. **どう保存するか**：すべて `~/.codex-auto-memory/` 配下の Markdown です。いつでも閲覧・編集でき、Git レビューにも載せられます。
3. **Claude との関係**：これは companion CLI です。Codex 上で Claude Code auto memory の作業感を再現するためのもので、Anthropic の公式製品でもクラウド機能でもありません。

---

## 目次

- [このプロジェクトが存在する理由](#このプロジェクトが存在する理由)
- [どんな人向けか](#どんな人向けか)
- [主要機能](#主要機能)
- [機能比較](#機能比較)
- [クイックスタート](#クイックスタート)
- [主要コマンド](#主要コマンド)
- [仕組み](#仕組み)
- [保存レイアウト](#保存レイアウト)
- [ドキュメント案内](#ドキュメント案内)
- [現在の状態](#現在の状態)
- [ロードマップ](#ロードマップ)
- [コントリビュートとライセンス](#コントリビュートとライセンス)

## このプロジェクトが存在する理由

Claude Code には比較的明確な auto memory 契約があります。

- AI が memory を自動で書く
- memory はローカル Markdown で保存される
- `MEMORY.md` が起動時の入口になる
- 起動時に読むのは先頭 200 行だけ
- 詳細は topic files に分かれ、必要になった時だけ読む
- 同じリポジトリの worktree 間で project memory を共有する
- `/memory` で監査・編集できる

一方で現在の Codex CLI には便利な基盤はあるものの、同等に完成した public memory surface はまだありません。

- `AGENTS.md`
- multi-agent workflows
- local persistent sessions / rollout logs
- `cam doctor` や feature output で見える `memories` / `codex_hooks` signal

そこで `codex-auto-memory` は、native memory を既成事実にせず、companion-first で監査しやすいルートを提供します。現在の UX 改善は `cam memory` と `cam session` の reviewer surface をより分かりやすくすることに集中しています。

## どんな人向けか

向いている人：

- 今すぐ Codex で Claude-style auto memory に近い体験がほしい人
- memory を完全にローカル・可編集・監査可能な Markdown で持ちたいチーム
- worktree 間で project memory を共有しつつ、worktree-local continuity も分けたい人
- 将来 Codex の公式 surface が変わっても、ユーザーの mental model を壊したくないメンテナ

向いていない人：

- 汎用ナレッジベースやメモアプリを求めている人
- 現時点で Claude `/memory` の完全な操作性を期待している人
- アカウント単位やクラウド同期型の記憶が必要な人

## 主要機能

| 機能 | 説明 |
| :-- | :-- |
| 自動 memory 同期 | Codex rollout JSONL から将来も有用な知識を抽出し、Markdown memory に書き戻す |
| Markdown-first | `MEMORY.md` と topic files 自体がプロダクト surface であり、隠れたキャッシュではない |
| コンパクトな起動注入 | 実際に payload に入った quoted `MEMORY.md` startup files と on-demand topic refs のみを注入し、topic body を eager load しない |
| worktree-aware | project memory を worktree 間で共有しつつ、local continuity は分離する |
| session continuity | 一時的な作業状態を durable memory から分離して扱う |
| reviewer surface | `cam memory`、`cam session`、`cam audit` で review・監査しやすい surface を提供する |

## 機能比較

| 機能 | Claude Code | 現在の Codex | Codex Auto Memory |
| :-- | :-- | :-- | :-- |
| memory の自動書き込み | Built in | 完全な公開契約は未整備 | companion sync flow で提供 |
| ローカル Markdown memory | Built in | 完全な公開契約は未整備 | 対応 |
| `MEMORY.md` 起動入口 | Built in | なし | あり |
| 200 行の起動予算 | Built in | なし | あり |
| topic files の必要時読込 | Built in | なし | 部分対応 |
| セッション continuity | コミュニティ解法が多い | 完全な公開契約は未整備 | 独立した companion layer として対応 |
| worktree 間の project memory 共有 | Built in | 公開契約なし | 対応 |
| inspect / audit memory | `/memory` | 相当コマンドなし | `cam memory` |
| native hooks / memory | Built in | Experimental / under development | compatibility seam のみ保持 |

`cam memory` は inspection / audit surface として設計されています。<br />
実際に startup payload に入った quoted startup files、startup budget、on-demand topic refs、edit paths、さらに `--recent [count]` の recent durable sync audit を表示します。<br />
recent sync audit では、保守的に suppress された conflict candidates も reviewer-visible に保持され、矛盾する rollout 出力が silent merge されないようになっています。

## クイックスタート

### 1. Clone とインストール

```bash
git clone https://github.com/Boulea7/Codex-Auto-Memory.git
cd Codex-Auto-Memory
pnpm install
```

### 2. ビルドしてグローバルコマンドをリンク

```bash
pnpm build
pnpm link --global
```

> これで `cam` コマンドを任意のディレクトリから使えます。

### 3. プロジェクト内で初期化

```bash
cd /your/project
cam init
```

これにより、プロジェクトルートに `codex-auto-memory.json` が作成され、ローカル専用の `.codex-auto-memory.local.json` も生成されます。

### 4. wrapper 経由で Codex を起動

```bash
cam run
```

各セッション終了後、`cam` が rollout ログから情報を抽出し、memory ファイルへ自動で書き込みます。

### 5. 状態を確認

```bash
cam memory
cam session status
cam session refresh
cam remember "Always use pnpm instead of npm"
cam forget "old debug note"
cam audit
```

## 主要コマンド

| コマンド | 用途 |
| :-- | :-- |
| `cam run` / `cam exec` / `cam resume` | startup memory を組み立て、wrapper 経由で Codex を起動 |
| `cam sync` | 最新 rollout を durable memory に手動同期 |
| `cam memory` | quoted startup files、on-demand topic refs、startup budget、edit paths、suppressed conflict candidates を含む durable sync audit を確認 |
| `cam remember` / `cam forget` | durable memory を明示的に追加・削除 |
| `cam session save` | merge / incremental save |
| `cam session refresh` | replace / clean regeneration |
| `cam session load` / `status` | continuity reviewer surface |
| `cam session clear` / `open` | active continuity を消す、または local continuity ディレクトリを開く |
| `cam audit` | privacy / secret hygiene チェック |
| `cam doctor` | companion wiring と native readiness posture を確認 |

## 仕組み

### 設計原則

- `local-first and auditable`
- `Markdown files are the product surface`
- `companion-first, with a narrow compatibility seam`
- `session continuity` と `durable memory` は明確に分離

### なぜ今すぐ native memory に切り替えないのか

- 公開された Codex ドキュメントは、Claude Code 相当の完全で安定した native memory 契約をまだ定義していない
- ローカルの `cam doctor --json` でも、`memories` / `codex_hooks` は readiness signal として見えているだけで trusted primary path ではない
- そのため、公開ドキュメント・実行時安定性・CI での検証可能性が揃うまでは companion-first を維持する

## 保存レイアウト

Durable memory:

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

Session continuity:

```text
~/.codex-auto-memory/projects/<project-id>/continuity/project/active.md
<project-root>/.codex-auto-memory/sessions/active.md
```

詳細は architecture doc を参照してください。

## ドキュメント案内

- [文档首页（中文）](docs/README.md)
- [Documentation Hub (English)](docs/README.en.md)
- [Claude reference contract (中文)](docs/claude-reference.md) | [English](docs/claude-reference.en.md)
- [Architecture (中文)](docs/architecture.md) | [English](docs/architecture.en.md)
- [Native migration strategy (中文)](docs/native-migration.md) | [English](docs/native-migration.en.md)
- [Session continuity design](docs/session-continuity.md)
- [Release checklist](docs/release-checklist.md)
- [Contributing](CONTRIBUTING.md)

## 現在の状態

- durable memory companion path: available
- topic-aware startup lookup: available
- session continuity companion layer: available
- reviewer audit surfaces: available
- tagged GitHub Releases: release workflow は tarball artifact を対象として定義済み。最初の real tag を push する前に、default branch 上でその workflow が表示され、active になっていることを確認してください。npm publish は引き続き手動です
- native memory / native hooks primary path: not enabled and not trusted as the main implementation path

## ロードマップ

### v0.1

- companion CLI
- Markdown memory store
- 200-line startup compiler
- worktree-aware project identity
- 初期の maintainer / reviewer docs

### v0.2

- より堅い contradiction handling
- `cam memory` と `cam session` の reviewer UX 改善
- continuity diagnostics と reviewer packet の整理、`confidence` / warnings の明示
- tarball install smoke を含む release-facing 検証の強化
- 将来の hook surface に備えた compatibility seam の維持

### v0.3+

- 公式 Codex memory / hooks surface を継続的に追跡
- optional GUI / TUI browser
- より強い cross-session diagnostics と confidence surface

## コントリビュートとライセンス

- Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- License: [Apache-2.0](./LICENSE)

README、公式ドキュメント、ローカル実行結果のあいだで食い違いを見つけた場合は、次の順で信頼してください。

1. 公式プロダクトドキュメント
2. 再現可能なローカル挙動
3. 不確実性を明示した記述

根拠の弱い断定より、確認可能な証拠を優先してください。
