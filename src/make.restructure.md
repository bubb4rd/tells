This product was approved before you, and a person has sent notes on one screen: **`{{id}}`** ({{job}}, `{{target}}`). Change that screen, and only that screen. Nobody will answer questions. Decide, and write down why.

**Product:** {{brief}}

**Their notes on `{{id}}`:**

{{notes}}

## Read first

`APPROVED.md`, `PRODUCT.md`, `SYSTEM.md`, then every file `{{id}}` is drawn from: {{files}}. And the screen as it is now:

```sh
node {{tells}}/bin/tells.mjs measure {{target}} --shots shots --full
```

## Do

1. **Each note, on this screen.** Change what the note asks, on `{{id}}`. Its own files are yours to edit.
2. **Shared files: scope, don't change.** When the change needs CSS or code that other screens share, add a rule scoped to this screen ({{scope}}) instead of editing the shared one. The other screens ({{others}}) must look exactly as they do now. Their screenshots are compared after you finish.
3. **Keep what the notes didn't mention.** Every line of `APPROVED.md` stays unless a note names it: the tokens, the typefaces, the chart language and its marks, identity, the shell, the facts at their real scale. A note about layout is not a reason to restyle the charts.
4. **Tokens.** Don't change a token's value. If a note can't be met without it, change it, and list it under "Tokens changed" (below) with the note that asked. A token changed and not listed is put back.

To delete a file, list its path in `DELETE.txt`, one per line: `tells make` deletes it after you finish.

## Write

At the end of `POLISH.md` (create it if it isn't there; keep what earlier rounds wrote), add `## Round {{round}}`, and under it:

- each note in turn: what you changed, in which file, and where the screenshot shows it;
- `### Tokens changed`: each token you changed, with the note that asked for it, or "none".

Then add a line per note to `NOTES.jsonl`, as earlier rounds did (create it if it isn't there):

```json
{"round": {{round}}, "note": "the note, short, in their words", "from": "person", "kind": "decision", "tag": "structure", "rule": null}
```

`kind` is `defect` if they shouldn't have had to point it out (clipped, misaligned, missing, broken), `decision` if it's a call only they could make (what goes where, how blocks are separated, what to show). `tag` names the kind of thing, not this instance. `rule` is the tells rule that flags it, or `null`.

## Check

Screenshot `{{target}}` again with `--full`, open it, and look twice: fix, screenshot, look again. Then:

```sh
node {{tells}}/bin/tells.mjs check . --strict
node {{tells}}/bin/tells.mjs render {{target}} --strict
node {{tells}}/bin/tells.mjs consistent {{targets}} {{leadArgs}}
node {{tells}}/bin/tells.mjs click {{target}} --strict
```

Fix what your change caused. Hits the product had before you came are the client's: leave them. Don't run `fix` across the product, which would rewrite approved choices. Don't ask anything, and don't wait for approval.
