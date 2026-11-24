# tells

A tell is the mark that gives a screen away as default output: the uppercase eyebrow over every heading, the purple gradient, the pill buttons, the three cards with icons in tinted squares, "Get started →".

tells is three things:

- **A rule set** ([`rules/anti-slop.md`](rules/anti-slop.md)) that names those marks and says what to do instead.
- **Two linters** that catch the ones a machine can catch: `tells check` reads source, `tells render` loads pages in headless Chrome. `tells fix` rewrites the hits that have one right answer.
- **A playbook** ([`playbook/`](playbook)) for building a design system from a subject, reviewing it, and testing taste with blind pairwise picks.

It's built for product UI: dashboards, tools and apps people use every day. It runs on plain Node 20 and has no dependencies.

## Why checkable rules

The rules came out of over a thousand blind pairwise picks between generated designs and professional work. Two things held up:

1. Rules you can check (contrast, tap targets, pills, eyebrows) moved results. Rules about feel ("looks templated") didn't, and an LLM judge using them marked down plain, finished UI.
2. Left alone, a generator drifts back to whatever won last time. Banning a look isn't enough; every replacement needs a reason from the subject.

So the linters enforce the checkable half, and each exception has to be written down. See [`playbook/taste.md`](playbook/taste.md) for the method and the evidence.

## Use

```sh
git clone https://github.com/bubb4rd/tells && cd tells
node bin/tells.mjs check ../my-app/src
node bin/tells.mjs render ../my-app/dist/index.html https://localhost:3000
```

Or link it once with `npm link` and call `tells` anywhere.

```
tells check  [paths...]        Static audit of HTML, CSS, JSX, TSX and MDX source
tells fix    [paths...]        Rewrite the hits that have one right answer, then report the rest
tells render [files|dirs|urls] Rendered audit in headless Chrome at 1440, 960 and 390px
tells rules  [check|render]    List every rule with its severity and fix

--json          Machine-readable output
--strict        Fail on warnings as well as errors
--rule <id>     Run one rule
--dry-run       fix: show what would change, write nothing
--radius <css>  fix: radius that replaces pills (default 6px)
--widths a,b,c  Viewport widths for render
```

All three exit 1 when errors are left, so they work in CI as they are. `render` needs Chrome or Chromium; set `CHROME_PATH` if it isn't in a standard place. Files with `mobile` in their path render at 390px only, unless you pass `--widths`.

### Fixing

`tells fix` handles six rules where the right answer doesn't depend on the subject. It touches only open hits, never a line with a `tells-ok`, and running it twice changes nothing the second time.

- `transition-all` becomes a named list: the usual hover and focus properties, plus whatever this element actually changes. For JSX that means its variant and conditional classes and its `style={{}}` keys; for CSS, the properties its `:hover`, `[aria-*]` and `.is-*` rules set.
- `pill-radius` swaps each pill-sized value for `--radius` (default `6px`), so `9999px 9999px 0 0` keeps its square corners. A full radius on a square box is a circle, and isn't flagged.
- `bounce-easing` becomes `cubic-bezier(0.2, 0, 0, 1)`, and spring `bounce` becomes 0.
- `arrow-suffix` drops the arrow after the label. A lone arrow, as in `<kbd>→</kbd>`, is content, so it stays.
- `reduced-motion-guard` adds one `prefers-reduced-motion` block to CSS and HTML. In JSX the motion library decides, so it's left for you.
- `placeholder-copy` replaces John and Jane Doe and `@username` with realistic names, varied by file. Lorem ipsum and Acme need real copy and stay in the report.

Everything else needs a decision about the subject: copy, colour, type and layout. Those stay in the report that follows the fixes.

### Exceptions

Some tells are right for a subject. Allow one hit with a comment on the same line or the line above, naming the rule and the reason:

```html
<div class="menu"> <!-- tells-ok: glass the menu sits over live map tiles -->
```

```css
.avatar { border-radius: 999px; } /* tells-ok: pill-radius avatars are circles */
```

A `tells-ok` with no reason, or with a rule that doesn't exist, is itself an error. `slop-ok:` works as an alias.

## With Claude Code

The repo is a Claude Code plugin. Add it, and the `tells` skill loads the rules before UI work and runs both linters after:

```
/plugin marketplace add bubb4rd/tells
/plugin install tells@tells
```

## Rules

`tells check`

<!-- rules:check -->
| Rule | Severity | Category | `tells fix` | Fix |
|---|---|---|---|---|
| `eyebrow-copy` | error | copy |  | Drop the eyebrow. If the info matters, put it in the heading or a real metadata line the reader uses. |
| `decorative-data` | warn | copy |  | Keep data only if the screen's user reads and acts on it; invented precision is texture. |
| `status-theatre` | error | copy |  | Remove LIVE/BETA/NEW badges and status lines on things that have no status. |
| `fake-shortcut` | error | copy |  | Remove ⌘K / ↵ hints unless the shortcut actually exists. |
| `dot-triplet` | error | copy |  | Tagline rhythm ("Fast · Secure · Simple"). Write a sentence that says what it is. |
| `dot-separator` | warn | copy |  | Dot + label reads as an eyebrow. Make it a real metadata line or cut it. |
| `em-dash` | warn | copy |  | At most one em-dash per screen. Rewrite with a full stop or comma. |
| `arrow-suffix` | error | copy | yes | Drop the arrow suffix. Buttons name the actual action. |
| `generic-cta` | error | copy |  | Not "Get started" / "Learn more" / "Explore". Buttons name the actual action. |
| `meta-copy` | warn | copy |  | The page narrates itself. Demonstrate instead; explanation belongs in DESIGN.md. |
| `spec-adjective` | warn | copy |  | Cut the adjective. A spec sentence is a rule or a reason. |
| `placeholder-copy` | error | copy | yes | Replace placeholder names/copy (John/Jane Doe, @username, lorem ipsum, TODO) with realistic product data. |
| `tracked-caps` | warn | type |  | Uppercase + letter-spacing on small labels is default-off. Use sentence case and the system's own hierarchy. |
| `uppercase` | warn | type |  | Uppercase is default-off. Justify it or use sentence case. |
| `gradient-text` | error | type |  | Gradient text: never. Use a solid colour. |
| `italic-accent` | error | type |  | Drop the italic accent word. The headline says what the thing is or does. |
| `default-font` | warn | type |  | Default face. Justify it from the subject and name 2 rejected alternatives, or choose another. |
| `purple-default` | error | color |  | Purple/indigo is a default, not a choice. Derive the colour from the subject; every colour needs an origin. |
| `gradient-count` | warn | color |  | More than 6 gradients. Each one needs a reason; remove the decorative ones. |
| `pill-radius` | error | components | yes | No pills or capsules. Use the system's own radius. |
| `glass` | error | components |  | No backdrop-filter except over real content (menus, overlays). |
| `emoji-sparkle` | error | components |  | No emoji or sparkle icons. One consistent icon set, or none. |
| `side-tab` | error | components |  | No coloured left-border callouts. Use spacing, typography or the system's own surface hierarchy. |
| `numbered-section` | warn | layout |  | Numbered sections ("01 / PALETTE") are bento-by-default. Let content order carry the sequence. |
| `glow-blur` | error | decoration |  | Remove blurred blobs, orbs and radial glows. |
| `ambient-motion` | error | motion |  | No ambient looping motion. One purposeful transition tied to a user action, gated by prefers-reduced-motion. |
| `bounce-easing` | error | motion | yes | No bounce/overshoot easing (cubic-bezier y outside [0,1] or non-zero spring bounce). Use ease-out or cubic-bezier(0.2, 0, 0, 1). |
| `transition-all` | warn | motion | yes | Name the exact animated properties; never use transition: all or will-change: all. |
| `reduced-motion-guard` | warn | motion | yes | Gate keyframes and movement/scale/filter animations behind prefers-reduced-motion, motion-safe:, or MotionConfig. |
| `ok-reason` | error | meta |  | Every exception is written down: tells-ok: <rule-id> <reason>. |
| `ok-unknown` | error | meta |  | tells-ok names a rule id that doesn't exist. Check `tells rules`. |
<!-- /rules:check -->

`tells render`

<!-- rules:render -->
| Rule | Severity | Category | Fix |
|---|---|---|---|
| `horizontal-overflow` | error | layout | Eliminate horizontal overflow (scrollWidth > viewport width) at every tested width. |
| `clipped-text` | warn | layout | Prevent text clipping or descender cut-off inside overflow:hidden containers (check wrapping, width, and line-height). |
| `cramped-padding` | warn | layout | Give bordered/surface containers at least 8px padding on non-zero sides. |
| `tall-top-nav` | warn | layout | Keep desktop top navigation on a single line and <= 80px tall. |
| `low-contrast` | error | color | Meet WCAG AA contrast: >= 4.5:1 for normal text, >= 3:1 for large text (>= 24px or >= 18.66px bold). |
| `tiny-text` | warn | type | Keep readable text >= 12px at mobile widths (and never < 10px anywhere). |
| `long-measure` | warn | type | Constrain multi-line prose blocks to <= 80ch for readability. |
| `flat-type-hierarchy` | warn | type | Establish clear type hierarchy: largest heading should be >= 1.2x body font size. |
| `small-tap-target` | warn | mobile | Make mobile interactive controls at least 44x44px (or expand their hit area). |
| `concentric-radius` | warn | surfaces | Match concentric radii on tightly inset surfaces (outerRadius = innerRadius + padding + borderWidth). |
| `broken-image` | error | media | Fix broken image asset (naturalWidth === 0). |
| `duplicate-avatar` | error | media | Never reuse the same portrait/avatar image for two different people or duplicate the signed-in user avatar. |
| `skipped-heading` | warn | a11y | Do not skip heading levels (e.g. h1 -> h3); step down sequentially. |
| `missing-focus-ring` | warn | a11y | Never set outline: none/0 on :focus without a visible replacement (box-shadow, border-color, or :focus-visible ring). |
<!-- /rules:render -->

The full rule set, including the rules no linter can check, is in [`rules/anti-slop.md`](rules/anti-slop.md).

## Contributing

New tells, false positives and better fixes are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code is [MIT](LICENSE). The rules and playbook (`rules/`, `playbook/`) are [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
