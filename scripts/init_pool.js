/**
 * SPECTRE Pool Initialization
 * 
 * Initializes a privacy pool for a specific denomination.
 * Must be run once per denomination before deposits can be made.
 * 
 * Usage:
 *   node scripts/init_pool.js --denomination 1 --rpc https://api.devnet.solana.com
 */

const { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const DENOMINATION = parseFloat(getArg('denomination', '1'));
const RPC = getArg('rpc', 'https://api.devnet.solana.com');
const WALLET_PATH = getArg('wallet', path.join(require('os').homedir(), '.config/solana/id.json'));
const PROGRAM_ID = getArg('program', 'SPEC1111111111111111111111111111111111111111');

async function main() {
  console.log('════════════════════════════════════════');
  console.log('  SPECTRE Pool Initialization');
  console.log('════════════════════════════════════════');
  console.log('');
  console.log(`  Denomination: ${DENOMINATION} SOL`);
  console.log(`  RPC: ${RPC}`);
  console.log('');

  const walletData = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));
  const connection = new Connection(RPC, 'confirmed');

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`  Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`  Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log('');

  const denominationLamports = BigInt(DENOMINATION * LAMPORTS_PER_SOL);
  const programId = new PublicKey(PROGRAM_ID);

  // Derive pool PDA
  const [poolPda, poolBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('pool'),
      Buffer.from(denominationLamports.toString()),
    ],
    programId
  );

  // Derive vault PDA
  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), poolPda.toBuffer()],
    programId
  );

  console.log(`  Pool PDA: ${poolPda.toBase58()}`);
  console.log(`  Vault PDA: ${vaultPda.toBase58()}`);
  console.log('');

  // TODO: Call the actual Anchor initialize instruction
  // 
  // const program = new Program(IDL, PROGRAM_ID, provider);
  // const tx = await program.methods
  //   .initialize(new BN(denominationLamports.toString()))
  //   .accounts({
  //     pool: poolPda,
  //     poolVault: vaultPda,
  //     authority: wallet.publicKey,
  //     systemProgram: SystemProgram.programId,
  //   })
  //   .rpc();

  console.log('  [!] Pool initialization requires the deployed program.');
  console.log('      Run after: anchor deploy --provider.cluster devnet');
  console.log('');
  console.log('  Save these addresses for your .env:');
  console.log(`  POOL_PDA_${DENOMINATION}=${poolPda.toBase58()}`);
  console.log(`  VAULT_PDA_${DENOMINATION}=${vaultPda.toBase58()}`);
}

main().catch(err => {
  console.error('[!] Error:', err.message);
  process.exit(1);
});
