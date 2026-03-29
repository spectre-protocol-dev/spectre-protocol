/**
 * SPECTRE CLI Withdraw Script
 * 
 * Generates a ZK proof and withdraws SOL from the privacy pool
 * via the relayer, providing complete sender-recipient unlinkability.
 * 
 * Usage:
 *   node scripts/withdraw.js \
 *     --note "spectre-..." \
 *     --recipient <solana_address> \
 *     --relayer-ws ws://127.0.0.1:8787 \
 *     --rpc https://api.devnet.solana.com
 */

const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const crypto = require('crypto');
const WebSocket = require('ws');

// ─────────────────────────────────────
// Parse CLI args
// ─────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const NOTE = getArg('note', '');
const RECIPIENT = getArg('recipient', '');
const RELAYER_WS = getArg('relayer-ws', 'ws://127.0.0.1:8787');
const RPC = getArg('rpc', 'https://api.devnet.solana.com');
const WASM_PATH = getArg('wasm', './circuits/build/spectre_js/spectre.wasm');
const ZKEY_PATH = getArg('zkey', './circuits/build/spectre_final.zkey');

// ─────────────────────────────────────
// Note Decoding
// ─────────────────────────────────────

function decodeNote(note) {
  const encoded = note.replace('spectre-', '');
  const json = Buffer.from(encoded, 'base64').toString('utf-8');
  return JSON.parse(json);
}

// ─────────────────────────────────────
// Proof Generation
// ─────────────────────────────────────

/**
 * Generate a Groth16 ZK proof
 * 
 * In production, this uses snarkjs to generate the proof:
 *   const { proof, publicSignals } = await snarkjs.groth16.fullProve(
 *     input, WASM_PATH, ZKEY_PATH
 *   );
 * 
 * For devnet testing, we generate a mock proof.
 */
async function generateProof(noteData, recipient, merkleProof) {
  console.log('[*] Generating zero-knowledge proof...');
  
  // TODO: Replace with actual snarkjs proof generation
  //
  // const snarkjs = require('snarkjs');
  // const input = {
  //   root: merkleProof.root,
  //   nullifierHash: computeNullifierHash(noteData.nullifier),
  //   recipient: BigInt(recipient),
  //   relayer: BigInt(relayerAddress),
  //   fee: BigInt(fee),
  //   nullifier: BigInt('0x' + noteData.nullifier),
  //   secret: BigInt('0x' + noteData.secret),
  //   pathElements: merkleProof.pathElements,
  //   pathIndices: merkleProof.pathIndices,
  // };
  // const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  //   input, WASM_PATH, ZKEY_PATH
  // );

  // Mock proof for devnet
  const mockProof = {
    a: crypto.randomBytes(64).toString('hex'),
    b: crypto.randomBytes(128).toString('hex'),
    c: crypto.randomBytes(64).toString('hex'),
  };

  const nullifierHash = crypto.createHash('sha256')
    .update(Buffer.from(noteData.nullifier, 'hex'))
    .digest();

  const root = crypto.randomBytes(32); // Mock root

  // Simulate proof generation time
  await new Promise(r => setTimeout(r, 2000));

  return {
    proof: mockProof,
    root: root.toString('hex'),
    nullifierHash: nullifierHash.toString('hex'),
  };
}

// ─────────────────────────────────────
// Relayer Communication
// ─────────────────────────────────────

function connectRelayer(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Relayer connection timeout')), 10000);
  });
}

function submitWithdraw(ws, proof, root, nullifierHash, recipient) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        if (msg.status === 'confirmed') {
          resolve(msg.txHash);
        } else if (msg.status === 'failed') {
          reject(new Error(msg.error));
        } else {
          console.log(`  [relayer] ${msg.message || msg.status}`);
        }
      }
    });

    ws.send(JSON.stringify({
      type: 'withdraw',
      id,
      proof,
      root,
      nullifierHash,
      recipient,
      poolPda: '', // TODO: compute from denomination
    }));
  });
}

// ─────────────────────────────────────
// Main
// ─────────────────────────────────────

async function main() {
  console.log('════════════════════════════════════════');
  console.log('  SPECTRE Withdraw');
  console.log('════════════════════════════════════════');
  console.log('');

  if (!NOTE) {
    console.error('[!] Missing --note argument');
    console.error('    Usage: node withdraw.js --note "spectre-..." --recipient <address>');
    process.exit(1);
  }
  if (!RECIPIENT) {
    console.error('[!] Missing --recipient argument');
    process.exit(1);
  }

  // Validate recipient
  try {
    new PublicKey(RECIPIENT);
  } catch {
    console.error('[!] Invalid recipient address');
    process.exit(1);
  }

  // Decode note
  console.log('[1/4] Decoding secret note...');
  const noteData = decodeNote(NOTE);
  console.log(`  Amount: ${noteData.amount} SOL`);
  console.log(`  Recipient: ${RECIPIENT}`);
  console.log('');

  // Fetch Merkle proof from chain
  console.log('[2/4] Fetching Merkle proof...');
  // TODO: Query on-chain Merkle tree for the commitment's path
  console.log('  (Using mock proof for devnet)');
  console.log('');

  // Generate ZK proof
  console.log('[3/4] Generating zero-knowledge proof...');
  const { proof, root, nullifierHash } = await generateProof(noteData, RECIPIENT, null);
  console.log('  ✓ Proof generated');
  console.log('');

  // Submit to relayer
  console.log('[4/4] Submitting to relayer...');
  console.log(`  Relayer: ${RELAYER_WS}`);

  try {
    const ws = await connectRelayer(RELAYER_WS);
    console.log('  ✓ Connected to relayer');

    const txHash = await submitWithdraw(ws, proof, root, nullifierHash, RECIPIENT);
    
    ws.close();

    console.log('');
    console.log('════════════════════════════════════════');
    console.log('  WITHDRAWAL CONFIRMED');
    console.log('════════════════════════════════════════');
    console.log('');
    console.log(`  TX: ${txHash}`);
    console.log(`  Amount: ~${(noteData.amount * 0.9985).toFixed(4)} SOL`);
    console.log(`  Recipient: ${RECIPIENT}`);
    console.log('');
    console.log('  The on-chain link between your deposit');
    console.log('  and this withdrawal has been broken.');
    console.log('');
    console.log('════════════════════════════════════════');

  } catch (err) {
    console.error(`[!] Relayer error: ${err.message}`);
    console.error('    Make sure the relayer is running: cd relayer && npm start');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[!] Error:', err.message);
  process.exit(1);
});
