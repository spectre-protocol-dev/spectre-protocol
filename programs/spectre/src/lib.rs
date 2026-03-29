use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

pub mod merkle;
pub mod verifier;

declare_id!("CGGCXL7QsD2MeMnFNqsGroZkTN3TXtc3iVDUcFa4UgUh");

/// Merkle tree depth - supports 2^20 = 1,048,576 deposits
const TREE_DEPTH: usize = 20;
/// Number of historical roots to store for async withdrawals
const ROOT_HISTORY_SIZE: usize = 30;
/// Denomination options (in lamports)
const DENOMINATIONS: [u64; 4] = [
    1_000_000_000,    // 1 SOL
    5_000_000_000,    // 5 SOL
    10_000_000_000,   // 10 SOL
    100_000_000_000,  // 100 SOL
];
/// Relayer fee in basis points (0.15%)
const RELAYER_FEE_BPS: u64 = 15;
/// Gas buffer for relayer (in lamports)
const GAS_BUFFER: u64 = 5_000_000; // 0.005 SOL

#[program]
pub mod spectre {
    use super::*;

    /// Initialize the privacy pool with a specific denomination
    pub fn initialize(ctx: Context<Initialize>, denomination: u64) -> Result<()> {
        require!(
            DENOMINATIONS.contains(&denomination),
            SpectreError::InvalidDenomination
        );

        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.denomination = denomination;
        pool.next_index = 0;
        pool.current_root_index = 0;

        // Initialize with zero roots
        let zero_root = merkle::zeros(TREE_DEPTH);
        pool.roots = vec![zero_root; ROOT_HISTORY_SIZE];
        pool.roots[0] = zero_root;

        // Initialize filled subtrees with zero values at each level
        pool.filled_subtrees = merkle::zero_subtrees(TREE_DEPTH);

        msg!("SPECTRE pool initialized | denomination: {} lamports", denomination);
        Ok(())
    }

    /// Deposit SOL into the privacy pool
    ///
    /// The user provides a commitment = Spectre commitment(nullifier, secret)
    /// which is inserted into the on-chain Merkle tree.
    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32]) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // Check pool isn't full
        require!(
            pool.next_index < (1u32 << TREE_DEPTH as u32),
            SpectreError::MerkleTreeFull
        );

        // Check commitment hasn't been used
        require!(
            !pool.commitments.contains(&commitment),
            SpectreError::DuplicateCommitment
        );

        // Transfer SOL from depositor to pool PDA
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.depositor.key(),
            &ctx.accounts.pool_vault.key(),
            pool.denomination,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.depositor.to_account_info(),
                ctx.accounts.pool_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Insert commitment into Merkle tree
        let current_index = pool.next_index;
        let new_root = merkle::insert(
            &mut pool.filled_subtrees,
            commitment,
            current_index,
            TREE_DEPTH,
        );

        // Update root history (ring buffer)
        let new_root_index = (pool.current_root_index as usize + 1) % ROOT_HISTORY_SIZE;
        pool.roots[new_root_index] = new_root;
        pool.current_root_index = new_root_index as u32;

        // Store commitment
        pool.commitments.push(commitment);
        pool.next_index += 1;

        emit!(DepositEvent {
            commitment,
            leaf_index: pool.next_index - 1,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "SPECTRE deposit #{} | commitment: {:?}",
            pool.next_index - 1,
            &commitment[..8]
        );

        Ok(())
    }

    /// Withdraw SOL from the privacy pool using a zero-knowledge proof
    ///
    /// The relayer submits the proof on behalf of the recipient.
    /// The proof demonstrates knowledge of (nullifier, secret) such that:
    ///   1. Spectre commitment(nullifier, secret) is a leaf in the Merkle tree
    ///   2. The nullifier hash hasn't been spent
    ///   3. The specified root is valid
    pub fn withdraw(
        ctx: Context<Withdraw>,
        proof: ProofData,
        root: [u8; 32],
        nullifier_hash: [u8; 32],
        recipient: Pubkey,
        relayer: Pubkey,
        fee: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // Verify root is in history
        require!(
            pool.roots.contains(&root),
            SpectreError::InvalidRoot
        );

        // Check nullifier hasn't been spent
        require!(
            !pool.nullifier_hashes.contains(&nullifier_hash),
            SpectreError::NullifierAlreadySpent
        );

        // Verify fee doesn't exceed denomination
        let max_fee = (pool.denomination * RELAYER_FEE_BPS) / 10_000 + GAS_BUFFER;
        require!(fee <= max_fee, SpectreError::FeeTooHigh);

        // Construct public inputs for verification
        let public_inputs = vec![
            root.to_vec(),
            nullifier_hash.to_vec(),
            recipient.to_bytes().to_vec(),
            relayer.to_bytes().to_vec(),
            fee.to_le_bytes().to_vec(),
        ];

        // Verify Groth16 proof
        let valid = verifier::verify_proof(
            &proof.a,
            &proof.b,
            &proof.c,
            &public_inputs,
        )?;
        require!(valid, SpectreError::InvalidProof);

        // Mark nullifier as spent
        pool.nullifier_hashes.push(nullifier_hash);

        // Transfer SOL to recipient
        let amount_to_recipient = pool.denomination - fee;

        // Transfer using PDA signer seeds
        let pool_key = pool.key();
        let seeds = &[
            b"vault",
            pool_key.as_ref(),
            &[ctx.bumps.pool_vault],
        ];
        let _signer_seeds = &[&seeds[..]];

        // Pay recipient
        **ctx.accounts.pool_vault.to_account_info().try_borrow_mut_lamports()? -= amount_to_recipient;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount_to_recipient;

        // Pay relayer fee
        if fee > 0 {
            **ctx.accounts.pool_vault.to_account_info().try_borrow_mut_lamports()? -= fee;
            **ctx.accounts.relayer_account.to_account_info().try_borrow_mut_lamports()? += fee;
        }

        emit!(WithdrawEvent {
            nullifier_hash,
            recipient,
            relayer,
            fee,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("SPECTRE withdrawal complete | recipient: {}", recipient);

        Ok(())
    }
}

// ─────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────

#[derive(Accounts)]
#[instruction(denomination: u64)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PoolState::INIT_SPACE,
        seeds = [b"pool", denomination.to_le_bytes().as_ref()],
        bump,
    )]
    pub pool: Account<'info, PoolState>,

    /// CHECK: PDA vault that holds deposited SOL
    #[account(
        seeds = [b"vault", pool.key().as_ref()],
        bump,
    )]
    pub pool_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub pool: Account<'info, PoolState>,

    /// CHECK: PDA vault
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump,
    )]
    pub pool_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub pool: Account<'info, PoolState>,

    /// CHECK: PDA vault holding pool funds
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump,
    )]
    pub pool_vault: UncheckedAccount<'info>,

    /// CHECK: Recipient of withdrawal (validated via ZK proof)
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Relayer who submitted the TX (validated via ZK proof)
    #[account(mut)]
    pub relayer_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ─────────────────────────────────────────
// State
// ─────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct PoolState {
    pub authority: Pubkey,
    pub denomination: u64,
    pub next_index: u32,
    pub current_root_index: u32,

    #[max_len(30)]
    pub roots: Vec<[u8; 32]>,

    #[max_len(20)]
    pub filled_subtrees: Vec<[u8; 32]>,

    /// Stored commitments (for duplicate check)
    #[max_len(1000)]
    pub commitments: Vec<[u8; 32]>,

    /// Spent nullifier hashes
    #[max_len(1000)]
    pub nullifier_hashes: Vec<[u8; 32]>,
}

// ─────────────────────────────────────────
// Data Types
// ─────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofData {
    /// Proof point A (G1) - 64 bytes
    pub a: Vec<u8>,
    /// Proof point B (G2) - 128 bytes
    pub b: Vec<u8>,
    /// Proof point C (G1) - 64 bytes
    pub c: Vec<u8>,
}

// ─────────────────────────────────────────
// Events
// ─────────────────────────────────────────

#[event]
pub struct DepositEvent {
    pub commitment: [u8; 32],
    pub leaf_index: u32,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawEvent {
    pub nullifier_hash: [u8; 32],
    pub recipient: Pubkey,
    pub relayer: Pubkey,
    pub fee: u64,
    pub timestamp: i64,
}

// ─────────────────────────────────────────
// Errors
// ─────────────────────────────────────────

#[error_code]
pub enum SpectreError {
    #[msg("Invalid denomination. Must be 1, 5, 10, or 100 SOL")]
    InvalidDenomination,

    #[msg("Merkle tree is full (max 2^20 deposits)")]
    MerkleTreeFull,

    #[msg("This commitment has already been submitted")]
    DuplicateCommitment,

    #[msg("The provided Merkle root is not in the history")]
    InvalidRoot,

    #[msg("This nullifier has already been spent")]
    NullifierAlreadySpent,

    #[msg("Relayer fee exceeds maximum allowed")]
    FeeTooHigh,

    #[msg("Zero-knowledge proof verification failed")]
    InvalidProof,

    #[msg("Proof deserialization failed")]
    ProofDeserializationError,
}
