import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { PackageEnumerator, PackagesType } from "../packageEnumerator";
const glob = require('fast-glob');
const semver = require('semver');
const stringifyPackage = require("stringify-package");

interface IBuildStep {
    srcPath?: string|string[];
    outPath?: string|string[];
    script?: string;
}

export class BuildEnumerator extends PackageEnumerator {
    constructor(rootPath: string) {
        super(rootPath);
    }

    protected async processPackage(packagePath: string, packageJson: any, packages: PackagesType): Promise<void> {
        if (this.needsNpmInstall(packagePath, packageJson, packages)) {
            console.log("blerf: installing " + packageJson.name);
            childProcess.execSync("npm install", {stdio: 'inherit', cwd: packagePath});
        } else {
            console.log("blerf: " + packageJson.name + " node_modules up to date");
        }

        if (!packageJson.blerf || !packageJson.blerf.steps) {
            if (!packageJson.scripts["build"]) {
                console.log("blerf: no blerf section and no build script in package.json. skipping.");
                return;
            }
            childProcess.execSync("npm run build", {stdio: 'inherit', cwd: packagePath});
            return;
        }

        if (!Array.isArray(packageJson.blerf.steps)) {
            throw new Error("blerf.steps must be an array");
        }

        for (let step of packageJson.blerf.steps as IBuildStep[]) {
            await this.processBuildStep(packagePath, step);
        }
    }

    private async processBuildStep(packagePath: string, step: IBuildStep): Promise<void> {
        let srcPath: string[];
        if (Array.isArray(step.srcPath)) {
            srcPath = step.srcPath;
        } else if (typeof step.srcPath === "string") {
            srcPath = [ step.srcPath ];
        } else {
            srcPath = [];
        }

        let outPath: string[];
        if (Array.isArray(step.outPath)) {
            outPath = step.outPath;
        } else if (typeof step.outPath === "string") {
            outPath = [ step.outPath ];
        } else {
            outPath = [];
        }

        const srcFileNames: string[] = await glob(srcPath, { cwd: packagePath });
        if (!srcFileNames) {
            console.log("blerf: no matches for blerf.srcPath", srcPath);
        }

        const outFileNames: string[] = await glob(outPath, { cwd: packagePath });
        if (!outFileNames) {
            console.log("blerf: no matches for blerf.outPath", outPath);
        }

        const srcLastModified = this.getLastModifiedDate(packagePath, srcFileNames);
        const outLastModified = this.getLastModifiedDate(packagePath, outFileNames);

        if (srcLastModified > outLastModified) {
            console.log("blerf: modifications detected. build step", step.script);
            // https://humanwhocodes.com/blog/2016/03/mimicking-npm-script-in-node-js/
            // https://github.com/npm/npm-lifecycle/blob/latest/index.js
            const env = Object.assign({}, process.env);
            const binPath = path.resolve(path.join(packagePath, "./node_modules/.bin"));
            this.prependPath(env, binPath);

            if (step.script) {
                childProcess.execSync(step.script, {stdio: 'inherit', cwd: packagePath, env: env });
            }
        } else {
            console.log("blerf: no modifications. skipping", step.script, "in", packagePath);
        }
    }

    private needsNpmInstall(packagePath: string, packageJson: any, packages: PackagesType): boolean {

        // Workaround errors during npm install with file: references in package-lock.json, f.ex this error message:
        // verbose stack Error: ENOENT: no such file or directory, rename 'd:\Code\festtest\lib-b\node_modules\.staging\lib-a-3f8fcb24\node_modules\@babel\code-frame' -> 'd:\Code\festtest\lib-b\node_modules\.staging\@babel\code-frame-7800f1dd'
        // This occurs when installing a project which depends on a file:-based library, and dependencies were removed from the library.
        // And this error message:
        // npm ERR! Cannot read property 'match' of undefined
        // This also occurs when installing a project which depends on a file:-based library, and there were changes in the library dependencies.
        // Haven't been able to reproduce this. There were bogus entries for dependencies of a file:-based reference without version:
        // "version": "file:../project",
        // ...
        // "dependencies": {
        //   ...
        //   "@babel/core": {
        //     "bundled": true
        //   }, 

        // To resolve both of these, check for changes in the referenced package.json,
        // remove such file:-based entries in the parent package-lock and run npm install.
        
        let packageLockJson: any;
        try {
            packageLockJson = this.readPackageJson(path.join(packagePath, "package-lock.json"));
        } catch (e) {
            packageLockJson = null;
        }

        let savePackageLockJson = false;
        if (packageLockJson && packageLockJson.dependencies) {
            for (const dependencyName of Object.keys(packageLockJson.dependencies)) {

                const dependencyInfo = packageLockJson.dependencies[dependencyName];
                if (typeof dependencyInfo.version !== "string") {
                    console.log("blerf: recovering from npm error scenario: invalid version. package-lock.json has been modified.");
                    savePackageLockJson = true;
                    delete packageLockJson.dependencies[dependencyName];
                    continue;
                }

                if (dependencyInfo.version.startsWith("file:")) {
                    const dependencyPackageInfo = packages[dependencyName];
                    if (!dependencyPackageInfo) {
                        continue;
                    }

                    const dependencyPackageJson = dependencyPackageInfo.packageJson;

                    // Get sub-toplevel dependencies of file:-based dependency from package-lock
                    const dependencyToplevelDependencies = this.getTopLevelDependencies(dependencyInfo.dependencies);

                    if (!this.hasAllDependencies(dependencyPackageJson, dependencyToplevelDependencies)) {
                        console.log("blerf: recovering from npm error scenario: file:-based dependency mismatch. package-lock.json has been modified.");
                        delete packageLockJson.dependencies[dependencyName];
                        savePackageLockJson = true;
                        continue;
                    }
                }
            }
        }

        let shouldInstall = false;

        if (savePackageLockJson) {
            fs.writeFileSync(path.join(packagePath, "package-lock.json"), stringifyPackage(packageLockJson), 'utf8');
            shouldInstall = true;
        }

        // Another npm install error recovery scenario: if a file:-based dependency has been installed in a directory instead of symlink
        if (packageJson.dependencies) {
            shouldInstall = this.fixNonSymlinkFileDependencies(packageJson.dependencies, packagePath) || shouldInstall;
        }

        if (packageJson.devDependencies) {
            shouldInstall = this.fixNonSymlinkFileDependencies(packageJson.devDependencies, packagePath) || shouldInstall;
        }

        if (shouldInstall) {
            return true;
        }

        if (packageJson.dependencies) {
            if (this.needsNpmInstallDependencies(packageJson.dependencies, packagePath)) {
                return true;
            }
        }

        if (packageJson.devDependencies) {
            if (this.needsNpmInstallDependencies(packageJson.devDependencies, packagePath)) {
                return true;
            }
        }

        // Compare package.json with package-lock.json if anything was removed
        if (packageLockJson && packageLockJson.dependencies) {
            const topLevelDependencies = this.getTopLevelDependencies(packageLockJson.dependencies);
            if (!this.hasAllDependencies(packageJson, topLevelDependencies)) {
                console.log("blerf: requires install: top level dependency in package-lock.json missing from package.json")
                return true;
            }
        }

        return false;
    }

    private hasAllDependencies(packageJson: any, dependencyNames: string[]) {
        for (const dependencyName of dependencyNames) {
            if (!this.hasDependency(packageJson, dependencyName)) {
                return false;
            }
        }

        return true;
    }

    private hasDependency(packageJson: any, dependencyName: string) {
        const isInDependencies = packageJson.dependencies && !!packageJson.dependencies[dependencyName];
        const isInDevDependencies = packageJson.devDependencies && !!packageJson.devDependencies[dependencyName];
        return isInDependencies || isInDevDependencies;
    }

    private getTopLevelDependencies(dependencies: any): string[] {
        const nonTopLevelNames: string[] = [];
        this.scanNonTopLevelDependencies(dependencies, nonTopLevelNames);

        const result: string[] = [];
        for (const dependencyName of Object.keys(dependencies)) {
            if (nonTopLevelNames.indexOf(dependencyName) !== -1) {
                continue;
            }

            result.push(dependencyName);
        }

        return result;
    }

    private scanNonTopLevelDependencies(dependencies: any, nonTopLevelNames: string[]) {
        for (const dependencyName of Object.keys(dependencies)) {
            const dependencyInfo = dependencies[dependencyName];
            if (dependencyInfo.requires) {
                for (const dependencyRequireName of Object.keys(dependencyInfo.requires)) {
                    if (nonTopLevelNames.indexOf(dependencyRequireName) === -1) {
                        nonTopLevelNames.push(dependencyRequireName);
                    }
                }
            }

            if (dependencyInfo.dependencies) {
                this.scanNonTopLevelDependencies(dependencyInfo.dependencies, nonTopLevelNames);
            }
        }
    }

    private fixNonSymlinkFileDependencies(dependencies: {[name: string]: string}, packagePath: string): boolean {
        let recovered = false;
        for (let dependencyName of Object.keys(dependencies)) {
            const dependencyVersion = dependencies[dependencyName];

            if (dependencyVersion.startsWith("file:")) {
                const dependencyNodePath = path.join(packagePath, "node_modules", dependencyName);
                if (!fs.lstatSync(dependencyNodePath).isSymbolicLink()) {
                    console.log("blerf: recovering from npm error scenario: 'file:'-dependency exists in node_modules, but is not a symlink");
                    this.rimraf(dependencyNodePath);
                    recovered = true;
                }
            }
        }

        return recovered;
    }

    private needsNpmInstallDependencies(dependencies: {[name: string]: string}, packagePath: string): boolean {
        for (let dependencyName of Object.keys(dependencies)) {
            const dependencyVersion = dependencies[dependencyName];

            const dependencyPackageJsonPath = path.join(packagePath, "node_modules", dependencyName, "package.json");
            if (!fs.existsSync(dependencyPackageJsonPath)) {
                console.log("blerf: " + dependencyName + "@" + dependencyVersion + " is not installed");
                return true;
            }

            if (dependencyVersion.startsWith("file:")) {
                // project refs usually dont need installation, except initially,
                // or if is a tool and does not have a .bin entry
                continue;
            }

            const dependencyPackageJson = this.readPackageJson(dependencyPackageJsonPath);
            if (!semver.satisfies(dependencyPackageJson.version, dependencyVersion)) {
                console.log("blerf: " + dependencyName + "@" + dependencyVersion + " is not satisfied by " + dependencyPackageJson.version);
                return true;
            }
        }

        return false;
    }

    private prependPath(env: any, pathToPrepend: string) {
        let pathName: string;
        if (process.platform === 'win32') {
            pathName = 'Path'
            Object.keys(process.env).forEach(function (e) {
                if (e.match(/^PATH$/i)) {
                    pathName = e
                }
            });
        } else {
            pathName = "PATH";
        }

        const separator = process.platform === "win32" ? ";" : ":";
        env[pathName] = pathToPrepend + separator + env[pathName];
    }

    private getLastModifiedDate(basePath: string, fileNames: string[]): number {
        let mtimeMs: number = -1;
        for (let fileName of fileNames) {
            mtimeMs = Math.max(mtimeMs, fs.statSync(path.join(basePath, fileName)).mtimeMs);
        }

        return mtimeMs;
    }
}
