# 0005. Data-key epochs for recovery-code rotation

## Context
Storage is append-only and the backup is locked, so an old recovery wrapping can never be erased. If rotation re-wrapped the same data key, someone holding the old code and a copy of the server would still open everything, forever, including new data. An earlier design had exactly this flaw; a security review found it.

## Decision
Data keys come in epochs. Rotation makes a new data key `DK_{n+1}`, delivers it to every registered passkey by ECDH, wraps it under the new code, and stores the older keys sealed under the new one. The server accepts uploads only for the current epoch. Each rotation re-binds every passkey under the new key, so a passkey record planted with an old key gets nothing. Devices refuse blobs sealed under an old key that appear after they learned of a newer epoch.

## Consequences
- The old code cannot read anything written after a rotation.
- Data written before a rotation stays readable to old code plus a server or backup copy. This cannot be fixed with append-only storage, and is documented.
- Passkeys cannot be removed yet; choosing which passkeys receive the new key is planned.
- More protocol and more tests: see [sync-protocol.md](../sync-protocol.md).
