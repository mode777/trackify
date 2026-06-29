# Router

Reference for the in-house SPA router (`web/router.js`), the frame-side
navigation helper (`web/nav_client.js`), and the cross-frame plumbing
that lets the shell own the browser's history while the content iframe
is driven in-place. The high-level overview (where it sits in the
shell, iframe topology, "add a route" walkthrough) lives in
[`docs/frontend.md`](frontend.md#7-router-and-data-router-link); the
broker topic rows live in [`docs/ui.md`](ui.md).

## 1. Modules

| File | Role |
| --- | --- |
| `web/router.js` | `Router` class + `createRouter()` factory. Owns `window.location.pathname` + `window.location.search`, listens to `popstate`, pushes/replaces history, resolves paths against a route table, emits `navigationStart` / `navigated` / `navigationError`. No iframe awareness. |
| `web/nav_client.js` | `createNavClient({ broker })` for content/player frames — returns `{ navigate, bindLinks }`. Publishes `shell.navigation.requested` over the broker. Exports `NAVIGATION_REQUESTED_TOPIC` and `CONTENT_RERENDER_TOPIC` constants. |
| `web/app.js` | Constructs the shell's `Router`, registers the route table, wires the broker subscriptions, drives `applyRouteToContentFrame` from `navigated`, and runs `syncSidebarActiveState`. |

The router class lives **only in the shell** (`web/app.js`). Content
frames use `createNavClient` instead — they never instantiate `Router`,
they only talk to it through the broker.

## 2. Public API (`Router`)

```js
const router = createRouter({
    notFoundHandler: (url) => console.error('[router] no route matched', url),
});

// Lifecycle
router.start();                  // reads window.location, replaces '/' with the canonical landing, resolves initial route, emits 'navigated' { cause: 'initial' }
router.destroy();                // removes popstate listener, clears subscribers

// Registration
router.register(pattern, config);
router.unregister(pattern);
router.clear();

// Navigation
router.navigate(urlOrToken, options?);   // Promise<RouteMatch>; pushes history
router.replace(urlOrToken, options?);   // Promise<RouteMatch>; replaces current history entry (no new entry)
router.back();                           // window.history.back(); resolves with currentRoute()
router.forward();                        // window.history.forward()
router.go(delta);                        // window.history.go(delta)

// Inspection
router.currentRoute();                   // current RouteMatch | null
router.match(url);                       // pure: RouteMatch | null (no side effects)

// Events
const off = router.subscribe(eventName, handler);  // returns unsubscribe fn
```

### Type shapes

```ts
type RouteMatch = {
    pattern: string;             // '/playlists/<id>'
    params: Record<string, string>;
    query: Record<string, string>;
    url: string;                 // '/playlists/abc123'
    target: {
        html: string;            // '/playlist.html'  (the iframe src base)
        hash?: string;           // '?type=playlist&id=<id>'  (template; <param> substituted from params)
    };
    meta?: Record<string, unknown>;
};

type NavigationToken =
    | { token: 'back' }
    | { token: 'forward' }
    | { token: 'go'; delta: number };

type NavigateInput = string | NavigationToken;

type NavigateOptions = {
    replace?: boolean;
    meta?: Record<string, unknown>;
};

type RouteRecord = {
    pattern: string;
    target: { html: string; hash?: string };
    meta?: Record<string, unknown>;
};

type RouterEvent =
    | 'navigationStart'           // { from: RouteMatch|null, to: RouteMatch, cause }
    | 'navigated'                 // { from: RouteMatch|null, to: RouteMatch, cause }
    | 'navigationError';          // { url, reason: 'no-match' | 'bad-token' | 'invalid-url' }

type RouterEventCause = 'push' | 'replace' | 'pop' | 'token' | 'initial';
```

`navigationStart` fires before `pushState`/`replaceState`; `navigated`
fires after the URL is settled. `cause === 'initial'` only fires from
`router.start()` — its `navigationStart` is skipped.

## 3. Pattern syntax

- Static path: `/games`, `/favorites`.
- Path params: `/games/<id>`. Matched positionally; the captured value
  becomes `params.id` and is available to `target.hash` substitution.
- Query string: preserved on `match()` but **not** part of the pattern.
  Two routes can differ only by query params only if their `target.hash`
  templates differ.
- `target.hash` may itself contain `<param>` placeholders that are
  substituted from `params` when matched (e.g.
  `hash: '?type=playlist&id=<id>'`).

Pattern compilation lives inside `Router` (~30 lines, no external
dependency). The regex is `^\/?<segments>\/?$` where each segment is
either an escaped literal or `([^/]+)`.

## 4. Event surface

The router is a small event emitter. Three events, one subscription
method:

| Event | When | Payload | Used by |
| --- | --- | --- | --- |
| `navigationStart` | before `pushState`/`replaceState` | `{ from, to, cause }` | (reserved — not consumed) |
| `navigated` | after `pushState`/`replaceState` | `{ from, to, cause }` | the shell's `applyRouteToContentFrame` + `syncSidebarActiveState` |
| `navigationError` | no route matched, bad token, invalid URL | `{ url, reason }` | shell logs (and any subscriber) |

`cause` is one of `'push' | 'replace' | 'pop' | 'token' | 'initial'`.

## 5. Cross-frame plumbing

Two broker topics wire content frames to the shell's router / DOM:

| Topic | Direction | Payload | See |
| --- | --- | --- | --- |
| `shell.navigation.requested` | frame → shell | `{ request: string \| NavigationToken; options?: { replace?, meta? } }` | [`docs/ui.md` §7.3](ui.md#73-shellnavigationrequested-payload) |
| `shell.content.rerender` | shell → content | `{ href: string }` | [`docs/ui.md` §7.4](ui.md#74-shellcontentrerender-payload) |

`shell.navigation.requested` is published with the broker's default
target (`'*'`); the broker dispatches it locally in shell mode and
forwards to the shell when published from a frame.
`shell.content.rerender` is published with `target: 'games' |
'playlist'` and routed by the shell broker to the matching service's
registered `contentWindow`.

## 6. Iframe navigation sync — the shell-only history model

The browser's back/forward stack is owned exclusively by the shell.
The content iframe holds a single history entry at any time and never
grows. This is achieved by replacing — not pushing — the iframe's URL
on every shell navigation:

```
shell popstate / navigate / replace
  → Router pushes shell history, emits 'navigated'
  → applyRouteToContentFrame(to)
       ├─ first load (frame.contentWindow.location.href === 'about:blank')
       │     → frame.src = next                          (1 history entry)
       ├─ cross-document nav (pathname changes)
       │     → frame.contentWindow.location.replace(next) (full page load, history replaced)
       └─ same-document nav (pathname unchanged, only ?… changes)
             → frame.contentWindow.location.replace(next) (URL-only, no reload)
             → shellBroker.publish('shell.content.rerender', { href: next }, { target: '<serviceId>' })
```

`serviceIdForHtml(html)` maps `target.html` to the broker service id
the iframe registered as (`/collections.html` → `'games'`,
`/playlist.html` → `'playlist'`). It is used as the publish target so
the broker routes the rerender signal to the right `contentWindow`.

The iframe's `hashchange` listener still fires for cross-document
loads (it always has, after a full page load) and for hash-only
subsequent changes inside the iframe. The
`shell.content.rerender` topic fills the gap for query-string changes
inside the same document — `location.replace` updates the URL but
fires neither `hashchange` (query string, not hash) nor `popstate`
(history not actually traversed). Each frame subscribes in `init()`:

```js
// web/collections.js
broker.subscribe(CONTENT_RERENDER_TOPIC, () => applyRoute());

// web/playlist.js
broker.subscribe(CONTENT_RERENDER_TOPIC, () => evaluateFragmentParameters());
```

After the rerender, the iframe URL and the rendered view agree.
The shell URL is the only one a user can reach with browser
back/forward.

### 6.1. Top-bar back/forward buttons

The shell's top-bar chevron buttons
(`[data-history-action="back"]` / `forward` in `web/index.html`)
mirror the browser controls. `bindHistoryButtons()` in `web/app.js`
wires them straight to `router.back()` / `router.forward()` — no
extra broker topic, no nav-client hop.

Browsers don't expose whether forward entries exist, so the shell
tracks its own logical cursor in a `(stack, cursor)` pair and
updates it from the router's `navigated` events:

- `cause: 'push' | 'initial'` — drop everything past `cursor`, push
  the new URL, advance `cursor`.
- `cause: 'replace'` — overwrite `stack[cursor]`.
- `cause: 'pop' | 'token'` — locate `to.url` in `stack` and move
  `cursor` to that index (covers both back and forward — they're
  symmetric to the router).

The buttons' `disabled` flag is then just `cursor <= 0` (back) and
`cursor >= stack.length - 1` (forward). The `disabled` attribute
stays on the markup as the initial state so the buttons render
disabled before `init()` runs.

## 7. Sidebar active state

The shell sidebar links carry `data-route` attributes matching their
target pattern (exact match — `/games` matches only the `/games`
route, not `/games/<id>`). On every `navigated` event,
`syncSidebarActiveState(to)` toggles `.active` on each link whose
`data-route` exactly equals `to.pattern`. There is no parent-prefix
matching — when you're inside `/games/<id>` no sidebar link is active.

## 8. Known tricky parts and pitfalls

### 8.1. Shell broker cannot route to itself

`shellBroker.publish(topic, payload, { target: 'shell' })` throws
`Cannot resolve target window for message topic: <topic>`. The shell is
the broker, so there is no registered `'shell'` service to forward to;
`resolveTargetWindow('shell')` returns `null` and `postRawMessage`
rejects.

`nav_client.js` therefore publishes with **no `target` option** —
the broker's default `'*'` is what the shell's local `dispatchLocalEvent`
and `forwardEventToSubscribers` both handle. Same code path is used by
content frames (where `target: '*'` is sent to the parent shell, which
then dispatches locally via the inbound `processShellMessage`).

### 8.2. Same-document `location.replace` doesn't fire `hashchange` or `popstate`

When two routes share the same iframe HTML (e.g. `/games` → `/playlists`
both target `/collections.html`), `location.replace(next)` updates the
iframe's URL but the browser does **not** fire `hashchange` (the change
is in the query string, not the hash) and does **not** fire `popstate`
(history was not actually traversed). Without the rerender signal,
the iframe ends up at the right URL with the wrong view.

This is why `applyRouteToContentFrame` publishes
`shell.content.rerender` after every same-document replace. Do not
remove the publish — it's the only thing that makes same-document
navigations re-render.

### 8.3. `frame.src` is unreliable; use `frame.contentWindow.location.href`

`HTMLIFrameElement.src` returns whatever the browser cached at
attribute-set time — sometimes relative (`/collections.html#?type=games`),
sometimes absolute (`http://localhost/...`), and it can lag a navigation
in flight. `applyRouteToContentFrame` reads
`frame.contentWindow.location.href` instead, which is always the
iframe's current absolute URL.

### 8.4. URL normalisation in `applyRouteToContentFrame`

Both sides of the equality check are passed through
`new URL(value, window.location.origin).href`. This:

- Resolves relative URLs (`/collections.html#?type=playlists` →
  `http://127.0.0.1:8090/collections.html#?type=playlists`).
- Preserves the hash (the `URL` constructor does not strip it).
- Keeps the comparison robust against whether the browser stored the
  iframe URL as relative or absolute.

### 8.5. First load uses `frame.src`, subsequent loads use `location.replace`

`frame.contentWindow.location.replace(...)` requires a document to
exist in the iframe. On the very first call (iframe is still at
`about:blank`, no `contentWindow` reachable), `applyRouteToContentFrame`
falls back to `frame.src = next`. Every subsequent navigation uses
`location.replace`. The fallback is gated by
`currentHref !== 'about:blank'`; do not remove it.

### 8.6. Cross-document replaces must let the new document re-register

`location.replace` causes a full page load for cross-document
navigations (`/collections.html` → `/playlist.html`). The new
document's `init()` runs from scratch — including `broker.start()`
which sends `control/service.register` to the shell. The shell
broker replaces the old `contentWindow` in its service registry. The
old `contentWindow` reference becomes invalid; any in-flight messages
to it are dropped (they'd arrive on a now-defunct window).

`applyRouteToContentFrame` does not publish `shell.content.rerender`
for cross-document replaces — the new document's `init()` handles its
own initial render via the route's hash, so no explicit signal is
needed.

### 8.7. Root path redirect via `replaceState` *before* `router.start()`

If `window.location.pathname === '/'` (or empty), `initRouter` does
`window.history.replaceState({}, '', '/games')` **before** calling
`router.start()`. This avoids the boot firing `navigationError` for
the root path: `router.start()` reads the rewritten URL, finds the
`/games` match, emits `navigated { cause: 'initial' }`, and the
subscriber swaps the iframe in one shot.

If `replaceState` is called inside the subscriber after `start()`, the
order is wrong — `start()` fires `navigationError` first, then the
subscriber's later `replaceState` triggers a manual navigate. Log
noise + an extra history entry.

### 8.8. `navigated` subscribers must not call `router.navigate`

The `navigated` handler runs **inside** `router.start()`'s initial
emit (and after every `pushState`/`replaceState`). If a subscriber
re-enters the router (e.g. `router.navigate(...)` from inside a
`navigated` handler), the router pushes another history entry. This
isn't a recursion bug per se but it does compound history entries and
fires another `navigated`, which can lead to a tight loop if the
subscriber keeps doing it.

Current subscribers (`applyRouteToContentFrame`, `syncSidebarActiveState`)
are pure — they read state and update DOM, no router re-entry. Keep it
that way.

### 8.9. `data-route` matching is exact by design

Iteration 2 deliberately uses exact-match for sidebar active state:
`data-route="/games"` does not light up when you're at `/games/<id>`.
This means when navigating inside a single game or playlist, no
sidebar link is "active". The user accepted this trade-off to avoid
prefix-matching pitfalls (would `/playlists` light up at
`/playlists/foo`? at `/playlists/foo/bar`? — exact match sidesteps the
question).

If prefix matching is wanted later, the comparison in
`syncSidebarActiveState` is the single line to change.

### 8.10. Pattern registration order is irrelevant (but be aware)

The router iterates `this.routes` in registration order, returning on
the first match. The current patterns do not overlap
(`/games` vs `/games/<id>` is unambiguous because `/games`'s regex
`^games/?$` rejects `/games/abc`). Re-ordering is safe. If a future
change introduces an overlap (e.g. `/games/new` vs `/games/<id>`),
the most-specific pattern must be registered first.

## 9. Adding a new shell-side route

1. Pick a path and target.
2. Add `router.register(pattern, { target: { html, hash? } })` inside
   `registerRoutes()` in `web/app.js`.
3. Add a sidebar link with `data-router-link data-route="<exact-pattern>"`.
4. If the route's iframe target has a new hash param the frame doesn't
   parse yet, extend `web/playlist/navigation.js` or
   `web/collections.js#paramsFromFragment` accordingly. The frame's
   existing `CONTENT_RERENDER_TOPIC` subscriber will pick up the new
   route automatically — no router-side wiring needed.

## 10. Adding a new cross-frame topic

If a new topic is added (e.g. for future guard/canDeactivate
semantics), see [`docs/ui.md` §8](ui.md#8-adding-a-new-topic). The
router itself does not define new topics — it consumes the existing
one via the broker and otherwise lives entirely on the shell.
