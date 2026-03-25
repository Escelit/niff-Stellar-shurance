use crate::types::{PolicyType, PremiumQuoteLineItem, RegionTier};
use soroban_sdk::{Env, String, Vec};

/// Base annual premium in stroops (1 XLM = 10_000_000 stroops).
#[allow(dead_code)]
const BASE: i128 = 10_000_000;

/// Returns the annual premium for the given risk profile.
/// Called from policy.rs once feat/policy-lifecycle lands.
#[allow(dead_code)]
pub fn compute_premium(
    policy_type: &PolicyType,
    region: &RegionTier,
    age: u32,
    risk_score: u32, // 1–10; higher = riskier
) -> i128 {
    let type_factor: i128 = match policy_type {
        PolicyType::Auto => 15,
        PolicyType::Health => 20,
        PolicyType::Property => 10,
    };
    let region_factor: i128 = match region {
        RegionTier::Low => 8,
        RegionTier::Medium => 10,
        RegionTier::High => 14,
    };
    let age_factor: i128 = if age < 25 {
        15
    } else if age > 60 {
        13
    } else {
        10
    };
    BASE * (type_factor + region_factor + age_factor + risk_score as i128) / 10
}

#[allow(dead_code)]
pub fn type_factor(policy_type: &PolicyType) -> i128 {
    match policy_type {
        PolicyType::Auto => 15,
        PolicyType::Health => 20,
        PolicyType::Property => 10,
    }
}

#[allow(dead_code)]
pub fn region_factor(region: &RegionTier) -> i128 {
    match region {
        RegionTier::Low => 8,
        RegionTier::Medium => 10,
        RegionTier::High => 14,
    }
}

#[allow(dead_code)]
pub fn age_factor(age: u32) -> i128 {
    if age < 25 {
        15
    } else if age > 60 {
        13
    } else {
        10
    }
}

#[allow(dead_code)]
pub fn compute_premium_checked(
    policy_type: &PolicyType,
    region: &RegionTier,
    age: u32,
    risk_score: u32,
) -> Option<i128> {
    let tf = type_factor(policy_type);
    let rf = region_factor(region);
    let af = age_factor(age);
    let raw = tf
        .checked_add(rf)?
        .checked_add(af)?
        .checked_add(risk_score as i128)?;
    BASE.checked_mul(raw)?.checked_div(10)
}

#[allow(dead_code)]
pub fn build_line_items(
    env: &Env,
    policy_type: &PolicyType,
    region: &RegionTier,
    age: u32,
    risk_score: u32,
) -> Option<Vec<PremiumQuoteLineItem>> {
    let tf = type_factor(policy_type);
    let rf = region_factor(region);
    let af = age_factor(age);
    let rsk = risk_score as i128;

    let base_type = BASE.checked_mul(tf)?.checked_div(10)?;
    let base_region = BASE.checked_mul(rf)?.checked_div(10)?;
    let base_age = BASE.checked_mul(af)?.checked_div(10)?;
    let base_risk = BASE.checked_mul(rsk)?.checked_div(10)?;

    let mut items = Vec::new(env);
    items.push_back(PremiumQuoteLineItem {
        component: String::from_str(env, "type"),
        factor: tf,
        amount: base_type,
    });
    items.push_back(PremiumQuoteLineItem {
        component: String::from_str(env, "region"),
        factor: rf,
        amount: base_region,
    });
    items.push_back(PremiumQuoteLineItem {
        component: String::from_str(env, "age"),
        factor: af,
        amount: base_age,
    });
    items.push_back(PremiumQuoteLineItem {
        component: String::from_str(env, "risk_score"),
        factor: rsk,
        amount: base_risk,
    });
    Some(items)
}
