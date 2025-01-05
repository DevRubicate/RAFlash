import { htmlPlugin }   from 'https://esm.sh/@craftamap/esbuild-plugin-html@0.8.0';
import { denoPlugins }  from 'jsr:@luca/esbuild-deno-loader';
import * as ESBuild     from 'npm:esbuild';
import * as Path        from 'https://deno.land/std@0.198.0/path/mod.ts';

const styleFiles = [];
for await (const entry of Deno.readDir('ui/src/style')) {
    if(entry.isFile && entry.name.endsWith('.css')) {
        styleFiles.push(`ui/src/style/${entry.name}`);
    }
}

for await (const entry of Deno.readDir('ui/src/html')) {
    if(entry.isFile && entry.name.endsWith('.html')) {
        await ESBuild.build({
            entryPoints: ['ui/src/js/main.js', ...styleFiles],
            bundle: true,
            metafile: true,
            outdir: 'ui/.build',
            plugins: [
                {
                    name: 'skip css',
                    setup: (build) => {
                        build.onResolve({ filter: /\.css$/, namespace: 'file' }, (args) => {
                          return {
                            path: Path.resolve(args.resolveDir, args.path),
                          };
                        });
                        build.onLoad({ filter: /\.css$/, namespace: 'file' }, (args) => {
                          const contents = Deno.readFileSync(args.path);
                          return {
                            contents: contents,
                            loader: 'css',
                          };
                        });
                        build.onResolve({ filter: /.*/, namespace: 'data' }, (args) => {
                          return args.kind !== 'url-token' ? undefined : { external: true };
                        });
                    },
                },
                ...denoPlugins(),
                htmlPlugin({
                    files: [
                        {
                            entryPoints: [
                                'ui/src/js/main.js',
                                ...styleFiles
                            ],
                            filename: entry.name,
                            inline: {
                                js: true,
                                css: true,
                            },
                            htmlTemplate: `ui/src/html/${entry.name}`,
                        },
                    ]
                })
            ]
        });
    }
}

// Manually stop esbuild service
ESBuild.stop();
