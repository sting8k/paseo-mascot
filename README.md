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

## Dragging

Drag the mascot anywhere in the window. The drop point is saved in
`settings.mascot.position` and clamped to the viewport on every mount. Dragging moves
the host button itself, so the picker opens next to the mascot wherever it stands. A
press under 4px still counts as a click and opens the picker; a real drag swallows the
click it would otherwise produce.

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
