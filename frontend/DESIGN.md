# Elevate design system

Read this before you build or change any UI in `frontend/`. It covers the marketing site
(`src/app/(marketing)`) and the workspace (`/workspace`). Both use one palette, one type system
and one set of shapes, so a workspace screen should look like it belongs next to the landing page.

The tokens in `src/app/globals.css` are the source of truth. This file explains how to use them.
If the two disagree, the CSS wins: fix this file in the same change.

---

## 1. Design direction

**Elevate is a calm instrument with cinematic moments.**

Our users are network engineers and customer care staff. They ask questions about places under
time pressure: an outage, a flood, a complaint that keeps coming back. The workspace must feel
like a precise, quiet tool. The map and the answer are the loudest things on the screen.

The marketing site tells the same story at a higher volume: night-sky photography, cinematic dark
bands, a serif headline. It is the same brand, not a different one.

The reference is Ideogram's site and workspace: an editorial serif, one lavender accent, pill
buttons and hairline borders.

### Principles

1. **The map and the answer lead.** Keep the chrome quiet: hairline borders, flat surfaces, no
   gradients or decorative art in the workspace. The side panel is frosted glass, so the map stays
   visible behind the chat.
2. **One accent, used rarely.** Lavender marks the one primary action in a view (Open workspace,
   Send, Approve, Generate). If everything is lavender, nothing stands out.
3. **Ink, not gray.** Text and dark surfaces carry a faint violet (ink `#1f1b2d`, night
   `#14111d`). Never use Tailwind's `zinc`, `neutral`, `slate` or `gray` scales.
4. **Color means status.** Each hue has one meaning (see [3.3](#33-status-hues)). Never use a
   status hue for decoration.
5. **Pills act, rectangles hold.** Anything you press is a pill. Anything that holds content is a
   rounded rectangle.
6. **The serif is the brand voice, so use it rarely.** Newsreader appears in the wordmark and in
   hero-size display text only. Everything else is Inter.
7. **Show the human in the loop.** A risky action shows who must approve it, in amber, with a
   lavender Approve button. Synthetic data and experimental output are always labeled.
8. **Plain words.** Short sentences, sentence case, no exclamation marks.

---

## 2. Where things live

| What | File |
| --- | --- |
| Palette and all tokens | `src/app/globals.css` |
| Fonts (Inter, Newsreader, Geist Mono) | `src/app/layout.tsx` |
| Logo | `src/components/wordmark.tsx` |
| App bar | `src/components/top-bar.tsx` |
| Workspace primitives (shadcn) | `src/components/ui/*` |
| Site primitives (`PillLink`, `Chip`, `SectionHeading`, `MockCard`) | `src/components/marketing/primitives.tsx` |
| kepler.gl theme (literal hex mirror of the tokens) | `src/components/map/kepler-theme.ts` |
| Overrides for styles kepler hard-codes | `src/app/globals.css` (after the Radix rule) |
| Example prompts (site Ask section and empty chat) | `src/lib/example-prompts.ts` |

---

## 3. Color

### 3.1 Palette

Every color starts as a `--palette-*` variable at the top of `globals.css`. To change a color,
change it there, never inside a scope. Components never use `--palette-*` or hex values directly;
they use the scope tokens in [3.2](#32-which-token-to-use).

| Palette token | Value | Role |
| --- | --- | --- |
| `paper` | `#ffffff` | Light page and cards |
| `mist` | `#f6f5f8` | Light subtle surface |
| `ink` | `#1f1b2d` | Text on light; ink buttons |
| `ink-muted` | `#59566a` | Secondary text on light |
| `ink-faint` | `#6b6879` | Tertiary text on light (site only) |
| `ink-line` / `ink-line-strong` | black at 8% / 15% | Hairlines / input borders on light |
| `night` | `#14111d` | Dark page and side panel |
| `night-surface` | `#1c1927` | Dark cards and popovers |
| `night-raised` | `#25212f` | Dark subtle surface |
| `snow` | `#fafafa` | Text on dark |
| `snow-muted` / `snow-faint` | `#b3b0bf` / `#8f8c9c` | Secondary / tertiary text on dark |
| `snow-line` / `snow-line-strong` | white at 10% / 20% | Hairlines / input borders on dark |
| `lavender` | `#bd9fff` | The brand accent |
| `lavender-hover` | `#cdb6ff` | Brand hover |
| `lavender-ink` | `#1b1528` | Text on lavender |

Each status hue has two shades. The light-surface shade is at least 4.5:1 on white. The
dark-surface shade is bright and meant for night surfaces.

| Hue | On light | On dark |
| --- | --- | --- |
| green | `#15803d` | `#3ddc84` |
| amber | `#b45309` | `#ffb224` |
| red | `#c81e1e` | `#ff6b78` |
| blue | `#2563eb` | `#6aa6ff` |
| magenta | `#be185d` | `#ff5cb3` |
| teal | `#0f766e` | `#19e6c1` |
| violet | `#6d4aff` | `#b79bff` |

### 3.2 Which token to use

| Role | Workspace (shadcn) | Site (`.marketing`) |
| --- | --- | --- |
| Page | `bg-background` | `bg-mk-bg` |
| Card, panel | `bg-card` | `bg-mk-raised` |
| Subtle surface | `bg-muted` | `bg-mk-surface` |
| Text | `text-foreground` | `text-mk-fg` |
| Secondary text | `text-muted-foreground` | `text-mk-muted` |
| Tertiary text | (none: use `text-muted-foreground`) | `text-mk-faint` |
| Hairline | `border` (default color) | `border-mk-line` |
| Input border | `border-input` | `border-mk-line-strong` |
| Hover fill | `hover:bg-accent` | `hover:bg-mk-fg/[0.06]` |
| Primary action | `bg-brand text-brand-foreground` | `bg-mk-brand text-mk-brand-fg` |
| Ink action | `bg-primary text-primary-foreground` | `bg-mk-fg text-mk-on-fg` |
| Status hue | `text-green`, `bg-amber/10`, `border-red/30` … | `text-mk-green`, `bg-mk-amber/10` … |
| Focus | `ring-ring` (set by the primitives) | `--ring` (global `:focus-visible` rule) |

**Dark mode.**

- **Workspace:** the theme toggle sets `.dark` on `<html>` and saves the choice under
  `elevate-theme`. Every token flips, and the status hues switch to their bright shades. Write
  each component once with tokens. Add a `dark:` override only when no token can express the
  difference.
- **Site:** the body is always light, whatever the workspace theme is. Wrap a block in `.mk-dark`
  for a night band, or in `.mk-lavender` for the lavender band. Components inside it keep using
  `mk-*` tokens and flip automatically.

### 3.3 Status hues

Each hue has one meaning. Pick the hue by meaning, never by looks.

| Hue | Meaning | Examples |
| --- | --- | --- |
| green | Healthy, done, connected, approved, back under threshold | Tower UP, finished stage, "Connected", "Resolved" |
| amber | Needs attention or a human: degraded, warning, approval pending, a threshold | Approval box, DEGRADED, overload line, model warnings |
| red | Down, failed, rolled back, destructive | Tower DOWN, errors, the Roll back stage |
| blue | Place and geography, weather, live data | Area card, weather tag, the `live` text style |
| magenta | Self-heal: actions the system takes on the network | Self-heal icon tile, the retry loop |
| violet | Work in progress | "Running" chip |
| teal | Extra data category, when the hues above are taken | Weekend routine |

Chart series use this order: violet, blue, teal, magenta. Amber is kept for threshold lines.

Show status with a word or an icon as well as the color. Color must never be the only signal.

### 3.4 Map colors

The map follows the Menara command center's map (the `menara-command-tower` repo, its
`static/index.html`).

**Basemaps** (`components/map/basemaps.ts`): Protomaps' vector styles over self-hosted
OpenStreetMap tiles (`npm run basemap`, see the README), so roads and labels stay sharp at any zoom.

- `elevate-dark`: warm near-black land, blue-grey sea and dark green woods. `elevate-light`: the
  same map, quiet and desaturated. Both are Protomaps' flavors with colors sampled from the raster
  fallback, so the two read as the same map.
- Without the tile files, the same ids fall back to OpenStreetMap's standard raster tiles. Its
  dark map is the tiles inverted, hue-rotated 195°, dimmed and desaturated, as the reference does
  with a CSS filter. Here it is MapLibre raster paint, so the data layers on top are never filtered.
- The theme picks one (`BASEMAP_FOR_THEME`). Chats saved on the old CARTO basemaps switch to them
  too.
- kepler misses the basemap's credit on first load, so `kepler-map.tsx` re-announces the style once
  the map is idle. Keep that: OpenStreetMap's license requires the credit.

**Colors.** kepler draws layers with literal hex values, taken from `lib/map-colors.ts`. They are
bright for the dark basemap and still readable on the light one, so they are not the text-safe
tokens.

| Layer | Color |
| --- | --- |
| Tower UP / DEGRADED / DOWN / UNKNOWN | `#2ee59d` / `#ffc83d` / `#ff4d6d` / `#8a93a8` (`TOWER_STATUS_COLOR`) |
| Down-tower marker | 14px DOWN core with a glow, plus two 32px rings pulsing out of it (2s, 1s apart), drawn by `tower-pulse.tsx` |
| Weather exposure low / elevated / high | `#22c55e` / `#f59e0b` / `#ef4444` |
| Area outline | `#7c5cff` |
| Subscriber trail | `#ec4899` |
| Density ramp | `#e2d6ff` → `#3d2a99` (lavender) |

Rules:

- A legend chip in a panel uses the same hue family as its layer.
- **New map:** a new chat's map opens on Peninsular Malaysia (`PENINSULA_VIEW` in `kepler-store.ts`)
  with only the towers that are DOWN, as reported by the tower MCP, each drawn with the down-tower
  marker. The markers follow the "Towers down" layer: hide it and they go. With reduced motion,
  the rings hold still.
- `kepler-theme.ts` repeats the palette as hex, because kepler does color math on its theme values.
  When you change the palette, update that file too.
- Some kepler styles have no theme key (for example the panel title's weight and letter-spacing).
  Override them in `globals.css` with a two-class selector, such as
  `.side-panel__content .panel-title`. That beats the single class that styled-components
  generates.

---

## 4. Typography

| Font | Utility | Use |
| --- | --- | --- |
| Inter | `font-sans` (the default) | All UI and body text |
| Newsreader 400/500 | `font-display` | The wordmark and hero-size display text only |
| Geist Mono | `font-mono` | Tool names, IDs, hashes, code |

| Role | Classes | Where |
| --- | --- | --- |
| Hero display | `font-display font-normal leading-[1] tracking-[-0.035em] text-[2.9rem] sm:text-6xl lg:text-[5rem]` | Site hero, auth art panel |
| Section heading | `text-[2rem] sm:text-[2.6rem] font-medium leading-[1.1] tracking-[-0.025em]` | Site sections, auth title |
| Empty-state headline | `text-2xl font-medium tracking-[-0.025em]` | Empty chat ("What will you map?") |
| Panel title | `text-lg font-medium tracking-[-0.025em]` (kepler's titles: 18px, same weight and tracking) | Workspace panel tabs ("Weather intelligence", "Layers") |
| Card title | `text-sm font-medium` (13px in floating cards) | Chat cards |
| Card section label | `text-[12px] font-medium text-muted-foreground` | "Towers inside …" |
| Body, site | `text-[17px] sm:text-lg leading-relaxed text-mk-muted` | Section copy |
| Body, workspace | `text-sm` or `text-[13px]`, `leading-relaxed` | Chat, cards |
| Meta | `text-[11px]` to `text-xs`, muted | Captions, stat labels |
| Eyebrow | `text-[13px] uppercase tracking-[0.04em] text-mk-muted` | Site only |
| Stat value | `font-semibold tabular-nums` (`text-lg` on the site, `text-[13px]` in the workspace) | Stat tiles |

Rules:

- **Weights:** 400 for text, 500 for headings, labels and buttons, 600 only for numbers and short
  emphasis. Never use 700 (`font-bold`).
- **Numbers:** use `tabular-nums` for any number that changes or sits in a column.
- **Case:** sentence case everywhere. Use uppercase only for site eyebrows and tiny tags.

---

## 5. Shape, elevation and spacing

### Radius

The base `--radius` is 10px.

| Radius | Use |
| --- | --- |
| `rounded-full` | Buttons, chips, selects, toggles, segmented controls, icon buttons, avatars |
| `rounded` (4px) | Tiny tags only ("Beta", "New") |
| `rounded-lg` (10px) | Icon tiles, text inputs, menu items |
| `rounded-xl` (14px) | Chat cards, stat tiles, inline callouts, tables |
| `rounded-2xl` (18px) | Floating cards over the map, dialogs, site mock cards |
| `rounded-[28px]` (`--radius-prompt`) | The prompt composer |

### Elevation

Use hairline borders first. Add a shadow only to things that float above other content:

| Element | Recipe |
| --- | --- |
| Side panel (all tabs) | Frosted glass: `--background` at 72% with `backdrop-filter: blur(8px) saturate(1.3)`, set in `globals.css`. Full-screen chat is glass too, so the map shows through it. |
| Floating card over the map | `bg-background/95 backdrop-blur shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)]` |
| Site mock card | `MockCard` |
| Composer | `shadow-prompt` |

Inline cards in the chat have no shadow.

### Spacing

- **Workspace (dense):** card `p-3`, gaps of `gap-2` or `gap-3`, tiles `px-2 py-1.5`.
- **Site:** sections `px-4 sm:px-6 py-24 lg:py-32`, content inside `max-w-7xl mx-auto`.

### Icons

- Use `lucide-react`.
- Use `size-3.5` in dense UI and chips, and `size-4` in buttons.
- A card header gets one icon tile in its meaning's hue:
  `grid size-7 place-items-center rounded-lg bg-{hue}/15 text-{hue}`, with a `size-3.5` icon.

---

## 6. Component recipes

### Buttons

In the workspace, use `<Button>` from `ui/button`. Every variant is a pill.

| Variant | Use |
| --- | --- |
| `brand` | The one primary action in a view: Send, Approve, Generate |
| `default` (ink) | A strong secondary action |
| `outline` | Secondary actions: Reject, Show on the map |
| `ghost` | Toolbar and icon actions |
| `destructive` | Delete, remove |

- Show at most one `brand` button per card or panel.
- In cards, use `size="sm"` (28px tall).

On the site, use `PillLink` with `variant` `brand`, `primary` or `ghost`, and `size` `md` (44px)
or `lg` (48px).

### Status chip

```tsx
<span className="rounded-full border border-green/30 bg-green/10 px-2 py-0.5 text-[10.5px] font-medium text-green">
  Resolved
</span>
```

On the site, use `<Chip tone="green">`.

### Card header

```tsx
<h2 className="flex items-center gap-2 text-sm font-medium">
  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-magenta/15 text-magenta">
    <Wrench className="size-3.5" />
  </span>
  Self-heal · TWR-KB-031
</h2>
```

### Stat tile

```tsx
<div className="min-w-0 rounded-xl border bg-foreground/[0.02] px-2 py-1.5">
  <div className="text-[13px] font-semibold tabular-nums text-amber">3</div>
  <div className="truncate text-[10.5px] text-muted-foreground">Degraded</div>
</div>
```

### Callouts

| Kind | Classes |
| --- | --- |
| Approval or warning | `rounded-xl border border-amber/30 bg-amber/10 p-2.5 text-[12px]` (icon in `text-amber`) |
| Error | `rounded-xl border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive` |
| Neutral info | `rounded-xl border bg-foreground/[0.02] p-3 text-xs` |

An approval callout always ends with a `brand` Approve button and an `outline` Reject button.

### Floating card (over the map)

```tsx
<div className="fixed right-4 bottom-10 z-[60] w-[24rem] max-w-[calc(100vw-2rem)] rounded-2xl border bg-background/95 p-3 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)] backdrop-blur">
```

Close it with a round icon button:
`rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground`.

### Empty chat

- Show a headline, a one-line hint, then the composer, then the example prompts ("Try an example").
- The thread centers this group vertically. Don't add a separate panel title above it: the headline
  gives way to the messages once the chat starts.
- The example prompts come from `EXAMPLE_PROMPTS`, which the site's Ask section also uses. Change
  them there, and keep them answerable by the demo scenario.

### Side panel

- It is frosted glass over the map (see [Elevation](#elevation)). Content inside it must not paint
  an opaque page background: the chat thread is transparent. Cards, the composer and message
  bubbles stay opaque, so text never sits directly on a busy map.
- Messages fade out over the 48px above the composer, then hide behind it.
- Width: 400px, but never wider than the screen. On a phone the panel leaves a 40px strip of map
  on the right. Its close button sits at the bottom of that strip, clear of kepler's map controls.

### Selects

- **Workspace:** `h-9 rounded-full border border-input bg-background px-3 text-xs`.
- **Site:** the pill select in `PromptBar`.

### App bar

- 44px tall, `px-4`.
- Left side: the wordmark at `text-[19px]` and the "Beta" tag. Right side: the theme toggle and
  the account avatar.
- It mirrors the window bar in the site's Showcase mock. Don't add navigation links to it: put
  workspace controls in the side panel.

### Wordmark

- Always use `<Wordmark>`. Never redraw the logo or swap in another icon.
- Set its size with a text size on `className`. The glyph scales with it (0.92em).
- It takes `currentColor`, so it works on paper, on night and in both workspace themes.

---

## 7. Motion

- **Workspace:** short and functional. Use `tw-animate-css` fade and slide (150–200ms), and a
  `Loader2` with `animate-spin` for work in progress.
- **Site:** the scroll reveal (700ms, `cubic-bezier(0.2, 0.7, 0.2, 1)`), the slow push-in on the
  hero art, and film grain. Never use these in the workspace.
- **Always:** respect `prefers-reduced-motion`. Use the `motion-reduce:` variant, or follow the
  media queries already in `globals.css`.

---

## 8. Writing

- Use sentence case for buttons, headings and labels: "Open workspace", "Generate weather
  overlay".
- Use short, plain sentences that say what happens: "Nothing real-world is changed; every action
  waits for your approval."
- Label synthetic data and experimental output where they are shown.
- Write units and time zones every time: km, %, MYT.

---

## 9. Accessibility

- Take text colors only from tokens. They meet 4.5:1.
- Don't let color be the only signal: add a word or an icon.
- Never remove focus outlines.
- Give every icon-only button an `aria-label`. In the workspace, give it a tooltip as well
  (`TooltipIconButton`).
- Make hit targets at least 28px in dense UI (`size-7`) and 40px or more on the site.

---

## 10. Checklist for new UI

- [ ] No hex values and no Tailwind palette colors (`zinc-*`, `emerald-*` …) in components. Use
      tokens only. Map layer colors are the one exception.
- [ ] Actions are pills, with at most one `brand` button per view.
- [ ] Headings use `font-medium`. No `font-bold`.
- [ ] Radius comes from the table in [5](#5-shape-elevation-and-spacing).
- [ ] Status hues follow [3.3](#33-status-hues).
- [ ] Checked in light and dark mode (workspace).
- [ ] Reduced motion is respected.
- [ ] Reuses `Wordmark`, `Button`, `Chip` and `PillLink` instead of copying them.

---

## 11. Gotchas

- **Backend in search mode.** `backend/run_all.py` starts the MCP servers with `--search`, so each
  server lists only `<name>_search_tools` and `<name>_call_tool`. `lib/menara/call.ts` reaches a
  real tool such as `tower_list_in_bbox` through that call proxy, so UI code can name tools
  directly either way.
- **Stale CSS after a `globals.css` change.** Turbopack's file-system cache
  (`.next/dev/cache/turbopack`, kept across restarts) can keep serving an old `globals.css` through
  the Tailwind loader in `next.config.ts`, for new rules as well as utilities. If a change doesn't
  show, stop `npm run dev`, delete `.next/dev/cache/turbopack`, and start it again. For a
  production build, delete `.next/cache/turbopack` first. Styles a feature can't do without (the
  down-tower marker) live in the component, in a React `<style>`, so they can't go stale.

---

## 12. Open items

These are known gaps between the workspace and the direction above.

- **App bar context:** the site mock shows a context label after the wordmark, such as
  "Kota Bharu flood · demo scenario". The real app bar has none yet. The active chat title is the
  natural candidate.
- **Map layer colors:** tower status now uses the shared `TOWER_STATUS_COLOR`. Weather exposure,
  the area outline, trails and the self-heal extras still use their own hex values. Move them into
  `lib/map-colors.ts`.
- **kepler side panel:** it has square corners, because kepler has no radius option for it.
- **Inputs:** workspace inputs use `rounded-lg`, while the site's auth inputs use `rounded-xl`.
  Align them when inputs are next redesigned.
- **Area card "POOR" label:** it uses `orange-500`, because the palette has no orange.
