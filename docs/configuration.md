# Configuration

Toolward runs with no configuration at all. Everything here is for tuning it to a
repository once the defaults start being wrong for you.

## Where the config lives

Toolward walks up from the first scan target, at most 12 levels, looking for the
first of:

1. `toolward.config.json`
2. `.toolwardrc`
3. `.toolwardrc.json`

`--config <file>` overrides the search. All three are JSON with comments —
`//` and `/* */` are stripped before parsing, so you can annotate why a rule is
off.

Relative paths inside the file resolve against the directory the config is in,
not the working directory.

## Full example

```jsonc
{
  // Skipped entirely — never read, never counted in the file stats.
  "ignore": [
    "**/fixtures/**",
    "docs/examples/**",
    "legacy-agent.json"
  ],

  // Hosts that are fine to send data to. Suppresses TW501/TW502 for them.
  "allowHosts": [
    "hooks.internal.example.com",
    "10.0.0.7"
  ],

  // Package prefixes allowed to stay unpinned. Suppresses TW201/TW204.
  "allowPackages": [
    "@my-company/",
    "our-internal-mcp-server"
  ],

  // Re-grade or disable individual rules.
  "rules": {
    "TW110": "off",       // our descriptions are genuinely long
    "TW201": "critical",  // we never allow unpinned specs
    "TW601": "off"        // internal repo, provenance is implicit
  },

  // Extra agent hosts for `toolward hosts` and `--hosts`.
  "hosts": [
    { "name": "My Agent", "paths": ["~/.myagent/mcp.json"] }
  ],

  // Files larger than this are skipped. Default 512.
  "maxFileSizeKb": 512,

  // Known findings that should not fail the build.
  "baseline": ".toolward-baseline.json"
}
```

## Keys

### `ignore: string[]`

Glob patterns, appended to the built-in list. Supports `*`, `**` and `?`;
patterns match against the path relative to the scan root, with forward slashes.

A pattern containing `/` is anchored to the scan root: `examples/**` ignores
`examples/` in the directory you scanned, and nothing else. A pattern *without*
a `/` matches any single path segment at any depth, file or directory alike — so
`README.md` hides every README in the tree, and `build` hides every `build/`
directory. When you mean one specific file, anchor it: `./README.md` is not
special, so write the path you actually want, e.g. `docs/README.md`, or scope it
with `**`. Remember that the config is found by walking *up* from the scan
target, so an unanchored pattern in a repository-root config applies to every
subdirectory anyone scans.

Always ignored, without configuring anything: `node_modules`, `.git`, `.hg`,
`.svn`, `dist`, `build`, `out`, `target`, `vendor`, `.venv`, `venv`,
`__pycache__`, `.next`, `.nuxt`, `.cache`, `.turbo`, `coverage`,
`.pytest_cache`, `.mypy_cache`.

`--exclude a,b,c` adds patterns for one run without editing the file.

### `allowHosts: string[]`

Hostnames or IPs that egress rules treat as known-good. Matching is
case-insensitive and covers subdomains: `example.com` also allows
`api.example.com`.

This is the right knob when your team really does post to an internal collector.
It is the wrong knob for `webhook.site` — if a finding points at a public drop
host, the fix is to remove the endpoint, not to allow it.

### `allowPackages: string[]`

Package specs or prefixes that may stay unpinned, and that typosquat detection
should leave alone. Use it for your own scope (`@my-company/`) where an unpinned
spec is a deliberate internal-distribution choice.

### `rules: Record<string, Severity | "off">`

Per-rule override. The value is one of `critical`, `high`, `medium`, `low`,
`info`, or `"off"` to disable the rule entirely.

An override wins over the severity a rule picks per finding, so
`"TW301": "critical"` really does make every credential finding critical even
where the rule would have chosen high.

Rule ids are in [rules.md](rules.md), or run `toolward rules`.

### `hosts: { name: string; paths: string[] }[]`

Extra agent hosts, added to the built-in table used by `toolward hosts` and
`toolward scan --hosts`. Use it for anything the table does not know: a
self-hosted runner, an in-house agent, a client that shipped last week.

```json
{
  "hosts": [
    { "name": "My Agent", "paths": ["~/.myagent/mcp.json", "~/.myagent/skills"] },
    { "name": "Team runner", "paths": ["/opt/agent/mcp.json"] }
  ]
}
```

A leading `~/` is expanded to your home directory, so the file stays portable
across machines. A path is listed only if it exists; a host whose paths are all
missing is simply not reported. The `name` becomes the display name, and a
kebab-case form of it becomes the id.

You do not need this to *scan* an unknown host — `toolward scan ~/.myagent`
already works, because servers are found by structure, not by filename. The key
exists so `--hosts` sweeps include it without you retyping the paths.

### `maxFileSizeKb: number`

Files above this size are not read. Default `512`. Raise it if you have a
genuinely large `tools-list.json`; the cost is linear scan time.

### `baseline: string`

Path to a baseline file. See below.

## Baselines

Adopting a security tool on an existing repo means a wall of findings. A
baseline lets you start green and only fail on what is new:

```bash
toolward baseline .                       # writes .toolward-baseline.json
git add .toolward-baseline.json
toolward scan . --baseline .toolward-baseline.json
```

A baseline stores each accepted finding's **fingerprint** — a hash of rule id,
file, subject, snippet and message. Fingerprints are stable across runs and
across machines, and they change when the underlying problem changes, so
"accepted" never silently covers a *different* problem in the same place.

Baselined findings are suppressed from the report and counted in
`result.suppressed`. They do not affect the score.

Point `baseline` at the file in your config to avoid passing `--baseline` every
time. Re-run `toolward baseline` deliberately, never in CI — a baseline that
regenerates itself accepts every regression.

## Inline suppression

There is none, on purpose. An in-file comment that turns a rule off is a comment
an attacker can also write, in a file whose whole problem is that it is
attacker-authorable. Suppression lives in config and baselines, which are yours.

## Precedence

For a single run, from strongest to weakest:

1. `--only <ids>` — nothing else runs
2. `--min-severity` — filters the output
3. `config.rules` — overrides severity, or disables
4. per-finding severity chosen by the rule
5. the rule's default severity

`ignore` and `maxFileSizeKb` apply earlier still, at collection time: an ignored
file is never read, so no rule can fire on it.

## Environment variables

| Variable | Effect |
| --- | --- |
| `TOOLWARD_LANG` | `zh` selects Chinese output; `--lang` wins over it |
| `NO_COLOR` | any value disables ANSI colour |
| `FORCE_COLOR` | forces colour when stdout is not a TTY |

Toolward reads no other environment variables, and never reads the values of the
ones it finds in a config it audits.
