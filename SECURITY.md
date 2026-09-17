# Security Policy

## Reporting a vulnerability in Toolward

**Please do not open a public issue.**

- GitHub Security Advisories: [report privately](https://github.com/CatCatUncle/toolward/security/advisories/new)
- Email: **security@aijentra.com**

Useful in a first report: what you did, what happened, what you expected, the
Toolward version, and a minimal file that reproduces it. If the report involves a
real credential, redact it — Toolward's own output rules apply to its bug
reports.

Expect an acknowledgement within 72 hours and a fix or a plan within 14 days for
anything confirmed. You will be credited in the advisory and the changelog
unless you ask not to be.

## What counts as a vulnerability in Toolward

Toolward reads untrusted, attacker-authored files by design. Anything that turns
reading into execution or exposure is in scope:

- **Code execution while scanning.** Toolward must never execute what it audits.
  Any path that runs a scanned command, imports a scanned file, or evaluates
  scanned content is critical.
- **Path escape.** Reading outside the scan targets — via a symlink, a `..`
  sequence, or a path in a config file being followed.
- **Leaking a secret into output.** Every credential Toolward finds must be
  redacted in every format. An unredacted value in pretty, json, md, sarif or
  compact output is a vulnerability, not a display bug.
- **Denial of service on hostile input.** Catastrophic regex backtracking, an
  unbounded read, or a crafted file that hangs the scan.
- **Report injection.** Content from a scanned file that escapes its context in
  a rendered report — ANSI escape sequences in a terminal report, a SARIF
  document that breaks its own schema, markdown that alters surrounding
  structure.
- **A lock file that can be forged**, such that `verify` reports no drift on a
  surface that really changed.
- **Network access.** Toolward makes no outbound connections. One appearing is a
  vulnerability by itself.

## What does not count

- **A rule that misses an attack** (false negative). That is a missing rule —
  please open a normal issue, it is the most welcome kind. It is only a
  vulnerability if Toolward *claims* the specific check and does not perform it.
- **A rule that fires on benign content** (false positive). Normal issue.
- **Findings about a project you scanned.** Those are about that project, not
  about Toolward. Report them to its maintainers.
- **Findings from `toolward scan` on `examples/vulnerable/`.** That directory is
  deliberately malicious — it is the test corpus. The keys in it are
  syntactically valid and intentionally fake.
- **Missing hardening in an agent host.** Report it to the host.

## Supported versions

Toolward is pre-1.0. Security fixes land on the latest minor release. When 1.0
ships, the previous minor will be supported for six months.

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |

## Design commitments

These are guarantees, and breaking one is a bug worth reporting:

1. **No execution.** No server is started, no package installed, no shell
   invoked, no scanned module imported. Static analysis, only.
2. **No network.** No version lookups, no reputation checks, no telemetry, no
   update pings. Toolward works fully offline.
3. **No secrets in output.** Detected credentials are redacted before they reach
   any renderer.
4. **No runtime dependencies.** Nothing to compromise upstream of you.
5. **Read-only**, except for the files you explicitly ask for: `--out`, the lock
   file from `lock`, the baseline from `baseline`.

## Safe Harbour

Good-faith research on Toolward itself is welcome and will not be met with legal
action: test against your own installation, do not access other people's data,
and give us a reasonable window before publishing. This covers the software, not
any AIjentra service or infrastructure.
