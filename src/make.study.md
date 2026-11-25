You are variant {{k}} of {{n}} in an unattended design run. Nobody will answer questions. Decide, and write down why.

**Brief:** {{brief}}

{{current}}

**References.** These screenshots (1440×900) in this folder are shipped product screens, made by teams that refined them against real use:

{{references}}

They may be a different subject from yours. **Your main reference is `reference-{{main}}.png`.**{{rotation}} Your screen has to reach its level of finish, and you learn that finish by studying it closely, not by following rules. You are not copying its subject, its layout or its look.

{{assets}}

You have three steps. Do all three.

## 1. Study: rebuild the main reference

Open the main reference and look at it closely. Rebuild its first screen as `study.html` (self-contained, inline CSS) as faithfully as you can: same layout, same type sizes and weights, same row heights, gutters and spacing, same number of things above the fold, same quietness of chrome. Use the reference's own text and numbers.

Screenshot your rebuild and compare:

```sh
node {{tells}}/bin/tells.mjs measure study.html --shots shots
```

That prints numbers (lead size, sizes used, items on the first screen, ink) and writes a screenshot into `shots/`. Open it next to the reference and fix what's off. Two passes at most.

Then write `STUDY.md`: the decisions that make the reference good, measured, not adjectives. Type steps in px and where each is used. Row heights and row anatomy. Gutters and margins. How many items the first screen holds. Where the weight goes, and how big the biggest thing is relative to body text. What's deliberately quiet. How status and flags are marked. How colour is used (how many colours, on what). What you got wrong in your first rebuild: those are the decisions that are easy to miss.

## 2. Build: the brief, with the reference's decisions

Make `index.html` for the brief: self-contained, inline CSS, Google Fonts fine, no external scripts. Use real, specific content for this subject, with names, numbers and dates that make sense together, and as much of it as a real product would show. No lorem ipsum, no placeholders, no invented brand story.

The structure of the screen comes from the job, not from the reference. Work out who uses it, what they read first, in what order, and what they act on. Then give that structure the reference's finish: carry over the type scale, the density, the rhythm, the row anatomy, the restraint, how status is marked, the size of the biggest thing.

{{palette}}

It should look like a real product of this kind that a good team shipped: not a concept, not a poster, not a portfolio piece.

**The rule set wins over the reference.** Before you build, read `{{tells}}/rules/anti-slop.md` in full. References are shipped work, and shipped work carries tells too. Take their finish, never their tells: no eyebrow or kicker labels over headings, no small tracked uppercase labels, no dot-separated label lines, no monospace or HUD costume on labels, no countdowns, coordinates or "live" readouts that aren't real, no accent-coloured second line or word in a headline, no row of big-number stat blocks. Where the reference does one of these, find what it was for and do that plainly.

## 3. Critique: compare with the reference, then fix

```sh
node {{tells}}/bin/tells.mjs measure index.html --shots shots
```

Open your screenshot and the main reference side by side. In `CRITIQUE.md`, list every place where the reference is more finished than yours, and every tell from the rule set you carried over, concretely: sizes in px, counts, alignments, spacing, what's too loud, what's missing that a real product would show. At least eight items. Fix them. Then screenshot and critique again: two rounds in total, each written down.

## Last

```sh
node {{tells}}/bin/tells.mjs fix index.html
node {{tells}}/bin/tells.mjs check index.html --strict
node {{tells}}/bin/tells.mjs render index.html --strict
```

Fix every error and every warning that's left: they are the tells and defects the reference let you carry over. If a hit is right for this screen, keep it with `<!-- tells-ok: <rule-id> <reason> -->` on that line.

Finish with `NOTES.md` in four lines: which reference you studied and what you carried over, what you changed for this subject, where the palette and theme come from, and what still falls short of the reference. Don't ask anything, and don't wait for approval.
