# Running Toolward in CI

The whole point of an audit tool is that it runs without being remembered.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | no findings at or above `--fail-on` |
| `1` | findings at or above `--fail-on` |
| `2` | usage error, unreadable path, bad flag |

`--fail-on` defaults to `high` for `scan` and `medium` for `verify`. Use
`--fail-on none` to report without ever failing the job.

## GitHub Actions

### With the bundled action

```yaml
name: agent audit
on:
  push:
  pull_request:
  schedule:
    - cron: "0 6 * * 1"   # upstream drift shows up on Monday mornings

permissions:
  contents: read
  security-events: write  # required for upload-sarif

jobs:
  toolward:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: CatCatUncle/toolward@v0.1.0
        with:
          paths: .
          fail-on: high
          format: sarif
          upload-sarif: true
```

Inputs: `paths`, `fail-on`, `min-severity`, `format`, `config`, `baseline`,
`only`, `lang`, `upload-sarif`, `version`. Outputs: `score`, `grade`,
`findings`, `critical`, `high`, `sarif-file`.

### Without it

```yaml
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx toolward@0.1.0 scan . --fail-on high
```

Pin the version. A security tool that auto-updates in CI is the supply-chain
problem it exists to find.

### SARIF into the Security tab

```yaml
      - run: npx toolward scan . --format sarif --out toolward.sarif --fail-on none
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: toolward.sarif
          category: toolward
```

`--fail-on none` matters here: let the upload happen, then fail the job in a
later step if you want a hard gate.

### Comment on the pull request

```yaml
      - run: npx toolward scan . --format md --out report.md --fail-on none
      - uses: marocchino/sticky-pull-request-comment@v2
        with:
          path: report.md
          header: toolward
```

### Lock drift as its own check

```yaml
  surface:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx toolward@0.1.0 verify . --fail-on medium
```

This is the check that catches a rug pull. `.toolward.lock.json` must be
committed; when a change is legitimate, the reviewer re-runs `toolward lock` and
the diff shows exactly which description changed and to what.

## GitLab CI

```yaml
agent-audit:
  image: node:22-alpine
  script:
    - npx toolward@0.1.0 scan . --format json --out toolward.json --fail-on none
    - npx toolward@0.1.0 scan . --fail-on high
  artifacts:
    when: always
    paths: [toolward.json]
```

## pre-commit

`.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: toolward
        name: audit agent extensions
        entry: npx toolward@0.1.0 scan
        language: system
        pass_filenames: false
        files: '(\.mcp\.json|claude_desktop_config\.json|cline_mcp_settings\.json|SKILL\.md|settings\.json|plugin\.json|marketplace\.json)$'
        args: ["--fail-on", "critical", "--compact"]
```

`--fail-on critical` locally, `high` in CI: a commit hook that fires on medium
findings gets disabled within a week.

## Jenkins

```groovy
stage('Agent audit') {
  steps {
    sh 'npx toolward@0.1.0 scan . --format sarif --out toolward.sarif --fail-on none'
    sh 'npx toolward@0.1.0 scan . --fail-on high'
  }
  post {
    always { archiveArtifacts artifacts: 'toolward.sarif' }
  }
}
```

## Adopting on an existing repo

Day one on a real repo produces findings. Do not start by arguing about them:

```bash
toolward scan . --fail-on none            # look at the damage
toolward scan . --min-severity critical   # fix these now
toolward baseline .                       # accept the rest, commit the file
toolward lock                             # pin the surface, commit the file
```

Then CI runs `toolward scan . --baseline .toolward-baseline.json --fail-on high`
and only new problems fail. Work the baseline down over time; never regenerate
it from CI.

## Monorepos

```bash
toolward scan packages/*/.mcp.json .claude
```

Multiple targets are merged into a single report rooted at their common
ancestor. For per-package gates, run per package and let each own its config:

```bash
for pkg in packages/*/; do
  toolward scan "$pkg" --config "$pkg/toolward.config.json" --fail-on high || fail=1
done
exit ${fail:-0}
```

## Scanning developer machines

The highest-value scan is not the repo — it is the global config, which no
review process covers:

```bash
toolward hosts                                 # what is installed here?
toolward scan --hosts --min-severity medium    # scan all of it
```

`--hosts` resolves the built-in host table (Claude Code, Claude Desktop, Codex
CLI, Cursor, Windsurf, VS Code, Cline/Roo, Zed, Gemini CLI, Continue, Goose, LM
Studio, OpenWorkBuddy) plus anything under the `hosts` key of your config, keeps
the paths that exist, and scans those. Add your own with:

```json
{ "hosts": [{ "name": "My Agent", "paths": ["~/.myagent/mcp.json"] }] }
```

Or name the paths yourself, which needs no config at all:

```bash
toolward scan ~/.claude ~/.codex "$HOME/Library/Application Support/Claude"
```

A whole-machine sweep touches thousands of files, so it turns up a long tail of
`low` findings that a repo scan does not. `--min-severity medium` on the first
pass keeps it readable; drop the flag once you have worked through those.

Worth doing once a month, and worth doing on the day you install anything from a
marketplace.

## Performance

The fixtures scan in under 20 ms. Toolward is IO-bound: it reads each candidate
file once, skips anything over `maxFileSizeKb`, and never resolves a network
name. No caching layer is needed and none exists.
