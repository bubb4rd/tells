You are building one screen of a product whose system is already designed and approved. Nobody will answer questions. Decide, and write down why.

**Product:** {{brief}}

**Your screen:** `{{id}}`: {{job}}

**The other screens:** {{others}}

The system was approved by a person from its lead screens, `screens/{{lead1}}.html` and `screens/{{lead2}}.html`. Their screenshots are in `system-shots/`. Your screen has to look like it was made by the same team on the same day: someone clicking from a lead screen to yours should feel nothing change but the content.

## Read first

1. `SYSTEM.md`: the rules. `CONTRACTS.md`: the shared state and who changes what. `data/facts.js`: the world. `{{tells}}/rules/anti-slop.md`: the tells to keep out.
2. `system/tokens.css`, `system/ui.css` and `system/app.js`: the parts and helpers you build with.
3. The lead screens' HTML and their screenshots. Study how they lay out a page, size the lead, build rows, mark status and draw charts.

## You own only these files

`screens/{{id}}.html`, and if you need them `screens/{{id}}.css`, `screens/{{id}}.js` and `data/{{id}}.js`. Everything else is shared and read-only: you may read it, but changes to it are thrown away. If the system lacks a part you need, build it in `screens/{{id}}.css` from the system's tokens, and write what you built and why in `screens/{{id}}.needs.md`, so it can be folded into the system later.

## Build

Work out who uses this screen, what they read first, in what order, and what they act on. Open with one lead, sized the way the lead screens size theirs. Use the facts: where you need more data for this screen, put it in `data/{{id}}.js` (loaded after `facts.js`), consistent with every name, date and amount in `facts.js`. Read and change shared state only as `CONTRACTS.md` says, through `App.S`, so the other screens show your changes. Every control does something real, with Undo where it changes data. Every chart uses the system's chart helper. No dead ends, no "coming soon", nothing mostly empty.

## Critique

```sh
node {{tells}}/bin/tells.mjs measure screens/{{id}}.html --shots shots
node {{tells}}/bin/tells.mjs consistent screens/{{lead1}}.html screens/{{lead2}}.html screens/{{id}}.html --lead screens/{{lead1}}.html --lead screens/{{lead2}}.html
```

Open your screenshot next to the lead screens' screenshots. In `screens/{{id}}.critique.md`, list every place where yours differs from the system (sizes in px, gaps, panels, rows, charts, colour, density), every place where it's less finished, and every tell. At least six items. Fix them. Two rounds, each written down.

## Last

```sh
node {{tells}}/bin/tells.mjs fix screens/{{id}}.html
node {{tells}}/bin/tells.mjs check screens --strict
node {{tells}}/bin/tells.mjs render screens/{{id}}.html --strict
```

Fix every error and warning on your files. Keep a hit that's right for this screen with `<!-- tells-ok: <rule-id> <reason> -->` on that line. Project-wide exceptions in `.tellsrc` (`allow`) aren't yours to grant: `tells make` sets any you write aside for the person to decide. Fix the hit, or keep one with a `tells-ok` comment and a reason. Don't ask anything, and don't wait for approval.
