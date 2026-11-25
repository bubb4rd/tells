# Anti-slop rules

This is an audit for **template chrome**: the filler models add when nobody made a decision. It is not a ban on aesthetics. A look from the cliché clusters, caps labels, mono specs or a gradient is fine when it's grounded in named references and the brand, and executed specifically. It's slop when it's there by default. Run it after the design exists, never instead of designing.

Every item here is **off by default**.

An item comes back only if it passes the removal test: *take it out. Does the reader lose information or an action?* If not, it stays out. Write down every exception and why it earned its place.

**Don't strip to nothing.** These rules remove decoration, not visuals. A screen of words and rules is also a failure: structure without taste. Imagery, icons and charts are welcome when each one carries information the user wants. Examples: a drawing generated from the record's data, an icon on an action, a chart of a number someone checks daily. Test each visual the same way as everything else: remove it, and does the user lose something?

**Don't substitute.** When something is banned, don't reach for its nearest neighbour (indigo to emerald, Inter to Space Grotesk, glass to "frosted paper", pill to 20px radius). Go back to the subject and derive a choice from it.

**Don't fall back to the last winner.** These rules only take things away. With nothing positive in their place, every subject falls back to whatever survived last time (cluster 6). The positive half lives in the print brief (`playbook/design-system.md`, Phase 3): grid, type scale, measure, typeface lineage and colour role, each derived from the subject. This file is the check, and the print brief is the source.

## How to read the tags

- `` `check:<id>` `` is caught by `tells check`, the static linter.
- `` `render:<id>` `` is caught by `tells render`, the rendered audit in headless Chrome.
- `` `same:<id>` `` is caught by `tells same`, which compares a design's tokens with the cliché clusters and with your other designs.
- **(judgment)** means no tool catches it. A person has to look.

---

## 1. Copy

- **Eyebrows.** A small uppercase or mono label above a heading: `DESIGN SYSTEM 03 · VERDIGRIS`, `01 / PALETTE`, `— FEATURES`, a dot + label. If the information matters (date, issue, category), put it in the heading or in a real metadata line the reader uses. `check:eyebrow-copy` `check:dot-separator`
- **Self-referential / meta copy.** UI text that narrates the design, the system, or the page's own features. Examples: "A carbon-first design system machined with 5-step graphite elevation", "Click any tile to copy its hex", "Author model: Gemini". The page should demonstrate, not explain itself. Explanation belongs in `DESIGN.md`. `check:meta-copy` (partial; most of this is judgment)
- **Decorative data.** Invented specifics used as texture, not information. Examples: coordinates (`34°27′N`), `FIG. 01`, `[SYS.GRID.12]`, SKUs, kernel versions, region codes, `ZRH 04:46:53`, `99.994%`. Data is fine when the screen's user would actually read and act on it. It's slop when it only makes the page *look* precise. `check:decorative-data`
- **Status theatre.** Pulsing "Live" or "Ready" dots, `34 EDGE POPS`, "All systems operational", "Commissions open Q1 2027", "Now in beta". `check:status-theatre`
- **Fake affordances.** `⌘K` badges, `↵ generate` hint rows and "Watch the reel" links when the feature doesn't exist. `check:fake-shortcut`
- **Tagline rhythm.** "Build faster. Ship smarter."; "Fast · Secure · Simple"; triads of adjectives; "Not just X, it's Y"; a closing em-dash flourish. At most one em-dash per screen. `check:dot-triplet` `check:em-dash`
- **The poetic headline.** "The quiet weight of *limestone* & ink." / "Sound shaped in *cast mineral* & patina." / "Precision in motion." The headline should say what the thing is or does, in the subject's own words. (judgment; the italic accent is `check:italic-accent`)
- **Generic CTAs and arrow suffixes.** "Get started", "Explore", "Learn more", "Inspect tokens", "Browse full index →". Buttons name the actual action. `check:generic-cta` `check:arrow-suffix`
- **Fake social proof.** Invented testimonials, logos, user counts or ratings. (judgment)

## 2. Typography

- **The italic accent word.** One word set in italic serif (often coloured) inside a headline. `check:italic-accent`
- **Mono as costume.** Monospace for anything other than code, tabular figures, or values people copy. Uppercase tracked mono captions especially. `render:mono-costume`
- **Uppercase + letter-spacing on small labels.** Default-off. `check:tracked-caps` `check:uppercase`
- **Gradient text.** Never. `check:gradient-text`
- **Default faces.** Inter, Geist, Instrument Sans, Public Sans, Space Grotesk, Instrument Serif, Plus Jakarta Sans, Manrope, DM Sans, Syne, Fraunces, Newsreader, JetBrains Mono, IBM Plex Mono. The list grows: a face that was a fresh choice a year ago becomes the next default once every generator reaches for it. These aren't banned forever, but choosing one requires a reason from the subject *and* naming two alternatives you considered and rejected. `check:default-font`
- **Size as the only hierarchy.** A giant hero headline that is the whole idea. Hierarchy should also come from position, weight, spacing and content order. (judgment; a flat hierarchy is `render:flat-type-hierarchy`)
- **Unaligned figures.** Numeric table columns and changing values should use `font-variant-numeric: tabular-nums`. `render:missing-tabular-nums`

## 3. Colour: the cliché clusters

Anthropic's frontend-design skill names the first five as defaults rather than choices. Generated design systems land in them again and again. A direction that lands in a cluster *by default* gets thrown out, however well it's executed.

What a cluster bans is the whole default package, not its parts. Clusters 1 and 3 are print traditions (the book serif, the Swiss grid). Their parts come back when the print brief (`playbook/design-system.md`, Phase 3) derives them from the subject. Example: a transit timetable earns a Swiss grid, condensed grotesk and tabular figures because its own printed timetables use them, while its colour and surface still come from the operator. Name the printed source and what it gives. "It looks editorial" is not a source.

| # | Cluster | Typical premium name it ships under |
|---|---|---|
| 1 | Warm cream/bone paper (~`#F4F1EA`) + high-contrast serif + terracotta/vermilion accent. `same:cluster-warm-paper` | "Kintsugi Editorial" |
| 2 | Near-black (`#0B0B0B`/`#111`) + one acid accent (cyan, green, vermilion), hairline borders. `same:cluster-acid-dark` | "Obsidian Telemetry" |
| 3 | Broadsheet / neo-Swiss: hairline rules, zero radius, exposed grid, condensed grotesk, red + blue. `same:cluster-neo-swiss` | "Helvetia Kinetic" |
| 4 | Dark void + glass + glow, violet/coral washes, pointer sheen. `same:cluster-glow-void` | "Lumina Prism" |
| 5 | Soft commerce: putty/beige + forest green or emerald + brass, pill buttons, italic serif notes. `same:cluster-soft-commerce` | "Verdigris Atelier" |
| 6 | **Your own house style.** The look your generator drifts to once the first five are banned. In our runs it was a white or `#f6f7f9` page, `#e5e7ed` hairlines, `#0d1117` ink, one saturated accent, a neutral grotesk and 14–20px cards. Yours will differ. `tells same` finds it from the tokens of your other systems. `same:house-style` | Whatever won last time |

Cluster 6 isn't wrong for the subject where it was first tested and won. It's wrong as the starting point for every other subject. If a new system shares most of its tokens with a sibling, write down why this subject earns the look, or derive a new one. `same:house-style` `same:token-copy`

Also out: purple to blue gradients, an accent rainbow (a new colour per badge with no shared meaning), and a dark sidebar split against a light canvas. `check:purple-default` `check:gradient-count` `render:accent-rainbow` `render:split-surface`

**Every colour in the palette needs an origin**: where it comes from in the subject (a material, a place, a document, a real product). "It feels premium" isn't an origin. (judgment)

Text must stay readable on its background: 4.5:1 for normal text, 3:1 for large text. `render:low-contrast`

## 4. Components

- **Pills.** Pill buttons, pill badges, pill tags, pill chip rows, floating capsule navbars. Use the system's own radius. `check:pill-radius`
- **Badges.** NEW / BETA / LIVE / v2.0 above the hero; coloured status dots on things that have no status. `check:status-theatre`
- **The icon-on-top feature grid.** 3–4 cards, an icon in a tinted square, title, two lines. `render:icon-feature-grid`
- **The stat strip.** A big number + a small uppercase label, in a row of three or four. `render:stat-strip`
- **Boxes everywhere.** Cards inside cards, borders around every block, a coloured left-border callout. `check:side-tab` `render:nested-cards`
- **Glass.** `backdrop-filter`, 10%-white borders, specular top highlights, except over real content (menus, overlays). `check:glass`
- **Emoji or sparkle icons.** Mixed icon sets. `check:emoji-sparkle`
- **Specimen tropes as the showcase.** Swatch grids with hex + contrast badges, type-ramp tables and "click to copy" plates. These belong in a plain reference sheet, not the main show. (judgment)
- **Empty people slots.** Blank or grey avatar circles, initials standing in for a photo, "John Doe", "User Name", "@username", lorem ipsum comments. A screen should read as someone already logged in, seen from their point of view. `check:placeholder-copy` `render:duplicate-avatar`
  - Give the signed-in user a fictional name and a real, licensed photo. Keep the credits next to the files.
  - Show that person in **one** place, the same on every screen. Desktop with a sidebar: a profile row at the bottom of the sidebar, with no top-right avatar. Mobile with a profile tab: the tab icon is their photo, with no header avatar. Notifications stay in the header. Account or plan switchers are separate from the profile.
  - Fill other people's slots (comments, team lists, activity) with different faces and names. Never use one face for two people.
  - For other user content (posts, uploads, product photos), source licensed material the same way and record its credit. Don't invent it as grey boxes.
  - Never use a real, identifiable person from a personal or client project without their say-so.

## 5. Layout

- **The template hero stack.** Badge or eyebrow, then headline, subline, two buttons and a generic mock. The slop is the stack, not centring: a centred hero works when it has one button, no badge, and the product or one real image below. `render:template-hero-stack`
- **The split hero.** Headline left, framed "plate" or device right. (judgment)
- **Bento by default.** Same layout repeated for every section; numbered sections. `check:numbered-section`; repetition is judgment.
- **Word-only screens.** Stripping decoration without a visual layer (charts, data drawings, icons, imagery) leaves structure without hierarchy. `render:word-only-screen`
- **Marketing page as the proof.** A design system proves itself on working screens, not on a landing page about itself. (judgment)
- **Measurable layout faults.** Horizontal scroll at any width `render:horizontal-overflow`, clipped text `render:clipped-text`, cramped container padding `render:cramped-padding`, a top nav that wraps or grows past 80px `render:tall-top-nav`, prose wider than 80ch `render:long-measure`, mismatched nested radii `render:concentric-radius`.

## 6. Decoration & motion

- Blurred blobs, orbs, radial glows, noise grain over everything, background grid overlays, scanlines. `check:glow-blur`; the rest is judgment.
- **Genre costume.** The look a subject's genre wears by default: for security, glitch and pixel-dither collages, neon cyberpunk, green-on-black terminal mono. In our picks a dithered collage landing ranked in the 6th percentile. Dither or halftone is fine as the treatment of one real photo with one subject, in one ink, about the section it sits in. (judgment)
- **Fake art.** Abstract geometric "plates" (circle + bar), CSS-drawn devices, placeholder initials and grey logo boxes. (judgment; broken images are `render:broken-image`)
- Scroll-reveal on every block, ambient pulsing/blinking, marquee tickers, hover lift on non-interactive things, pointer-tracked sheen, bounce/overshoot easing, and `transition: all` / `will-change: all`. `check:ambient-motion` `check:bounce-easing` `check:transition-all`
- But not *no* motion: one purposeful transition tied to a user action, naming the exact animated properties, gated by `prefers-reduced-motion`. `check:reduced-motion-guard`

## 7. Accessibility floor

These aren't style choices. Fail them and the screen is broken for someone.

- Skip no heading levels. `render:skipped-heading`
- Never remove a focus outline without a visible replacement. `render:missing-focus-ring`
- On mobile, tap targets at least 44×44px and text at least 12px. `render:small-tap-target` `render:tiny-text`

## 8. Process slop

- **Premium names.** "Adjective + Noun" names (Kintsugi Editorial, Obsidian Telemetry, Lumina Prism). Name the system after what it's for. (judgment)
- **Spec adjectives.** "High-voltage", "surgical", "razor-sharp", "calibrated", "stunning", "premium". A spec sentence is a rule or a reason. `check:spec-adjective`
- **Provenance theatre.** Citing research that didn't change a decision. Every citation must point to the decision it changed. (judgment)

---

## Audit

Run on the built files. Every hit is removed or justified in writing.

```bash
tells check <path>              # static rules over HTML, CSS, JSX, TSX, MDX and UI scripts
tells render <path-or-url>      # rendered rules in headless Chrome at 1440, 960 and 390
tells rules                     # list every rule with its fix
```

Both exit 1 on any error. Add `--strict` to fail on warnings too.

To keep a hit, put `tells-ok: <rule-id> <reason>` in a comment on the same line or the line above. `slop-ok:` works as an alias. An exception with no reason, or naming a rule that doesn't exist, is itself an error (`check:ok-reason`, `check:ok-unknown`).

```html
<!-- tells-ok: glass the menu sits over live map tiles -->
```

Then look at the screenshots and ask:

0. Show the first screen with no context. Can someone say what this company does at a glance? Every invented specific (a customer name, a scenario, a number) has to be about the subject. A freight firm's payroll on a security firm's hero is the failure this catches.
1. Cover the logo. Could this be any other product?
2. Which cliché cluster is this closest to, and what specifically puts it outside?
3. Where is the boldness? Is it in **one** place?
4. What would a senior designer remove? Remove it.
