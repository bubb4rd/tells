This product was approved before you. A person wants a new screen on it: **`{{id}}`**, {{job}}. Build it the way this product builds a screen, on its system, so it looks like it was always there. Nobody will answer questions. Decide, and write down why.

**Product:** {{brief}}

**The screens it has:** {{others}}

{{notes}}

## Read first

`PRODUCT.md` (how a screen is built here: follow it step by step), `APPROVED.md`, `SYSTEM.md`, `CONTRACTS.md`, and the screens nearest to this one in what they do. See them:

```sh
node {{tells}}/bin/tells.mjs measure {{targets}} --shots shots --full
```

## Do

1. **Its job, in its own shape.** Lead with what this person checks most on this screen, drawn in the product's chart language. Not every screen is a table: pick the shape the job has (a timeline, stages, a level, a ranked list) the way the other screens did.
2. **The house recipe.** The files a screen owns, its data file, its registration: exactly as `PRODUCT.md` says. Register it in the navigation the way the others are. The only shared edits are the ones the recipe names.
3. **Facts.** Sample facts in this product's world, at its real scale, consistent with the screens that already show the same things (`CONTRACTS.md`). Never invent names that contradict another screen.
4. **Keep everything else.** Every other screen must look exactly as it does now: their screenshots are compared after you finish. Don't change a token's value; list any token you add under "Tokens changed".

## Write

At the end of `POLISH.md` (create it if it isn't there), add `## Round {{round}}`: what you built, the shape you chose and why, and `### Tokens changed`, or "none".

## Check

```sh
node {{tells}}/bin/tells.mjs measure {{newTarget}} --shots shots --full
node {{tells}}/bin/tells.mjs render {{newTarget}} --strict
node {{tells}}/bin/tells.mjs consistent {{targets}} {{newTarget}} {{leadArgs}}
node {{tells}}/bin/tells.mjs click {{newTarget}} --strict
```

Open the screenshot and look twice: fix, screenshot, look again. Fix every hit on the new screen. Don't run `fix` across the product. Don't ask anything, and don't wait for approval.
