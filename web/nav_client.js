'use strict';

const NAVIGATION_REQUESTED_TOPIC = 'shell.navigation.requested';
const CONTENT_RERENDER_TOPIC = 'shell.content.rerender';

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findAnchor(target) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest('a[data-router-link]');
}

function readHref(anchor) {
    if (!anchor) return null;
    const href = anchor.getAttribute('href');
    if (!href || href === '#') return null;
    return href;
}

function buildNavClient({ broker }) {
    if (!broker || typeof broker.publish !== 'function') {
        throw new Error('createNavClient({ broker }): broker is required');
    }

    function navigate(urlOrToken, options) {
        const payload = {
            request: urlOrToken,
            options: isPlainObject(options) ? options : {},
        };
        broker.publish(NAVIGATION_REQUESTED_TOPIC, payload);
        return payload;
    }

    function bindLinks(root) {
        const scope = root && typeof root.addEventListener === 'function' ? root : document;
        scope.addEventListener('click', (event) => {
            if (!event || event.defaultPrevented) return;
            if (event.button !== undefined && event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const anchor = findAnchor(event.target);
            if (!anchor) return;
            if (anchor.target && anchor.target !== '_self') return;
            const href = readHref(anchor);
            if (!href) return;
            event.preventDefault();
            navigate(href, { meta: { ...anchor.dataset } });
        });
        scope.addEventListener('keydown', (event) => {
            if (!event) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const anchor = findAnchor(event.target);
            if (!anchor) return;
            const href = readHref(anchor);
            if (!href) return;
            event.preventDefault();
            navigate(href, { meta: { ...anchor.dataset } });
        });
    }

    return { navigate, bindLinks };
}

export {
    buildNavClient as createNavClient,
    NAVIGATION_REQUESTED_TOPIC,
    CONTENT_RERENDER_TOPIC,
};