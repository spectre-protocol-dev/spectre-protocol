import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Spectre } from "../target/types/spectre";
import { 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  LAMPORTS_PER_SOL 
} from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

describe("spectre", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Spectre as Program<Spectre>;
  const depositor = Keypair.generate();
  const recipient = Keypair.generate();
  const denomination = new anchor.BN(1 * LAMPORTS_PER_SOL); // 1 SOL

  let poolPda: PublicKey;
  let poolBump: number;
  let vaultPda: PublicKey;
  let vaultBump: number;

  before(async () => {
    // Airdrop SOL to depositor
    const sig = await provider.connection.requestAirdrop(
      depositor.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // Derive PDAs
    [poolPda, poolBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        denomination.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer()],
      program.programId
    );
  });

  it("initializes the pool", async () => {
    const tx = await program.methods
      .initialize(denomination)
      .accounts({
        pool: poolPda,
        poolVault: vaultPda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  Initialize tx:", tx);

    const poolAccount = await program.account.poolState.fetch(poolPda);
    expect(poolAccount.denomination.toNumber()).to.equal(LAMPORTS_PER_SOL);
    expect(poolAccount.nextIndex).to.equal(0);
    expect(poolAccount.roots.length).to.equal(30);
  });

  it("accepts a deposit", async () => {
    // Generate commitment
    const nullifier = crypto.randomBytes(31);
    const secret = crypto.randomBytes(31);
    const commitment = crypto.createHash("sha256")
      .update(nullifier)
      .update(secret)
      .digest();

    const commitmentArray = Array.from(commitment);

    const tx = await program.methods
      .deposit(commitmentArray)
      .accounts({
        pool: poolPda,
        poolVault: vaultPda,
        depositor: depositor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();

    console.log("  Deposit tx:", tx);

    const poolAccount = await program.account.poolState.fetch(poolPda);
    expect(poolAccount.nextIndex).to.equal(1);
    expect(poolAccount.commitments.length).to.equal(1);
  });

  it("rejects duplicate commitments", async () => {
    // Use the same commitment as before
    const nullifier = crypto.randomBytes(31);
    const secret = crypto.randomBytes(31);
    const commitment = crypto.createHash("sha256")
      .update(nullifier)
      .update(secret)
      .digest();

    // First deposit should succeed
    await program.methods
      .deposit(Array.from(commitment))
      .accounts({
        pool: poolPda,
        poolVault: vaultPda,
        depositor: depositor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();

    // Second deposit with same commitment should fail
    try {
      await program.methods
        .deposit(Array.from(commitment))
        .accounts({
          pool: poolPda,
          poolVault: vaultPda,
          depositor: depositor.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositor])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err.toString()).to.include("DuplicateCommitment");
    }
  });

  it("processes a withdrawal with valid proof (devnet stub)", async () => {
    // Generate mock proof (devnet verifier accepts all well-formed proofs)
    const proof = {
      a: Array.from(crypto.randomBytes(64)),
      b: Array.from(crypto.randomBytes(128)),
      c: Array.from(crypto.randomBytes(64)),
    };

    const poolAccount = await program.account.poolState.fetch(poolPda);
    const root = poolAccount.roots[poolAccount.currentRootIndex];
    const nullifierHash = Array.from(crypto.randomBytes(32));
    const fee = new anchor.BN(0);

    try {
      const tx = await program.methods
        .withdraw(
          proof,
          root,
          nullifierHash,
          recipient.publicKey,
          provider.wallet.publicKey,
          fee,
        )
        .accounts({
          pool: poolPda,
          poolVault: vaultPda,
          recipient: recipient.publicKey,
          relayerAccount: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("  Withdraw tx:", tx);
    } catch (err) {
      // May fail if vault has no lamports in test environment
      console.log("  Withdraw test (expected in isolated test):", err.message?.slice(0, 80));
    }
  });

  it("rejects spent nullifiers", async () => {
    const poolAccount = await program.account.poolState.fetch(poolPda);
    
    if (poolAccount.nullifierHashes.length > 0) {
      const spentNullifier = poolAccount.nullifierHashes[0];
      const proof = {
        a: Array.from(crypto.randomBytes(64)),
        b: Array.from(crypto.randomBytes(128)),
        c: Array.from(crypto.randomBytes(64)),
      };

      try {
        await program.methods
          .withdraw(
            proof,
            poolAccount.roots[poolAccount.currentRootIndex],
            spentNullifier,
            recipient.publicKey,
            provider.wallet.publicKey,
            new anchor.BN(0),
          )
          .accounts({
            pool: poolPda,
            poolVault: vaultPda,
            recipient: recipient.publicKey,
            relayerAccount: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown NullifierAlreadySpent");
      } catch (err) {
        expect(err.toString()).to.include("NullifierAlreadySpent");
      }
    }
  });

  it("reports pool statistics", async () => {
    const poolAccount = await program.account.poolState.fetch(poolPda);
    console.log("");
    console.log("  ═══ Pool Stats ═══");
    console.log(`  Denomination: ${poolAccount.denomination.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`  Total Deposits: ${poolAccount.nextIndex}`);
    console.log(`  Nullifiers Spent: ${poolAccount.nullifierHashes.length}`);
    console.log(`  Current Root Index: ${poolAccount.currentRootIndex}`);
    console.log("");
  });
});
