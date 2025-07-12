
export class ErrorLogger {
    static initialize() {
        globalThis.addEventListener('unhandledrejection', (event) => {
            // Prevent the default handling of the error (which would be to crash the process)
            event.preventDefault();

            const errorLogFile = 'errorlog.txt';
            const timestamp = new Date().toISOString();
            let errorMessage = `${timestamp} - Unhandled Rejection:\n`;

            if (event.reason instanceof Error) {
                errorMessage += `Error: ${event.reason.message}\nStack Trace:\n${event.reason.stack}\n`;
            } else {
                errorMessage += `Reason: ${JSON.stringify(event.reason, null, 2)}\n`;
            }

            errorMessage += "--------------------------------------------------\n";

            try {
                // Use the synchronous version to ensure the log is written before the process might exit.
                Deno.writeTextFileSync(errorLogFile, errorMessage, { append: true });
            } catch (logError) {
                console.error('Failed to write to error log file:', logError);
                console.error('Original error:', event.reason);
            }

            Deno.exit(1);
        });
    }
}