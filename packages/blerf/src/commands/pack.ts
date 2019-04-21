import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import { PackageEnumerator, PackagesType } from "../packageEnumerator";
const stringifyPackage = require("stringify-package");
const tar = require('tar')

export class PackEnumerator extends PackageEnumerator {
    private isDeploy: boolean;
    private artifactCleanPath: string;
    private artifactPackPath: string;

    constructor(rootPath: string, artifactPath: string, artifactCleanPath: string, isDeploy: boolean) {
        super(rootPath);
        this.isDeploy = isDeploy;
        this.artifactCleanPath = artifactCleanPath;
        this.artifactPackPath = artifactPath;
    }

    public async enumeratePackages(): Promise<void> {
        this.rimraf(this.artifactCleanPath);
        await super.enumeratePackages();
    }

    protected async processPackage(packagePath: string, packageJson: any, packages: PackagesType): Promise<void> {
        childProcess.execSync("npm pack", {stdio: 'inherit', cwd: packagePath});

        console.log("blerf: patching project references");

        // NOTE: assuming file name of tarball; can also get it from the output of npm pack
        const sourcePackageTarPath = path.join(packagePath, packageJson.name + "-" + packageJson.version + ".tgz");
        const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "blerf-"));

        const artifactPackTarPath = path.join(this.artifactPackPath, packageJson.name + "-" + packageJson.version + ".tgz");

        fs.mkdirSync(this.artifactPackPath, { recursive: true });

        try {
            tar.extract({ file: sourcePackageTarPath, cwd: tempPath, sync: true });
            this.patchPackageJson(packagePath, path.join(tempPath, "package", "package.json"), path.resolve(this.artifactPackPath), packages);
            if (this.isDeploy) {
                fs.copyFileSync(path.join(packagePath, "package-lock.json"), path.join(tempPath, "package", "package-lock.json"));
            }
            tar.create({ file: artifactPackTarPath, cwd: tempPath, gzip: true, sync: true, }, ["package"]);
        } finally {
            fs.unlinkSync(sourcePackageTarPath);
            this.rimraf(tempPath);
        }
    }

    updateDependencyVersions(packagePath: string, artifactPackFullPath: string, packageDependencies: any, packages: PackagesType) {
        if (!packageDependencies) {
            return;
        }
    
        for (let dependencyName of Object.keys(packageDependencies)) {
            const ref = packageDependencies[dependencyName];
            if (!ref.startsWith("file:")) {
                continue;
            }
    
            const dependencyPackageInfo = packages[dependencyName];
            if (dependencyPackageInfo) {
                if (this.isDeploy) {
                    packageDependencies[dependencyName] = path.join(artifactPackFullPath, dependencyPackageInfo.packageJson.name + "-" + dependencyPackageInfo.packageJson.version + ".tgz");
                } else {
                    packageDependencies[dependencyName] = "^" + dependencyPackageInfo.packageJson.version;
                }
            } else {
                // TODO: possibly noop instead?
                throw new Error("Expected file:-based reference to a project under ./packages: " + ref);
            }
        }
    }
    
    private patchPackageJson(packagePath: string, packageJsonPath: string, artifactPackFullPath: string, packages: PackagesType) {
        // Resolve all file:-based dependencies to explicit versions
        const packageJson = this.readPackageJson(packageJsonPath);
        this.updateDependencyVersions(packagePath, artifactPackFullPath, packageJson.dependencies, packages);
        this.updateDependencyVersions(packagePath, artifactPackFullPath, packageJson.devDependencies, packages);
        // Remove stuff not needed in "binary" packge
        delete packageJson.scripts;
        delete packageJson.blerf;
        delete packageJson.devDependencies;
        fs.writeFileSync(packageJsonPath, stringifyPackage(packageJson), 'utf8');
    }
}
