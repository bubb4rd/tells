You are variant {{k}} of {{n}} in an unattended design run. Nobody will answer questions. Decide, and write down why.

**Product:** {{brief}}

**Screens.** The product has these screens. The first two are the lead screens, which you build now; the rest get built later on your system, by other agents who only see what you leave them.

{{screens}}

{{references}}

{{assets}}

You are building the **system** of this product, not a page: one look, one set of parts and one set of facts that every screen will share. A product built screen by screen comes out stitched: each screen is clean, but fonts, charts, panels and spacing drift apart. Your job is to make that impossible for the screens that come after you.

## 1. Study

{{study}}

## 2. Facts: one world of sample data

Write `data/facts.js`: `window.FACTS = { ... }`, the realistic sample data for the **whole** product, every screen, not only the leads. One coherent world: names, dates, amounts and statuses that agree with each other everywhere (a customer on one screen has the orders another screen lists; totals add up; today's date is fixed in `FACTS.today`). As much as a real product would hold: no screen will be allowed to look empty. Plausible but invented: no real people's names, no real companies' private data. Never "John Doe", "Acme", lorem ipsum.

## 3. Contracts: shared state

Screens are separate pages, `screens/<id>.html`. Things done on one screen show up on the others: write that down as contracts in `CONTRACTS.md`. For each piece of shared state: its key in the store, its shape, its seed from `FACTS`, which screens read it and which change it, and what each change looks like on the other screens. Example: "`App.S.orders`: [{id, customer, items, due, status}]. Orders changes status; Today lists the ones due today; Customers shows each customer's open orders."

## 4. The system

- `system/tokens.css`: every colour, type step, space, radius, line and motion value, as custom properties. {{palette}}
- `system/ui.css`: every part a screen needs, built once: the shell, page header, panels, tables and row anatomy, list rows, forms and inputs, buttons, segmented controls, chips and status marks, meters, empty and loading states, dialogs, toasts, and **one chart style** (one mark, one axis treatment, one tooltip) used for every chart in the product.
- `system/app.js`: no build step, no external scripts. It draws the shell (navigation to every screen above, the current one marked) into each page, so the shell is written once. It holds the store `App.S`, seeded from `FACTS` and kept in `localStorage`, so a change on one page shows on the next, with a reset. It has helpers every screen uses: formatting money, dates and numbers; drawing the system's charts (with hover or scrub tooltips on every chart); toasts with Undo; dialogs.
- **The chrome is part of the system.** The shell, navigation, tabs, filters and footers use the same lines, surfaces and weights as the panels, and get the same care. The chosen nav item and the chosen tab are marked with ink and weight, or a line on the edge they sit on: never a raised pill on a grey track, never a coloured stripe down one side.
- `SYSTEM.md`: the rules of the system for the agents who build the rest. Type steps in px and where each goes. Spacing and row heights. Which part to use for what. The one chart style and how to call it. How status is marked. How motion is used: tied to an action (a row moving when its status changes, a dialog opening), entrance reveals at most once, nothing that loops. The voice of the copy. What a screen must never do.

## 5. The lead screens

Build `screens/{{lead1}}.html` and `screens/{{lead2}}.html`: each links `../system/tokens.css`, `../system/ui.css`, `../data/facts.js` and `../system/app.js`, and holds its own markup in the HTML (not built from strings in JavaScript), with its interactions in a small inline script or `screens/<id>.js`. Each screen opens with one lead: the thing its user checks first, sized like a real product sizes it (the biggest number on a working screen is rarely more than 2–3× body text). Every control does something real against the store. No dead ends, no "coming soon", no screen that's mostly empty. `index.html` at the root sends to `screens/{{lead1}}.html`. Build only these two screens: the navigation may link to the others before they exist, and they will be built from your system. No placeholder pages.

It should look like a real product of this kind that a good team shipped: not a concept, not a poster.

**The rule set wins over the reference.** Before you build, read `{{tells}}/rules/anti-slop.md` in full. Take the references' finish, never their tells: no eyebrow or kicker labels, no small tracked uppercase labels, no dot-separated label lines, no monospace costume, no fake live readouts or countdowns, no accent-coloured second line in a headline, no row of big-number stat blocks.

## 6. Critique

```sh
node {{tells}}/bin/tells.mjs measure screens/{{lead1}}.html screens/{{lead2}}.html --shots shots
node {{tells}}/bin/tells.mjs consistent screens
```

Open the screenshots next to the main reference. In `CRITIQUE.md`, list every place where the reference is more finished, every tell you carried over, and every place where the two lead screens disagree (a size, a gap, a panel, a chart). At least eight items. Fix them. Then screenshot and critique again: two rounds, each written down.

## Last

```sh
node {{tells}}/bin/tells.mjs fix .
node {{tells}}/bin/tells.mjs check . --strict
node {{tells}}/bin/tells.mjs render screens --strict
node {{tells}}/bin/tells.mjs consistent screens
```

Fix every error and warning. If a hit is right for this product, keep it with `<!-- tells-ok: <rule-id> <reason> -->` on that line; keyboard shortcuts the product really binds go in `.tellsrc` as `{"shortcuts": [...]}`. Project-wide exceptions (`allow`) aren't yours to grant: `tells make` sets any you write aside for the person to decide.

Finish with `NOTES.md` in four lines: what you carried over from the reference, where the palette and theme come from, the one thing that makes this product's system its own, and what still falls short. Don't ask anything, and don't wait for approval.
