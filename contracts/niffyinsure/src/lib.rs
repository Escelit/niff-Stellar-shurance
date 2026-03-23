#![no_std]

mod claim;
mod policy;
#[allow(dead_code)] // used by policy.rs once feat/policy-lifecycle lands
mod premium;
mod storage;
mod token;
pub mod types;
pub mod validate;

use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct NiffyInsure;

#[contractimpl]
impl NiffyInsure {
    /// One-time initialisation: store admin and token contract address.
    /// Must be called immediately after deployment.
    pub fn initialize(env: Env, admin: Address, token: Address) {
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
    }

    // ── Policy domain ────────────────────────────────────────────────────
    // generate_premium, initiate_policy, renew_policy, terminate_policy
    // implemented in policy.rs — issue: feat/policy-lifecycle

    // ── Claim domain ─────────────────────────────────────────────────────
    // file_claim, vote_on_claim
    // implemented in claim.rs — issue: feat/claim-voting

    // ── Admin / treasury ─────────────────────────────────────────────────
    // drain
    // implemented in token.rs — issue: feat/admin
}
