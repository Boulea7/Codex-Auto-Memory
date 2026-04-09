# Release Checklist

Use this checklist before cutting any alpha or beta release of `codex-auto-memory`.

## Product contract checks

- Confirm the README still matches current CLI behavior.
- Confirm the paired Chinese and English public docs still describe the same product boundary and command surface:
  - `README.md` and `README.en.md`
  - `README.zh-TW.md` and `README.ja.md`
  - `docs/README.md` and `docs/README.en.md`
  - `docs/claude-reference.md` and `docs/claude-reference.en.md`
  - `docs/architecture.md` and `docs/architecture.en.md`
  - `docs/native-migration.md` and `docs/native-migration.en.md`
- Confirm `docs/claude-reference.md` still reflects the Claude-style contract the code is trying to mimic.
- Confirm `docs/native-migration.md` still matches the current compatibility seams in code.
- Confirm public wording still keeps `cam memory` as an inspect/audit surface, `cam recall` as the progressive-disclosure retrieval surface, `cam session` as a compact continuity surface, and the repository as a `Codex-first Hybrid` system rather than a native-ready replacement.
- Confirm the newer direction docs still match the README and architecture posture:
  - `docs/integration-strategy.md`
  - `docs/host-surfaces.md`
- Confirm `docs/session-continuity.md` matches the current `cam session` command surface and reviewer semantics, especially the wording split between `save`, `refresh`, and recovery markers.

## Code and runtime checks

- Prefer `pnpm verify:release` as the canonical full milestone check; run the individual commands below when you need to isolate a failure.
- Run `pnpm lint`
- Run `pnpm test:docs-contract`
- Run `pnpm test:reviewer-smoke`
- Run `pnpm test:cli-smoke`
- Run `pnpm test`
- Run `pnpm build`
- Run `pnpm test:dist-cli-smoke`
- Run `pnpm test:tarball-install-smoke`
- Run `pnpm pack:check`
- Confirm `package.json.files` still whitelists the release-facing surfaces you intend to ship: `dist`, `docs`, `schemas`, the multilingual READMEs, and `LICENSE`.
- Confirm `pnpm build` still starts from a clean `dist/` directory so `npm pack` cannot accidentally pick up stale compiled artifacts from an older tree shape.
- If you add new generated outputs beyond `dist/`, keep their cleanup path aligned with the build and pack workflow instead of letting release tarballs accumulate leftovers.
- After `pnpm build`, prefer validating release-facing CLI behavior through `node dist/cli.js ...` rather than `tsx src/cli.ts`.
- Run `node dist/cli.js --version` and confirm it matches `package.json`.
- Run `pnpm test:tarball-install-smoke` and confirm the packed `.tgz` installs cleanly, `./node_modules/.bin/cam --version` works, and at least one lightweight reviewer path such as `cam session status --json` succeeds from the installed package.
- Run `node dist/cli.js audit` if you want the repository privacy scan; keep it as a manual release-time check instead of a CI gate.
- Run `node dist/cli.js session refresh --json` and confirm `action`, `writeMode`, and `rolloutSelection` reflect the selected provenance.
- Run `node dist/cli.js session load --json` and confirm older JSON consumers still receive the existing core fields.
- Run `node dist/cli.js session status --json` and confirm the latest explicit audit drill-down matches the newest audit-log entry when present.
- Run `node dist/cli.js memory --recent --json` and confirm suppressed conflict candidates remain reviewer-visible instead of being silently merged.
- Run `node dist/cli.js recall search pnpm --json` and confirm the default search contract stays aligned at `state=auto, limit=8`, returning compact refs before any full detail fetch.
- Confirm `node dist/cli.js recall search pnpm --json` now also reports whether the search used the retrieval sidecar or fell back to Markdown scan through additive `retrievalMode` / `finalRetrievalMode` / `retrievalFallbackReason` fields.
- Confirm `node dist/cli.js recall search pnpm --json` now also exposes additive `stateResolution` and `executionSummary`, so reviewer-visible auto-state decisions and mixed fallback paths do not have to be inferred from `resolvedState` alone.
- Confirm `node dist/cli.js recall search pnpm --json` now also exposes `totalMatchedCount`, `returnedCount`, and `resultWindow`, so machine consumers can see the global hit count and returned slice without inferring it from `results.length`.
- Confirm `node dist/cli.js recall search pnpm --json` now also exposes per-result `globalRank`, so downstream reviewers can preserve global ordering after post-limit filtering.
- Confirm `node dist/cli.js recall search pnpm --state all --json` keeps the explicit-state contract stable: `resolvedState: "all"`, `stateResolution.outcome: "explicit-state"`, and stable `checkedPaths` semantics after global sorting and limit truncation.
- Confirm `node dist/cli.js recall search pnpm --json` now also exposes additive per-path diagnostics through `diagnostics.checkedPaths`, so mixed index/fallback searches stay reviewer-visible instead of collapsing into a single top-level mode.
- Confirm `diagnostics.checkedPaths[].returnedCount` makes the post-limit contribution of each checked path explicit instead of overloading `matchedCount`.
- Confirm `node dist/cli.js recall search pnpm --json` now also exposes `searchOrder`, `globalLimitApplied`, and `truncatedCount`, so machine consumers can tell which path order ran and whether the global result set was truncated.
- Confirm `diagnostics.checkedPaths[].droppedCount` makes it explicit how many per-path matches were dropped after global sorting and limit application.
- Confirm `node dist/cli.js remember "..." --json` and `node dist/cli.js forget "..." --json` now expose manual mutation reviewer payloads, including `mutationKind`, `matchedCount`, `appliedCount`, `noopCount`, `summary`, `entries[]`, `followUp`, and `nextRecommendedActions`.
- Confirm the same manual reviewer payload now also exposes additive aggregate reviewer counts such as `entryCount` and `warningCount`, and that `forget --json` also exposes `detailsUsableEntryCount` and `timelineOnlyEntryCount`.
- Confirm matched manual-mutation payloads also expose top-level lifecycle/detail fields such as `latestAppliedLifecycle`, `latestLifecycleAttempt`, `latestLifecycleAction`, `latestState`, `latestSessionId`, `latestRolloutPath`, `latestAudit`, `timelineWarningCount`, `warnings`, `entry`, `lineageSummary`, and `historyPath`.
- Confirm empty `forget --json` results keep `nextRecommendedActions: []` instead of emitting placeholder `\"<ref>\"` commands.
- Confirm `node dist/cli.js forget "pnpm npm" --json` now shares the same multi-term query normalization as `recall search`, so one memory can match across `summary/details` without requiring the original substring to remain contiguous.
- Confirm the same manual reviewer payload now also exposes top-level `reviewerSummary` and `nextRecommendedActions`, so post-correction review/sync/reindex guidance is machine-readable.
- Confirm repeated `node dist/cli.js remember "..." --json` calls now keep the latest applied lifecycle while surfacing the latest noop attempt through the same reviewer payload.
- Confirm `node dist/cli.js forget "missing" --json` returns an additive empty reviewer payload instead of failing or inventing fake refs.
- Run `node dist/cli.js memory --print-startup` and confirm startup recall now includes a `### Highlights` block with a few active-only content highlights, while archived notes and full topic bodies still stay out of default startup recall.
- Confirm `node dist/cli.js memory --json` now also surfaces `highlightCount`, `omittedHighlightCount`, `omittedTopicFileCount`, `highlightsByScope`, `startupSectionsRendered`, `topicFileOmissionCounts`, and `topicRefCountsByScope`, so startup highlight trimming, topic-ref trimming, and section rendering stay machine-visible.
- Confirm `node dist/cli.js memory --json` now also surfaces additive `startupOmissions`, so low-signal, duplicate, unsafe-topic, and budget-trimmed startup exclusions stay reviewer-visible.
- Confirm `node dist/cli.js memory --json` now also surfaces additive `topicDiagnostics` for unsafe / malformed topic files.
- Confirm `node dist/cli.js memory --json` stays read-only on an uninitialized project, returning an empty inspection view instead of creating `MEMORY.md`, `ARCHIVE.md`, or retrieval sidecars.
- Confirm startup highlights do not include entries from unsafe topic files, even though the corresponding topic refs may still remain reviewer-visible.
- Confirm durable sync audit now also surfaces additive `rejectedOperationCount` and `rejectedReasonCounts` instead of silently dropping rejected operations from reviewer output.
- Confirm durable sync audit and sync recovery markers now also surface additive `rejectedOperations` summaries instead of forcing reviewers to infer rejected refs only from counts.
- Run `node dist/cli.js memory reindex --scope all --state all --json` and confirm retrieval sidecars rebuild explicitly from Markdown canonical memory without mutating topic Markdown or audit logs.
- Confirm `node dist/cli.js memory reindex --scope all --state all --json` stays read-only on an uninitialized project, returning `rebuilt: []` instead of creating a durable memory layout implicitly.
- Run `node dist/cli.js recall details <ref> --json` for one returned ref and confirm the path resolves to Markdown-backed memory, including archived refs when relevant.
- Confirm `node dist/cli.js recall details <ref> --json` now also exposes additive provenance summary fields such as `latestLifecycleAction`, `latestSessionId`, `latestRolloutPath`, and `historyPath`.
- Confirm `node dist/cli.js recall details <ref> --json` now also exposes additive `latestAudit` provenance so a reviewer can jump from lifecycle state to the latest sync-audit summary without manually correlating sidecars.
- Confirm `node dist/cli.js recall details <ref> --json` now also exposes additive reviewer fields such as `latestState`, `timelineWarningCount`, `lineageSummary`, and `warnings`.
- Run a local MCP smoke against `node dist/cli.js mcp serve` and confirm `search_memories`, `timeline_memories`, and `get_memory_details` are exposed as a read-only retrieval plane.
- Confirm `search_memories` mirrors the CLI retrieval diagnostics through additive `retrievalMode` / `retrievalFallbackReason` fields, and `timeline_memories` / `get_memory_details` keep lifecycle provenance aligned with the CLI retrieval surface.
- Confirm `node dist/cli.js recall search <query> --json` surfaces additive `diagnostics.topicDiagnostics` whenever the requested scope/state includes unsafe / malformed topic sources, including healthy sidecar reads that still fail closed.
- Confirm `search_memories state=all` also keeps the explicit-state contract stable, including `stateResolution`, `executionSummary`, and stable `checkedPaths` semantics under global sorting plus limit truncation.
- Confirm `search_memories` now also mirrors CLI search diagnostics through additive `diagnostics.checkedPaths`, and `get_memory_details` mirrors CLI detail provenance through additive `latestAudit`.
- Confirm `timeline_memories` now also mirrors CLI lifecycle reviewer fields through additive `warnings` and `lineageSummary`.
- Run `node dist/cli.js mcp install --host codex --json` and confirm the result contract includes `host`, `serverName`, `projectRoot`, `targetPath`, `action`, `projectPinned`, and `readOnlyRetrieval`.
- `mcp install` is codex only; non-Codex hosts stay manual-only and snippet-first through `mcp print-config`.
- Re-run the same `node dist/cli.js mcp install --host codex --json` command once and confirm it returns `action: "unchanged"` when the target host config is already canonical.
- Confirm `node dist/cli.js mcp install --host codex --json` preserves non-canonical custom fields already attached to the `codex_auto_memory` entry instead of dropping them silently.
- Confirm `node dist/cli.js mcp install --host codex --json` now reports `preservedCustomFields`, so the machine-readable contract matches the human-readable notes about retained custom fields.
- Confirm project docs and `AGENTS.md` do not describe `cam mcp install` as supporting `claude` or `gemini`; mutable install remains Codex-only while other hosts stay manual-only / snippet-first.
- Confirm `node dist/cli.js mcp install --host generic` fails explicitly and still points users to manual wiring.
- Run `node dist/cli.js mcp print-config --host <codex|claude|gemini|generic> --json` for each public host and confirm the snippet contract includes `serverName`, `targetFileHint`, and a project-pinned retrieval command without writing host config files.
- For `node dist/cli.js mcp print-config --host codex --json`, also confirm the payload includes an additive AGENTS.md snippet / guidance block plus the shared `workflowContract`, so the retrieval workflow contract is identical between print-config, doctor, and integrations doctor.
- Confirm `node dist/cli.js mcp print-config --host codex --json` now also exposes additive `experimentalHooks` guidance and keeps the wording explicit that official Codex hooks are public but Experimental.
- Confirm the same `experimentalHooks.snippet` is safe to paste into an existing TOML config: it should not re-declare `[features]` when the file already has that table.
- Run `node dist/cli.js mcp apply-guidance --host codex --json` and confirm it reports `created`, `updated`, `unchanged`, or `blocked` without overwriting unrelated AGENTS.md content outside the managed block.
- Confirm `node dist/cli.js mcp apply-guidance --host codex --json` still returns `blocked` for malformed or unsafe managed-block shapes while leaving `AGENTS.md` byte-for-byte unchanged.
- Run `node dist/cli.js mcp apply-guidance --host codex --cwd <path> --json` from another working directory and confirm the managed AGENTS block is written inside the targeted project root.
- Confirm `node dist/cli.js mcp apply-guidance --host codex --json` ignores fenced-code examples of the managed markers, and that `node dist/cli.js mcp doctor --json` does not treat fenced examples as installed guidance.
- Run `node dist/cli.js mcp doctor --json` and confirm it reports project-scoped host wiring, project pinning, and hook / skill fallback assets without creating memory layout or mutating host config files.
- Run `node dist/cli.js mcp doctor --host codex --json` and confirm the payload also exposes the structured `workflowContract`, including the current CLI fallback commands and post-work sync/review helper contract.
- Confirm `node dist/cli.js mcp doctor --host codex --json` now also exposes additive `retrievalSidecar` readiness, including per-scope/per-state sidecar status, fallback reason, and the guarantee that degraded sidecars still fall back safely to Markdown canonical recall.
- Confirm `node dist/cli.js mcp doctor --host codex --json` now also exposes an explicit retrieval sidecar repair command instead of forcing users to infer how to rebuild indexes manually.
- Confirm `node dist/cli.js mcp print-config --host codex --json` still teaches the explicit fallback order `MCP -> local bridge -> resolved CLI` instead of collapsing directly to bare `cam recall`.
- Confirm the same repair command now picks the smallest safe `--scope` / `--state` when only a subset of sidecars is degraded, instead of always defaulting to `all/all`.
- Confirm the same repair command follows the resolved launcher fallback when `cam` is unavailable on PATH, instead of emitting a broken bare `cam memory reindex ...` suggestion.
- Confirm `node dist/cli.js mcp doctor --host codex --json` distinguishes alternate global wiring from the recommended project-scoped route through additive scope/reporting fields instead of treating them as the same readiness state.
- Confirm `recommendedSkillInstallCommand` in both `node dist/cli.js mcp doctor --host codex --json` and `node dist/cli.js integrations doctor --host codex --json` now follows the same resolved launcher semantics as the rest of the workflow contract, using the verified `node dist/cli.js` fallback when `cam` is unavailable on PATH.
- Confirm `node dist/cli.js mcp doctor --host codex --json` now exposes `configScopeSummary` and `alternateWiring`, so valid alternate global wiring stays distinct from malformed or shape-mismatched global host config.
- Confirm `node dist/cli.js mcp doctor --host codex --json` and `node dist/cli.js integrations doctor --host codex --json` now also expose additive `layoutDiagnostics`, so malformed topic file names, unexpected sidecars, and canonical index drift stay reviewer-visible without mutating Markdown memory.
- Confirm `node dist/cli.js mcp doctor --host codex --json` distinguishes skill-surface presence, canonical content, and readiness through additive fields such as `runtimeSkillPresent`, `officialUserSkillMatchesCanonical`, `officialProjectSkillMatchesCanonical`, `anySkillSurfaceInstalled`, and `anySkillSurfaceReady`.
- Confirm `node dist/cli.js mcp doctor --host codex --json` now also exposes additive per-surface `skillSurfaces` data so `installed`, `discoverable`, `listed`, and `executable` do not get collapsed into one readiness bit.
- Confirm `node dist/cli.js mcp doctor --host codex --json` now distinguishes `hookRecallReady` from `hookRecallOperationalReady`, and that launcher-aware helper checks still report operational when the embedded `node dist/cli.js` fallback is valid even if `cam` is unavailable on PATH.
- Confirm `node dist/cli.js mcp doctor --host codex --json` now also distinguishes `hookCaptureReady` from `hookCaptureOperationalReady`, and that broken embedded launcher paths surface as stale assets instead of silently remaining runnable.
- Confirm `workflowContract.launcher` and doctor now share the same executable-aware truth source: a non-executable `cam` file on PATH must not be treated as a verified launcher.
- Confirm the repo-managed `AGENTS.md` guidance stays canonical and environment-independent: no machine-specific absolute paths, no PATH/HOME-sensitive launcher wording, and no verified/unverified fallback labels inside the persisted snippet.
- Confirm `node dist/cli.js mcp doctor --host codex --json` and `node dist/cli.js integrations doctor --host codex --json` both surface additive `experimentalHooks` guidance that keeps official Codex hooks explicitly labeled Experimental / under active development, while `features.codex_hooks` remains under development and off by default.
- Confirm `node dist/cli.js mcp doctor --host generic --json` stays host-aware for manual-only hosts: `commandSurface.install=false`, `commandSurface.applyGuidance=false`, and Codex-only sections such as `codexStack`, `experimentalHooks`, `agentsGuidance`, and `applySafety` stay `null`.
- Confirm `node dist/cli.js doctor --json` now also reports the app-server signal separately from `memories` / `codex_hooks`.
- Confirm compiled smoke and tarball smoke both lock the additive `readiness.appServer` contract instead of leaving that guarantee source-test only.
- Confirm `node dist/cli.js doctor --json` now also exposes additive `recommendedRoute`, `recommendedAction`, `recommendedActionCommand`, and `recommendedDoctorCommand`, so the top-level doctor surface can point to the next operational check without mutating anything.
- Confirm release-facing compiled and tarball smoke now both cover that top-level `doctor --json` contract instead of leaving it source-test only.
- Confirm `node dist/cli.js integrations apply --host codex --json` now also exposes additive `postApplyReadinessCommand`, so post-apply route confirmation is machine-readable.
- Confirm `node dist/cli.js doctor` text now separates `Native memory/hooks readiness` from `Host/UI signals`, instead of presenting `tui_app_server` alongside native memory/hooks as if they shared the same maturity level.
- Confirm the release notes and docs do not over-fit one local app-server feature name: current local builds may expose `tui` or `tui_app_server`, and neither should be documented as a stable public contract.
- Confirm `workflowContract` now also exposes launcher constraints (`commandName=cam`, `requiresPathResolution=true`, `hookHelpersShellOnly=true`) so PATH and shell assumptions stay machine-visible.
- Confirm `workflowContract.launcher` now also clarifies that it applies to direct CLI usage and installed helper assets, while canonical host MCP wiring continues to use `cam mcp serve`.
- Confirm `workflowContract` now also carries additive `executionContract`, `modelGuidanceContract`, and `hostWiringContract` sections, and that those nested sections stay in parity across `print-config`, `mcp doctor`, `integrations doctor`, `hooks install`, and `skills install`.
- Confirm hook helpers and doctor next steps now prefer a verified `node <installed>/dist/cli.js` fallback when `cam` is unavailable on PATH, instead of only emitting unresolved `cam ...` guidance.
- Confirm `node dist/cli.js hooks install` writes `post-work-memory-review.sh`, and that the generated helper still runs the resolved durable-memory `sync -> recent review` route instead of assuming bare `cam` is available.
- Confirm `node dist/cli.js hooks install --json` exposes the shared `workflowContract` so hook helper guidance stays aligned with the MCP and integrations doctor surfaces.
- Confirm `node dist/cli.js hooks install --json` now also exposes additive `postInstallReadinessCommand`, so install-time next steps are machine-readable.
- Run `node dist/cli.js hooks install --cwd <path>` from another working directory and confirm the generated hook helper bundle keeps user-scoped assets reusable: `memory-recall.sh` and `post-work-memory-review.sh` should resolve the target project at runtime from `CAM_PROJECT_ROOT` or the caller shell cwd instead of hardcoding one repository path into shared helper contents.
- Confirm `node dist/cli.js integrations doctor --host codex --cwd <path> --json` project-pins hook-fallback next steps with `CAM_PROJECT_ROOT=...` when the local bridge route is the recommended operational fallback.
- Run `node dist/cli.js skills install --surface official-project --cwd <path>` from another working directory and confirm the explicit project-scoped `.agents/skills` copy is written inside the targeted repository.
- Confirm `node dist/cli.js skills install --json` exposes the shared `workflowContract` so skill guidance stays aligned with the MCP and integrations doctor surfaces.
- Confirm `node dist/cli.js skills install --json` now also exposes additive `postInstallReadinessCommand`, so install-time next steps are machine-readable.
- Confirm `node dist/cli.js mcp print-config --host <claude|gemini|generic> --json` keeps `workflowContract` absent while `--host codex --json` still exposes it.
- Confirm the same Codex `workflowContract.routePreference.preferredRoute` stays fixed at `mcp-first`.
- Confirm `node dist/cli.js remember --json` / `forget --json` now expose additive reviewer aggregates such as `uniqueAuditCount`, `auditCountsDeduplicated`, and `warningsByEntryRef` without breaking older top-level fields.
- Confirm `node dist/cli.js sync` records a reviewer-visible `subagent-rollout` skip when a child-session rollout is passed explicitly, instead of mutating canonical durable memory.
- Confirm `node dist/cli.js session save --rollout <subagent-rollout>` and `session refresh` with a matching recovery marker or latest audit entry pointing at a subagent rollout now fail closed instead of writing continuity from child-session evidence.
- Confirm continuity summary persistence failures now produce a `summary-write` recovery marker, and that shared/local continuity files remain rolled back to their pre-write state.
- Run `node dist/cli.js integrations install --host codex --json` and confirm it orchestrates the existing Codex MCP wiring, hook bundle, and skill assets without touching the Markdown memory store.
- Confirm `node dist/cli.js integrations install --host codex --json` now rolls back staged MCP / hook / skill writes if installation fails after partial writes.
- Run `node dist/cli.js integrations apply --host codex --json` and confirm it orchestrates MCP wiring, managed AGENTS guidance, hook assets, and skill assets while keeping `integrations install --host codex` non-mutating for AGENTS.md.
- Confirm `node dist/cli.js integrations apply --host codex --json` still returns `stackAction: "blocked"` when the AGENTS managed block is unsafe, and now also reports the preflight early-block shape (`preflightBlocked`, `blockedStage`, per-subaction `attempted`) while preserving the AGENTS file content and skipping all other stack writes.
- Confirm the same blocked `node dist/cli.js integrations apply --host codex --json` payload marks skipped subactions explicitly so machine consumers can distinguish “not attempted due to preflight block” from “ran successfully”.
- Confirm `node dist/cli.js integrations apply --host codex --json` now rolls back staged project-scoped MCP wiring, hook assets, and skill assets when AGENTS guidance blocks late, and exposes additive rollback metadata such as `rollbackApplied` / `rollbackPathCount`.
- Confirm the same late-block payload also exposes final-state semantics such as `rollbackSucceeded`, `rollbackErrors`, and per-subaction `effectiveAction` / `rolledBack`, so machine consumers do not mistake attempted writes for final installed state.
- Confirm the same late-block payload now also exposes additive `rollbackReport`, making each restored/deleted/error path explicit instead of only returning aggregate rollback booleans.
- Confirm `node dist/cli.js integrations install --host codex --json` now returns a structured rollback failure payload for staged install failures, including `rollbackSucceeded`, `rollbackErrors`, `rollbackReport`, and per-subaction final-state details.
- Confirm rollback coverage includes dangling symlink snapshots, so failed installs restore pre-existing symlink targets instead of deleting them as if they were missing files.
- Run `node dist/cli.js integrations apply --host codex --cwd <path> --json` from another working directory and confirm the stack still project-pins all subactions to the targeted repository.
- Run `node dist/cli.js skills install --surface official-user` and confirm the explicit official `.agents/skills` copy is written without changing the runtime default target.
- Run `node dist/cli.js integrations install --host codex --skill-surface official-user --json` and confirm the skill subaction reports the selected surface while MCP and AGENTS boundaries stay unchanged.
- Run `node dist/cli.js integrations apply --host codex --skill-surface official-user --json` and confirm the selected skill surface passes through while the AGENTS mutation boundary remains exclusive to `apply`.
- Run `node dist/cli.js skills install --surface official-project` and confirm the explicit project-scoped `.agents/skills` copy is written inside the repository without changing the runtime default target.
- Run `node dist/cli.js integrations install --host codex --skill-surface official-project --json` and confirm the skill subaction reports the selected project-scoped surface while MCP and AGENTS boundaries stay unchanged.
- Run `node dist/cli.js integrations apply --host codex --skill-surface official-project --json` and confirm the selected project-scoped skill surface still flows through the full apply path.
- Run `node dist/cli.js integrations doctor --host codex --json` and confirm it reports the thin Codex-only stack readiness view with `recommendedRoute`, `recommendedPreset`, `subchecks`, and `nextSteps`.
- Confirm `node dist/cli.js integrations doctor --host codex --json` also exposes additive route-truth fields: `recommendedRoute`, `currentlyOperationalRoute`, `routeKind`, `routeEvidence`, `shellDependencyLevel`, `hostMutationRequired`, `preferredRouteBlockers`, and `currentOperationalBlockers`, with `recommendedRoute` staying MCP-first while the blocker fields explain why the preferred route or current fallback is not operational.
- Confirm the same `integrations doctor` next steps stay launcher-aware: when `cam` is unavailable on PATH, the first direct CLI recall suggestion must prefer the resolved `node dist/cli.js recall ...` command instead of a broken bare `cam recall ...`.
- Confirm `node dist/cli.js integrations doctor --host codex --json` also exposes the shared structured `workflowContract`, including the post-work sync/review helper semantics, and now reports `applyReadiness` so unsafe AGENTS managed blocks are diagnosed before recommending `cam integrations apply --host codex`.
- Confirm `node dist/cli.js integrations doctor --host codex --json` also surfaces the additive `retrievalSidecar` summary from `mcp doctor`, so retrieval-plane degradation is visible before the user has to run a recall command manually.
- Confirm `node dist/cli.js integrations doctor --host codex --json` now recommends `cam memory reindex` when retrieval sidecars are degraded.
- Confirm `node dist/cli.js integrations doctor --host codex --json` keeps the `skill` subcheck guidance-only and does not describe skills as an executable fallback route.
- Confirm `node dist/cli.js integrations doctor --host codex --json` also exposes additive skill-surface steering fields: `preferredSkillSurface`, `recommendedSkillInstallCommand`, `installedSkillSurfaces`, and `readySkillSurfaces`.
- Confirm `workflowConsistency` wording in doctor surfaces now explicitly treats repo-level `AGENTS.md` guidance as part of the shared retrieval workflow contract, not just hooks/skills text.
- Treat key `--help` output as release-facing contract, not incidental CLI text:
  - `node dist/cli.js mcp install --help` should keep the supported install-host list at `codex` only.
  - `node dist/cli.js mcp print-config --help` should keep the supported snippet-host list at `codex, claude, gemini, or generic`.
  - `node dist/cli.js mcp apply-guidance --help` should stay Codex-only and describe managed `AGENTS.md` updates.
  - `node dist/cli.js mcp doctor --help` should stay inspect-only and keep the host selection list at `codex, claude, gemini, generic, or all`.
  - `node dist/cli.js skills install --help` should keep the public skill surfaces aligned at `runtime, official-user, or official-project`.
  - `node dist/cli.js integrations install --help` should describe stack install without managed `AGENTS.md` mutation.
  - `node dist/cli.js integrations apply --help` should explicitly add the managed `AGENTS.md` guidance flow on top of install.
  - `node dist/cli.js integrations doctor --help` should stay inspect-only and Codex-only.
- Confirm `node dist/cli.js session load --json` / `status --json` still expose `confidence` and warnings when the rollout required a conservative continuity summary.
- Confirm `node dist/cli.js session load --json --print-startup` now also exposes the structured continuity-startup contract: truthful rendered `sourceFiles`, `candidateSourceFiles`, `sectionsRendered`, additive `omissions` / `omissionCounts`, `continuitySectionKinds`, `continuitySourceKinds`, `continuityProvenanceKind`, `continuityMode`, and `futureCompactionSeam`.
- Confirm `test:dist-cli-smoke` and `test:tarball-install-smoke` both cover the JSON fields that define current-route truth and skill-surface steering, instead of leaving those guarantees only in source-level tests.
- Confirm the same continuity-startup contract is covered in source tests, compiled smoke, and tarball smoke so rendered provenance truth does not regress outside source-only unit tests.
- Confirm continuity reviewer warnings stay in diagnostics / audit surfaces and are not written into continuity Markdown body text.
- Run a local smoke flow:
  - `node dist/cli.js init`
  - `node dist/cli.js remember "..."`
  - `node dist/cli.js memory --cwd <path> --recent --print-startup`
  - `node dist/cli.js session status`
  - `node dist/cli.js session save`
  - `node dist/cli.js session refresh`
  - `node dist/cli.js session load --print-startup`
  - `node dist/cli.js forget "..."`
  - `node dist/cli.js doctor`

## Documentation checks

- Update the bilingual docs entry pages (`docs/README.md` and `docs/README.en.md`) if the public reading path changed.
- Update `docs/integration-strategy.md` and `docs/host-surfaces.md` when the repository adds or defers a new integration surface.
- Re-check the current official Codex and Claude public docs before changing migration wording; if the public posture is unchanged, say so explicitly in the handoff.
- Ensure the latest milestone commit is focused enough to review independently.

## Native compatibility checks

- Run `node dist/cli.js doctor` and record the current `memories` / `codex_hooks` status.
- Run `node dist/cli.js doctor --json` and confirm it also exposes additive `retrievalSidecar`, `topicDiagnostics`, and `layoutDiagnostics` without implicitly creating the durable memory layout.
- Run `node dist/cli.js audit` and record whether any medium/high findings remain.
- Confirm that any native-facing code still preserves companion fallback.
- Confirm that Markdown memory remains the user-facing source of truth.

## Release decision

Do not tag a release unless:

- tests are green
- docs are current
- review artifacts are in place
- the current milestone can be explained without reading every commit in the repository
- the tag format is `v<package.json.version>`

## Release automation notes

- A pushed `v*` tag is intended to run the GitHub Release workflow.
- The workflow verifies `GITHUB_REF_NAME === v${package.json.version}`, runs `pnpm verify:release`, and uploads the `npm pack` tarball to the GitHub Release.
- Before the first real tag validation, confirm that the remote default branch exposes `release.yml` in Actions and that the workflow is active.
- npm publish remains manual until registry credentials and approval posture are intentionally wired.
