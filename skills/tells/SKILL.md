---
name: tells
description: Rules and linters that catch the marks of default, AI-generated UI (eyebrows, pills, purple gradients, glass, fake data, weak contrast, small tap targets). Use before designing or building any UI screen, page, component or design system, and after, to audit it.
---

# tells

The tells repo is two folders up from this skill's base directory. Call it `TELLS`.

## Before you design

Read `TELLS/rules/anti-slop.md` in full. It lists what to leave out and why. The core rule: when something is banned, don't swap in its nearest neighbour. Go back to the subject and derive the choice from it.

For a new design system, follow `TELLS/playbook/design-system.md`.

## After you build

Run both linters on what you changed and fix every error before you call the work done:

```sh
node TELLS/bin/tells.mjs check <paths>
node TELLS/bin/tells.mjs render <html files or http URLs>
```

- `check` reads source (HTML, CSS, JSX, TSX, MDX). `render` loads pages in headless Chrome at 1440, 960 and 390px and checks contrast, overflow, tap targets, headings and broken images.
- If a hit is right for this subject, allow it with `tells-ok: <rule-id> <reason>` in a comment on the same line or the line above. The reason must come from the subject, not "it looks nice".
- Don't silence a rule to get a clean run. A clean run with no exceptions is better than a clean run with many.

Then review against `TELLS/playbook/review-checklist.md`, which covers what the linters can't check.

## Judging

Don't pick between design directions yourself, and don't ask another model to. LLM judges mark down plain, finished UI as "generic". Show the options to a person, ideally as blind pairs. See `TELLS/playbook/taste.md`.
