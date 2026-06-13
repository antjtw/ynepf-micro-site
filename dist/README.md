# Yorkshire &amp; North East Powerlifting Federation — microsite

A static, multi-page service site in the GOV.UK / NHS content style. Built for
clarity, accessibility (WCAG 2.1 AA) and responsiveness.

## What's here

```
ynepf/
├── index.html              Homepage: hero, events, resources
├── committee.html          Committee (Executive / Supporting tabs)
├── calendar.html           Competition calendar 2026
├── volunteering.html       Volunteer points (Earning / Spending tabs)
├── initiatives.html        2026 initiatives hub
├── faqs.html               FAQs (accordion)
├── initiatives/
│   ├── entry-fees.html     Entry fee changes (data table)
│   └── yne-worlds.html     YNE Worlds 26
├── assets/
│   ├── css/
│   │   ├── tokens.css      Source palette + accessible role mapping
│   │   ├── base.css        Reset, typography, layout primitives, a11y
│   │   └── components.css  Header, footer, banners, cards, tabs, tags, table
│   ├── js/
│   │   ├── nav.js          Mobile nav toggle (ships on every page)
│   │   └── tabs.js         Accessible WAI-ARIA tabs
│   └── partials/
│       ├── header.html     Single source of truth for the header
│       └── footer.html     Single source of truth for the footer
├── build.js                Inlines partials into a static dist/ build
└── dist/                   The built, deployable site (run build.js to refresh)
```

## How the shared header and footer work

The header and footer live once in `assets/partials/`. They are **inlined
directly into every page** between marker comments:

```html
<!-- @partial:header start --> ...header markup... <!-- @partial:header end -->
```

This means every page is fully self-contained: the navigation shows whether
the page is deployed on a server **or** opened straight from disk, with no
JavaScript required for the nav to appear.

All asset and link paths are **relative**, so the site works at any location,
including double-clicking a file locally.

If you edit a partial in `assets/partials/`, run the build to push the change
into every page:

```bash
node build.js
```

The build re-inlines the current partials into all pages (idempotent — safe to
run repeatedly) and refreshes the `dist/` copy. You can deploy either the
project root or `dist/`; both are static and self-contained.

## Deploying

Upload the contents of `dist/` to any static host (Netlify, GitHub Pages,
Cloudflare Pages, S3, etc.). No server-side code or build pipeline is required
on the host — `dist/` is already fully built. If your host supports a build
command, set it to `node build.js` and the publish directory to `dist`.

## Typography

- **Headings:** Cutmark (a variable font), self-hosted from `assets/fonts/`.
  Declared in `assets/css/fonts.css`. Used at display weights with a slightly
  condensed width (`font-variation-settings`) for a distinctive, industrial feel.
- **Body:** IBM Plex Sans, loaded from Google Fonts via the `<link>` in each
  page `<head>`. To self-host it instead (recommended for production, removes the
  external request), download the IBM Plex Sans woff2 files, drop them in
  `assets/fonts/`, add an `@font-face` block to `fonts.css`, and remove the
  Google Fonts `<link>` from each page.

## Logo

The federation crest is in `assets/img/` as two SVGs:
`logo-colour.svg` (navy ring, coral centre) and `logo-white.svg` (used in the
navy header). The white version can be recoloured by changing its `fill`
values if you need it on a different background.

## Colour palette

The palette is derived from the supplied Figma "Light theme" tokens (Iron Oxide,
Slate Navy, Golden Sandstone, Neutral Grey, Sage Green, Soft Rose). The raw
ramps are kept in `tokens.css` for reference, but components consume the
**semantic role tokens** below it. Every text/background pairing was checked to
meet WCAG 2.1 AA:

| Role | Token | Contrast |
|------|-------|----------|
| Body text | grey-900 on white | 15.4:1 |
| Muted text | grey-700 on white | 6.9:1 |
| Links | navy-700 on white | 10.9:1 |
| Primary button | white on iron-600 | 5.7:1 |
| Header bar | white on navy-800 | 14.3:1 |
| Breadcrumb / footer | navy-800 on navy-50 | 12.1:1 |
| Tag: entry open | sage-800 on sage-100 | 7.2:1 |
| Tag: entry closed | grey-800 on grey-100 | 7.7:1 |
| Tag: open position | rose-800 on rose-100 | 6.4:1 |

The natural button colour (iron-500) only reaches 4.48:1 against white, just
under the 4.5:1 threshold, so the primary button uses iron-600 instead. The
focus ring uses Golden Sandstone (gold-500), GOV.UK style.

Only a light theme was supplied, so only a light theme is implemented. Dark mode
can be added later by defining a second set of role tokens under a
`@media (prefers-color-scheme: dark)` block or a `[data-theme="dark"]` selector;
the components already read from the role tokens, so no component CSS would
change.

## Accessibility notes

- Semantic landmarks (`header`, `nav`, `main`, `footer`) on every page
- One `h1` per page and a correct heading order (audited)
- Skip-to-content link
- Visible keyboard focus everywhere; `prefers-reduced-motion` respected
- Tabs follow the WAI-ARIA Tabs pattern (arrow / Home / End keys, deep-linkable
  by `#panel-id`)
- FAQs use native `<details>`/`<summary>` so they work without JavaScript
- The data table uses real `<th scope>` headers and a caption
- Decorative SVG icons are `aria-hidden`; the hero image has a text alternative

## Editing content

Each page is plain HTML — edit the file directly, then run `node build.js`.
Navigation, the ALPHA banner and the footer are edited once in
`assets/partials/` and apply everywhere on the next build.
