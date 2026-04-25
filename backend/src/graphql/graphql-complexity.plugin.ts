/**
 * Query complexity analysis plugin for GraphQL.
 *
 * Assigns complexity scores to fields and rejects queries that exceed
 * GRAPHQL_MAX_COMPLEXITY. This prevents unbounded nested queries from
 * exhausting DB connections even when depth limits pass.
 *
 * Complexity rules:
 *   - Default field: 1
 *   - List field (items / claims): multiplied by requested `first` arg (default 10)
 *   - Nested policy->claims: 5 base + first multiplier
 *
 * Index usage documentation:
 *   claims_policyId_deleted_at_createdAt_idx  -> PolicyResolver.claims (DataLoader batch)
 *   votes_claimId_deleted_at_idx              -> ClaimResolver.policy  (DataLoader batch)
 */

import { GraphQLSchema, GraphQLError } from 'graphql';
import { fieldExtensionsEstimator, getComplexity, simpleEstimator } from 'graphql-query-complexity';
import type { ApolloServerPlugin, GraphQLRequestContext } from '@apollo/server';

export function createComplexityPlugin(
  schema: GraphQLSchema,
  maxComplexity: number,
): ApolloServerPlugin {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation(ctx: GraphQLRequestContext<Record<string, unknown>>) {
          if (!ctx.document) return;

          const complexity = getComplexity({
            schema,
            operationName: ctx.request.operationName ?? undefined,
            query: ctx.document,
            variables: ctx.request.variables ?? {},
            estimators: [
              fieldExtensionsEstimator(),
              simpleEstimator({ defaultComplexity: 1 }),
            ],
          });

          if (complexity > maxComplexity) {
            throw new GraphQLError(
              `Query complexity ${complexity} exceeds maximum allowed complexity ${maxComplexity}.`,
              { extensions: { code: 'QUERY_COMPLEXITY_EXCEEDED', complexity, maxComplexity } },
            );
          }
        },
      };
    },
  };
}
