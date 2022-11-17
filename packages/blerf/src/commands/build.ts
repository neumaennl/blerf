import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as childProcess from 'child_process';
import { PackageEnumerator, PackagesType, PackageInfoType, PackageDependencyInfoType } from "../packageEnumerator";
const glob = require('fast-glob');
const semver = require('semver');
const stringifyPackage = require("stringify-package");
const tar = require('tar')
const ssri = require('ssri')

interface IBuildStep {
    srcPath?: string|string[];
    outPath?: string|string[];
    script?: string;
}

interface IProjectReference {
    name: string;
    isInstalled: boolean;
    isOutdated: boolean;
    hasDependencyChanges: boolean;
}

export class BuildEnumerator extends PackageEnumerator {
    private artifactBuildPath: string;

    constructor(rootPath: string, artifactBuildPath: string) {
        super(rootPath);
        this.artifactBuildPath = artifactBuildPath;
    }

    protected async processPackage(packagePath: string, packageJson: any, packages: PackagesType): Promise<void> {
        console.log("blerf: building", packageJson.name);

        await this.installBeforeBuild(packages[packageJson.name], packages);

        const targetTarPath = path.join(this.artifactBuildPath,  this.packageNameToFileName(packageJson.name) + ".tgz");

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
            await this.packBuildArtifact(packagePath, packageJson, packages, targetTarPath);
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

    private getProjectReferences(packageInfo: PackageInfoType, packages: PackagesType): IProjectReference[] {
        const result: IProjectReference[] = [];
        for (let dependencyName of Object.keys(packageInfo.dependencies)) {
            const installedDependencyPackageInfo = packageInfo.dependencies[dependencyName];
            const ref = installedDependencyPackageInfo.version;
            if (!ref || !ref.startsWith("file:")) {
                continue;
            }

            const tarball = path.join(packageInfo.packagePath, ref.substr(5));
            if (!fs.existsSync(tarball)) {
                throw new Error("Unable to build project. Dependency tarball does not exist.");
            }

            const dependencyPath = path.join(packageInfo.packagePath, "node_modules", dependencyName);

            const currentDependencyPackageInfo = packages[dependencyName];

            let isOutdated = false;
            let isInstalled = false;
            let hasDependencyChanges = false;

            if (!installedDependencyPackageInfo.packageJson) {
                isOutdated = true;
                hasDependencyChanges = true;
            } else
            if (fs.lstatSync(dependencyPath).isSymbolicLink()) {
                isOutdated = true;
                isInstalled = true;
                hasDependencyChanges = true;
            } else {
                isInstalled = true;

                const depTime = fs.lstatSync(dependencyPath).mtimeMs;
                const tarTime = fs.lstatSync(tarball).mtimeMs;
                if (tarTime > depTime) {
                    isOutdated = true;
                    hasDependencyChanges = this.hasDependencyChanges(installedDependencyPackageInfo, currentDependencyPackageInfo);
                }
            }

            result.push({
                name: dependencyName,
                isInstalled: isInstalled,
                isOutdated: isOutdated,
                hasDependencyChanges: hasDependencyChanges,
            });
        }

        return result;
    }

    private hasDependencyChanges(localProjectInfo: PackageDependencyInfoType, dependencyProjectInfo: PackageInfoType) {
        const localDependencyNames = Object.keys(localProjectInfo.projectReferenceDependencies);
        const dependencyDependencyNames = Object.keys(dependencyProjectInfo.packageJson.dependencies);
        if (localDependencyNames.length !== dependencyDependencyNames.length) {
            return true;
        }

        for (let dependencyName of localDependencyNames) {
            const dependencyDependencyInfo = dependencyProjectInfo.dependencies[dependencyName];
            if (!dependencyDependencyInfo) {
                return true;
            }

            if (dependencyDependencyInfo.version && dependencyDependencyInfo.version.startsWith("file:")) {
                continue;
            }

            const localDependencyVersion = localProjectInfo.projectReferenceDependencies[dependencyName];
            if (localDependencyVersion !== dependencyDependencyInfo.version) {
                return true;
            }
        }

        return false;
    }

    private async installBeforeBuild(packageInfo: PackageInfoType, packages: PackagesType): Promise<void> {
        // fast refresh project reference if:
        //   - tarball is newer, and NO sub dependency changes

        // reinstall project reference if:
        //   - tarball is newer, and sub dependency changes

        // install if:
        //   - local project has changed dependencies
        //     - version mismatches
        //     - removed dependency

        const projectReferences = this.getProjectReferences(packageInfo, packages);

        const refreshProjectReferences = projectReferences.filter(p => p.isOutdated);
        const fastRefreshProjectReferences = refreshProjectReferences.filter(p => p.isInstalled && !p.hasDependencyChanges);

        let shouldInstall = false;

        if (refreshProjectReferences.length > 0) {
            const names = refreshProjectReferences.map(p => p.name);

            shouldInstall = this.needsNpmInstallDependencies(packageInfo);

            if (!shouldInstall && refreshProjectReferences.length === fastRefreshProjectReferences.length) {
                // There are dependency changes in the local project, no dependency changes in project references, and only code changes in project references
                // Delete from node_modules, unpack directly; update integridy hash in lockfile
                console.log("blerf: detected changes in project reference, but no dependency changes. fast refresh " + names.join(" "));
                const integrities: {[key: string]: string} = {};
                for (let refreshProjectReference of refreshProjectReferences) {
                    const dependencyPath = path.join(packageInfo.packagePath, "node_modules", refreshProjectReference.name);
                    await this.rimrafWithRetry(dependencyPath);

                    const sourceTarPath = path.join(this.artifactBuildPath, this.packageNameToFileName(refreshProjectReference.name) + ".tgz");

                    fs.mkdirSync(dependencyPath, { recursive: true });
                    tar.extract({ file: sourceTarPath, cwd: dependencyPath, sync: true, strip: 1 });

                    integrities[refreshProjectReference.name] = ssri.fromData(fs.readFileSync(sourceTarPath));
                }

                this.updatePackageLockIntegrities(packageInfo.packagePath, integrities);
            } else if (!shouldInstall) {
                // There are dependency changes in the local project, and dependency changes in project references
                console.log("blerf: detected dependency changes in project references " + names.join(", "));
                childProcess.execSync("npm install " + names.join(" "), {stdio: 'inherit', cwd: packageInfo.packagePath});
            } else {
                // There are dependency changes in both the local project AND in project references
                console.log("blerf: detected dependency changes in local project and project references " + names.join(" "));
                childProcess.execSync("npm uninstall --no-save " + names.join(" "), {stdio: 'inherit', cwd: packageInfo.packagePath});
                childProcess.execSync("npm install", {stdio: 'inherit', cwd: packageInfo.packagePath});
                shouldInstall = true;
            }
        } else {
            shouldInstall = this.needsNpmInstallDependencies(packageInfo);
            if (shouldInstall) {
                // There are dependency changes in the local project, and no dependency changes in project references
                console.log("blerf: detected dependency changes in " + packageInfo.packageJson.name);
                childProcess.execSync("npm install", {stdio: 'inherit', cwd: packageInfo.packagePath});
            }
        }
    }

    private updatePackageLockIntegrities(packagePath: string, integrities: {[key: string]: string}) {
        let packageLockJson: any = this.readPackageJson(path.join(packagePath, "package-lock.json"));
        if (!packageLockJson || !packageLockJson.dependencies) {
            return ;
        }

        for (let dependencyName of Object.keys(integrities)) {
            const dep = packageLockJson.dependencies[dependencyName];
            if (dep && dep.integrity) {
                // console.log("blerf: replacing integrity", dep.integrity, integrities[dependencyName])
                dep.integrity = integrities[dependencyName];
            }
        }

        fs.writeFileSync(path.join(packagePath, "package-lock.json"), stringifyPackage(packageLockJson), 'utf8');
    }

    private async packBuildArtifact(packagePath: string, packageJson: any, packages: PackagesType, targetTarPath: string) {
        childProcess.execSync("npm pack --loglevel error", {stdio: 'inherit', cwd: packagePath});

        const sourceTarPath = path.join(packagePath, this.packageNameToFileName(packageJson.name) + "-" + packageJson.version + ".tgz");
        fs.mkdirSync(this.artifactBuildPath, { recursive: true });

        const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "blerf-"));
        try {
            tar.extract({ file: sourceTarPath, cwd: tempPath, sync: true });

            const packageJsonPath = path.join(tempPath, "package", "package.json");
            const packageJson = this.readPackageJson(packageJsonPath);
            this.rewriteProjectReferencesFullPath(path.resolve(this.artifactBuildPath), packageJson.dependencies, packages);
            this.rewriteProjectReferencesFullPath(path.resolve(this.artifactBuildPath), packageJson.devDependencies, packages);
            this.trimPackageJson(packageJson);
            fs.writeFileSync(packageJsonPath, stringifyPackage(packageJson), 'utf8');

            const shouldUpdateSourceMapsSourceRoot = !packageJson.blerf || packageJson.blerf.updateSourceMapsSourceRoot !== false;
            if (shouldUpdateSourceMapsSourceRoot) {
                await this.updateSourceMapsSourceRoot(tempPath, packageJson);
            }

            tar.create({ file: targetTarPath, cwd: tempPath, gzip: true, sync: true, }, ["package"]);
        } finally {
            this.rimraf(tempPath);
            fs.unlinkSync(sourceTarPath);
        }
    }

    private async updateSourceMapsSourceRoot(tempPath: string, packageJson: any) {
        const packageRootPath = path.join(tempPath, "package");
        const mapFileNames = await glob(path.join(packageRootPath, "**/*.map"));
        for (let mapFileName of mapFileNames) {
            const mapRelativeName = path.relative(packageRootPath, mapFileName);

            const mapJson = this.readPackageJson(mapFileName);

            // Find the relative path between where the .map file has been installed, and its corresponding source location under ./packages
            const relativeMapToModulePath = path.relative(path.dirname(mapRelativeName), ".");
            const relativeModuleToPackagesPath = "../../.."; // <project>/node_modules/<reference>
            const relativeSourceRoot = path.join(relativeMapToModulePath, relativeModuleToPackagesPath, packageJson.name, path.dirname(mapRelativeName));

            // Absolute path works in VSCode/windows, but seemingly not in Istanbul reports
            // Backslash works in VSCode/windows, but seemingly not in Istanbul reports
            // const absoluteSourceRoot = path.resolve(packagePath, path.dirname(mapRelativeName));

            mapJson.sourceRoot = relativeSourceRoot.replace(/\\/g, "/");

            fs.writeFileSync(mapFileName, JSON.stringify(mapJson), "utf8");
        }
    }

    private needsNpmInstallDependencies(packageInfo: PackageInfoType): boolean {
        for (let dependencyName of Object.keys(packageInfo.dependencies)) {
            const dependencyInfo = packageInfo.dependencies[dependencyName];

            if (!dependencyInfo.packageJson) {
                console.log("blerf: " + dependencyName + "@" + dependencyInfo.version + " is not installed");
                return true;
            }

            if (dependencyInfo.version.startsWith("file:")) {
                // project refs usually dont need installation, except initially,
                // or if is a tool and does not have a .bin entry
                continue;
            }

            if (!semver.satisfies(dependencyInfo.packageJson.version, dependencyInfo.version)) {
                console.log("blerf: " + dependencyName + "@" + dependencyInfo.version + " is not satisfied by " + dependencyInfo.packageJson.version);
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
