// SPECTRE Privacy Circuit
//
// Proves knowledge of (secret, nullifier) such that:
//   1. commitment = SNARK-optimized commitment hash(nullifier, secret) is in the Merkle tree
//   2. nullifierHash = SNARK-optimized commitment hash(nullifier) is correctly computed
//   3. The Merkle root matches a known valid root
//
// Public inputs:  root, nullifierHash, recipient, relayer, fee
// Private inputs: nullifier, secret, pathElements[20], pathIndices[20]

pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Compute the Merkle root from a leaf and its proof path
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // Intermediate hash values
    signal intermediateHashes[levels + 1];
    intermediateHashes[0] <== leaf;

    component hashers[levels];
    component muxes[levels];

    for (var i = 0; i < levels; i++) {
        // Ensure pathIndices are binary (0 or 1)
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        hashers[i] = Poseidon(2);

        // If pathIndices[i] == 0: hash(current, sibling)
        // If pathIndices[i] == 1: hash(sibling, current)
        
        // left input
        hashers[i].inputs[0] <== intermediateHashes[i] + 
            pathIndices[i] * (pathElements[i] - intermediateHashes[i]);
        
        // right input
        hashers[i].inputs[1] <== pathElements[i] + 
            pathIndices[i] * (intermediateHashes[i] - pathElements[i]);

        intermediateHashes[i + 1] <== hashers[i].out;
    }

    // Verify computed root matches the provided root
    root === intermediateHashes[levels];
}

// Compute commitment from nullifier and secret
template CommitmentHasher() {
    signal input nullifier;
    signal input secret;
    signal output commitment;
    signal output nullifierHash;

    // commitment = Poseidon(nullifier, secret)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;
    commitment <== commitmentHasher.out;

    // nullifierHash = Poseidon(nullifier)
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash <== nullifierHasher.out;
}

// Main SPECTRE circuit
template Spectre(levels) {
    // Public inputs
    signal input root;
    signal input nullifierHash;
    signal input recipient;      // Not used in constraints, prevents tampering
    signal input relayer;        // Not used in constraints, prevents tampering
    signal input fee;            // Not used in constraints, prevents tampering

    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // 1. Compute commitment and nullifier hash
    component hasher = CommitmentHasher();
    hasher.nullifier <== nullifier;
    hasher.secret <== secret;

    // 2. Verify nullifier hash matches
    hasher.nullifierHash === nullifierHash;

    // 3. Verify Merkle tree inclusion
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== hasher.commitment;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // 4. Add recipient, relayer, fee to constraint system
    // These are squared to create a constraint (prevents front-running)
    signal recipientSquare;
    signal relayerSquare;
    signal feeSquare;
    recipientSquare <== recipient * recipient;
    relayerSquare <== relayer * relayer;
    feeSquare <== fee * fee;
}

// Instantiate with depth 20
component main {public [root, nullifierHash, recipient, relayer, fee]} = Spectre(20);
