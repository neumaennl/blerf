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
        console.log("blerf: packing and patching", packageJson.name);
        childProcess.execSync("npm pack", {stdio: 'inherit', cwd: packagePath});

        const sourcePackageTarPath = path.join(packagePath, this.packageNameToFileName(packageJson.name) + "-" + packageJson.version + ".tgz");
        const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "blerf-"));
        const artifactPackTarPath = path.join(this.artifactPackPath, this.packageNameToFileName(packageJson.name) + "-" + packageJson.version + ".tgz");

        fs.mkdirSync(this.artifactPackPath, { recursive: true });

        try {
            tar.extract({ file: sourcePackageTarPath, cwd: tempPath, sync: true });

            const packageJsonPath = path.join(tempPath, "package", "package.json");
            const packageJson = this.readPackageJson(packageJsonPath);
            if (this.isDeploy) {
                const artifactPackFullPath = path.resolve(this.artifactPackPath);
                this.rewriteProjectReferencesFullPathVersion(artifactPackFullPath, packageJson.dependencies, packages);
                this.rewriteProjectReferencesFullPathVersion(artifactPackFullPath, packageJson.devDependencies, packages);
                fs.copyFileSync(path.join(packagePath, "package-lock.json"), path.join(tempPath, "package", "package-lock.json"));
            } else {
                this.rewriteProjectReferencesVersion(packageJson.dependencies, packages);
                this.rewriteProjectReferencesVersion(packageJson.devDependencies, packages);
            }

            this.trimPackageJson(packageJson);
            fs.writeFileSync(packageJsonPath, stringifyPackage(packageJson), 'utf8');
            tar.create({ file: artifactPackTarPath, cwd: tempPath, gzip: true, sync: true, }, ["package"]);
        } finally {
            fs.unlinkSync(sourcePackageTarPath);
            this.rimraf(tempPath);
        }
    }
}
