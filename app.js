(function () {
  const sourceData = Array.isArray(window.STREET_DATA) ? window.STREET_DATA : [];

  const guessForm = document.getElementById("guessForm");
  const guessInput = document.getElementById("guessInput");
  const inputSign = document.getElementById("inputSign");
  const progressPercent = document.getElementById("progressPercent");
  const timerLabel = document.getElementById("timerLabel");
  const timerEl = document.getElementById("timer");
  const tagline = document.getElementById("tagline");
  const guessTags = document.getElementById("guessTags");
  const giveUpButton = document.getElementById("giveUpButton");
  const clockButtons = Array.from(document.querySelectorAll("[data-clock-mode]"));
  const gameView = document.getElementById("gameView");
  const resultsView = document.getElementById("resultsView");
  const statsGrid = document.getElementById("statsGrid");
  const districtGrid = document.getElementById("districtGrid");
  const resultsHeadline = document.getElementById("resultsHeadline");
  const resultsSubtitle = document.getElementById("resultsSubtitle");
  const playAgainButton = document.getElementById("playAgainButton");

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

  const playableStreets = [];
  const streetLookup = new Map();

  for (const entry of sourceData) {
    const key = normalizeStreetName(entry.name);
    const street = {
      ...entry,
      key,
      id: key + "|" + normalizeStreetName(entry.suffix),
      fullName: formatStreet(entry)
    };
    const matches = streetLookup.get(key) || [];

    if (!matches.some((match) => match.id === street.id)) {
      matches.push(street);
      streetLookup.set(key, matches);
      playableStreets.push(street);
    }
  }

  const totalStreets = playableStreets.length;

  let guessedBaseKeys = new Set();
  let guessedStreetIds = new Set();
  let guessedStreets = [];
  let startTime = null;
  let elapsedSeconds = 0;
  let timerId = null;
  let gameOver = false;
  let endReason = null;
  let clockMode = "countup";
  let countdownLimitSeconds = 0;

  function ordinalSuffix(number) {
    const lastTwo = number % 100;
    if (lastTwo >= 11 && lastTwo <= 13) {
      return "th";
    }
    return ["th", "st", "nd", "rd"][number % 10] || "th";
  }

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

  // Resolves a guess to a lookup key: the name as typed, or the name with a
  // trailing street type dropped ("3rd street" -> "3rd").
  function resolveGuessKey(normalized) {
    if (streetLookup.has(normalized)) {
      return normalized;
    }
    const words = normalized.split(" ");
    if (words.length > 1 && STREET_TYPE_WORDS.has(words[words.length - 1])) {
      return words.slice(0, -1).join(" ");
    }
    return normalized;
  }

  function formatPercent(count) {
    const rawPercent = totalStreets === 0 ? 0 : (count / totalStreets) * 100;
    if (count === 0) {
      return "0%";
    }
    if (rawPercent < 0.1) {
      return "<0.1%";
    }
    return rawPercent < 10 ? rawPercent.toFixed(1) + "%" : Math.round(rawPercent) + "%";
  }

  function formatStreet(entry) {
    const baseName = canonicalizeStreetLabel(entry.name);
    return entry.suffix === "-" ? baseName : baseName + " " + entry.suffix;
  }

  function formatDuration(totalSeconds) {
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return minutes + ":" + seconds;
  }

  function getRemainingSeconds() {
    return Math.max(countdownLimitSeconds - elapsedSeconds, 0);
  }

  function updateTimerDisplay() {
    const isCountdown = clockMode === "countdown";
    timerLabel.textContent = isCountdown ? "left" : "time";
    timerEl.textContent = formatDuration(isCountdown ? getRemainingSeconds() : elapsedSeconds);
  }

  function syncElapsedSeconds() {
    if (!startTime) {
      return;
    }
    elapsedSeconds = Math.max(Math.floor((Date.now() - startTime) / 1000), 0);
  }

  function startTimer() {
    if (timerId) {
      return;
    }

    startTime = Date.now() - elapsedSeconds * 1000;
    updateTimerDisplay();
    timerId = window.setInterval(() => {
      syncElapsedSeconds();
      updateTimerDisplay();

      if (clockMode === "countdown" && getRemainingSeconds() <= 0) {
        elapsedSeconds = countdownLimitSeconds;
        endReason = "timeout";
        endGame();
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
    updateTimerDisplay();
  }

  function refreshProgress() {
    const rawPercent = totalStreets === 0 ? 0 : (guessedStreets.length / totalStreets) * 100;
    const arrow = rawPercent > 50 ? "\u2192" : "\u2190";
    progressPercent.textContent = arrow + " " + formatPercent(guessedStreets.length);
  }

  function setClockMode(nextMode, nextSeconds) {
    clockMode = nextMode;
    countdownLimitSeconds = nextMode === "countdown" ? Number(nextSeconds) || 180 : 0;

    clockButtons.forEach((button) => {
      const isActive = button.dataset.clockMode === clockMode &&
        String(button.dataset.clockSeconds || "") === String(nextMode === "countdown" ? countdownLimitSeconds : "");
      button.classList.toggle("is-active", isActive);
    });

    updateTimerDisplay();

    if (startTime && clockMode === "countdown" && getRemainingSeconds() <= 0) {
      elapsedSeconds = countdownLimitSeconds;
      endReason = "timeout";
      endGame();
      return;
    }

    if (!gameOver) {
      guessInput.focus();
    }
  }

  function hideTagline() {
    if (!totalStreets) {
      return;
    }
    tagline.classList.add("is-hidden");
  }

  function showCorrectFeedback() {
    inputSign.classList.remove("shaking");
    inputSign.classList.add("correct");
    window.setTimeout(() => inputSign.classList.remove("correct"), 220);
  }

  function showWrongFeedback() {
    inputSign.classList.remove("correct");
    inputSign.classList.remove("shaking");
    void inputSign.offsetWidth;
    inputSign.classList.add("shaking");
    window.setTimeout(() => inputSign.classList.remove("shaking"), 400);
  }

  function appendGuessTag(street, index) {
    const tag = document.createElement("span");
    tag.className = "street-tag";
    tag.style.animationDelay = (index % 10) * 30 + "ms";
    tag.textContent = street.fullName;
    guessTags.appendChild(tag);
  }

  function createStat(label, value) {
    const item = document.createElement("article");
    item.className = "stat";

    const statLabel = document.createElement("p");
    statLabel.className = "stat-label";
    statLabel.textContent = label;

    const statValue = document.createElement("p");
    statValue.className = "stat-value";
    statValue.textContent = value;

    item.append(statLabel, statValue);
    return item;
  }

  function bestDistrictLabel(district) {
    if (!district) {
      return "San Francisco";
    }
    if (district === "Citywide") {
      return "Unmapped SF Streets";
    }
    return district;
  }

  function getRankableDistrict(street) {
    return street.district && street.district !== "Citywide" ? street.district : null;
  }

  function renderResults() {
    const grouped = guessedStreets.reduce((acc, street) => {
      const bucket = acc.get(street.district) || [];
      bucket.push(street);
      acc.set(street.district, bucket);
      return acc;
    }, new Map());

    const rankedDistricts = guessedStreets.reduce((acc, street) => {
      const district = getRankableDistrict(street);
      if (!district) {
        return acc;
      }
      const bucket = acc.get(district) || [];
      bucket.push(street);
      acc.set(district, bucket);
      return acc;
    }, new Map());

    const sortedDistricts = [...grouped.entries()].sort((a, b) => {
      if (a[0] === "Citywide" && b[0] !== "Citywide") {
        return 1;
      }
      if (b[0] === "Citywide" && a[0] !== "Citywide") {
        return -1;
      }
      if (b[1].length !== a[1].length) {
        return b[1].length - a[1].length;
      }
      return a[0].localeCompare(b[0]);
    });

    const sortedRankedDistricts = [...rankedDistricts.entries()].sort((a, b) => {
      if (b[1].length !== a[1].length) {
        return b[1].length - a[1].length;
      }
      return a[0].localeCompare(b[0]);
    });

    const bestDistrict = sortedRankedDistricts[0]?.[0] || "San Francisco";
    const gaveUpCold = guessedStreets.length === 0 && endReason === "giveup";
    const headline = guessedStreets.length
      ? sortedRankedDistricts.length
        ? "You know " + bestDistrictLabel(bestDistrict) + " best."
        : "You pulled names from all over San Francisco."
      : gaveUpCold
        ? "You gave up before naming a single street."
        : "The city kept its secrets.";

    resultsHeadline.textContent = headline;
    resultsSubtitle.textContent = guessedStreets.length
      ? "You named " + guessedStreets.length + " of " + totalStreets + " San Francisco streets this round."
      : gaveUpCold
        ? "That is one way to discover you do not, in fact, know the city."
        : "No street names landed this round. The next round should go better.";

    statsGrid.innerHTML = "";
    statsGrid.append(
      createStat("Named", String(guessedStreets.length)),
      createStat("Total", String(totalStreets)),
      createStat("Score", formatPercent(guessedStreets.length)),
      createStat("Time", formatDuration(elapsedSeconds))
    );

    districtGrid.innerHTML = "";

    if (!sortedDistricts.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No districts to report yet.";
      districtGrid.appendChild(empty);
      return;
    }

    sortedDistricts.forEach(([district, streets], index) => {
      const card = document.createElement("article");
      card.className = "district-card";
      card.style.setProperty("--card-index", String(index));

      const name = document.createElement("h3");
      name.className = "district-name";
      name.textContent = bestDistrictLabel(district) + " (" + streets.length + ")";

      const tagWrap = document.createElement("div");
      tagWrap.className = "district-tags";

      streets
        .slice()
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .forEach((street) => {
          const tag = document.createElement("span");
          tag.className = "district-tag";
          tag.textContent = street.fullName;
          tagWrap.appendChild(tag);
        });

      card.append(name, tagWrap);
      districtGrid.appendChild(card);
    });
  }

  function switchToResults() {
    renderResults();
    gameView.classList.add("is-hidden");
    resultsView.classList.remove("is-hidden");
    playAgainButton.focus();
  }

  function endGame() {
    if (gameOver) {
      return;
    }

    gameOver = true;
    stopTimer();
    guessInput.blur();
    switchToResults();
  }

  function resetGame() {
    playAgainButton.blur();
    guessedBaseKeys = new Set();
    guessedStreetIds = new Set();
    guessedStreets = [];
    startTime = null;
    elapsedSeconds = 0;
    gameOver = false;
    endReason = null;
    stopTimer();
    guessInput.value = "";
    guessTags.innerHTML = "";
    inputSign.classList.remove("correct", "shaking");
    refreshProgress();
    tagline.classList.remove("is-hidden");
    resultsView.classList.add("is-hidden");
    gameView.classList.remove("is-hidden");
    updateTimerDisplay();
    window.setTimeout(() => guessInput.focus(), 40);
  }

  function handleGuess(rawValue) {
    const normalized = resolveGuessKey(normalizeStreetName(rawValue));

    if (!normalized || gameOver) {
      guessInput.value = "";
      guessInput.focus();
      return;
    }

    hideTagline();
    startTimer();

    const matches = streetLookup.get(normalized);
    const alreadyGuessed = guessedBaseKeys.has(normalized);

    if (!matches || !matches.length || alreadyGuessed) {
      showWrongFeedback();
      guessInput.value = "";
      guessInput.focus();
      return;
    }

    guessedBaseKeys.add(normalized);

    const newlyMatched = matches.filter((street) => !guessedStreetIds.has(street.id));
    newlyMatched.forEach((street) => {
      guessedStreetIds.add(street.id);
      guessedStreets.push(street);
    });

    showCorrectFeedback();
    refreshProgress();
    newlyMatched.forEach((street, index) => {
      appendGuessTag(street, guessedStreets.length - newlyMatched.length + index);
    });
    guessInput.value = "";
    guessInput.focus();

    if (guessedStreets.length >= totalStreets) {
      syncElapsedSeconds();
      endReason = "complete";
      endGame();
    }
  }

  guessForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleGuess(guessInput.value);
  });

  giveUpButton.addEventListener("click", () => {
    if (!startTime) {
      hideTagline();
    }
    if (startTime) {
      syncElapsedSeconds();
    }
    endReason = "giveup";
    endGame();
  });

  clockButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setClockMode(button.dataset.clockMode, button.dataset.clockSeconds);
    });
  });

  playAgainButton.addEventListener("click", resetGame);

  guessInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      guessInput.value = "";
    }
  });

  if (!totalStreets) {
    tagline.textContent = "The street list didn't load. Reload the page to try again.";
  }

  refreshProgress();
  setClockMode("countup");
  guessInput.focus();
}());
