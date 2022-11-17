import * as fs from 'fs';
import * as path from 'path';
import { toposort } from './toposort';

export type PackageDependencyInfoType = {
    version:string,
    packagePath: string,
    packageJson: any,
    dev: boolean,
    projectReferenceDependencies: { [packageName: string]: string };
}

export type PackageDependenciesType = { [packageName: string]: PackageDependencyInfoType };

export type PackageInfoType = { 
    packagePath: string,
    packageJson: any,
    dependencies: PackageDependenciesType,
};

export type PackagesType = { [packageName: string]: PackageInfoType };

export abstract class PackageEnumerator {

    rootPath: string;

    constructor(rootPath: string) {
        this.rootPath = rootPath;
    }

    public async enumeratePackages(): Promise<void> {
        const files = fs.readdirSync(this.rootPath);

        const packages: PackagesType = {};

        const nodes: string[] = [];
        const edges: [string, string][] = [];

        for (let fileName of files) {
            const packagePath = this.rootPath + "/" + fileName;
            const ls = fs.lstatSync(packagePath);
            if (!ls.isDirectory()) {
                continue;
            }
            
            const packageJsonPath = path.join(packagePath, "package.json");

            const packageJson = this.readPackageJson(packageJsonPath);
            if (!packageJson || !packageJson.name) {
                console.log("blerf: skipping", packageJsonPath, ". cannot find valid package.json with name.");
                continue;
            }

            nodes.push(packageJson.name);

            const dependencies: PackageDependenciesType = {};

            this.enumerateDependencies(packageJson, (name, version, dev) => {
                const dependencyPath = path.join(packagePath, "node_modules", name);
                const dependencyPackageJson = this.readPackageJson(path.join(dependencyPath, "package.json"));
                const projectReferenceDependencies: { [packageName: string]: string } = {};

                if (dependencyPackageJson && version.startsWith("file:")) {
                    this.enumerateDependencies(dependencyPackageJson, (name, version, dev) => {
                        if (!dev) {
                            projectReferenceDependencies[name] = version;
                        }
                    });
                }

                dependencies[name] = {
                    packageJson: dependencyPackageJson,
                    packagePath: dependencyPath,
                    version: version,
                    projectReferenceDependencies: projectReferenceDependencies,
                    dev: dev,
                }
            });

            packages[packageJson.name] = {
                packageJson: packageJson,
                packagePath: packagePath,
                dependencies: dependencies,
            };
        }

        for (let packageName of nodes) {
            const packageInfo = packages[packageName];
            const packageJson = packageInfo.packageJson;

            this.enumerateDependencies(packageJson, (name, version, dev) => {
                if (version.startsWith("file:") && nodes.indexOf(name) !== -1) {
                    this.validateFileReference(version, name);
                    edges.push([name, packageJson.name])
                }
            });
        }

        const sorted = toposort(nodes, edges);
        console.log("blerf: project order: " + sorted.join(", "));

        for (let packageName of sorted) {
            const packageInfo = packages[packageName];
            const packageJson = packageInfo.packageJson;
            const packagePath = packageInfo.packagePath;

            try {
                await this.processPackage(packagePath, packageJson, packages);
            } catch (e) {
                console.error("blerf: Error executing command in " + packagePath)
                console.error("blerf: ", e);
                console.error("blerf: Resuming in next directory")
            }
        }
    }

    protected enumerateDependencies(packageJson: any, callback: (name: string, version: string, dev: boolean) => void) {
        if (packageJson.dependencies) {
            for (let name of Object.keys(packageJson.dependencies)) {
                callback(name, packageJson.dependencies[name], false);
            }
        }

        if (packageJson.devDependencies) {
            for (let name of Object.keys(packageJson.devDependencies)) {
                callback(name, packageJson.devDependencies[name], true);
            }
        }
    }

    protected readPackageJson(packageJsonPath: string): any|null {
        try {
            return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        } catch (e) {
            return null;
        }
    }

    protected async rimrafWithRetry(path: string): Promise<void> {
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        let retryCounter = 10;
        while (retryCounter > 0) {
            try {
                this.rimraf(path);
                break;
            } catch (e) {
                retryCounter--;
                if (retryCounter) {
                    console.warn("blerf: " + e.message + ". Retrying...");
                    await sleep(100);
                }
            }
        }
    }

    protected rimraf(dir_path: string) {
        // Remove directory recursively
        // https://stackoverflow.com/a/42505874/3027390
        if (fs.existsSync(dir_path)) {
            const entries = fs.readdirSync(dir_path);
            for (let entry of entries) {
                var entry_path = path.join(dir_path, entry);
                if (fs.lstatSync(entry_path).isDirectory()) {
                    this.rimraf(entry_path);
                } else {
                    fs.unlinkSync(entry_path);
                }
            }
            fs.rmdirSync(dir_path);
        }
    }

    protected packageNameToFileName(packageName: string): string {
        if(packageName.startsWith("@")) {
            return packageName.substring(1).replace("/", "-");
        }
        return packageName;
    }

    protected validateFileReference(version: string, packageName: string) {
        const expectedReference = "file:../../artifacts/build/" + this.packageNameToFileName(packageName) + ".tgz";
        if (version !== expectedReference) {
            throw new Error("Project reference to " + packageName + " must be \"" + expectedReference + "\"");
        }
    }

    protected rewriteProjectReferencesFullPath(artifactPackFullPath: string, packageDependencies: any, packages: PackagesType) {
        if (!packageDependencies) {
            return;
        }

        for (let dependencyName of Object.keys(packageDependencies)) {
            const ref = packageDependencies[dependencyName];
            if (!ref.startsWith("file:")) {
                continue;
            }

            const dependencyPackageInfo = packages[dependencyName];
            packageDependencies[dependencyName] = path.join(artifactPackFullPath, this.packageNameToFileName(dependencyPackageInfo.packageJson.name) + ".tgz");
        }
    }

    protected rewriteProjectReferencesFullPathVersion(artifactPackFullPath: string, packageDependencies: any, packages: PackagesType) {
        if (!packageDependencies) {
            return;
        }

        for (let dependencyName of Object.keys(packageDependencies)) {
            const ref = packageDependencies[dependencyName];
            if (!ref.startsWith("file:")) {
                continue;
            }

            const dependencyPackageInfo = packages[dependencyName];
            packageDependencies[dependencyName] = "file:" + path.join(artifactPackFullPath, this.packageNameToFileName(dependencyPackageInfo.packageJson.name) + "-" + dependencyPackageInfo.packageJson.version + ".tgz");
        }
    }

    protected rewriteProjectReferencesVersion(packageDependencies: any, packages: PackagesType) {
        if (!packageDependencies) {
            return;
        }

        for (let dependencyName of Object.keys(packageDependencies)) {
            const ref = packageDependencies[dependencyName];
            if (!ref.startsWith("file:")) {
                continue;
            }

            const dependencyPackageInfo = packages[dependencyName];
            packageDependencies[dependencyName] = "^" + dependencyPackageInfo.packageJson.version;
        }
    }

    protected trimPackageJson(packageJson: any) {
        // Remove stuff not needed in "binary" packge
        // TODO: remove everything except known keys
        delete packageJson.scripts;
        delete packageJson.blerf;
        delete packageJson.devDependencies;
    }

    protected abstract async processPackage(packagePath: string, packageJson: any, packages: PackagesType): Promise<void>;
}
