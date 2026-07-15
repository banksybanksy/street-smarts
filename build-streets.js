#!/usr/bin/env node

const fs = require("fs");
const https = require("https");

const STREET_NAMES_URL = "https://data.sfgov.org/resource/6d9h-4u5v.json?$limit=5000";
const CENTERLINE_DATASETS = [
  { id: "9ekd-5jta", mode: "streetname" },
  { id: "3psu-pn9h", mode: "street_and_type" }
];
const NEIGHBORHOODS_URL = "https://data.sfgov.org/resource/pty2-tcw4.json";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OUTPUT_FILE = "streets.json";
const JS_OUTPUT_FILE = "street-data.js";
const SKIPPED_FILE = "streets-skipped.json";
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 100;
const NOMINATIM_DELAY_MS = 1000;

const ALLOWED_TYPES = new Set([
  "ST",
  "AVE",
  "BLVD",
  "DR",
  "CT",
  "PL",
  "WAY",
  "LN",
  "TER",
  "RD",
  "HWY",
  "EXPY",
  "LOOP",
  "ROW",
  "PKWY",
  "CIR"
]);

const EXCLUDED_TYPES = new Set([
  "WALK",
  "PATH",
  "STAIR",
  "PLZA",
  "TRWY",
  "ALY"
]);

const SUFFIX_MAP = {
  ST: "Street",
  AVE: "Avenue",
  BLVD: "Boulevard",
  DR: "Drive",
  CT: "Court",
  PL: "Place",
  WAY: "Way",
  LN: "Lane",
  TER: "Terrace",
  RD: "Road",
  HWY: "Highway",
  EXPY: "Expressway",
  LOOP: "Loop",
  ROW: "Row",
  PKWY: "Parkway",
  CIR: "Circle"
};

const TITLE_FIXES = {
  "3Rd": "3rd",
  "4Th": "4th",
  "5Th": "5th",
  "6Th": "6th",
  "7Th": "7th",
  "8Th": "8th",
  "9Th": "9th",
  "10Th": "10th",
  "11Th": "11th",
  "12Th": "12th",
  "13Th": "13th",
  "14Th": "14th",
  "15Th": "15th",
  "16Th": "16th",
  "17Th": "17th",
  "18Th": "18th",
  "19Th": "19th",
  "20Th": "20th",
  "21St": "21st",
  "22Nd": "22nd",
  "23Rd": "23rd",
  "24Th": "24th",
  "25Th": "25th",
  "26Th": "26th",
  "27Th": "27th",
  "28Th": "28th",
  "29Th": "29th",
  "30Th": "30th",
  "31St": "31st",
  "32Nd": "32nd",
  "33Rd": "33rd",
  "34Th": "34th",
  "35Th": "35th",
  "36Th": "36th",
  "37Th": "37th",
  "38Th": "38th",
  "39Th": "39th",
  "40Th": "40th",
  "41St": "41st",
  "42Nd": "42nd",
  "43Rd": "43rd",
  "44Th": "44th",
  "45Th": "45th",
  "46Th": "46th",
  "47Th": "47th",
  "48Th": "48th",
  "Mcallister": "McAllister",
  "Mccoppin": "McCoppin",
  "Ofarrell": "O'Farrell",
  "Oshaughnessy": "O'Shaughnessy",
  "South Van Ness": "South Van Ness",
  "El Camino Del Mar": "El Camino Del Mar"
};

let centerlineDataset = null;
let nominatimQueue = Promise.resolve();

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error("HTTP " + response.statusCode + " for " + url));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error("Failed to parse JSON from " + url + ": " + error.message));
          }
        });
      }
    );

    request.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function titleizeName(name) {
  const titled = String(name || "")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const withoutLeadingZeroOrdinals = titled.replace(
    /\b0+(\d+)(St|Nd|Rd|Th)\b/g,
    (_, number, suffix) => String(Number(number)) + suffix.toLowerCase()
  );

  return TITLE_FIXES[withoutLeadingZeroOrdinals] || withoutLeadingZeroOrdinals;
}

function formatStreet(name, suffix) {
  return suffix ? name + " " + suffix : name;
}

function escapeSoqlString(value) {
  return String(value).replace(/'/g, "''");
}

function parseShape(shapeValue) {
  if (!shapeValue) {
    return null;
  }

  let shape = shapeValue;
  if (typeof shape === "string") {
    try {
      shape = JSON.parse(shape);
    } catch (error) {
      return null;
    }
  }

  if (shape && Array.isArray(shape.coordinates)) {
    return shape.coordinates;
  }

  if (shape && shape.type === "LineString" && Array.isArray(shape.coordinates)) {
    return shape.coordinates;
  }

  if (shape && shape.geometry && Array.isArray(shape.geometry.coordinates)) {
    return shape.geometry.coordinates;
  }

  if (shape && Array.isArray(shape)) {
    return shape;
  }

  return null;
}

function midpointFromCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (!Array.isArray(first) || !Array.isArray(last) || first.length < 2 || last.length < 2) {
    return null;
  }

  const lng = (Number(first[0]) + Number(last[0])) / 2;
  const lat = (Number(first[1]) + Number(last[1])) / 2;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function buildCenterlineProbeUrl(datasetId) {
  return "https://data.sfgov.org/resource/" + datasetId + ".json?$limit=1";
}

function buildCenterlineLookupUrl(dataset, street) {
  let where = "streetname='" + escapeSoqlString((street.baseName + " " + street.type).toUpperCase()) + "'";
  if (dataset.mode === "street_and_type") {
    where =
      "street='" +
      escapeSoqlString(street.baseName.toUpperCase()) +
      "' AND st_type='" +
      escapeSoqlString(street.type) +
      "'";
  }
  const params = new URLSearchParams({
    $where: where,
    $limit: "1"
  });
  return "https://data.sfgov.org/resource/" + dataset.id + ".json?" + params.toString();
}

function buildNeighborhoodUrl(lat, lng, geometryColumn) {
  const where = "within_circle(" + geometryColumn + "," + lat + "," + lng + ",100)";
  const params = new URLSearchParams({
    $where: where,
    $limit: "1"
  });
  return NEIGHBORHOODS_URL + "?" + params.toString();
}

function buildNominatimUrl(street) {
  const params = new URLSearchParams({
    street: street.baseName + " " + street.suffix,
    city: "San Francisco",
    state: "CA",
    format: "json",
    limit: "1",
    addressdetails: "1"
  });
  return NOMINATIM_URL + "?" + params.toString();
}

function chooseDominantDistrict(rows) {
  const counts = new Map();

  for (const row of rows) {
    const district = row.nhood || row.analysis_neighborhood || null;
    if (!district) {
      continue;
    }
    counts.set(district, (counts.get(district) || 0) + 1);
  }

  let bestDistrict = null;
  let bestCount = -1;
  for (const [district, count] of counts.entries()) {
    if (count > bestCount || (count === bestCount && district < bestDistrict)) {
      bestDistrict = district;
      bestCount = count;
    }
  }

  return bestDistrict;
}

async function detectCenterlineDataset() {
  for (const dataset of CENTERLINE_DATASETS) {
    try {
      const rows = await fetchJson(buildCenterlineProbeUrl(dataset.id));
      if (Array.isArray(rows) && rows.length && Object.keys(rows[0]).length) {
        console.log("Using centerline dataset " + dataset.id);
        return dataset;
      }
    } catch (error) {
      console.warn("Warning: centerline dataset " + dataset.id + " probe failed (" + error.message + ")");
    }
  }

  console.warn("Warning: no working DataSF centerline dataset found, using Nominatim fallback only");
  return null;
}

async function fetchStreetNames() {
  const rows = await fetchJson(STREET_NAMES_URL);
  const seen = new Set();
  const streets = [];

  for (const row of rows) {
    const type = String(row.streettype || "").trim().toUpperCase();
    if (EXCLUDED_TYPES.has(type) || !ALLOWED_TYPES.has(type)) {
      continue;
    }

    const normalizedName = normalizeName(row.streetname);
    if (!normalizedName || seen.has(normalizedName)) {
      continue;
    }

    seen.add(normalizedName);
    streets.push({
      baseName: String(row.streetname).trim(),
      name: titleizeName(row.streetname),
      suffix: SUFFIX_MAP[type],
      type
    });
  }

  return streets;
}

async function resolveCenterlineMidpoint(street) {
  if (!centerlineDataset) {
    return null;
  }

  const rows = await fetchJson(buildCenterlineLookupUrl(centerlineDataset, street));
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }

  const directDistrict = chooseDominantDistrict(rows);
  if (directDistrict) {
    return {
      district: directDistrict,
      midpoint: null
    };
  }

  const row = rows[0];
  const coordinates = parseShape(row.line) || parseShape(row.shape) || parseShape(row.geometry) || parseShape(row.the_geom);
  return {
    district: null,
    midpoint: midpointFromCoordinates(coordinates)
  };
}

async function resolveNeighborhoodFromPoint(midpoint) {
  const geometryColumns = ["shape", "the_geom"];

  for (const geometryColumn of geometryColumns) {
    try {
      const rows = await fetchJson(buildNeighborhoodUrl(midpoint.lat, midpoint.lng, geometryColumn));
      if (Array.isArray(rows) && rows.length) {
        return rows[0].nhood || null;
      }
      return "San Francisco";
    } catch (error) {
      if (!error.message.includes("HTTP 400")) {
        throw error;
      }
    }
  }

  return "San Francisco";
}

function resolveDistrictFromNominatimAddress(address) {
  if (!address || typeof address !== "object") {
    return null;
  }

  return (
    address.suburb ||
    address.neighbourhood ||
    address.city_district ||
    address.quarter ||
    null
  );
}

function queueNominatimRequest(street) {
  const run = async () => {
    await sleep(NOMINATIM_DELAY_MS);
    const rows = await fetchJson(buildNominatimUrl(street), {
      "User-Agent": "NameSF/1.0 (local build script)"
    });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  };

  const next = nominatimQueue.then(run, run);
  nominatimQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function resolveDistrict(street) {
  try {
    const centerlineResult = await resolveCenterlineMidpoint(street);
    if (centerlineResult && centerlineResult.district) {
      return centerlineResult.district;
    }
    if (centerlineResult && centerlineResult.midpoint) {
      const neighborhood = await resolveNeighborhoodFromPoint(centerlineResult.midpoint);
      if (neighborhood) {
        return neighborhood;
      }
    }
  } catch (error) {
    console.warn("Warning: DataSF lookup failed for " + formatStreet(street.name, street.suffix) + " (" + error.message + ")");
  }

  try {
    const row = await queueNominatimRequest(street);
    const district = resolveDistrictFromNominatimAddress(row && row.address);
    return district;
  } catch (error) {
    console.warn("Warning: Nominatim lookup failed for " + formatStreet(street.name, street.suffix) + " (" + error.message + ")");
    return null;
  }
}

async function resolveStreet(street, index, total) {
  const label = formatStreet(street.name, street.suffix);

  try {
    const district = await resolveDistrict(street);
    if (!district) {
      console.warn("[" + index + "/" + total + "] Warning: no district found for " + label);
      return null;
    }

    console.log("[" + index + "/" + total + "] Resolving " + label + " \u2192 " + district);
    return {
      name: street.name,
      suffix: street.suffix,
      district
    };
  } catch (error) {
    console.warn("[" + index + "/" + total + "] Warning: failed to resolve " + label + " (" + error.message + ")");
    return null;
  }
}

async function processInBatches(streets) {
  const resolved = [];
  const skipped = [];

  for (let start = 0; start < streets.length; start += BATCH_SIZE) {
    const batch = streets.slice(start, start + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((street, batchIndex) => resolveStreet(street, start + batchIndex + 1, streets.length))
    );

    for (const [resultIndex, result] of results.entries()) {
      if (result && result.district) {
        resolved.push(result);
      } else {
        const skippedStreet = batch[resultIndex];
        skipped.push({
          name: skippedStreet.name,
          suffix: skippedStreet.suffix
        });
      }
    }

    if (start + BATCH_SIZE < streets.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return { resolved, skipped };
}

function writeJsOutput(streets) {
  const lines = ["window.STREET_DATA = ["];
  for (const street of streets) {
    lines.push(
      "  { name: " +
        JSON.stringify(street.name) +
        ", suffix: " +
        JSON.stringify(street.suffix) +
        ", district: " +
        JSON.stringify(street.district) +
        " },"
    );
  }
  lines.push("];", "");
  fs.writeFileSync(JS_OUTPUT_FILE, lines.join("\n"), "utf8");
}

async function main() {
  centerlineDataset = await detectCenterlineDataset();
  const streets = await fetchStreetNames();
  const { resolved, skipped } = await processInBatches(streets);

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(resolved, null, 2) + "\n", "utf8");
  writeJsOutput(resolved);
  fs.writeFileSync(SKIPPED_FILE, JSON.stringify(skipped, null, 2) + "\n", "utf8");

  console.log("\u2713 " + resolved.length + " streets resolved with real neighborhoods");
  console.log("\u26a0 " + skipped.length + " streets skipped (no geometry found)");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
