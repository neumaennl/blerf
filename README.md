# blerf

Monorepo for blerf, a monorepo tool.

See [packages/blerf](packages/blerf)

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
