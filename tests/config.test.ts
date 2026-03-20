import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAffiliationMap } from "../src/config.js";

test("normalizeAffiliationMap preserves legacy username to category maps", () => {
  const normalized = normalizeAffiliationMap({
    maintainer_user_1: "internal-maintainer",
    external_contributor_1: "external",
  });

  assert.deepEqual(normalized, {
    maintainer_user_1: "internal-maintainer",
    external_contributor_1: "external",
  });
});

test("normalizeAffiliationMap supports category keys with array values", () => {
  const normalized = normalizeAffiliationMap({
    top_community_contributors: ["foo", "bar", "baz"],
    internal_staff: ["amy", "sam"],
  });

  assert.deepEqual(normalized, {
    foo: "top_community_contributors",
    bar: "top_community_contributors",
    baz: "top_community_contributors",
    amy: "internal_staff",
    sam: "internal_staff",
  });
});

test("normalizeAffiliationMap supports comma separated grouped values and multiple categories per user", () => {
  const normalized = normalizeAffiliationMap({
    tier_1_customers: "government, bigboxstore",
    top_community_contributors: "bigboxstore, helpfulhuman",
  });

  assert.deepEqual(normalized, {
    government: "tier_1_customers",
    bigboxstore: "tier_1_customers, top_community_contributors",
    helpfulhuman: "top_community_contributors",
  });
});
