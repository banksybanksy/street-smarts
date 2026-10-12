(function () {
  const sourceData = Array.isArray(window.STREET_DATA) ? window.STREET_DATA : [];

  const guessForm = document.getElementById("guessForm");
  const guessInput = document.getElementById("guessInput");
  const inputSign = document.getElementById("inputSign");
  const progressPercent = document.getElementById("progressPercent");
  const timerLabel = document.getElementById("timerLabel");
  const timerValue = document.getElementById("timer");
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

  const { CITYWIDE, buildStreetIndex, matchGuess, groupByDistrict, bestDistrict } = window.StreetMatching;

  const streetIndex = buildStreetIndex(sourceData);
  const totalStreets = streetIndex.streets.length;

  let guessedKeys = new Set();
  let guessedStreets = [];
  let startTime = null;
  let elapsedSeconds = 0;
  let timerId = null;
  let gameOver = false;
  let endReason = null;
  let clockMode = "countup";
  let countdownLimitSeconds = 0;

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
    timerValue.textContent = formatDuration(isCountdown ? getRemainingSeconds() : elapsedSeconds);
  }

  function syncElapsedSeconds() {
    if (!startTime) {
      return;
    }
    elapsedSeconds = Math.max(Math.floor((Date.now() - startTime) / 1000), 0);
  }

  function endIfOutOfTime() {
    if (startTime && clockMode === "countdown" && getRemainingSeconds() <= 0) {
      elapsedSeconds = countdownLimitSeconds;
      endReason = "timeout";
      endGame();
      return true;
    }
    return false;
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
      endIfOutOfTime();
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
    const pastHalfway = totalStreets > 0 && guessedStreets.length / totalStreets > 0.5;
    progressPercent.textContent = (pastHalfway ? "\u2192" : "\u2190") + " " + formatPercent(guessedStreets.length);
  }

  function setClockMode(nextMode, nextSeconds) {
    clockMode = nextMode;
    countdownLimitSeconds = nextMode === "countdown" ? Number(nextSeconds) || 180 : 0;

    clockButtons.forEach((button) => {
      const isActive = button.dataset.clockMode === clockMode &&
        String(button.dataset.clockSeconds || "") === String(nextMode === "countdown" ? countdownLimitSeconds : "");
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    updateTimerDisplay();

    if (!endIfOutOfTime() && !gameOver) {
      guessInput.focus();
    }
  }

  function showCorrectFeedback() {
    inputSign.classList.remove("shaking");
    inputSign.classList.add("correct");
    window.setTimeout(() => inputSign.classList.remove("correct"), 220);
  }

  function showWrongFeedback() {
    inputSign.classList.remove("correct");
    inputSign.classList.remove("shaking");
    // Force a reflow so the shake restarts on back-to-back misses.
    void inputSign.offsetWidth;
    inputSign.classList.add("shaking");
    window.setTimeout(() => inputSign.classList.remove("shaking"), 400);
  }

  // One guess can name several streets ("2nd" is 2nd Avenue and Second
  // Drive); those cascade in, a single new tag appears straight away.
  function appendGuessTags(streets) {
    streets.forEach((street, index) => {
      const tag = document.createElement("span");
      tag.className = "street-tag";
      tag.style.animationDelay = Math.min(index, 8) * 40 + "ms";
      tag.textContent = street.fullName;
      guessTags.appendChild(tag);
    });
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

  function districtLabel(district) {
    return district === CITYWIDE ? "Unmapped SF Streets" : district;
  }

  function resultsCopy(best) {
    const count = guessedStreets.length;
    if (count) {
      return {
        headline: best ? "You know " + districtLabel(best) + " best." : "You pulled names from all over San Francisco.",
        subtitle: "You named " + count + " of " + totalStreets + " San Francisco streets this round."
      };
    }
    if (endReason === "giveup") {
      return {
        headline: "You gave up before naming a single street.",
        subtitle: "That is one way to discover you do not, in fact, know the city."
      };
    }
    return {
      headline: "The city kept its secrets.",
      subtitle: "No street names landed this round. The next round should go better."
    };
  }

  function renderResults() {
    const districts = groupByDistrict(guessedStreets);
    const copy = resultsCopy(bestDistrict(guessedStreets));

    resultsHeadline.textContent = copy.headline;
    resultsSubtitle.textContent = copy.subtitle;

    statsGrid.replaceChildren(
      createStat("Named", String(guessedStreets.length)),
      createStat("Total", String(totalStreets)),
      createStat("Score", formatPercent(guessedStreets.length)),
      createStat("Time", formatDuration(elapsedSeconds))
    );

    districtGrid.replaceChildren();

    if (!districts.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No districts to report yet.";
      districtGrid.appendChild(empty);
      return;
    }

    districts.forEach(([district, streets], index) => {
      const card = document.createElement("article");
      card.className = "district-card";
      card.style.setProperty("--card-index", String(Math.min(index, 8)));

      const name = document.createElement("h3");
      name.className = "district-name";
      name.textContent = districtLabel(district) + " (" + streets.length + ")";

      const tagWrap = document.createElement("div");
      tagWrap.className = "district-tags";

      streets.forEach((street) => {
        const tag = document.createElement("span");
        tag.className = "district-tag";
        tag.textContent = street.fullName;
        tagWrap.appendChild(tag);
      });

      card.append(name, tagWrap);
      districtGrid.appendChild(card);
    });
  }

  function endGame() {
    if (gameOver) {
      return;
    }

    gameOver = true;
    stopTimer();
    guessInput.blur();
    renderResults();
    gameView.classList.add("is-hidden");
    resultsView.classList.remove("is-hidden");
    window.scrollTo(0, 0);
    playAgainButton.focus({ preventScroll: true });
  }

  function resetGame() {
    guessedKeys = new Set();
    guessedStreets = [];
    startTime = null;
    elapsedSeconds = 0;
    gameOver = false;
    endReason = null;
    stopTimer();
    guessInput.value = "";
    guessTags.replaceChildren();
    inputSign.classList.remove("correct", "shaking");
    refreshProgress();
    tagline.classList.remove("is-hidden");
    resultsView.classList.add("is-hidden");
    gameView.classList.remove("is-hidden");
    window.scrollTo(0, 0);
    guessInput.focus();
  }

  function handleGuess(rawValue) {
    guessInput.value = "";
    guessInput.focus();

    if (gameOver) {
      return;
    }

    const result = matchGuess(streetIndex, guessedKeys, rawValue);
    if (result.status === "empty") {
      return;
    }

    tagline.classList.add("is-hidden");
    startTimer();

    if (result.status !== "hit") {
      showWrongFeedback();
      return;
    }

    guessedKeys.add(result.key);
    guessedStreets.push(...result.streets);

    showCorrectFeedback();
    refreshProgress();
    appendGuessTags(result.streets);

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
    syncElapsedSeconds();
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

  setClockMode("countup");
  refreshProgress();

  if (!totalStreets) {
    // Without a street list every guess would shake as a miss, so lock the
    // round and say why.
    tagline.textContent = "The street list didn't load. Reload the page to try again.";
    tagline.setAttribute("role", "alert");
    guessInput.disabled = true;
    guessInput.placeholder = "No streets loaded";
    clockButtons.forEach((button) => { button.disabled = true; });
    giveUpButton.disabled = true;
    return;
  }

  guessInput.focus();
}());
