import * as fs from 'fs';
import * as path from 'path';
import { toposort } from './toposort';

export type PackageInfoType = { packagePath: string, packageJson: any };
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
            if (!fs.existsSync(packageJsonPath)) {
                continue;
            }

            const packageJson = this.readPackageJson(packageJsonPath);
            if (!packageJson.name) {
                console.log("blerf:", packageJsonPath, "does not have a name");
                continue;
            }

            nodes.push(packageJson.name);

            packages[packageJson.name] = {
                packageJson: packageJson,
                packagePath: packagePath
            };
        }

        for (let packageName of nodes) {
            const packageInfo = packages[packageName];
            const packageJson = packageInfo.packageJson;

            if (packageJson.dependencies) {
                for (let dependencyName of Object.keys(packageJson.dependencies)) {
                    const ref = packageJson.dependencies[dependencyName];
                    if (ref.startsWith("file:") && nodes.indexOf(dependencyName) !== -1) {
                        edges.push([dependencyName, packageJson.name])
                    }
                }
            }

            if (packageJson.devDependencies) {
                for (let dependencyName of Object.keys(packageJson.devDependencies)) {
                    const ref = packageJson.devDependencies[dependencyName];
                    if (ref.startsWith("file:") && nodes.indexOf(dependencyName) !== -1) {
                        edges.push([dependencyName, packageJson.name])
                    }
                }
            }
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

    protected readPackageJson(packageJsonPath: string) {
        return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
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

    protected abstract async processPackage(packagePath: string, packageJson: any, packages: PackagesType): Promise<void>;
}
