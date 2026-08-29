const FLOORS = Array.from({ length: 13 }, (_, index) => index + 1);
const MAX_ATTEMPTS = 6;
const STORAGE_KEYS = { active: "floor13.activeRun", results: "floor13.results", settings: "floor13.settings", handle: "floor13.handle", challenges: "floor13.challenges" };

const Floor13Storage = {
  read(key, fallback) { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch (error) { return fallback; } },
  write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* local-only fallback */ } },
  remove(key) { try { localStorage.removeItem(key); } catch (error) { /* local-only fallback */ } },
  getResults() { return this.read(STORAGE_KEYS.results, []); },
  saveResult(result) { this.write(STORAGE_KEYS.results, [result, ...this.getResults()].slice(0, 40)); void Floor13Remote.publishResult(result); },
  saveChallenge(challenge) { this.write(STORAGE_KEYS.challenges, [challenge, ...this.read(STORAGE_KEYS.challenges, [])].slice(0, 40)); void Floor13Remote.publishChallenge(challenge); }
};

const Floor13Remote = {
  status: "local",
  db: null,
  modules: null,
  async initialize() {
    const setup = window.FLOOR13_FIREBASE_CONFIG;
    if (!setup?.enabled || !setup.config?.projectId || !setup.config?.appId) return;
    try {
      const [{ initializeApp }, auth, firestore] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js")
      ]);
      const app = initializeApp(setup.config);
      const authClient = auth.getAuth(app);
      await auth.signInAnonymously(authClient);
      this.db = firestore.getFirestore(app);
      this.modules = firestore;
      this.status = "firebase";
    } catch (error) {
      this.status = "local";
      console.warn("Firebase unavailable; continuing with local storage.", error);
    }
    document.getElementById("backend-status").textContent = this.status === "firebase" ? "FIREBASE READY" : "LOCAL ONLY";
  },
  async publishResult(result) {
    if (!this.db || !this.modules) return;
    try {
      await this.modules.addDoc(this.modules.collection(this.db, "results"), { ...result, createdAt: this.modules.serverTimestamp() });
    } catch (error) { console.warn("Firebase result sync skipped.", error); }
  },
  async publishChallenge(challenge) {
    if (!this.db || !this.modules) return;
    try {
      await this.modules.setDoc(this.modules.doc(this.db, "challenges", String(challenge.seed)), { ...challenge, createdAt: this.modules.serverTimestamp() });
    } catch (error) { console.warn("Firebase challenge sync skipped.", error); }
  },
  async leaderboard(seed) {
    if (!this.db || !this.modules) return [];
    try {
      const snapshot = await this.modules.getDocs(this.modules.query(this.modules.collection(this.db, "results"), this.modules.where("seed", "==", seed), this.modules.limit(50)));
      return snapshot.docs.map(doc => doc.data()).sort((a, b) => (b.floorReached - a.floorReached) || (a.guessesUsed - b.guessesUsed) || (a.elapsedMs - b.elapsedMs));
    } catch (error) { console.warn("Firebase leaderboard unavailable.", error); return []; }
  }
};

const Floor13Audio = {
  enabled: Floor13Storage.read(STORAGE_KEYS.settings, { enabled: true }).enabled !== false,
  volume: 0.035,
  context: null,
  unlock() {
    if (!this.enabled) return;
    if (!this.context) { const AudioContext = window.AudioContext || window.webkitAudioContext; if (AudioContext) this.context = new AudioContext(); }
    if (this.context?.state === "suspended") this.context.resume();
  },
  beep(type = "tap") {
    if (!this.enabled) return;
    this.unlock();
    if (!this.context) return;
    const tones = { tap: [240, 0.045], correct: [520, 0.12], fail: [110, 0.22], ascent: [680, 0.18], alarm: [180, 0.16] };
    const [frequency, duration] = tones[type] || tones.tap;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type === "alarm" || type === "fail" ? "sawtooth" : "square";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.72), now + duration);
    gain.gain.setValueAtTime(this.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now); oscillator.stop(now + duration);
  },
  toggle() { this.enabled = !this.enabled; Floor13Storage.write(STORAGE_KEYS.settings, { enabled: this.enabled }); if (this.enabled) this.beep("tap"); Floor13UI.updateAudioButton(); }
};

const Floor13Engine = {
  mode: "DAILY", seed: 0, dictionary: {}, acceptedWords: new Set(), wordsByLength: {}, run: null, targetWord: "", targetWordMetadata: {}, currentGuess: [], shatteredKeys: new Set(), transitionTimer: null, timerHandle: null,
  async boot() {
    try {
      const [dictionaryResponse, acceptedResponse] = await Promise.all([fetch("assets/data/dictionary.json"), fetch("assets/data/accepted-words.json")]);
      this.dictionary = await dictionaryResponse.json();
      this.acceptedWords = new Set((await acceptedResponse.json()).map(word => word.toUpperCase()));
      Object.values(this.dictionary).flat().forEach(entry => this.acceptedWords.add(entry.word.toUpperCase()));
      this.wordsByLength = Object.fromEntries(FLOORS.map(floor => [floor, [...this.acceptedWords].filter(word => word.length === floor)]));
      await Floor13Remote.initialize();
      Floor13UI.init(); this.showLobby();
    } catch (error) { console.error("Failed to map building floors.", error); Floor13UI.showLobbyStatus("The elevator map could not load. Refresh to reconnect.", true); }
  },
  showLobby() { document.getElementById("lobby-screen").hidden = false; document.getElementById("game-screen").hidden = true; document.getElementById("game-container").scrollTop = 0; document.getElementById("resume-btn").hidden = !Floor13Storage.read(STORAGE_KEYS.active, null); Floor13UI.updateAudioButton(); Floor13UI.updateDailyRunCard(); Floor13UI.renderStats(); },
  startDaily() { const seed = this.dailySeed(); if (this.hasCompletedDaily(seed)) { this.startRun("FREEPLAY", this.freshSeed("daily-replay")); Floor13UI.setStatus("DAILY CLEAR // FRESH ASCENT GENERATED"); return; } this.startRun("DAILY", seed); },
  startChallenge() { const seed = this.freshSeed("challenge"); this.startRun("CHALLENGE", seed); Floor13UI.copyChallengeLink(seed); },
  startPassPlay() { this.startRun("PASS_PLAY", this.freshSeed("pass-play"), [Floor13UI.handle(), "Guest 2"]); },
  hasCompletedDaily(seed = this.dailySeed()) { return Floor13Storage.getResults().some(result => result.mode === "DAILY" && result.seed === seed && result.outcome === "COMPLETE"); },
  freshSeed(prefix = "run") { let entropy = 0; if (window.crypto?.getRandomValues) { const values = new Uint32Array(1); window.crypto.getRandomValues(values); entropy = values[0]; } return this.hashSeed(`${prefix}-${Date.now()}-${entropy || Math.random()}`); },
  resumeRun() { const saved = Floor13Storage.read(STORAGE_KEYS.active, null); if (!saved) return this.showLobby(); this.run = saved; this.mode = saved.mode; this.seed = saved.seed; this.run.startedAt = Date.now() - this.run.elapsedMs; this.startClock(); this.showGame(); this.loadFloor(); Floor13UI.announce(`Resumed on floor ${this.run.floor}.`); },
  startRun(mode, seed, players = [Floor13UI.handle()]) {
    Floor13Audio.unlock(); this.mode = mode; this.seed = seed;
    this.run = { version: 2, seed, mode, players, activePlayerIndex: 0, handle: players[0], floor: 1, attempts: 0, guesses: [], solvedFloors: [], lifelines: { reveal: true, clue: true, fifty: true }, elapsedMs: 0, startedAt: Date.now(), result: "IN_PROGRESS" };
    Floor13Storage.write(STORAGE_KEYS.active, this.run); this.startClock(); this.showGame(); this.loadFloor();
  },
  showGame() { document.getElementById("lobby-screen").hidden = true; document.getElementById("game-screen").hidden = false; document.getElementById("game-container").scrollTop = 0; Floor13UI.closeAllOverlays(); },
  enterElevator() {
    if (!this.run || this.run.floor !== 1) return;
    this.run.floor = 2; this.run.attempts = 0; Floor13Audio.beep("ascent"); Floor13UI.setStatus("ELEVATOR ASCENDING // FLOOR 02"); this.loadFloor();
    if (this.run.mode === "PASS_PLAY") Floor13UI.showHandoff(this.run.handle, () => this.loadFloor());
  },
  loadFloor() {
    if (!this.run) return;
    if (this.run.floor === 1) {
      this.targetWord = ""; this.targetWordMetadata = {}; this.currentGuess = [];
      document.getElementById("game-screen").classList.add("boarding"); document.documentElement.style.setProperty("--grid-columns", 2);
      Floor13UI.renderBoard(); Floor13UI.renderKeyboard(); Floor13UI.updateHeader(); Floor13UI.updateBoardingState(); Floor13Storage.write(STORAGE_KEYS.active, this.run); return;
    }
    document.getElementById("game-screen").classList.remove("boarding");
    this.run.attempts = this.run.guesses.filter(guess => guess.floor === this.run.floor).length;
    const floorList = this.wordsByLength[this.run.floor] || [];
    const index = floorList.length ? Math.floor(Math.abs(Math.sin(this.seed + this.run.floor)) * floorList.length) : 0;
    this.targetWord = floorList[index] || "CAT";
    const themedFloorList = this.dictionary[`${this.run.floor}_letters`] || [];
    this.targetWordMetadata = themedFloorList.find(entry => entry.word.toUpperCase() === this.targetWord) || { word: this.targetWord, pos: "Word bank", hint: `A ${this.run.floor}-letter word from the shared Building 13 word bank.` };
    this.targetWord = this.targetWordMetadata.word.toUpperCase(); this.currentGuess = Array(this.run.floor).fill(""); this.shatteredKeys = new Set();
    document.documentElement.style.setProperty("--grid-columns", this.run.floor); Floor13UI.renderBoard(); Floor13UI.renderKeyboard(); Floor13UI.updateHeader(); this.replayFloorGuesses(); Floor13UI.updateKeyboardStates(); Floor13Storage.write(STORAGE_KEYS.active, this.run);
  },
  replayFloorGuesses() { this.run.guesses.filter(guess => guess.floor === this.run.floor).forEach(guess => Floor13UI.paintGuess(guess.row, guess.word, guess.evaluation)); },
  startClock() { clearInterval(this.timerHandle); this.timerHandle = setInterval(() => { if (!this.run || this.run.result !== "IN_PROGRESS") return; this.run.elapsedMs = Date.now() - this.run.startedAt; Floor13UI.updateHeader(); }, 1000); },
  addLetter(letter) { if (!this.run || this.run.result !== "IN_PROGRESS" || this.run.attempts >= MAX_ATTEMPTS || this.shatteredKeys.has(letter)) return; const slot = this.currentGuess.indexOf(""); if (slot === -1) return; this.currentGuess[slot] = letter; Floor13Audio.beep("tap"); Floor13UI.updateCurrentGuess(); },
  removeLetter() { const slot = this.currentGuess.map((letter, index) => letter ? index : -1).filter(index => index >= 0).pop(); if (slot === undefined) return; this.currentGuess[slot] = ""; Floor13UI.updateCurrentGuess(); },
  submitCurrentRow() {
    if (!this.run || this.run.result !== "IN_PROGRESS") return;
    const guess = this.currentGuess.join("");
    if (guess.length !== this.run.floor) { Floor13UI.shakeActiveRow(); Floor13UI.announce(`Enter ${this.run.floor} letters before submitting.`); return; }
    if (!this.acceptedWords.has(guess)) { Floor13UI.shakeActiveRow(); Floor13Audio.beep("alarm"); Floor13UI.announce(`${guess} is not in the accepted word list.`); Floor13UI.setStatus(`${guess} // UNKNOWN WORD`); return; }
    const evaluation = this.evaluateGuess(guess, this.targetWord); const row = this.run.attempts;
    this.run.guesses.push({ floor: this.run.floor, row, word: guess, evaluation }); this.run.attempts += 1; Floor13UI.paintGuess(row, guess, evaluation); Floor13UI.updateKeyboardStates(); this.currentGuess = Array(this.run.floor).fill(""); Floor13Storage.write(STORAGE_KEYS.active, this.run);
    if (guess === this.targetWord) { Floor13Audio.beep("correct"); this.run.solvedFloors.push(this.run.floor); Floor13UI.announce(`Floor ${this.run.floor} solved. Elevator ascending.`); if (this.run.floor === 13) return this.finishRun(true); this.beginFloorTransition(); }
    else if (this.run.attempts >= MAX_ATTEMPTS) { Floor13Audio.beep("fail"); this.finishRun(false); }
    else { Floor13UI.setStatus(`${MAX_ATTEMPTS - this.run.attempts} ATTEMPTS REMAIN`); Floor13UI.updateHeader(); }
  },
  beginFloorTransition() { clearTimeout(this.transitionTimer); document.getElementById("game-screen").classList.add("ascending"); this.transitionTimer = setTimeout(() => { document.getElementById("game-screen").classList.remove("ascending"); this.run.floor += 1; this.run.attempts = 0; if (this.run.mode === "PASS_PLAY") { this.run.activePlayerIndex = (this.run.activePlayerIndex + 1) % this.run.players.length; this.run.handle = this.run.players[this.run.activePlayerIndex]; Floor13UI.showHandoff(this.run.handle, () => this.loadFloor()); } else this.loadFloor(); }, 720); },
  finishRun(won) {
    clearInterval(this.timerHandle); this.run.result = won ? "COMPLETE" : "FAILED"; this.run.elapsedMs = Date.now() - this.run.startedAt;
    const result = { seed: this.run.seed, mode: this.run.mode, playerHandle: this.run.handle, outcome: this.run.result, floorReached: won ? 13 : this.run.floor, puzzlesSolved: this.run.solvedFloors.length, guessesUsed: this.run.guesses.length, lifelinesUsed: Object.values(this.run.lifelines).filter(value => !value).length, elapsedMs: this.run.elapsedMs, createdAt: new Date().toISOString() };
    Floor13Storage.saveResult(result); Floor13Storage.remove(STORAGE_KEYS.active); Floor13UI.openTerminal(won, result, this.targetWord);
  },
  evaluateGuess(guess, target) {
    const result = Array(target.length).fill("absent"); const remaining = target.split("");
    guess.split("").forEach((letter, index) => { if (letter === target[index]) { result[index] = "correct"; remaining[index] = null; } });
    guess.split("").forEach((letter, index) => { if (result[index] !== "absent") return; const targetIndex = remaining.indexOf(letter); if (targetIndex > -1) { result[index] = "present"; remaining[targetIndex] = null; } });
    return result;
  },
  useReveal() { if (!this.run?.lifelines.reveal) return; this.run.lifelines.reveal = false; const position = this.currentGuess.findIndex((letter, index) => letter !== this.targetWord[index]); if (position > -1) this.currentGuess[position] = this.targetWord[position]; Floor13Audio.beep("correct"); Floor13UI.setStatus(`LETTER ${position + 1} REVEALED`); Floor13UI.updateCurrentGuess(); Floor13UI.updateHeader(); },
  useClue() { if (!this.run?.lifelines.clue) return; this.run.lifelines.clue = false; Floor13Audio.beep("tap"); Floor13UI.openFeedback(this.targetWordMetadata); Floor13UI.updateHeader(); },
  useFifty() { if (!this.run?.lifelines.fifty) return; this.run.lifelines.fifty = false; const candidates = "QWERTYUIOPASDFGHJKLZXCVBNM".split("").filter(letter => !this.targetWord.includes(letter)); const count = Math.floor(candidates.length / 2); this.shatteredKeys = new Set(candidates.slice(0, count)); this.shatteredKeys.forEach(letter => document.querySelector(`[data-key="${letter}"]`)?.classList.add("shattered")); Floor13Audio.beep("alarm"); Floor13UI.setStatus(`${count} WRONG LETTERS DISABLED`); Floor13UI.updateHeader(); },
  dailySeed() { return this.hashSeed(new Date().toISOString().slice(0, 10)); },
  hashSeed(value) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); return Math.abs(hash >>> 0); }
};

const Floor13InputController = { init() { window.addEventListener("keydown", event => { if (document.querySelector(".overlay-visible")) { if (event.key === "Escape") Floor13UI.closeTopOverlay(); return; } if (event.key === "Backspace") Floor13Engine.removeLetter(); else if (event.key === "Enter") Floor13Engine.submitCurrentRow(); else if (/^[a-zA-Z]$/.test(event.key)) Floor13Engine.addLetter(event.key.toUpperCase()); }); } };

const Floor13UI = {
  init() {
    document.addEventListener("click", event => {
      const action = event.target.closest("[data-action]")?.dataset.action; if (!action) return; Floor13Audio.unlock();
      const actions = {
        daily: () => Floor13Engine.startDaily(), challenge: () => Floor13Engine.startChallenge(), "pass-play": () => Floor13Engine.startPassPlay(), resume: () => Floor13Engine.resumeRun(), "board-elevator": () => Floor13Engine.enterElevator(), stats: () => this.openStats(), "game-stats": () => this.openStats(), audio: () => Floor13Audio.toggle(),
        reveal: () => Floor13Engine.useReveal(), clue: () => Floor13Engine.useClue(), fifty: () => Floor13Engine.useFifty(), "close-feedback": () => this.closeFeedback(),
        retry: () => { const mode = Floor13Engine.run?.mode || Floor13Engine.mode; const fresh = mode === "FREEPLAY" || (mode === "DAILY" && Floor13Engine.run?.result === "COMPLETE"); this.closeTerminal(); Floor13Engine.startRun(fresh ? "FREEPLAY" : mode, fresh ? Floor13Engine.freshSeed("replay") : Floor13Engine.seed, Floor13Engine.run?.players || [this.handle()]); if (fresh) this.setStatus("FRESH ASCENT GENERATED"); }, share: () => this.shareResult(), lobby: () => { this.closeAllOverlays(); Floor13Engine.showLobby(); },
        quit: () => { if (confirm("Leave this run? Your progress will be saved.")) Floor13Engine.showLobby(); }, "handoff-ready": () => this.closeHandoff(), "close-stats": () => this.closeStats()
      }; actions[action]?.();
    }); Floor13InputController.init();
  },
  handle() { const input = document.getElementById("player-handle"); const handle = (input.value || "Operator").trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 16) || "Operator"; input.value = handle; Floor13Storage.write(STORAGE_KEYS.handle, handle); return handle; },
  updateAudioButton() { document.querySelectorAll("[data-action=audio]").forEach(button => { button.textContent = Floor13Audio.enabled ? "SOUND ON" : "SOUND OFF"; button.setAttribute("aria-pressed", String(Floor13Audio.enabled)); }); },
  updateDailyRunCard() { const cleared = Floor13Engine.hasCompletedDaily(); document.getElementById("daily-run-kicker").textContent = cleared ? "KEEP CLIMBING" : "TODAY'S RUN"; document.getElementById("daily-run-title").textContent = cleared ? "FRESH ASCENT" : "DAILY ASCENT"; document.getElementById("daily-run-description").textContent = cleared ? "New words, new seed, every time." : "Same seed for everyone."; },
  renderBoard() { const board = document.getElementById("board-canvas"); board.innerHTML = ""; const floor = Math.max(2, Floor13Engine.run.floor); for (let row = 0; row < MAX_ATTEMPTS; row += 1) { const rowElement = document.createElement("div"); rowElement.className = "board-row"; rowElement.dataset.row = row; for (let index = 0; index < floor; index += 1) { const cell = document.createElement("div"); cell.className = "letter-box"; cell.id = `cell-${row}-${index}`; cell.setAttribute("aria-label", `Floor ${Floor13Engine.run.floor}, row ${row + 1}, position ${index + 1}, empty`); rowElement.appendChild(cell); } board.appendChild(rowElement); } },
  updateCurrentGuess() { Floor13Engine.currentGuess.forEach((letter, index) => { const cell = document.getElementById(`cell-${Floor13Engine.run.attempts}-${index}`); if (cell) { cell.textContent = letter; cell.classList.toggle("filled", Boolean(letter)); } }); },
  paintGuess(row, word, evaluation) { word.split("").forEach((letter, index) => { const cell = document.getElementById(`cell-${row}-${index}`); if (!cell) return; cell.textContent = letter; cell.classList.add("filled", evaluation[index]); cell.setAttribute("aria-label", `${letter}, ${evaluation[index]}`); }); },
  renderKeyboard() { const wrapper = document.getElementById("keyboard-wrapper"); wrapper.innerHTML = ""; [["Q","W","E","R","T","Y","U","I","O","P"],["A","S","D","F","G","H","J","K","L"],["ENTER","Z","X","C","V","B","N","M","BACKSPACE"]].forEach(row => { const rowElement = document.createElement("div"); rowElement.className = "keyboard-row"; row.forEach(key => { const button = document.createElement("button"); button.type = "button"; button.className = "keyboard-key"; button.dataset.key = key; button.textContent = key === "BACKSPACE" ? "⌫" : key === "ENTER" ? "↵" : key; button.setAttribute("aria-label", key === "BACKSPACE" ? "Backspace" : key === "ENTER" ? "Submit guess" : `Letter ${key}`); button.addEventListener("click", () => key === "ENTER" ? Floor13Engine.submitCurrentRow() : key === "BACKSPACE" ? Floor13Engine.removeLetter() : Floor13Engine.addLetter(key)); rowElement.appendChild(button); }); wrapper.appendChild(rowElement); }); },
  updateKeyboardStates() { const states = {}; Floor13Engine.run?.guesses.filter(guess => guess.floor === Floor13Engine.run.floor).forEach(guess => guess.word.split("").forEach((letter, index) => { const next = guess.evaluation[index]; if (next === "correct" || (next === "present" && states[letter] !== "correct")) states[letter] = next; else if (!states[letter]) states[letter] = "absent"; })); document.querySelectorAll(".keyboard-key[data-key]").forEach(button => { const state = states[button.dataset.key]; if (state) button.classList.add(state); }); },
  updateHeader() { if (!Floor13Engine.run) return; const floor = Floor13Engine.run.floor; document.getElementById("stat-level").textContent = `FLOOR ${String(floor).padStart(2, "0")} / 13`; document.getElementById("stat-player").textContent = Floor13Engine.run.handle.toUpperCase(); document.getElementById("stat-timer").textContent = this.formatTime(Floor13Engine.run.elapsedMs); document.getElementById("mode-label").textContent = Floor13Engine.run.mode.replace("_", " "); document.getElementById("floor-progress").style.width = `${((floor - 1) / 12) * 100}%`; const remaining = Object.values(Floor13Engine.run.lifelines).filter(Boolean).length; document.getElementById("lifeline-status").textContent = `${remaining} AVAILABLE`; ["reveal", "clue", "fifty"].forEach(name => { const button = document.getElementById(`btn-${name}`); button.disabled = floor === 1 || !Floor13Engine.run.lifelines[name]; button.classList.toggle("spent", button.disabled); }); this.updateBoardingState(); this.updateParallax(); },
  updateBoardingState() { const floor = Floor13Engine.run?.floor || 1; document.getElementById("boarding-copy").textContent = floor === 1 ? "Step into the car. Floor 02 is waiting with a two-letter code." : `The car is moving through the building. Next stop: floor ${String(Math.min(13, floor + 1)).padStart(2, "0")}.`; },
  updateParallax() { const floor = Floor13Engine.run?.floor || 1; document.getElementById("game-screen")?.style.setProperty("--floor-shift", `${(floor - 1) * -3}px`); },
  formatTime(ms) { const totalSeconds = Math.floor(ms / 1000); return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`; },
  setStatus(message) { document.getElementById("status-live").textContent = message; document.getElementById("visible-status").textContent = message; }, announce(message) { this.setStatus(message); },
  shakeActiveRow() { const row = document.querySelector(`.board-row[data-row="${Floor13Engine.run.attempts}"]`); if (row) { row.classList.remove("shake-error"); void row.offsetWidth; row.classList.add("shake-error"); } },
  openFeedback(metadata) { this.lastFocusedElement = document.activeElement; document.getElementById("feedback-pos").textContent = metadata.pos || "FIELD NOTE"; document.getElementById("feedback-copy").textContent = metadata.hint; this.showOverlay("feedback-overlay"); document.querySelector("#feedback-panel .panel-close").focus(); },
  closeFeedback() { this.hideOverlay("feedback-overlay"); this.lastFocusedElement?.focus?.(); },
  openTerminal(won, result, answer) { this.lastFocusedElement = document.activeElement; document.getElementById("modal-eyebrow").textContent = won ? "BUILDING 13 // CLEAR" : "BUILDING 13 // FAILURE REPORT"; document.getElementById("modal-headline").textContent = won ? "ASCENT COMPLETE" : "CABLES SNAPPED"; document.getElementById("modal-summary").textContent = won ? "You reached the thirteenth floor and took the elevator beyond superstition." : `The elevator stopped on floor ${result.floorReached}. The answer code was ${answer}.`; document.getElementById("result-stats").innerHTML = `<span><b>${result.floorReached}</b><small>FLOOR REACHED</small></span><span><b>${result.guessesUsed}</b><small>GUESSES</small></span><span><b>${this.formatTime(result.elapsedMs)}</b><small>TIME</small></span>`; document.getElementById("terminal-light").classList.toggle("success", won); this.showOverlay("terminal-overlay"); document.getElementById("modal-action-btn").focus(); },
  closeTerminal() { this.hideOverlay("terminal-overlay"); },
  shareResult() { const result = Floor13Storage.getResults()[0]; const text = result ? `TRISKAIDEKAPHOBIA // ${result.outcome === "COMPLETE" ? "13 FLOORS" : `FLOOR ${result.floorReached}`} // ${result.guessesUsed} guesses // ${this.formatTime(result.elapsedMs)} // seed ${result.seed}` : "TRISKAIDEKAPHOBIA // FLOOR 13"; const copy = navigator.clipboard?.writeText(text); copy?.then(() => this.setStatus("RESULT COPIED TO CLIPBOARD")).catch(() => this.setStatus(text)); if (!copy) this.setStatus(text); },
  copyChallengeLink(seed) { const challenge = { seed, creatorHandle: this.handle(), creationDate: new Date().toISOString(), targetMode: "CHALLENGE" }; Floor13Storage.saveChallenge(challenge); const url = `${window.location.origin}${window.location.pathname}?seed=${seed}&mode=challenge`; window.history.replaceState({}, "", `?seed=${seed}&mode=challenge`); const copy = navigator.clipboard?.writeText(url); copy?.then(() => this.setStatus("CHALLENGE LINK COPIED TO CLIPBOARD")).catch(() => this.setStatus(`CHALLENGE SEED: ${seed}`)); if (!copy) this.setStatus(`CHALLENGE SEED: ${seed}`); },
  showHandoff(player, onReady) { this.handoffCallback = onReady || null; document.getElementById("handoff-title").textContent = `${player.toUpperCase()} // TAKE THE FLOOR`; this.showOverlay("handoff-overlay"); document.querySelector("#handoff-overlay .outline-button").focus(); },
  closeHandoff() { this.hideOverlay("handoff-overlay"); const callback = this.handoffCallback; this.handoffCallback = null; callback?.(); },
  openStats() { this.renderStats(); this.showOverlay("stats-overlay"); document.querySelector("#stats-overlay .panel-close").focus(); }, closeStats() { this.hideOverlay("stats-overlay"); },
  renderStats() { const results = Floor13Storage.getResults(); const wins = results.filter(result => result.outcome === "COMPLETE").length; document.getElementById("stats-summary").innerHTML = `<span><b>${results.length}</b><small>RUNS</small></span><span><b>${wins}</b><small>CLEARS</small></span><span><b>${results.length ? Math.max(...results.map(result => result.floorReached ?? result.floorsReached ?? 0)) : 0}</b><small>BEST FLOOR</small></span>`; document.getElementById("history-list").innerHTML = results.length ? results.slice(0, 8).map(result => `<div class="history-item"><span>${result.outcome === "COMPLETE" ? "▲" : "▽"} ${result.mode.replace("_", " ")}</span><strong>floor ${result.floorReached ?? result.floorsReached ?? 0}</strong><small>${this.formatTime(result.elapsedMs)} · ${new Date(result.createdAt).toLocaleDateString()}</small></div>`).join("") : "<p class=\"empty-state\">No completed runs yet. The building is waiting.</p>"; },
  showLobbyStatus(message, error = false) { const element = document.getElementById("lobby-status"); element.textContent = message; element.classList.toggle("error", error); },
  showOverlay(id) { const overlay = document.getElementById(id); overlay.classList.remove("overlay-hidden"); overlay.classList.add("overlay-visible"); overlay.setAttribute("aria-hidden", "false"); },
  hideOverlay(id) { const overlay = document.getElementById(id); overlay.classList.add("overlay-hidden"); overlay.classList.remove("overlay-visible"); overlay.setAttribute("aria-hidden", "true"); },
  closeTopOverlay() { ["feedback-overlay", "terminal-overlay", "handoff-overlay", "stats-overlay"].some(id => { if (document.getElementById(id).classList.contains("overlay-visible")) { this.hideOverlay(id); return true; } return false; }); },
  closeAllOverlays() { ["feedback-overlay", "terminal-overlay", "handoff-overlay", "stats-overlay"].forEach(id => this.hideOverlay(id)); }
};

window.render_game_to_text = () => JSON.stringify({ screen: document.getElementById("game-screen").hidden ? "lobby" : "game", mode: Floor13Engine.run?.mode || "LOBBY", seed: Floor13Engine.run?.seed || null, player: Floor13Engine.run?.handle || null, floor: Floor13Engine.run?.floor || 0, attempt: Floor13Engine.run?.attempts || 0, currentGuess: Floor13Engine.currentGuess.join(""), lifelines: Floor13Engine.run?.lifelines || {}, timer: Floor13Engine.run?.elapsedMs || 0, status: document.getElementById("status-live")?.textContent || "" });
window.advanceTime = ms => { if (Floor13Engine.run?.result === "IN_PROGRESS") { Floor13Engine.run.elapsedMs += ms; Floor13Engine.run.startedAt -= ms; Floor13UI.updateHeader(); } };
window.onload = () => { document.getElementById("player-handle").value = Floor13Storage.read(STORAGE_KEYS.handle, "Operator"); Floor13Engine.boot().then(() => { const params = new URLSearchParams(window.location.search); if (params.get("seed")) Floor13Engine.startRun(params.get("mode") === "challenge" ? "CHALLENGE" : "DAILY", Number(params.get("seed")) || Floor13Engine.dailySeed()); }); };
