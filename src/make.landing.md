You are variant {{k}} of {{n}} in an unattended design run. Nobody will answer questions. Decide, and write down why.

**Brief:** {{brief}}

{{current}}

This is a landing page: the front door that sells the thing and sends people in. It has to make someone feel something in the first second, then give them what they came for.

**References.** These full-page screenshots (1440px wide) in this folder are shipped landing pages, made by teams that know their audience:

{{references}}

**Your main reference is `reference-{{main}}.png`.**{{rotation}} You learn the main reference's finish and its energy by studying it closely, not by following rules. You are not copying its brand, its words or its artwork.

{{assets}}

You have three steps. Do all three.

## 1. Study: rebuild the main reference

Open your main reference and look at it closely, top to bottom. Rebuild it as `study.html` (self-contained, inline CSS) as faithfully as you can, with flat blocks where it has photography: same hero scale, same display type and how it's set, same section order and section heights, same rhythm between loud and quiet sections, same chrome.

Screenshot your rebuild and compare:

```sh
node {{tells}}/bin/tells.mjs measure study.html --shots shots --full
```

Open it next to the reference and fix what's off. Two passes at most.

Then write `STUDY.md`: the decisions that make the reference work, measured, not adjectives.
- The hero: how much of the first screen it takes, the display size in px and its ratio to body text, the face, case, weight and tracking, where the imagery sits and how much of it there is, what's layered over what.
- The pacing: each section in order with its height, what it shows, and whether it's loud or quiet.
- What carries the energy: imagery, colour, scale, texture, motion, cropping. What's deliberately plain so the loud parts land.
- How real content (results, people, dates, numbers) appears, and how far down.
- What you got wrong in your first rebuild: those are the decisions that are easy to miss.

## 2. Build: the brief, with the reference's decisions

Make `index.html` for the brief: self-contained, inline CSS and SVG, Google Fonts fine, no external scripts and no remote images. Use real, specific content for this subject: names, numbers, dates and results that make sense together. No lorem ipsum and no placeholders.

Carry over the decisions in STUDY.md: the hero's scale and dominance, the display type treatment, how imagery carries the page, the pacing of loud and quiet sections, and where real content appears. The structure of the sections comes from what this audience wants: what makes them stay, and what they click.

Imagery is structure here, not decoration. {{art}}

{{palette}}

**The rule set wins over the reference.** Before you build, read `{{tells}}/rules/anti-slop.md` in full. References are shipped work, and shipped work carries tells too. Take their finish, never their tells: no eyebrow or kicker labels over headings, no small tracked uppercase labels, no dot-separated label lines, no monospace or HUD costume on labels, no countdowns, coordinates or "live" readouts that aren't real, no accent-coloured second line or word in a headline, no row of big-number stat blocks. Where the reference does one of these, find what it was for and do that plainly.

## 3. Critique: compare with the reference, then fix

```sh
node {{tells}}/bin/tells.mjs measure index.html --shots shots --full
```

Open your screenshot and your main reference side by side. In `CRITIQUE.md`, list every place where the reference has more impact or more finish than yours, and every tell from the rule set you carried over, concretely: hero scale in px, how much of the first screen the imagery takes, type treatment, section pacing, what's flat that should hit, what's loud that should be quiet. At least eight items. Fix them. Then screenshot and critique again: two rounds in total, each written down.

## Last

```sh
node {{tells}}/bin/tells.mjs fix index.html
node {{tells}}/bin/tells.mjs check index.html --strict
node {{tells}}/bin/tells.mjs render index.html --strict
```

Fix every error and every warning that's left: they are the tells and defects the reference let you carry over. If a hit is right for this page, keep it with `<!-- tells-ok: <rule-id> <reason> -->` on that line.

Finish with `NOTES.md` in four lines: which reference you studied and what you carried over, what you changed for this subject, where the palette and the art come from, and what still falls short of the reference. Don't ask anything, and don't wait for approval.
