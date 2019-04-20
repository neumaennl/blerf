import * as childProcess from 'child_process';
import { PackageEnumerator, PackagesType } from "../packageEnumerator";

export class RunEnumerator extends PackageEnumerator {

    private argv: string[];

    constructor(rootPath: string, argv: string[]) {
        super(rootPath);
        this.argv = argv;
    }

    protected async processPackage(packagePath: string, packageJson: any, packages: PackagesType): Promise<void> {
        if (!packageJson.scripts[this.argv[0]]) {
            console.log("blerf: Skipping " + packagePath + ". No script '" + this.argv[0] + "'");
            return;
        }

        childProcess.execSync("npm run " + this.argv.join(" "), {stdio: 'inherit', cwd: packagePath});
    }
}
