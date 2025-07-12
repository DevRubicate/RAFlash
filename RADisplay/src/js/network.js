import { App } from './app.js';

export class Network {
    static id = Math.floor(Math.random() * 0xFFFFFF);
    static ready = false;
    static socket = null;
    static messageHandlers = new Map();
    static currentMessageId = 1;
    static messageQueue = [];
    static onMessageCallback = null;

    static initialize() {
        return new Promise((resolve) => {
            function handleMessage(data) {
                try {
                    switch(data.command) {
                        case 'setup': {
                            App.data = data.params.data;
                            App.originalData = JSON.parse(JSON.stringify(data.params.data));
                            App.windowParams = data.params.params;

                            resolve();
                            break;
                        }
                        case 'editData':
                            App.applyDataDiff(data.params);
                            break;
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

            // Get the windowId from the URL
            const url = new URL(window.location.href);
            const windowId = Number(url.searchParams.get('windowId'));
            Network.sendMessage({command: 'setup', params: {windowId}})
            .then((response) => {
                if(!response.success) {
                    throw new Error('Unable to get data');
                }
                handleMessage({command: 'setup', params: response.params});
            });
            Network.connect();
        });
    }

    static connect() {
        return new Promise((resolve) => {
            Network.socket = new WebSocket('http://localhost:8080/ws?id='+Network.id);
            Network.socket.onopen = () => {
                Network.socket.send(JSON.stringify(['SETUP', {name: 'browser'}])+'\n');
                resolve();
            };
            Network.socket.onerror = (err) => {
                throw err;
            };
            Network.socket.onclose = () => {
                console.log('Disconnected from server');
            };
            Network.socket.onmessage = (event) => {
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
                                Network.sendMessage(message).then(callback).catch(console.error);
                            });
                            Network.messageQueue.length = 0;
                        } else if(type === 'REQUEST') {
                            if(Network.onMessageCallback === null) {
                                throw new Error('Network.onmessage: No callback registered');
                            }
                            const answer = Network.onMessageCallback(message);
                            Network.socket.send(JSON.stringify(['RESPONSE', id, answer])+'\n');
                        } else if(type === 'RESPONSE') {
                            if (Network.messageHandlers.has(id)) {
                                Network.messageHandlers.get(id)(message);
                                Network.messageHandlers.delete(id);
                            } else {
                                throw new Error(`Network.onmessage: No handler for message ${id}`);
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
  
    static sendMessage(message) {
        return new Promise((resolve) => {
            if(Network.ready) {
                const id = Network.currentMessageId++;
                Network.messageHandlers.set(id, resolve);
                Network.socket.send(JSON.stringify(['REQUEST', id, message])+'\n');
            } else {
                Network.messageQueue.push([message, resolve]);
            }
        }).catch(console.error);
    }

    static onMessage(callback) {
        Network.onMessageCallback = callback;
    }
}