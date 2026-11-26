This product already exists, and someone approved it: its look, its charts, its layout, its words. Later agents will change it, one note at a time, and they will only keep what they can see written down. Your job is to write it down. **Change nothing.** Nobody will answer questions.

**Product:** {{brief}}

**Screens** ({{layout}}):

{{screens}}

## Read first

Every file in this folder, and the screenshots of every screen as approved: `baseline/light/`{{dark}}. To see a screen again:

```sh
node {{tells}}/bin/tells.mjs measure {{targets}} --shots shots --full
```

## Write

Four files at the top of the folder, and nothing else. Any other file you change, add or delete is put back afterwards and listed in the report.

1. **`SYSTEM.md`: what exists, measured.** Not what a good system would have: what this one has, with the file and selector or function where each thing lives.
   - Type: every step in px (size/line height, weight), and where each is used.
   - Colour: every token by theme, and what each one means (which is the accent, which mark is which section).
   - Space: gutters, padding, row heights. A height unit if blocks share one, and the column split if rows share one.
   - Surfaces: how blocks are separated (cards, rules, spacing), radius, borders.
   - Charts: the chart language, its marks and where each is used.
   - Status: how state is marked (dots, ink and weight, colour).
   - The shell: navigation, top bar, how the current place is marked.
   - Copy: the voice, with three sentences quoted from the product.
2. **`CONTRACTS.md`: the shared state.** Every key the product keeps (a store, localStorage, a global), what's in it, and which screens read and write it.
3. **`APPROVED.md`: the decisions.** One line each: the decision, where it lives (`file:selector` or function), and **frozen** or **open**. Frozen unless you have a reason: every token value, the typefaces, the chart language and its marks, identity (logo, wordmark, `assets/`), the shell and navigation, the layout grid, and the facts at their real scale. Open: what's plainly unfinished (a screen that isn't built, a placeholder).
4. **`PRODUCT.md`: how a screen is built here.** The house recipe, step by step, so a later agent adds or changes a screen the way this product does it, not the way it would by default: which files a screen has, where it's registered, how it gets its data and draws its parts, and the conventions to keep (if markup is built from strings in JavaScript, that's the house style, not a defect). Name the files a screen owns and the shared files it must not edit.

Facts stay where they are: point at the data files, don't copy them.

## Last

Read your four files once more against the screenshots: a later agent who has only these and the code must be able to keep this product looking exactly as it does. Don't ask anything, and don't wait for approval.
