// Require Node.js Dependencies
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert";

// Third party Dependencies
import { setStrategy, strategies } from "@nodesecure/vuln";

// Require Internal Dependencies
import { depWalker } from "../src/depWalker.js";
import { from, cwd } from "../index.js";

// CONSTANTS
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join("fixtures", "depWalker");

// JSON PAYLOADS
const is = JSON.parse(readFileSync(
  new URL(join(FIXTURE_PATH, "slimio.is.json"), import.meta.url)
));

const config = JSON.parse(readFileSync(
  new URL(join(FIXTURE_PATH, "slimio.config.json"), import.meta.url)
));

const pkgGitdeps = JSON.parse(readFileSync(
  new URL(join(FIXTURE_PATH, "pkg.gitdeps.json"), import.meta.url)
));

function cleanupPayload(payload) {
  for (const pkg of Object.values(payload)) {
    for (const verDescriptor of Object.values(pkg.versions)) {
      verDescriptor.composition.extensions.sort();
      delete verDescriptor.size;
      delete verDescriptor.composition.files;
      delete verDescriptor.composition.required_files;
    }
    for (const contributor of [pkg.metadata.author, ...pkg.metadata.publishers, ...pkg.metadata.maintainers]) {
      // this is a dynamic property
      delete contributor.npmAvatar;
    }
  }
}

test("execute depWalker on @slimio/is", async() => {
  await setStrategy(strategies.NPM_AUDIT);

  const result = await depWalker(is, { verbose: false });
  const resultAsJSON = JSON.parse(JSON.stringify(result.dependencies, null, 2));
  cleanupPayload(resultAsJSON);

  const expectedResult = JSON.parse(readFileSync(join("test", FIXTURE_PATH, "slimio.is-result.json"), "utf-8"));
  assert.deepEqual(resultAsJSON, expectedResult);
});

test("execute depWalker on @slimio/config", async() => {
  await setStrategy(strategies.NPM_AUDIT);

  const result = await depWalker(config, { verbose: false });
  const resultAsJSON = JSON.parse(JSON.stringify(result.dependencies, null, 2));

  const packages = Object.keys(resultAsJSON).sort();
  assert.deepEqual(packages, [
    "lodash.clonedeep",
    "zen-observable",
    "lodash.set",
    "lodash.get",
    "node-watch",
    "fast-deep-equal",
    "fast-json-stable-stringify",
    "json-schema-traverse",
    "punycode",
    "uri-js",
    "ajv",
    "@slimio/is",
    "@iarna/toml",
    "@slimio/config"
  ].sort());
});

test("execute depWalker on pkg.gitdeps", async() => {
  await setStrategy(strategies.NPM_AUDIT);

  const result = await depWalker(pkgGitdeps, { verbose: false });
  const resultAsJSON = JSON.parse(JSON.stringify(result.dependencies, null, 2));

  const packages = Object.keys(resultAsJSON).sort();
  assert.deepEqual(packages, [
    "@nodesecure/estree-ast-utils",
    "@nodesecure/js-x-ray",
    "@nodesecure/sec-literal",
    "@types/estree",
    "eastasianwidth",
    "emoji-regex",
    "estree-walker",
    "fast-xml-parser",
    "frequency-set",
    "is-base64",
    "is-minified-code",
    "is-svg",
    "meriyah",
    "nanodelay",
    "nanoevents",
    "nanoid",
    "pkg.gitdeps",
    "regexp-tree",
    "safe-regex",
    "string-width",
    "strip-ansi",
    "zen-observable"
  ].sort());
});

test("fetch payload of pacote on the npm registry", async() => {
  const result = await from("pacote", {
    verbose: false,
    maxDepth: 10,
    vulnerabilityStrategy: strategies.NPM_AUDIT
  });

  assert.deepEqual(Object.keys(result), [
    "id",
    "rootDependencyName",
    "scannerVersion",
    "vulnerabilityStrategy",
    "warnings",
    "flaggedAuthors",
    "dependencies"
  ]);
});

test("fetch payload of pacote on the gitlab registry", async() => {
  const result = await from("pacote", {
    registry: "https://gitlab.com/api/v4/packages/npm/",
    verbose: false,
    maxDepth: 10,
    vulnerabilityStrategy: strategies.NPM_AUDIT
  });

  assert.deepEqual(Object.keys(result), [
    "id",
    "rootDependencyName",
    "scannerVersion",
    "vulnerabilityStrategy",
    "warnings",
    "flaggedAuthors",
    "dependencies"
  ]);
});

test("execute cwd on scanner project", async() => {
  await cwd(join(__dirname, ".."), {
    verbose: false,
    maxDepth: 2,
    vulnerabilityStrategy: strategies.NPM_AUDIT
  });
});

test("execute cwd on scanner project with a different registry", async() => {
  await cwd(join(__dirname, ".."), {
    registry: "https://gitlab.com/api/v4/packages/npm/",
    verbose: false,
    maxDepth: 2,
    vulnerabilityStrategy: strategies.NPM_AUDIT
  });
});
