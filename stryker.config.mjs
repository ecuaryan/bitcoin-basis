// Mutation testing for the calculation engine: `npm run mutate` (slow, ~10 min cold; incremental after that).
// Not part of `npm run check` or CI. HTML report: engine/reports/mutation/index.html.
//
// Why StringLiteral mutants are excluded: error and message text is for people, not a contract, and string-typed
// discriminants (kinds, codes, terms) are already covered by the TypeScript checker, which kills those mutants.
//
// Equivalent mutants that survive by design (no behavior to test), for the money / tax / loans core:
//   money.ts       divRoundHalfUp: `d <= 0n` (d is never 0 there), `n <= 0n` (-0n is 0n).
//   tax/tax.ts     max/min with `>=` / `<=` (same value on a tie); `net <= 0` for lossDeduction/included (net 0 gives 0);
//                  `net >= 0`, `lt >= 0` for preferential (a zero adds nothing); the `table.year <= input.year` note
//                  (a fall-back year never equals the table year); `core.state + none.state` (the wages-only state tax is 0);
//                  marginalRates `here.lt === 0` -> true (a zero short-term rate with a non-zero long-term one cannot occur).
//   tax/tables     `year <= earliest.year` (equal year is not a fall-back); empty STATUTORY_SOURCES is caught by the
//                  length test, the rest of that file is URLs/titles (strings).
//   picks.ts       splitCost `sats === lotSats` shortcut (the mulDiv gives the same cost); withProceeds `>` vs `>=`
//                  at the giver's cost (both give cost = proceeds); gainPerSat `>=`/`<=` ties (gain is 0 either way).
//   handlers.ts    applyMove: the filter on moved sats and the `sats === 0` early return only skip lots a later
//                  step ignores anyway (empty lots are dropped; colons in entry ids are rejected by validation).
//   trace.ts       `gone.some(closed-out) ? recoveries : []` -> always: other coins' recoveries add nothing for them.
//   loan-book.ts   nameKey toLowerCase -> toUpperCase (both fold case).
//   loans.ts       splitByWeights tie-break comparator forms; windowWeights `r.cents >= owed` and the `while` bounds;
//                  repaymentsOf / estimateLoanInterest filters (days past the window never reach it); satsFor `<= 0`
//                  (amounts are never negative; 0 gives 0); `end >= lastCut` (Set removes the duplicate);
//                  estimateLoanInterest `fromDate > throughDate` (an inverted window is empty anyway).
//   versions.ts    empty-array fallbacks in walletsUsed / loansUsed / lockedYears (a bogus name never matches);
//                  `ev.id <= asOf` (an event is never the entry it locks); `seen` seeds; `.sort(byId)` in passes whose
//                  results are re-sorted or order-independent; `lockedYears(f, true)` for freezes (asTarget only
//                  matters for opening lots); `kids.length === 0` and `live.length >= 1` (handled just above);
//                  `replaced` set entries (an extra `undefined`); idOf `typeof raw === 'object'` (the next test rejects).
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.engine.config.ts' },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.stryker.json',
  mutate: ['engine/src/**/*.ts', '!engine/src/index.ts', '!engine/src/types.ts'],
  mutator: { excludedMutations: ['StringLiteral'] },
  incremental: true,
  incrementalFile: 'engine/.stryker-incremental.json',
  concurrency: 6,
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'engine/reports/mutation/index.html' },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  timeoutMS: 10000,
  warnings: { slow: false },
};
