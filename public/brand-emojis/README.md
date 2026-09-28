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


## Semantic interaction layer

The pack now also includes `emoji-interactions.css` and `interactive-preview.html`.

Each emoji has a task-specific interaction rather than generic looping motion:

- IPT — brand spark
- PTE AI — AI scan
- Score 90 — achievement burst
- SWT — source lines collapse into a summary
- Essay — pencil writes
- Speaking — recording light and sound waves
- Reading — page flip
- Listening — expanding audio signal
- Pronunciation — pronunciation waves
- Fluency — waveform flow
- Grammar — error changes into a correction
- Vocabulary — new-word bubbles
- Mock Test — answers tick off sequentially
- Progress — bars rise with a trend line
- Teacher Feedback — feedback bubble appears
- AI Score — scan resolves to a completion check
- Celebrate — confetti burst

### Triggering interactions in the portal

The production-friendly state is `.is-active`:

```html
<span class="ipt-action-emoji is-active" data-emoji="progress">
  <img src="/brand-emojis/progress.svg" alt="">
  <span class="fx">
    <span class="bar b1"></span>
    <span class="bar b2"></span>
    <span class="bar b3"></span>
    <span class="bar b4"></span>
    <span class="wave"></span>
  </span>
</span>
```

The interactive preview uses a hidden checkbox inside each component so tapping works without JavaScript. In the real application, toggle `.is-active` when the corresponding real state/event occurs.
