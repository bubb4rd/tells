You built this product with other agents: a system, then every screen on it, then a review. A person has now used it and sent notes. Nobody will answer questions. Decide, and write down why.

**Product:** {{brief}}

**Screens:** {{screens}}

{{approved}}

**Their notes:**

{{notes}}

## Read first

{{docs}}, `{{tells}}/rules/anti-slop.md`, and the whole of every screen:

```sh
node {{tells}}/bin/tells.mjs measure {{targets}} --shots shots --full
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

## The ledger

Add a line to `NOTES.jsonl` for each note (create it if it isn't there; keep earlier lines), and one for each thing you found yourself under step 3. Each line is one JSON object:

```json
{"round": {{round}}, "note": "the note, short, in their words", "from": "person", "kind": "defect", "tag": "label-collision", "rule": null}
```

- `from`: `person` for their notes, `found` for yours.
- `kind`: `defect` if it's something they shouldn't have had to point out (clipped, misaligned, missing, wrong, broken). `decision` if it's a call only they could make (what goes where, which colour, what to show).
- `tag`: the kind of thing, not this instance: `label-collision`, not `customers-scale`. Reuse a tag from earlier lines when it's the same kind.
- `rule`: the tells rule that flags this kind of thing (`node {{tells}}/bin/tells.mjs rules` lists them), or `null`. Most will be `null`. Those are what tells should learn next.

## Last

```sh
{{fix}}node {{tells}}/bin/tells.mjs check . --strict
node {{tells}}/bin/tells.mjs render {{targets}} --strict
node {{tells}}/bin/tells.mjs consistent {{targets}} {{leadArgs}} --strict
node {{tells}}/bin/tells.mjs click {{targets}} --strict
```

`click` presses every control from a fresh store, the way a person would. Fix every error and warning. Project-wide exceptions in `.tellsrc` (`allow`) aren't yours to grant: `tells make` sets any you write aside for the person to decide. Fix the hit, or keep one with a `tells-ok` comment and a reason. Don't ask anything, and don't wait for approval.
