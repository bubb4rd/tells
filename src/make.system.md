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
- **One language, many shapes.** A product made of the same table, the same side panel and the same bar chart on every screen is consistent and dull: it reads like a spreadsheet with a nav. Before you build parts, write the **shape** of each screen's main object in `SYSTEM.md`, one line per screen above. The shape is how the thing works in the world: a working day is a timeline with a now line, a process is a row of stages things move through, a level running down is a line heading for a date, a measurement over minutes is a curve with its events marked, money owed is aged into buckets, a week is a calendar. A table is right when the job is scanning many similar records; it is a default when it's there because it was the first part built. At most half the screens may have a table as their centrepiece, and no two screens may share the same arrangement of panels.
- `system/ui.css`: every part a screen needs, built once: the shell, page header, panels, tables and row anatomy, list rows, forms and inputs, buttons, segmented controls, chips and status marks, meters, empty and loading states, dialogs, toasts, and **one chart language**: one axis and label treatment, one tooltip, one set of colour roles, one scrub behaviour. Inside that language, build the marks the shapes need, not only one: bars, a line or area, a timeline of spans, stages, a strip of dots, a calendar or heatmap, a sparkline that sits in a row. A product draws every chart the same way; it doesn't draw every dataset the same shape.
- `system/app.js`: no build step, no external scripts. It draws the shell (navigation to every screen above, the current one marked) into each page, so the shell is written once. It holds the store `App.S`, seeded from `FACTS` and kept in `localStorage`, so a change on one page shows on the next, with a reset. It has helpers every screen uses: formatting money, dates and numbers; drawing the system's charts (with hover or scrub tooltips on every chart); toasts with Undo; dialogs; and keyboard handling (below).
- **The chrome is part of the system.** The shell, navigation, tabs, filters and footers use the same lines, surfaces and weights as the panels, and get the same care. The chosen nav item and the chosen tab are marked with ink and weight, or a line on the edge they sit on: never a raised pill on a grey track, never a coloured stripe down one side.
- **Fast to use, not only right.** For each screen, write its main job as steps, and count the clicks a person needs on a normal day. Then cut them: act on the thing where it's drawn (drag a span on the timeline to move it, click a stage to advance it, edit a figure in place), select several and act once, and after an action put the next item in front of them. The keyboard does the main job too: move with the arrow keys or j/k, act with one key, Escape to back out. Bind them in `app.js`, show each in its control's `title`, and list them in `.tellsrc` as `{"shortcuts": [...]}`. A button on every row that does the same thing is a sign the screen hasn't been designed yet.
- **Motion shows cause and effect.** When an action changes something drawn elsewhere on the screen, the change is seen: the order moves to its next stage, the stock line drops, the span lands in its new slot, the total counts to its new value. Each runs once, 150–300ms, tied to the action. Nothing loops and nothing moves on its own.
- `SYSTEM.md`: the rules of the system for the agents who build the rest. Type steps in px and where each goes. Spacing and row heights. Which part to use for what. Each screen's shape and the mark that draws it. The chart language and how to call each mark. How status is marked. The keys. How motion is used. The voice of the copy. What a screen must never do.

## 5. The lead screens

Build `screens/{{lead1}}.html` and `screens/{{lead2}}.html`: each links `../system/tokens.css`, `../system/ui.css`, `../data/facts.js` and `../system/app.js`, and holds its own markup in the HTML (not built from strings in JavaScript), with its interactions in a small inline script or `screens/<id>.js`. Each screen opens with one lead: the thing its user checks first, sized like a real product sizes it (the biggest number on a working screen is rarely more than 2–3× body text). Its centrepiece is drawn in the shape you wrote for it, and the two leads share a language but not a layout: a person approving them should see two different screens by one hand, not one template filled twice. Every control does something real against the store. No dead ends, no "coming soon", no screen that's mostly empty. `index.html` at the root sends to `screens/{{lead1}}.html`. Build only these two screens: the navigation may link to the others before they exist, and they will be built from your system. No placeholder pages.

It should look like a real product of this kind that a good team shipped: not a concept, not a poster.

**The rule set wins over the reference.** Before you build, read `{{tells}}/rules/anti-slop.md` in full. Take the references' finish, never their tells: no eyebrow or kicker labels, no small tracked uppercase labels, no dot-separated label lines, no monospace costume, no fake live readouts or countdowns, no accent-coloured second line in a headline, no row of big-number stat blocks.

## 6. Critique

```sh
node {{tells}}/bin/tells.mjs measure screens/{{lead1}}.html screens/{{lead2}}.html --shots shots
node {{tells}}/bin/tells.mjs consistent screens
```

Open the screenshots next to the main reference. In `CRITIQUE.md`, list every place where the reference is more finished, every tell you carried over, and every place where the two lead screens disagree (a size, a gap, a panel, a chart style). Then the other way: anywhere the two leads are the same template with different content, anywhere a table or a bar chart stands in for the shape you wrote down, and the clicks each screen's main job takes. At least eight items. Fix them. Then screenshot and critique again: two rounds, each written down.

## Last

```sh
node {{tells}}/bin/tells.mjs fix .
node {{tells}}/bin/tells.mjs check . --strict
node {{tells}}/bin/tells.mjs render screens --strict
node {{tells}}/bin/tells.mjs click screens --strict
node {{tells}}/bin/tells.mjs consistent screens
```

`click` presses every control from a fresh store, the way a person would; you can't open a browser, so this is how you know a control works. Fix every error and warning. If a hit is right for this product, keep it with `<!-- tells-ok: <rule-id> <reason> -->` on that line; keyboard shortcuts the product really binds go in `.tellsrc` as `{"shortcuts": [...]}`. Project-wide exceptions (`allow`) aren't yours to grant: `tells make` sets any you write aside for the person to decide. When `.tellsrc` names `widths`, the product is built for those widths: `render` checks only them, so don't propose an `allow` for a width the product isn't for, and keep the `widths` key when you edit `.tellsrc`.

Finish with `NOTES.md` in five lines: what you carried over from the reference, where the palette and theme come from, the one thing that makes this product's system its own, the moment in it that a person would enjoy using, and what still falls short. Don't ask anything, and don't wait for approval.
