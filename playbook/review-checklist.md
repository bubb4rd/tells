# Review checklist: before anyone sees it

Every item here is a correction a reviewer had to make, or an error caught just before it shipped, on real projects. Run it on the final images and screens, not the code. A screen that fails an item doesn't go out.

Run `tells check` and `tells render` first. The items tagged `render:` below are measured for you; the rest need eyes.

## The final image

- [ ] **Look at what they'll see.** Check the framed shot or the slide, not the page. Padding around content near any rounded corner; the frame's radius relates to the UI's own radii; no element jammed against an edge.
- [ ] **Consistent across a set.** Every shot in a set uses the same zoom and framing, made by one script. If a design doesn't fit, change its layout width, not the zoom.
- [ ] **One deliberate background.** No tinted panels varying from section to section.

## Content that makes it feel real

- [ ] **No empty people slots.** A real, licensed photo and a fictional name for the signed-in user; different faces for other people; no grey circles, initials, "John Doe" or lorem. `check:placeholder-copy` `render:duplicate-avatar`
- [ ] **The user appears in one place, the same on every screen.** Desktop with a sidebar: profile row at the bottom of the sidebar, no top-right avatar. Mobile with a profile tab: the tab is their photo, no header avatar. Notifications stay in the header. Account or plan switchers are separate from the profile.
- [ ] **Status and levels are marks, not grey pills.** A level or tier gets its own colour and an icon that encodes the level (for example a flag hoisted higher for bigger accounts, outlined until earned). It should catch the eye without competing with the main number.
- [ ] **Visuals carry information.** Every chart, icon or image answers something the user wants to know. No paragraphs where a quantity, position or progress could be shown.

## Data integrity

- [ ] **The numbers add up.** Totals equal their parts; averages times counts equal the net; percentages match their fractions; size × price move = P&L. Write the arithmetic as asserts in the build script.
- [ ] **One story across screens.** Same user, same accounts and IDs, same dates and "today", same rules. When one screen changes an account's state, every label that names it changes too.

## Layout at every width

- [ ] **Check 1440, 960 and 390.** Labels don't wrap or truncate; money amounts never break after the sign (wrap them in a no-wrap element that no other style targets). `render:horizontal-overflow` `render:clipped-text`
- [ ] **No new style collisions.** A wrapper or class added for one fix doesn't pick up existing rules (a `span` wrapper picking up `.row span` and losing its weight).
- [ ] **Embedded frames.** Inside a phone mockup frame, the page doesn't draw its own notch or corner radius.

## Pipeline

- [ ] **Caches are fresh.** After replacing an image under the same name, check that anything downstream re-encoded it. Verify, don't assume.
- [ ] **Blind-test hygiene.** Don't change the images in a round while someone is picking it. Rebuild the picker only after they export.
