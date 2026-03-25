#![cfg(test)]

use niffyinsure::{types::PolicyType, types::RegionTier, NiffyInsureClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn repeated_generate_premium_calls_do_not_mutate_counters_or_policy_map() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let holder = Address::generate(&env);
    let before_claim_counter = client.get_claim_counter();
    let before_policy_counter = client.get_policy_counter(&holder);
    let before_has_policy = client.has_policy(&holder, &1u32);

    let first =
        client.generate_premium(&PolicyType::Auto, &RegionTier::Medium, &30u32, &6u32, &true);
    let second = client.generate_premium(
        &PolicyType::Auto,
        &RegionTier::Medium,
        &30u32,
        &6u32,
        &false,
    );

    assert!(first.total_premium > 0);
    assert!(first.line_items.is_some());
    assert!(second.line_items.is_none());

    assert_eq!(before_claim_counter, client.get_claim_counter());
    assert_eq!(before_policy_counter, client.get_policy_counter(&holder));
    assert_eq!(before_has_policy, client.has_policy(&holder, &1u32));
}

#[test]
fn generate_premium_returns_structured_validation_errors() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let bad_age =
        client.try_generate_premium(&PolicyType::Auto, &RegionTier::Low, &0u32, &5u32, &false);
    assert!(bad_age.is_err());

    let bad_risk = client.try_generate_premium(
        &PolicyType::Health,
        &RegionTier::High,
        &45u32,
        &99u32,
        &false,
    );
    assert!(bad_risk.is_err());

    let age_msg = client.quote_error_message(&1u32);
    let risk_msg = client.quote_error_message(&2u32);

    assert_eq!(age_msg.code, 1u32);
    assert_eq!(risk_msg.code, 2u32);
    assert!(age_msg.message.len() > 0);
    assert!(risk_msg.message.len() > 0);
}
