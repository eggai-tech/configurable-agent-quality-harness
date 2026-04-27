# Releasing @eggai-tech/mo

Manual publish to npmjs.com, from the repo root.

## One-time setup

1. Ensure the `@eggai-tech` scope exists on npmjs.com and your account is a member.
2. Authenticate locally:

   ```sh
   npm login --scope=@eggai-tech --registry=https://registry.npmjs.org/
   ```

   or drop an automation token into `~/.npmrc`:

   ```
   //registry.npmjs.org/:_authToken=<token>
   ```

## Cutting a release

From the repo root:

```sh
# 1. Build from a clean tree.
pnpm --filter @eggai-tech/mo build

# 2. Bump the version (creates a commit + a git tag).
pnpm --filter @eggai-tech/mo version patch     # or minor / major

# 3. Publish (runs `prepublishOnly` which rebuilds).
pnpm --filter @eggai-tech/mo publish --access public

# 4. Push the bump commit + tag.
git push --follow-tags
```

`pnpm publish` automatically rewrites `workspace:*` dependencies in the published tarball, so inside this monorepo wally keeps resolving from local source while external consumers resolve from the registry.

## Sanity-check what goes into the tarball

Before publishing, inspect the contents:

```sh
cd mo
pnpm pack --dry-run
```

Only `dist/`, `README.md`, `LICENSE`, and `package.json` should be listed. No `src/`, no tests, no `node_modules`.
