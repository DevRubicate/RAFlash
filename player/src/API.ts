import { join, SEPARATOR }  from 'https://deno.land/std/path/mod.ts';
import { HTMLWindow }       from '#src/HTMLWindow.ts';
import { AppData }          from '#src/AppData.ts';
import { Network }          from '#src/Network.ts';
import { Formula }          from '#src/formula/Formula.ts';
import { JSONDiff }         from './JSONDiff.ts';

export class API {
    static setupWindow = new Map<number, any>();
    static async handle(_origin:string, input: { command: string, params: any }): Promise<any> {
        switch (input.command) {
            case 'ping': {
                return {success: true};
            }
            case 'setup': {
                const windowId = input.params.windowId;
                if(!API.setupWindow.has(windowId)) {
                    throw new Error(`API.setupWindow: No window found for windowId ${windowId}`);
                }
                const params = API.setupWindow.get(windowId);
                API.setupWindow.delete(windowId);
                return {success: true, params: {data: AppData.data, params: params}};
            }
            case 'showPopup': {
                const windowId = Math.floor(Math.random() * 0xFFFFFF);
                const width = input.params.width ?? 800;
                const height = input.params.height ?? 600;
                API.setupWindow.set(windowId, input.params.params);
                HTMLWindow.create(input.params.url, width, height, windowId);
                return {success: true};
            }
            case 'getDirectoryInfo': {
                return {
                    success: true,
                    params: {currentDirectory: Deno.cwd().split(SEPARATOR)},
                };
            }
            case 'readDirectory': {
                return {
                    success: true,
                    params: Array.from(Deno.readDirSync(join('.', input.params.path))).map((entry:Deno.DirEntry) => {
                        return {name: entry.name, type: entry.isDirectory ? 'directory' : 'file'};
                    })
                };
            }
            case 'loadFile': {
                return {success: true, params: {hash: 'abc123', data: AppData.data}};
            }
            case 'editData': {
                const finalDiff = JSONDiff.processIncomingDiff(input.params);
                JSONDiff.applyDataDiff(finalDiff);
                Network.send('ALL', {command: 'editData', params: finalDiff});
                AppData.saveData();
                return {success: true};
            }
            case 'evaluate': {
                let compiledFormula:string;
                let valid;
                try {
                    compiledFormula = Formula.compile(input.params.input);
                    valid = true;
                } catch (_err:unknown) {
                    console.log(_err);
                    compiledFormula = '';
                    valid = false;
                }

                const output = await Network.send('FLASH', {command: 'evaluate', params: compiledFormula});
                return {
                    success: true,
                    params: {result: output[0].result, valid: valid},
                };
            }
            default:
                throw new Error(`Invalid command "${input.command}"`);
        }
    }
}