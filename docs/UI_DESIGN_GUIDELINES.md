# UI design guidelines

Ourchival should feel like a focused tool, not a control panel. The user should
be able to name the next useful action at a glance.

## Start with the current job

Every surface and every meaningful state gets one dominant job.

- Put one primary action in the first viewport.
- Order controls by the user's current context, not by implementation history.
- Remove actions that cannot work in the current state. Do not lead with a wall
  of disabled controls.
- Put prerequisites before dependent actions. If the Clipper is unpaired, the
  pairing flow is the whole popup until pairing succeeds.
- Keep status, progress, pause/retry, and the action they describe together.

Before implementation, write the sentence: “Here, the user is trying to …”.
Anything that does not help that sentence belongs later, behind disclosure, or
on another surface.

## Progressive disclosure

The first viewport is scarce.

- Show the ordinary path directly.
- Put infrequent imports, diagnostics, raw payloads, and connection management
  in clearly named secondary sections.
- Prefer a small choice followed by its controls over presenting every mode at
  once.
- Keep destructive or account-management actions available but visually
  separate from the routine workflow.
- A setup flow must fit without scrolling to discover its required button.

For a 420 × 590 browser popup, aim for one primary workflow and at most two
compact secondary entry points above the fold. If content exceeds that budget,
split it into states or move it behind `details`.

## Make the next action obvious

- Button labels describe the result: “Start Likes import”, “Pair this browser”,
  “Pause after this chunk”.
- Supporting copy explains only what the user needs to decide now.
- Do not expose backend vocabulary when a product term exists. Ask for
  “Ourchival address”, not “Convex site URL”, unless diagnosing.
- Give safe defaults. Production pairing should prefill the normal Ourchival
  address and a recognizable device name.
- On success, replace setup with the working state instead of leaving both
  visible.
- On failure, say what failed, whether progress was preserved, and the next
  recovery action.

## Reduce interaction cost

- Ordinary actions should take one click after setup.
- Preserve scroll position, selections, checkpoints, and partially completed
  work.
- Never make the user copy a value between two nearby Ourchival surfaces when
  the product can carry it safely itself.
- Keep browser-extension controls pinnable and document the expected pinned
  control in setup guidance.
- Test keyboard, pointer, narrow viewport, and remote-desktop operation. A
  control that exists but is hard to reach is a bug.

## Visual hierarchy

- Use size, contrast, spacing, and placement to establish one clear primary
  action; do not rely on several equally loud cards.
- Group by user task rather than data or service boundary.
- Favor short labels and progressive detail over repeated explanatory text.
- Keep dense content for the archive grid; keep setup and utility surfaces
  calm and sparse.
- Empty states should teach one next action, not enumerate the whole product.

## Review checklist

For every changed surface, verify:

1. What is the one dominant job in each state?
2. Is its action visible without scrolling?
3. Are impossible actions absent rather than merely disabled?
4. Are secondary workflows behind clear disclosure?
5. Does the copy use Ourchival language rather than backend language?
6. Are progress and recovery local to the action?
7. Can a first-time user complete the flow without outside explanation?
8. Does it still work at the smallest supported viewport and through remote
   desktop input?

Capture screenshots for setup, active, success, empty, and error states when a
change affects hierarchy. Reject the design if the next required action is
ambiguous in any one of them.
