#!/bin/bash
# ═══════════════════════════════════════════════════════════
# SPECTRE Circuit Build & Trusted Setup
# ═══════════════════════════════════════════════════════════
#
# This script:
#   1. Compiles the circom circuit
#   2. Runs Powers of Tau ceremony (phase 1)
#   3. Generates Groth16 proving/verification keys (phase 2)
#   4. Exports verification key for on-chain verifier
#
# Prerequisites:
#   - circom 2.1+ (https://docs.circom.io/getting-started/installation/)
#   - snarkjs 0.7+ (npm install -g snarkjs)
#   - Node.js 18+
#
# WARNING: This trusted setup is for DEVELOPMENT ONLY.
# A production deployment requires a proper MPC ceremony.
# ═══════════════════════════════════════════════════════════

set -e

CIRCUIT="spectre"
CIRCUIT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${CIRCUIT_DIR}/build"
PTAU_SIZE=17  # 2^17 = 131072 constraints (sufficient for depth-20 tree)

echo "════════════════════════════════════════"
echo "  SPECTRE Circuit Build"
echo "════════════════════════════════════════"
echo ""

# Create build directory
mkdir -p "${BUILD_DIR}"

# ───────────────────────────────────────
# Step 1: Compile Circuit
# ───────────────────────────────────────
echo "[1/7] Compiling circuit..."
circom "${CIRCUIT_DIR}/${CIRCUIT}.circom" \
    --r1cs \
    --wasm \
    --sym \
    -o "${BUILD_DIR}" \
    -l "${CIRCUIT_DIR}/../node_modules"

echo "  ✓ R1CS: ${BUILD_DIR}/${CIRCUIT}.r1cs"
echo "  ✓ WASM: ${BUILD_DIR}/${CIRCUIT}_js/${CIRCUIT}.wasm"
echo ""

# Print circuit info
echo "[*] Circuit info:"
npx snarkjs r1cs info "${BUILD_DIR}/${CIRCUIT}.r1cs"
echo ""

# ───────────────────────────────────────
# Step 2: Powers of Tau (Phase 1)
# ───────────────────────────────────────
echo "[2/7] Starting Powers of Tau ceremony..."
npx snarkjs powersoftau new bn128 ${PTAU_SIZE} \
    "${BUILD_DIR}/pot_0000.ptau" -v

echo ""
echo "[3/7] Contributing to ceremony..."
npx snarkjs powersoftau contribute \
    "${BUILD_DIR}/pot_0000.ptau" \
    "${BUILD_DIR}/pot_0001.ptau" \
    --name="SPECTRE Dev Setup - Phase 1" \
    -v \
    -e="$(head -c 1024 /dev/urandom | openssl sha256 | awk '{print $2}')"

echo ""
echo "[4/7] Preparing phase 2..."
npx snarkjs powersoftau prepare phase2 \
    "${BUILD_DIR}/pot_0001.ptau" \
    "${BUILD_DIR}/pot_final.ptau" -v

echo ""

# ───────────────────────────────────────
# Step 3: Groth16 Setup (Phase 2)
# ───────────────────────────────────────
echo "[5/7] Groth16 setup..."
npx snarkjs groth16 setup \
    "${BUILD_DIR}/${CIRCUIT}.r1cs" \
    "${BUILD_DIR}/pot_final.ptau" \
    "${BUILD_DIR}/${CIRCUIT}_0000.zkey"

echo ""
echo "[6/7] Final contribution..."
npx snarkjs zkey contribute \
    "${BUILD_DIR}/${CIRCUIT}_0000.zkey" \
    "${BUILD_DIR}/${CIRCUIT}_final.zkey" \
    --name="SPECTRE Dev Setup - Final" \
    -v \
    -e="spectre_privacy_$(date +%s%N)"

echo ""

# ───────────────────────────────────────
# Step 4: Export Verification Key
# ───────────────────────────────────────
echo "[7/7] Exporting verification key..."
npx snarkjs zkey export verificationkey \
    "${BUILD_DIR}/${CIRCUIT}_final.zkey" \
    "${BUILD_DIR}/verification_key.json"

echo ""
echo "════════════════════════════════════════"
echo "  SPECTRE Circuit Build Complete!"
echo "════════════════════════════════════════"
echo ""
echo "  Circuit WASM: ${BUILD_DIR}/${CIRCUIT}_js/${CIRCUIT}.wasm"
echo "  Proving Key:  ${BUILD_DIR}/${CIRCUIT}_final.zkey"
echo "  Verify Key:   ${BUILD_DIR}/verification_key.json"
echo ""
echo "  Next: Run 'node scripts/gen_verifier.js' to generate"
echo "        the on-chain Rust verifier module."
echo ""
echo "  ⚠ This setup is for DEVELOPMENT ONLY."
echo "  ⚠ Production requires a proper MPC ceremony."
echo "════════════════════════════════════════"
