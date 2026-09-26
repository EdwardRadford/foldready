// Formatting rules for anything written from here on. printWidth is 120 because that is what
// the existing source already uses; the defaults would rewrap most of it for no reason.
//
// The tree is NOT prettier-clean yet. Running `npm run format` over it rewrites nearly every
// file, which would be one large commit of pure noise sitting on top of the real history — so
// the config is declared and the sweep is left as a deliberate, separate decision.
//
// There is no eslint here, unlike foldready-engine: this repo is on TypeScript 7.0 and
// typescript-eslint refuses to load against it (typescript-eslint#10940). It goes in as soon as
// that lands rather than pinning a second compiler just to satisfy a linter.
export default {
  printWidth: 120,
  singleQuote: true,
  semi: true,
  tabWidth: 2,
  trailingComma: 'all',
  arrowParens: 'always',
};
