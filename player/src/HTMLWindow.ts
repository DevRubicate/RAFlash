import { ensureDir }    from 'https://deno.land/std/fs/mod.ts';
import { join }         from 'https://deno.land/std/path/mod.ts';

class HTMLWindow {
    static instances:Array<HTMLWindow> = [];

    process:Deno.ChildProcess;
    tempDir:string;
    chromeUserDataDir:string;
    constructor(url:string, width:number, height:number, windowId:number, tempDir:string, chromeUserDataDir:string) {
        this.tempDir = tempDir;
        this.chromeUserDataDir = chromeUserDataDir;
        const platform = Deno.build.os;
        const chromeArgs = [
            `--app=http://localhost:8080/${url}?windowId=${windowId}`,
            '--new-window',
            '--no-first-run',
            '--no-proxy-server',
            '--safe-mode',
            '--disable-background-mode',
            '--disable-plugins',
            '--disable-plugins-discovery',
            '--disable-translate',
            '--disable-features=Translate',
            '--bwsi',
            '--disable-sync',
            '--disable-sync-preferences',
            '--disable-component-update',
            '--allow-insecure-localhost',
            '--disable-features=TitleBar',
            `--window-size=${width},${height}`,
            `--user-data-dir=${chromeUserDataDir}`,
        ];
      
        let command: string;
        let args: string[];
      
        if (platform === 'darwin') {
            // macOS
            command = 'open';
            args = ['-a', 'Google Chrome', '--args', ...chromeArgs];
        } else if (platform === 'windows') {
            // Windows
            command = 'cmd';
            args = ['/c', 'start', 'chrome', ...chromeArgs];
        } else if (platform === 'linux') {
            // Linux
            command = 'google-chrome';
            args = chromeArgs;
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }
      
        const browserCommand = new Deno.Command(command, {
            args,
            stdout: 'piped',
            stderr: 'piped',
        });

        this.process = browserCommand.spawn();
        HTMLWindow.readStream(this.process.stdout, (chunk) => console.log(chunk));
        HTMLWindow.readStream(this.process.stderr, (chunk) => console.error(chunk));
        HTMLWindow.instances.push(this);
    }

    private static async readStream(stream: ReadableStream<Uint8Array>, callback: (chunk: string) => void) {
        const decoder = new TextDecoder();
        const reader = stream.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                callback(text);
            }
        } finally {
            reader.releaseLock();
        }
    }

    static async create(url:string, width:number, height:number, windowId:number) {
        // Define the temporary directory path
        const tempDir = await Deno.makeTempDir();
        const chromeUserDataDir = join(tempDir, 'chrome-user-data');
        // Ensure the directory exists
        await ensureDir(chromeUserDataDir);

        new HTMLWindow(url, width, height, windowId, tempDir, chromeUserDataDir);
    }

    static async shutdown() {
        // Use WMIC to kill all processes with the same user-data-dir
        for(const instance of HTMLWindow.instances) {
            try {
                const formattedDir = instance.chromeUserDataDir.replace(/\\/g, '\\\\');
                const killCommand = new Deno.Command('wmic', {
                    args: [
                        'process',
                        'where',
                        `commandline like '%--user-data-dir=${formattedDir}%'`,
                        'call',
                        'terminate',
                    ],
                    stdout: 'null', // Suppress standard output
                    stderr: 'null', // Suppress error output
                });
                const killProcess = killCommand.spawn();
                await killProcess.status;
            } catch (_err) {
                // Ignore any errors that occur during the WMIC command
            }
            await Deno.remove(instance.tempDir, { recursive: true });
        }
    }
}

export default HTMLWindow;
