import HTMLWindow       from '#src/HTMLWindow.ts';
import {AppData}        from '#src/AppData.ts';
import Network          from '#src/Network.ts';
import { join }         from 'https://deno.land/std/path/mod.ts';

class API {
    static setupWindow = new Map<number, any>();
    static handle(_origin:string, input: { command: string, params: any }): Promise<any> {
        return new Promise((resolve, reject) => {
            switch (input.command) {
                case 'ping': {
                    resolve({success: true});
                    break;
                }
                case 'setup': {
                    const windowId = input.params.windowId;
                    if(!API.setupWindow.has(windowId)) {
                        throw new Error(`API.setupWindow: No window found for windowId ${windowId}`);
                    }
                    resolve({success: true, params: {data: AppData.data, params: API.setupWindow.get(windowId)}});
                    API.setupWindow.delete(windowId);
                    break;
                }
                case 'showPopup': {
                    const windowId = Math.floor(Math.random() * 0xFFFFFF);
                    const width = input.params.width ?? 800;
                    const height = input.params.height ?? 600;
                    API.setupWindow.set(windowId, input.params.params);
                    HTMLWindow.create(input.params.url, width, height, windowId);
                    resolve({success: true});
                    break;
                }
                case 'readDirectory': {
                    resolve({
                        success: true,
                        params: Array.from(Deno.readDirSync(join('.', input.params.path))).map((entry:Deno.DirEntry) => {
                            return {name: entry.name, type: entry.isDirectory ? 'directory' : 'file'};
                        })
                    });
                    break;
                }
                case 'editData': {
                    AppData.applyDataDiff(input.params);
                    Network.send('ALL', {command: 'editData', params: input.params});
                    resolve({success: true});
                    break;
                }
                default:
                    reject(`Invalid command "${input.command}"`);
            }
        });
    }
}


export default API;
