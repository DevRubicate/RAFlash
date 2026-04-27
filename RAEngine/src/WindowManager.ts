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
// Virtual-screen metrics span every monitor in the user's setup. Used by
// position-restore logic so a window remembered on a secondary monitor
// isn't rejected as "off-screen" relative to the primary alone.
const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SM_CXVIRTUALSCREEN = 78;
const SM_CYVIRTUALSCREEN = 79;
const SW_HIDE = 0;
const SW_SHOW = 5;
const WM_SETICON = 0x0080;
const ICON_SMALL = 0;
const ICON_BIG = 1;
const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x0010;
const LR_DEFAULTSIZE = 0x0040;
const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CAPTION = 0x00C00000;
const WS_THICKFRAME = 0x00040000;
const WS_MAXIMIZEBOX = 0x00010000;
const WS_EX_DLGMODALFRAME = 0x00000001;
const WS_EX_CLIENTEDGE = 0x00000200;
const WS_EX_STATICEDGE = 0x00020000;
const SWP_FRAMECHANGED = 0x0020;

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
    IsIconic: {
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
    PostMessageW: {
        parameters: ["pointer", "u32", "pointer", "pointer"],
        result: "i32",
    },
    LoadImageW: {
        parameters: ["pointer", "buffer", "u32", "i32", "i32", "u32"],
        result: "pointer",
    },
    GetWindowLongPtrW: {
        parameters: ["pointer", "i32"],
        result: "pointer",
    },
    SetWindowLongPtrW: {
        parameters: ["pointer", "i32", "pointer"],
        result: "pointer",
    },
    AdjustWindowRectEx: {
        parameters: ["buffer", "u32", "i32", "u32"],
        result: "i32",
    },
    MessageBoxW: {
        parameters: ["pointer", "buffer", "buffer", "u32"],
        result: "i32",
    },
}) : null;

// FFI bindings to kernel32.dll for GetCurrentThreadId
const kernel32 = isWindows ? Deno.dlopen("kernel32.dll", {
    GetCurrentThreadId: {
        parameters: [],
        result: "u32",
    },
    CreateToolhelp32Snapshot: {
        parameters: ["u32", "u32"],
        result: "pointer",
    },
    Process32First: {
        parameters: ["pointer", "buffer"],
        result: "i32",
    },
    Process32Next: {
        parameters: ["pointer", "buffer"],
        result: "i32",
    },
    CloseHandle: {
        parameters: ["pointer"],
        result: "i32",
    },
}) : null;

const TH32CS_SNAPPROCESS = 0x00000002;
// PROCESSENTRY32 layout on 64-bit Windows (with alignment padding):
//   0: dwSize (u32)
//   4: cntUsage (u32)
//   8: th32ProcessID (u32)
//  12: (4 bytes padding for ULONG_PTR alignment)
//  16: th32DefaultHeapID (ULONG_PTR = 8 bytes on x64)
//  24: th32ModuleID (u32)
//  28: cntThreads (u32)
//  32: th32ParentProcessID (u32)
//  36: pcPriClassBase (i32)
//  40: dwFlags (u32)
//  44: szExeFile (260 chars)
const PROCESSENTRY32_SIZE = 304;

/**
 * Find all child PIDs of a given parent PID.
 */
function getChildPids(parentPid: number): number[] {
    if (!kernel32) return [];

    const hSnapshot = kernel32.symbols.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (!hSnapshot) return [];

    const entry = new Uint8Array(PROCESSENTRY32_SIZE);
    const view = new DataView(entry.buffer);
    view.setUint32(0, PROCESSENTRY32_SIZE, true); // dwSize

    const children: number[] = [];

    if (kernel32.symbols.Process32First(hSnapshot, entry)) {
        do {
            const pid = view.getUint32(8, true);
            const ppid = view.getUint32(32, true);
            if (ppid === parentPid) {
                children.push(pid);
            }
        } while (kernel32.symbols.Process32Next(hSnapshot, entry));
    }

    kernel32.symbols.CloseHandle(hSnapshot);
    return children;
}

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
     * Bounding rect of the virtual screen — the union of every connected
     * monitor. On a single-monitor setup this matches getScreenSize() at
     * origin (0,0). On multi-monitor setups it can extend negative (a
     * monitor to the left of/above primary) and well past the primary's
     * width/height. Use this when validating a remembered window position
     * so a window the user dragged to a secondary monitor isn't snapped
     * back to primary on next launch.
     */
    static getVirtualScreenRect(): { x: number; y: number; width: number; height: number } {
        if (!user32) {
            return { x: 0, y: 0, width: 1920, height: 1080 };
        }
        return {
            x: user32.symbols.GetSystemMetrics(SM_XVIRTUALSCREEN),
            y: user32.symbols.GetSystemMetrics(SM_YVIRTUALSCREEN),
            width: user32.symbols.GetSystemMetrics(SM_CXVIRTUALSCREEN),
            height: user32.symbols.GetSystemMetrics(SM_CYVIRTUALSCREEN),
        };
    }

    /**
     * Gets the position and size of a window by its windowId.
     * Returns null if the window is minimised: GetWindowRect on a
     * minimised window reports `(-32000, -32000)`-anchored coordinates,
     * which would persist as garbage in `windowPositions` and then get
     * rejected on next launch (window appears un-restored).
     * @param windowId The application windowId.
     * @returns Position and size, or null if not found / minimised.
     */
    static getWindowPosition(windowId: number): { x: number; y: number; width: number; height: number } | null {
        if (!user32) return null;

        const hwnd = this.windowHandles.get(windowId);
        if (!hwnd) return null;

        if (user32.symbols.IsIconic(hwnd)) return null;

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
     * Gets the position and size of the top-level window that belongs to a
     * given process. Does not require the window to have been registered
     * via `resizeAndCenterProcess` — used by Flash Player reset flow to
     * remember where the user had dragged the window to.
     */
    static getWindowPositionByPid(pid: number): { x: number; y: number; width: number; height: number } | null {
        if (!user32) return null;
        const hwnd = this.findWindowByPid(pid);
        if (!hwnd) return null;
        const rectBuffer = new Int32Array(4);
        const result = user32.symbols.GetWindowRect(hwnd, rectBuffer);
        if (!result) return null;
        const [left, top, right, bottom] = rectBuffer;
        return { x: left, y: top, width: right - left, height: bottom - top };
    }

    /**
     * Post a simulated keystroke (WM_KEYDOWN + WM_KEYUP) to the window
     * belonging to the given process. Does NOT move the cursor or steal
     * focus — messages are queued into the target window's input queue
     * and processed by its WndProc as if the user had typed the key.
     * Returns true if the messages were queued.
     */
    static postKeypress(pid: number, vkCode: number): boolean {
        if (!isWindows || !user32) return false;
        const hwnd = this.findWindowByPid(pid);
        if (!hwnd) return false;

        const WM_KEYDOWN = 0x0100;
        const WM_KEYUP = 0x0101;

        // lParam bitfield per Win32 docs:
        //   bits  0-15: repeat count (we use 1)
        //   bit     30: previous key state (1 for WM_KEYUP)
        //   bit     31: transition state   (1 for WM_KEYUP)
        const lParamDown = Deno.UnsafePointer.create(1n);
        const lParamUp = Deno.UnsafePointer.create(0xC0000001n);
        const wParam = Deno.UnsafePointer.create(BigInt(vkCode));

        user32.symbols.PostMessageW(hwnd, WM_KEYDOWN, wParam, lParamDown);
        user32.symbols.PostMessageW(hwnd, WM_KEYUP, wParam, lParamUp);
        return true;
    }

    /**
     * Finds a visible top-level window belonging to a specific process.
     * @param pid The process ID to search for.
     * @returns The window handle (HWND) or null if not found.
     */
    static findWindowByPid(pid: number): Deno.PointerValue | null {
        if (!user32) return null;

        // Build set of PIDs to match: the process itself + any child processes
        // (FlashpointProxy.dll causes Flash Player to spawn a child that owns the window)
        const pids = new Set([pid, ...getChildPids(pid)]);

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

                if (pids.has(windowPid)) {
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
                    const titleUtf16 = new Uint16Array(Array.from({length: title.length + 1}, (_, i) => i < title.length ? title.charCodeAt(i) : 0));
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
                if (this.hiddenWindowHandle && this.hiddenWindowHandle !== hwnd) {
                    // Show previously hidden window to prevent leaking it
                    user32!.symbols.ShowWindow(this.hiddenWindowHandle, SW_SHOW);
                }
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
            const titleUtf16 = new Uint16Array(Array.from({length: title.length + 1}, (_, i) => i < title.length ? title.charCodeAt(i) : 0));
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

        const titleUtf16 = new Uint16Array(Array.from({length: title.length + 1}, (_, i) => i < title.length ? title.charCodeAt(i) : 0));
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
        const pathUtf16 = new Uint16Array(Array.from({length: icoPath.length + 1}, (_, i) => i < icoPath.length ? icoPath.charCodeAt(i) : 0));

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
     * Removes window chrome (title bar, borders) from a process window.
     * @param pid The process ID.
     * @param width Content width to resize to after removing chrome.
     * @param height Content height to resize to after removing chrome.
     * @param maxRetries Maximum number of retries (default 50).
     * @param delayMs Delay between retries in ms (default 10).
     * @param position Optional window position (outer-frame top-left) to
     *        place the window at instead of centering it. Used by Reset
     *        Game to restore the window to where the user had dragged it.
     */
    static async removeWindowChrome(
        pid: number,
        width: number,
        height: number,
        title?: string,
        maxRetries = 50,
        delayMs = 10,
        position?: { x: number; y: number }
    ): Promise<boolean> {
        if (!isWindows || !user32) return false;

        for (let i = 0; i < maxRetries; i++) {
            const hwnd = this.findWindowByPid(pid);
            if (hwnd) {
                // Set window title if provided
                if (title) {
                    const titleUtf16 = new Uint16Array(Array.from({length: title.length + 1}, (_, i) => i < title.length ? title.charCodeAt(i) : 0));
                    user32.symbols.SetWindowTextW(hwnd, titleUtf16);
                }

                // Strip thick frame (resize handle) but keep caption (title bar for dragging)
                const style = BigInt(Deno.UnsafePointer.value(user32.symbols.GetWindowLongPtrW(hwnd, GWL_STYLE) as Deno.PointerValue));
                const newStyle = style & ~BigInt(WS_THICKFRAME) & ~BigInt(WS_MAXIMIZEBOX);
                user32.symbols.SetWindowLongPtrW(hwnd, GWL_STYLE, Deno.UnsafePointer.create(newStyle));

                // Strip extended border styles
                const exStyle = BigInt(Deno.UnsafePointer.value(user32.symbols.GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as Deno.PointerValue));
                const newExStyle = exStyle & ~BigInt(WS_EX_DLGMODALFRAME) & ~BigInt(WS_EX_CLIENTEDGE) & ~BigInt(WS_EX_STATICEDGE);
                user32.symbols.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, Deno.UnsafePointer.create(newExStyle));

                // Calculate outer window size needed for desired client area
                const rect = new Int32Array([0, 0, width, height]);
                user32.symbols.AdjustWindowRectEx(rect, Number(newStyle), 0, Number(newExStyle));
                const outerWidth = rect[2] - rect[0];
                const outerHeight = rect[3] - rect[1];

                // Place the window at the caller-supplied position if any,
                // otherwise center on screen.
                let x: number;
                let y: number;
                if (position) {
                    x = position.x;
                    y = position.y;
                } else {
                    const screen = this.getScreenSize();
                    x = Math.floor((screen.width - outerWidth) / 2);
                    y = Math.floor((screen.height - outerHeight) / 2);
                }
                user32.symbols.SetWindowPos(
                    hwnd,
                    Deno.UnsafePointer.create(HWND_TOP),
                    x, y, outerWidth, outerHeight,
                    SWP_FRAMECHANGED | SWP_SHOWWINDOW
                );

                // Force focus. SetWindowPos(SHOWWINDOW) shows the window but
                // doesn't reliably steal focus from whatever was already
                // foreground (notification, the closing file picker, etc.),
                // which led to the Flash Player occasionally launching
                // unfocused. focusWindow does the AttachThreadInput dance
                // that bypasses Windows' focus-stealing prevention.
                this.focusWindow(hwnd, outerWidth, outerHeight);

                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        console.warn(`WindowManager: Could not find window for PID ${pid} to make borderless`);
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

    /**
     * Show a Win32 message box with an OK button. Blocks until the user
     * clicks OK. No-op on non-Windows. Used for hard-error popups before any
     * HTML window can be created (e.g. duplicate-instance detection).
     */
    static showMessageBox(text: string, title: string): void {
        if (!user32) return;
        const MB_OK = 0x00000000;
        const MB_ICONINFORMATION = 0x00000040;
        // Win32 wants UTF-16LE, null-terminated. Allocate over a fresh
        // ArrayBuffer (not ArrayBufferLike) so Deno's FFI buffer typing is happy.
        const encodeUtf16 = (s: string): Uint8Array<ArrayBuffer> => {
            const buf = new Uint8Array(new ArrayBuffer((s.length + 1) * 2));
            for (let i = 0; i < s.length; i++) {
                const c = s.charCodeAt(i);
                buf[i * 2] = c & 0xFF;
                buf[i * 2 + 1] = (c >> 8) & 0xFF;
            }
            return buf;
        };
        user32.symbols.MessageBoxW(null, encodeUtf16(text), encodeUtf16(title), MB_OK | MB_ICONINFORMATION);
    }
}
