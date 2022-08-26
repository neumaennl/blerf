#!/usr/bin/env node
import * as process from 'process';
import { RunEnumerator } from './commands/run';
import { PackEnumerator } from './commands/pack';
import { BuildEnumerator } from './commands/build';
import { TestEnumerator } from './commands/test';
import { BundleEnumerator } from './commands/bundle';
import { Command, CommandLineApplication } from './commandLineApplication';

const rootPath = "packages";

interface RunArguments {
    script: string;
}

interface BuildArguments {
    configuration: string;
}

class BlerfApplication extends CommandLineApplication {

    static programName: string = "blerf";

    @Command("run", "Run an NPM script", {
        name: "script",
        type: "commandArgument",
        required: true,
    })
    async run(args: RunArguments, argv: string[]) {
        const cmd = new RunEnumerator(rootPath, argv); //process.argv.slice(3));
        await cmd.enumeratePackages();
    }

    @Command("build", "Install dependencies and execute build step", {
        name: "configuration",
        shortName: "c",
        type: "enum",
        enum: ["debug", "release"],
        default: "debug",
    })
    async build(args: BuildArguments, argv: string[]) {
        const cmd = new BuildEnumerator(rootPath, "artifacts/build");
        await cmd.enumeratePackages();
    }

    @Command("pack:publish", "Create publishable artifacts")
    async packPublish(args: BuildArguments, argv: string[]) {
        const cmd = new PackEnumerator(rootPath, "artifacts/publish", "artifacts/publish", false);
        await cmd.enumeratePackages();
    }

    @Command("pack:deploy", "Create deployable artifacts")
    async packDeploy(args: BuildArguments, argv: string[]) {
        const pack = new PackEnumerator(rootPath, "artifacts/deploy-temp", "artifacts/deploy", true);
        await pack.enumeratePackages();

        const bundle = new BundleEnumerator(rootPath, "artifacts/deploy-temp", "artifacts/deploy");
        await bundle.enumeratePackages();
    }

    @Command("test", "Run tests with coverage")
    async test(args: BuildArguments, argv: string[]) {
        const cmd = new TestEnumerator(rootPath);
        await cmd.enumeratePackages();
    }
}

const app = new BlerfApplication();
app.runCommandLineApplicationAndExit(process.argv.slice(2));
