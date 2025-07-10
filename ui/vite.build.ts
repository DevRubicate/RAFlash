import { build } from "npm:vite";
import vue from "npm:@vitejs/plugin-vue";
import * as Path from "https://deno.land/std@0.224.0/path/mod.ts";
import { glob } from "node:fs";


// --- Helper Functions ---

// Generates the content for a temporary HTML file.
function createHtmlContent(entryScriptName, title) {
    return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/${entryScriptName}"></script>
  </body>
</html>`;
}

// Generates the content for a temporary JavaScript entry file.
function createEntryScriptContent(vueComponentPath) {
    // Use forward slashes for module imports, even on Windows.
    const importPath = vueComponentPath.replaceAll('\\', '/');
    return `
import { createApp } from 'vue';
import App from '${importPath}';
createApp(App).mount('#app');
`;
}

// --- Main Build Logic ---

// Create a temporary directory for our generated build entries.
const tempDir = await Deno.makeTempDir({ prefix: "raflash-vite-build-" });
const inputForVite = {};

try {
    // Find all .vue files in the view directory.
    for await (const file of glob("ui/src/view/*.vue")) {
        const componentName = Path.basename(file, ".vue");
        const absoluteVuePath = Path.resolve(file);

        // 1. Create the JS entry script content.
        // The import path must be relative from the temp build directory to the actual .vue file.
        const relativeVuePath = Path.relative(tempDir, absoluteVuePath);
        const entryScriptContent = createEntryScriptContent(relativeVuePath);
        
        // 2. Write the JS entry script to the temp directory.
        const entryScriptName = `${componentName}.js`;
        const entryScriptPath = Path.join(tempDir, entryScriptName);
        await Deno.writeTextFile(entryScriptPath, entryScriptContent);

        // 3. Create the HTML file content.
        const htmlContent = createHtmlContent(entryScriptName, componentName);

        // 4. Write the HTML file to the temp directory.
        const htmlFileName = `${componentName}.html`;
        const htmlPath = Path.join(tempDir, htmlFileName);
        await Deno.writeTextFile(htmlPath, htmlContent);

        // 5. Add the generated HTML file to our list of inputs for Vite.
        inputForVite[componentName] = htmlPath;
    }

    // All temporary files are created. Now, run the Vite build.
    await build({
        // The root is the temporary directory where our entry files are.
        root: tempDir,
        plugins: [vue()],
        build: {
            rollupOptions: {
                input: inputForVite,
            },
            // Output the final build to the correct destination.
            outDir: Path.resolve("ui/.build"),
            emptyOutDir: true,
        },
    });

} finally {
    // 6. Clean up the temporary directory after the build.
    await Deno.remove(tempDir, { recursive: true });
}

console.log("✅ Vue SFC build complete");
Deno.exit(0);