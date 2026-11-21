# 0002. No database: append-only objects in R2

## Context
The server only has to hold ciphertext in order. A database adds a schema, migrations, an admin surface and a way to overwrite data. A personal instance must fit in free tiers.

## Decision
Use R2 objects. Every write is "put only if new" (`etagDoesNotMatch: '*'`). Blobs get keys `e/<server ms>-<random>`, so listing is ordered. The Worker has no delete or overwrite code path, and a test scans the source for one. A second bucket gets a daily copy under `vault/<id>/` and carries an R2 bucket lock. Spent challenge and session markers expire through R2 lifecycle rules, not Worker code.

## Consequences
- Even a compromised Worker cannot erase history; the backup cannot be deleted during its retention.
- Races are settled by only-if-new writes (two setups, two rotations: one wins).
- Nothing can be repaired through the API. Half-written states after an outage are fixed by hand, and the docs say how.
- Listing is by key order, with a ten-minute overlap and periodic full compares because upload time and key time can differ.
- Old data stays forever, which shapes rotation (0005).
