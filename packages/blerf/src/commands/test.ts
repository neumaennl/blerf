import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import { PackageEnumerator, PackagesType } from "../packageEnumerator";
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const v8toIstanbul = require('v8-to-istanbul');
const sourceMapResolve = require("source-map-resolve");
const sourceMap = require("source-map");
const libIstanbulSourceMap = require("istanbul-lib-source-maps");

/*
    It's worth noting V8's built-in coverage does not work with Jest for two main reasons:

    1) Jest adds its own wrapper around the source code, offseting the V8 coverage offsets.
    2) Jest transforms all source code and modules by default, offseting the V8 coverage offsets randomly.

    Both can be worked around somewhat, but in the end, it does not seem possible to
    (easily) map the code run by Jest back the original source files from this side of the pipeline.
*/

export class TestEnumerator extends PackageEnumerator {
    constructor(rootPath: string) {
        super(rootPath);
    }

    protected async processPackage(packagePath: string, packageJson: any, packages: PackagesType): Promise<void> {
        if (!packageJson.scripts || !packageJson.scripts["test"]) {
            console.log("blerf: Skipping " + packagePath + ". No test script");
            return;
        }

        const packageCoveragePath = "coverage";
        const localCoveragePath = path.join(packagePath, "coverage");
        const env = this.initCoverage(localCoveragePath, packageCoveragePath);

        childProcess.execSync("npm run test", {stdio: 'inherit', cwd: packagePath, env: env});

        if (packageJson.blerf && packageJson.blerf.coverageFrom) {
            const coverageFrom = path.resolve(packagePath, packageJson.blerf.coverageFrom);
            this.processCoverage(localCoveragePath, coverageFrom);
        }
    }

    initCoverage(localCoveragePath: string, packageCoveragePath: string): any {
        console.log("blerf: using coverage path", localCoveragePath);
        if (fs.existsSync(localCoveragePath)) {
            this.rimraf(localCoveragePath);
        }
    
        fs.mkdirSync(localCoveragePath);
    
        const env: {[key:string]: string} = {};
        for (let envKey of Object.keys(process.env)) {
            const envValue = process.env[envKey];
            if (envValue !== undefined) {
                env[envKey] = envValue;
            }
        }
        
        env["NODE_V8_COVERAGE"] = packageCoveragePath;
        return env;
    }

    processCoverage(coveragePath: string, coverageFrom: string) {
    
        const files = fs.readdirSync(coveragePath);
    
        const map = libCoverage.createCoverageMap({})
        const store = libIstanbulSourceMap.createSourceMapStore();
    
        for (let file of files) {
            const contents = fs.readFileSync(path.join(coveragePath, file), 'utf8');
            const report = JSON.parse(contents);
    
            for (let result of report.result) {
                // non-file urls are internal to node
                if (!result.url.startsWith("file://")) {
                    continue;
                }
    
                const fileName: string = path.resolve(decodeURIComponent(result.url.substr(8)));
    
                if (!fileName.startsWith(coverageFrom)) {
                    continue;
                }

                try {
                    const code = fs.readFileSync(fileName, "utf8");
                    const resolvedSourceMap = sourceMapResolve.resolveSourceMapSync(code, fileName, fs.readFileSync);
                    const script = v8toIstanbul(fileName);
                    script.applyCoverage(result.functions);

                    map.merge(script.toIstanbul());
                    store.registerMap(fileName, resolvedSourceMap.map);
                } catch (e) {
                    console.log("blerf:", e.message);
                }
            }
        }

        const transformedMap = store.transformCoverage(map);
    
        var context = libReport.createContext({
            dir: coveragePath,
        });
    
        // const tree = libReport.summarizers.pkg(map);
        const tree = libReport.summarizers.pkg(transformedMap.map);
    
        const reporter = [ "text", "html" ];
        reporter.forEach(function (_reporter: any) {
            tree.visit(reports.create(_reporter), context)
        });
    }
}
