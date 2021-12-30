import browserSync from "browser-sync";
import historyApiFallback from 'connect-history-api-fallback';
import path, { join } from 'path';
import { debounceTimeOut, isType } from '@giveback007/util-lib';
import { BuilderUtil, network, onProcessEnd, transpileBrowser, genWatchPaths } from './general.utils';
import chalk from 'chalk';

const { log } = console;

export async function devBrowser(opts: {
    /** Directory of entry file relative to `projectRoot`. Eg: `"./src" or "src"`.
     * 
     * Resolution order: [projectRoot + fromDir + entryFile]
     */
    fromDir: string;
    /** Entry file relative to `fromDir`. Eg: `"index.tsx"`.
     * 
     * Resolution order: [projectRoot + fromDir + entryFile]
     */
    entryFile: string;
    /** Out directory relative to `projectRoot`. Eg: `"./dist" or "dist"`.
     * 
     * Resolution order: [projectRoot + toDir]
     */
    toDir: string;
    /** Other dirs besides `fromDir` that on change should trigger build & browser refresh.
     * 
     * Eg: `['utils', 'common']`
     */
    watchOtherDirs?: string[];
    /** List of css extensions to watch for changes. This will only build css files and hot-reload
     * them without refreshing the browser.
     * 
     * Default: `['sass', 'scss', 'css']`. Specifying this replaces the defaults completely.
     */
    cssExts?: string[];
    /** List of js/ts/etc.. extensions to watch for changes. This will build and reload the browser.
     * 
     * Default: `['tsx', 'ts', 'js', 'jsx', 'json']`. Specifying this replaces the defaults completely.
     */
    jsExts?: string[];
    /** Relative path of project root. Eg `"./"` or `"./my-project"`
     * 
     * Default: `'./'`
     */
    projectRoot?: string;
    /** Files and directories to copy into toDir.
     * 
     * Eg: `['public', 'index.html']` ->
     * 
     * `"public"` will copy `<fromDir>/public"` into `<toDir>/public` as well as all the dirs contents and subdirectories.
     * 
     * `"index.html"` will copy `<fromDir>/index.html` into `<toDir>/index.html`.
     */
    copyFiles?: string[];
    /** Localhost port for dev server. Eg `3000` -> `http://localhost:3000/`
     * 
     * Default: `3000`.
     */
    port?: number;
    /** Restrict the frequency of build events.
     * 
     * Will wait `debounceMs` of milliseconds after last file save before starting to build.
     * 
     * Default: `350`
     */
    debounceMs?: number;
}) {
    log('STARTING BUILDER...');

    const port = opts.port || 3000;

    const projectRoot = path.resolve(opts.projectRoot || './');
    const fromDir = join(projectRoot, opts.fromDir);
    const entryFile = join(fromDir, opts.entryFile);
    const toDir = join(projectRoot, opts.toDir);
    const watchOtherDirs = (opts.watchOtherDirs || []).map((dir) => join(projectRoot, dir));
    const copyFiles = (opts.copyFiles || []);
    const jsExts = opts.jsExts || ['tsx', 'ts', 'js', 'jsx', 'json'];
    const cssExts = opts.cssExts || ['sass', 'scss', 'css'];
    const debounceMs = isType(opts.debounceMs, 'number') ? opts.debounceMs : 200;

    // clearing and canceling on exit //
    onProcessEnd(() => {
        bs.pause();
        bs.cleanup();
        bs.exit();
        process.exit();
    });

    // initialized builder //
    const builder = new BuilderUtil({
        fromDir, toDir, projectRoot, copyFiles,
        buildFct: () => transpileBrowser(entryFile, toDir, { changeBuildOpts: { incremental: true } })
    });

    // Create browserSync //
    const bs = browserSync.create('Browser-Playground');

    // Setup watchers //
    const allWatchDirs = [fromDir, ...watchOtherDirs];
    const jsWatch = genWatchPaths(allWatchDirs, jsExts);
    const cssWatch = genWatchPaths(allWatchDirs, cssExts);

    let cssChanged = false;
    let jsChanged = false;
    const debounce = debounceTimeOut();
    
    const watchHandler = (type: 'css' | 'js') => {
        type === 'js' ? (jsChanged = true) : (cssChanged = true);

        debounce(async () => {
            await builder.build();

            if (jsChanged) {
                cssChanged = jsChanged = false;
                bs.reload("*.html");
            } else if (cssChanged) {
                cssChanged = false;
                bs.reload("*.css");
            } else {
                log(chalk.red`Failed to Reload...`);
            }
        }, debounceMs);
    };

    bs.watch(
        jsWatch as never as string,
        { ignoreInitial: true },
        () => watchHandler('js')
    );
    
    bs.watch(
        cssWatch as never as string,
        { ignoreInitial: true },
        () => watchHandler('css')
    );

    if (builder.info().copyFiles.length)
        builder.watchCopyFiles(() => bs.reload("*.html"));
        
    // Start //
    try {
        await builder.build();
    } catch {
        log(chalk.red`FAILED FIRST BUILD`);
    }

    bs.init({
        server: toDir,
        middleware: [ historyApiFallback() ],
        reloadDelay: 0,
        reloadDebounce: 100,
        reloadOnRestart: true,
        port,
        ghostMode: false,
        host: network(),
    });
}
