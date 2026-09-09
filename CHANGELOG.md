# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-09

### Added

- User OAuth authorization-code login and `/api/v2/user` support for private reports.
- Public, unlisted, and private access modes across report tools.
- Persistent active characters, recent report discovery, encounter/zone rankings, and pull-based character subscriptions.
- Core `wcl-mcp` compatibility names, including bounded cross-report character death/cast evidence.
- Secure local token/state storage, private endpoint checks in `doctor`, and a privacy threat model.

### Changed

- Direct report lookups allow unlisted reports by default.
- Package version and runtime user-agent are now `0.2.0`.
- The npm Release workflow is disabled until `NPM_PUBLISH_ENABLED=true` is explicitly configured.

## [0.1.0] - 2026-09-08

### Added

- MCP SDK v2 stdio server with 20 Warcraft Logs tools.
- Global and CN report URL parsing with SSRF-resistant host validation.
- OAuth token caching, concurrent deduplication, 401 refresh, 429 handling, timeouts, and retries.
- Bounded table and event evidence with pagination and payload controls.
- Mythic+ summaries and best-effort player analysis contexts.
- Strict TypeScript, runtime response schemas, tests, CI, Changesets, and npm trusted-publishing workflow.

[0.1.0]: https://github.com/iRockyZhou/warcraftlogs-mcp/releases/tag/v0.1.0
[0.2.0]: https://github.com/iRockyZhou/warcraftlogs-mcp/releases/tag/v0.2.0
