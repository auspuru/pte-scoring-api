# IPT Brisbane — Liquid Glass PTE Emoji System

Custom 128×128 SVG reactions plus a portal-ready iPhone-style liquid-glass presentation layer for the PTE scoring portal.

## Brand source

This system follows the portal tokens already defined in `public/ipt-tokens.css`:

- IPT Blue 900: `#173B63`
- IPT Blue 700: `#205080`
- IPT Blue 100: `#E9F2FA`
- IPT Red 600: `#C53030`
- Ink: `#18202A`
- White: `#FFFFFF`

## Files

- Individual SVGs — portable static emoji assets
- `emoji-glass.css` — reusable liquid-glass wrapper and animation system
- `emoji-glass.js` — pointer-follow specular highlight, press state and off-screen animation pausing
- `preview.html` — animated showcase
- `preview.svg` — static GitHub/mobile contact sheet
- `manifest.json` — pack metadata

## Portal integration

Load the glass layer after the existing IPT tokens:

```html
<link rel="stylesheet" href="/ipt-tokens.css">
<link rel="stylesheet" href="/brand-emojis/emoji-glass.css">
<script src="/brand-emojis/emoji-glass.js" defer></script>
```

Then wrap any asset:

```html
<button class="ipt-emoji ipt-emoji--shimmer" aria-label="AI score complete">
  <img src="/brand-emojis/ai-score.svg" alt="">
</button>
```

### Animation classes

- `ipt-emoji--float` — slow vertical drift
- `ipt-emoji--pulse` — subtle depth/glow pulse
- `ipt-emoji--shimmer` — moving glass reflection
- `ipt-emoji--celebrate` — float + glow for achievements
- `data-emoji-state="active"` — stronger active treatment
- `data-emoji-state="success"` — success tint

The base `ipt-emoji` class already includes hover lift and tap compression, so continuous motion is optional.

## Accessibility and performance

- `prefers-reduced-motion: reduce` disables animation.
- Pointer-follow reflection only runs on fine pointers.
- `IntersectionObserver` pauses idle animations while assets are off screen.
- Motion uses transforms/shadows rather than layout-changing properties.
- Dark mode is supported through `body.dark` and `.dark`.

## Included reactions

IPT, PTE AI, Score 90, SWT, Essay, Speaking, Reading, Listening, Pronunciation, Fluency, Grammar, Vocabulary, Mock Test, Progress, Teacher Feedback, AI Score and Celebrate.
