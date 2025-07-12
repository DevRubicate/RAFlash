import { ensureDir } from "https://deno.land/std/fs/mod.ts";
import { join }      from "https://deno.land/std/path/mod.ts";
import { exists }    from "https://deno.land/std/fs/exists.ts";

export class HTMLWindow {
    static instances: Array<HTMLWindow> = [];

    process: Deno.ChildProcess;
    tempDir: string;
    chromeUserDataDir: string;
    isClosed: boolean;

    // The constructor is private and is only called by the async `create` method.
    private constructor(process: Deno.ChildProcess, tempDir: string, chromeUserDataDir: string, windowId: number) {
        this.process = process;
        this.tempDir = tempDir;
        this.chromeUserDataDir = chromeUserDataDir;
        this.isClosed = false;
        
        // Asynchronously update the state when the user closes the window.
        this.process.status.then(() => {
            this.isClosed = true;
        });

        HTMLWindow.instances.push(this);
    }
    
    /**
     * Asynchronously creates and spawns a new Chrome window.
     * This is the public method for creating new instances.
     */
    static async create(url: string, width: number, height: number, windowId: number) {
        const platform = Deno.build.os;
        
        const chromeArgs = [
            `--app=http://localhost:8080/${url}?windowId=${windowId}`,
            '--new-window',
            '--no-first-run',
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

        // Spawn the browser process.
        const browserCommand = new Deno.Command(commandPath, {
            args: chromeArgs,
        });
        const process = browserCommand.spawn();

        // Create the class instance now that the process is spawned.
        new HTMLWindow(process, tempDir, chromeUserDataDir, windowId);
    }

    /**
     * Shuts down all open Chrome windows managed by this class,
     * cleans up temporary files, and resets the state.
     */
    static async shutdown() {
        const closingPromises: Promise<void>[] = [];

        for (const instance of HTMLWindow.instances) {
            const closeAndCleanup = async () => {
                // First, check if the process hasn't already been closed by the user.
                if (!instance.isClosed) {
                    try {
                        // Silently kill the process.
                        instance.process.kill();
                        // Wait for the process to fully terminate.
                        await instance.process.status;
                    } catch (err) {
                        // Ignore a "BadResource" error, which means the process was already gone.
                        // This handles a race condition where the user closes the window
                        // just as shutdown is called.
                        if (!(err instanceof Deno.errors.BadResource)) {
                            // For any other unexpected error, log it.
                            if (err instanceof Error) {
                                console.error(`Error killing process: ${err.message}`);
                            } else {
                                console.error('An unexpected non-error was thrown while killing a process:', err);
                            }
                        }
                    }
                }

                // Finally, clean up the temporary directory for the user profile.
                try {
                    await Deno.remove(instance.tempDir, { recursive: true });
                } catch (err) {
                    // Safely handle the 'unknown' error type from the catch block.
                    if (err instanceof Error) {
                        console.error(`Failed to remove temp directory ${instance.tempDir}: ${err.message}`);
                    } else {
                        console.error(`Failed to remove temp directory ${instance.tempDir} due to an unknown error:`, err);
                    }
                }
            };
            closingPromises.push(closeAndCleanup());
        }

        // Wait for all windows to be closed and cleaned up before proceeding.
        await Promise.all(closingPromises);

        // Clear the instances array for a clean state.
        HTMLWindow.instances = [];
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