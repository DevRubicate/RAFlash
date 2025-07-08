import { htmlPlugin } from 'https://esm.sh/@craftamap/esbuild-plugin-html@0.8.0';
import { denoPlugins } from 'jsr:@luca/esbuild-deno-loader';
import * as ESBuild from 'npm:esbuild';
import * as Path from 'https://deno.land/std@0.198.0/path/mod.ts';

// Find all COMMON CSS files (we still need to add these explicitly)
const commonStyleFiles = [];
for await (const entry of Deno.readDir('ui/src/style')) {
    if (entry.isFile && entry.name.endsWith('.css')) {
        commonStyleFiles.push(`ui/src/style/${entry.name}`);
    }
}

// Loop through views and build each one
for await (const entry of Deno.readDir('ui/src/view')) {
    if (entry.isFile && entry.name.endsWith('.html')) {
        const viewName = Path.parse(entry.name).name;
        const viewJsPath = `ui/src/view/${viewName}.js`;
        const viewCssPath = `ui/src/view/${viewName}.css`;

        // Start the entry points list with just the common styles
        const currentEntryPoints = [
            ...commonStyleFiles
        ];

        // Check if view-specific JS and CSS files exist and add them.
        // The viewJsPath is now the ONLY JavaScript entry point.
        try {
            Deno.statSync(viewJsPath);
            currentEntryPoints.push(viewJsPath); // ✅ This will import network.js itself
        } catch (e) {
            // JS file doesn't exist, do nothing
        }
        try {
            Deno.statSync(viewCssPath);
            currentEntryPoints.push(viewCssPath);
        } catch (e) {
            // CSS file doesn't exist, do nothing
        }

        // Run the build
        await ESBuild.build({
            entryPoints: currentEntryPoints, // This list is now much simpler
            bundle: true,
            metafile: true,
            outdir: 'ui/.build',
            allowOverwrite: true,
            plugins: [
                // ... your plugins remain the same
                {
                    name: 'skip css',
                    setup: (build) => {
                        build.onResolve({ filter: /\.css$/, namespace: 'file' }, (args) => ({
                            path: Path.resolve(args.resolveDir, args.path),
                        }));
                        build.onLoad({ filter: /\.css$/, namespace: 'file' }, (args) => ({
                            contents: Deno.readFileSync(args.path),
                            loader: 'css',
                        }));
                        build.onResolve({ filter: /.*/, namespace: 'data' }, (args) => 
                            args.kind !== 'url-token' ? undefined : { external: true }
                        );
                    },
                },
                ...denoPlugins(),
                htmlPlugin({
                    files: [
                        {
                            entryPoints: currentEntryPoints,
                            filename: entry.name,
                            inline: { js: true, css: true },
                            htmlTemplate: `ui/src/view/${entry.name}`,
                        },
                    ]
                })
            ]
        });
        console.log(`✅ Built ${entry.name}`);
    }
}