# SPECTRE

**Zero-Knowledge Privacy Protocol on Solana**

Break every on-chain link. Deposit, shield, and withdraw SOL with complete unlinkability using Groth16 zkSNARKs and Spectre commitment trees.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SPECTRE PROTOCOL                      │
├──────────────┬──────────────┬──────────────┬─────────────┤
│  On-Chain    │  Circuits    │  Relayer     │  Frontend   │
│  Program     │  (circom)    │  (Node.js)   │  (HTML/JS)  │
│              │              │              │             │
│  - Deposit   │  - Spectre   │  - WebSocket │  - Wallet   │
│  - Withdraw  │    Hash      │  - TX Submit │    Connect  │
│  - Merkle    │  - Merkle    │  - Proof     │  - Deposit  │
│    Tree      │    Inclusion  │    Relay     │  - Withdraw │
│  - Nullifier │  - Nullifier │              │  - Notes    │
│    Registry  │    Check     │              │             │
└──────────────┴──────────────┴──────────────┴─────────────┘
```

## Status

**Network:** Solana Devnet
**Stage:** Testnet / Development

## Quick Start

### Prerequisites

- Rust 1.70+
- Solana CLI 1.18+
- Anchor 0.30+
- Node.js 18+
- circom 2.1+
- snarkjs 0.7+

### 1. Clone & Install

```bash
git clone https://github.com/spectre-protocol-dev/spectre-protocol.git
cd spectre-protocol
npm install
```

### 2. Build Circuits

```bash
cd circuits
chmod +x build.sh
./build.sh
```

This compiles the circom circuit, runs the trusted setup (Powers of Tau + Groth16), and exports the verification key.

### 3. Generate Verifier

```bash
node scripts/gen_verifier.js
```

Converts the verification key to a Rust module for on-chain verification.

### 4. Build & Deploy Program

```bash
anchor build
anchor deploy --provider.cluster devnet
```

Update `PROGRAM_ID` in `Anchor.toml` and `lib.rs` with the deployed address.

### 5. Start Relayer

```bash
cd relayer
npm install
cp .env.example .env
# Edit .env with your keys
npm start
```

### 6. Launch Frontend

Serve `app/index.html` or deploy to any static hosting (Vercel, Netlify, Render).

## Protocol Specification

### Deposit Flow

1. User generates random `secret` (31 bytes) and `nullifier` (31 bytes)
2. Commitment = `SpectreHash(nullifier, secret)`
3. User sends deposit TX with commitment + SOL amount
4. Program inserts commitment into on-chain Merkle tree (depth 20)
5. User saves their note: `spectre-{amount}-{secret}-{nullifier}` (base64)

### Withdrawal Flow

1. User reconstructs commitment from their note
2. Client generates Groth16 proof proving:
   - Knowledge of `(secret, nullifier)` such that `SpectreHash(nullifier, secret)` is in the Merkle tree
   - The nullifier hash hasn't been used before
3. Proof + public signals sent to relayer via WebSocket
4. Relayer submits withdrawal TX to the program
5. Program verifies proof on-chain, checks nullifier, sends SOL to recipient

### Key Parameters

| Parameter | Value |
|-----------|-------|
| Proof System | Groth16 |
| Curve | BN254 |
| Hash Function | Spectre Hash (SNARK-optimized) |
| Merkle Tree Depth | 20 |
| Max Deposits | 1,048,576 |
| Root History | 30 |
| Relayer Fee | 0.15% + 0.005 SOL gas |

## Project Structure

```
spectre-protocol/
├── programs/
│   └── spectre/
│       └── src/
│           ├── lib.rs          # Main program (deposit, withdraw, verify)
│           ├── merkle.rs       # Spectre commitment tree implementation
│           ├── verifier.rs     # Groth16 proof verifier
│           └── vk.rs           # Verification key (generated)
├── circuits/
│   ├── spectre.circom          # Main circuit
│   └── build.sh                # Circuit build + trusted setup
├── relayer/
│   ├── index.ts                # WebSocket relayer server
│   ├── package.json
│   └── .env.example
├── scripts/
│   ├── deposit.js              # CLI deposit script
│   ├── withdraw.js             # CLI withdraw script
│   └── gen_verifier.js         # Generate Rust verifier from zkey
├── app/
│   └── index.html              # Frontend application
├── tests/
│   └── spectre.test.ts         # Anchor integration tests
├── docs/
│   └── whitepaper.md           # Protocol whitepaper
├── Anchor.toml
├── Cargo.toml
├── package.json
└── README.md
```

## Security

This protocol is in **testnet/development** stage. Do NOT use with real funds.

- Smart contract has not been audited
- Trusted setup is for development only (not production ceremony)
- Relayer is centralized (single operator)

## License

MIT

## Links

- Website: [spectre.cash](https://spectre.cash)
- Twitter: [@specabordar](https://x.com/)
- Docs: [spectre.cash/docs](https://spectre.cash/docs)
