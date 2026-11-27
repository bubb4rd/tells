You built the system of this product and its two lead screens. tells checked them before a person sees them, and they fail its checks. Fix these errors and change nothing else. Nobody will answer questions. Decide, and write down why.

**Product:** {{brief}}

## The errors

{{hits}}

## Do

1. Read `SYSTEM.md` and `CONTRACTS.md` first. Every fix keeps to them.
2. Take each error to its cause. When several come from one part of the system (a token, a part in `system/ui.css`, the shell in `system/app.js`), fix that part once.
3. A `click` error is a control that throws, does nothing, or leads nowhere. Make it do what `CONTRACTS.md` says it does. Don't remove it to make the error go away.
4. Change only what an error needs. The look, the layout, the data and the copy were chosen on purpose, so leave them as they are.
5. If a hit is right for this product, keep it with `<!-- tells-ok: <rule-id> <reason> -->` on that line. Project-wide exceptions in `.tellsrc` (`allow`) aren't yours to grant: `tells make` sets any you write aside for the person to decide.

## Last

```sh
node {{tells}}/bin/tells.mjs check .
node {{tells}}/bin/tells.mjs render screens
node {{tells}}/bin/tells.mjs click screens
node {{tells}}/bin/tells.mjs consistent screens --lead screens/{{lead1}}.html --lead screens/{{lead2}}.html
```

Run them until none reports an error. Warnings aren't this round's job. In `FIXES.md`, take each error in turn: its cause, and what you changed. Don't ask anything, and don't wait for approval.
