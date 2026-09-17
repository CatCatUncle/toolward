# Changelog

All notable changes to Toolward are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Rule ids are part of the public API: a released id is never reused for a
different check. Adding a rule, or raising a rule's default severity, is a minor
version bump, because it can turn a green CI job red.

## [Unreleased]

## [0.1.0] — 2026-09-18

First public release.

### Added

- **Scanner** for the files an AI agent loads: MCP server configs (`.mcp.json`,
  `claude_desktop_config.json`, `cline_mcp_settings.json`, VS Code, Zed
  `context_servers`, Codex `config.toml`), tool
  manifests, `SKILL.md` skills, Claude Code plugins and marketplaces, agent
  settings and hooks, subagents, slash commands, and source shipped inside an
  extension.
- **37 rules** across six categories:
  - `TW1xx` prompt injection and tool poisoning — instruction override,
    invisible Unicode, Trojan Source bidi, homoglyph names, hidden markup,
    exfiltration instructions, cross-tool shadowing, concealment, fake authority
    markers, oversized descriptions.
  - `TW2xx` supply chain — unpinned `npx`/`uvx`, non-registry installs,
    `curl | sh`, typosquats, plaintext HTTP transports, unpinned marketplaces.
  - `TW3xx` secrets — 15 credential patterns in env, headers, argv, source and
    docs; sensitive local file access; whole-environment forwarding.
  - `TW4xx` execution — permission and sandbox bypass, blanket auto-approval,
    broad hook matchers, interpolated shell, persistence, broad filesystem
    scope, dynamic evaluation.
  - `TW5xx` network — data-drop and tunnelling hosts, hard-coded IPs,
    obfuscated payloads, remote code executed at runtime, out-of-band
    exfiltration.
  - `TW6xx` governance — missing provenance, duplicate tool names, host
    built-in shadowing, undeclared execution in skills, unpinned tool surface.
- **`hosts` command and `--hosts` flag** — detect the agent hosts installed on
  this machine (Claude Code, Claude Desktop, Codex CLI, Cursor, Windsurf, VS
  Code, Cline/Roo Code, Zed, Gemini CLI, Continue, Goose, LM Studio,
  OpenWorkBuddy) and scan all of them in one pass. Unknown hosts are added
  through the `hosts` config key; servers are matched by structure, not by
  filename, so an unlisted host still scans when you point at its directory.
- **`lock` / `verify`** — hash the tool surface into `.toolward.lock.json` and
  detect rug pulls as `TW602`: changed entries are critical, additions medium,
  removals low.
- **Five output formats** — `pretty`, `json`, `md`, `sarif` (GitHub Security
  tab), `compact` (one line per finding, grep-friendly).
- **Risk score and grade** — 100 minus 40 per critical, 15 per high, 5 per
  medium, 1.5 per low; A/B/C/D/F.
- **Baselines** — `toolward baseline` accepts existing findings by fingerprint so
  an existing repo can start green.
- **Configuration** — `toolward.config.json` with `ignore`, `allowHosts`,
  `allowPackages`, per-rule severity overrides, `hosts`, `maxFileSizeKb` and
  `baseline`.
- **Bilingual reports** — English and Chinese (`--lang zh`, `TOOLWARD_LANG`) via
  a gettext-style catalogue keyed on the English source string; source code is
  English-only and a test enforces it.
- **Programmatic API** — `scan`, `collect`, `runRules`, `buildLock`,
  `verifyLock`, `allRules`, `knownHosts` and every renderer, fully typed, so an
  agent host can audit an extension before loading it.
- **GitHub Action** with SARIF upload, and a documented CI recipe for GitLab,
  Jenkins and pre-commit.
- **Fixtures** — `examples/vulnerable` (score 0, grade F) and `examples/safe`
  (score 100, grade A), used as regression tests for both detection and noise.

### Design commitments

- Never executes, installs or starts what it audits.
- Never makes a network connection.
- Never prints a credential it finds.
- Zero runtime dependencies.

[Unreleased]: https://github.com/CatCatUncle/toolward/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CatCatUncle/toolward/releases/tag/v0.1.0
