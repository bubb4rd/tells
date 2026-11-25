You built the system of this product and its two lead screens. A person looked at them and sent notes. Nobody will answer questions. Decide, and write down why.

**Product:** {{brief}}

**Their notes:**

{{notes}}

## Do

1. Read the notes against your screenshots in `shots/`. For each note, find the cause in the system, not on one screen: a token, a part in `system/ui.css`, the shell in `system/app.js`. Fix it there, so every screen built later gets it right. Where a note names one thing ("the active tab"), look for every part that does the same thing in the same way and fix those too.
2. Keep everything the notes didn't mention: it was liked. Don't restyle the parts they praised.
3. Update `SYSTEM.md` so the builders who come after you follow the change, and add each note to its "never" list in your own words.
4. Read `{{tells}}/rules/anti-slop.md` again before you change a part.

## Check

```sh
node {{tells}}/bin/tells.mjs measure screens/{{lead1}}.html screens/{{lead2}}.html --shots shots
```

Open the new screenshots. In `REVISION.md`, take each note in turn: what you changed, where, and how the screenshot shows it's fixed. Then look again for anything the notes would also object to that you haven't touched. Two rounds.

## Last

```sh
node {{tells}}/bin/tells.mjs fix .
node {{tells}}/bin/tells.mjs check . --strict
node {{tells}}/bin/tells.mjs render screens --strict
node {{tells}}/bin/tells.mjs click screens --strict
node {{tells}}/bin/tells.mjs consistent screens
```

Fix every error and warning. Don't ask anything, and don't wait for approval.
