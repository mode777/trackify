'use strict';

const NAVIGATION_REQUESTED_TOPIC = 'shell.navigation.requested';
const PARAM_SEGMENT_RE = /^<([A-Za-z_][A-Za-z0-9_]*)>$/;
const PARAM_SUBST_RE = /<([A-Za-z_][A-Za-z0-9_]*)>/g;
const REGEX_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNavigationToken(value) {
    return isPlainObject(value) && typeof value.token === 'string';
}

function compilePattern(pattern) {
    const normalized = String(pattern || '');
    if (normalized !== '/' && normalized !== '') {
        const rawSegments = normalized.split('/').filter((segment) => segment.length > 0);
        if (rawSegments.length === 0) return null;
    }
    const segments = normalized.split('/').filter((segment) => segment.length > 0);
    const paramNames = [];
    const parts = segments.map((segment) => {
        const match = segment.match(PARAM_SEGMENT_RE);
        if (match) {
            paramNames.push(match[1]);
            return '([^/]+)';
        }
        return segment.replace(REGEX_ESCAPE_RE, '\\$&');
    });
    const regex = new RegExp('^\\/?' + parts.join('\\/') + '\\/?$');
    return { regex, paramNames };
}

function applyTemplate(template, params) {
    if (typeof template !== 'string' || !template) return '';
    return template.replace(PARAM_SUBST_RE, (_, key) => {
        const value = params[key];
        return typeof value === 'string' && value.length > 0 ? encodeURIComponent(value) : '';
    });
}

function parseUrl(url) {
    if (typeof url !== 'string' || !url) return null;
    try {
        const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
        const parsed = new URL(url, base);
        return {
            pathname: parsed.pathname || '/',
            query: Object.fromEntries(parsed.searchParams.entries()),
            url: parsed.pathname + (parsed.search || ''),
        };
    } catch (_error) {
        return null;
    }
}

function safeInvoke(handler, payload) {
    try {
        return handler(payload);
    } catch (error) {
        return Promise.reject(error);
    }
}

class Router {
    constructor(options = {}) {
        this.notFoundHandler = typeof options.notFoundHandler === 'function' ? options.notFoundHandler : null;
        this.started = false;
        this.routes = [];
        this.currentMatch = null;
        this.subscriptions = new Map();
        this.onPopState = this.onPopState.bind(this);
    }

    start() {
        if (this.started) return;
        if (typeof window !== 'undefined') {
            window.addEventListener('popstate', this.onPopState);
        }
        this.started = true;
        const url = this.currentLocation();
        const match = this.match(url);
        if (match) {
            this.currentMatch = match;
            this.emit('navigated', { from: null, to: match, cause: 'initial' });
            return;
        }
        this.emitError(url, 'no-match');
    }

    destroy() {
        if (!this.started) return;
        if (typeof window !== 'undefined') {
            window.removeEventListener('popstate', this.onPopState);
        }
        this.subscriptions.clear();
        this.started = false;
    }

    register(pattern, config) {
        if (typeof pattern !== 'string' || !pattern) {
            throw new Error('register(pattern, config): pattern must be a non-empty string');
        }
        if (!isPlainObject(config) || !isPlainObject(config.target) || typeof config.target.html !== 'string' || !config.target.html) {
            throw new Error('register(pattern, config): config.target.html must be a non-empty string');
        }
        const compiled = compilePattern(pattern);
        if (!compiled) {
            throw new Error('register(pattern, config): failed to compile pattern "' + pattern + '"');
        }
        const record = {
            pattern,
            regex: compiled.regex,
            paramNames: compiled.paramNames,
            target: {
                html: config.target.html,
                hash: typeof config.target.hash === 'string' ? config.target.hash : '',
            },
            meta: isPlainObject(config.meta) ? { ...config.meta } : {},
        };
        const existingIndex = this.routes.findIndex((route) => route.pattern === pattern);
        if (existingIndex >= 0) {
            this.routes[existingIndex] = record;
        } else {
            this.routes.push(record);
        }
    }

    unregister(pattern) {
        const index = this.routes.findIndex((route) => route.pattern === pattern);
        if (index >= 0) this.routes.splice(index, 1);
    }

    clear() {
        this.routes = [];
    }

    navigate(urlOrToken, options = {}) {
        const replace = Boolean(options && options.replace);
        return this.doNavigate(urlOrToken, replace ? 'replace' : 'push');
    }

    replace(urlOrToken, options = {}) {
        return this.doNavigate(urlOrToken, 'replace');
    }

    back() {
        if (typeof window !== 'undefined') {
            window.history.back();
        }
        return Promise.resolve(this.currentMatch);
    }

    forward() {
        if (typeof window !== 'undefined') {
            window.history.forward();
        }
        return Promise.resolve(this.currentMatch);
    }

    go(delta) {
        if (typeof window !== 'undefined') {
            window.history.go(Number(delta) || 0);
        }
        return Promise.resolve(this.currentMatch);
    }

    currentRoute() {
        return this.currentMatch;
    }

    match(url) {
        const parsed = parseUrl(url);
        if (!parsed) return null;
        for (const route of this.routes) {
            const matched = route.regex.exec(parsed.pathname);
            if (!matched) continue;
            const params = {};
            route.paramNames.forEach((name, index) => {
                const raw = matched[index + 1];
                if (typeof raw !== 'string') return;
                try {
                    params[name] = decodeURIComponent(raw);
                } catch (_error) {
                    params[name] = raw;
                }
            });
            return {
                pattern: route.pattern,
                params,
                query: parsed.query,
                url: parsed.url,
                target: {
                    html: route.target.html,
                    hash: applyTemplate(route.target.hash, params),
                },
                meta: { ...route.meta },
            };
        }
        return null;
    }

    subscribe(eventName, handler) {
        if (typeof eventName !== 'string' || !eventName) {
            throw new Error('subscribe(eventName, handler): eventName must be a non-empty string');
        }
        if (typeof handler !== 'function') {
            throw new Error('subscribe(eventName, handler): handler must be a function');
        }
        const handlers = this.subscriptions.get(eventName) || new Set();
        handlers.add(handler);
        this.subscriptions.set(eventName, handlers);
        return () => {
            const set = this.subscriptions.get(eventName);
            if (!set) return;
            set.delete(handler);
            if (set.size === 0) this.subscriptions.delete(eventName);
        };
    }

    doNavigate(input, cause) {
        return Promise.resolve().then(() => {
            if (isNavigationToken(input)) {
                return this.handleToken(input);
            }
            if (typeof input !== 'string' || !input) {
                throw new Error('navigate: input must be a string URL or a navigation token');
            }
            const match = this.match(input);
            if (!match) {
                this.emitError(input, 'no-match');
                throw new Error('No route matched: ' + input);
            }
            const from = this.currentMatch;
            this.emit('navigationStart', { from, to: match, cause });
            if (typeof window !== 'undefined') {
                if (cause === 'replace') {
                    window.history.replaceState({}, '', match.url);
                } else {
                    window.history.pushState({}, '', match.url);
                }
            }
            this.currentMatch = match;
            this.emit('navigated', { from, to: match, cause });
            return match;
        });
    }

    handleToken(token) {
        if (token.token === 'back') return this.back();
        if (token.token === 'forward') return this.forward();
        if (token.token === 'go') return this.go(Number(token.delta) || 0);
        this.emitError(JSON.stringify(token), 'bad-token');
        return Promise.reject(new Error('Unknown navigation token: ' + token.token));
    }

    onPopState() {
        const url = this.currentLocation();
        console.info('[trace][router] popstate fired', {
            url,
            pathname: typeof window !== 'undefined' ? window.location.pathname : '',
            href: typeof window !== 'undefined' ? window.location.href : '',
            shellHistoryLength: typeof window !== 'undefined' && window.history ? window.history.length : null,
        });
        const match = this.match(url);
        if (!match) {
            this.emitError(url, 'no-match');
            return;
        }
        const from = this.currentMatch;
        this.emit('navigationStart', { from, to: match, cause: 'pop' });
        this.currentMatch = match;
        this.emit('navigated', { from, to: match, cause: 'pop' });
    }

    currentLocation() {
        if (typeof window === 'undefined') return '/';
        return window.location.pathname + (window.location.search || '');
    }

    emit(eventName, payload) {
        const handlers = this.subscriptions.get(eventName);
        if (!handlers || handlers.size === 0) return;
        for (const handler of handlers) {
            safeInvoke(handler, payload);
        }
    }

    emitError(url, reason) {
        this.emit('navigationError', { url, reason });
        if (this.notFoundHandler) {
            try {
                this.notFoundHandler(url);
            } catch (_error) {
            }
            return;
        }
        console.error('[router] no route matched', url, '(' + reason + ')');
    }
}

export function createRouter(options = {}) {
    return new Router(options);
}

export { Router, NAVIGATION_REQUESTED_TOPIC };