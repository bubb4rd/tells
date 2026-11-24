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

Fix the mechanical hits, then run the checks on what you changed and fix every error before you call the work done:

```sh
node TELLS/bin/tells.mjs fix <paths>
node TELLS/bin/tells.mjs render <html files or http URLs>
node TELLS/bin/tells.mjs same <design folder> --against <your other designs>
```

- `fix` rewrites the hits that have one right answer (`transition: all`, pills, bounce easing, arrow suffixes, a missing reduced-motion guard, placeholder names), then prints the same report as `check` for what's left. Everything left needs a decision from the subject. Make it yourself; don't stop to ask.
- `check` reads source (HTML, CSS, JSX, TSX, MDX). It's the same report without the rewrites.
- `same` compares the design's tokens with the five cliché clusters and with your other designs. If it lands on one, derive the surface, type and colour again from the subject.
- `render` loads pages in headless Chrome at 1440, 960 and 390px and checks contrast, overflow, tap targets, headings and broken images.
- If a hit is right for this subject, allow it with `tells-ok: <rule-id> <reason>` in a comment on the same line or the line above. The reason must come from the subject, not "it looks nice".
- Don't silence a rule to get a clean run. A clean run with no exceptions is better than a clean run with many.

Then review against `TELLS/playbook/review-checklist.md`, which covers what the linters can't check.

## Choosing between directions

Don't stop to ask the user to pick, and don't ask a model which looks better: LLM judges mark down plain, finished UI as "generic". Choose with checks instead, in this order:

1. **Gate.** Run `fix` and `render` on every candidate. Drop any with errors left that you can't settle from the subject.
2. **Prefer the product.** Keep the candidates that lead with the product itself (its screens, its data, its main task) over ones built around a metaphor. In blind tests, metaphor-led pages won 0 of 41 against professional work; product-led ones won about half.
3. **Prefer fewer exceptions.** Among those left, keep the one with the fewest `tells-ok` exceptions.
4. **Break ties on distance.** If it's still close, run `same` on each and keep the one that matches fewest house axes and no cluster. Close calls are coin flips even for a human picker, so don't spend time on them.

`node TELLS/bin/tells.mjs pick <variant folders> --against <past designs>` runs that order for you. To build the variants too, unattended, use `node TELLS/bin/tells.mjs make "<brief>"`.

Report the winner, what ruled out the others, and every exception it keeps. Bring in a person only when the user asks for one. See `TELLS/playbook/taste.md` for the evidence.
