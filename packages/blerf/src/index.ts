#!/usr/bin/env node
import * as process from 'process';
import { RunEnumerator } from './commands/run';
import { PackEnumerator } from './commands/pack';
import { BuildEnumerator } from './commands/build';
import { TestEnumerator } from './commands/test';
import { BundleEnumerator } from './commands/bundle';

const rootPath = "packages";

(async () => {

    if (process.argv[2] === "run") {
        const cmd = new RunEnumerator(rootPath, process.argv.slice(3));
        await cmd.enumeratePackages();
    } else if (process.argv[2] === "pack:publish") {
        const cmd = new PackEnumerator(rootPath, "artifacts/publish", "artifacts/publish", false);
        await cmd.enumeratePackages();
    } else if (process.argv[2] === "pack:deploy") {
        const pack = new PackEnumerator(rootPath, "artifacts/deploy-temp", "artifacts/deploy", true);
        await pack.enumeratePackages();

        const bundle = new BundleEnumerator(rootPath, "artifacts/deploy-temp", "artifacts/deploy");
        await bundle.enumeratePackages();
    } else if (process.argv[2] === "build") {
        const cmd = new BuildEnumerator(rootPath);
        await cmd.enumeratePackages();
    } else if (process.argv[2] === "test") {
        const cmd = new TestEnumerator(rootPath);
        await cmd.enumeratePackages();
    } else {
        console.log("usage: blerf [run|install|pack|build|test]")
    }

})();
