# CLAUDE.md — Bench Map UK

Reference notes for Claude (or any future contributor) working on this codebase.
The aim is to make the next session immediately productive without re-discovering
how everything fits together.

## What this project is

A static, single-page web app that maps every public bench in the United Kingdom
(~137,000 of them) and lets visitors rate them, favourite them, check in, tag
them with community attributes ("chatty bench", "scenic", "memorial"…), and
upload photos. Live at <https://www.benchmap.co.uk> (CNAME points to the static
host). Owner: Gregory (greg@monwell.co.uk).

The app is intentionally low-tech: no build step, no framework, no server. Open
the directory with any static file server and it runs.

## Stack

- **Frontend**: vanilla HTML / CSS / JavaScript (no bundler).
- **Map**: Leaflet 1.9.4 + Leaflet.markercluster 1.5.3 + esri-leaflet 3 + esri-leaflet-vector 4 (all loaded from unpkg).
- **Basemap**: ArcGIS Colored Pencil vector tile style (`arcgis/colored-pencil`) via `L.esri.Vector.vectorBasemapLayer`. Requires the ArcGIS API key passed as `token`. The key is stored inline in `app.js` (ArcGIS Location Platform free tier — 2M tile requests/month). Account: greg@monwell.co.uk.
- **Bench data**: pre-generated GeoJSON tiles in `data/tile_{row}_{col}.geojson`,
  one per ~10×10 grid cell over the UK. Source data is OpenStreetMap, sliced
  into chunks (`data/chunk_{n}.geojson` are the source-shape chunks; `tile_*`
  are the runtime files the app fetches).
- **Backend**: Firebase project `bench-rating`.
  - Firestore for ratings, community tags, check-ins, user-added benches, photo metadata.
  - Storage (added in May 2026) for photo uploads.
  - Auth (Google sign-in) used only by the moderation page.
- **Analytics**: Google Analytics (gtag, G-P5894RYLBQ).
- **Hosting**: Cloudflare Workers (migrated from Vercel). No build step — Cloudflare serves the static files directly. Custom domain configured in the Cloudflare Workers dashboard; the `CNAME` file in the repo is kept for reference but is not used by Cloudflare.
- **Domain registrar**: Squarespace. DNS is managed there (not at Cloudflare). `www.benchmap.co.uk` and `benchmap.co.uk` are the live domains.

## Files

| File | Purpose |
|---|---|
| `index.html` | Map page. Top-right search/filter, bottom-left "add bench" FAB, bottom-right "find nearest" FAB. Hosts the bench drawer and photo lightbox containers. |
| `about.html` | About page with crossfading sky background, user stats from localStorage, link to bench-of-the-day. Inline `<style>` (not in `styles.css`). |
| `bench-of-the-day.html` | A daily-bench page seeded by UK date hash. Loads all 55 existing tiles. |
| `admin.html` | Photo moderation console. Google sign-in, allowlisted by email, shows pending/approved/rejected tabs. Standalone page with inline CSS+JS. |
| `app.js` | The whole map application. Single IIFE. ~2834 lines. Exports a `window.benchApp` object so inline `onclick="window.benchApp.foo()"` handlers work. |
| `styles.css` | All styles for `index.html`. About page has its own inline styles; admin page does too. |
| `merge_openbenches.py` | Python script to fetch live data from OpenBenches API and merge memorial inscriptions into the GeoJSON tiles. Run with `--dry-run` to preview counts without writing files. |
| `data/tile_*.geojson` | Runtime bench tiles consumed by `loadVisibleTiles()`. Only 55 of a possible 100 grid cells exist (rest are sea/outside UK). |
| `data/chunk_*.geojson` | Source-data chunks used to generate the tiles. |
| `sky*.png` | Background images for about page (sky1–sky7, sky9, sky10 — sky8 is missing). Heavy — see performance notes. |
| `favicon.svg` | Custom bench-icon favicon. |
| `sitemap.xml`, `robots.txt`, `googlec6b07c3bb1aad7a4.html` | SEO bits and Google Search Console verification. |
| `CNAME` | `www.benchmap.co.uk`. |

## Architecture of `app.js`

Single IIFE structured as labelled sections (search for `// ====== `):

1. **CONFIGURATION** — `CONFIG` object: tags, map bounds, Firebase config, tile
   base URL, and `EXISTING_TILES` Set (the 55 tile keys that actually exist on disk).
2. **STATE** — `state` object: db, storage, map, marker references, bench cache,
   favourites, drawer flags, `focusedBeforeDrawer` (for focus restoration),
   `urlBenchCoords` (deep-link target parsed from `?lat=&lng=` URL params).
3. **UTILITIES** — `formatDistance`, `showNotification`, `sanitizeBenchId`
   (allowlists `[a-zA-Z0-9_-]`), `escapeHtml` (HTML-escape strings before
   injecting into `innerHTML` — see "Security conventions" below).
4. **LOCAL STORAGE** — `getStorage`, `setStorage`, `loadUserData`, `saveUserData`.
5. **FIREBASE (Ratings & New Benches Only)** — `initFirebase` initialises
   Firestore and (if available) Storage.
6. **PHOTO UPLOADS** — `PHOTO_CONFIG`, `resizeImageFile`, `startPhotoUpload`,
   `uploadBenchPhoto`, `fetchBenchPhotos`, `openPhotoLightbox`,
   `closePhotoLightbox`, `initPhotoLightbox`.
7. **ICONS** + **TAG_ICONS** — `makeBenchIcon` returns a Leaflet `divIcon`
   wrapping an inline SVG bench inside a coloured circle.
8. **COMMUNITY TAG PICKER** — drawer functions for applying/removing community tags.
   `getTagsFromProps`, `fetchBenchCommunityTags`, `saveBenchCommunityTags`,
   `getMarkerIconForTags`.
9. **TAG FILTER BAR** — `filterByTag`, filter chip rendering. Filter state lives
   in `state.activeTagFilter`.
10. **SHARE** — `shareBench(benchId)` builds a `?lat=&lng=&zoom=17` URL and
    invokes Web Share API if available, clipboard API as fallback, then a textarea
    `execCommand('copy')` last resort.
11. **PEOPLE HERE TODAY** — `fetchCheckInsToday` counts check-ins in the last 24 h.
12. **WELCOME OVERLAY** — `showWelcomeOverlay` / `dismissWelcome`. Shows once on
    first visit. Restarts SVG route animations at the moment the overlay becomes
    visible (not at page-load time).
13. **USER LOCATION** — `initUserLocation` requests geolocation on page load,
    places a persistent marker + accuracy circle, and pans to the user's location
    at zoom 15 (unless a `?lat=&lng=` deep-link is active). Remembers denial in
    localStorage (`locationDenied`).
14. **MAP INIT** — sets up the Leaflet map, URL deep-link parsing, tile layers.
15. **TILE LOADING** — `loadVisibleTiles` fetches `data/tile_{row}_{col}.geojson`
    for the current viewport. Batches of 4 to avoid saturating mobile. **Only
    requests tiles present in `CONFIG.EXISTING_TILES`** — skips sea/empty cells
    to avoid 404s on Vercel. Also handles deep-link bench opening after tiles load.
16. **DRAWER** — `createDrawerContent` (renders the bottom sheet), `openDrawer`,
    `closeDrawer`. The drawer is shared between bench detail and the menu —
    `state.isMenuOpen` distinguishes them. `openDrawer` saves `document.activeElement`
    to `state.focusedBeforeDrawer` and moves focus to the close button; `closeDrawer`
    restores focus. Drawer renders an **OpenBenches attribution link** when
    `props.openbenches_id` is present.
17. **RATINGS** — `setupStarRatings`, `submitRating` (atomic
    `FieldValue.increment` writes to `benchRatings`), `fetchAverageRating`.
    Stars use radio-group pattern: `role="radiogroup"` on container, `role="radio"`
    + `aria-checked` + roving `tabindex` on each star. Arrow keys navigate,
    Enter/Space submits.
18. **ADD BENCH** — `initAddBenchFeature`, `onMapClickAddBench`,
    `showAddBenchForm`, `submitAddBenchForm`, `saveNewBench` (writes to
    `newBenches` collection). FAB has `aria-pressed` toggled on click.
19. **SEARCH** — Nominatim-based geocoding with autocomplete suggestions.
20. **NEAREST BENCH** — `findNearestBench` (haversine over `state.allBenches`).
21. **ROUTING** — `getRoute` and `drawRoute` (uses OSRM public demo server — no key needed).
22. **KEYBOARD SHORTCUTS** — `initKeyboardShortcuts`. Bindings:
    - `Ctrl/Cmd+F` — focus search
    - `Ctrl/Cmd+N` — toggle add-bench mode
    - `Ctrl/Cmd+L` — find nearest bench
    - `Ctrl/Cmd+R` — toggle filter
    - `Escape` — close drawer or cancel add-bench mode
23. **FILTER FUNCTIONALITY** — `toggleFilter`, `applyFilter`, `clearFilter`.
    Filter hides non-matching markers from the map.
24. **LOAD USER-ADDED BENCHES** — loads `newBenches` Firestore collection and
    merges into map on startup.
25. **INIT** — `init()` is the entry point; runs at `DOMContentLoaded`.

## Data model (Firestore)

| Collection | Doc id | Purpose | Notes |
|---|---|---|---|
| `newBenches` | sanitised `manual_{lat}_{lng}` | Community-added benches | Loaded on startup via `loadUserAddedBenches()` and merged into the map. |
| `benchRatings` | sanitised bench id | Per-bench rating sums | Each category (`comfort`, `ambience`, `view`) is `{ total, count }`, written atomically with `FieldValue.increment`. |
| `benchCommunityTags` | sanitised bench id | Community-applied tags | `{ tags: [...], updatedAt }`. Overlaid on top of OSM-derived tags client-side. |
| `benchCheckIns` | auto | Recent check-ins | `{ benchId, timestamp }`; queried with a 24-hour window for the "people here today" counter. |
| `benchPhotos` | random `{ts}_{rand}` | Photo metadata + moderation status | `{ benchId, storagePath, url, status: 'pending'\|'approved'\|'rejected', width, height, sizeBytes, createdAt }`. Public app queries `where status == 'approved'`; admin queries the others. |

### Storage layout

```
bench-photos/
  └── {sanitisedBenchId}/
        └── {photoId}.jpg
```

Anonymous writes are allowed, capped at 4 MB and `image/*` content type by
Storage rules. See `FIREBASE_RULES.md`.

## Tile grid

The UK is divided into a 10×10 grid. **Only 55 of 100 cells contain benches.**
The `EXISTING_TILES` Set in `CONFIG` (app.js) and the equivalent array in
`bench-of-the-day.html` list all 55 keys. Both files must be kept in sync if
tiles are ever added or removed. **Never request a tile not in this list** — the
missing cells are sea or out-of-bounds and will 404, which counts against Cloudflare
Pages request quotas.

Existing tile keys:
`0_2`, `0_3`, `1_3`–`1_9`, `2_3`–`2_9`, `3_3`–`3_9`,
`4_0`–`4_8`, `5_1`–`5_6`, `6_1`–`6_6`, `7_1`–`7_6`,
`8_4`–`8_6`, `9_6`, `9_7`

## Bench id conventions

- OSM benches: keep the OSM id as-is (`node/7209648`). Some characters survive
  but `sanitizeBenchId` is applied whenever the id touches Firestore or storage
  paths (it allowlists `[a-zA-Z0-9_-]` and replaces everything else with `_`).
- Community-added: `manual_{lat.toFixed(6)}_{lng.toFixed(6)}` then sanitised.
- Anywhere we need a Firestore/Storage path, **always pass through
  `sanitizeBenchId` first**. The map keeps the unsanitised id in
  `state.allBenches[i].id` so URL share links and OSM round-trips still work.

## Security conventions (important)

The drawer and map popup render content via `innerHTML` with template literals.
Anything user-supplied (`inscription`, `topic`, `conversation_topic`, `notes`,
`colour`, `material`, the `additionalProps` key/value pairs) **must be passed
through `escapeHtml(...)` before interpolation.** This was retroactively
hardened in May 2026 — every existing user-supplied property is now escaped.
When adding new user-driven fields, escape them at the rendering site (not at
read time, so Firestore stores raw text).

The Firebase API key is in source — that's expected for client SDKs; security
relies on Firestore/Storage rules and the Authorized Domains list in Firebase
Auth, not on hiding the key. (`FIREBASE_RULES.md` has been removed from the
repo; rules must be managed directly in the Firebase console.)

## Photo upload feature

Trigger: tap **Add a photo** in the bench drawer. Flow:

1. `startPhotoUpload(benchId)` opens the hidden `<input type="file" capture="environment">`.
2. `resizeImageFile(file)` reads → decodes → draws onto a canvas with
   white-fill (so transparent PNGs don't go black) → re-encodes to JPEG at 0.85
   quality, longest edge clamped to 1600 px.
3. `uploadBenchPhoto` puts the resized blob to Firebase Storage at
   `bench-photos/{sanitisedBenchId}/{photoId}.jpg` with `Cache-Control:
   public,max-age=31536000`.
4. On completion, writes a Firestore doc to `benchPhotos` with `status:
   'pending'`.
5. Public app's `fetchBenchPhotos` queries `where benchId == X and status ==
   'approved'`, ordered by `createdAt` desc, and renders thumbnails.
6. Tapping a thumbnail opens `#photoLightbox` (fullscreen, Escape closes).

Limits: 8 MB pre-resize, 4 MB post-resize (also enforced by Storage rules), and
3 uploads per bench per session via localStorage (`photoUploads_{benchId}`).

## Moderation

`admin.html` is a separate, no-build, single-file moderation console. Key
points:

- Google sign-in via Firebase Auth.
- Email allowlist in **three places** that must match:
  - `admin.html` → `ADMIN_EMAILS` array (top of inline script).
  - Firestore rules → `isAdmin()` function (managed in Firebase console).
  - Storage rules → `isAdmin()` function (managed in Firebase console).
- Current allowlist: `gregmorton03@gmail.com`.
- Tabs: Pending / Approved / Rejected. Approve, Reject, Unpublish, Restore,
  Delete actions are wired up; Delete also removes the underlying file from
  Storage.
- The page has `<meta name="robots" content="noindex,nofollow">` so it stays out
  of search results.

## SEO

All three public pages (`index.html`, `about.html`, `bench-of-the-day.html`) have:
- Open Graph tags (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`, `og:site_name`)
- Twitter Card tags (`summary_large_image`)
- `<link rel="canonical">`
- `<meta name="theme-color" content="#1a2e1a">`

`index.html` has a `WebSite` JSON-LD (no SearchAction — the location search
doesn't use `?q=` URL params so the action was removed). `about.html` has an
`AboutPage` JSON-LD. The OG image points to `sky1.png`; replace with a
dedicated 1200×630 social card image when one is created.

## Accessibility

Implemented in May 2026:

- `.sr-only` utility class in `styles.css` for visually-hidden but
  screen-reader-accessible content.
- Visually-hidden `<h1>` on both `index.html` and `about.html`.
- `role="application"` removed from `#map` (was too aggressive).
- Star ratings use radio-group pattern (see Architecture §10).
- Add-bench FAB toggles `aria-pressed`.
- `openDrawer` saves prior focus; `closeDrawer` restores it.
- Welcome overlay focuses the "Get started" button on show.
- All decorative emojis in rendered HTML wrapped in `<span aria-hidden="true">`.
- Low-contrast footer/stat colours lifted from `#4a6a4a` to `#7a9a7a` on
  `about.html` and `bench-of-the-day.html`.

Still to do:
- Drawer focus trap.
- Several text-on-dark-green colour pairs still fail WCAG AA.
- `role="application"` on `#map` was removed but the map itself has no
  keyboard navigation yet.

## Performance

- **Sky images** (`sky1.png`–`sky10.png`, 9 images, ~6.6 MB total, 1920×1080).
  The `about.html` image tags are ready for WebP: each `<img>` is wrapped in a
  `<picture>` with a `<source type="image/webp">` pointing to `sky*.webp`.
  Once WebP versions are deployed alongside the PNGs, browsers will use them
  automatically. To generate: `cwebp -q 85 -resize 1200 0 sky1.png -o sky1.webp`
  (requires `brew install webp`). The `sips` tool on macOS can read WebP but
  cannot write it.
- `app.js` (~94 KB) and `styles.css` (~42 KB) are unminified. No node/npm in
  the project — minification requires an external tool.
- CDN scripts have no SRI integrity hashes.

## Welcome overlay

The overlay (`#welcomeOverlay`) shows once on first visit. Content:
- Header row: miniature terracotta pin-button icon + "Find your nearest bench in the UK"
- Animated SVG map: perspective-tilted (CSS `rotateX(20deg)`), shows a dashed
  terracotta route drawing from a "you" dot to a bench marker
- "Rate any bench for comfort, view and ambience"
- "Get started" button

The SVG animations (`welcome-route`, `welcome-bench-dest`) are restarted in
`showWelcomeOverlay()` via a forced reflow so they play from the moment the
overlay fades in, not from page-load time. Both respect `prefers-reduced-motion`.

## OpenBenches integration

`merge_openbenches.py` fetches live data from `https://openbenches.org/api/benches/?truncated=false`
and merges it into the tile GeoJSON files:

- **Match**: benches within 15 m of an existing OSM bench get `openbenches_id` set
  on their properties, and `inscription` backfilled if OSM has none.
- **Add**: benches outside the match radius are inserted as new features with
  `source: 'openbenches'` and `id: 'openbenches_{id}'`.
- Run with `--dry-run` to report counts without writing files.
- The drawer renders `<a class="ob-attribution">View on OpenBenches</a>` whenever
  `props.openbenches_id` is present. The `openbenches_id` property is in `mainProps`
  and therefore not shown in the "additional properties" fallback list.

Data licence: CC BY-SA 4.0.

## Deep linking

Benches can be linked directly via `?lat={lat}&lng={lng}&zoom={zoom}` URL params.
`shareBench()` generates these links. On load, `init()` parses the params into
`state.urlBenchCoords`; `loadVisibleTiles` opens the matching bench drawer once
the relevant tile has loaded and clears `state.urlBenchCoords`. User-location
auto-pan is suppressed when a deep-link is active.

## Future work

- **Photo UX**: optimise display of photos in the bench drawer (next planned task).
- **Photo upload UX**: preview before upload, multi-select, drag-and-drop.
- **Admin: bulk operations** — approve/reject multiple at once, keyboard
  shortcuts, image diffing for duplicates.
- **WebP sky images**: generate and deploy `sky*.webp` at 1200×675 to save ~85%
  on about-page image weight. `<picture>` structure is already in place.
  Note: `sky8.png` is missing from the repo; check whether `sky8.webp` is needed.
- **Accessibility remaining**: drawer focus trap, WCAG AA colour contrast audit,
  keyboard navigation on the map itself.
- **Other regional augmentations**: same pattern as OpenBenches (memorial text,
  donor info, installation dates) may exist for other councils.

## Local dev

No build step. Any static server works:

```
cd benches-map-main
python3 -m http.server 8000
# or: npx serve .
```

Then open <http://localhost:8000>. Photo uploads will work against the live
Firebase project; if you don't want test uploads polluting the real bucket,
either point `CONFIG.FIREBASE_CONFIG` at a separate dev project or comment out
`startPhotoUpload`'s body.

## Workflow

Claude edits files locally. Gregory then uploads the changed files to GitHub via the web UI. Do not suggest `git` commands or remote operations — just make the edits and list which files changed at the end.

## Colour scheme

CSS variables are defined at the top of `styles.css`. The palette was updated in May 2026 to use earthier greens that complement the ArcGIS Colored Pencil basemap.

| Variable | Value | Used for |
|---|---|---|
| `--color-primary-green` | `#3A5F3A` | Buttons, bench markers, links, success states |
| `--color-secondary-green` | `#4A7A4A` | Button hover, "View details" popup button |
| `--color-accent-green` | `#5E8A5E` | Wildlife tag icon |
| `--color-amber` | `#D4810A` | Signpost/filter icon, favourite bench marker |
| `--color-terracotta` | `#C85A40` | Location pin, nearest-bench route, user accuracy circle |
| `--color-teal` | `#1B7A5E` | Add-bench FAB |
| `--color-dark-neutral` | `#263238` | App shell / drawer background |
| `--color-warm-white` | `#FEFCF9` | Drawer surface |
| `--color-ink` | `#2a3328` | Primary drawer text |

Hardcoded greens in `app.js` (inline drawer styles) follow the same values — search for `#3A5F3A` and `#4A7A4A` if they need updating. Cluster markers use `rgba(58, 95, 58, …)` which is `#3A5F3A` in RGB.

## Conventions for changes

- Don't add a build step or framework without flagging it first — the lack of
  build is a deliberate property.
- Prefer minimal-diff edits over rewrites; the file is structured by labelled
  comment headers and contributors lean on them.
- New user-supplied content rendered via `innerHTML` must go through
  `escapeHtml`.
- New Firestore docs that touch user content should use `sanitizeBenchId` for
  the doc id.
- Inline `onclick="window.benchApp.foo()"` is the established pattern for
  drawer buttons; keep it for new buttons unless we're prepared to migrate the
  whole drawer to delegated event listeners.
- If adding new tile files, update `EXISTING_TILES` in both `app.js` (a `Set`)
  and `bench-of-the-day.html` (an array). They must stay in sync.
