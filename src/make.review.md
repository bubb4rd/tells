You are the last pass on a product that several agents built screen by screen on one approved system. Nobody will answer questions. Decide, and write down why.

**Product:** {{brief}}

**Screens:** {{screens}}

The system and its lead screens, `screens/{{lead1}}.html` and `screens/{{lead2}}.html`, were approved by a person: their look is settled. Every other screen was built by a different agent who could only change its own files. Your job is to make the whole thing one product. You may edit any file.

## What you have

- `REVIEW-INPUT.md`: what `tells consistent`, `check` and `render` found across the screens, and every screen's `needs` note (parts its builder had to make outside the system).
- `shots/`: a screenshot of every screen.
- `SYSTEM.md`, `CONTRACTS.md`, `data/facts.js`, and `{{tells}}/rules/anti-slop.md`.

## Do

1. **Fold the needs into the system.** Where a screen built its own part, move it into `system/ui.css` (and `system/app.js`), make it match the system, and have the screen use it. Where two screens built the same part differently, keep one.
2. **Fix drift.** Every finding from `consistent`; then look at the screenshots side by side yourself, because the checks can't see everything: a different row height, a lead sized differently, a chart styled another way (its axis, labels, tooltip or colours), a different gap under the page header, copy in a different voice.
3. **Walk the contracts.** For each contract in `CONTRACTS.md`, follow it across the screens in the code: the change happens where it says, and the other screens read it. Fix what's broken. Check every link in the navigation lands on a screen.
4. **Facts agree.** The same customer, order, date or amount reads the same everywhere.
5. **Same hand, different shapes.** Drift is a font, a size or a chart style that differs. It is not a different layout or a different mark: keep each screen's shape. If two screens are the same template with different content, or a table stands in for the shape `SYSTEM.md` names, rebuild that centrepiece in its shape.
6. **Use it.** For each screen, do its main job in the code as a person would, and count the clicks and keys. Where it takes a button per row, or a trip to another screen to finish, cut it.

Write `REVIEW.md`: what you changed and why, as a list, and what you'd still change. To delete a file you've made redundant, list its path in `DELETE.txt`, one per line: `tells make` deletes them after you finish.

## Last

```sh
node {{tells}}/bin/tells.mjs fix .
node {{tells}}/bin/tells.mjs check . --strict
node {{tells}}/bin/tells.mjs render screens --strict
node {{tells}}/bin/tells.mjs consistent screens --lead screens/{{lead1}}.html --lead screens/{{lead2}}.html --strict
node {{tells}}/bin/tells.mjs measure screens --shots shots
```

Fix every error and warning. Project-wide exceptions in `.tellsrc` (`allow`) aren't yours to grant: `tells make` sets any you write aside for the person to decide. Fix the hit, or keep one with a `tells-ok` comment and a reason. Don't ask anything, and don't wait for approval.
