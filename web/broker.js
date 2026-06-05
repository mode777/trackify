/*
 * Trackify postMessage broker.
 *
 * Supports:
 * - Shell mode: controller + message broker across iframe services.
 * - Frame mode: high-level API for content/player frame messaging.
 */

'use strict';

const PROTOCOL_VERSION = 1;
const TYPE_CONTROL = 'control';
const TYPE_EVENT = 'event';
const TYPE_REQUEST = 'request';
const TYPE_RESPONSE = 'response';
const TYPE_ERROR = 'error';

const CONTROL_REGISTER = 'control/service.register';
const CONTROL_READY = 'control/service.ready';
const CONTROL_SUBSCRIPTIONS = 'control/service.subscriptions.update';

function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function nowIso() {
    return new Date().toISOString();
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidBaseEnvelope(message) {
    if (!isPlainObject(message)) return false;
    if (message.v !== PROTOCOL_VERSION) return false;
    if (typeof message.id !== 'string' || !message.id) return false;
    if (typeof message.timestamp !== 'string' || !message.timestamp) return false;
    if (typeof message.type !== 'string' || !message.type) return false;
    if (typeof message.topic !== 'string' || !message.topic) return false;
    if (typeof message.source !== 'string' || !message.source) return false;
    return true;
}

function createMessageEnvelope(base, overrides) {
    return {
        v: PROTOCOL_VERSION,
        id: createId(),
        timestamp: nowIso(),
        ...base,
        ...overrides,
    };
}

function normalizeStringSet(values) {
    const set = new Set();
    if (!values) return set;

    for (const value of values) {
        if (typeof value !== 'string') continue;
        const normalized = value.trim();
        if (!normalized) continue;
        set.add(normalized);
    }

    return set;
}

function safeInvoke(handler, arg) {
    try {
        return handler(arg);
    } catch (error) {
        return Promise.reject(error);
    }
}

class TrackifyBroker {
    constructor(options) {
        this.mode = options.mode;
        this.serviceId = options.serviceId;
        this.targetOrigin = options.targetOrigin || '*';
        this.requestTimeoutMs = Number(options.requestTimeoutMs) > 0 ? Number(options.requestTimeoutMs) : 5000;

        this.allowedServices = normalizeStringSet(options.allowedServices || []);
        this.allowedOrigins = normalizeStringSet(options.allowedOrigins || []);

        this.started = false;
        this.parentWindow = options.parentWindow || globalThis.parent;

        this.subscriptions = new Map();
        this.requestHandlers = new Map();
        this.pendingRequests = new Map();

        this.seenMessageIds = new Set();
        this.seenMessageQueue = [];
        this.maxSeenMessageIds = 1000;

        // Shell-only registries.
        this.services = new Map();
        this.frameSubscriptions = new Map();
        this.requestRoutes = new Map();

        this.onMessage = this.onMessage.bind(this);
    }

    describeSourceFrame(eventSource, messageSource) {
        if (this.mode === 'frame') {
            if (eventSource === this.parentWindow) {
                return 'parent(shell)';
            }
            return messageSource || 'unknown';
        }

        for (const [serviceId, service] of this.services.entries()) {
            if (service && service.windowRef === eventSource) {
                return serviceId;
            }
        }

        return messageSource || 'unknown';
    }

    describeTargetFrame(target, targetWindow) {
        if (this.mode === 'frame') {
            if (targetWindow === this.parentWindow || target === 'shell') {
                return 'parent(shell)';
            }
            return target || 'unknown';
        }

        if (target && target !== '*' && target !== 'shell') {
            return target;
        }

        for (const [serviceId, service] of this.services.entries()) {
            if (service && service.windowRef === targetWindow) {
                return serviceId;
            }
        }

        return target || 'unknown';
    }

    logIncomingMessage(event, message) {
        const fromFrame = this.describeSourceFrame(event && event.source, message.source);
        console.info('[TrackifyBroker][recv]', {
            mode: this.mode,
            id: message.id,
            type: message.type,
            topic: message.topic,
            sourceService: message.source,
            fromFrame,
            eventOrigin: event && event.origin ? event.origin : 'unknown',
            target: message.target,
            correlationId: message.correlationId || null,
        });
    }

    logOutgoingMessage(message, targetWindow, targetOrigin) {
        const toFrame = this.describeTargetFrame(message.target, targetWindow);
        console.info('[TrackifyBroker][send]', {
            mode: this.mode,
            id: message.id,
            type: message.type,
            topic: message.topic,
            sourceService: message.source,
            fromFrame: this.serviceId,
            target: message.target,
            toFrame,
            targetOrigin,
            correlationId: message.correlationId || null,
        });
    }

    start() {
        if (this.started) return;
        globalThis.addEventListener('message', this.onMessage);
        this.started = true;

        if (this.mode === 'frame') {
            this.sendControl(CONTROL_REGISTER, {
                subscriptions: [],
            }, 'shell');
        }
    }

    destroy() {
        if (!this.started) return;

        globalThis.removeEventListener('message', this.onMessage);
        this.started = false;

        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timerId);
            pending.reject(new Error('Broker destroyed before response was received'));
        }
        this.pendingRequests.clear();

        this.subscriptions.clear();
        this.requestHandlers.clear();

        if (this.mode === 'shell') {
            this.services.clear();
            this.frameSubscriptions.clear();
            this.requestRoutes.clear();
        }
    }

    subscribe(topic, handler) {
        if (typeof topic !== 'string' || !topic) {
            throw new Error('subscribe(topic, handler): topic must be a non-empty string');
        }
        if (typeof handler !== 'function') {
            throw new Error('subscribe(topic, handler): handler must be a function');
        }

        const handlers = this.subscriptions.get(topic) || new Set();
        handlers.add(handler);
        this.subscriptions.set(topic, handlers);

        if (this.mode === 'frame' && this.started) {
            this.sendSubscriptionUpdate();
        }

        return () => {
            const existing = this.subscriptions.get(topic);
            if (!existing) return;
            existing.delete(handler);
            if (existing.size === 0) this.subscriptions.delete(topic);

            if (this.mode === 'frame' && this.started) {
                this.sendSubscriptionUpdate();
            }
        };
    }

    publish(topic, payload, options = {}) {
        return this.sendEnvelope({
            type: TYPE_EVENT,
            topic,
            payload,
            target: options.target || '*',
        });
    }

    request(topic, payload, options = {}) {
        const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : this.requestTimeoutMs;

        const message = createMessageEnvelope(
            {
                type: TYPE_REQUEST,
                topic,
                source: this.serviceId,
                target: options.target || 'shell',
                payload,
                meta: {
                    timeoutMs,
                },
            },
            {}
        );

        return new Promise((resolve, reject) => {
            const timerId = globalThis.setTimeout(() => {
                this.pendingRequests.delete(message.id);
                reject(new Error('Request timed out for topic: ' + topic));
            }, timeoutMs);

            this.pendingRequests.set(message.id, {
                resolve,
                reject,
                timerId,
            });

            try {
                this.postRawMessage(message, options.targetWindow);
            } catch (error) {
                clearTimeout(timerId);
                this.pendingRequests.delete(message.id);
                reject(error);
            }
        });
    }

    handleRequest(topic, handler) {
        if (typeof topic !== 'string' || !topic) {
            throw new Error('handleRequest(topic, handler): topic must be a non-empty string');
        }
        if (typeof handler !== 'function') {
            throw new Error('handleRequest(topic, handler): handler must be a function');
        }

        this.requestHandlers.set(topic, handler);

        return () => {
            this.requestHandlers.delete(topic);
        };
    }

    registerService(serviceId, frameWindow, options = {}) {
        if (this.mode !== 'shell') {
            throw new Error('registerService is only available in shell mode');
        }
        if (typeof serviceId !== 'string' || !serviceId) {
            throw new Error('registerService(serviceId, frameWindow): serviceId must be a non-empty string');
        }
        if (!frameWindow || typeof frameWindow.postMessage !== 'function') {
            throw new Error('registerService(serviceId, frameWindow): frameWindow must be a Window reference');
        }

        this.services.set(serviceId, {
            windowRef: frameWindow,
            origin: options.origin || '*',
        });

        if (!this.frameSubscriptions.has(serviceId)) {
            this.frameSubscriptions.set(serviceId, new Set());
        }
    }

    routeRequestTopic(topic, serviceId) {
        if (this.mode !== 'shell') {
            throw new Error('routeRequestTopic is only available in shell mode');
        }

        this.requestRoutes.set(topic, serviceId);
    }

    sendEnvelope({ type, topic, payload, target = '*', correlationId, meta }, targetWindow) {
        if (typeof topic !== 'string' || !topic) {
            throw new Error('topic must be a non-empty string');
        }

        const message = createMessageEnvelope(
            {
                type,
                topic,
                source: this.serviceId,
                target,
                payload,
            },
            correlationId ? { correlationId } : {}
        );

        if (meta !== undefined) {
            message.meta = meta;
        }

        this.postRawMessage(message, targetWindow);
        return message.id;
    }

    postRawMessage(message, targetWindow) {
        if (this.mode === 'shell') {
            const resolvedTargetWindow = targetWindow || this.resolveTargetWindow(message.target);
            if (!resolvedTargetWindow) {
                throw new Error('Cannot resolve target window for message topic: ' + message.topic);
            }
            const targetOrigin = this.resolveTargetOrigin(message.target);
            this.logOutgoingMessage(message, resolvedTargetWindow, targetOrigin);
            resolvedTargetWindow.postMessage(message, targetOrigin);
            return;
        }

        if (!this.parentWindow || this.parentWindow === globalThis) {
            throw new Error('Frame broker requires a parent window');
        }
        this.logOutgoingMessage(message, this.parentWindow, this.targetOrigin);
        this.parentWindow.postMessage(message, this.targetOrigin);
    }

    resolveTargetWindow(target) {
        if (!target || target === '*' || target === 'shell') {
            return null;
        }
        const service = this.services.get(target);
        return service ? service.windowRef : null;
    }

    resolveTargetOrigin(target) {
        if (!target || target === '*' || target === 'shell') {
            return '*';
        }
        const service = this.services.get(target);
        return service && service.origin ? service.origin : '*';
    }

    onMessage(event) {
        const message = event.data;

        if (!isValidBaseEnvelope(message)) return;

        this.logIncomingMessage(event, message);

        if (this.hasSeenMessage(message.id)) return;
        this.markMessageSeen(message.id);

        if (this.mode === 'frame') {
            this.processFrameMessage(event, message);
            return;
        }

        this.processShellMessage(event, message);
    }

    processFrameMessage(event, message) {
        if (event.source !== this.parentWindow) return;
        if (!this.isOriginAllowed(event.origin)) return;

        if (message.type === TYPE_RESPONSE || message.type === TYPE_ERROR) {
            this.resolvePendingRequest(message);
            return;
        }

        if (message.type === TYPE_EVENT) {
            this.dispatchLocalEvent(message);
            return;
        }

        if (message.type === TYPE_REQUEST) {
            this.executeRequestHandler(message, event, (responseMessage) => {
                this.parentWindow.postMessage(responseMessage, this.targetOrigin);
            });
            return;
        }

        if (message.type === TYPE_CONTROL && message.topic === CONTROL_READY) {
            this.sendSubscriptionUpdate();
        }
    }

    processShellMessage(event, message) {
        if (!this.isOriginAllowed(event.origin)) return;
        if (!this.isServiceAllowed(message.source)) return;

        if (message.type === TYPE_CONTROL) {
            this.handleControlMessage(event, message);
            return;
        }

        if (message.type === TYPE_EVENT) {
            this.dispatchLocalEvent(message);
            this.forwardEventToSubscribers(message);
            return;
        }

        if (message.type === TYPE_REQUEST) {
            this.handleShellRequest(event, message);
            return;
        }

        if (message.type === TYPE_RESPONSE || message.type === TYPE_ERROR) {
            this.resolvePendingRequest(message);
            this.forwardReplyToTarget(message);
        }
    }

    handleControlMessage(event, message) {
        if (message.topic === CONTROL_REGISTER) {
            this.services.set(message.source, {
                windowRef: event.source,
                origin: event.origin,
            });

            if (!this.frameSubscriptions.has(message.source)) {
                this.frameSubscriptions.set(message.source, new Set());
            }

            const readyMessage = createMessageEnvelope({
                type: TYPE_CONTROL,
                topic: CONTROL_READY,
                source: this.serviceId,
                target: message.source,
                payload: {
                    serviceId: message.source,
                },
            });

            event.source.postMessage(readyMessage, event.origin || '*');
            return;
        }

        if (message.topic === CONTROL_SUBSCRIPTIONS) {
            const topics = Array.isArray(message.payload && message.payload.topics)
                ? message.payload.topics
                : [];
            this.frameSubscriptions.set(message.source, normalizeStringSet(topics));
        }
    }

    handleShellRequest(event, message) {
        const target = message.target || 'shell';

        if (target === 'shell') {
            this.executeRequestHandler(message, event, (responseMessage) => {
                event.source.postMessage(responseMessage, event.origin || '*');
            });
            return;
        }

        const targetService = target === '*' ? this.requestRoutes.get(message.topic) : target;
        if (!targetService) {
            const errorMessage = this.makeErrorResponse(message, 'route_not_found', 'No target service found for request topic');
            event.source.postMessage(errorMessage, event.origin || '*');
            return;
        }

        const service = this.services.get(targetService);
        if (!service || !service.windowRef) {
            const errorMessage = this.makeErrorResponse(message, 'service_unavailable', 'Target service is not registered');
            event.source.postMessage(errorMessage, event.origin || '*');
            return;
        }

        const forwardMessage = {
            ...message,
            target: targetService,
        };

        service.windowRef.postMessage(forwardMessage, service.origin || '*');
    }

    executeRequestHandler(message, event, replyFn) {
        const handler = this.requestHandlers.get(message.topic);
        if (!handler) {
            replyFn(this.makeErrorResponse(message, 'handler_not_found', 'No request handler registered for topic'));
            return;
        }

        Promise.resolve(
            safeInvoke(handler, {
                payload: message.payload,
                source: message.source,
                topic: message.topic,
                meta: message.meta || {},
                raw: message,
                event,
            })
        ).then((result) => {
            const response = createMessageEnvelope(
                {
                    type: TYPE_RESPONSE,
                    topic: message.topic,
                    source: this.serviceId,
                    target: message.source,
                    correlationId: message.id,
                    payload: result,
                },
                {}
            );
            replyFn(response);
        }).catch((error) => {
            replyFn(this.makeErrorResponse(message, 'request_failed', error && error.message ? error.message : 'Request handler failed'));
        });
    }

    makeErrorResponse(requestMessage, code, message) {
        return createMessageEnvelope(
            {
                type: TYPE_ERROR,
                topic: requestMessage.topic,
                source: this.serviceId,
                target: requestMessage.source,
                correlationId: requestMessage.id,
                payload: {
                    code,
                    message,
                },
            },
            {}
        );
    }

    resolvePendingRequest(message) {
        if (!message.correlationId) return;

        const pending = this.pendingRequests.get(message.correlationId);
        if (!pending) return;

        clearTimeout(pending.timerId);
        this.pendingRequests.delete(message.correlationId);

        if (message.type === TYPE_ERROR) {
            const errPayload = isPlainObject(message.payload) ? message.payload : { message: 'Unknown error' };
            const error = new Error(errPayload.message || 'Request failed');
            error.code = errPayload.code;
            error.details = errPayload.details;
            pending.reject(error);
            return;
        }

        pending.resolve(message.payload);
    }

    dispatchLocalEvent(message) {
        const handlers = this.subscriptions.get(message.topic);
        if (!handlers || handlers.size === 0) return;

        for (const handler of handlers) {
            safeInvoke(handler, {
                topic: message.topic,
                payload: message.payload,
                source: message.source,
                raw: message,
            });
        }
    }

    forwardEventToSubscribers(message) {
        for (const [serviceId, topics] of this.frameSubscriptions.entries()) {
            if (serviceId === message.source) continue;
            if (!topics.has(message.topic)) continue;

            const service = this.services.get(serviceId);
            if (!service || !service.windowRef) continue;

            service.windowRef.postMessage(message, service.origin || '*');
        }
    }

    forwardReplyToTarget(message) {
        if (!message.target || message.target === 'shell' || message.target === '*') return;

        const targetService = this.services.get(message.target);
        if (!targetService || !targetService.windowRef) return;

        targetService.windowRef.postMessage(message, targetService.origin || '*');
    }

    sendControl(topic, payload, target = 'shell') {
        this.sendEnvelope({
            type: TYPE_CONTROL,
            topic,
            payload,
            target,
        });
    }

    sendSubscriptionUpdate() {
        const topics = Array.from(this.subscriptions.keys());
        this.sendControl(CONTROL_SUBSCRIPTIONS, { topics }, 'shell');
    }

    hasSeenMessage(messageId) {
        return this.seenMessageIds.has(messageId);
    }

    markMessageSeen(messageId) {
        this.seenMessageIds.add(messageId);
        this.seenMessageQueue.push(messageId);

        if (this.seenMessageQueue.length <= this.maxSeenMessageIds) return;

        const oldest = this.seenMessageQueue.shift();
        if (oldest) this.seenMessageIds.delete(oldest);
    }

    isOriginAllowed(origin) {
        if (!this.allowedOrigins.size) return true;
        return this.allowedOrigins.has(origin);
    }

    isServiceAllowed(serviceId) {
        if (!this.allowedServices.size) return true;
        return this.allowedServices.has(serviceId);
    }
}

export function createShellBroker(options = {}) {
    const broker = new TrackifyBroker({
        mode: 'shell',
        serviceId: options.serviceId || 'shell',
        allowedServices: options.allowedServices,
        allowedOrigins: options.allowedOrigins,
        requestTimeoutMs: options.requestTimeoutMs,
    });

    return broker;
}

export function createFrameBroker(options = {}) {
    if (!options.serviceId) {
        throw new Error('createFrameBroker requires serviceId');
    }

    const broker = new TrackifyBroker({
        mode: 'frame',
        serviceId: options.serviceId,
        targetOrigin: options.targetOrigin || '*',
        requestTimeoutMs: options.requestTimeoutMs,
        allowedOrigins: options.allowedOrigins,
        parentWindow: options.parentWindow,
    });

    return broker;
}

export const BrokerTopics = {
    control: {
        register: CONTROL_REGISTER,
        ready: CONTROL_READY,
        subscriptionsUpdate: CONTROL_SUBSCRIPTIONS,
    },
};
