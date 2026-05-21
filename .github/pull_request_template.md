## Summary

<!-- One sentence: what does this PR do and why? -->

## Type of change

- [ ] Bug fix
- [ ] New feature — HK-ID assigned: ___
- [ ] Documentation only
- [ ] Refactor / performance
- [ ] Test addition or improvement
- [ ] CI / tooling

## Safety checklist

- [ ] Every DELETE/PATCH call is wrapped in `if (!DRY_RUN)`
- [ ] `keepCountFloor()` is called before any `keep_count` comparison
- [ ] Age filter is applied **before** `.slice(keepCount)` — not after
- [ ] Active/live deployment exclusion is preserved
- [ ] Each new account-level operation is wrapped in `try/catch`

## Testing

- [ ] `NODE_ENV=test node --test test/cleanup.test.js` passes
- [ ] `npx eslint@9 src/cleanup.js` passes
- [ ] Manually tested with `DRY_RUN=true`

## Documentation

- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] `README.md` parameter table updated (if new `ACCOUNTS_JSON` keys added)
- [ ] `CLAUDE.md` section map updated (if function locations changed)
- [ ] New HK-ID added to header comment in `cleanup.js` and to `CLAUDE.md` HK Feature Map
