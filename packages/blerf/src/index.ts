#!/usr/bin/env node
import * as process from 'process';
import { RunEnumerator } from './commands/run';
import { PackEnumerator } from './commands/pack';
import { BuildEnumerator } from './commands/build';
import { TestEnumerator } from './commands/test';

const rootPath = "packages";

if (process.argv[2] === "run") {
    const cmd = new RunEnumerator(rootPath, process.argv.slice(3));
    cmd.enumeratePackages();
} else if (process.argv[2] === "pack:publish") {
    const cmd = new PackEnumerator(rootPath, false);
    cmd.enumeratePackages();
} else if (process.argv[2] === "pack:deploy") {
    const cmd = new PackEnumerator(rootPath, true);
    cmd.enumeratePackages();
} else if (process.argv[2] === "build") {
    const cmd = new BuildEnumerator(rootPath);
    cmd.enumeratePackages();
} else if (process.argv[2] === "test") {
    const cmd = new TestEnumerator(rootPath);
    cmd.enumeratePackages();
} else {
    console.log("usage: blerf [run|install|pack|build|test]")
}
