# blerf

Monorepo for blerf, a monorepo tool.

See [packages/blerf](packages/blerf)

[![Build status](https://ci.appveyor.com/api/projects/status/ivy1wa5f6dsmdmym?svg=true)](https://ci.appveyor.com/project/andersnm/blerf)

## Building the source code

Check out and bootstrap the monorepo:

```bash
npm install
```

This installs dependencies for blerf, builds blerf, and then installs blerf in the root project.

After bootstrapping, can build again using the shorthand for `./node_modules/.bin/blerf build`:

```bash
npm run build
```

If for some reason blerf cannot build itself, use `npm install` from the root to build blerf without blerf.
