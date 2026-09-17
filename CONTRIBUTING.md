# Contributing to Toolward

The most valuable contribution is **an attack Toolward misses**. If you have seen
a malicious MCP server, a poisoned skill or a plugin that does something nasty,
a minimal fixture in an issue is worth more than a thousand-line refactor.

## Getting set up

```bash
git clone https://github.com/CatCatUncle/toolward && cd toolward
npm install          # only typescript + @types/node
npm run build
npm test             # build + the full suite
```

Node ≥ 20.10. There are no runtime dependencies and there will not be any — a
security tool with a dependency tree is a supply-chain risk pretending to be a
supply-chain audit. Dev dependencies stay at two.

Useful commands:

```bash
npm run typecheck                        # tsc --noEmit, must be clean
npm run test:only                        # tests without rebuilding
npm run selfscan                         # scan the vulnerable fixture
npm run docs:rules                       # regenerate docs/rules*.md
node dist/cli.js scan examples/vulnerable --only TW301   # one rule at a time
```

## Adding a rule

A rule is a pure function over a `ScanContext`. That is the whole interface:

```ts
// src/rules/network.ts
export const tw599: Rule = {
  id: "TW599",
  category: "network",
  severity: "high",
  title: "Server talks to a raw WebSocket endpoint",
  description:
    "WebSocket transports bypass the HTTP allowlists most corporate proxies enforce.",
  remediation: m("Use an https:// transport, or keep the server on localhost."),
  references: ["https://example.org/why-this-matters"],
  run({ ctx, report }) {
    for (const server of ctx.servers) {
      if (!server.url?.startsWith("ws://")) continue;
      report({
        file: server.file.rel,
        line: lineOf(server.file, server.url),
        subject: server.name,
        message: m('Server "{name}" connects to {url} over a raw WebSocket.', {
          name: server.name,
          url: server.url,
        }),
      });
    }
  },
};
```

Then:

1. Export it from `src/rules/index.ts` so it joins `allRules`.
2. Add the English `title`, `description`, `remediation` and every `m()`
   template to `src/i18n/zh.ts`. Tests fail otherwise.
3. Add a fixture to `examples/vulnerable/` that triggers it, and make sure
   `examples/safe/` still scans clean.
4. Add a case to `test/rules.test.js` asserting the id fires on the vulnerable
   fixture.
5. `npm run docs:rules` and commit the regenerated catalogue.

### Rule id ranges

| Range | Category |
| --- | --- |
| `TW1xx` | injection — prompt injection and tool poisoning |
| `TW2xx` | supply-chain |
| `TW3xx` | secrets |
| `TW4xx` | execution — permissions, sandboxing, persistence |
| `TW5xx` | network — egress and exfiltration |
| `TW6xx` | governance — provenance, naming, drift |

Ids are permanent. A rule that turns out to be wrong gets removed or re-graded;
its id is never reused for something else, because baselines and SARIF
suppressions in other people's repos refer to it.

### Choosing a severity

| Severity | Means |
| --- | --- |
| `critical` | Exploitable as-is: credential exposure, arbitrary execution, exfiltration, confirmed drift. |
| `high` | A strong signal of attack or a serious misconfiguration, but needs another condition to land. |
| `medium` | Bad practice with a plausible attack path. |
| `low` | Hygiene. Worth fixing, never worth failing a build over. |
| `info` | Not a problem. Something the reader should know. |

If you are unsure, go one step lower. A tool that overstates severity gets
`--fail-on none` and then gets ignored.

### Rule quality bar

- **No false positives on `examples/safe/`.** That fixture is the regression
  test for noise. If your rule fires there, it is not ready.
- **Match on structure where you can**, on text only where you must. A rule that
  looks at `server.args` beats one that greps the raw file.
- **Never print a secret.** Use `redact()` from `src/rules/helpers.ts`; every
  value in a finding must survive being pasted into a public issue.
- **The remediation must be an action.** "Review this" is not a remediation.
  "Move the value into `${VAR}` and rotate the exposed key" is.
- **Cite a reference** when the attack class has a name. It is what makes a
  finding believable at 4pm on a Friday.

## Writing user-facing text

Source code is English-only; this is enforced by `test/i18n.test.js`.

Write the English sentence at the call site and wrap it in `m()`:

```ts
message: m('Server "{name}" is granted the whole path "{path}".',
           { name: server.name, path });
```

Then add the exact same English string as a key in `src/i18n/zh.ts`. The
catalogue is keyed on the English source string, gettext style, so translations
never drift out of sync with a key nobody updated. Placeholders must match
between key and value — a test checks that too. Parameter *values* are also run
through the catalogue, so `originLabel()` output translates automatically.

To add a language: create `src/i18n/<lang>.ts` with the same shape, register it
in `CATALOGUES`, and add the code to the `Lang` union. Missing entries fall back
to English rather than breaking.

## Tests

`node --test "test/*.test.js"` against the compiled `dist/`. There are five
files: `parse`, `score`, `rules`, `lock`, `i18n`. Add to the one that fits.

The rule tests run against the fixtures, so a new rule usually means one new
fixture line and one new assertion. Tests must pass on Linux, macOS and Windows
— no shelling out, no absolute paths, no assumptions about line endings.

## Commits and pull requests

- One logical change per PR. A new rule plus its fixture, docs and test is one
  logical change.
- `npm run typecheck && npm test` must be clean before you push.
- Explain the *attack* in the PR description, not just the diff. What does a
  malicious extension do, and what happens to the victim?
- Conventional-ish commit subjects are appreciated (`rules: add TW599 …`) but
  not enforced.

## Why the self-audit ignores `src/rules/`

`.github/toolward.selfaudit.json` excludes the rule sources, the translations and the docs
from Toolward's own CI audit. A detector contains the strings it detects:
`src/rules/supplychain.ts` genuinely has `curl … | sh` in it, and
`src/rules/injection.ts` genuinely contains bidi control characters inside a
character class. Those findings are correct and useless. Everything else in
the repository is audited normally and must stay clean.

That config lives under `.github/` rather than at the repo root on purpose: a
root config would be picked up when scanning `examples/`, and the fixtures must
be scanned exactly the way a user's project is.

## Licensing of contributions

By opening a pull request you certify the [Developer Certificate of
Origin](https://developercertificate.org/) — that you wrote the change or have
the right to submit it.

Contributions are licensed to the project under the same PolyForm Noncommercial
terms as the rest of Toolward, and you grant the maintainers the right to
distribute them under commercial licences as well. This is what keeps the
commercial licence sellable, which is what funds the maintenance. If you are not
comfortable with that, please open an issue instead of a PR — a well-described
attack is a contribution too, and carries no such terms.

## Security issues

Do not open a public issue for a vulnerability *in Toolward*. See
[SECURITY.md](SECURITY.md).
