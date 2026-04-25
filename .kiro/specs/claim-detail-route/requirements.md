# Requirements Document

## Introduction

The `/claims/[id]` route is currently a stub that only renders `ClaimVotePanel`. This feature expands it into a full claim detail page featuring: an evidence gallery backed by IPFS with multi-gateway failover, a lazy-loaded lightbox with keyboard navigation, a textual timeline sourced from indexer events, voter identity display with privacy controls, a 404 state for unknown claim IDs, XSS-safe rendering of user-provided text, rate-limited data refetching, and privacy-reviewed Open Graph metadata.

## Glossary

- **Claim_Page**: The Next.js App Router page rendered at `/claims/[claimId]`.
- **Evidence_Gallery**: The UI component that displays all IPFS-hosted evidence images for a claim.
- **Lightbox**: The full-screen overlay component used to inspect a single evidence image.
- **IPFS_Gateway_Client**: The client-side module responsible for resolving IPFS CIDs to HTTP URLs using an ordered fallback list.
- **Gateway_List**: The ordered list of IPFS gateway base URLs read from configuration; the first healthy gateway is used.
- **Timeline**: The UI component that renders the ordered sequence of on-chain events for a claim (filed → votes cast → finalized → payout).
- **Indexer**: The backend service that ingests on-chain events and exposes them via the REST API.
- **Claim_API**: The existing `ClaimAPI` class in `frontend/src/lib/api/claim.ts`.
- **Claim_Type**: The `Claim` interface in `frontend/src/lib/api/claim.ts`.
- **Sanitizer**: The client-side HTML sanitization utility that strips unsafe markup from user-provided text before rendering.
- **Voter**: An on-chain account that has cast a vote on a claim.
- **OG_Tags**: Open Graph `<meta>` tags embedded in the page `<head>` for link-preview sharing.
- **Refetch_Guard**: The client-side mechanism that enforces a minimum interval between successive API calls for the same claim.

---

## Requirements

### Requirement 1: Claim Data Model Extension

**User Story:** As a frontend developer, I want the `Claim` type and `ClaimAPI.getClaim` to include evidence, timeline, and voter fields, so that the detail page can render all required sections without additional ad-hoc fetches.

#### Acceptance Criteria

1. THE `Claim_Type` SHALL include an `imageUrls` field containing zero or more IPFS CID strings or gateway URLs for evidence images.
2. THE `Claim_Type` SHALL include an `evidenceHash` field containing the SHA-256 hex digest of the evidence bundle, or `null` when no evidence was submitted.
3. THE `Claim_Type` SHALL include a `createdAtLedger` field containing the ledger sequence number at which the claim was filed.
4. THE `Claim_Type` SHALL include a `timelineEvents` field containing an ordered array of `ClaimTimelineEvent` objects, where each event has a `status` string, a `ledger` number, and an optional `txHash` string.
5. THE `Claim_Type` SHALL include a `voters` field containing an array of `ClaimVoter` objects, where each voter has a `address` string, a `vote` string (`"approve"` or `"reject"`), and an `isPublic` boolean.
6. WHEN `ClaimAPI.getClaim` receives a 404 response from the backend, THE `Claim_API` SHALL throw an error with a `status` property equal to `404`.

---

### Requirement 2: IPFS Gateway Failover

**User Story:** As a user, I want evidence images to load even when the primary IPFS gateway is unavailable, so that broken infrastructure does not prevent me from reviewing claim evidence.

#### Acceptance Criteria

1. THE `IPFS_Gateway_Client` SHALL read an ordered `Gateway_List` from configuration, with `NEXT_PUBLIC_IPFS_GATEWAY` as the first entry and at least two additional public fallback gateways as defaults.
2. WHEN a gateway URL for a given CID returns an HTTP error or times out within 8 seconds, THE `IPFS_Gateway_Client` SHALL attempt the next gateway in the `Gateway_List`.
3. WHEN all gateways in the `Gateway_List` have failed for a given CID, THE `IPFS_Gateway_Client` SHALL resolve with a `null` URL so the `Evidence_Gallery` can render a broken-image placeholder.
4. THE `IPFS_Gateway_Client` SHALL expose a `resolveUrl(cid: string): Promise<string | null>` function that encapsulates the failover logic.
5. THE `Gateway_List` SHALL be configurable via a `NEXT_PUBLIC_IPFS_GATEWAY_FALLBACKS` environment variable containing a comma-separated list of URLs, falling back to hardcoded defaults when the variable is absent.

---

### Requirement 3: Evidence Gallery

**User Story:** As a claimant reviewer, I want to browse all evidence images for a claim in a responsive gallery, so that I can assess the submitted evidence on any device.

#### Acceptance Criteria

1. THE `Evidence_Gallery` SHALL render one thumbnail per entry in `Claim_Type.imageUrls`, resolved through the `IPFS_Gateway_Client`.
2. THE `Evidence_Gallery` SHALL lazy-load each thumbnail image using the `loading="lazy"` attribute.
3. WHEN an image has a meaningful description derivable from its filename or metadata, THE `Evidence_Gallery` SHALL set a descriptive `alt` attribute on the `<img>` element; otherwise it SHALL set `alt=""`.
4. WHEN a thumbnail fails to load, THE `Evidence_Gallery` SHALL display a visible broken-image placeholder with the text "Image unavailable".
5. WHEN `Claim_Type.imageUrls` is empty, THE `Evidence_Gallery` SHALL render a "No evidence submitted" empty state.
6. WHILE images are being resolved by the `IPFS_Gateway_Client`, THE `Evidence_Gallery` SHALL render skeleton placeholders using the existing `skeleton.tsx` primitive.
7. THE `Evidence_Gallery` SHALL be responsive and display correctly on viewports as narrow as 320 px, using a single-column layout on mobile and a multi-column grid on wider viewports.

---

### Requirement 4: Lightbox Component

**User Story:** As a reviewer, I want to open an evidence image in a full-screen lightbox, so that I can inspect it in detail without leaving the page.

#### Acceptance Criteria

1. WHEN a user activates a thumbnail (click or Enter/Space keypress), THE `Lightbox` SHALL open and display the full-resolution image.
2. WHEN the `Lightbox` is open, THE `Lightbox` SHALL trap keyboard focus within the overlay.
3. WHEN the `Lightbox` is open and the user presses the Escape key, THE `Lightbox` SHALL close and return focus to the thumbnail that opened it.
4. WHEN the `Lightbox` is open and the claim has more than one evidence image, THE `Lightbox` SHALL render previous and next navigation controls.
5. WHEN a navigation control is activated, THE `Lightbox` SHALL advance to the adjacent image and update the visible image without closing the overlay.
6. THE `Lightbox` SHALL be implemented using the existing `dialog.tsx` primitive.
7. THE `Lightbox` SHALL expose a visible close button with an accessible label of "Close lightbox".
8. WHEN the `Lightbox` is open, THE `Lightbox` SHALL set `aria-modal="true"` and `role="dialog"` on the overlay element.

---

### Requirement 5: Claim Timeline

**User Story:** As a reviewer, I want to see a chronological timeline of on-chain events for a claim, so that I can understand its history from filing through resolution.

#### Acceptance Criteria

1. THE `Timeline` SHALL render events in the order provided by `Claim_Type.timelineEvents`, which reflects the Indexer's event ordering.
2. THE `Timeline` SHALL display at minimum the following event types when present: `filed`, `vote_cast`, `finalized`, and `payout`.
3. WHEN a `timelineEvents` entry includes a `txHash`, THE `Timeline` SHALL render it as a link to the Stellar block explorer using `getConfig().explorerBase`.
4. THE `Timeline` SHALL use a `<ol>` element with `role="list"` so that assistive technologies announce the number of steps.
5. WHEN `Claim_Type.timelineEvents` is empty, THE `Timeline` SHALL render a "No events recorded" empty state.
6. WHILE claim data is loading, THE `Timeline` SHALL render skeleton placeholders.

---

### Requirement 6: Voter Identity Display

**User Story:** As a reviewer, I want to see who voted on a claim while respecting voter privacy preferences, so that I can assess the legitimacy of the vote tally without exposing private identities.

#### Acceptance Criteria

1. WHEN a `ClaimVoter.isPublic` is `true`, THE `Claim_Page` SHALL display the voter's truncated wallet address (first 6 and last 4 characters separated by "…").
2. WHEN a `ClaimVoter.isPublic` is `false`, THE `Claim_Page` SHALL display "Anonymous voter" in place of the address.
3. THE `Claim_Page` SHALL display the vote direction (`"Approve"` or `"Reject"`) alongside each voter entry regardless of `isPublic`.
4. WHEN `Claim_Type.voters` is empty, THE `Claim_Page` SHALL render a "No votes recorded" empty state.

---

### Requirement 7: 404 State for Unknown Claims

**User Story:** As a user who navigates to a non-existent claim URL, I want a helpful error page, so that I can find my way back to the claims board without confusion.

#### Acceptance Criteria

1. WHEN `ClaimAPI.getClaim` throws an error with `status === 404`, THE `Claim_Page` SHALL render a 404 state instead of the claim detail layout.
2. THE 404 state SHALL include a human-readable message such as "Claim not found".
3. THE 404 state SHALL include a navigation link with the text "Back to claims board" that routes to `/claims`.
4. THE `Claim_Page` SHALL call Next.js `notFound()` so that the HTTP response status is 404 when rendered server-side.

---

### Requirement 8: XSS Sanitization

**User Story:** As a security-conscious developer, I want all user-provided text rendered to HTML to be sanitized, so that malicious scripts cannot execute in a reviewer's browser.

#### Acceptance Criteria

1. THE `Sanitizer` SHALL strip all HTML tags and attributes not present on an explicit allowlist before any user-provided string is rendered via `dangerouslySetInnerHTML` or equivalent.
2. THE `Sanitizer` SHALL remove `<script>`, `<iframe>`, `<object>`, `<embed>`, and `<form>` elements and all event-handler attributes (e.g. `onclick`, `onerror`) from any input string.
3. WHEN a user-provided string contains no HTML, THE `Sanitizer` SHALL return the string unchanged.
4. THE `Claim_Page` SHALL pass `Claim_Type.description` through the `Sanitizer` before rendering.
5. THE `Sanitizer` SHALL be implemented using an established library (e.g. DOMPurify) rather than custom regex.

---

### Requirement 9: Rate-Limited Client Refetching

**User Story:** As a system operator, I want the claim detail page to enforce a minimum interval between successive API calls, so that rapid navigation or polling bugs do not cause excessive backend load.

#### Acceptance Criteria

1. THE `Refetch_Guard` SHALL enforce a minimum interval of 10 seconds between successive `ClaimAPI.getClaim` calls for the same `claimId`.
2. WHEN a refetch is requested before the minimum interval has elapsed, THE `Refetch_Guard` SHALL return the cached response from the previous call without issuing a new network request.
3. WHEN the `Claim_Page` unmounts, THE `Refetch_Guard` SHALL cancel any pending refetch timers to prevent state updates on unmounted components.
4. THE `Refetch_Guard` SHALL not apply to the initial page load fetch.

---

### Requirement 10: Open Graph Metadata and Privacy

**User Story:** As a product owner, I want the claim detail page to emit Open Graph tags for link previews, while ensuring that private voter identities and sensitive claim details are not exposed in shared URLs.

#### Acceptance Criteria

1. THE `Claim_Page` SHALL emit an `og:title` tag containing the claim ID and status (e.g. "Claim #42 — Pending").
2. THE `Claim_Page` SHALL emit an `og:description` tag containing a sanitized excerpt of `Claim_Type.description`, truncated to 160 characters.
3. THE `Claim_Page` SHALL NOT include voter wallet addresses in any `OG_Tags`.
4. THE `Claim_Page` SHALL NOT include `evidenceHash` or raw IPFS CIDs in any `OG_Tags`.
5. THE `Claim_Page` SHALL emit a canonical `og:url` tag containing the absolute URL of the claim detail page.
