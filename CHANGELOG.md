# Changelog

All notable changes to `codex-auto-memory` will be documented in this file.

## 0.1.1 - 2026-04-18

### Release

- added an npm preflight gate so the release workflow stops before any public release action when npm publish is not ready
- kept the GitHub Release artifact and npm package on the same tarball path to reduce release drift
- documented the manual maintainer fallback for npm publication when GitHub Actions credentials are unavailable

### Docs

- rewrote the landing pages and docs hubs to remove stale release-specific wording and make the install paths clearer
- tightened the release checklist for the first public npm release path
- added this changelog as a maintained release-notes source in the repository

## 0.1.0 - 2026-04-15

### Release

- published the first GitHub Release tarball for `codex-auto-memory`
- stabilized Windows smoke coverage and release-facing packaging checks

### Product

- expanded reviewer, dream, and session continuity surfaces across the CLI and public docs
