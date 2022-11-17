import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import { PackageEnumerator, PackagesType } from "../packageEnumerator";
const tar = require('tar')

export class BundleEnumerator extends PackageEnumerator {
    private artifactPackPath: string;
    private artifactDeployPath: string;

    constructor(rootPath: string, artifactPackPath: string, artifactDeployPath: string) {
        super(rootPath);
        this.artifactPackPath = artifactPackPath;
        this.artifactDeployPath = artifactDeployPath;
    }

    public async enumeratePackages(): Promise<void> {
        await super.enumeratePackages();

        // Remove artifacts/deploy-temp created by PackEnumerator
        this.rimraf(this.artifactPackPath);
    }

    protected async processPackage(packagePath: string, packageJson: any, packages: PackagesType): Promise<void> {
        console.log("blerf: bundling", packageJson.name);
        const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "blerf-"));
        const artifactPackTarPath = path.join(this.artifactPackPath, this.packageNameToFileName(packageJson.name) + "-" + packageJson.version + ".tgz");
        const artifactTarPath = path.join(this.artifactDeployPath, this.packageNameToFileName(packageJson.name) + "-" + packageJson.version + ".tgz");

        fs.mkdirSync(this.artifactDeployPath, { recursive: true });

        try {
            tar.extract({ file: artifactPackTarPath, cwd: tempPath, sync: true });
            childProcess.execSync("npm install", {stdio: 'inherit', cwd: path.join(tempPath, "package") });

            tar.create({ file: artifactTarPath, cwd: tempPath, gzip: true, sync: true, }, ["package"]);
        } finally {
            this.rimraf(tempPath);
        }
    }
}
