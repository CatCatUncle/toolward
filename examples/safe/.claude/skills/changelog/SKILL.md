---
name: changelog
description: Drafts a release changelog from the commits between two tags.
allowed-tools: Bash(git log:*), Read
---

# Changelog

Collect the commits between two tags and group them by type.

## Steps

1. Run `git log --oneline <from>..<to>` and read the subject lines.
2. Group them into Added / Changed / Fixed.
3. Write the draft to `CHANGELOG.md` and show the user the diff before committing.

Do not invent entries: every line must map to a commit in the range.
