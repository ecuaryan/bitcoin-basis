# 0008. Integer money

## Context
Floating point cannot add back exactly, and tax records must. Splitting a lot across several sales, moves and fees must never create or lose a cent or a sat.

## Decision
BTC is whole sats, dollars are whole cents, both safe integers. Products such as cents times sats can exceed 2^53, so one helper, `mulDivRoundHalfUp`, does proportional math with `BigInt`. Rounding is half away from zero, symmetric for negatives. A split gives the remainder to the last piece, so parts always add back to the whole. Replay keeps running totals and refuses an entry that would push them past 2^52 (`out-of-range`). Figures that cannot be represented exactly are `null` and shown as a dash. Whole-dollar display rounds toward zero, so a gain is never overstated. Inputs are parsed from text, never through floats.

## Consequences
- Property tests can assert exact conservation: sats and cost in equal sats and cost held plus disposed.
- Every worked example in the [engine spec](../engine-spec.md) matches to the cent.
- Display code needs its own formatting and parsing helpers (`lib/format.ts`).
- Some derived figures, like an average cost per BTC, are `null` at extremes.
