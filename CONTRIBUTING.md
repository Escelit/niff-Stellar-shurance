# Contributing to NiffyInsure

## Development Environment

### Required Tools

- **Rust** (1.81+) - Install via [rustup](https://rustup.rs/)
- **wasm32-unknown-unknown target** - `rustup target add wasm32-unknown-unknown`
- **Soroban CLI** - `cargo install stellar-cli`
- **Node.js** (22+) - For backend/frontend
- **Docker** - For running local Stellar quickstart (optional)

### Quick Start

```bash
# Install Rust and wasm target
rustup target add wasm32-unknown-unknown

# Run contract tests
cd contracts/niffyinsure
cargo test

# Build WASM
cargo build --target wasm32-unknown-unknown --release

# Run backend tests
cd ../backend
npm install
npm test
```

### Dockerized Stellar (Optional)

For integration testing with a local Stellar network:

```bash
# Start Stellar quickstart
docker run --rm -it \
  --name stellar \
  -p 8000:8000 \
  stellar/quickstart:latest \
  --standalone

# Then use stellar CLI to interact
stellar contract deploy ...
```

## Testing

### Contract Tests

Run all contract tests:

```bash
cd contracts/niffyinsure
cargo test
```

Run specific test:

```bash
cargo test --test voting
```

### Test Structure

- `tests/integration.rs` - Basic initialization and auth tests
- `tests/admin.rs` - Admin privilege matrix tests
- `tests/voting.rs` - DAO voting tests
- `tests/termination.rs` - Policy termination tests
- `tests/security.rs` - Security-focused tests
- `tests/premium.rs` - Premium calculation tests

### Writing Tests

All tests use the Soroban test harness with deterministic `Env` setups:

```rust
#[test]
fn my_test() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    
    // Test code here
}
```

## Entrypoint Coverage Checklist

| Entrypoint | Happy Path | Negative Tests | Status |
|------------|------------|----------------|--------|
| `initialize` | ✅ | ✅ (double init, wrong admin) | Complete |
| `generate_premium` | ✅ | ✅ (invalid inputs) | Complete |
| `get_multiplier_table` | ✅ | - | Complete |
| `set_allowed_asset` | ✅ | ✅ (non-admin) | Complete |
| `is_allowed_asset` | ✅ | - | Complete |
| `process_claim` | ✅ | ✅ (not approved, already paid) | Complete |
| `get_claim` | ✅ | ✅ (not found) | Complete |
| `get_claim_counter` | ✅ | - | Complete |
| `get_policy_counter` | ✅ | - | Complete |
| `has_policy` | ✅ | - | Complete |
| `get_voters` | ✅ | - | Complete |
| `initiate_policy` | ✅ | ✅ (paused, duplicate, invalid) | Complete |
| `get_policy` | ✅ | ✅ (not found) | Complete |
| `get_active_policy_count` | ✅ | - | Complete |
| `pause` | ✅ | ✅ (non-admin) | Complete |
| `unpause` | ✅ | ✅ (non-admin) | Complete |
| `is_paused` | ✅ | - | Complete |
| `propose_admin` | ✅ | ✅ (non-admin) | Complete |
| `accept_admin` | ✅ | ✅ (no proposal) | Complete |
| `cancel_admin` | ✅ | ✅ (no proposal) | Complete |
| `set_token` | ✅ | ✅ (non-admin) | Complete |
| `set_treasury` | ✅ | ✅ (non-admin) | Complete |
| `drain` | ✅ | ✅ (non-admin, zero amount) | Complete |
| `file_claim` | ✅ | ✅ (not found, expired, paused) | Complete |
| `vote_on_claim` | ✅ | ✅ (not eligible, duplicate, paused) | Complete |
| `finalize_claim` | ✅ | ✅ (window still open) | Complete |
| `renew_policy` | ✅ | ✅ (not found, paused) | - |
| `terminate_policy` | ✅ | ✅ (not found, unauthorized) | Complete |

### Coverage Requirements

- **Each public entrypoint must have at least one positive test**
- **Each entrypoint that can fail must have at least one negative test**
- **New features require test updates** (enforced in PR review)

## CI/CD

### GitHub Actions

The CI runs on every pull request:

1. **Contract tests** - `cargo test`
2. **Linting** - `cargo fmt --check`, `cargo clippy`
3. **Build** - `cargo build --target wasm32-unknown-unknown --release`
4. **Backend tests** - `npm test`
5. **Frontend tests** - `npm test`

### Caching

Dependencies are cached using GitHub Actions cache to speed up CI runs.

## Code Style

- Run `cargo fmt` before committing
- Run `cargo clippy` to catch common mistakes
- Use meaningful test names: `fn test_name_describes_scenario()`

## Issue Lifecycle

1. Create issue with clear description
2. Create feature branch: `feat/description` or `fix/description`
3. Add tests for new functionality
4. Update coverage checklist in this file
5. Open PR for review
6. CI must pass before merge
