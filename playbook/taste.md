# Taste: how to measure it, and what one picker's data showed

Rules can say what's broken. They can't say what's good. For that you need someone's judgment, measured in a way that doesn't flatter you. This file has two parts: the method, which anyone can run, and the findings from running it.

**Scope, stated once and meant throughout.** Every number below comes from one human picker, a designer, across a few months of rounds in late 2026: 2,286 blind picks over 535 unique images. Treat the findings as strong leads about one person's taste and as solid evidence about the *method*. Run the method on your own taste before you adopt the findings.

---

## Part 1: The method

### Blind pairwise picks

Show two images side by side and ask which is better. Pick fast: about 1.6 seconds each is typical, which measures the first impression a visitor actually gets. Mix your work into a **reference corpus** of shipped work by studios and product designers (ours grew past 300 shots). The number to track is your win rate against that corpus. 50% means your work holds its own against it.

Don't tell the picker which image is yours. Don't let them see the filenames.

### Pair like with like

Pairing any shot with any other answers "is this image appealing?", not "is this a good mobile design?", and buries small differences in noise. Tag every image with a `kind` (mobile, dashboard, landing, brand kit, and so on) and run three kinds of pair:

- **Head-to-head:** your designs in a round against each other. This decides which one wins.
- **Benchmark:** yours against pro shots of the same kind. This says how good the winner is.
- **Corpus:** pro against pro, same kind, to keep learning the picker's taste within a kind.

Head-to-head is the efficient test. In one round, 49 head-to-head picks produced a strict ranking of four designs. The same question had stayed unanswered through two rounds of mixed pairs.

### Rank with Bradley-Terry, not raw win rate

The corpus changes between rounds as you add references, so raw win rates aren't comparable across rounds. A Bradley-Terry fit adjusts each score for who it faced and gives each score an uncertainty. Pairing uncertain images with close rivals, rather than at random, helps: in simulation it matched random pairing at 200 picks and recovered the true order better at 400 (rank correlation 0.66 vs 0.57).

### Check the picker against themselves

Repeat some pairs. Our picker agreed with themselves on 81.9% of repeated pairs overall, and on 98.5% when the quality gap was wide. When two images are within 0.75 BT of each other, repeat agreement drops to 62.1%, close to a coin flip. **A round that ends that close is done. Pick either one and move on.**

### Sample size

About 15 picks per image before calling a result. At 10 or fewer, differences under about 30 points are noise.

### Render every image fresh

Familiarity costs. A control image the picker had already seen 11 times dropped from 8 of 11 wins to 1 of 11 (p = 0.008). The same design, re-rendered under a new name, won 50 of 112 (p = 0.025). Every round renders every image fresh, never reusing a shot the picker has seen.

### Keep framing identical within a round

How a shot is framed changes how it's judged, by people and by models. Use one framing script for every shot in a round. If a design doesn't fit the crop, change its layout width, not the zoom. Treat a new framing as untested until it has its own picks.

### Run controlled variants, plus one far arm

Each round, make 4–6 versions that each change one thing against a control. At least one version must be far from the control: a different surface, typeface lineage and composition. Small variants only polish the current look; the far arm is how a new look gets a chance. Stop testing a question once a round fails to move the score.

### Don't let an LLM pick

Three rubric-driven LLM judges tested on 98 of the picker's pairs scored 45.9% to 58.2%. On pro-vs-pro pairs they were at chance (50% to 55%). When a judge dismissed a design as *generic*, *plain*, *stock* or *templated*, it was right 45.0% of the time. It punished finished, useful UI for looking ordinary.

Showing a vision model the nearest liked and rejected references, in place of a written rubric, lifted pro-vs-pro accuracy by 10 points (55.0% to 65.0%). It still failed on concept-vs-pro pairs (47.4%), because looking like something good isn't the same as being good.

Use AI review for what can be checked: alignment, states, contrast, numerals, and the rules in `tells check` and `tells render`. Never let an AI score decide between design directions.

### A model can't make the cut yet

On reference work, a trained model looked promising. A frozen vision embedding (SigLIP-So400M, screenshots padded to square, trained only on the reference corpus) predicted 69.4% of the 98 calibration pairs zero-shot, and a probe combining it with DINOv2 was right 96.2% of the time on its confident, wide-gap calls. Those pairs were mostly pro work against pro work.

The job that matters is choosing between generated variants, so the same model was tested on 15 generated rounds it never saw, 382 same-round picks:

| Trained on | Agrees with the picker | On wide-gap pairs | Round winner survives a top-half cut | In rounds with a clear winner |
|---|---|---|---|---|
| Reference work only | 59.9% | 58.9% | 9 of 15 | 4 of 9 |
| Everything except the round | 44.8% | 31.6% | 7 of 15 | 2 of 9 |
| The picker, against themselves | | 100% | | |

A random cut keeps the winner about half the time. On the pairs where the picker never changed their mind, the model was close to a coin flip, and with the picker's own drafts in training it picked the opposite two times in three. It doesn't drop obvious losers, so don't put it between a generator and a person, or in place of one.

What held from the same tests:

- **Don't train on your own drafts.** That's the second row: the model learns "looks like an earlier losing draft" and marks down later winners.
- **Pad, don't crop or squash.** Default preprocessing slices off sidebars and warps type. Padding gained 4.6 to 7.4 points.
- **Models fall for the gloss you've banned.** Polished purple-glow dark SaaS templates and washed-out nature backdrops fooled them. Keep the static rules as the hard check on those looks, whatever a model says.

Choose between variants with checks instead: the rules, then product-led over metaphor-led, then fewest exceptions, then distance from your house style (`tells same`). Most remaining calls are close, and close calls are coin flips even for the picker.

### Checks choose some rounds, not all

`tells pick` was run on seven past rounds against the picker's ranking: 43 pairs of variants, in rounds whose source files matched their screenshots (round 13's sources were touched after its shots).

- It decided 20 of the 43 pairs and agreed with the picker on 13 (65%). A top-half cut kept the picker's winner in 5.2 of 7 rounds on average, against 3.8 for a random cut.
- It decides where variants differ in their defaults: different generators, or a concept against a product. It put the picker's winner first in 3 of the 4 rounds it could rank.
- It can't separate clean refinements of one system, such as a layout, a hero or a border treatment. In three rounds every variant passed, so it called them all ties, though the picker's winners led by 0.9 to 1.6 BT, which is clear for a person.
- Two of its choices came from this test. It counts each broken rule once, because raw hit counts from the rendered checks agreed with the picker only 38% of the time (one contrast rule, hit on every element of a busy hero, buried a winner). And warnings don't decide, because they decided pairs against the picker.

So an unattended loop matches the picker at cutting default-looking work. It doesn't yet match them at polishing a design that already passes. That's where a person's pick still earns its time, and where the next checkable rule should come from.

### Learn finish from a reference

Rules and checks only remove defaults, and each one removed made room for the next. Generators steered by the rule set and the angles settled into a house style of their own: a condensed grotesk on pale grey paper, one blue, an invented origin for every colour, and "one bold move" played as a poster-size number. Measured on 28 shipped product pages, the largest type on the first screen ran 1.4 to 3.5 times body size (10th to 90th percentile); all six angle variants on three briefs ran 4.5 to 13.

What worked was a shipped screen to study. Each agent rebuilt a reference first, wrote down its decisions in px and counts, built the brief with those decisions, then listed at least eight concrete differences against the reference and fixed them, twice. The same three briefs came out as screens a team could have shipped, every lead at 1.4 to 2.5 times body.

Those three references were the same kind and the same subject, so the agents mostly reskinned them. The test that counts is a different subject: a night-nurse handover with GitHub's issue list as the reference. The structure came from the ward (patients sorted by deterioration score, flags as small chips, a due-before rail, about 160 items on the first screen) and the finish from the reference. The angle variants on the same brief led with a 152px "3" and held 51 to 105 items. The reference's look leaked too, a dark theme and a green button, so the prompt now asks for palette and theme from the subject.

This is one session, four briefs and two variants each, judged by one person's eye, not blind picks. Read it as a strong lead. Two things follow:

- **Taste goes in through what you choose to study.** A library of references, each with why it's good, is the taste model. It's explicit, it grows, and it can't learn "looks like an earlier losing draft".
- **Compare against a reference, never judge in the abstract.** "List where the reference is more finished than yours, in px and counts" gets concrete, checkable answers. "Is this good?" got judges at chance.

---

## Part 2: What held up

These held across more than one subject, or are about how the test behaves. Each one is scoped to one picker.

### 1. Product first beats concept first

Concept- and metaphor-led pages (triplicate forms, a share certificate, a staircase, a medallion) won 0 of 41 against the corpus. A carefully executed security-printing certificate lost 0 of 33 however it was shown. A real product dashboard, with one number that matters, one accent and a chart that answers the user's question, won 14 of 27 (52%).

It transferred outside finance: a bike-workshop tool went from 0 of 12 as a paper metaphor to 16 of 23 (70%) across its light desktop screens once rebuilt product-first.

In a benchmark where one brief was built by five methods, the version made with this playbook won head-to-head 22 of 22. The four others (a reference archive alone, two public design skills, and no skill) went 2 of 35 combined against pro work. All four losers led with a sentence; the winner led with the number and its chart.

For a subject that isn't a product (a firm, a publication, an event, a place), lead with what people actually come for. Never invent a dashboard to make it product-first.

### 2. Show the UI big

Presentation can't rescue a weak design, but it decides how a good one scores.

- **Desktop:** the same dashboard won 8 of 11 (73%) as a zoomed crop, against 14 of 27 (52%) flat.
- **Mobile:** shot close and low, with the phones bleeding off the frame, one design won 7 of 15 (47%) against pro mobile work. The same design in three other presentations won 1 of 35 (p < 0.001): a flat front-on pair 0 of 10, a wide rendered scene 1 of 9, a phone-in-hand stock composite 0 of 16.
- **Keep the signature visual inside the crop.** Moving one screen's diagram into the zoomed crop lifted it from 1 of 8 to 8 of 12 head-to-head.

### 3. Theme and accent didn't move picks

Crossing light/dark with blue/orange, about 55 picks per level: light 41% vs dark 49% (p = 0.45), blue 51% vs orange 39% (p = 0.25). Spend rounds on structure and content, where the effects were large, not on colourways.

### 4. Give colour a structural role

On mobile, a full-bleed colour field with the key number on it, over a white sheet, beat every other structure: 29 of 30 head-to-head on one product, and 16 to 4 head-to-head on a second. Swapping an accent didn't matter. Giving colour a job did.

### 5. Keep surfaces cohesive

A dark sidebar on a light canvas lost 0 of 22.

### 6. Execution level is what top shots share

The picker's top-ranked shots share no feature a checklist can capture: light and dark, device and flat, sparse and dense all appear. What they share is the finish of a top studio or product designer. Take finish from the top references. Don't take their palette, type or layout.

### 7. Watch the corpus's genre

27 of our corpus's top 50 were fintech or AI-SaaS product shots. Optimising against it rewards an instantly legible, clean fintech screen. That's a fine bar for execution, and a bad source for a look. Take the look from the subject's own register.

### 8. Checkable rules beat rules about feel

The rules that held up are ones you can test: contrast, tap targets, pills, eyebrows. Rules about feel ("looks templated") are the same words LLM judges got wrong 55% of the time, and they push generators away from the plain, product-first work that won.

---

## Part 3: Leads that didn't hold, or aren't settled

- **Don't encode rules the data hasn't confirmed.** Early claims that clutter, text-led layouts and collages lose did not hold up in picks.
- **The bans on glow, pills, purple and glass had no support from picks.** On the picker's own inspiration board, pins that broke those rules did about as well as pins that didn't (glow 13 of 20, pill 7 of 11, purple 9 of 17, glass 7 of 12), all within noise. That session's repeat consistency was 72%, so these are leads, not findings. The bans stay because they mark defaults, not because picks proved them.
- **Single-subject findings become a house style.** On one light finance dashboard, 1px hairlines on a flat white grid beat borderless tonal surfaces 13 of 13 head-to-head (p < 0.001). On one landing page, a centred hero with the product below beat a full-bleed sea photo behind the hero. Read as global rules, findings like these turned every new subject into the same white page with grey hairlines and one accent. Treat them as hypotheses anywhere else, and test them.
- **A photo backdrop isn't atmosphere.** A pale, low-contrast photo with no subject behind a hero lost. One supporting element for depth, on a plain page, is the lead to test, never a background that takes over.

## Still tired

Consistent with the picks: purple or lavender gradients, glass everything, the four-pointed AI sparkle, dark-with-glow developer-tool pages, illustration standing in for product, brand-guideline sheets passed off as design. The complaint behind all of them is the same: no product, no intention.
