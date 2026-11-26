This product was approved before you. A person has signed off on how one screen, **`{{id}}`** ({{job}}, `{{target}}`), is laid out, and wants the same layout on other screens: {{to}}. You go first: write the pattern down, and make it something the other screens can use. Nobody will answer questions.

**Product:** {{brief}}

{{notes}}

## Read first

`APPROVED.md`, `PRODUCT.md`, `SYSTEM.md`, every file `{{id}}` is drawn from ({{files}}), and the screen itself:

```sh
node {{tells}}/bin/tells.mjs measure {{target}} --shots shots --full
```

## Do

1. **`PATTERN.md`: the rules, not the content.** How `{{id}}` separates blocks (rules, spacing, surfaces), the height unit and how blocks sit on it, the column split rows share, the paddings, what happens below the breakpoints, and what stays each screen's own (its charts, its content, its order). Measured, in px, with the selector or function where each lives. Then, for each of {{to}}: one line on how its blocks map onto the pattern.
2. **Lift it into shared rules.** Where `{{id}}`'s layout lives in rules scoped to it (`.{{id}} …`, its render function), add the same rules under a shared name (a class any screen can opt into) in the shared files, and have `{{id}}` use the shared name. `{{id}}` must look exactly as it does now: its screenshot is compared after you finish. No other screen opts in yet: they look exactly as they do now too.
3. **Tokens.** Don't change a token's value; a new token for the pattern (a height unit, say) is fine. List every token you add or change under "Tokens changed" (below).

## Write

At the end of `POLISH.md` (create it if it isn't there), add `## Round {{round}}`: what you lifted, from where to where, and `### Tokens changed`, each one with why, or "none".

## Last

Screenshot `{{target}}` again, compare it with `shots/` from before, and look twice. Don't ask anything, and don't wait for approval.
