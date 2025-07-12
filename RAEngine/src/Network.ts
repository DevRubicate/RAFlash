import { API }                          from '#src/API.ts';
import { createServer, Socket, Server } from 'node:net';
import { Buffer }                       from 'node:buffer';
import { join }                         from 'https://deno.land/std@0.224.0/path/mod.ts';

export class Network {
    static http:Deno.HttpServer;
    static socket:Server;
    static clients:Map<number, {type: 'BROWSER' | 'FLASH', id:number, ws: WebSocket | Socket, currentMessageId:number, pending: Array<[number, any]>}> = new Map();

    static initialize() {
        // The HTTP server has a dual purpose, it's used to serve static files, but also to handle websockets from browser windows.
        Network.http = Deno.serve(
            {
                port: 8080,
                onListen() {},
            },
            async (req: Request): Promise<Response> => {
                const url = new URL(req.url);
                if(url.pathname === '/ws') {
                    const { socket, response } = Deno.upgradeWebSocket(req);
                    const clientId = parseInt(url.searchParams.get('id')!, 10);
                    if(typeof clientId !== 'number') {
                        throw new Error('Network.connect: No client Id specified');
                    }
                    Network.clients.set(clientId, {type: 'BROWSER', id: clientId, ws: socket, currentMessageId: 0, pending: []});
                    socket.onclose = () => Network.clients.delete(clientId);
                    socket.onmessage = async (event) => {
                        const segments = event.data.split('\n');
                        for(let i=0; i<segments.length; ++i) {
                            if(segments[i] === '') {
                                continue;
                            }
                            let data: ['SETUP', { name:string }] | ['REQUEST' | 'RESPONSE', number, { command: string, params: Record<string, any> }];
                            try {
                                data = JSON.parse(segments[i]);
                                if(!Array.isArray(data)) {
                                    throw null;
                                }
                            } catch {
                                console.error('Network.onmessage: Invalid message: '+segments[i]);
                                continue;
                            }
                            if(data[0] === 'SETUP') {
                                if(!Network.clients.has(clientId)) {
                                    throw new Error('Network.onmessage: Missing websocket client');
                                }
                                if(typeof data[1] !== 'object') {
                                    throw new Error('Network.onmessage: Invalid SETUP');
                                }
                                socket.send(JSON.stringify(['SETUP'])+'\n');
                            } else if(data[0] === 'REQUEST') {
                                const response = await API.handle(clientId, data[2]);
                                socket.send(JSON.stringify(['RESPONSE', data[1], response])+'\n');
                            } else if(data[0] === 'RESPONSE') {
                                if(!Network.clients.has(clientId)) {
                                    throw new Error('Network.onmessage: Missing websocket client');
                                }
                                if(typeof data[1] !== 'number') {
                                    throw new Error('Network.onmessage: Invalid message Id');
                                }
                                const pending = Network.clients.get(clientId)!.pending.find(entry => entry[0] === data[1]);
                                if(!pending) {
                                    throw new Error('Network.onmessage: Could not find pending message');
                                }

                                // Call the pending callback with the response
                                pending[1](data[2]);

                                // Remove the pending callback
                                Network.clients.get(clientId)!.pending.splice(Network.clients.get(clientId)!.pending.indexOf(pending), 1);
                            } else {
                                console.error(`Network.onmessage: Invalid message type: ${data[0]}`);
                                continue;
                            }
                        }
                    };
                    return response;
                } else {
                    try {
                        let path = '';
                        if(req.url.startsWith('http://localhost:8080/./')) {
                            // The path was relative
                            path = join(Deno.cwd(), url.pathname);
                        } else {
                            // The path was absolute
                            path = url.pathname.substring(1);
                        }
                        const file = await Deno.readFile(path);
                        const extension = url.pathname.split('.').pop();
                        const mimeTypes: Record<string, string> = {
                            html: 'text/html',
                            css: 'text/css',
                            js: 'application/javascript',
                            json: 'application/json',
                            txt: 'text/plain',
                            png: 'image/png',
                            jpg: 'image/jpeg',
                            jpeg: 'image/jpeg',
                            gif: 'image/gif',
                            svg: 'image/svg+xml',
                        };
                        const contentType = mimeTypes[extension || ''] || 'application/octet-stream';
                        return new Response(file, {
                            status: 200,
                            headers: { "Content-Type": contentType },
                        });
                    } catch (error) {
                        if (error instanceof Deno.errors.NotFound) {
                            return new Response("File not found", {
                                status: 404,
                                headers: { "Content-Type": "text/plain" },
                            });
                        } else {
                            return new Response("Internal Server Error", {
                                status: 500,
                                headers: { "Content-Type": "text/plain" },
                            });
                        }
                    }
                }
            }
        );
        // The socket server is used to handle socket connections from flash player.
        Network.socket = createServer((socket: Socket) => {
            const clientId = Math.floor(Math.random() * 0xFFFFFF);
            Network.clients.set(clientId, {
                type: 'FLASH',
                id: clientId,
                ws: socket,
                currentMessageId: 0,
                pending: []
            })

            const decoder = new TextDecoder();
            const encoder = new TextEncoder();

            socket.on('data', async (data: Buffer) => {
                const received = decoder.decode(Uint8Array.from(data).filter((byte) => byte !== 0));

                // Handle policy file requests from flash player
                if (received.trim() === '<policy-file-request/>') {
                    const policy = `<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\0`; // Null terminator
                    socket.write(policy);
                    // After requesting the policy file flash player always kills the socket and opens a new one.
                    socket.end();
                    socket.destroy();
                    Network.clients.delete(clientId);
                } else {
                    const segments = received.split('\n');
                    for(let i=0; i<segments.length; ++i) {
                        if(segments[i] === '') {
                            continue;
                        }
                        let data: ['REQUEST' | 'RESPONSE', number, { command: string, params: Record<string, any> }];
                        try {
                            data = JSON.parse(segments[i]);
                            if(!Array.isArray(data)) {
                                throw null;
                            }
                        } catch {
                            console.error(`Network.onmessage: Invalid message: ${segments[i]}`);
                            continue;
                        }

                        if(data[0] === 'REQUEST') {
                            try {
                                const response = await API.handle(clientId, data[2]);
                                socket.write(encoder.encode(JSON.stringify(['RESPONSE', data[1], response])+'\n'));
                            } catch (error) {
                                console.error(error);
                                socket.write(encoder.encode(JSON.stringify(['RESPONSE', data[1], { success: false, error: 'Internal server error' }])+'\n'));
                            }
                        } else if(data[0] === 'RESPONSE') {
                            try {
                                if(!Network.clients.has(clientId)) {
                                    throw new Error('Network.onmessage: Missing socket client');
                                }
                                if(typeof data[1] !== 'number') {
                                    throw new Error('Network.onmessage: Invalid message Id');
                                }
                                const pending = Network.clients.get(clientId)!.pending.find(entry => entry[0] === data[1]);
                                if(!pending) {
                                    throw new Error('Network.onmessage: Could not find pending message');
                                }

                                // Call the pending callback with the response
                                pending[1](data[2]);

                                // Remove the pending callback
                                Network.clients.get(clientId)!.pending.splice(Network.clients.get(clientId)!.pending.indexOf(pending), 1);
                            } catch (error) {
                                console.error('Error while handling response', data, error);
                            }
                        }
                    }
                }
            });

            socket.on('error', (err: Error) => {
                console.error('Socket error:', err);
                socket.end();
                socket.destroy();
                Network.clients.delete(clientId);
            });

            socket.on('close', () => {
                socket.end();
                socket.destroy();
                Network.clients.delete(clientId);
            });
        }).listen(8081);
        Network.socket.on('error', (err: Error) => {
            console.error('Server error:', err);
        });
    }

    static send(sourceId:number, target: 'BROWSER' | 'FLASH' | 'ALL' | 'SELF', message:any):Promise<Array<any>> {
        const clients = Array.from(Network.clients);
        const jobs = [];
        for(let i=0; i<clients.length; ++i) {
            const client = clients[i][1];
            if(
                (target === 'SELF' && sourceId === client.id) ||
                ((target === 'ALL' || client.type === target) && sourceId !== client.id)
            ) {
                let resolve;
                jobs.push(new Promise((r) => {resolve = r;}));
                const id = client.currentMessageId++;
                client.pending.push([id, resolve]);
                if(client.ws instanceof WebSocket) {
                    client.ws.send(JSON.stringify(['REQUEST', id, message])+'\n');
                } else if(client.ws instanceof Socket) {
                    const encoder = new TextEncoder();
                    client.ws.write(encoder.encode(JSON.stringify(['REQUEST', id, message])+'\n'));
                } else {
                    throw new Error('Network.send: Invalid socket');
                }
            }
        }
        return Promise.all(jobs);
    }

    static close() {
        Network.http.shutdown();
        Network.socket.close();
    }
}
