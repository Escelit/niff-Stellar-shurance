#![no_std]

mod claim;
mod policy;
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

    /// Pure quote path: reads config and computes premium only.
    /// This entrypoint intentionally performs no persistent writes.
    pub fn generate_premium(
        env: Env,
        policy_type: types::PolicyType,
        region: types::RegionTier,
        age: u32,
        risk_score: u32,
        include_breakdown: bool,
    ) -> Result<types::PremiumQuote, policy::QuoteError> {
        policy::generate_premium(
            &env,
            policy_type,
            region,
            age,
            risk_score,
            include_breakdown,
        )
    }

    /// Converts quote failure codes to support-friendly messages for API layers.
    pub fn quote_error_message(env: Env, code: u32) -> policy::QuoteFailure {
        let err = match code {
            1 => policy::QuoteError::InvalidAge,
            2 => policy::QuoteError::InvalidRiskScore,
            3 => policy::QuoteError::InvalidQuoteTtl,
            _ => policy::QuoteError::ArithmeticOverflow,
        };
        policy::map_quote_error(&env, err)
    }

    /// Read-only helper for monitoring state in tests / ops tooling.
    pub fn get_claim_counter(env: Env) -> u64 {
        storage::get_claim_counter(&env)
    }

    /// Read-only helper for monitoring state in tests / ops tooling.
    pub fn get_policy_counter(env: Env, holder: Address) -> u32 {
        storage::get_policy_counter(&env, &holder)
    }

    /// Read-only helper for monitoring state in tests / ops tooling.
    pub fn has_policy(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::has_policy(&env, &holder, policy_id)
    }

    // ── Policy domain ────────────────────────────────────────────────────

    /// Turn an accepted quote into an enforceable on-chain policy.
    ///
    /// Authenticates the holder, computes premium, transfers payment,
    /// persists the policy, updates the DAO voter registry, and emits
    /// a versioned `PolicyInitiated` event for NestJS indexers.
    pub fn initiate_policy(
        env: Env,
        holder: Address,
        policy_type: types::PolicyType,
        region: types::RegionTier,
        coverage: i128,
        age: u32,
        risk_score: u32,
    ) -> Result<types::Policy, policy::PolicyError> {
        policy::initiate_policy(&env, holder, policy_type, region, coverage, age, risk_score)
    }

    /// Read-only: retrieve a persisted policy by (holder, policy_id).
    pub fn get_policy(env: Env, holder: Address, policy_id: u32) -> Option<types::Policy> {
        storage::get_policy(&env, &holder, policy_id)
    }

    /// Read-only: number of active policies for a holder (= vote weight).
    pub fn get_active_policy_count(env: Env, holder: Address) -> u32 {
        storage::get_active_policy_count(&env, &holder)
    }

    // ── Admin / pause ────────────────────────────────────────────────────

    /// Admin-only: pause the contract (blocks initiate_policy and future
    /// mutating entrypoints).
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");
        storage::set_paused(&env, true);
    }

    /// Admin-only: unpause the contract.
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can unpause");
        storage::set_paused(&env, false);
    }

    /// Read-only: check if the contract is paused.
    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    // ── Claim domain ─────────────────────────────────────────────────────
    // file_claim, vote_on_claim
    // implemented in claim.rs — issue: feat/claim-voting

    // ── Admin / treasury ─────────────────────────────────────────────────
    // drain
    // implemented in token.rs — issue: feat/admin
}
