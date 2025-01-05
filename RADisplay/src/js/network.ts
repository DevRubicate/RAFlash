import { App } from './app.js';
import { JSONDiff } from './JSONDiff.js';

type NetworkMessage = { command: string; params: Record<string, unknown> };
type MessageHandler = (data: NetworkMessage) => Record<string, unknown> | Promise<Record<string, unknown>>;
type EventCallback = (params: Record<string, unknown>) => void;

export class Network {
    static id = Math.floor(Math.random() * 0xFFFFFF);
    static ready = false;
    static socket: WebSocket | null = null;
    static messageHandlers = new Map<number, (response: Record<string, unknown>) => void>();
    static currentMessageId = 1;
    static messageQueue: Array<[NetworkMessage, (response: Record<string, unknown>) => void]> = [];
    static onMessageCallback: MessageHandler | null = null;
    static eventHandlers = new Map<string, Set<EventCallback>>();
    static reconnectAttempts = 0;
    static maxReconnectAttempts = 10;
    static wasConnected = false;

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
                            // processIncomingDiff applies the server's changes to App.data (the working copy).
                            // It also triggers any client-side watchers (if registered).
                            const { fullDiff, derivedDiff } = JSONDiff.processIncomingDiff(App.data, data.params);

                            // Sync App.originalData to match App.data.
                            // originalData tracks "last known server state" - used to compute diffs on save().
                            // This is NOT redundant: processIncomingDiff mutated App.data, not App.originalData.
                            JSONDiff.applyDataDiff(App.originalData, fullDiff);

                            // If client-side watchers generated changes, send them back to the server.
                            // (In practice, watchers are typically only on the server side.)
                            if(!JSONDiff.isPointlessDiff(derivedDiff)) {
                                console.log('editData sending derivedDiff back to server');
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
                if (!Network.wasConnected) return;

                if (Network.reconnectAttempts >= Network.maxReconnectAttempts) {
                    Network.showLostConnection();
                    return;
                }

                const delay = Math.min(1000 * Math.pow(2, Network.reconnectAttempts), 10000);
                Network.reconnectAttempts++;
                setTimeout(() => Network.connect(), delay);
            };
            Network.socket.onmessage = (event: MessageEvent) => {
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
                            Network.messageQueue.forEach(([message, callback]) => {
                                Network.send(message).then(callback).catch(console.error);
                            });
                            Network.messageQueue.length = 0;
                        } else if(type === 'REQUEST') {
                            if(Network.onMessageCallback === null) {
                                throw new Error('Network.onmessage: No callback registered');
                            }
                            const answer = Network.onMessageCallback(message);
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
                            } else if(Network.onMessageCallback !== null) {
                                Network.onMessageCallback({command: id, params: message});
                            }
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
                Network.messageHandlers.set(id, resolve);
                Network.socket!.send(JSON.stringify(['REQUEST', id, message])+'\n');
            } else {
                Network.messageQueue.push([message, resolve]);
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
