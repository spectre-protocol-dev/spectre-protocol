# SPECTRE: Zero-Knowledge Privacy Protocol on Solana

**Version 0.1 — March 2026**

## Abstract

SPECTRE is a non-custodial privacy protocol on Solana that enables fully private SOL transfers using Groth16 zkSNARKs and Spectre commitment trees. Users deposit SOL into a shielded pool and can later withdraw to any address without creating an on-chain link between the deposit and withdrawal. The protocol uses a relayer network to submit withdrawal transactions, ensuring complete sender-recipient unlinkability.

## 1. Motivation

All transactions on Solana are publicly visible. Wallet balances, transaction histories, DeFi activity, and NFT holdings can be traced and correlated by anyone with access to an explorer or analytics tool. This transparency creates risks: financial surveillance, front-running, targeted phishing, and loss of competitive advantage for traders and institutions.

SPECTRE addresses this by providing a shielded transfer mechanism that breaks the on-chain link between source and destination addresses while maintaining full verifiability through zero-knowledge proofs.

## 2. Protocol Design

### 2.1 Core Components

The protocol consists of four components:

- **On-Chain Program**: Anchor-based Solana program managing the deposit pool, Merkle tree, and nullifier registry
- **ZK Circuits**: circom circuits implementing SNARK-optimized hashing and Merkle proof verification
- **Relayer**: WebSocket service that submits withdrawal transactions on behalf of users
- **Client**: Browser-based interface for generating proofs and managing notes

### 2.2 Cryptographic Primitives

| Primitive | Choice | Rationale |
|-----------|--------|-----------|
| Proof System | Groth16 | Constant-size proofs, fast on-chain verification |
| Curve | BN254 (alt_bn128) | Solana precompile support, well-studied security |
| Hash Function | SNARK-optimized | SNARK-friendly, minimal constraints (~300 per hash) |
| Merkle Tree | Incremental (depth 20) | Supports 1M+ deposits, O(depth) insertions |

### 2.3 Deposit

1. User generates random `secret` (31 bytes) and `nullifier` (31 bytes)
2. Commitment `C = SpectreHash(nullifier, secret)` is computed client-side
3. User submits a deposit transaction containing `C` and the denomination amount
4. The program inserts `C` into the incremental Merkle tree
5. User saves their **note** containing `(secret, nullifier, amount)` encoded in base64

### 2.4 Withdrawal

1. User reconstructs `C` from their note
2. Client fetches the current Merkle tree state and constructs a proof path
3. Client generates a Groth16 proof demonstrating:
   - Knowledge of `(secret, nullifier)` such that `SpectreHash(nullifier, secret)` is a valid leaf
   - The computed root matches a known historical root
   - The nullifier hash `H = SpectreHash(nullifier)` is correctly computed
4. Proof is sent to the relayer via WebSocket
5. Relayer submits the withdrawal transaction to the on-chain program
6. Program verifies the proof, checks the nullifier hasn't been spent, and transfers SOL

### 2.5 Nullifier System

Each deposit can only be withdrawn once. The nullifier hash `H = SpectreHash(nullifier)` is stored on-chain when a withdrawal occurs. Any subsequent attempt to use the same nullifier is rejected. Crucially, `H` does not reveal which deposit it corresponds to.

### 2.6 Relayer Model

The relayer provides sender-recipient unlinkability by submitting withdrawal transactions on behalf of users. The relayer:

- Cannot steal funds (withdrawal address is baked into the ZK proof)
- Cannot censor specific users (multiple relayers can operate)
- Charges a fee: 0.15% (15 bps) + 0.005 SOL gas buffer

## 3. Security Properties

### 3.1 Privacy

An observer seeing the on-chain transactions can determine:
- That a deposit of X SOL was made (but not by whom, if a fresh wallet is used)
- That a withdrawal of X SOL occurred to address Y
- That a valid ZK proof was submitted

An observer **cannot** determine:
- Which deposit corresponds to which withdrawal
- The identity of the depositor from the withdrawal
- Any relationship between deposit and withdrawal addresses

### 3.2 Soundness

The Groth16 proof system guarantees computational soundness: no computationally bounded adversary can create a valid proof for a non-existent deposit or a spent nullifier.

### 3.3 Non-Custodial

At no point does any party (including the relayer) have custody over user funds. SOL is held in a program-derived address (PDA) controlled by the on-chain program. Withdrawals require a valid ZK proof that only the note holder can generate.

## 4. Parameters

| Parameter | Value |
|-----------|-------|
| Tree Depth | 20 |
| Max Deposits | 1,048,576 |
| Root History Buffer | 30 |
| Denominations | 1, 5, 10, 100 SOL |
| Proof Size | ~256 bytes (A + B + C) |
| Verification Gas | ~1.3M compute units |
| Relayer Fee | 15 bps + 0.005 SOL |

## 5. Comparison

| Feature | SPECTRE | Tornado Cash | Privacy Cash |
|---------|---------|-------------|-------------|
| Chain | Solana | Ethereum | Solana |
| Proof System | Groth16 | Groth16 | Groth16 |
| Hash | SNARK-optimized | MiMC/Pedersen | Poseidon |
| Finality | <1s | ~12s | <1s |
| TX Cost | ~0.005 SOL | ~0.01 ETH | ~0.005 SOL |
| Denominations | 4 fixed | 4 fixed | Variable |

## 6. Roadmap

### Phase 1: Devnet (Current)
- Core protocol deployed on devnet
- Single relayer operation
- CLI + web interface
- Basic denominations

### Phase 2: Mainnet Beta
- Security audit
- Multi-relayer network
- SPL token support (USDC, USDT)
- Enhanced anonymity set analytics

### Phase 3: Full Launch
- Governance token
- Decentralized relayer incentives
- Cross-chain bridge integration
- Mobile wallet support

## 7. Risks & Disclaimers

- The protocol is in development and has **not been audited**
- The trusted setup is for development purposes only
- Regulatory status of privacy protocols varies by jurisdiction
- Users are responsible for compliance with local laws
- Loss of the secret note means permanent loss of funds

## 8. References

1. Groth, J. (2016). On the Size of Pairing-based Non-interactive Arguments
2. Grassi, L. et al. (2019). SNARK-Friendly Hash Functions for Zero-Knowledge Proof Systems
3. Ben-Sasson, E. et al. (2014). Succinct Non-Interactive Zero Knowledge for a von Neumann Architecture
4. Solana Foundation. Solana Program Library Documentation
