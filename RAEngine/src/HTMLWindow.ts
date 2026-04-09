import { ensureDir } from "https://deno.land/std/fs/mod.ts";
import { join }      from "https://deno.land/std/path/mod.ts";
import { exists }    from "https://deno.land/std/fs/exists.ts";
import { WindowManager } from "./WindowManager.ts";

export class HTMLWindow {
    static instances: Array<HTMLWindow> = [];

    process: Deno.ChildProcess;
    tempDir: string;
    chromeUserDataDir: string;
    windowId: number;
    isClosed: boolean;
    persistent: boolean;

    // The constructor is private and is only called by the async `create` method.
    private constructor(process: Deno.ChildProcess, tempDir: string, chromeUserDataDir: string, windowId: number) {
        this.process = process;
        this.tempDir = tempDir;
        this.chromeUserDataDir = chromeUserDataDir;
        this.windowId = windowId;
        this.isClosed = false;
        this.persistent = false;
        
        // Asynchronously update the state when the user closes the window.
        this.process.status.then(() => {
            this.isClosed = true;
        });

        HTMLWindow.instances.push(this);
    }
    
    /**
     * Asynchronously creates and spawns a new Chrome window.
     * This is the public method for creating new instances.
     * @param parentWindowId Optional - if provided, positions the new window to the right of the parent.
     * @param startX Optional - explicit X position (overrides parent/center calculation).
     * @param startY Optional - explicit Y position (overrides parent/center calculation).
     */
    static async create(url: string, width: number, height: number, windowId: number, parentWindowId?: number, startX?: number, startY?: number) {
        const platform = Deno.build.os;

        // Calculate window position
        let x: number;
        let y: number;

        if (startX !== undefined && startY !== undefined) {
            // Explicit position provided
            x = startX;
            y = startY;
        } else if (parentWindowId !== undefined) {
            // Position to the right of parent window
            const parentPos = WindowManager.getWindowPosition(parentWindowId);
            if (parentPos) {
                x = parentPos.x + parentPos.width;
                y = parentPos.y;
            } else {
                // Parent not found, fall back to center
                const screen = WindowManager.getScreenSize();
                x = Math.floor((screen.width - width) / 2);
                y = Math.floor((screen.height - height) / 2);
            }
        } else {
            // Default: center on screen
            const screen = WindowManager.getScreenSize();
            x = Math.floor((screen.width - width) / 2);
            y = Math.floor((screen.height - height) / 2);
        }

        const chromeArgs = [
            `--app=http://localhost:18080/${url}?windowId=${windowId}`,
            '--new-window',
            '--no-first-run',
            '--log-level=3',
            '--no-proxy-server',
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
            `--window-size=${width},${height}`,
            `--window-position=${x},${y}`,
        ];

        let commandPath: string | null = null;

        if (platform === 'darwin') {
            commandPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        } else if (platform === 'linux') {
            commandPath = 'google-chrome';
        } else if (platform === 'windows') {
            commandPath = await HTMLWindow.findChromeOnWindows();
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        if (!commandPath) {
            throw new Error(
                "Google Chrome could not be found. Please ensure it is installed in a standard location or that its executable is in your system's PATH."
            );
        }
        
        // Create a unique user data directory for this window instance.
        const tempDir = await Deno.makeTempDir();
        const chromeUserDataDir = join(tempDir, 'chrome-user-data');
        await ensureDir(chromeUserDataDir);
        chromeArgs.push(`--user-data-dir=${chromeUserDataDir}`);

        // Pre-grant clipboard permission for localhost:18080
        const defaultDir = join(chromeUserDataDir, 'Default');
        await ensureDir(defaultDir);
        const prefsPath = join(defaultDir, 'Preferences');
        const prefs = {
            profile: {
                content_settings: {
                    exceptions: {
                        clipboard: {
                            "http://localhost:18080,*": {
                                setting: 1
                            }
                        }
                    }
                }
            }
        };
        await Deno.writeTextFile(prefsPath, JSON.stringify(prefs));

        // Spawn the browser process.
        const browserCommand = new Deno.Command(commandPath, {
            args: chromeArgs,
        });
        const process = browserCommand.spawn();

        // Bring to front on Windows (non-blocking) and track HWND for future positioning
        if (Deno.build.os === "windows") {
            WindowManager.focusProcess(process.pid, width, height, windowId);
        }

        // Create the class instance now that the process is spawned.
        new HTMLWindow(process, tempDir, chromeUserDataDir, windowId);
    }

    /**
     * Returns a Promise that resolves when any HTMLWindow closes.
     * Useful for detecting when the user closes a window.
     */
    static waitForAnyClose(): Promise<void> {
        if (HTMLWindow.instances.length === 0) {
            return Promise.resolve();
        }
        return Promise.race(
            HTMLWindow.instances.map(w => w.process.status.then(() => {}))
        );
    }

    /**
     * Shuts down all open Chrome windows managed by this class,
     * cleans up temporary files, and resets the state.
     */
    async close() {
        if (!this.isClosed) {
            try {
                this.process.kill();
                await this.process.status;
            } catch {
                // Process already gone
            }
        }
        try {
            await Deno.remove(this.tempDir, { recursive: true });
        } catch {
            // Failed to remove temp dir
        }
        HTMLWindow.instances = HTMLWindow.instances.filter(w => w !== this);
    }

    static async shutdown(force = false) {
        const toClose = force
            ? HTMLWindow.instances
            : HTMLWindow.instances.filter(w => !w.persistent);
        const toKeep = force
            ? []
            : HTMLWindow.instances.filter(w => w.persistent && !w.isClosed);

        await Promise.all(toClose.map(async (instance) => {
            if (!instance.isClosed) {
                try {
                    instance.process.kill();
                    await instance.process.status;
                } catch {
                    // Process already gone or error killing - ignore
                }
            }
            try {
                await Deno.remove(instance.tempDir, { recursive: true });
            } catch {
                // Failed to remove temp dir - ignore
            }
        }));

        HTMLWindow.instances = toKeep;
    }

    /**
     * Finds the path to the Google Chrome executable on Windows by checking common locations.
     * @returns {Promise<string | null>} The full path to chrome.exe or null if not found.
     */
    private static async findChromeOnWindows(): Promise<string | null> {
        // List of environment variables pointing to common installation parent folders.
        const prefixes = [
            Deno.env.get('PROGRAMFILES(X86)'),
            Deno.env.get('PROGRAMFILES'),
            Deno.env.get('LOCALAPPDATA'),
        ].filter(Boolean) as string[]; // Filter out any undefined/null values

        for (const prefix of prefixes) {
            const chromePath = join(prefix, 'Google', 'Chrome', 'Application', 'chrome.exe');
            if (await exists(chromePath)) {
                return chromePath;
            }
        }

        // As a final fallback, try the command directly in case it is in the PATH after all.
        try {
            const checkCmd = new Deno.Command('chrome', { args: ['--version'], stdout: 'null', stderr: 'null' });
            const { code } = await checkCmd.output();
            if (code === 0) {
                return 'chrome';
            }
        } catch (_e) {
            // We can ignore this error, it just means 'chrome' is not in the path.
        }

        return null;
    }
}