# paseo-mascot

A pet next to your Paseo composer: pick any character from the
[koboyo page-mascot](https://koboyo.com/page-mascot) catalogue (52 of them, plus
the fox style variants) and it sits beside the chat input, watching your cursor.

## Surfaces

- **Composer pill** — the only surface. The mascot's face fills the pill icon and
  its label shows the character's name. Click the pill to open the picker.
- **Command Center** — `Mascot: add a mascot to this composer` adds the pill to
  agents created after the plugin loaded (SDK 0.8.0 has no reactive agent list,
  so existing composers are covered by a one-shot registration at load).

## Behaviour

Ported from koboyo's own component (their sprite sheets are published for
self-hosting, and we hotlink them):

- Two 3×3 sprite sheets per character, `<name>-directions.webp` and
  `<name>-reactions.webp`, one frame per gaze direction / reaction.
- Gaze: cursor angle picks one of 8 directions, with a 70px dead zone → center.
- Poke: `blink` → `heart`/`sparkle`/`delighted` (cycling) → back; four pokes
  within 1.6s → `dizzy`. Squash-and-stretch runs 420ms on every poke.
- Idle blink every 3.6s, so the mascot is never a still image.
- Workspace status briefly flashes a reaction: needs input → `surprised`,
  done → `delighted`, failed → `sleepy`.

Selection is persisted through plugin settings (`settings.mascot`), so it
survives reloads and updates.

## Perching on the composer

Paseo renders composer pills as a BUTTON with chrome (background, border, label)
around a fixed 16px icon box with `overflow: hidden`
(`packages/app/src/plugins/buttons/view.tsx`), which would crop the mascot to a
dot. Plugin clients are evaluated in the host window, so `perchOnHostButton()`
(client/web.ts) walks up from our own icon to the BUTTON and, for that button
only: opens the clip, lets the icon box size itself, strips the chrome, and hides
the label — leaving the mascot standing on the composer row at ~59px.

Ancestors are found by behaviour (walk to the BUTTON), never by class name, and
every touched node's inline style is restored on unmount. If Paseo changes its
button internals the worst case is the old clipped pill, not a broken composer.

Geometry knobs live at the bottom of `client/mascot.tsx`:
`PILL_FACE_SCALE`, `PILL_LIFT`, `PILL_SLOT_WIDTH`, `PILL_SLOT_HEIGHT`.

The plugin is web/desktop only: `contribute()` returns immediately when
`Platform.OS !== "web"`, because the mascot perches by rewriting DOM styles and is
dragged with pointer events. On native there is no DOM to perch on, so the pill would
render as broken chrome instead of a mascot.

Three host details the perch has to work around:

- The icon box is rendered with `pointerEvents="none"`, which react-native-web writes
  as `!important`; re-enabling the pointer needs `setProperty(..., "important")`.
  Without it the mascot cannot be grabbed and clicks never reach the button.
- The host tooltip repeats `button.title` through a portal in the overlay root, so it
  cannot be stopped at the button. `suppressHostTooltip()` hides any tooltip node whose
  text is exactly our title.
- A pinned mascot is re-parented to the app's root container — still inside the React
  root, so the host's click handling and the popover anchor keep working — because the
  composer's stacking context would otherwise paint over it.

## Reactions

The two sprite sheets give nine gaze frames and nine reaction frames. Gaze has a
priority order — the user's own activity always beats ambient behaviour:

1. **Typing** — looks at the field being typed into (the nearest point of its box, so a
   wide composer seen from directly above is still "down there"). Ends 1.5s after the
   last keystroke.
2. **Glancing** — while the agent works, looks at the transcript every few seconds.
3. **Cursor** — otherwise follows the mouse.

Everything else is a short flash that hands the sprite back to the gaze, because a
reaction held forever just freezes the mascot on one frame.

| Trigger | Reaction |
| --- | --- |
| Cursor still 10s while the agent is idle | falls asleep (`sleepy`, slower bob) until the cursor moves, then `surprised` |
| Cursor parked on the mascot for 2s | `bashful`, once per stare |
| Agent working | glances at the transcript every few seconds instead of only tracking the cursor |
| Poke | `blink` into `heart`/`sparkle`/`delighted`; four rapid pokes make it `dizzy` |
| Picking a mascot | `wink` |
| Dragging | `surprised` while held, `bashful` when set down, `dizzy` when thrown (>= 1.2 px/ms) |
| Workspace status change | `surprised` on attention, `delighted` on done, `sleepy` on failure |

All of it runs through one reaction slot in `KoboyoMascot`, where the newest flash wins,
so reactions replace each other instead of fighting over the same sprite layer. Only the
nap waits for the agent to be idle; a stare or a poke lands even mid-run.

## Dragging

Drag the mascot anywhere in the window. The drop point is saved in
`settings.mascot.position` and clamped to the viewport on every mount. Dragging moves
the host button itself, so the picker opens next to the mascot wherever it stands. A
press under 4px still counts as a click and opens the picker; a real drag swallows the
click it would otherwise produce.

Drop it within 48px of its perch and it climbs back on (`position` goes back to
`null`). The perch is the host's plugin-pill row, a separate layer just above the chat
box — not the model/thinking button row inside it. Its emptied slot is `display:
contents` inside a collapsed wrapper, so the only honest way to know where the perch is
at drop time is to seat the button back for one synchronous measurement and lift it
again; no frame ever shows the round trip.

Three host details the perch has to deal with:

- The icon box is rendered with `pointerEvents="none"`, which react-native-web
  writes as `!important`, so re-enabling the pointer needs `setProperty(..., "important")`.
  Without it the mascot cannot be grabbed and clicks never reach the button.
- The host tooltip repeats `button.title` through a portal in the overlay root, so
  it cannot be stopped at the button: `suppressHostTooltip()` hides any tooltip node
  whose text is exactly our title.
- A pinned mascot is re-parented to the app's root container (still inside the React
  root, so the host's click handling and the popover anchor keep working), because the
  composer's stacking context would otherwise paint over it.

## Reactions

The two sprite sheets give nine gaze frames and nine reaction frames. Gaze has a
priority order — the user's own activity always beats ambient behaviour:

1. **Typing** — looks at the field being typed into (the nearest point of its box, so a
   wide composer seen from directly above is still "down there"). Ends 1.5s after the
   last keystroke.
2. **Glancing** — while the agent works, looks at the transcript every few seconds.
3. **Cursor** — otherwise follows the mouse.

Everything else is a short flash that hands the sprite back to the gaze, because a
reaction held forever just freezes the mascot on one frame.

| Trigger | Reaction |
| --- | --- |
| Cursor still 10s while the agent is idle | falls asleep (`sleepy`, slower bob) until the cursor moves, then `surprised` |
| Cursor parked on the mascot for 2s | `bashful`, once per stare |
| Agent working | glances at the transcript every few seconds instead of only tracking the cursor |
| Poke | `blink` into `heart`/`sparkle`/`delighted`; four rapid pokes make it `dizzy` |
| Picking a mascot | `wink` |
| Dragging | `surprised` while held, `bashful` when set down, `dizzy` when thrown (>= 1.2 px/ms) |
| Workspace status change | `surprised` on attention, `delighted` on done, `sleepy` on failure |

All of it runs through one reaction slot in `KoboyoMascot`, where the newest flash wins,
so reactions replace each other instead of fighting over the same sprite layer. Only the
nap waits for the agent to be idle; a stare or a poke lands even mid-run.

## Dragging

Drag the mascot anywhere in the window; the drop point is saved in
`settings.mascot.position` and clamped to the viewport on every mount. Dragging moves
the host button itself, so the picker popover opens next to the mascot wherever it
stands. A press under 4px still counts as a click and opens the picker; a real drag
swallows the click it would otherwise produce.

## Development

```bash
npm install
npm run typecheck
paseo plugin reload paseo-mascot   # hot-swaps the plugin in the running daemon
```
