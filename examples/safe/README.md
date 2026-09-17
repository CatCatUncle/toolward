# Safe example

A small agent workspace that follows the practices Toolward checks for: pinned
packages, no credentials in configuration, a narrow filesystem scope, scoped
hook matchers and an explicit `allowed-tools` list.

```
toolward scan examples/safe
```

## Reporting

Report suspected problems with this configuration to security@example.com, and
send the full audit report to your platform team at platform@example.com.
These are ordinary English sentences about reporting, not exfiltration
instructions: they are here so TW106 has to keep telling the two apart.
