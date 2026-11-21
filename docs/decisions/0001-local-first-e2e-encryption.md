# 0001. Local-first with end-to-end encryption

## Context
The app holds purchase dates, costs and notes for a self-custody holder. People who hold their own coins do not want a company, or a hosting account, able to read that. They still want it on a phone and a computer.

## Decision
Entries are created, replayed and read on the device. They are sealed with AES-256-GCM before they leave it. A small server, run by the owner, only stores and forwards sealed blobs. Each device keeps a full local copy and works offline. The app has no accounts and no analytics. The only third-party request is the public BTC price.

## Consequences
- A leaked server or backup shows ciphertext, padded sizes and write timing ([SECURITY.md](../../SECURITY.md)).
- All logic runs in the client, so the engine is pure TypeScript with no I/O.
- The server cannot search, repair or migrate data. Format changes are made by new entry versions and client code.
- Lost keys mean lost records, so recovery has to be designed carefully (0004, 0005).
- As with any web app, whoever serves the code could ship a malicious version (0006).
