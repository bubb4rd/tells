You built this product with other agents: a system, then every screen on it, then a review. A person has now used it and sent notes. Nobody will answer questions. Decide, and write down why.

**Product:** {{brief}}

**Screens:** {{screens}}

**Their notes:**

{{notes}}

## Read first

`SYSTEM.md`, `CONTRACTS.md`, `REVIEW.md`, `{{tells}}/rules/anti-slop.md`, and the whole of every screen:

```sh
node {{tells}}/bin/tells.mjs measure screens --shots shots --full
```

The `--full` screenshots in `shots/` run past the first screen, where most of what a person notices is: a label running off a chart, a column that wraps on some rows and not others, a word repeated down a list.

## Do

1. **Each note, at its cause.** Find where it comes from: a token, a part in `system/ui.css`, a helper in `system/app.js`, or one screen's own files. Fix it there. When the cause is shared, every screen gets the fix; when a note names one thing ("the tabs", "this label"), look for every place that does the same thing in the same way, on every screen, and fix those too.
2. **Keep what the notes didn't mention.** It was liked, or not seen. Don't restyle it. Each screen keeps its shape: the same hand, different shapes. A note is never a reason to turn a timeline, a curve or a set of stages back into a table.
3. **Look again for the note's kind.** A person who sent "the count sits too high" will also mind a label that touches its border two screens over. After the listed notes, go through every screenshot for more of the same kind, and fix what you find.
4. **Write it into the system.** Add each note to `SYSTEM.md`'s "never" list in your own words, so the next screen built on this system gets it right.

To delete a file, list its path in `DELETE.txt`, one per line: `tells make` deletes it after you finish.

## Check

Screenshot again with `--full`, and open the new screenshots. At the end of `POLISH.md` (create it if it isn't there; keep what earlier rounds wrote), add `## Round {{round}}`, and under it take each note in turn: what you changed, in which file, and where the screenshot shows it's fixed. Then the ones you found yourself under step 3. Look twice: fix, screenshot, look again.

## Last

```sh
node {{tells}}/bin/tells.mjs fix .
node {{tells}}/bin/tells.mjs check . --strict
node {{tells}}/bin/tells.mjs render screens --strict
node {{tells}}/bin/tells.mjs consistent screens --lead screens/{{lead1}}.html --lead screens/{{lead2}}.html --strict
node {{tells}}/bin/tells.mjs click screens --strict
```

`click` presses every control from a fresh store, the way a person would. Fix every error and warning. Project-wide exceptions in `.tellsrc` (`allow`) aren't yours to grant: `tells make` sets any you write aside for the person to decide. Fix the hit, or keep one with a `tells-ok` comment and a reason. Don't ask anything, and don't wait for approval.
