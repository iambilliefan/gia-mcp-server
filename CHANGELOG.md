# Changelog

All notable changes to GIA MCP Server will be documented in this file.

## [0.2.0] - 2026-02-25

### Changed
- **Architecture**: Package is now a thin proxy to the hosted GIA server at `gia.aceadvising.com`
- All governance logic executes server-side
- Requires `GIA_API_KEY` environment variable for authentication

### Added
- Dynamic tool discovery (tools are fetched from the server — no package update needed when new tools are added)
- Bearer token authentication via API key
- Configurable server URL via `GIA_SERVER_URL` environment variable
- 29 governance tools available (up from 10 in v0.1.0)
- MCP tool annotations (readOnlyHint, destructiveHint, idempotentHint)
- Support for MCP resources and prompts

### Removed
- Local governance engine (all logic is now server-side)

## [0.1.0] - 2026-02-09

### Initial Release
- Local governance engine with 10 MCP tools
- MAI Framework classification
- Forensic audit ledger
- Governance scoring
- Compliance mapping
