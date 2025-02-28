// Require Node.js Dependencies
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert";

// Require Internal Dependencies
import { scanJavascriptFile } from "../../src/tarball.js";

// CONSTANTS
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "scanJavascriptFile");

test("scanJavascriptFile (fixture one.js)", async() => {
  const result = await scanJavascriptFile(FIXTURE_PATH, "one.js", "yolo");
  assert.deepEqual(result, {
    file: "one.js",
    warnings: [],
    isMinified: false,
    tryDependencies: [],
    dependencies: ["http", "mocha"],
    filesDependencies: ["src\\foo.js", "home\\marco.js"].map((location) => location.replaceAll("\\", path.sep))
  });
});

test("scanJavascriptFile (fixture two.min.js)", async() => {
  const result = await scanJavascriptFile(FIXTURE_PATH, "two.min.js", "yolo");
  assert.deepEqual(result, {
    file: "two.min.js",
    warnings: [],
    isMinified: true,
    tryDependencies: ["http"],
    dependencies: ["http", "fs"],
    filesDependencies: []
  });
});

test("scanJavascriptFile (fixture onelineStmt.min.js)", async() => {
  const result = await scanJavascriptFile(FIXTURE_PATH, "onelineStmt.min.js", "yolo");
  assert.deepEqual(result, {
    file: "onelineStmt.min.js",
    warnings: [],
    isMinified: false,
    tryDependencies: [],
    dependencies: [],
    filesDependencies: ["foobar.js"]
  });
});

test("scanJavascriptFile (fixture parsingError.js)", async() => {
  const result = await scanJavascriptFile(FIXTURE_PATH, "parsingError.js", "yolo");

  assert.deepEqual(result, {
    file: "parsingError.js",
    warnings: [
      {
        kind: "parsing-error",
        value: "[1:5]: Unexpected token: ';'",
        location: [[0, 0], [0, 0]],
        file: "parsingError.js"
      }
    ],
    isMinified: false,
    tryDependencies: [],
    dependencies: [],
    filesDependencies: []
  });
});
