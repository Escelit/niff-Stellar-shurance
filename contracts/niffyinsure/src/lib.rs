#![no_std]

mod admin;
mod calculator;
mod claim;
mod policy;
mod premium;
mod storage;
mod token;
pub mod types;
pub mod validate;

use soroban_sdk::{contract, contractimpl, contracterror, Address, Env, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum InitError {
    AlreadyInitialized = 200,
}

#[contract]
pub struct NiffyInsure;

#[contractimpl]
impl NiffyInsure {
    /// One-time initialisation: store admin and token contract address, and
    /// seed the default premium table so quote generation is deterministic.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), InitError> {
        if env.storage().instance().has(&storage::DataKey::Admin) {
            return Err(InitError::AlreadyInitialized);
        }
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_multiplier_table(&env, &premium::default_multiplier_table(&env));
        storage::set_allowed_asset(&env, &token, true);
        Ok(())
    }

    // ── Admin: read ───────────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    // ── Admin: calculator address management ──────────────────────────────────

    /// Admin-only: point the policy contract at an external PremiumCalculator.
    ///
    /// After this call `generate_premium` and `initiate_policy` will delegate
    /// pricing to the remote contract.  Set to the zero address (or call
    /// `clear_calculator`) to revert to the built-in engine.
    ///
    /// Emits: ("calc", "set") → (old_addr_or_none, new_addr)
    pub fn set_calculator(env: Env, calc_addr: Address) {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        let old = storage::get_calc_address(&env);
        storage::set_calc_address(&env, &calc_addr);
        env.events().publish(
            (soroban_sdk::symbol_short!("calc"), soroban_sdk::symbol_short!("set")),
            (old, calc_addr),
        );
    }

    /// Returns the currently configured calculator address, if any.
    pub fn get_calculator(env: Env) -> Option<Address> {
        storage::get_calc_address(&env)
    }

    /// Admin-only: remove the external calculator, reverting to built-in pricing.
    pub fn clear_calculator(env: Env) {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        env.storage().instance().remove(&storage::DataKey::CalcAddress);
        env.events().publish(
            (soroban_sdk::symbol_short!("calc"), soroban_sdk::symbol_short!("cleared")),
            (),
        );
    }

    // ── Premium / quote ───────────────────────────────────────────────────────

    /// Pure quote path: reads config and computes premium only.
    /// Routes to the external calculator when one is configured.
    pub fn generate_premium(
        env: Env,
        input: types::RiskInput,
        base_amount: i128,
        include_breakdown: bool,
    ) -> Result<types::PremiumQuote, validate::Error> {
        validate::check_risk_input(&input)?;
        if base_amount <= 0 {
            return Err(validate::Error::InvalidBaseAmount);
        }
        calculator::compute_quote(
            &env,
            &input,
            base_amount,
            include_breakdown,
            policy::QUOTE_TTL_LEDGERS,
        )
    }

    pub fn quote_error_message(env: Env, code: u32) -> policy::QuoteFailure {
        let err = match code {
            1 => validate::Error::ZeroCoverage,
            2 => validate::Error::ZeroPremium,
            3 => validate::Error::InvalidLedgerWindow,
            4 => validate::Error::PolicyExpired,
            5 => validate::Error::PolicyInactive,
            6 => validate::Error::ClaimAmountZero,
            7 => validate::Error::ClaimExceedsCoverage,
            8 => validate::Error::DetailsTooLong,
            9 => validate::Error::TooManyImageUrls,
            10 => validate::Error::ImageUrlTooLong,
            11 => validate::Error::ReasonTooLong,
            12 => validate::Error::ClaimAlreadyTerminal,
            13 => validate::Error::DuplicateVote,
            14 => validate::Error::InvalidBaseAmount,
            15 => validate::Error::SafetyScoreOutOfRange,
            16 => validate::Error::InvalidConfigVersion,
            17 => validate::Error::MissingRegionMultiplier,
            18 => validate::Error::MissingAgeMultiplier,
            19 => validate::Error::MissingCoverageMultiplier,
            20 => validate::Error::RegionMultiplierOutOfBounds,
            21 => validate::Error::AgeMultiplierOutOfBounds,
            22 => validate::Error::CoverageMultiplierOutOfBounds,
            23 => validate::Error::SafetyDiscountOutOfBounds,
            24 => validate::Error::Overflow,
            25 => validate::Error::DivideByZero,
            26 => validate::Error::InvalidQuoteTtl,
            27 => validate::Error::NegativePremiumNotSupported,
            28 => validate::Error::ClaimNotFound,
            29 => validate::Error::InvalidAsset,
            30 => validate::Error::InsufficientTreasury,
            31 => validate::Error::AlreadyPaid,
            33 => validate::Error::CalculatorNotSet,
            34 => validate::Error::CalculatorCallFailed,
            35 => validate::Error::CalculatorPaused,
            _ => validate::Error::ClaimNotApproved,
        };
        policy::map_quote_error(&env, err)
    }

    pub fn update_multiplier_table(
        env: Env,
        new_table: types::MultiplierTable,
    ) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        premium::update_multiplier_table(&env, &new_table)
    }

    pub fn get_multiplier_table(env: Env) -> types::MultiplierTable {
        storage::get_multiplier_table(&env)
    }

    pub fn set_allowed_asset(env: Env, asset: Address, allowed: bool) {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        claim::set_allowed_asset(&env, &asset, allowed);
    }

    pub fn is_allowed_asset(env: Env, asset: Address) -> bool {
        claim::is_allowed_asset(&env, &asset)
    }

    pub fn process_claim(env: Env, claim_id: u64) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        claim::process_claim(&env, claim_id)
    }

    pub fn get_claim(env: Env, claim_id: u64) -> Result<types::Claim, validate::Error> {
        claim::get_claim(&env, claim_id)
    }

    pub fn get_claim_counter(env: Env) -> u64 {
        storage::get_claim_counter(&env)
    }

    pub fn get_policy_counter(env: Env, holder: Address) -> u32 {
        storage::get_policy_counter(&env, &holder)
    }

    pub fn has_policy(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::has_policy(&env, &holder, policy_id)
    }

    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    pub fn get_voters(env: Env) -> Vec<Address> {
        storage::get_voters(&env)
    }

    // ── Policy domain ─────────────────────────────────────────────────────────

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

    pub fn get_policy(env: Env, holder: Address, policy_id: u32) -> Option<types::Policy> {
        storage::get_policy(&env, &holder, policy_id)
    }

    pub fn get_active_policy_count(env: Env, holder: Address) -> u32 {
        storage::get_active_policy_count(&env, &holder)
    }

    // ── Admin / pause ─────────────────────────────────────────────────────────

    pub fn pause(env: Env) {
        admin::pause(&env);
    }

    pub fn unpause(env: Env) {
        admin::unpause(&env);
    }

    // ── Admin rotation ────────────────────────────────────────────────────────

    pub fn propose_admin(env: Env, new_admin: Address) {
        admin::propose_admin(&env, new_admin);
    }

    pub fn accept_admin(env: Env) {
        admin::accept_admin(&env);
    }

    pub fn cancel_admin(env: Env) {
        admin::cancel_admin(&env);
    }

    // ── Test-only helpers ─────────────────────────────────────────────────────
    #[cfg(feature = "testutils")]
    pub fn test_seed_policy(
        env: Env,
        holder: Address,
        policy_id: u32,
        coverage: i128,
        end_ledger: u32,
    ) {
        use crate::types::{Policy, PolicyType, RegionTier};
        let policy = Policy {
            holder: holder.clone(),
            policy_id,
            policy_type: PolicyType::Auto,
            region: RegionTier::Medium,
            premium: 10_000_000,
            coverage,
            is_active: true,
            start_ledger: 1,
            end_ledger,
        };
        env.storage()
            .persistent()
            .set(&storage::DataKey::Policy(holder.clone(), policy_id), &policy);
        storage::add_voter(&env, &holder);
    }

    #[cfg(feature = "testutils")]
    pub fn test_remove_voter(env: Env, holder: Address) {
        storage::remove_voter(&env, &holder);
    }
}

pub use admin::AdminError;
