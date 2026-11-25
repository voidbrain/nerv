# F-083-T04: Saved Recipe Live Check

Date: 2026-11-22  
Operator: Agent (`antigravity`)

## Scope

Verified the end-to-end saved-recipe flow (`F-083-T01` + `F-083-T02` + `F-083-T03`) against an isolated temporary NERV `Store` with an invented fixture recipe:

1. **Save (`docs.save`)**: Proposed saving `"Hearth Focaccia (Fixture)"` (`category: "recipes"`, `500 g flour`, `375 g water`, `10 g salt`).
   - Gate: `pattern: "blue"`, approved via `store.decide(approvalId, "approve", "owner")`.
2. **Recall (`docs.show`)**: Recalled the saved recipe by ID (`outcome: "grant"`).
   - Returned `title: "Hearth Focaccia (Fixture)"` verbatim on surface component `nerv-recipe-card`.
3. **Scale (`docs.compute`)**: Computed `water` for `baseIngredient: "flour"`, `targetQuantity: 300`, `targetUnit: "g"` (`outcome: "grant"`).
   - `status: "computed"`, `scaledQuantity: 225 g`.
   - Working shown: `water: 375 g × (300 g / 500 g) = 225 g` (matches `375 * 300 / 500 = 225`).

## Validation Commands

- `node --test test/documents.test.ts`
- Isolated `Store` `docs.save` → `docs.show` → `docs.compute` run — passed.
