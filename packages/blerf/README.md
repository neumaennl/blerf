# blerf

Opinionated build tool for nodejs monorepos working alongside npm. Helps manage multiple projects in a solution. Intended for (but probably not limited to) TypeScript development.

## Features

- Monorepo tool: Run npm scripts in multiple projects, in topological order
- Build system: Run build steps only when something changed
- Dependency management: Run `npm install` as part of the build only when something changed
- Artifacts: Run `npm pack` in multiple projects and fix up local project references
- Run tests with native V8 code coverage

## Commands

`blerf build`

In each directory under ./packages containing a package.json, first runs `npm install` if any of the top level dependencies are missing, and then executes any build steps. A build step is skipped if there are no changes in the filesystem based on the glob patterns in `srcPath` and `outPath`. The code in `script` is spawned similar to npm scripts, where the PATH environment variable is modified to include node_modules/.bin.

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

`blerf pack:publish`

Executes `npm pack` in each directory under ./packages containing a package.json and fixes up any project references in the tarballs. This extracts each tarball to a temp directory, changes any `file:` based dependencies in package.json to their corresponding version, updates the tarball and cleans up.

`blerf test`

Executes `npm run test` in each directory under ./packages containing a package.json having a test script. If `coverageFrom` is set to a valid path, code coverage information will be collected and reported using Node's built-in `NODE_V8_COVERAGE` coverage facilities, with source map support. The built-in code coverage requires Node 10.12 or newer, and a test runner which does not transform/wrap the source code.

Example blerf section in package.json enabling coverage on files in a sibling project:

```json
"blerf": {
    "coverageFrom": "../lib-a"
}
```

`blerf run [xxx]`

Executes `npm run [xxx]` in each directory under ./packages containing a package.json having a corresponding script.

## Solution structure and conventions

Basic conventions and guidelines:

- Create a root package.json with a dependency on blerf and scripts to build, test, pack and deploy
- Create new projects in directories under ./packages
- Create test projects separately under ./packages
- Add project references as dependencies using relative `file:` references in package.json

## Release workflow

- Bump, build, test, tag, commit and push latest version using regular blerf, git and npm cli commands
- Use `blerf pack:publish` instead of `npm pack` to create tarball(s)
- Use `npm login` / `npm publish`
