(function () {
  "use strict";

  const STORAGE_KEY = "math-trainer-state-v1";
  const ROUND_SIZE = 12;
  const REVIEW_ROUND_ID = "review";
  const AUTO_ADVANCE_DELAY = 200;
  const OPERATION_SYMBOLS = {
    addition: "+",
    subtraction: "−",
    multiplication: "×",
    division: "÷"
  };
  const MODE_LABELS = {
    addition: "Сложение",
    subtraction: "Вычитание",
    multiplication: "Умножение",
    division: "Деление",
    mixed: "Всё подряд",
    table: "Таблица умножения",
    review: "Разбор ошибок"
  };
  const DIFFICULTIES = {
    easy: {
      label: "1 знак",
      emoji: "👶🏻",
      addition: { min: 1, max: 10 },
      subtraction: { min: 1, max: 10 },
      multiplication: { left: [1, 10], right: [1, 10] },
      division: { divisor: [1, 10], quotient: [1, 10] }
    },
    medium: {
      label: "2 знака",
      emoji: "👦🏻",
      addition: { min: 10, max: 99 },
      subtraction: { min: 10, max: 99 },
      multiplication: { left: [2, 19], right: [2, 9] },
      division: { divisor: [2, 9], quotient: [2, 19] }
    },
    hard: {
      label: "До 3 знаков",
      emoji: "👴🏻",
      addition: { min: 100, max: 999 },
      subtraction: { min: 100, max: 999 },
      multiplication: { left: [10, 50], right: [2, 15] },
      division: { divisor: [2, 15], quotient: [10, 50] }
    },
    brain: {
      label: "До 4 знаков",
      emoji: "🧠",
      addition: { min: 1000, max: 9999 },
      subtraction: { min: 1000, max: 9999 },
      multiplication: { left: [10, 99], right: [10, 50] },
      division: { divisor: [10, 50], quotient: [10, 99] }
    }
  };
  const DIFFICULTY_BLEND = {
    hard: { current: 0.8, previous: "medium" },
    brain: { current: 0.8, previous: "hard" }
  };

  const screens = {
    home: document.querySelector("#home-screen"),
    game: document.querySelector("#game-screen"),
    result: document.querySelector("#result-screen")
  };
  const difficultyPicker = document.querySelector("#difficulty-picker");
  const difficultyNote = document.querySelector("#difficulty-note");
  const questionText = document.querySelector("#question-text");
  const problemSubtitle = document.querySelector("#problem-subtitle");
  const answerGrid = document.querySelector("#answer-grid");
  const progressBar = document.querySelector("#progress-bar");
  const progressCount = document.querySelector("#progress-count");
  const gameModeLabel = document.querySelector("#game-mode-label");
  const resultScore = document.querySelector("#result-score");
  const reviewButton = document.querySelector("#review-button");
  const reviewButtonLabel = reviewButton.querySelector(".action-button__label");
  const replayButton = document.querySelector("#replay-button");
  const confettiCanvas = document.querySelector("#confetti-canvas");
  const finishGameButton = document.querySelector("#finish-game-button");

  let state = loadState();
  let advanceTimer = 0;
  let confettiFrame = 0;
  let confettiTimeout = 0;
  let confettiStartTimer = 0;

  bindEvents();
  restoreView();
  registerServiceWorker();

  function bindEvents() {
    difficultyPicker.addEventListener("click", handleDifficultyClick);
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        startRound(button.dataset.mode);
      });
    });

    reviewButton.addEventListener("click", startReviewRound);
    replayButton.addEventListener("click", replayCurrentMode);
    finishGameButton.addEventListener("click", finishCurrentRound);
    window.addEventListener("beforeunload", persistState);
    document.addEventListener("visibilitychange", persistState);
    window.addEventListener("resize", resizeConfettiCanvas);
  }

  function handleDifficultyClick(event) {
    const option = event.target.closest(".difficulty-picker__option");
    if (!option) {
      return;
    }

    setDifficulty(option.dataset.difficulty);
  }

  function setDifficulty(difficultyId) {
    if (!DIFFICULTIES[difficultyId]) {
      return;
    }

    state.settings.difficulty = difficultyId;
    difficultyNote.textContent = DIFFICULTIES[difficultyId].label;

    difficultyPicker.querySelectorAll(".difficulty-picker__option").forEach((option) => {
      const isActive = option.dataset.difficulty === difficultyId;
      option.classList.toggle("difficulty-picker__option--active", isActive);
      option.setAttribute("aria-selected", String(isActive));
    });

    persistState();
  }

  function restoreView() {
    setDifficulty(state.settings.difficulty);
    state.activeRound = null;
    persistState();
    showScreen("home");
  }

  function startRound(mode) {
    clearAdvanceTimer();
    stopConfetti();

    const difficulty = state.settings.difficulty;
    const tasks = Array.from({ length: ROUND_SIZE }, () => generateTask(mode, difficulty));

    state.activeRound = {
      id: String(Date.now()),
      sourceMode: mode,
      mode,
      difficulty,
      index: 0,
      total: ROUND_SIZE,
      score: 0,
      tasks,
      mistakes: [],
      status: "playing",
      allowAdvance: false,
      lastAnswer: null,
      reviewQueue: []
    };

    renderGame();
    showScreen("game");
    persistState();
  }

  function replayCurrentMode() {
    const mode = state.lastSession ? state.lastSession.sourceMode : "mixed";
    startRound(mode);
  }

  function startReviewRound() {
    const session = state.lastSession;
    if (!session || session.mistakes.length === 0) {
      return;
    }

    clearAdvanceTimer();
    stopConfetti();

    state.activeRound = {
      id: REVIEW_ROUND_ID,
      sourceMode: session.sourceMode,
      mode: "review",
      difficulty: session.difficulty,
      index: 0,
      total: session.mistakes.length,
      score: 0,
      tasks: session.mistakes.map(cloneTask),
      mistakes: [],
      status: "playing",
      allowAdvance: false,
      lastAnswer: null,
      reviewQueue: session.mistakes.map(cloneTask)
    };

    renderGame();
    showScreen("game");
    persistState();
  }

  function renderGame() {
    const round = state.activeRound;
    if (!round) {
      return;
    }

    const task = getCurrentTask(round);
    if (!task) {
      finalizeRound();
      return;
    }

    if (round.mode === "review") {
      problemSubtitle.textContent = "Ошибки до полного решения";
    } else {
      problemSubtitle.textContent = `${DIFFICULTIES[round.difficulty].emoji} ${DIFFICULTIES[round.difficulty].label}`;
    }

    const total = round.total;
    const currentCount = round.mode === "review"
      ? Math.min(round.score + 1, total)
      : Math.min(round.index + 1, total);
    questionText.textContent = task.question;
    progressCount.textContent = `${currentCount} / ${total}`;
    progressBar.style.width = `${Math.max((currentCount / Math.max(total, 1)) * 100, 8)}%`;
    gameModeLabel.textContent = MODE_LABELS[round.mode] || MODE_LABELS[round.sourceMode];

    answerGrid.innerHTML = "";
    task.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-button";
      button.dataset.value = String(option);
      button.innerHTML = `<span class="answer-button__value">${option}</span>`;
      button.addEventListener("click", () => handleAnswer(option, button));
      answerGrid.appendChild(button);
    });
  }

  function handleAnswer(selected, clickedButton) {
    const round = state.activeRound;
    const task = round && getCurrentTask(round);
    if (!round || !task) {
      return;
    }

    if (round.allowAdvance) {
      advanceRound();
      return;
    }

    const isCorrect = selected === task.answer;
    round.lastAnswer = selected;

    if (isCorrect) {
      round.score += 1;
      markAnswers(task.answer, selected);
      haptic(10);
      persistState();

      clearAdvanceTimer();
      advanceTimer = window.setTimeout(() => {
        advanceRound();
      }, AUTO_ADVANCE_DELAY);
      return;
    }

    markAnswers(task.answer, selected);
    registerMistake(task, selected);
    round.allowAdvance = true;
    haptic([10, 40, 10]);
    answerGrid.querySelectorAll(".answer-button").forEach((button) => {
      button.classList.remove("answer-button--locked");
    });
    clickedButton.focus();
    persistState();
  }

  function markAnswers(correctValue, selectedValue) {
    answerGrid.querySelectorAll(".answer-button").forEach((button) => {
      const value = Number(button.dataset.value);
      button.classList.add("answer-button--locked");

      if (value === correctValue) {
        button.classList.add("answer-button--correct");
      } else if (value === selectedValue && selectedValue !== correctValue) {
        button.classList.add("answer-button--wrong");
      }
    });
  }

  function registerMistake(task, selected) {
    const round = state.activeRound;
    if (!round) {
      return;
    }

    const mistakeRecord = {
      ...cloneTask(task),
      selected
    };

    round.mistakes.push(mistakeRecord);

    if (round.mode === "review") {
      round.reviewQueue.push(cloneTask(task));
    }
  }

  function advanceRound() {
    const round = state.activeRound;
    if (!round) {
      return;
    }

    clearAdvanceTimer();
    round.allowAdvance = false;

    if (round.mode === "review") {
      round.reviewQueue.shift();
    } else {
      round.index += 1;
    }

    if (!getCurrentTask(round)) {
      finalizeRound();
      return;
    }

    renderGame();
    persistState();
  }

  function finalizeRound() {
    clearAdvanceTimer();

    const round = state.activeRound;
    if (!round) {
      return;
    }

    if (round.mode === "review") {
      state.lastSession = {
        sourceMode: round.sourceMode,
        mode: round.mode,
        difficulty: round.difficulty,
        score: round.score,
        total: round.total,
        mistakes: [],
        finishedAt: Date.now()
      };
    } else {
      state.lastSession = {
        sourceMode: round.sourceMode,
        mode: round.mode,
        difficulty: round.difficulty,
        score: round.score,
        total: round.tasks.length,
        mistakes: round.mistakes.map(cloneTask),
        finishedAt: Date.now()
      };
    }

    state.activeRound = null;
    showScreen("result");
    renderResult();
    persistState();
  }

  function finishCurrentRound() {
    if (!state.activeRound) {
      return;
    }

    finalizeRound();
  }

  function renderResult() {
    const session = state.lastSession;
    if (!session) {
      return;
    }

    resultScore.textContent = `${session.score} / ${session.total}`;
    reviewButton.disabled = session.mistakes.length === 0;
    reviewButtonLabel.textContent = session.mistakes.length === 0 ? "Ошибок нет" : "Разобрать ошибки";

    if (session.score === session.total) {
      queueConfetti();
    } else {
      stopConfetti();
    }
  }

  function showScreen(screenId) {
    Object.entries(screens).forEach(([id, screen]) => {
      screen.classList.toggle("screen--active", id === screenId);
      if (id === screenId) {
        screen.scrollTop = 0;
      }
    });
    window.scrollTo(0, 0);
  }

  function generateTask(mode, difficultyId) {
    if (mode === "mixed") {
      const modes = ["addition", "subtraction", "multiplication", "division"];
      return generateTask(pick(modes), difficultyId);
    }

    if (mode === "table") {
      return buildTableTask();
    }

    const effectiveDifficulty = pickDifficultyProfile(difficultyId);
    const profile = DIFFICULTIES[effectiveDifficulty];

    switch (mode) {
      case "addition":
        return buildAdditionTask(profile);
      case "subtraction":
        return buildSubtractionTask(profile);
      case "multiplication":
        return buildMultiplicationTask(profile);
      case "division":
        return buildDivisionTask(profile);
      default:
        return buildAdditionTask(profile);
    }
  }

  function pickDifficultyProfile(difficultyId) {
    const blend = DIFFICULTY_BLEND[difficultyId];
    if (!blend) {
      return difficultyId;
    }

    return Math.random() < blend.current ? difficultyId : blend.previous;
  }

  function buildAdditionTask(profile) {
    const left = randomInt(profile.addition.min, profile.addition.max);
    const right = randomInt(profile.addition.min, profile.addition.max);
    const answer = left + right;
    return formatTask("addition", left, right, answer);
  }

  function buildSubtractionTask(profile) {
    const a = randomInt(profile.subtraction.min, profile.subtraction.max);
    const b = randomInt(profile.subtraction.min, profile.subtraction.max);
    const left = Math.max(a, b);
    const right = Math.min(a, b);
    const answer = left - right;
    return formatTask("subtraction", left, right, answer);
  }

  function buildMultiplicationTask(profile) {
    const left = randomInt(profile.multiplication.left[0], profile.multiplication.left[1]);
    const right = randomInt(profile.multiplication.right[0], profile.multiplication.right[1]);
    const answer = left * right;
    return formatTask("multiplication", left, right, answer);
  }

  function buildDivisionTask(profile) {
    const divisor = randomInt(profile.division.divisor[0], profile.division.divisor[1]);
    const quotient = randomInt(profile.division.quotient[0], profile.division.quotient[1]);
    const dividend = divisor * quotient;
    return formatTask("division", dividend, divisor, quotient);
  }

  function buildTableTask() {
    const left = randomInt(1, 10);
    const right = randomInt(1, 10);
    const answer = left * right;
    return formatTask("multiplication", left, right, answer, "Таблица умножения");
  }

  function formatTask(operation, left, right, answer, subtitle) {
    const question = `${left} ${OPERATION_SYMBOLS[operation]} ${right}`;
    const options = shuffle(createOptions(answer));
    return {
      question,
      answer,
      options,
      operation,
      left,
      right,
      subtitle: subtitle || MODE_LABELS[operation]
    };
  }

  function createOptions(answer) {
    const options = new Set([answer]);
    const offsets = shuffle([1, -1, 10, -10]);
    for (const offset of offsets) {
      const candidate = normalizeOption(answer + offset, answer);
      if (candidate !== answer) {
        options.add(candidate);
        break;
      }
    }

    const transposed = transposeDigits(answer);
    if (transposed !== null && transposed !== answer) {
      options.add(transposed);
    }

    let attempt = 0;
    while (options.size < 4 && attempt < 18) {
      const candidate = sameLastDigitCandidate(answer, attempt);
      if (candidate !== answer) {
        options.add(candidate);
      }
      attempt += 1;
    }

    while (options.size < 4) {
      const jitter = randomInt(-Math.max(3, Math.ceil(Math.abs(answer) * 0.2)), Math.max(3, Math.ceil(Math.abs(answer) * 0.2)));
      const candidate = normalizeOption(answer + jitter, answer);
      if (candidate !== answer) {
        options.add(candidate);
      }
    }

    return Array.from(options).slice(0, 4);
  }

  function sameLastDigitCandidate(answer, attempt) {
    const span = Math.max(5, Math.ceil(Math.abs(answer || 10) * 0.2));
    const base = answer + randomInt(-span, span);
    const lastDigit = Math.abs(answer) % 10;
    let candidate = base - (Math.abs(base) % 10) + lastDigit;
    if (base < 0) {
      candidate *= -1;
    }

    if (candidate === answer) {
      candidate += attempt % 2 === 0 ? 10 : -10;
    }

    return normalizeOption(candidate, answer);
  }

  function transposeDigits(value) {
    const digits = String(Math.abs(value));
    if (digits.length < 2) {
      return null;
    }

    const swapped = digits.length === 2
      ? digits[1] + digits[0]
      : digits.slice(0, -2) + digits[digits.length - 1] + digits[digits.length - 2];
    const result = Number(swapped);
    return Number.isNaN(result) ? null : result;
  }

  function normalizeOption(candidate, answer) {
    if (answer >= 0) {
      return Math.max(0, Math.round(candidate));
    }

    return Math.round(candidate);
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function shuffle(values) {
    const array = values.slice();
    for (let index = array.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(0, index);
      [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
    }
    return array;
  }

  function pick(values) {
    return values[randomInt(0, values.length - 1)];
  }

  function getCurrentTask(round) {
    if (round.mode === "review") {
      return round.reviewQueue[0] || null;
    }

    return round.tasks[round.index] || null;
  }

  function cloneTask(task) {
    return JSON.parse(JSON.stringify(task));
  }

  function haptic(pattern) {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          settings: {
            difficulty: parsed.settings && DIFFICULTIES[parsed.settings.difficulty] ? parsed.settings.difficulty : "easy"
          },
          activeRound: parsed.activeRound || null,
          lastSession: parsed.lastSession || null
        };
      }
    } catch (error) {
      console.warn("Failed to restore state", error);
    }

    return {
      settings: {
        difficulty: "easy"
      },
      activeRound: null,
      lastSession: null
    };
  }

  function persistState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Failed to persist state", error);
    }
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch((error) => {
          console.warn("Service worker registration failed", error);
        });
      });
    }
  }

  function resizeConfettiCanvas() {
    if (!confettiCanvas) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const rect = confettiCanvas.getBoundingClientRect();
    confettiCanvas.width = rect.width * ratio;
    confettiCanvas.height = rect.height * ratio;
    const context = confettiCanvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function startConfetti() {
    if (!confettiCanvas) {
      return;
    }

    stopConfetti();
    resizeConfettiCanvas();
    const context = confettiCanvas.getContext("2d");
    const width = confettiCanvas.getBoundingClientRect().width;
    const height = confettiCanvas.getBoundingClientRect().height;
    const pieces = Array.from({ length: 90 }, () => ({
      x: randomInt(0, Math.round(width)),
      y: randomInt(-Math.round(height * 0.35), 0),
      size: randomInt(6, 12),
      vx: Math.random() * 2 - 1,
      vy: Math.random() * 2 + 1.5,
      rotation: Math.random() * Math.PI,
      spin: Math.random() * 0.25 + 0.04,
      color: pick(["#1f8a70", "#f6c86a", "#ff7f6a", "#4c89ff", "#ffffff"])
    }));

    const draw = () => {
      context.clearRect(0, 0, width, height);
      pieces.forEach((piece) => {
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rotation += piece.spin;
        piece.vy += 0.03;

        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.65);
        context.restore();
      });

      confettiFrame = window.requestAnimationFrame(draw);
    };

    draw();
    confettiTimeout = window.setTimeout(stopConfetti, 2600);
  }

  function queueConfetti() {
    if (confettiStartTimer) {
      window.clearTimeout(confettiStartTimer);
    }

    confettiStartTimer = window.setTimeout(() => {
      confettiStartTimer = 0;
      startConfetti();
    }, 0);
  }

  function stopConfetti() {
    if (confettiStartTimer) {
      window.clearTimeout(confettiStartTimer);
      confettiStartTimer = 0;
    }

    if (confettiFrame) {
      window.cancelAnimationFrame(confettiFrame);
      confettiFrame = 0;
    }
    if (confettiTimeout) {
      window.clearTimeout(confettiTimeout);
      confettiTimeout = 0;
    }

    if (confettiCanvas) {
      resizeConfettiCanvas();
      const context = confettiCanvas.getContext("2d");
      context.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
  }

  function clearAdvanceTimer() {
    if (advanceTimer) {
      window.clearTimeout(advanceTimer);
      advanceTimer = 0;
    }
  }
})();
