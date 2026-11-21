# 0007. Amounts shown by default

## Context
A hide-amounts mode protects against shoulder surfing. The first design hid amounts by default. The owner reversed that (commit `631d4ef`): masked numbers by default get in the way of a tool whose job is checking figures.

## Decision
Amounts are shown by default. Hiding is the user's choice, remembered per device. Everything that shows balances, cost, gain or income goes through `<Money>` and `<Amount>` so the mask is complete (a review found it leaking average cost, which was fixed). Holding a masked value, or the eye button, shows everything until release. The public BTC price is never masked.

## Consequences
- Easier to use and to check numbers; less private in public by default.
- [SECURITY.md](../../SECURITY.md) treats shoulder surfing as opt-in protection.
- New screens must use the shared components ([design.md](../design.md), rule 5).
