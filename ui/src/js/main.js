import "../style/common.css";
import { createApp } from "vue";

window.addEventListener('error', function(event) {
    console.log('ERRROR');
  // Prevents the default browser error handling (e.g., logging to console)
  event.preventDefault();

  const { message, filename, lineno, colno, error } = event;

  // Create a user-friendly error display
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
  `;

  const stackTrace = error ? error.stack : 'Stack trace not available.';

  errorContainer.innerHTML = `
    <h2>😢 An Unexpected Error Occurred</h2>
    <p><strong>Error:</strong> ${message}</p>
    <p><strong>Source:</strong> ${filename}:${lineno}:${colno}</p>
    <pre><strong>Stack Trace:</strong><br>${stackTrace}</pre>
  `;

  // Replace the entire body with the error message
  document.body.innerHTML = '';
  document.body.appendChild(errorContainer);
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
    createApp(component.default).mount(appEl);
  } catch (error) {
    console.error(`Failed to load component "${componentName}.vue":`, error);
    appEl.innerHTML = `<div style="color: red; font-family: sans-serif;">Error: Component could not be loaded.</div>`;
  }
}

mountApp();
