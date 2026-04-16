import { App } from './app.js';
import { JSONDiff } from './JSONDiff.js';
import { toRaw } from 'vue';

/** Deep clone that strips Vue reactive proxies before serializing. */
export function deepCloneRaw(obj: unknown): unknown {
    obj = toRaw(obj);
    if (Array.isArray(obj)) return obj.map(deepCloneRaw);
    if (obj && typeof obj === 'object') {
        const clone: Record<string, unknown> = {};
        for (const key of Object.keys(obj as Record<string, unknown>)) {
            clone[key] = deepCloneRaw((obj as Record<string, unknown>)[key]);
        }
        return clone;
    }
    return obj;
}

type NetworkMessage = { command: string; params: Record<string, unknown> };
type MessageHandler = (data: NetworkMessage) => Record<string, unknown> | Promise<Record<string, unknown>>;
type EventCallback = (params: Record<string, unknown>) => void;

export class Network {
    static id = Math.floor(Math.random() * 0xFFFFFF);
    static ready = false;
    static socket: WebSocket | null = null;
    static messageHandlers = new Map<number, (response: Record<string, unknown>) => void>();
    static currentMessageId = 1;
    static messageQueue: Array<[NetworkMessage, (response: Record<string, unknown>) => void, ReturnType<typeof setTimeout>]> = [];
    static onMessageCallback: MessageHandler | null = null;
    static eventHandlers = new Map<string, Set<EventCallback>>();
    static reconnectAttempts = 0;
    static maxReconnectAttempts = 10;
    static wasConnected = false;
    static isReconnecting = false;

    static initialize(): Promise<void> {
        return new Promise((resolve) => {
            async function handleMessage(data: NetworkMessage) {
                try {
                    switch(data.command) {
                        case 'setup': {
                            App.data = data.params.data;
                            App.originalData = JSON.parse(JSON.stringify(data.params.data));
                            App.windowParams = data.params.params;

                            resolve();
                            break;
                        }
                        case 'editData': {
                            // Use Vue-safe deep clone to avoid JSON.stringify corruption
                            // on reactive proxies (produces null array entries otherwise).
                            const { fullDiff, derivedDiff } = JSONDiff.processIncomingDiff(App.data, data.params, deepCloneRaw);

                            // Sync App.originalData to match App.data.
                            // originalData tracks "last known server state" - used to compute diffs on save().
                            // This is NOT redundant: processIncomingDiff mutated App.data, not App.originalData.
                            JSONDiff.applyDataDiff(App.originalData, fullDiff);

                            // If client-side watchers generated changes, send them back to the server.
                            if(!JSONDiff.isPointlessDiff(derivedDiff)) {
                                await Network.send({command: 'editData', params: derivedDiff});
                            }
                            break;
                        }
                        default:
                            console.error(`Unrecognized command ${data.command}`);
                            break;
                    }
                    return {success: true};
                } catch(err) {
                    console.error(err);
                    return {success: false}
                }
            }
            Network.onMessage(handleMessage);

            // Get the windowId from the URL and store in App
            const url = new URL(window.location.href);
            const windowId = Number(url.searchParams.get('windowId'));
            App.windowId = windowId;
            Network.send({command: 'setup', params: {windowId}})
            .then((response) => {
                if(!response.success) {
                    throw new Error('Unable to get data');
                }
                handleMessage({command: 'setup', params: response.params as Record<string, unknown>});
            });
            Network.connect();
        });
    }

    static connect(): Promise<void> {
        return new Promise((resolve) => {
            Network.socket = new WebSocket(`ws://${window.location.host}/ws?id=${Network.id}`);
            Network.socket.onopen = () => {
                Network.socket!.send(JSON.stringify(['SETUP', {name: 'browser'}])+'\n');
                Network.reconnectAttempts = 0;
                Network.wasConnected = true;
                resolve();
            };
            Network.socket.onerror = () => {
                // Errors are always followed by onclose, reconnect logic lives there
            };
            Network.socket.onclose = () => {
                Network.ready = false;

                // Reject all pending message handlers so callers don't hang forever
                for (const [id, handler] of Network.messageHandlers) {
                    handler({ success: false, error: 'WebSocket closed' } as Record<string, unknown>);
                }
                Network.messageHandlers.clear();

                if (!Network.wasConnected) return;

                if (Network.reconnectAttempts >= Network.maxReconnectAttempts) {
                    Network.showLostConnection();
                    return;
                }

                const delay = Math.min(1000 * Math.pow(2, Network.reconnectAttempts), 10000);
                Network.reconnectAttempts++;
                Network.isReconnecting = true;
                setTimeout(() => Network.connect(), delay);
            };
            Network.socket.onmessage = async (event: MessageEvent) => {
                const segments = event.data.split('\n');
                for(let i=0; i<segments.length; ++i) {
                    if(segments[i] === '') {
                        continue;
                    }
                    const arr = JSON.parse(segments[i]);
                    if(Array.isArray(arr)) {
                        const [type, id, message] = arr;
                        if(type === 'SETUP') {
                            Network.ready = true;
                            // Re-send setup command after reconnect to refresh App.data
                            if (Network.isReconnecting) {
                                Network.isReconnecting = false;
                                Network.send({command: 'setup', params: {windowId: App.windowId}})
                                .then((response) => {
                                    if (response.success && Network.onMessageCallback) {
                                        Network.onMessageCallback({command: 'setup', params: response.params as Record<string, unknown>});
                                    }
                                }).catch(console.error);
                            }
                            Network.messageQueue.forEach(([message, callback, timeout]) => {
                                clearTimeout(timeout);
                                Network.send(message).then(callback).catch(console.error);
                            });
                            Network.messageQueue.length = 0;
                        } else if(type === 'REQUEST') {
                            if(Network.onMessageCallback === null) {
                                throw new Error('Network.onmessage: No callback registered');
                            }
                            const answer = await Network.onMessageCallback(message);
                            Network.socket!.send(JSON.stringify(['RESPONSE', id, answer])+'\n');
                        } else if(type === 'RESPONSE') {
                            if (Network.messageHandlers.has(id)) {
                                Network.messageHandlers.get(id)!(message);
                                Network.messageHandlers.delete(id);
                            } else {
                                throw new Error(`Network.onmessage: No handler for message ${id}`);
                            }
                        } else if(type === 'EVENT') {
                            // Broadcast event from server (e.g., editData from another window)
                            // Format: ["EVENT", eventType, data] - id is eventType, message is data
                            const handlers = Network.eventHandlers.get(id);
                            if (handlers && handlers.size > 0) {
                                handlers.forEach(handler => handler(message));
                            } else if(id === 'editData' && Network.onMessageCallback !== null) {
                                // Route editData events through the message callback
                                // (editData broadcasts use the same handler as requests)
                                Network.onMessageCallback({command: id, params: message});
                            }
                            // Other event types silently ignored if no handler registered
                        } else {
                            throw new Error(`Network.onmessage: Invalid message type: ${type}`);
                        }
                    } else {
                        throw new Error('Network.onmessage: Invalid message');
                    }
                }
            };
        });
    }

    static send(message: NetworkMessage): Promise<Record<string, unknown>> {
        return new Promise((resolve) => {
            if(Network.ready) {
                const id = Network.currentMessageId++;
                const timeout = setTimeout(() => {
                    if (Network.messageHandlers.has(id)) {
                        Network.messageHandlers.delete(id);
                        resolve({ success: false, error: 'Message timed out waiting for response' });
                    }
                }, 30000);
                Network.messageHandlers.set(id, (response) => {
                    clearTimeout(timeout);
                    resolve(response);
                });
                Network.socket!.send(JSON.stringify(['REQUEST', id, message])+'\n');
            } else {
                const wrapper = (response: Record<string, unknown>) => {
                    clearTimeout(timeout);
                    resolve(response);
                };
                const timeout = setTimeout(() => {
                    const idx = Network.messageQueue.findIndex(([, cb]) => cb === wrapper);
                    if (idx !== -1) Network.messageQueue.splice(idx, 1);
                    resolve({ success: false, error: 'Queued message timed out waiting for connection' });
                }, 30000);
                Network.messageQueue.push([message, wrapper, timeout]);
            }
        });
    }

    static onMessage(callback: MessageHandler): void {
        Network.onMessageCallback = callback;
    }

    static addEventListener(eventType: string, callback: EventCallback): void {
        if (!Network.eventHandlers.has(eventType)) {
            Network.eventHandlers.set(eventType, new Set());
        }
        Network.eventHandlers.get(eventType)!.add(callback);
    }

    static removeEventListener(eventType: string, callback: EventCallback): void {
        const handlers = Network.eventHandlers.get(eventType);
        if (handlers) {
            handlers.delete(callback);
        }
    }

    static showLostConnection(): void {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#6b7280;font-size:14px">Lost connection to RAFlash</div>';
    }
}
