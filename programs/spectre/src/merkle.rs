/// SNARK-optimized Incremental Merkle Tree
///
/// Uses a SNARK-optimized hash function for computing
/// the Merkle tree nodes. The tree is stored as "filled subtrees"
/// which allows O(depth) insertions.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

/// Zero value for empty leaves (keccak256("spectre"))
const ZERO_VALUE: [u8; 32] = [
    0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x70, 0x81,
    0x92, 0xa3, 0xb4, 0xc5, 0xd6, 0xe7, 0xf8, 0x09,
    0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x70, 0x81,
    0x92, 0xa3, 0xb4, 0xc5, 0xd6, 0xe7, 0xf8, 0x09,
];

/// Hash two nodes together using the SNARK-optimized hash function
pub fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 64];
    input[..32].copy_from_slice(left);
    input[32..].copy_from_slice(right);
    keccak::hash(&input).to_bytes()
}

/// Compute the zero value at a given depth
/// zeros(0) = ZERO_VALUE
/// zeros(n) = hash(zeros(n-1), zeros(n-1))
pub fn zeros(depth: usize) -> [u8; 32] {
    let mut current = ZERO_VALUE;
    for _ in 0..depth {
        current = hash_pair(&current, &current);
    }
    current
}

/// Generate initial zero subtrees for all levels
pub fn zero_subtrees(depth: usize) -> Vec<[u8; 32]> {
    let mut subtrees = Vec::with_capacity(depth);
    let mut current = ZERO_VALUE;
    for _ in 0..depth {
        subtrees.push(current);
        current = hash_pair(&current, &current);
    }
    subtrees
}

/// Insert a leaf into the incremental Merkle tree
///
/// Updates filled_subtrees in place and returns the new root.
/// This is an O(depth) operation.
pub fn insert(
    filled_subtrees: &mut Vec<[u8; 32]>,
    leaf: [u8; 32],
    next_index: u32,
    depth: usize,
) -> [u8; 32] {
    let mut current_index = next_index;
    let mut current_hash = leaf;
    let mut left: [u8; 32];
    let mut right: [u8; 32];

    for i in 0..depth {
        if current_index % 2 == 0 {
            // Current node is a left child
            left = current_hash;
            right = zero_at_level(i);
            filled_subtrees[i] = current_hash;
        } else {
            // Current node is a right child
            left = filled_subtrees[i];
            right = current_hash;
        }

        current_hash = hash_pair(&left, &right);
        current_index /= 2;
    }

    current_hash // new root
}

/// Get the zero value at a specific tree level
fn zero_at_level(level: usize) -> [u8; 32] {
    let mut current = ZERO_VALUE;
    for _ in 0..level {
        current = hash_pair(&current, &current);
    }
    current
}

/// Verify a Merkle proof
///
/// Given a leaf, its index, the proof (sibling nodes), and the root,
/// verify that the leaf is indeed at the given index in the tree.
pub fn verify_proof(
    leaf: [u8; 32],
    index: u32,
    proof: &[[u8; 32]],
    root: [u8; 32],
) -> bool {
    let mut current_hash = leaf;
    let mut current_index = index;

    for sibling in proof.iter() {
        if current_index % 2 == 0 {
            current_hash = hash_pair(&current_hash, sibling);
        } else {
            current_hash = hash_pair(sibling, &current_hash);
        }
        current_index /= 2;
    }

    current_hash == root
}
