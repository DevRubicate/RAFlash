import '../style/common.css';
import { createApp } from 'vue';

/**
 * Displays a custom, full-screen error message.
 */
function displayError(title: string, message: string, stack: string): void {
    const errorContainer = document.createElement('div');
    errorContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: #f8d7da;
        color: #721c24;
        padding: 20px;
        font-family: monospace;
        z-index: 9999;
        overflow: auto;
        box-sizing: border-box;
    `;

    // Sanitize HTML to prevent rendering issues
    const sanitize = (str: string): string => str.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    errorContainer.innerHTML = `
        <h2>${sanitize(title)}</h2>
        <br />
        <div><strong>Message:</strong> ${sanitize(message)}</div>
        <pre style="white-space: pre-wrap; word-wrap: break-word;"><strong>Stack Trace:</strong><br>${sanitize(stack)}</pre>
    `;

    document.body.innerHTML = '';
    document.body.appendChild(errorContainer);
}

// Helper to format console arguments into a readable string
const formatArgs = (args: unknown[]): string => {
    return args.map(arg => {
        if (arg instanceof Error) {
            // If the argument is an error, use its message
            return arg.message;
        }
        if (typeof arg === 'object' && arg !== null) {
            // Stringify other objects
            return JSON.stringify(arg, null, 2);
        }
        // Handle primitives
        return String(arg);
    }).join(' ');
};


// Store the original console methods
const originalConsoleError = console.error;

/**
 * Overrides the default console.error to display a custom error screen.
 */
console.error = function(...args: unknown[]) {
    originalConsoleError.apply(console, args);

    const message = formatArgs(args);
    // Create a new error to capture the current stack trace, excluding this function call
    const stack = (new Error().stack || 'Stack trace not available.').replace(/^Error.*\n/, '');

    displayError('An Error Occurred', message, stack);
};


/**
 * Global error handler for uncaught exceptions.
 */
window.addEventListener('error', (event: ErrorEvent) => {
    event.preventDefault();

    const {
        message,
        filename,
        lineno,
        colno,
        error
    } = event;
    const stackTrace = error ? error.stack : 'Stack trace not available.';
    const formattedMessage = `
        ${message}
        <br>
        Source: ${filename}:${lineno}:${colno}
    `;

    displayError('An Uncaught Error Occurred', formattedMessage, stackTrace);
});

/**
 * Generic entry point for all Vue applications.
 *
 * This script looks for an element with the ID "app" and a "data-component"
 * attribute. It uses the value of that attribute to dynamically import the
 * corresponding Vue component from the "./" directory and mount it.
 */
async function mountApp() {
  const appEl = document.getElementById("app");
  if (!appEl) {
    console.error("Mounting failed: No element with ID 'app' found.");
    return;
  }

  const componentName = appEl.dataset.component;
  if (!componentName) {
    console.error(
      "Mounting failed: The '#app' element is missing a 'data-component' attribute."
    );
    return;
  }

  try {
    // Dynamically import the component based on the attribute value.
    // e.g., if data-component="menu", this imports "./menu.vue"
    const component = await import(`../view/${componentName}.vue`);
    const app = createApp(component.default);

    // Set up the Vue-specific global error handler
    app.config.errorHandler = (err: unknown, instance, info) => {
        console.log(err);

        const error = err instanceof Error ? err : new Error(String(err));
        // Use your existing display function
        // The stack trace from err.stack will now be correctly source-mapped
        displayError(
            `A Vue Component Error Occurred - ${instance?._?.type?.__name}`,
            error.message,
            error.stack || 'Stack trace not available.'
        );
    }


    app.mount(appEl);
  } catch (error) {
    console.error(`Failed to load component "${componentName}.vue":`, error);
    appEl.innerHTML = `<div style="color: red; font-family: sans-serif;">Error: Component could not be loaded.</div>`;
  }
}

mountApp();
