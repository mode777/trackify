# Router

Reference for the in-house SPA router (`web/router.js`), the frame-side
navigation helper (`web/nav_client.js`), and the cross-frame plumbing
that keeps the shell URL and the content iframe in sync. The
high-level overview (where it sits in the shell, iframe topology,
"add a route" walkthrough) lives in
[`docs/frontend.md`](frontend.md#7-router-and-data-router-link);
the broker topic rows live in [`docs/ui.md`](ui.md).

## 1. Modules

| File | Role |
| --- | --- |
| `web/router.js` | `Router` class + `createRouter()` factory. Owns `window.location.pathname` + `window.location.search`, listens to `popstate`, pushes history, resolves paths against a route table, emits `navigationStart` / `navigated` / `navigationError`. Exposes `findShellUrlForIframe()` for reverse matching. |
| `web/nav_client.js` | `createNavClient({ broker })` for content/player frames — returns `{ navigate, bindLinks }`. Publishes `shell.navigation.requested` and `shell.iframe.popstate` over the broker. Exports `NAVIGATION_REQUESTED_TOPIC` and `IFRAME_POPSTATE_TOPIC` constants. |
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

// Reverse matching (used by the iframe popstate forwarder)
router.findShellUrlForIframe(iframeHref); // string | null

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
| `navigationStart` | before `pushState`/`replaceState` | `{ from, to, cause }` | (reserved — not consumed in iteration 2) |
| `navigated` | after `pushState`/`replaceState` | `{ from, to, cause }` | the shell's `applyRouteToContentFrame` + `syncSidebarActiveState`; the iframe popstate forwarder no-ops on this |
| `navigationError` | no route matched, bad token, invalid URL | `{ url, reason }` | shell logs (and any subscriber) |

`cause` is one of `'push' | 'replace' | 'pop' | 'token' | 'initial'` so
the iframe subscriber can decide whether to fully swap the iframe
(`push` / `initial`) or just react to a pop.

## 5. Cross-frame plumbing

Two broker topics wire content frames to the shell's router:

| Topic | Direction | Payload | See |
| --- | --- | --- | --- |
| `shell.navigation.requested` | frame → shell | `{ request: string \| NavigationToken; options?: { replace?, meta? } }` | [`docs/ui.md` §7.3](ui.md#73-shellnavigationrequested-payload) |
| `shell.iframe.popstate`      | frame → shell | `{ href: string; serviceId: string }` | [`docs/ui.md` §6 frame → shell table](ui.md#6-topics-in-use) |

Both are published with the broker's default target (`'*'`); the
broker dispatches them locally in shell mode and forwards to the shell
when published from a frame.

## 6. Iframe navigation sync

The shell's `applyRouteToContentFrame` is the only thing that touches
`#playlistFrame.src`:

1. Reads `frame.contentWindow.location.href` (the iframe's actual URL,
   normalised) and compares against the resolved `nextHref`.
2. If equal, returns without touching the iframe.
3. If different, sets `frame.src = next`. (`location.replace` was
   considered and rejected — see pitfall §8.5.)

The iframe's `popstate` listener publishes `shell.iframe.popstate`
with `{ href, serviceId }`. The shell's subscriber:

1. Reverse-matches `href` via `router.findShellUrlForIframe(href)` to a
   shell URL.
2. If the resolved shell URL equals `router.currentRoute().url`,
   returns — this is the common case for shell-driven navigations where
   the iframe's popstate fires as a side effect of `frame.src = ...`.
3. Otherwise calls `router.navigate(shellUrl, { replace: true })`. The
   `replace` is critical — see pitfall §8.3.

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

### 8.2. Iframe history grows faster than shell history

Every `frame.src = next` assignment adds an entry to the iframe's
session history. If the user clicks through 5 routes, the iframe has
5 entries (in addition to its initial `about:blank`), the shell has 5.
The iframe is always ≥ 1 deeper.

Some browser builds (and Chrome when the iframe has DOM focus) treat
the iframe as the "active" history on browser back: they pop the iframe
first, and the shell's `popstate` never fires. Result: iframe content
moves, title bar doesn't.

**Mitigation**: the `shell.iframe.popstate` forwarder (§6). When the
iframe's popstate fires (whether from browser back targeting the
iframe or from `frame.src = ...` — both fire popstate), the shell
reverse-matches and `replaceState`s the shell URL. This keeps the
shell URL in sync regardless of which frame the browser chose to pop.

### 8.3. The popstate forwarder must `replace`, never `push`

If the forwarder called `router.navigate(shellUrl)` (push) instead of
`router.navigate(shellUrl, { replace: true })`, every iframe popstate
would add a shell history entry. That would (a) pollute the back stack
and (b) make the address bar jump forward by one entry every time the
shell subscribed to `shell.iframe.popstate` for a shell-driven
navigation.

`replace` is idempotent: calling it repeatedly with the same URL
produces a single, consistent history entry.

### 8.4. The popstate forwarder must no-op on shell-driven navigations

The iframe's `popstate` fires both for browser back AND for
`frame.src = ...` (when the iframe is at a different URL). If the
forwarder always called `router.navigate(shellUrl)`, every sidebar
click would trigger a redundant forwarder call → replaceState →
subscriber → iframe.

The `currentRoute().url === shellUrl` guard in the subscriber (§6 step
2) catches the shell-driven case and returns early. Don't remove it.

### 8.5. `location.replace` in the iframe does NOT shrink its history

Considered: in `applyRouteToContentFrame`, use
`frame.contentWindow.location.replace(next)` to keep the iframe's
history at 1 entry. Rejected because:

- `window.history.length` for an iframe in Chrome mirrors the parent's
  session history depth (verified empirically — the trace from a
  50-deep shell reported `historyLength: 50` for the freshly-loaded
  iframe).
- So the iframe's history is "deep" by inheritance, not by `frame.src`
  additions. `location.replace` only stops it from getting deeper;
  it doesn't make it shallower.
- Worse, `location.replace` to a same-document URL with a different
  hash does not trigger the iframe's hash parser to re-render — the
  iframe ends up at the right URL but with the wrong view.

`frame.src = next` + popstate forwarder is the working combination.

### 8.6. `frame.src` is unreliable; use `frame.contentWindow.location.href`

`HTMLIFrameElement.src` returns whatever the browser cached at
attribute-set time — sometimes relative (`/collections.html#?type=games`),
sometimes absolute (`http://localhost/...`), and it can lag a navigation
in flight. `applyRouteToContentFrame` reads
`frame.contentWindow.location.href` instead, which is always the
iframe's current absolute URL.

### 8.7. URL normalisation in `applyRouteToContentFrame`

Both sides of the equality check are passed through
`new URL(value, window.location.origin).href`. This:

- Resolves relative URLs (`/collections.html#?type=playlists` →
  `http://127.0.0.1:8090/collections.html#?type=playlists`).
- Preserves the hash (the `URL` constructor does not strip it).
- Keeps the comparison robust against whether the browser stored the
  iframe URL as relative or absolute.

### 8.8. `findShellUrlForIframe` requires exact hash match

The reverse matcher iterates routes and tries to match each one against
the iframe's URL. It is **strict** about the hash params:

- Every key in the route's `target.hash` template must be present in
  the iframe's hash with the right value (or the right `<placeholder>`
  substitution).
- The iframe's hash must not contain extra keys not in the template.

Example: an iframe at `/collections.html#?type=playlists&platform=SNES`
does **not** match `/playlists` (extra `platform` key) and does not
match `/platforms/<name>` (`type` value mismatch — template says
`games`, iframe says `playlists`). It would match `/platforms/<name>`
only if the iframe were at `?type=games&platform=SNES`.

If a future route lands at an iframe URL the reverse matcher cannot
resolve, the forwarder logs `[trace][shell] iframe popstate` with
`resolvedShellUrl: null` and silently no-ops. The fix is to either
adjust the iframe URL the route produces or to add a more specific
template.

### 8.9. Root path redirect via `replaceState` *before* `router.start()`

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

### 8.10. `navigated` subscribers must not call `router.navigate`

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

### 8.11. `data-route` matching is exact by design

Iteration 2 deliberately uses exact-match for sidebar active state:
`data-route="/games"` does not light up when you're at `/games/<id>`.
This means when navigating inside a single game or playlist, no
sidebar link is "active". The user accepted this trade-off to avoid
prefix-matching pitfalls (would `/playlists` light up at
`/playlists/foo`? at `/playlists/foo/bar`? — exact match sidesteps the
question).

If prefix matching is wanted later, the comparison in
`syncSidebarActiveState` is the single line to change.

### 8.12. Pattern registration order is irrelevant (but be aware)

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
   `web/collections.js#paramsFromFragment` accordingly.
5. If the new iframe URL isn't reverse-mappable from a hash that
   `findShellUrlForIframe` can recognise, no extra work — the matcher
   walks the route table and will pick it up automatically.

## 10. Adding a new cross-frame topic

If a new topic is added (e.g. for future guard/canDeactivate
semantics), see [`docs/ui.md` §8](ui.md#8-adding-a-new-topic). The
router itself does not define new topics — it consumes the existing
two via the broker and otherwise lives entirely on the shell.