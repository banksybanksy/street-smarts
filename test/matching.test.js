const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  normalizeStreetName,
  formatStreet,
  buildStreetIndex,
  matchGuess,
  groupByDistrict,
  bestDistrict
} = require("../matching.js");

const FIXTURE = [
  { name: "03rd", suffix: "Avenue", district: "Lake" },
  { name: "24th", suffix: "Street", district: "Inner Mission" },
  { name: "Second", suffix: "Drive", district: "Presidio" },
  { name: "02nd", suffix: "Avenue", district: "Inner Richmond" },
  { name: "O'Farrell", suffix: "Street", district: "Western Addition" },
  { name: "Geary", suffix: "Boulevard", district: "Outer Richmond" },
  { name: "Vicha Ratanapakdee", suffix: "Way", district: "Anza Vista" },
  { name: "Golden Gate", suffix: "Avenue", district: "Van Ness - Civic Center" },
  { name: "Valencia", suffix: "Street", district: "Inner Mission" },
  { name: "Great Highway", suffix: "-", district: "Citywide" }
];

function play(guesses, data = FIXTURE) {
  const index = buildStreetIndex(data);
  const guessedKeys = new Set();
  const named = [];
  const results = guesses.map((guess) => {
    const result = matchGuess(index, guessedKeys, guess);
    if (result.status === "hit") {
      guessedKeys.add(result.key);
      named.push(...result.streets);
    }
    return result.status;
  });
  return { results, named };
}

test("case and surrounding whitespace don't matter", () => {
  assert.equal(normalizeStreetName("  GEARY  "), "geary");
  assert.deepEqual(play(["gEaRy"]).results, ["hit"]);
});

test("spelled-out, numeric and zero-padded ordinals are the same street", () => {
  assert.equal(normalizeStreetName("Third"), "3rd");
  assert.equal(normalizeStreetName("03rd"), "3rd");
  assert.equal(normalizeStreetName("twenty-fourth"), "24th");
  assert.equal(normalizeStreetName("Twenty Fourth"), "24th");
  for (const guess of ["third", "3rd", "03rd", "THIRD AVENUE"]) {
    assert.deepEqual(play([guess]).results, ["hit"], guess);
  }
});

test("a trailing street type is optional, spelled out or abbreviated", () => {
  for (const guess of ["Geary Blvd", "geary boulevard", "Valencia St.", "valencia street", "24th st"]) {
    assert.deepEqual(play([guess]).results, ["hit"], guess);
  }
  assert.deepEqual(play(["Street"]).results, ["miss"]);
});

test("apostrophes are ignored, straight or curly", () => {
  for (const guess of ["O'Farrell", "O\u2019Farrell", "ofarrell", "O`Farrell st"]) {
    assert.deepEqual(play([guess]).results, ["hit"], guess);
  }
});

test("hyphens and spaces are interchangeable", () => {
  assert.deepEqual(play(["golden-gate"]).results, ["hit"]);
  assert.deepEqual(play(["Vicha-Ratanapakdee Way"]).results, ["hit"]);
});

test("punctuation-only and empty guesses are ignored, unknown names miss", () => {
  assert.deepEqual(play(["", "   ", "--", "Atlantis"]).results, ["empty", "empty", "empty", "miss"]);
});

test("a street counts once, however it is spelled the second time", () => {
  const { results, named } = play(["3rd", "third", "Third Avenue", "geary", "GEARY BLVD"]);
  assert.deepEqual(results, ["hit", "repeat", "repeat", "hit", "repeat"]);
  assert.deepEqual(named.map((street) => street.fullName), ["3rd Avenue", "Geary Boulevard"]);
});

test("one guess names every street that shares the name", () => {
  const { named } = play(["second"]);
  assert.deepEqual(named.map((street) => street.fullName).sort(), ["2nd Avenue", "2nd Drive"]);
});

test("display names drop zero padding and the '-' placeholder suffix", () => {
  assert.equal(formatStreet({ name: "02nd", suffix: "Avenue" }), "2nd Avenue");
  assert.equal(formatStreet({ name: "Great Highway", suffix: "-" }), "Great Highway");
});

test("results group by district, most named first, ties alphabetical, Citywide last", () => {
  const { named } = play(["great highway", "valencia", "24th", "geary", "ofarrell"]);
  const grouped = groupByDistrict(named);
  assert.deepEqual(
    grouped.map(([district, streets]) => [district, streets.map((street) => street.fullName)]),
    [
      ["Inner Mission", ["24th Street", "Valencia Street"]],
      ["Outer Richmond", ["Geary Boulevard"]],
      ["Western Addition", ["O'Farrell Street"]],
      ["Citywide", ["Great Highway"]]
    ]
  );
  assert.equal(bestDistrict(named), "Inner Mission");
});

test("Citywide is never the best district", () => {
  const { named } = play(["great highway"]);
  assert.equal(bestDistrict(named), null);
  assert.deepEqual(groupByDistrict([]), []);
});

test("the committed street list loads and every street is reachable by its own name", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "street-data.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  const data = sandbox.window.STREET_DATA;

  assert.ok(Array.isArray(data) && data.length > 0);
  for (const entry of data) {
    assert.ok(entry.name && entry.suffix && entry.district, JSON.stringify(entry));
  }

  const index = buildStreetIndex(data);
  for (const street of index.streets) {
    const result = matchGuess(index, new Set(), street.fullName);
    assert.equal(result.status, "hit", street.fullName);
    assert.ok(result.streets.includes(street), street.fullName);
  }
});
