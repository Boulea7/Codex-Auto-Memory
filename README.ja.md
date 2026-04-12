<div align="center">
  <h1>Codex Auto Memory</h1>
  <p><strong>Codex 向けの Markdown-first ローカル memory runtime。companion CLI から Codex-first Hybrid memory system へ進化中</strong></p>
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

> `codex-auto-memory` は汎用ノートアプリでもクラウド記憶サービスでもありません。  
> これは Markdown-first / local-first の Codex 向け memory runtime です。現時点で最も成熟している入口は wrapper と CLI ですが、今後は hook・skill・MCP を取り込んだ低摩擦な統合面へ正式に進化していきます。

---

**最初に知っておくべき 3 点**

1. **何をするか**: Codex セッションから将来も使える知識を抽出し、ローカル Markdown に保存し、次回以降の会話で再利用します。
2. **どう保存するか**: `MEMORY.md` と topic files を中心とした Markdown が主表面であり、隠れた DB やキャッシュを主真相にはしません。
3. **どこへ向かうか**: 現在も Codex-first ですが、今後は companion CLI に閉じず、**Codex-first Hybrid memory system** を正式な方向として扱います。

---

## 目次

- [なぜこのプロジェクトがあるのか](#なぜこのプロジェクトがあるのか)
- [誰に向いているか](#誰に向いているか)
- [現在の優先目標](#現在の優先目標)
- [コア機能](#コア機能)
- [機能比較](#機能比較)
- [クイックスタート](#クイックスタート)
- [主要コマンド](#主要コマンド)
- [動作の仕組み](#動作の仕組み)
- [保存レイアウト](#保存レイアウト)
- [ドキュメント案内](#ドキュメント案内)
- [現在の状態](#現在の状態)
- [ロードマップ](#ロードマップ)
- [コントリビュートとライセンス](#コントリビュートとライセンス)

## なぜこのプロジェクトがあるのか

Claude Code はすでに比較的はっきりした auto memory 契約を公開しています。

- AI が memory を自動で書く
- memory はローカル Markdown に保存される
- `MEMORY.md` が起動時のエントリポイントになる
- 起動時は先頭 200 行だけ読む
- 詳細は topic files に分けて必要時に読む
- 同じリポジトリの worktree 間で project memory を共有する
- `/memory` で監査と編集ができる

一方、Codex は有用な基礎能力を持ちながらも、完全で安定したローカル memory product surface をまだ公開していません。

- `AGENTS.md`
- multi-agent workflows
- local sessions と rollout logs
- 拡張されつつある MCP / skills / subagents 面
- `cam doctor` や feature output に見える `memories` / `codex_hooks` signal

`codex-auto-memory` はそのギャップを埋めるために存在します。Codex-first の現実に合わせて、ローカルで監査可能・編集可能な Markdown memory を主契約として維持しつつ、将来的には hook・skill・MCP などの統合面でも同じ記憶契約を使えるように進化させていく、という立ち位置です。

## 誰に向いているか

向いている人:

- Codex で Claude-style auto memory に近い体験を今すぐ使いたい人
- 記憶を完全にローカル・監査可能・編集可能な Markdown で管理したいチーム
- いまは CLI/workflow を使い、将来はもっと自動化された統合面も使いたい人
- 公式 surface が変わってもユーザーの心象を大きく変えたくない保守者

向いていない人:

- 汎用ナレッジベースやノートアプリを探している人
- アカウント単位のクラウド記憶が必要な人
- 今日の時点で Claude `/memory` と同等の完全な対話面を期待する人

## 現在の優先目標

今の最重要目標は、以下の 4 つを製品として明確に満たすことです。

1. 対話やタスクから再利用可能な長期記憶を自動で抽出すること
2. その記憶を後続セッションで自動的に呼び戻すこと
3. 更新・重複排除・上書き・アーカイブを含む記憶ライフサイクルを持つこと
4. 手動で memory ファイルを保守する負担を減らすこと

## コア機能

| 機能 | 説明 |
| :-- | :-- |
| 自動 post-session sync | Codex rollout JSONL から安定した知識を抽出し durable Markdown memory に書き戻す |
| 自動 startup recall | 緊凑な startup memory を組み立て、後続セッションへ durable knowledge を戻す。現在は少量の active-only content highlights と按需 topic refs も含める |
| Markdown-first | `MEMORY.md` と topic files が主表面であり、二次的な導出物ではない |
| 記憶ライフサイクル | 明示的な訂正、重複排除、上書き、削除、reviewer 可視の conflict suppression に対応 |
| formal retrieval MCP surface | `cam mcp serve` が `search_memories` / `timeline_memories` / `get_memory_details` を read-only な stdio MCP surface として公開する |
| project-scoped MCP install surface | `cam mcp install --host codex` が推奨される Codex project-scoped 宿主設定を書き込み、MCP 配線の摩擦を下げる。非 Codex 宿主 wiring は境界化された接続面として `docs/host-surfaces.md` に集約する |
| worktree-aware | 同一 git リポジトリ内の worktree で project memory を共有しつつ local continuity は分離する |
| session continuity | 一時的な working state と durable memory を分離して扱う |
| integration-aware evolution | wrapper 主導の現在地を保ちつつ、hook / skill / MCP 統合へ正式に進む |
| reviewer surface | `cam memory` / `cam session` / `cam recall` / `cam audit` による監査入口を提供する |

## 機能比較

| 機能 | Claude Code | Codex today | Codex Auto Memory |
| :-- | :-- | :-- | :-- |
| 自動 memory 書き込み | Built in | 完全な公開契約なし | rollout-driven sync で対応 |
| ローカル Markdown memory | Built in | 完全な公開契約なし | 対応 |
| `MEMORY.md` 起動エントリ | Built in | なし | 対応 |
| 200 行起動予算 | Built in | なし | 対応 |
| topic files の遅延読込 | Built in | なし | 一部対応。起動時に refs を公開し、後で必要時に読む |
| session continuity | Community patterns | 完全な公開契約なし | 独立 layer として対応 |
| worktree 共有 project memory | Built in | 公開契約なし | 対応 |
| inspect / audit memory | `/memory` | 同等コマンドなし | `cam memory` |
| hook / skill / MCP-aware evolution | Built in または宿主能力が強い | 新興で不均一 | 公式方向として採用済み |

`cam memory` は今後も reviewer-oriented な surface のままです。実際に startup payload に入った quoted startup files、startup budget、topic refs、edit paths、さらに `--recent [count]` で durable sync audit を見せます。

audit では保守的に suppress された conflict candidates も明示され、矛盾する rollout 出力が durable memory に静かに混ざらないようにします。将来 hook / skill / MCP の経路が増えても、同じ Markdown-first かつ監査可能な memory 契約を保つ前提です。

## クイックスタート

### 1. Clone と install

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

### 3. プロジェクトで初期化

```bash
cd /your/project
cam init
```

`codex-auto-memory.json` がプロジェクトに作成され、ローカル用に `.codex-auto-memory.local.json` が作られます。

### 4. wrapper 経由で Codex を起動

```bash
cam run
```

これが現在もっとも成熟しているエンドツーエンド経路です。セッション終了後、`cam` は rollout ログから知識を抽出して memory に反映します。

### 5. memory を確認・修正

```bash
cam memory
cam memory reindex --scope all --state all
cam recall search pnpm --state auto
cam mcp serve
cam integrations install --host codex
cam integrations apply --host codex
cam integrations doctor --host codex
cam mcp install --host codex
cam mcp print-config --host codex
cam mcp apply-guidance --host codex
cam mcp doctor
cam session status
cam session refresh
cam remember "Always use pnpm instead of npm"
cam forget "old debug note"
cam forget "old debug note" --archive
cam audit
```

## 主要コマンド

| コマンド | 役割 |
| :-- | :-- |
| `cam run` / `cam exec` / `cam resume` | startup memory を生成して wrapper 経由で Codex を起動 |
| `cam sync` | 最新 rollout を durable memory に手動同期 |
| `cam memory` | startup files、topic refs、startup highlights、highlight budget / section render 状態、edit paths、recent sync audit、suppressed conflict candidates を確認する。`--cwd <path>` により別の project root を明示的に対象化できる。durable memory layout が未初期化のときは `MEMORY.md`、`ARCHIVE.md`、retrieval sidecar を暗黙生成せず、空の inspect view を返す。`--json` では `highlightCount`、`omittedHighlightCount`、`omittedTopicFileCount`、`highlightsByScope`、`startupSectionsRendered`、`startupOmissions`、`startupOmissionCounts`、`startupOmissionCountsByTargetAndStage`、`topicFileOmissionCounts`、`topicRefCountsByScope` に加えて、reviewer-visible な `topicDiagnostics` / `layoutDiagnostics` も返し、selection-stage・render-stage・canonical layout anomaly を区別できる |
| `cam memory reindex` | canonical Markdown から retrieval sidecar を明示的に再構築する。`--scope`、`--state`、`--cwd`、`--json` をサポートし、sidecar が missing / invalid / stale のときの低摩擦な repair path を提供する。durable memory layout が未初期化のときは layout を暗黙生成せず、空の `rebuilt` 結果を返す |
| `cam remember` / `cam forget` | durable memory の明示的な追加・削除。両方とも `--cwd <path>` をサポートし、別の project root を明示的に対象化できる。`cam forget --archive` は一致した項目をアーカイブ層へ移動する。`forget` は `recall search` と同じ多語 query 正規化も共有するようになり、`pnpm npm` のような query でも元の substring が連続していなくても `summary/details` をまたいで 1 件の memory に命中できる。両方とも `--json` をサポートし、`mutationKind`、`matchedCount`、`appliedCount`、`noopCount`、`summary`、`primaryEntry`、`entries[]`、`followUp`、`nextRecommendedActions`、そして少なくとも 1 件ヒットしたときにだけ出るトップレベルの lifecycle/detail フィールド（`latestAppliedLifecycle`、`latestLifecycleAttempt`、`latestLifecycleAction`、`latestState`、`latestSessionId`、`latestRolloutPath`、`latestAudit`、`timelineWarningCount`、`warnings`、`entry`、`lineageSummary`、`ref/path/historyPath`）を含む manual mutation reviewer payload を返す。さらに `leadEntryRef`、`leadEntryIndex`、`detailsAvailable`、`reviewRefState`、`uniqueAuditCount`、`auditCountsDeduplicated`、`warningsByEntryRef` も返す。空の `forget --json` は additive な空 payload のままで、`nextRecommendedActions` も空配列を返し、占位 `"<ref>"` は出さない。delete フローでは timeline-only と details-usable の review route も分けて返す。テキスト出力でも project-pinned な `timeline/details -> recent -> reindex` の follow-up を直接案内するようになった |
| `cam recall search` / `timeline` / `details` | `search -> timeline -> details` の progressive disclosure workflow で durable memory を段階的に取得する。`search` は `state=auto, limit=8` を既定値として使い、active を先に調べてヒットしなければ archived にフォールバックしつつ read-only を保つ。複数語の query は `id/topic/summary/details` をまたいで集約マッチするようになり、すべての term が同一 field にある必要はない。JSON ではさらに `retrievalMode`、`finalRetrievalMode`、`retrievalFallbackReason`、`stateResolution`、`executionSummary`、`searchOrder`、`totalMatchedCount`、`returnedCount`、`globalLimitApplied`、`truncatedCount`、`resultWindow`、`globalRank`、`diagnostics.checkedPaths[].returnedCount` / `droppedCount` を返し、fallback、global sorting、post-limit の挙動を reviewer-visible にする |
| `cam mcp serve` | `search_memories` / `timeline_memories` / `get_memory_details` を通じて同じ retrieval contract を公開する read-only MCP server を起動する |
| `cam integrations install --host codex` | 推奨される Codex integration stack を一度に導入し、project-scoped MCP wiring を書き込みつつ、hook bridge bundle と Codex skill assets を更新する。skills は runtime target が既定だが、`--skill-surface runtime|official-user|official-project` も指定できる。明示的・冪等・Codex-only を保ち、`AGENTS.md` と Markdown memory store には触れない。さらに staged install の途中で失敗した場合は、MCP / hooks / skills の書き込みを rollback し、`--json` では構造化された rollback failure payload も返す。導入後は `cam integrations doctor --host codex` に戻り、現在の環境で本当に operational な retrieval route を確認する |
| `cam integrations apply --host codex` | 明示的・冪等・Codex-only のまま完全な integration state を適用する。`integrations install` の既存境界は変えず、その上で `cam mcp apply-guidance --host codex` も編成する。skills は runtime target が既定だが、`--skill-surface runtime|official-user|official-project` も指定できる。`AGENTS.md` managed block が unsafe な場合は、stack への書き込み前に preflight `blocked` を返す。apply 後も `doctor` に戻り、実際に有効なのが MCP、local bridge、resolved CLI のどれかを確認する必要がある |
| `cam integrations doctor --host codex` | 現在の Codex integration stack を薄い read-only 集約面として点検し、推奨ルートと現在の route truth（`recommendedRoute`、`currentlyOperationalRoute`、`routeKind`、`routeEvidence`、`shellDependencyLevel`、`hostMutationRequired`、`preferredRouteBlockers`、`currentOperationalBlockers`）、推奨 preset、構造化された `workflowContract`、`applyReadiness`、`experimentalHooks`、`layoutDiagnostics`、サブチェック結果、次の最小アクションを返す。`recommendedRoute` は MCP-first のまま維持され、blocker フィールドが「なぜ preferred route が使えないのか」と「現在の fallback 自体に operational blocker があるか」を分けて示す。さらに skill-surface steering（`preferredSkillSurface`、`recommendedSkillInstallCommand`、`installedSkillSurfaces`、`readySkillSurfaces`）も返し、guidance surface の導入先を示すが、skills 自体を executable fallback route とは扱わない。hook helper についても「installed だが今の shell では operational でない」を区別して返す。`--cwd` で別リポジトリを検査した場合、hooks fallback の next step も `CAM_PROJECT_ROOT=...` を付けて local bridge route を対象 project に pin する。`cam` が PATH で解決できない場合、direct CLI next step は壊れた bare `cam recall ...` ではなく resolved `node dist/cli.js recall ...` fallback を優先する。`AGENTS.md` managed block が unsafe な場合は、まずその修復を案内し、すぐに `cam integrations apply --host codex` を勧めない |
| `cam mcp install --host codex` | 推奨される Codex project-scoped 宿主設定を明示的に書き込み、`codex_auto_memory` の項目だけを更新する。hooks/skills は自動導入せず、その entry に non-canonical なカスタム項目がある場合は安全な範囲で保持する。より低優先度の非 Codex host wiring は `docs/host-surfaces.md` に収め、既定の製品導線にはしない。その一部は引き続き `manual-only` のまま扱う |
| `cam mcp print-config --host codex` | ready-to-paste な Codex 接続スニペットを出力し、read-only retrieval plane を現在の主ワークフローに低摩擦で接続できるようにする。将来の Codex エージェント向けに、MCP を優先し、その次にローカル `memory-recall.sh` bridge bundle、最後に resolved CLI recall を使う retrieval route を教える推奨 `AGENTS.md` snippet に加えて、JSON payload に共有 `workflowContract` と明示的な `experimentalHooks` guidance も含める。その他 host の snippet は境界化された wiring 参考として `docs/host-surfaces.md` に集約し、`manual-only` 分岐もそこに閉じ込める |
| `cam mcp apply-guidance --host codex` | repo ルートの `AGENTS.md` 内にある Codex Auto Memory 管理 block を additive・監査可能・fail-closed に作成または更新する。同じ marker block の追加または置換だけを行い、安全に特定できない場合は書き換えず `blocked` を返す |
| `cam mcp doctor` | 推奨される project-scoped retrieval MCP の配線、project pinning、hook/skill fallback assets を read-only で点検し、さらに構造化された `workflowContract`、`layoutDiagnostics`、最小粒度の retrieval sidecar repair command を返す。`cam` が PATH で解決できない場合、この repair command も resolved launcher fallback に追従する。対象 host selection に Codex が含まれる場合（`--host codex` または `all`）、JSON には Codex-only の `codexStack` route truth、`experimentalHooks`、AGENTS guidance/apply safety も追加される。`claude`、`gemini`、`generic` のような manual-only / snippet-first host では、`commandSurface.install` と `commandSurface.applyGuidance` は明示的に `false` になり、Codex-only の writable guidance surface を実行可能能力として見せない。hook capture / recall についても installed と「helper に埋め込まれた launcher が現在の環境で動作可能か」を分けて報告し、app-server signal も `memories` / `codex_hooks` とは別に扱う。alternate global wiring が見つかった場合も、推奨される project-scoped ルートとは分けて扱う |
| `cam session save` | continuity の merge / incremental save |
| `cam session refresh` | continuity の replace / clean regeneration |
| `cam session load` / `status` | continuity reviewer surface を確認 |
| `cam hooks install` | 現在の local bridge / fallback helper bundle を生成・更新し、`memory-recall.sh`、`post-work-memory-review.sh`、互換 wrapper、`recall-bridge.md` を通じて今後の hook / skill / MCP-aware retrieval に備える。`post-work-memory-review.sh` は `cam sync` と `cam memory --recent` をまとめた収束 review helper である。これらの user-scoped helper は共有アセットに単一 repo パスを埋め込む代わりに、実行時に `CAM_PROJECT_ROOT` または shell の `PWD` から対象プロジェクトを解決する。これは公式な Codex hook surface ではなく、公式 hooks は依然として `Experimental` の opt-in ルートであり、config 文書の `codex_hooks` feature flag はまだ `Under development` かつデフォルトで無効である |
| `cam skills install` | Codex skill を導入する。既定 target は runtime のままだが、`--surface runtime|official-user|official-project` を使えば公式 `.agents/skills` 経路向けの明示的な互換コピーも置ける。どの surface でも、MCP-first の段階的 durable memory retrieval workflow を共有し、未接続時はまずローカルの `memory-recall.sh search -> timeline -> details` bridge bundle にフォールバックし、その後で resolved CLI recall に退避する。推奨検索 preset は引き続き `state=auto`, `limit=8` で共通だ。skills は依然として guidance surface であり、executable fallback route そのものではないため、現在どの route が実際に動作可能かは `cam mcp doctor --host codex` / `cam integrations doctor --host codex` で確認する |
| `cam audit` | プライバシーと secret hygiene を監査 |
| `cam doctor` | ローカル wiring と native-readiness を確認する。`--json` では retrieval sidecar の健全性、unsafe topic diagnostics、canonical layout diagnostics も追加で返し、引き続き完全 read-only を保つ |

補足:

- `cam skills install` の公開 surface は `runtime`、`official-user`、`official-project` に固定された。runtime が既定 target のままで、公式 `.agents/skills` 経路は明示的な opt-in install として扱う。
- 共有 `workflowContract` は launcher 前提も明示するようになった。`commandName=cam`、`requiresPathResolution=true`、`hookHelpersShellOnly=true` により、hooks / skills / doctor / print-config が PATH と shell 依存を同じ言葉で説明する。さらに helper bundle と doctor next steps は、`cam` が解決できない場合に `node <installed>/dist/cli.js` の verified fallback を優先して示す。
- `workflowContract.launcher` は direct CLI とインストール済み helper asset 向けの launcher contract であり、canonical MCP host snippet そのものではないことも明示するようになった。host wiring 自体は引き続き `cam mcp serve` を canonical な設定形として扱う。
- `workflowContract.launcher` は doctor と同じ executable-aware truth source を使うようになり、PATH 上に不可実行の `cam` ファイルがあるだけでは verified launcher とみなさない。unverified 分岐も `verified fallback` とは呼ばず、unverified direct command として扱う。
- Startup highlights は unsafe topic files も除外するようになった。さらに startup topic refs も safe references のみを返すようになり、`cam memory --json` と `cam memory reindex --json` は `topicDiagnostics` と `layoutDiagnostics` を返し、`cam memory --json` は `startupOmissions`、`startupOmissionCounts`、`topicFileOmissionCounts`、`topicRefCountsByScope` も返すため、highlight omission、topic ref omission、canonical layout anomaly のすべてが reviewer-visible になる。加えて、global highlight cap で後続 scope の highlight が落ちたときも selection-stage omission を残す。
- durable sync audit は `rejectedOperationCount`、`rejectedReasonCounts`、軽量な `rejectedOperations` 要約も返すようになり、unknown topic、sensitive content、volatile content、operation cap などで拒否された理由が reviewer surface から静かに消えなくなった。
- 自動抽出は `reference` 系 durable memory、たとえば dashboard、issue tracker、runbook、docs pointer のような外部参照もより自然に保持するようになった。一方で `.agents/`、`.codex/`、`.gemini/`、`.mcp.json`、`next step`、`resume here` のような session-only / local-host ノイズは durable memory に入りにくくなっている。
- `cam hooks install --json` と `cam skills install --json` は `postInstallReadinessCommand` も返すようになり、「インストール後にどの doctor を実行して operational route を確認するか」が machine-readable になった。トップレベルの `cam doctor --json` も `recommendedRoute`、`recommendedAction`、`recommendedActionCommand`、`recommendedDoctorCommand` を返すが、ここでの `recommendedRoute=companion` はトップレベルの companion / readiness surface を指すだけで、`cam mcp doctor` / `cam integrations doctor` が返す MCP-first の route truth とは別物である。
- `cam session load --json --print-startup` は continuity startup contract も返すようになった。実際に描画された `sourceFiles`、候補の `candidateSourceFiles`、`sectionsRendered`、`omissions` / `omissionCounts`、`continuitySectionKinds`、`continuitySourceKinds`、`continuityProvenanceKind`、`continuityMode`、`futureCompactionSeam` が追加され、`sourceFiles` は実際に bounded startup block に入った source のみを表す。
- `cam integrations install --json` / `cam integrations apply --json` も `postInstallReadinessCommand` / `postApplyReadinessCommand` を返すようになり、install / apply 後にどの doctor へ戻って route を確認すべきかを notes prose ではなく machine-readable contract として扱えるようになった。
- `cam remember --json` / `cam forget --json` には `entryCount`、`warningCount`、`uniqueAuditCount`、`auditCountsDeduplicated`、`warningsByEntryRef` が追加され、`forget --json` にはさらに `detailsUsableEntryCount` と `timelineOnlyEntryCount` が加わった。これにより multi-ref mutation payload を single-ref fact と誤読しにくくなる。
- Durable sync は subagent rollout に対して fail-closed になり、child-session の rollout は continuity / reviewer 用には残しつつ、`cam sync` では reviewer-visible な `subagent-rollout` skip として扱われる。
- `cam recall search --json` は、要求した scope/state に unsafe / malformed な topic source が含まれる限り `diagnostics.topicDiagnostics` を reviewer-visible に返す。sidecar が健康でも検索結果自体は fail-closed のまま unsafe topic を除外し、warning だけを早めに見せる。
- `cam remember --json` / `cam forget --json` はトップレベルの `reviewerSummary` と `nextRecommendedActions` も返すようになり、手動修正後の `timeline/details review -> recent review -> reindex` ループを machine-readable にした。
- `cam integrations apply --json` は `rollbackReport` も返すようになり、rollback ごとに「既存ファイルを復元した」「新規ファイルを削除した」「rollback 自体が失敗した」を区別できる。
- startup highlights は `project-local` / `project` / `global` をまたいで同一 summary を重複表示しないようになり、低信号な重複が限られた startup budget を消費しにくくなった。
- lifecycle reviewer では `updateKind` も `restore`、`semantic-overwrite`、`metadata-only` に細分化され、レビュー時に「アーカイブ復元」「意味上の修正」「metadata だけの更新」を見分けやすくなった。
- `cam integrations apply --host codex` は、AGENTS apply の late-block や途中書き込み失敗が起きた場合、project-scoped MCP wiring・hook bundle・skill assets をロールバックして半成功状態を減らすようになった。`--json` では `effectiveAction`、`rolledBack`、`rollbackSucceeded` などの最終状態フィールドも返し、「書こうとした」ことと「最終的に入った」ことを分けて読めるようにしている。
- 主要な `--help` 文言も release-facing public contract の一部として扱う。特に `integrations install/apply/doctor`、`mcp install/print-config/apply-guidance`、`skills install` は README、アーキテクチャ文書、dist/tarball smoke と同じ境界説明を維持する必要がある。

## 動作の仕組み

### 設計原則

- `local-first and auditable`
- `Markdown files are the product surface`
- `Codex-first hybrid runtime`
- `durable memory` と `session continuity` を分離
- `wrapper-first today, integration-aware tomorrow`

### 実行フロー

```mermaid
flowchart TD
    A[Codex セッション開始] --> B[startup memory を生成]
    B --> C[quoted MEMORY.md と topic refs を注入]
    C --> D[Codex 実行]
    D --> E[rollout JSONL を読む]
    E --> F[candidate memory operations を抽出]
    E --> G[optional continuity summary]
    F --> H[contradiction review と conservative suppression]
    H --> I[MEMORY.md と topic files を更新]
    I --> J[durable sync audit を追記]
    G --> K[shared / local continuity を更新]
```

### なぜまだ native-first ではないのか

- 公開された Codex ドキュメントは、現在の実装をそのまま置き換えられる完全な native memory 契約をまだ定義していません
- `cam doctor --json` に見える `memories` / `codex_hooks` も、今は readiness signal の性格が強いです。加えて、app-server signal、retrieval sidecar・unsafe topic・canonical layout の read-only diagnostics も返すようになりました
- そのため現在もっとも信頼できるのは wrapper-first の主線です

ただし方向性は変わりました。hooks、skills、MCP は「いつかの案」ではなく、Markdown-first 契約を壊さない範囲で正式に取り込んでいく統合面として扱います。

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
- [Architecture (中文)](docs/architecture.md) | [English](docs/architecture.en.md)
- [集成演进策略（中文）](docs/integration-strategy.md)
- [宿主能力面（中文）](docs/host-surfaces.md)
- [Native migration strategy (中文)](docs/native-migration.md) | [English](docs/native-migration.en.md)
- [Session continuity design](docs/session-continuity.md)
- [Release checklist](docs/release-checklist.md)
- [Contributing](CONTRIBUTING.md)

## 現在の状態

- durable memory path: available
- startup recall path: available
- reviewer audit surfaces: available
- session continuity layer: available
- wrapper-driven Codex flow: available
- hook / skill / MCP-aware evolution: 方向性として明文化済み。ただし最も成熟した利用経路ではまだない
- native memory / native hooks primary path: not enabled and not trusted as the main implementation path

## ロードマップ

### v0.1

- companion CLI
- Markdown memory store
- 200-line startup compiler
- worktree-aware project identity
- 初期の maintainer / reviewer docs

### v0.2

- issue のコア要求を満たす: 自動抽出、自動再呼び出し、更新/重複排除/上書き/アーカイブのライフサイクル、手動保守負担の削減
- `cam memory` / `cam session` / `cam recall` の reviewer UX 改善
- contradiction handling と memory lifecycle の強化
- Markdown-first 契約を崩さずに hook / skill / MCP-friendly integration surfaces を定義・公開

### v0.3+

- Codex-first hybrid 路線をさらに進め、retrieval・skill・hook integration を強化
- どの統合能力をこのリポジトリに残し、どれを将来の共有 runtime に抽出すべきか再評価する
- optional GUI / TUI browser
- より強い cross-session diagnostics と confidence surface

## コントリビュートとライセンス

- Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- License: [Apache-2.0](./LICENSE)

README、公式ドキュメント、ローカル実行結果にズレがある場合は、次の順で信頼してください。

1. 公式プロダクトドキュメント
2. 再現可能なローカル挙動
3. 不確実性を明示した記述

根拠の弱い断定より、検証可能な事実を優先してください。
