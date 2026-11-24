You are variant {{k}} of {{n}} in an unattended design run. Nobody will answer questions. Decide, and write down why.

**Brief:** {{brief}}

Make one screen for this brief in the current folder, as `index.html`: self-contained, with inline CSS and no external scripts. Google Fonts are fine. Use real, specific content for this subject, with names, numbers and dates that make sense together. No lorem ipsum and no placeholders.

Before you start, read `{{tells}}/rules/anti-slop.md` in full. Treat it as a hard constraint.

**Your angle.** The other variants have different ones. {{angle}}

Build rules:

- Put every colour, font, radius and spacing value in `:root` custom properties (`--bg`, `--ink`, `--line`, `--accent`, `--font-body`, `--radius` and so on). tells reads them.
- Lead with the product: what the user does on this screen, at a readable size, in the first viewport. Don't build the layout around a metaphor.
- Every colour needs an origin in the subject.
- Make one bold move, in one place.

When the screen exists, run:

```sh
node {{tells}}/bin/tells.mjs fix .
node {{tells}}/bin/tells.mjs render index.html
```

Fix every error that's left. If Chrome won't start, say so in NOTES.md and carry on. If a hit is right for this subject, keep it with `<!-- tells-ok: <rule-id> <reason> -->` on that line, and list it in NOTES.md.

Finish by writing `NOTES.md`: the subject reading in two lines, where each colour and typeface comes from, the bold move, and every exception you kept. Don't ask anything, and don't wait for approval.
