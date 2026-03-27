// Claim lifecycle and DAO voting will be implemented here.
//
// Planned public functions:
//   file_claim(env, policy_id, amount, details, image_urls)
//   vote_on_claim(env, voter, claim_id, vote)
//
// Open claim accounting: `storage::OpenClaimCount(holder, policy_id)` must be
// incremented when a claim enters `Processing` and decremented when it reaches
// a terminal status (`Approved` / `Rejected`), so policy termination can block
// or audit in-flight claims. Until `file_claim` ships, admins may use
// `admin_set_open_claim_count` in tests or break-glass ops only.
use crate::{
    events,
    ledger,
    storage,
    types::{Claim, ClaimStatus, VoteOption},
    validate::Error,
};
use soroban_sdk::{token, Address, Env, String, Vec};

// ── file_claim ────────────────────────────────────────────────────────────────

/// File a new claim against an active policy.
///
/// Window checks (all via `ledger` helpers):
/// - Policy must be active: `now` in `[start_ledger, end_ledger)`.
/// - Rate-limit: `now >= last_filed_at + RATE_LIMIT_WINDOW_LEDGERS` (or first claim).
///
/// Returns the new `claim_id`.
pub fn file_claim(
    env: &Env,
    holder: &Address,
    policy_id: u32,
    amount: i128,
    details: &String,
    image_urls: &Vec<String>,
) -> Result<u64, Error> {
    let policy = storage::get_policy(env, holder, policy_id).ok_or(Error::ClaimNotFound)?;

    // Policy active window check using ledger helper.
    let now = env.ledger().sequence();
    if !ledger::is_within_window(now, policy.start_ledger, policy.end_ledger) {
        return if ledger::is_expired(now, policy.end_ledger) {
            Err(Error::PolicyExpired)
        } else {
            Err(Error::PolicyInactive)
        };
    }
    if !policy.is_active {
        return Err(Error::PolicyInactive);
    }

    // Rate-limit check.
    if let Some(last) = storage::get_last_claim_ledger(env, holder) {
        if !ledger::is_rate_limit_elapsed(now, last, ledger::RATE_LIMIT_WINDOW_LEDGERS) {
            return Err(Error::RateLimitExceeded);
        }
    }

    crate::validate::check_claim_fields(env, amount, policy.coverage, details, image_urls)?;

    let claim_id = storage::next_claim_id(env);
    let claim = Claim {
        claim_id,
        policy_id,
        claimant: holder.clone(),
        amount,
        asset: policy.asset.clone(),
        details: details.clone(),
        image_urls: image_urls.clone(),
        status: ClaimStatus::Processing,
        approve_votes: 0,
        reject_votes: 0,
        filed_at: now,
        paid_at: None,
    };

    storage::set_claim(env, &claim);
    storage::snapshot_claim_voters(env, claim_id);
    storage::set_last_claim_ledger(env, holder, now);

    // Hash the image URLs into a compact u64 for the event payload.
    let image_hash = hash_image_urls(image_urls);
    events::emit_claim_filed(env, claim_id, holder, policy_id, amount, image_hash, now);

    Ok(claim_id)
}

// ── vote_on_claim ─────────────────────────────────────────────────────────────

/// Cast a vote on a pending claim.
///
/// Window check: `now < filed_at + VOTE_WINDOW_LEDGERS` (via `ledger::is_vote_open`).
/// Returns the updated `ClaimStatus` after tallying.
pub fn vote_on_claim(
    env: &Env,
    voter: &Address,
    claim_id: u64,
    vote: &VoteOption,
) -> Result<ClaimStatus, Error> {
    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status.is_terminal() {
        return Err(Error::ClaimAlreadyTerminal);
    }

    // Voting window check.
    let now = env.ledger().sequence();
    if !ledger::is_vote_open(now, claim.filed_at, ledger::VOTE_WINDOW_LEDGERS) {
        return Err(Error::VotingWindowClosed);
    }

    // Voter must be in the claim's snapshot electorate.
    let snapshot = storage::get_claim_voters(env, claim_id);
    let eligible = snapshot.iter().any(|v| v == *voter);
    if !eligible {
        return Err(Error::NotEligibleVoter);
    }

    // Duplicate vote check — before any write.
    if storage::get_vote(env, claim_id, voter).is_some() {
        return Err(Error::DuplicateVote);
    }

    storage::set_vote(env, claim_id, voter, vote);

    match vote {
        VoteOption::Approve => claim.approve_votes += 1,
        VoteOption::Reject => claim.reject_votes += 1,
    }

    events::emit_vote_cast(env, claim_id, voter, vote.clone(), claim.approve_votes, claim.reject_votes);

    // Auto-finalize on majority.
    let total = snapshot.len();
    let majority = total / 2 + 1;
    if claim.approve_votes >= majority {
        claim.status = ClaimStatus::Approved;
        events::emit_claim_finalized(env, claim_id, ClaimStatus::Approved, claim.approve_votes, claim.reject_votes);
    } else if claim.reject_votes >= majority {
        claim.status = ClaimStatus::Rejected;
        events::emit_claim_finalized(env, claim_id, ClaimStatus::Rejected, claim.approve_votes, claim.reject_votes);
    }

    storage::set_claim(env, &claim);
    Ok(claim.status)
}

// ── finalize_claim ────────────────────────────────────────────────────────────

/// Finalize a claim after the voting deadline has passed.
///
/// Window check: `now >= filed_at + VOTE_WINDOW_LEDGERS` (via `ledger::is_vote_deadline_passed`).
/// Plurality wins; tie resolves to Rejected.
pub fn finalize_claim(env: &Env, claim_id: u64) -> Result<ClaimStatus, Error> {
    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status.is_terminal() {
        return Err(Error::ClaimAlreadyTerminal);
    }

    let now = env.ledger().sequence();
    if !ledger::is_vote_deadline_passed(now, claim.filed_at, ledger::VOTE_WINDOW_LEDGERS) {
        return Err(Error::VotingWindowStillOpen);
    }

    claim.status = if claim.approve_votes > claim.reject_votes {
        ClaimStatus::Approved
    } else {
        // Tie or reject plurality → Rejected (insurer wins tie).
        ClaimStatus::Rejected
    };

    events::emit_claim_finalized(env, claim_id, claim.status.clone(), claim.approve_votes, claim.reject_votes);

    storage::set_claim(env, &claim);
    Ok(claim.status)
}

// ── process_claim (admin payout trigger) ─────────────────────────────────────

pub fn process_claim(env: &Env, claim_id: u64) -> Result<(), Error> {
    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status == ClaimStatus::Paid {
        return Err(Error::AlreadyPaid);
    }
    if claim.status != ClaimStatus::Approved {
        return Err(Error::ClaimNotApproved);
    }
    if claim.amount <= 0 {
        return Err(Error::ClaimAmountZero);
    }

    // Verify the claim's asset is still allowlisted (admin may have removed it).
    if !storage::is_allowed_asset(env, &claim.asset) {
        return Err(Error::InvalidAsset);
    }

    // Verify the claim's asset matches the policy's bound asset.
    if let Some(policy) = storage::get_policy(env, &claim.claimant, claim.policy_id) {
        if claim.asset != policy.asset {
            return Err(Error::InvalidAsset);
        }
    }

    let token_client = token::Client::new(env, &claim.asset);
    let treasury = env.current_contract_address();

    if token_client.balance(&treasury) < claim.amount {
        return Err(Error::InsufficientTreasury);
    }

    token_client.transfer(&treasury, &claim.claimant, &claim.amount);

    let now = env.ledger().sequence();
    claim.status = ClaimStatus::Paid;
    claim.paid_at = Some(now);
    storage::set_claim(env, &claim);

    events::emit_claim_paid(env, claim_id, &claim.claimant, claim.amount, &claim.asset);

    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn get_claim(env: &Env, claim_id: u64) -> Result<Claim, Error> {
    storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)
}

pub fn is_allowed_asset(env: &Env, asset: &Address) -> bool {
    storage::is_allowed_asset(env, asset)
}

pub fn set_allowed_asset(env: &Env, asset: &Address, allowed: bool) {
    storage::set_allowed_asset(env, asset, allowed);
}

/// FNV-1a hash of concatenated IPFS CID bytes, truncated to u64.
/// Compact enough for event payload; full CIDs are stored off-chain.
fn hash_image_urls(urls: &Vec<String>) -> u64 {
    const FNV_OFFSET: u64 = 14695981039346656037;
    const FNV_PRIME: u64 = 1099511628211;
    let mut hash: u64 = FNV_OFFSET;
    for url in urls.iter() {
        let bytes = url.to_bytes();
        for i in 0..bytes.len() {
            hash ^= bytes.get(i).unwrap_or(0) as u64;
            hash = hash.wrapping_mul(FNV_PRIME);
        }
    }
    hash
}
