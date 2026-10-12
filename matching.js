// Guess normalization, street lookup and district grouping. No DOM access, so
// the same file runs in the browser (window.StreetMatching) and under node:test.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.StreetMatching = api;
  }
}(typeof self !== "undefined" ? self : this, function () {
  const ORDINAL_WORDS = {
    first: "1st",
    second: "2nd",
    third: "3rd",
    fourth: "4th",
    fifth: "5th",
    sixth: "6th",
    seventh: "7th",
    eighth: "8th",
    ninth: "9th",
    tenth: "10th",
    eleventh: "11th",
    twelfth: "12th",
    thirteenth: "13th",
    fourteenth: "14th",
    fifteenth: "15th",
    sixteenth: "16th",
    seventeenth: "17th",
    eighteenth: "18th",
    nineteenth: "19th",
    twentieth: "20th"
  };

  const TENS_WORDS = { twenty: 20, thirty: 30, forty: 40 };
  const UNIT_ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
  const TENS_ORDINALS = { twentieth: "20th", thirtieth: "30th", fortieth: "40th" };

  // Street types a player might tack onto a guess ("third street", "Geary Blvd").
  const STREET_TYPE_WORDS = new Set([
    "street", "st", "avenue", "ave", "av", "boulevard", "blvd", "drive", "dr", "court", "ct",
    "place", "pl", "way", "lane", "ln", "terrace", "ter", "road", "rd", "highway", "hwy",
    "circle", "cir", "loop", "row"
  ]);

  // scripts/build_street_data.py writes "Citywide" for streets it has no
  // district for and "-" for names without a street type.
  const CITYWIDE = "Citywide";
  const NO_SUFFIX = "-";

  function ordinalSuffix(number) {
    const lastTwo = number % 100;
    if (lastTwo >= 11 && lastTwo <= 13) {
      return "th";
    }
    return ["th", "st", "nd", "rd"][number % 10] || "th";
  }

  // "Twenty-Fourth" -> "24th", "03rd" -> "3rd". Leaves everything else as is.
  function canonicalizeStreetLabel(value) {
    return String(value || "")
      .replace(/\b0+(\d+)(st|nd|rd|th)\b/gi, (_, number, suffix) => String(Number(number)) + suffix.toLowerCase())
      .replace(
        /\b(twenty|thirty|forty)[\s-]*(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/gi,
        (_, tens, unit) => {
          const number = TENS_WORDS[tens.toLowerCase()] + UNIT_ORDINALS.indexOf(unit.toLowerCase()) + 1;
          return number + ordinalSuffix(number);
        }
      )
      .replace(/\b(twentieth|thirtieth|fortieth)\b/gi, (match) => TENS_ORDINALS[match.toLowerCase()])
      .replace(
        /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\b/gi,
        (match) => ORDINAL_WORDS[match.toLowerCase()] || match
      );
  }

  function normalizeStreetName(value) {
    return canonicalizeStreetLabel(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[.'\u2018\u2019`]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function formatStreet(entry) {
    const baseName = canonicalizeStreetLabel(entry.name);
    return entry.suffix === NO_SUFFIX ? baseName : baseName + " " + entry.suffix;
  }

  // Keys streets by normalized name. One key can hold several streets
  // ("2nd Avenue" and "Second Drive" both answer to "2nd").
  function buildStreetIndex(sourceData) {
    const streets = [];
    const lookup = new Map();

    for (const entry of sourceData) {
      const key = normalizeStreetName(entry.name);
      const street = {
        ...entry,
        key,
        id: key + "|" + normalizeStreetName(entry.suffix),
        fullName: formatStreet(entry)
      };
      const matches = lookup.get(key) || [];

      if (!matches.some((match) => match.id === street.id)) {
        matches.push(street);
        lookup.set(key, matches);
        streets.push(street);
      }
    }

    return { streets, lookup };
  }

  // The name as typed, or the name with a trailing street type dropped
  // ("3rd street" -> "3rd").
  function resolveGuessKey(lookup, normalized) {
    if (lookup.has(normalized)) {
      return normalized;
    }
    const words = normalized.split(" ");
    if (words.length > 1 && STREET_TYPE_WORDS.has(words[words.length - 1])) {
      return words.slice(0, -1).join(" ");
    }
    return normalized;
  }

  // Returns { status, key, streets }. status is "empty", "miss", "repeat" or
  // "hit"; on a hit, streets lists every street the guess newly names.
  function matchGuess(index, guessedKeys, rawValue) {
    const key = resolveGuessKey(index.lookup, normalizeStreetName(rawValue));
    if (!key) {
      return { status: "empty", key, streets: [] };
    }
    const matches = index.lookup.get(key);
    if (!matches || !matches.length) {
      return { status: "miss", key, streets: [] };
    }
    if (guessedKeys.has(key)) {
      return { status: "repeat", key, streets: [] };
    }
    return { status: "hit", key, streets: matches.slice() };
  }

  function isRankable(district) {
    return Boolean(district) && district !== CITYWIDE;
  }

  function compareBuckets(a, b) {
    if (b[1].length !== a[1].length) {
      return b[1].length - a[1].length;
    }
    return a[0].localeCompare(b[0]);
  }

  // [district, streets[]] pairs, most-named first, ties alphabetical, with
  // Citywide always last. Streets inside a district are sorted by name.
  function groupByDistrict(streets) {
    const grouped = new Map();
    for (const street of streets) {
      const bucket = grouped.get(street.district) || [];
      bucket.push(street);
      grouped.set(street.district, bucket);
    }

    return [...grouped.entries()]
      .map(([district, bucket]) => [district, bucket.slice().sort((a, b) => a.fullName.localeCompare(b.fullName))])
      .sort((a, b) => {
        const aCitywide = a[0] === CITYWIDE;
        const bCitywide = b[0] === CITYWIDE;
        if (aCitywide !== bCitywide) {
          return aCitywide ? 1 : -1;
        }
        return compareBuckets(a, b);
      });
  }

  // The district with the most named streets, or null if none is rankable.
  function bestDistrict(streets) {
    const ranked = groupByDistrict(streets.filter((street) => isRankable(street.district)));
    return ranked.length ? ranked[0][0] : null;
  }

  return {
    CITYWIDE,
    canonicalizeStreetLabel,
    normalizeStreetName,
    formatStreet,
    buildStreetIndex,
    resolveGuessKey,
    matchGuess,
    groupByDistrict,
    bestDistrict
  };
}));
