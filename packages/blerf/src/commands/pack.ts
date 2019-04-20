import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import { PackageEnumerator, PackagesType } from "../packageEnumerator";
const stringifyPackage = require("stringify-package");
const tar = require('tar')

export class PackEnumerator extends PackageEnumerator {
    private isDeploy: boolean;

    constructor(rootPath: string, isDeploy: boolean) {
        super(rootPath);
        this.isDeploy = isDeploy;
    }

    protected async processPackage(packagePath: string, packageJson: any, packages: PackagesType): Promise<void> {
        childProcess.execSync("npm pack", {stdio: 'inherit', cwd: packagePath});

        console.log("blerf: patching project references");

        // NOTE: assuming file name of tarball; can also get it from the output of npm pack
        const sourcePackageTarPath = path.join(packagePath, packageJson.name + "-" + packageJson.version + ".tgz");
        const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "blerf-"));

        try {
            tar.extract({ file: sourcePackageTarPath, cwd: tempPath, sync: true });
            this.patchPackageJson(packagePath, path.join(tempPath, "package", "package.json"), packages);
            tar.create({ file: sourcePackageTarPath, cwd: tempPath, gzip: true, sync: true, }, ["package"]);
        } finally {
            this.rimraf(tempPath);
        }
    }

    updateDependencyVersions(packagePath: string, packageDependencies: any, packages: PackagesType) {
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
                    packageDependencies[dependencyName] = dependencyPackageInfo.packageJson.name + "-" + dependencyPackageInfo.packageJson.version + ".tgz";
                } else {
                    packageDependencies[dependencyName] = dependencyPackageInfo.packageJson.version;
                }
            } else {
                // TODO: possibly noop instead?
                throw new Error("Expected file:-based reference to a project under ./packages: " + ref);
            }
        }
    }
    
    private patchPackageJson(packagePath: string, packageJsonPath: string, packages: PackagesType) {
        // Resolve all file:-based dependencies to explicit versions
        const packageJson = this.readPackageJson(packageJsonPath);
        this.updateDependencyVersions(packagePath, packageJson.dependencies, packages);
        this.updateDependencyVersions(packagePath, packageJson.devDependencies, packages);
        fs.writeFileSync(packageJsonPath, stringifyPackage(packageJson), 'utf8');
    }

}
