/**
 * Windows-specific window management module using Deno FFI.
 * Provides functions to center windows and bring them to the foreground.
 * No-op on non-Windows platforms.
 */

const isWindows = Deno.build.os === "windows";

// Win32 constants
const HWND_TOP = 0n;
const HWND_TOPMOST = -1n;
const HWND_NOTOPMOST = -2n;
const SWP_SHOWWINDOW = 0x0040;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;
const SW_HIDE = 0;
const SW_SHOW = 5;
const WM_SETICON = 0x0080;
const ICON_SMALL = 0;
const ICON_BIG = 1;
const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x0010;
const LR_DEFAULTSIZE = 0x0040;

// FFI bindings to user32.dll (Windows only)
const user32 = isWindows ? Deno.dlopen("user32.dll", {
    EnumWindows: {
        parameters: ["function", "pointer"],
        result: "i32",
    },
    GetWindowThreadProcessId: {
        parameters: ["pointer", "buffer"],
        result: "u32",
    },
    SetWindowPos: {
        parameters: ["pointer", "pointer", "i32", "i32", "i32", "i32", "u32"],
        result: "i32",
    },
    SetForegroundWindow: {
        parameters: ["pointer"],
        result: "i32",
    },
    GetForegroundWindow: {
        parameters: [],
        result: "pointer",
    },
    BringWindowToTop: {
        parameters: ["pointer"],
        result: "i32",
    },
    ShowWindow: {
        parameters: ["pointer", "i32"],
        result: "i32",
    },
    AttachThreadInput: {
        parameters: ["u32", "u32", "i32"],
        result: "i32",
    },
    GetSystemMetrics: {
        parameters: ["i32"],
        result: "i32",
    },
    IsWindowVisible: {
        parameters: ["pointer"],
        result: "i32",
    },
    GetWindowRect: {
        parameters: ["pointer", "buffer"],
        result: "i32",
    },
    SetWindowTextW: {
        parameters: ["pointer", "buffer"],
        result: "i32",
    },
    SendMessageW: {
        parameters: ["pointer", "u32", "pointer", "pointer"],
        result: "pointer",
    },
    LoadImageW: {
        parameters: ["pointer", "buffer", "u32", "i32", "i32", "u32"],
        result: "pointer",
    },
}) : null;

// FFI bindings to kernel32.dll for GetCurrentThreadId
const kernel32 = isWindows ? Deno.dlopen("kernel32.dll", {
    GetCurrentThreadId: {
        parameters: [],
        result: "u32",
    },
}) : null;

export class WindowManager {
    /** Maps windowId to HWND for tracking window positions */
    static windowHandles: Map<number, Deno.PointerValue> = new Map();

    /** Stores HWND for hidden Flash Player window (by PID) */
    static hiddenWindowHandle: Deno.PointerValue | null = null;

    /**
     * Gets the screen dimensions.
     * @returns Screen width and height in pixels.
     */
    static getScreenSize(): { width: number; height: number } {
        if (!user32) {
            return { width: 1920, height: 1080 }; // Default for non-Windows
        }
        return {
            width: user32.symbols.GetSystemMetrics(SM_CXSCREEN),
            height: user32.symbols.GetSystemMetrics(SM_CYSCREEN),
        };
    }

    /**
     * Gets the position and size of a window by its windowId.
     * @param windowId The application windowId.
     * @returns Position and size, or null if not found.
     */
    static getWindowPosition(windowId: number): { x: number; y: number; width: number; height: number } | null {
        if (!user32) return null;

        const hwnd = this.windowHandles.get(windowId);
        if (!hwnd) return null;

        // RECT structure: left, top, right, bottom (4 x i32 = 16 bytes)
        const rectBuffer = new Int32Array(4);
        const result = user32.symbols.GetWindowRect(hwnd, rectBuffer);
        if (!result) return null;

        const [left, top, right, bottom] = rectBuffer;
        return {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        };
    }

    /**
     * Finds a visible top-level window belonging to a specific process.
     * @param pid The process ID to search for.
     * @returns The window handle (HWND) or null if not found.
     */
    static findWindowByPid(pid: number): Deno.PointerValue | null {
        if (!user32) return null;

        let foundHwnd: Deno.PointerValue | null = null;

        // Create a callback for EnumWindows
        const callback = new Deno.UnsafeCallback(
            {
                parameters: ["pointer", "pointer"],
                result: "i32",
            },
            (hwnd: Deno.PointerValue, _lParam: Deno.PointerValue): number => {
                // Check if window is visible
                const isVisible = user32!.symbols.IsWindowVisible(hwnd);
                if (!isVisible) return 1; // Continue enumeration

                // Get the process ID for this window
                const pidBuffer = new Uint32Array(1);
                user32!.symbols.GetWindowThreadProcessId(hwnd, pidBuffer);
                const windowPid = pidBuffer[0];

                if (windowPid === pid) {
                    foundHwnd = hwnd;
                    return 0; // Stop enumeration
                }
                return 1; // Continue enumeration
            }
        );

        try {
            // Enumerate all top-level windows
            user32.symbols.EnumWindows(callback.pointer, null);
        } finally {
            callback.close();
        }

        return foundHwnd;
    }

    /**
     * Waits for a window to appear for a process, then focuses it.
     * Stores the HWND for later position lookups.
     * @param pid The process ID.
     * @param width The desired window width.
     * @param height The desired window height.
     * @param windowId The application windowId to track this window.
     * @param maxRetries Maximum number of retries (default 10).
     * @param delayMs Delay between retries in ms (default 100).
     */
    static async focusProcess(
        pid: number,
        width: number,
        height: number,
        windowId: number,
        maxRetries = 10,
        delayMs = 100
    ): Promise<boolean> {
        if (!isWindows) return false;

        for (let i = 0; i < maxRetries; i++) {
            const hwnd = this.findWindowByPid(pid);
            if (hwnd) {
                // Store HWND for later position lookups
                this.windowHandles.set(windowId, hwnd);
                this.focusWindow(hwnd, width, height);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        console.warn(`WindowManager: Could not find window for PID ${pid} after ${maxRetries} retries`);
        return false;
    }

    /**
     * Waits for a window to appear for a process, then centers it on screen.
     * Does NOT store the HWND (used for Flash Player which doesn't need tracking).
     * @param pid The process ID.
     * @param maxRetries Maximum number of retries (default 10).
     * @param delayMs Delay between retries in ms (default 100).
     */
    static async centerProcess(
        pid: number,
        maxRetries = 10,
        delayMs = 100
    ): Promise<boolean> {
        if (!isWindows || !user32) return false;

        for (let i = 0; i < maxRetries; i++) {
            const hwnd = this.findWindowByPid(pid);
            if (hwnd) {
                // Get current window size
                const rectBuffer = new Int32Array(4);
                const result = user32.symbols.GetWindowRect(hwnd, rectBuffer);
                if (!result) return false;

                const [left, top, right, bottom] = rectBuffer;
                const width = right - left;
                const height = bottom - top;

                // Calculate centered position
                const screen = this.getScreenSize();
                const x = Math.floor((screen.width - width) / 2);
                const y = Math.floor((screen.height - height) / 2);

                // Move window to center
                user32.symbols.SetWindowPos(
                    hwnd,
                    Deno.UnsafePointer.create(HWND_TOP),
                    x,
                    y,
                    0,
                    0,
                    SWP_NOSIZE | SWP_SHOWWINDOW
                );
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        console.warn(`WindowManager: Could not find window for PID ${pid} after ${maxRetries} retries`);
        return false;
    }

    /**
     * Waits for a window to appear for a process, then resizes and centers it.
     * @param pid The process ID.
     * @param width The desired window width.
     * @param height The desired window height.
     * @param title Optional window title to set.
     * @param maxRetries Maximum number of retries (default 10).
     * @param delayMs Delay between retries in ms (default 100).
     */
    static async resizeAndCenterProcess(
        pid: number,
        width: number,
        height: number,
        title?: string,
        maxRetries = 10,
        delayMs = 100
    ): Promise<boolean> {
        if (!isWindows || !user32) return false;

        for (let i = 0; i < maxRetries; i++) {
            const hwnd = this.findWindowByPid(pid);
            if (hwnd) {
                // Set window title if provided
                if (title) {
                    const titleUtf16 = new Uint16Array([...title].map(c => c.charCodeAt(0)).concat(0));
                    user32.symbols.SetWindowTextW(hwnd, titleUtf16);
                }

                // Calculate centered position
                const screen = this.getScreenSize();
                const x = Math.floor((screen.width - width) / 2);
                const y = Math.floor((screen.height - height) / 2);

                // Resize, position, and focus window
                this.focusWindow(hwnd, width, height);

                // Center after focus (focusWindow may reposition)
                user32.symbols.SetWindowPos(
                    hwnd,
                    Deno.UnsafePointer.create(HWND_TOP),
                    x,
                    y,
                    width,
                    height,
                    SWP_SHOWWINDOW
                );
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        console.warn(`WindowManager: Could not find window for PID ${pid} after ${maxRetries} retries`);
        return false;
    }

    /**
     * Waits for a window to appear for a process, then hides it.
     * Stores the HWND so we can show it later (since hidden windows can't be found).
     * @param pid The process ID.
     * @param maxRetries Maximum number of retries (default 10).
     * @param delayMs Delay between retries in ms (default 100).
     */
    static async hideProcess(
        pid: number,
        maxRetries = 10,
        delayMs = 100
    ): Promise<boolean> {
        if (!isWindows || !user32) return false;

        for (let i = 0; i < maxRetries; i++) {
            const hwnd = this.findWindowByPid(pid);
            if (hwnd) {
                this.hiddenWindowHandle = hwnd;  // Store for later
                user32.symbols.ShowWindow(hwnd, SW_HIDE);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        console.warn(`WindowManager: Could not find window for PID ${pid} after ${maxRetries} retries`);
        return false;
    }

    /**
     * Shows the hidden window, centers it on screen, and sets its title.
     * Uses the stored HWND from hideProcess.
     * @param title Optional window title to set.
     */
    static showAndCenterProcess(title?: string): boolean {
        if (!isWindows || !user32) return false;

        const hwnd = this.hiddenWindowHandle;
        if (!hwnd) {
            console.warn("WindowManager: No hidden window handle stored");
            return false;
        }

        // Show the window first
        user32.symbols.ShowWindow(hwnd, SW_SHOW);

        // Set window title if provided
        if (title) {
            // Convert to UTF-16 (null-terminated)
            const titleUtf16 = new Uint16Array([...title].map(c => c.charCodeAt(0)).concat(0));
            user32.symbols.SetWindowTextW(hwnd, titleUtf16);
        }

        // Get current window size
        const rectBuffer = new Int32Array(4);
        const result = user32.symbols.GetWindowRect(hwnd, rectBuffer);
        if (!result) return false;

        const [left, top, right, bottom] = rectBuffer;
        const width = right - left;
        const height = bottom - top;

        // Calculate centered position
        const screen = this.getScreenSize();
        const x = Math.floor((screen.width - width) / 2);
        const y = Math.floor((screen.height - height) / 2);

        // Move window to center
        user32.symbols.SetWindowPos(
            hwnd,
            Deno.UnsafePointer.create(HWND_TOP),
            x,
            y,
            0,
            0,
            SWP_NOSIZE | SWP_SHOWWINDOW
        );

        // Clear the stored handle
        this.hiddenWindowHandle = null;
        return true;
    }

    /**
     * Sets the window title for a process.
     * @param pid The process ID.
     * @param title The window title to set.
     * @returns True if successful.
     */
    static setWindowTitle(pid: number, title: string): boolean {
        if (!isWindows || !user32) return false;

        const hwnd = this.findWindowByPid(pid);
        if (!hwnd) return false;

        const titleUtf16 = new Uint16Array([...title].map(c => c.charCodeAt(0)).concat(0));
        user32.symbols.SetWindowTextW(hwnd, titleUtf16);
        return true;
    }

    /**
     * Sets the window icon for a process using a .ico file.
     * Sends WM_SETICON to both small (titlebar) and big (alt-tab) icon slots.
     * @param pid The process ID.
     * @param icoPath Absolute path to the .ico file.
     * @param maxRetries Maximum number of retries (default 50).
     * @param delayMs Delay between retries in ms (default 10).
     */
    static async setProcessIcon(
        pid: number,
        icoPath: string,
        maxRetries = 50,
        delayMs = 10
    ): Promise<boolean> {
        if (!isWindows || !user32) return false;

        // Convert path to UTF-16 null-terminated
        const pathUtf16 = new Uint16Array([...icoPath].map(c => c.charCodeAt(0)).concat(0));

        // Load small icon (16x16 for titlebar)
        const hIconSmall = user32.symbols.LoadImageW(
            null, pathUtf16, IMAGE_ICON, 16, 16, LR_LOADFROMFILE
        );

        // Load big icon (32x32 for alt-tab)
        const hIconBig = user32.symbols.LoadImageW(
            null, pathUtf16, IMAGE_ICON, 32, 32, LR_LOADFROMFILE
        );

        if (!hIconSmall && !hIconBig) {
            console.warn("WindowManager: Failed to load icon from", icoPath);
            return false;
        }

        // Wait for the window to appear, then set icons
        for (let i = 0; i < maxRetries; i++) {
            const hwnd = this.findWindowByPid(pid);
            if (hwnd) {
                if (hIconSmall) {
                    user32.symbols.SendMessageW(
                        hwnd, WM_SETICON,
                        Deno.UnsafePointer.create(BigInt(ICON_SMALL)),
                        hIconSmall
                    );
                }
                if (hIconBig) {
                    user32.symbols.SendMessageW(
                        hwnd, WM_SETICON,
                        Deno.UnsafePointer.create(BigInt(ICON_BIG)),
                        hIconBig
                    );
                }
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        console.warn(`WindowManager: Could not find window for PID ${pid} to set icon`);
        return false;
    }

    /**
     * Brings a window to the foreground using multiple techniques.
     * @param hwnd The window handle.
     * @param width The window width (for SetWindowPos).
     * @param height The window height (for SetWindowPos).
     */
    private static focusWindow(hwnd: Deno.PointerValue, width: number, height: number): void {
        if (!user32 || !kernel32 || !hwnd) return;

        // Get current foreground window's thread
        const foregroundHwnd = user32.symbols.GetForegroundWindow();
        const foregroundPidBuffer = new Uint32Array(1);
        const foregroundThreadId = user32.symbols.GetWindowThreadProcessId(foregroundHwnd, foregroundPidBuffer);
        const currentThreadId = kernel32.symbols.GetCurrentThreadId();

        // Attach to the foreground thread to bypass focus stealing prevention
        let attached = false;
        if (foregroundThreadId !== currentThreadId) {
            attached = user32.symbols.AttachThreadInput(currentThreadId, foregroundThreadId, 1) !== 0;
        }

        try {
            // First, make it topmost to force it above everything
            user32.symbols.SetWindowPos(
                hwnd,
                Deno.UnsafePointer.create(HWND_TOPMOST),
                0,
                0,
                width,
                height,
                SWP_NOMOVE | SWP_SHOWWINDOW
            );

            // Then remove topmost but keep it at top of z-order
            user32.symbols.SetWindowPos(
                hwnd,
                Deno.UnsafePointer.create(HWND_NOTOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW
            );

            // Show and bring to top
            user32.symbols.ShowWindow(hwnd, SW_SHOW);
            user32.symbols.BringWindowToTop(hwnd);
            user32.symbols.SetForegroundWindow(hwnd);
        } finally {
            // Detach from the foreground thread
            if (attached) {
                user32.symbols.AttachThreadInput(currentThreadId, foregroundThreadId, 0);
            }
        }
    }
}
