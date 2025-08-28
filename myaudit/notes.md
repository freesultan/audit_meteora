## TEST

User 'anchor test tests/yourtest.tests.ts' instead of 'pnpm test'
add 'rust_log=error' or 'info' or 'debug' or 'warning' to change the debugging logs

```
test = "RUST_LOG=ERROR yarn run ts-mocha -p ./tsconfig.json -t 1000000 --reporter spec tests/**/*.ts"

```