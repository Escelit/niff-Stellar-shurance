# niff-Stellar-shurance

Decentralized insurance platform built on the Stellar/Soroban blockchain.

## Setup

```bash
# 1. Clone
git clone https://github.com/your-org/niff-Stellar-shurance.git && cd niff-Stellar-shurance

# 2. Install
cp frontend/.env.example frontend/.env.local   # fill in values
cd frontend && npm install

# 3. Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Requirements

- Node.js `>=22` (see `.nvmrc`)
- npm `>=10`

## Project Structure

```
frontend/src/
├── app/          # Next.js App Router routes & layouts
├── features/     # Feature modules: policies/, claims/, wallet/
│   └── <feature>/{components,hooks,api}/
├── components/ui/ # Shared primitive components (Shadcn-style)
├── lib/          # Utilities, Stellar SDK wrappers, schemas
└── styles/       # Global CSS and Tailwind theme tokens

frontend/messages/
├── en/           # English (source of truth)
└── es/           # Spanish
```

## Quality Gates

```bash
npm run lint               # ESLint (fails on warnings)
npm run check-translations # Verify no keys missing in secondary locales
npm run build              # Production build
```

CI runs all sequentially on every push/PR to `main`.

## Environment Variables

Copy `frontend/.env.example` → `frontend/.env.local`.

- `NEXT_PUBLIC_*` variables are safe for the browser.
- All other variables are **server-only** — never import them in Client Components.

## Translation Workflow

Message catalogs live in `frontend/messages/<locale>/` split by domain:

| File | Domain |
|------|--------|
| `common.json` | Buttons, nav, errors |
| `policy.json` | Quotes, coverage, premiums |
| `claims.json` | Filing forms, status updates |
| `wallet.json` | Balances, transaction history |

**Adding a new language:**

1. Create `frontend/messages/<locale>/` and copy all four JSON files from `en/`.
2. Translate every value. Do **not** remove or rename keys — the CI check will fail.
3. Add the locale to `src/i18n/routing.ts` → `locales` array.
4. Add a display label in `src/components/LocaleSwitcher.tsx` → `LABELS`.
5. Run `npm run check-translations` locally to verify completeness.
6. Legal copy rendered via `<LegalText>` components requires sign-off before shipping — look for `// TRANSLATION REVIEW` comments.

**ICU Message Format** is used for variables — never concatenate strings in components:

```json
{ "xlmBalance": "You have {amount} XLM" }
```

```tsx
t('xlmBalance', { amount: '42.5' })
```
