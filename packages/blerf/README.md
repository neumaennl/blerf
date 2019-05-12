# blerf

Build tool for nodejs monorepos working alongside npm. Helps manage multiple projects in a solution. Intended for (but probably not limited to) TypeScript development.

## Features

- Monorepo tool: Run npm scripts in multiple projects, in topological order
- Build system: Run build steps only when something changed
- Dependency management: Run `npm install` as part of the build only when something changed
- Project dependencies: Install the build output of local projects
- Artifacts: Run `npm pack` in multiple projects and fix up local project references
- Run tests with native V8 code coverage

## Commands

### `blerf build`

Installs dependencies, executes any build steps and creates a tarball for each directory under ./packages containing a package.json.

Dependencies are skipped if there are no changes. Regular dependencies are checked if the installed version matches the declared semver range. Project dependencies are checked if the tarball timestamp is newer than the installed module directory. If the tarball has changed, the project is removed from node_modules and package-lock before reinstalling. Uses `npm install` under the hood.

Build steps are specified in package.json. Build steps are skipped if there are no changes in the filesystem based on the glob patterns in `srcPath` and `outPath`. The code in `script` is spawned similar to npm scripts, where the PATH environment variable is modified to include node_modules/.bin.

After a project builds successfully, a tarball is created in created in ./artifacts/build. The final tarballs will have fixed project references with absolute paths to the corresponding build output. Uses `npm pack` under the hood.

### `blerf pack:publish`

Creates tarballs for each directory under ./packages containing a package.json. The output  *.tgz files are located in ./artifacts/publish and are suitable for publishing to a registry. 

Uses `npm pack` under the hood. The final tarballs will have fixed project references pointing to their corresponding version number with a ^-modifier.

### `blerf pack:deploy`

Creates standalone tarballs for each directory under ./packages containing a package.json. The output *.tgz files are located in ./artifacts/deploy and are suitable for application deployments.

Uses `npm pack` and `npm install` under the hood. The final tarballs will have all dependencies included.

### `blerf test`

Executes `npm run test` in each directory under ./packages containing a package.json having a test script. If `coverageFrom` is set to a valid path, code coverage information will be collected and reported using Node's built-in `NODE_V8_COVERAGE` coverage facilities, with source map support. The built-in code coverage requires Node 10.12 or newer, and a test runner which does not transform/wrap the source code.

Example blerf section in package.json enabling coverage on files in a sibling project:

```json
"blerf": {
    "coverageFrom": "../lib-a"
}
```

### `blerf run [xxx]`

Executes `npm run [xxx]` in each directory under ./packages containing a package.json having a corresponding script.

## Solution structure and conventions

Basic conventions and guidelines:

- Create a root package.json with a dependency on blerf and scripts to build, test, pack and deploy
- Create new projects in directories under ./packages
- Create test projects separately under ./packages
- Add project references as `file:../../artifacts/build/(projectname).tgz` dependencies in package.json
- Add npm package references as dependencies by editing package.json manually
- Bootstrap the repo once with `npm install`, then use `blerf build` to install dependencies and build the solution
- Edit-compile-run cycle

## Release workflow

- Bump, build, test, tag, commit and push latest version using regular blerf, git and npm cli commands
- Use `blerf pack:publish` instead of `npm pack` to create tarball(s)
- Use `npm login` / `npm publish`

## Project dependencies

Any dependencies starting with `file:` is assumed to be a project reference, and must point at the corresponding tarball from the build output. The project reference must be formatted like `file:../../artifacts/build/(projectname).tgz`. The project name must be the same as the dependency name.

`blerf build` automatically detects changes in project dependencies, and automates all steps necessary to reinstall with npm.

The following conditions are handled:

|Condition|Action(s)|
|-|-|-|
|Project reference code changes.<br>No project reference dependency changes.<br>No local dependency changes.| *fast refresh*|
|Project reference dependency changes.<br>No local dependency changes.|`npm install <project names...>`|
|Project reference dependency changes.<br>Local dependency changes.|`npm uninstall <project names...>`<br>`npm install`|
|No project reference dependency changes.<br>Local dependency changes.|`npm install`|
|No project reference code changes.<br>No project reference dependency changes.<br>No local dependency changes.|*no operation*|

Fast refresh replaces the installed project references directly. Fast refresh does not invoke `npm`.

## Build steps

Example blerf section in package.json with a build step for TypeScript:

```json
"blerf": {
    "steps": [
        {
            "outPath": "lib/**/*.js",
            "srcPath": [ "src/**/*.ts", "tsconfig.json", "package.json"],
            "script": "tsc"
        }
    ]
}
```

The values for outPath and srcPath must match the tsconfig.json compiler options.
