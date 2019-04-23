import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import { PackageEnumerator, PackagesType } from "../packageEnumerator";
const glob = require('fast-glob');
const semver = require('semver');
const stringifyPackage = require("stringify-package");
const tar = require('tar')

interface IBuildStep {
    srcPath?: string|string[];
    outPath?: string|string[];
    script?: string;
}

export class BuildEnumerator extends PackageEnumerator {
    private artifactBuildPath: string;

    constructor(rootPath: string, artifactBuildPath: string) {
        super(rootPath);
        this.artifactBuildPath = artifactBuildPath;
    }

    protected async processPackage(packagePath: string, packageJson: any, packages: PackagesType): Promise<void> {
        console.log("blerf: building", packageJson.name);
        let shouldInstall = false;
        const refreshProjects: string[] = [];
        shouldInstall = this.shouldInstallOutdatedProjectReferences(packagePath, packageJson.dependencies, refreshProjects) || shouldInstall;
        shouldInstall = this.shouldInstallOutdatedProjectReferences(packagePath, packageJson.devDependencies, refreshProjects) || shouldInstall;

        shouldInstall = shouldInstall || this.needsNpmInstallDependencies(packageJson.dependencies, packagePath);
        shouldInstall = shouldInstall || this.needsNpmInstallDependencies(packageJson.devDependencies, packagePath);

        if (shouldInstall) {
            this.cleanOutdatedProjectReferences(packagePath, refreshProjects);

            console.log("blerf: installing " + packageJson.name);
            childProcess.execSync("npm install --offline", {stdio: 'inherit', cwd: packagePath});
        }

        const targetTarPath = path.join(this.artifactBuildPath,  packageJson.name + ".tgz");

        let shouldPack = !fs.existsSync(targetTarPath);

        if (packageJson.blerf && packageJson.blerf.steps) {
            if (!Array.isArray(packageJson.blerf.steps)) {
                throw new Error("blerf.steps must be an array");
            }

            for (let step of packageJson.blerf.steps as IBuildStep[]) {
                shouldPack = await this.processBuildStep(packagePath, step) || shouldPack;
            }
        } else {
            if (packageJson.scripts && packageJson.scripts.build) {
                childProcess.execSync("npm run build", {stdio: 'inherit', cwd: packagePath});
                shouldPack = true;
            }
        }

        if (shouldPack) {
            this.packBuildArtifact(packagePath, packageJson, packages, targetTarPath);
        }
    }

    private async processBuildStep(packagePath: string, step: IBuildStep): Promise<boolean> {
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
                return true;
            }
        } else {
            console.log("blerf: no modifications. skipping", step.script, "in", packagePath);
        }

        return false;
    }

    private shouldInstallOutdatedProjectReferences(packagePath: string, dependencies: {[name: string]: string}, outdatedDependencies: string[]): boolean {
        let shouldInstall = false;
        for (let dependencyName of Object.keys(dependencies)) {
            const ref = dependencies[dependencyName];
            if (!ref.startsWith("file:")) {
                continue;
            }

            const tarball = path.join(packagePath, ref.substr(5));
            const dependencyPath = path.join(packagePath, "node_modules", dependencyName);
            if (!fs.existsSync(dependencyPath)) {
                shouldInstall = true;
                continue;
            }

            if (!fs.existsSync(tarball)) {
                throw new Error("Unable to build project. Dependency tarball does not exist.");
            }

            const depTime = fs.lstatSync(dependencyPath).mtimeMs;
            const tarTime = fs.lstatSync(tarball).mtimeMs;
            if (tarTime > depTime) {
                outdatedDependencies.push(dependencyName);
                shouldInstall = true;
            }
        }

        return shouldInstall;
    }

    private cleanOutdatedProjectReferences(packagePath: string, outdatedDependencies: string[]) {
        let packageLockJson: any = null;
        try {
            packageLockJson = this.readPackageJson(path.join(packagePath, "package-lock.json"));
        } catch (e) {}

        for (let dependencyName of outdatedDependencies) {
            console.log("blerf: refreshing project reference", dependencyName);
            const dependencyPath = path.join(packagePath, "node_modules", dependencyName);
            this.rimraf(dependencyPath);

            if (packageLockJson && packageLockJson.dependencies) {
                delete packageLockJson.dependencies[dependencyName];
            }
        }

        if (packageLockJson) {
            fs.writeFileSync(path.join(packagePath, "package-lock.json"), stringifyPackage(packageLockJson), 'utf8');
        }
    }

    private packBuildArtifact(packagePath: string, packageJson: any, packages: PackagesType, targetTarPath: string) {
        childProcess.execSync("npm pack", {stdio: 'inherit', cwd: packagePath});

        const sourceTarPath = path.join(packagePath, packageJson.name + "-" + packageJson.version + ".tgz");
        fs.mkdirSync(this.artifactBuildPath, { recursive: true });

        const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "blerf-"));
        try {
            tar.extract({ file: sourceTarPath, cwd: tempPath, sync: true });

            const packageJsonPath = path.join(tempPath, "package", "package.json");
            const packageJson = this.readPackageJson(packageJsonPath);
            this.rewriteProjectReferencesFullPath(path.resolve(this.artifactBuildPath), packageJson.dependencies, packages);
            this.rewriteProjectReferencesFullPath(path.resolve(this.artifactBuildPath), packageJson.devDependencies, packages);
            fs.writeFileSync(packageJsonPath, stringifyPackage(packageJson), 'utf8');

            tar.create({ file: targetTarPath, cwd: tempPath, gzip: true, sync: true, }, ["package"]);
        } finally {
            this.rimraf(tempPath);
            fs.unlinkSync(sourceTarPath);
        }
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
