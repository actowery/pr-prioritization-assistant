import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildCodeownersSearchQuery,
  codeownersMentionsTeam,
  decodeBase64Content,
  deriveTeamOwnershipMatch,
  findOwnersForPath,
  matchCodeownersPaths,
  normalizeCodeownersTeam,
  normalizeRequestedTeamRef,
  parseCodeownersEntries,
  selectCodeownersDiscoveryMode,
} from "../src/github/codeowners.js";

test("normalizeCodeownersTeam supports plain team slugs and explicit refs", () => {
  assert.equal(normalizeCodeownersTeam("exampleorg", "platform-core"), "@exampleorg/platform-core");
  assert.equal(normalizeCodeownersTeam("exampleorg", "@exampleorg/platform-core"), "@exampleorg/platform-core");
  assert.equal(normalizeCodeownersTeam("exampleorg", "ExampleOrg/Platform-Core"), "@exampleorg/platform-core");
});

test("codeownersMentionsTeam ignores comments and matches live entries", () => {
  const codeowners = `
# @exampleorg/platform-core
* @exampleorg/docs
/src/ @exampleorg/platform-core @exampleorg/reviewers
`;

  assert.equal(codeownersMentionsTeam(codeowners, "@exampleorg/platform-core"), true);
  assert.equal(codeownersMentionsTeam(codeowners, "@exampleorg/missing"), false);
});

test("decodeBase64Content handles github-style wrapped content", () => {
  const encoded = "L3NyYy8gQGV4YW1wbGVvcmcvcGxhdGZvcm0tY29yZQo=";
  assert.equal(decodeBase64Content(encoded), "/src/ @exampleorg/platform-core\n");
});

test("buildCodeownersSearchQuery targets CODEOWNERS search cleanly", () => {
  assert.equal(
    buildCodeownersSearchQuery("exampleorg", "platform-core"),
    'org:exampleorg filename:CODEOWNERS "@exampleorg/platform-core"',
  );
});

test("selectCodeownersDiscoveryMode prefers search for large orgs", () => {
  assert.equal(selectCodeownersDiscoveryMode("auto", { orgRepoCount: 3000 }), "search");
  assert.equal(selectCodeownersDiscoveryMode("auto", { orgRepoCount: 50 }), "deep");
  assert.equal(selectCodeownersDiscoveryMode("auto", { repoLimit: 25 }), "deep");
  assert.equal(selectCodeownersDiscoveryMode("search", { orgRepoCount: 50 }), "search");
});

test("requested review ownership matching prefers direct team requests", () => {
  const team = normalizeCodeownersTeam("exampleorg", "platform-core");
  const match = deriveTeamOwnershipMatch(
    ["reviewer1"],
    [normalizeRequestedTeamRef("exampleorg", "platform-core") ?? ""],
    team,
    new Set(["reviewer1", "reviewer2"]),
  );

  assert.equal(match, "requested-team");
});

test("requested review ownership matching falls back to team members", () => {
  const match = deriveTeamOwnershipMatch(
    ["reviewer1"],
    [],
    normalizeCodeownersTeam("exampleorg", "platform-core"),
    new Set(["reviewer1", "reviewer2"]),
  );

  assert.equal(match, "requested-team-member");
});

test("parseCodeownersEntries and path matching follow last-match-wins behavior", () => {
  const entries = parseCodeownersEntries(`
* @exampleorg/everyone
/modules/ @exampleorg/modules
/modules/private/ @exampleorg/private
`);

  assert.deepEqual(findOwnersForPath(entries, "modules/service/init.pp"), ["@exampleorg/modules"]);
  assert.deepEqual(findOwnersForPath(entries, "modules/private/secret.pp"), ["@exampleorg/private"]);
  assert.equal(matchCodeownersPaths(entries, ["modules/service/init.pp"], "@exampleorg/modules"), true);
  assert.equal(matchCodeownersPaths(entries, ["docs/readme.md"], "@exampleorg/modules"), false);
});

test("repository ships a dogfoodable CODEOWNERS file", async () => {
  const codeownersPath = resolve(process.cwd(), ".github", "CODEOWNERS");
  const content = await readFile(codeownersPath, "utf8");

  assert.equal(codeownersMentionsTeam(content, "@exampleorg/pr-prioritization-maintainers"), true);
  assert.equal(codeownersMentionsTeam(content, "@exampleorg/platform-core"), true);
});
