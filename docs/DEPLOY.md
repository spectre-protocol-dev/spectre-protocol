# SPECTRE Deploy Guide

Step-by-step guide to get SPECTRE running on Solana devnet by Monday.

## Prerequisites (Install First)

### 1. Rust & Cargo
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### 2. Solana CLI
```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Configure for devnet
solana config set --url https://api.devnet.solana.com

# Create wallet (if you don't have one)
solana-keygen new --outfile ~/.config/solana/id.json

# Get devnet SOL
solana airdrop 5
```

### 3. Anchor
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.30.1
avm use 0.30.1
```

### 4. Node.js 18+
```bash
# Use nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

### 5. circom (for ZK circuits)
```bash
git clone https://github.com/iden3/circom.git
cd circom
cargo build --release
cargo install --path circom

# Install snarkjs globally
npm install -g snarkjs
```

---

## Deploy Steps

### Step 1: Clone & Install Dependencies

```bash
git clone https://github.com/YOUR_ORG/spectre-protocol.git
cd spectre-protocol
npm install
```

### Step 2: Build ZK Circuits

```bash
cd circuits
chmod +x build.sh
./build.sh
```

This takes 5-15 minutes depending on your machine. It:
- Compiles the circom circuit (Poseidon hash + Merkle proof)
- Runs the Powers of Tau ceremony
- Generates proving key (zkey) and verification key
- Outputs WASM for client-side proof generation

Expected output:
```
circuits/build/
├── spectre.r1cs
├── spectre_js/
│   └── spectre.wasm          # Client-side proof generation
├── spectre_final.zkey         # Proving key
├── verification_key.json      # Verification key
└── pot_final.ptau             # Powers of Tau
```

### Step 3: Generate On-Chain Verifier

```bash
cd ..
node scripts/gen_verifier.js
```

This converts `verification_key.json` into `programs/spectre/src/vk.rs`.

### Step 4: Build Anchor Program

```bash
anchor build
```

This compiles the Rust program. First build takes a few minutes.

After building, get your program ID:
```bash
solana address -k target/deploy/spectre-keypair.json
```

### Step 5: Update Program ID

Replace the placeholder ID everywhere:

```bash
# Get the new program ID
PROGRAM_ID=$(solana address -k target/deploy/spectre-keypair.json)
echo "Program ID: $PROGRAM_ID"

# Update lib.rs
sed -i "s/SPEC1111111111111111111111111111111111111111/$PROGRAM_ID/g" programs/spectre/src/lib.rs

# Update Anchor.toml
sed -i "s/SPEC1111111111111111111111111111111111111111/$PROGRAM_ID/g" Anchor.toml

# Update relayer .env
sed -i "s/SPEC1111111111111111111111111111111111111111/$PROGRAM_ID/g" relayer/.env.example

# Rebuild with correct ID
anchor build
```

### Step 6: Deploy to Devnet

```bash
# Make sure you have SOL
solana airdrop 5

# Deploy
anchor deploy --provider.cluster devnet
```

Expected output:
```
Deploying program "spectre"...
Program path: target/deploy/spectre.so
Program Id: <YOUR_PROGRAM_ID>
Deploy success
```

### Step 7: Initialize Pool

```bash
# Initialize the 1 SOL pool
node scripts/init_pool.js --denomination 1 --rpc https://api.devnet.solana.com

# Initialize other denominations (optional)
node scripts/init_pool.js --denomination 5
node scripts/init_pool.js --denomination 10
node scripts/init_pool.js --denomination 100
```

### Step 8: Start Relayer

```bash
cd relayer
npm install
cp .env.example .env

# Generate relayer wallet
solana-keygen new --outfile relayer.json --no-bip39-passphrase
solana airdrop 2 $(solana address -k relayer.json)

# Get the base58 secret key for .env
node -e "const k=require('./relayer.json');console.log(require('bs58').encode(Buffer.from(k)))"
# Copy the output to RELAYER_SECRET in .env

# Update PROGRAM_ID in .env with your deployed program ID

# Start
npm start
```

For Railway deployment:
```bash
# Push relayer/ to a separate repo or use Railway CLI
railway init
railway up
```

### Step 9: Deploy Frontend

Update the frontend (`app/index.html`) with:
1. Your program ID
2. Your relayer WebSocket URL
3. Your social links (Twitter, GitHub, Discord)

Then deploy to any static hosting:

**Render:**
- New Static Site → point to your repo → Root Directory: `app`

**Vercel:**
```bash
cd app
npx vercel
```

**Netlify:**
- Drag and drop the `app/` folder

---

## Test the Full Flow

### Test Deposit
```bash
node scripts/deposit.js --amount 1 --rpc https://api.devnet.solana.com
# Save the note it outputs!
```

### Test Withdraw
```bash
node scripts/withdraw.js \
  --note "spectre-..." \
  --recipient <NEW_WALLET_ADDRESS> \
  --relayer-ws ws://YOUR_RELAYER:8787 \
  --rpc https://api.devnet.solana.com
```

---

## GitHub Setup

```bash
# Initialize repo
cd spectre-protocol
git init
git add .
git commit -m "SPECTRE: Zero-Knowledge Privacy Protocol on Solana"

# Create repo on GitHub (your org)
# Then push:
git remote add origin https://github.com/YOUR_ORG/spectre-protocol.git
git branch -M main
git push -u origin main
```

### Recommended repo settings:
- **Description:** Zero-Knowledge Privacy Protocol on Solana
- **Topics:** solana, privacy, zero-knowledge, zksnark, groth16, defi
- **Website:** spectre.cash (when ready)

---

## Architecture Diagram (for GitHub README)

```
User                    Relayer                  Solana Program
 │                        │                          │
 ├─── Deposit ───────────────────────────────────────┤
 │    (commitment + SOL)                             │
 │                                                   │
 │    [time passes, more deposits occur]             │
 │                                                   │
 ├─── Generate ZK Proof                              │
 │    (off-chain, in browser)                        │
 │                                                   │
 ├─── Send Proof ────────┤                           │
 │                       ├─── Submit Withdraw TX ────┤
 │                       │                           │
 │                       │    ← Verify Proof ────────┤
 │                       │    ← Check Nullifier ─────┤
 │                       │    ← Send SOL to ─────────┤
 │                       │      recipient            │
 │                       ├─── TX Confirmed ──────────┤
 ├─── Withdrawal Done ──┤                            │
 │                                                   │
 │    NO ON-CHAIN LINK between deposit & withdrawal  │
```

---

## Troubleshooting

**"Insufficient SOL"**
```bash
solana airdrop 5
# If rate limited, wait 30s and try again, or use a faucet:
# https://faucet.solana.com/
```

**"anchor build fails"**
```bash
# Make sure you have the right Anchor version
avm use 0.30.1
# Clear cache
cargo clean
anchor build
```

**"circom not found"**
```bash
# Add to PATH
export PATH="$HOME/.cargo/bin:$PATH"
which circom
```

**"Circuit build takes forever"**
- The Powers of Tau with 2^17 is intensive. Normal to take 10-15 min.
- Make sure you have at least 4GB RAM free.

**"Relayer can't connect to Solana"**
- Check RPC_URL in .env
- Try a different RPC: https://api.devnet.solana.com or a private RPC

---

## Timeline for Monday

| Task | Time | Who |
|------|------|-----|
| Install prerequisites | 30 min | Dev |
| Build circuits | 15 min | Dev |
| Build & deploy program | 15 min | Dev |
| Start relayer (local or Railway) | 10 min | Dev |
| Deploy frontend (Render/Vercel) | 5 min | Dev |
| Test deposit + withdraw | 15 min | Dev |
| Push to GitHub | 5 min | Dev |
| **Total** | **~1.5 hours** | |
