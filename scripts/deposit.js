/**
 * SPECTRE CLI Deposit Script
 * 
 * Generates a commitment and deposits SOL into the privacy pool.
 * Outputs a secret note that must be saved for withdrawal.
 * 
 * Usage:
 *   node scripts/deposit.js --amount 1 --rpc https://api.devnet.solana.com
 */

const { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const crypto = require('crypto');
const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────
// Parse CLI args
// ─────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const AMOUNT = parseFloat(getArg('amount', '1'));
const RPC = getArg('rpc', 'https://api.devnet.solana.com');
const WALLET_PATH = getArg('wallet', path.join(require('os').homedir(), '.config/solana/id.json'));
const PROGRAM_ID = getArg('program', 'SPEC1111111111111111111111111111111111111111');

// ─────────────────────────────────────
// Crypto Utils
// ─────────────────────────────────────

/**
 * Generate random field element (31 bytes to stay within BN254 field)
 */
function randomFieldElement() {
  return crypto.randomBytes(31);
}

/**
 * Compute commitment = hash(nullifier || secret)
 * In production, this uses the Poseidon hash.
 * For devnet testing, we use SHA-256 as a placeholder.
 * 
 * TODO: Replace with circomlibjs Poseidon hash
 */
function computeCommitment(nullifier, secret) {
  const hash = crypto.createHash('sha256');
  hash.update(nullifier);
  hash.update(secret);
  return hash.digest();
}

/**
 * Encode the note as a base64 string
 * Format: spectre-{version}-{amount}-{nullifier_hex}-{secret_hex}
 */
function encodeNote(amount, nullifier, secret) {
  const data = {
    version: 1,
    amount: amount,
    nullifier: nullifier.toString('hex'),
    secret: secret.toString('hex'),
    timestamp: Date.now(),
  };
  const json = JSON.stringify(data);
  const encoded = Buffer.from(json).toString('base64');
  return `spectre-${encoded}`;
}

/**
 * Decode a note back to its components
 */
function decodeNote(note) {
  const encoded = note.replace('spectre-', '');
  const json = Buffer.from(encoded, 'base64').toString('utf-8');
  return JSON.parse(json);
}

// ─────────────────────────────────────
// Main
// ─────────────────────────────────────

async function main() {
  console.log('════════════════════════════════════════');
  console.log('  SPECTRE Deposit');
  console.log('════════════════════════════════════════');
  console.log('');

  // Load wallet
  let walletKeypair;
  try {
    const walletData = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
    walletKeypair = Keypair.fromSecretKey(Uint8Array.from(walletData));
  } catch (e) {
    console.error(`[!] Could not load wallet from ${WALLET_PATH}`);
    console.error('    Run: solana-keygen new');
    process.exit(1);
  }

  const connection = new Connection(RPC, 'confirmed');
  const balance = await connection.getBalance(walletKeypair.publicKey);
  const amountLamports = AMOUNT * LAMPORTS_PER_SOL;

  console.log(`  Wallet:  ${walletKeypair.publicKey.toBase58()}`);
  console.log(`  Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`  Amount:  ${AMOUNT} SOL`);
  console.log(`  RPC:     ${RPC}`);
  console.log('');

  if (balance < amountLamports + 10_000_000) {
    console.error('[!] Insufficient balance. Need at least', AMOUNT + 0.01, 'SOL');
    console.error('    Run: solana airdrop 2');
    process.exit(1);
  }

  // Generate secrets
  console.log('[1/3] Generating cryptographic secrets...');
  const nullifier = randomFieldElement();
  const secret = randomFieldElement();
  const commitment = computeCommitment(nullifier, secret);

  console.log(`  Commitment: ${commitment.toString('hex').slice(0, 16)}...`);

  // Create the note
  console.log('[2/3] Creating secret note...');
  const note = encodeNote(AMOUNT, nullifier, secret);

  // Submit deposit transaction
  console.log('[3/3] Submitting deposit transaction...');

  // TODO: Replace with actual Anchor program call
  // For devnet testing, we do a simple SOL transfer to simulate
  //
  // Production:
  //   const program = new Program(IDL, PROGRAM_ID, provider);
  //   const [poolPda] = PublicKey.findProgramAddressSync(
  //     [Buffer.from('pool'), Buffer.from(amountLamports.toString())],
  //     program.programId
  //   );
  //   await program.methods
  //     .deposit(Array.from(commitment))
  //     .accounts({ pool: poolPda, depositor: wallet.publicKey, ... })
  //     .rpc();

  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  DEPOSIT SIMULATED (Devnet)');
  console.log('════════════════════════════════════════');
  console.log('');
  console.log('  Your secret note:');
  console.log('');
  console.log(`  ${note}`);
  console.log('');
  console.log('  ⚠ SAVE THIS NOTE SECURELY.');
  console.log('  ⚠ It is the ONLY way to withdraw your funds.');
  console.log('  ⚠ If you lose it, your SOL is GONE FOREVER.');
  console.log('');
  console.log('════════════════════════════════════════');

  // Save note to file (optional, for testing)
  const noteFile = path.join(__dirname, '..', `note_${Date.now()}.txt`);
  fs.writeFileSync(noteFile, note);
  console.log(`  Note saved to: ${noteFile}`);
}

main().catch(err => {
  console.error('[!] Error:', err.message);
  process.exit(1);
});
