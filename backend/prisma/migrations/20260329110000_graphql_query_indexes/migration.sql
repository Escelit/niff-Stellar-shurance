-- GraphQL nested policy -> claims and claim -> votes lookups.
-- These composite indexes mirror the actual filtered query shapes used by the
-- GraphQL loaders and keep staging load-test fan-out predictable.
--
-- Index: claims_policyId_deleted_at_createdAt_idx
--   Used by: PolicyResolver.claims DataLoader batch
--   Query:   SELECT * FROM claims WHERE "policyId" = ANY($1) AND deleted_at IS NULL ORDER BY "createdAt" DESC
--   Verified: graphql.integration.spec.ts - "batches policy -> claims lookups"
--
-- Index: votes_claimId_deleted_at_idx
--   Used by: vote aggregation queries scoped to a claim
--   Query:   SELECT * FROM votes WHERE "claimId" = $1 AND deleted_at IS NULL

CREATE INDEX IF NOT EXISTS "claims_policyId_deleted_at_createdAt_idx"
  ON "claims"("policyId", "deleted_at", "createdAt");

CREATE INDEX IF NOT EXISTS "votes_claimId_deleted_at_idx"
  ON "votes"("claimId", "deleted_at");
