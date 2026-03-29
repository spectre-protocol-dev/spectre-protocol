/**
 * SPECTRE Relayer
 * 
 * WebSocket server that handles private withdrawal transactions.
 * The relayer receives ZK proofs from clients and submits
 * withdrawal transactions on-chain, providing sender-recipient
 * unlinkability.
 * 
 * Flow:
 *   1. Client connects via WebSocket
 *   2. Client sends proof + withdrawal params
 *   3. Relayer validates proof format
 *   4. Relayer constructs and submits on-chain TX
 *   5. Relayer returns TX hash to client
 */

import { WebSocketServer, WebSocket } from 'ws';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { v4 as uuid } from 'uuid';
import 'dotenv/config';

// ─────────────────────────────────────
// Configuration
// ─────────────────────────────────────

const CONFIG = {
  port: parseInt(process.env.PORT || '8787'),
  bind: process.env.BIND || '0.0.0.0',
  rpc: process.env.RPC_URL || 'https://api.devnet.solana.com',
  programId: process.env.PROGRAM_ID || 'SPEC1111111111111111111111111111111111111111',
  relayerFee: parseInt(process.env.RELAYER_FEE_BPS || '15'), // basis points
  gasBuffer: parseInt(process.env.GAS_BUFFER || '5000000'),   // lamports
};

// ─────────────────────────────────────
// State
// ─────────────────────────────────────

let relayerKeypair: Keypair;
let connection: Connection;
let pendingJobs: Map<string, any> = new Map();

// ─────────────────────────────────────
// Initialize
// ─────────────────────────────────────

function init() {
  // Load relayer wallet
  const secret = process.env.RELAYER_SECRET;
  if (!secret) {
    console.error('[SPECTRE] RELAYER_SECRET not set in .env');
    process.exit(1);
  }
  relayerKeypair = Keypair.fromSecretKey(bs58.decode(secret));
  
  // Connect to Solana
  connection = new Connection(CONFIG.rpc, 'confirmed');
  
  console.log(`[SPECTRE] Relayer initialized`);
  console.log(`[SPECTRE] Address: ${relayerKeypair.publicKey.toBase58()}`);
  console.log(`[SPECTRE] RPC: ${CONFIG.rpc}`);
  console.log(`[SPECTRE] Program: ${CONFIG.programId}`);
}

// ─────────────────────────────────────
// WebSocket Server
// ─────────────────────────────────────

function startServer() {
  const wss = new WebSocketServer({
    port: CONFIG.port,
    host: CONFIG.bind,
  });

  console.log(`[SPECTRE] WebSocket server listening on ${CONFIG.bind}:${CONFIG.port}`);

  wss.on('connection', (ws: WebSocket, req) => {
    const clientId = uuid().slice(0, 8);
    console.log(`[SPECTRE] Client connected: ${clientId}`);

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(ws, clientId, message);
      } catch (err: any) {
        sendError(ws, 'PARSE_ERROR', err.message);
      }
    });

    ws.on('close', () => {
      console.log(`[SPECTRE] Client disconnected: ${clientId}`);
    });

    ws.on('error', (err) => {
      console.error(`[SPECTRE] Client error ${clientId}:`, err.message);
    });

    // Send welcome
    ws.send(JSON.stringify({
      type: 'connected',
      relayer: relayerKeypair.publicKey.toBase58(),
      fee: CONFIG.relayerFee,
      gasBuffer: CONFIG.gasBuffer,
    }));
  });
}

// ─────────────────────────────────────
// Message Handler
// ─────────────────────────────────────

interface WithdrawRequest {
  type: 'withdraw';
  id: string;
  proof: {
    a: string; // hex
    b: string; // hex
    c: string; // hex
  };
  publicSignals: string[];
  root: string;           // hex
  nullifierHash: string;  // hex
  recipient: string;      // base58 pubkey
  poolPda: string;        // base58 pubkey
}

async function handleMessage(ws: WebSocket, clientId: string, message: any) {
  switch (message.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    case 'withdraw':
      await handleWithdraw(ws, clientId, message as WithdrawRequest);
      break;

    case 'status':
      const balance = await connection.getBalance(relayerKeypair.publicKey);
      ws.send(JSON.stringify({
        type: 'status',
        relayer: relayerKeypair.publicKey.toBase58(),
        balance: balance / 1e9,
        pendingJobs: pendingJobs.size,
        uptime: process.uptime(),
      }));
      break;

    default:
      sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${message.type}`);
  }
}

async function handleWithdraw(ws: WebSocket, clientId: string, req: WithdrawRequest) {
  const jobId = req.id || uuid();
  console.log(`[SPECTRE] Withdraw request ${jobId} from ${clientId}`);

  try {
    // Validate request
    if (!req.proof || !req.recipient || !req.nullifierHash || !req.root) {
      throw new Error('Missing required fields');
    }

    // Validate recipient is a valid pubkey
    const recipientPubkey = new PublicKey(req.recipient);
    
    // Check proof format
    const proofA = Buffer.from(req.proof.a, 'hex');
    const proofB = Buffer.from(req.proof.b, 'hex');
    const proofC = Buffer.from(req.proof.c, 'hex');

    if (proofA.length !== 64 || proofB.length !== 128 || proofC.length !== 64) {
      throw new Error('Invalid proof dimensions');
    }

    // Store pending job
    pendingJobs.set(jobId, { clientId, status: 'processing', timestamp: Date.now() });

    ws.send(JSON.stringify({
      type: 'withdraw_status',
      id: jobId,
      status: 'processing',
      message: 'Constructing withdrawal transaction...',
    }));

    // Build and submit the withdrawal transaction
    // In production, this calls the SPECTRE program's withdraw instruction
    const txHash = await submitWithdrawal(req);

    // Success
    pendingJobs.delete(jobId);

    ws.send(JSON.stringify({
      type: 'withdraw_status',
      id: jobId,
      status: 'confirmed',
      txHash,
      message: 'Withdrawal confirmed',
    }));

    console.log(`[SPECTRE] Withdraw ${jobId} confirmed: ${txHash}`);

  } catch (err: any) {
    pendingJobs.delete(jobId);
    console.error(`[SPECTRE] Withdraw ${jobId} failed:`, err.message);
    
    ws.send(JSON.stringify({
      type: 'withdraw_status',
      id: jobId,
      status: 'failed',
      error: err.message,
    }));
  }
}

async function submitWithdrawal(req: WithdrawRequest): Promise<string> {
  // TODO: Build the actual Anchor instruction call
  // For devnet testing, this simulates the withdrawal
  //
  // Production implementation:
  //
  // const program = new Program(IDL, CONFIG.programId, provider);
  // const tx = await program.methods
  //   .withdraw(
  //     { a: proofA, b: proofB, c: proofC },
  //     Buffer.from(req.root, 'hex'),
  //     Buffer.from(req.nullifierHash, 'hex'),
  //     new PublicKey(req.recipient),
  //     relayerKeypair.publicKey,
  //     new BN(fee),
  //   )
  //   .accounts({
  //     pool: new PublicKey(req.poolPda),
  //     poolVault: vaultPda,
  //     recipient: new PublicKey(req.recipient),
  //     relayerAccount: relayerKeypair.publicKey,
  //     systemProgram: SystemProgram.programId,
  //   })
  //   .signers([relayerKeypair])
  //   .rpc();

  // Devnet simulation: direct SOL transfer
  console.log(`[SPECTRE] Simulating withdrawal to ${req.recipient}`);
  
  // For now, return a simulated tx hash
  const simHash = bs58.encode(Buffer.from(
    Array.from({ length: 64 }, () => Math.floor(Math.random() * 256))
  ));
  
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return simHash;
}

// ─────────────────────────────────────
// Helpers
// ─────────────────────────────────────

function sendError(ws: WebSocket, code: string, message: string) {
  ws.send(JSON.stringify({ type: 'error', code, message }));
}

// ─────────────────────────────────────
// Start
// ─────────────────────────────────────

init();
startServer();
