const FLOORS = Array.from({ length: 13 }, (_, index) => index + 1);
const MAX_ATTEMPTS = 6;
const FLOOR_TRANSITION_DURATIONS = { closing: 480, traveling: 1100, arrival: 660, opening: 640 };
const STORAGE_KEYS = { active: "floor13.activeRun", results: "floor13.results", settings: "floor13.settings", handle: "floor13.handle", challenges: "floor13.challenges", room: "floor13.room" };
const CHAT_MAX_LENGTH = 280;
const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1000;

const Floor13Storage = {
  read(key, fallback) { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch (error) { return fallback; } },
  write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* local-only fallback */ } },
  remove(key) { try { localStorage.removeItem(key); } catch (error) { /* local-only fallback */ } },
  getResults() { return this.read(STORAGE_KEYS.results, []); },
  saveResult(result) { this.write(STORAGE_KEYS.results, [result, ...this.getResults()].slice(0, 40)); void Floor13Remote.publishResult(result); },
  saveChallenge(challenge) { this.write(STORAGE_KEYS.challenges, [challenge, ...this.read(STORAGE_KEYS.challenges, [])].slice(0, 40)); void Floor13Remote.publishChallenge(challenge); }
};

const Floor13Remote = {
  status: "local", db: null, modules: null, auth: null, uid: null, roomId: "", lastSession: null, sessionUnsubscribe: null, chatUnsubscribe: null, voiceUnsubscribe: null, presenceUnsubscribe: null, presenceTimer: null, onSession: null, onChat: null, onPresence: null,
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
      this.auth = authClient;
      this.uid = authClient.currentUser?.uid || "";
      this.status = "firebase";
    } catch (error) {
      this.status = "local";
      console.warn("Firebase unavailable; continuing with local storage.", error);
    }
    document.getElementById("backend-status").textContent = this.status === "firebase" ? "FIREBASE READY" : "LOCAL ONLY";
  },
  isReady() { return this.status === "firebase" && this.db && this.modules && this.uid; },
  configure(listeners) { this.onSession = listeners.onSession; this.onChat = listeners.onChat; this.onPresence = listeners.onPresence; },
  sessionRef(roomId = this.roomId) { return this.modules.doc(this.db, "sessions", roomId); },
  makeRoomId() { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const values = new Uint32Array(6); window.crypto?.getRandomValues?.(values); return Array.from(values, value => alphabet[value % alphabet.length]).join(""); },
  roomPlayers(session) { return Object.values(session?.players || {}); },
  roomPlayerCount(session) { return this.roomPlayers(session).length; },
  async createRoom(displayName) {
    if (!this.isReady()) throw new Error("Online rooms are unavailable until Firebase is configured.");
    const roomId = this.makeRoomId();
    const player = { id: this.uid, name: displayName, role: "host", joinedAt: new Date().toISOString() };
    await this.modules.setDoc(this.sessionRef(roomId), { roomId, seed: Floor13Engine.freshSeed("online-room"), mode: "ONLINE", status: "WAITING", players: { [this.uid]: player }, playerIds: [this.uid], activePlayerId: this.uid, activePlayerIndex: 0, floor: 1, attempts: 0, guesses: [], solvedFloors: [], lifelines: { reveal: true, clue: true, fifty: true }, result: "IN_PROGRESS", elapsedMs: 0, startedAt: Date.now(), version: 0, expiresAt: new Date(Date.now() + ROOM_EXPIRY_MS), createdAt: this.modules.serverTimestamp(), updatedAt: this.modules.serverTimestamp() });
    await this.attachRoom(roomId);
    return roomId;
  },
  async joinRoom(roomId, displayName) {
    if (!this.isReady()) throw new Error("Online rooms are unavailable until Firebase is configured.");
    const normalizedRoomId = roomId.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(normalizedRoomId)) throw new Error("Enter a six-character room code.");
    await this.modules.runTransaction(this.db, async transaction => {
      const reference = this.sessionRef(normalizedRoomId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new Error("That room could not be found.");
      const session = snapshot.data();
      const expiresAt = session.expiresAt?.toMillis?.() || Date.parse(session.expiresAt) || 0;
      if (expiresAt && expiresAt <= Date.now()) throw new Error("That room has expired.");
      if (session.status !== "WAITING") throw new Error("That ascent has already started.");
      if ((session.playerIds || []).includes(this.uid)) return;
      if ((session.playerIds || []).length >= 2) throw new Error("That room already has two operators.");
      const player = { id: this.uid, name: displayName, role: "guest", joinedAt: new Date().toISOString() };
      transaction.update(reference, { [`players.${this.uid}`]: player, playerIds: [...session.playerIds, this.uid], updatedAt: this.modules.serverTimestamp() });
    });
    await this.attachRoom(normalizedRoomId);
    return normalizedRoomId;
  },
  async attachRoom(roomId) {
    this.detachRoom();
    this.roomId = roomId;
    Floor13Storage.write(STORAGE_KEYS.room, { roomId });
    const reference = this.sessionRef(roomId);
    this.sessionUnsubscribe = this.modules.onSnapshot(reference, snapshot => {
      if (!snapshot.exists()) return;
      const session = snapshot.data();
      const expiresAt = session.expiresAt?.toMillis?.() || Date.parse(session.expiresAt) || 0;
      if (expiresAt && expiresAt <= Date.now()) { this.onSession?.({ error: "This private room has expired." }); this.detachRoom(); this.roomId = ""; Floor13Storage.remove(STORAGE_KEYS.room); Floor13Voice.disconnect(); return; }
      this.lastSession = session;
      this.onSession?.(session);
      Floor13Voice.updateSession(session);
    }, error => this.onSession?.({ error: error.message }));
    const messages = this.modules.query(this.modules.collection(reference, "messages"), this.modules.orderBy("createdAt", "asc"), this.modules.limitToLast(80));
    this.chatUnsubscribe = this.modules.onSnapshot(messages, snapshot => this.onChat?.(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))), error => this.onChat?.({ error: error.message }));
    const presence = this.modules.collection(reference, "presence");
    this.presenceUnsubscribe = this.modules.onSnapshot(presence, snapshot => this.onPresence?.(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))), error => this.onPresence?.({ error: error.message }));
    void this.updatePresence(); this.presenceTimer = setInterval(() => void this.updatePresence(), 15000);
  },
  listenVoiceSignals(callback) {
    this.voiceUnsubscribe?.();
    if (!this.roomId || !this.isReady()) return;
    const signals = this.modules.query(this.modules.collection(this.sessionRef(), "voiceSignals"), this.modules.where("to", "==", this.uid), this.modules.limitToLast(40));
    this.voiceUnsubscribe = this.modules.onSnapshot(signals, snapshot => snapshot.docChanges().forEach(change => { if (change.type === "added") callback({ id: change.doc.id, ...change.doc.data() }); }));
  },
  async updatePresence() {
    if (!this.roomId || !this.isReady()) return;
    try {
      await this.modules.setDoc(this.modules.doc(this.db, "sessions", this.roomId, "presence", this.uid), { id: this.uid, name: Floor13UI.handle(), updatedAt: this.modules.serverTimestamp() }, { merge: true });
    } catch (error) {
      this.onPresence?.({ error: error.message });
    }
  },
  detachRoom() { this.sessionUnsubscribe?.(); this.chatUnsubscribe?.(); this.voiceUnsubscribe?.(); this.presenceUnsubscribe?.(); clearInterval(this.presenceTimer); this.sessionUnsubscribe = null; this.chatUnsubscribe = null; this.voiceUnsubscribe = null; this.presenceUnsubscribe = null; this.presenceTimer = null; this.lastSession = null; },
  async startRoom() {
    if (!this.roomId) return;
    await this.modules.runTransaction(this.db, async transaction => {
      const reference = this.sessionRef(); const snapshot = await transaction.get(reference); if (!snapshot.exists()) throw new Error("Room no longer exists.");
      const session = snapshot.data(); if (session.players?.[this.uid]?.role !== "host") throw new Error("Only the host can start the ascent."); if ((session.playerIds || []).length < 2) throw new Error("Waiting for a second operator.");
      transaction.update(reference, { status: "IN_PROGRESS", startedAt: Date.now(), version: (session.version || 0) + 1, updatedAt: this.modules.serverTimestamp() });
    });
  },
  async advanceBoarding(expectedVersion) {
    await this.modules.runTransaction(this.db, async transaction => {
      const reference = this.sessionRef(); const snapshot = await transaction.get(reference); if (!snapshot.exists()) throw new Error("Room no longer exists.");
      const session = snapshot.data(); if (session.activePlayerId !== this.uid) throw new Error("Wait for your turn."); if (session.version !== expectedVersion || session.floor !== 1) throw new Error("The room changed. Reconnecting to the latest floor.");
      transaction.update(reference, { floor: 2, attempts: 0, version: session.version + 1, updatedAt: this.modules.serverTimestamp() });
    });
  },
  async submitGuess(payload) {
    await this.modules.runTransaction(this.db, async transaction => {
      const reference = this.sessionRef(); const snapshot = await transaction.get(reference); if (!snapshot.exists()) throw new Error("Room no longer exists.");
      const session = snapshot.data(); if (session.status !== "IN_PROGRESS" || session.result !== "IN_PROGRESS") throw new Error("This ascent is no longer active."); if (session.activePlayerId !== this.uid) throw new Error("Wait for the other operator's turn."); if (session.version !== payload.expectedVersion || session.floor !== payload.floor || session.attempts !== payload.attempts) throw new Error("The room changed. Reconnecting to the latest floor.");
      const guesses = [...(session.guesses || []), payload.guessRecord]; const nextAttempts = session.attempts + 1; const update = { guesses, elapsedMs: Floor13Engine.run?.elapsedMs || session.elapsedMs || 0, version: session.version + 1, updatedAt: this.modules.serverTimestamp() };
      if (payload.correct) {
        const nextFloor = session.floor === 13 ? 13 : session.floor + 1; const nextPlayerIndex = session.floor === 13 ? session.activePlayerIndex : (session.activePlayerIndex + 1) % session.playerIds.length;
        Object.assign(update, { floor: nextFloor, attempts: 0, solvedFloors: [...(session.solvedFloors || []), session.floor], activePlayerIndex: nextPlayerIndex, activePlayerId: session.playerIds[nextPlayerIndex], result: session.floor === 13 ? "COMPLETE" : "IN_PROGRESS" });
      } else if (nextAttempts >= MAX_ATTEMPTS) Object.assign(update, { attempts: nextAttempts, result: "FAILED" });
      else update.attempts = nextAttempts;
      transaction.update(reference, update);
    });
  },
  async useLifeline(name, expectedVersion) {
    await this.modules.runTransaction(this.db, async transaction => {
      const reference = this.sessionRef(); const snapshot = await transaction.get(reference); if (!snapshot.exists()) throw new Error("Room no longer exists.");
      const session = snapshot.data(); if (session.activePlayerId !== this.uid || session.version !== expectedVersion || !session.lifelines?.[name]) throw new Error("That lifeline is no longer available.");
      transaction.update(reference, { [`lifelines.${name}`]: false, version: session.version + 1, updatedAt: this.modules.serverTimestamp() });
    });
  },
  async sendChat(body) {
    const message = body.trim().slice(0, CHAT_MAX_LENGTH); if (!message || !this.roomId || !this.isReady()) return;
    await this.modules.addDoc(this.modules.collection(this.sessionRef(), "messages"), { senderId: this.uid, senderName: Floor13UI.handle(), body: message, createdAt: this.modules.serverTimestamp() });
  },
  async sendVoiceSignal(signal) {
    if (!this.roomId || !this.isReady()) return;
    await this.modules.addDoc(this.modules.collection(this.sessionRef(), "voiceSignals"), { ...signal, from: this.uid, createdAt: this.modules.serverTimestamp() });
  },
  async leaveRoom() {
    if (!this.roomId || !this.isReady()) {
      this.detachRoom(); this.roomId = ""; Floor13Storage.remove(STORAGE_KEYS.room); Floor13Voice.disconnect(); return;
    }
    const roomId = this.roomId;
    try { await this.modules.runTransaction(this.db, async transaction => { const reference = this.sessionRef(roomId); const snapshot = await transaction.get(reference); if (!snapshot.exists()) return; const session = snapshot.data(); const remaining = (session.playerIds || []).filter(id => id !== this.uid); if (!remaining.length) transaction.delete(reference); else { const players = { ...session.players }; delete players[this.uid]; players[remaining[0]] = { ...players[remaining[0]], role: "host" }; const update = { players, playerIds: remaining, updatedAt: this.modules.serverTimestamp() }; if (session.activePlayerId === this.uid) Object.assign(update, { activePlayerId: remaining[0], activePlayerIndex: 0 }); transaction.update(reference, update); } }); void this.modules.deleteDoc(this.modules.doc(this.db, "sessions", roomId, "presence", this.uid)).catch(() => {}); } finally { this.detachRoom(); this.roomId = ""; Floor13Storage.remove(STORAGE_KEYS.room); Floor13Voice.disconnect(); }
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

const Floor13Voice = {
  enabled: false, talking: false, roomId: "", peerId: "", peerConnection: null, localStream: null, remoteAudio: null, processedSignals: new Set(), pendingCandidates: [], offerInFlight: false,
  updateSession(session) {
    this.roomId = session.roomId || Floor13Remote.roomId;
    const peerId = (session.playerIds || []).find(id => id !== Floor13Remote.uid) || "";
    if (this.peerId && peerId && this.peerId !== peerId) this.disconnect();
    this.peerId = peerId;
    if (this.enabled && this.peerId && !this.peerConnection) void this.connect();
    Floor13UI.updateVoice?.();
  },
  async enable() {
    if (this.enabled) return;
    if (!Floor13Remote.isReady() || !Floor13Remote.roomId) return Floor13UI.setRoomStatus("Voice is available after joining an online room.", true);
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return Floor13UI.setRoomStatus("This browser does not support voice chat.", true);
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.enabled = true; this.talking = false; this.updateTracks(); await this.connect(); Floor13UI.updateVoice();
    } catch (error) { this.enabled = false; this.localStream?.getTracks().forEach(track => track.stop()); this.localStream = null; Floor13UI.setRoomStatus(error.name === "NotAllowedError" ? "Microphone access was declined. Text chat remains available." : "Microphone could not be enabled.", true); }
  },
  async connect() {
    if (!this.enabled || !this.peerId || this.peerConnection) return;
    this.peerConnection = new RTCPeerConnection({ iceServers: window.FLOOR13_FIREBASE_CONFIG?.iceServers || [{ urls: "stun:stun.l.google.com:19302" }] });
    this.localStream?.getTracks().forEach(track => this.peerConnection.addTrack(track, this.localStream));
    this.peerConnection.onicecandidate = event => { if (event.candidate) void Floor13Remote.sendVoiceSignal({ to: this.peerId, type: "candidate", candidate: event.candidate.toJSON() }); };
    this.peerConnection.ontrack = event => { if (!this.remoteAudio) { this.remoteAudio = document.getElementById("voice-audio"); } if (this.remoteAudio) { this.remoteAudio.srcObject = event.streams[0]; void this.remoteAudio.play().catch(() => {}); } };
    this.peerConnection.onconnectionstatechange = () => { const state = this.peerConnection?.connectionState; if (state === "failed" || state === "disconnected") Floor13UI.setRoomStatus("Voice link lost. Text chat remains available.", true); Floor13UI.updateVoice(); };
    Floor13Remote.listenVoiceSignals(signal => void this.handleSignal(signal));
    const session = Floor13Remote.lastSession;
    if (session?.players?.[Floor13Remote.uid]?.role === "host") await this.createOffer();
  },
  async createOffer() {
    if (!this.peerConnection || this.offerInFlight || this.peerConnection.signalingState !== "stable") return;
    this.offerInFlight = true;
    try { const offer = await this.peerConnection.createOffer(); await this.peerConnection.setLocalDescription(offer); await Floor13Remote.sendVoiceSignal({ to: this.peerId, type: "offer", sdp: { type: offer.type, sdp: offer.sdp } }); } finally { this.offerInFlight = false; }
  },
  async handleSignal(signal) {
    if (!this.peerConnection || this.processedSignals.has(signal.id) || signal.from === Floor13Remote.uid) return;
    this.processedSignals.add(signal.id);
    try {
      if (signal.type === "offer") { await this.peerConnection.setRemoteDescription(signal.sdp); for (const candidate of this.pendingCandidates.splice(0)) await this.peerConnection.addIceCandidate(candidate); const answer = await this.peerConnection.createAnswer(); await this.peerConnection.setLocalDescription(answer); await Floor13Remote.sendVoiceSignal({ to: signal.from, type: "answer", sdp: { type: answer.type, sdp: answer.sdp } }); }
      else if (signal.type === "answer") { await this.peerConnection.setRemoteDescription(signal.sdp); for (const candidate of this.pendingCandidates.splice(0)) await this.peerConnection.addIceCandidate(candidate); }
      else if (signal.type === "candidate") { const candidate = new RTCIceCandidate(signal.candidate); if (this.peerConnection.remoteDescription) await this.peerConnection.addIceCandidate(candidate); else this.pendingCandidates.push(candidate); }
    } catch (error) { Floor13UI.setRoomStatus("Voice negotiation failed. Text chat remains available.", true); }
  },
  setTalking(value) { if (!this.enabled) return; this.talking = value; this.updateTracks(); Floor13UI.updateVoice(); },
  updateTracks() { this.localStream?.getAudioTracks().forEach(track => { track.enabled = this.enabled && this.talking; }); },
  disconnect() { this.peerConnection?.close(); this.peerConnection = null; this.localStream?.getTracks().forEach(track => track.stop()); this.localStream = null; this.remoteAudio?.srcObject && (this.remoteAudio.srcObject = null); this.enabled = false; this.talking = false; this.peerId = ""; this.processedSignals.clear(); this.pendingCandidates = []; Floor13Remote.voiceUnsubscribe?.(); Floor13Remote.voiceUnsubscribe = null; Floor13UI.updateVoice?.(); }
};

const Floor13Audio = {
  enabled: Floor13Storage.read(STORAGE_KEYS.settings, { enabled: true }).enabled !== false,
  volume: 0.035,
  context: null,
  clips: {},
  clipSources: { button: "assets/audio/push-elevator-panel-button.ogg", ascent: "assets/audio/elevator-up.ogg", step: "assets/audio/step-inside.ogg", correct: "assets/audio/correct.ogg" },
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
  play(name) {
    if (!this.enabled) return;
    const source = this.clipSources[name];
    if (!source) return;
    const clip = this.clips[name] || (this.clips[name] = Object.assign(new Audio(source), { preload: "auto", volume: Math.min(1, this.volume * 8) }));
    clip.currentTime = 0;
    void clip.play().catch(() => {});
  },
  toggle() { this.enabled = !this.enabled; Floor13Storage.write(STORAGE_KEYS.settings, { enabled: this.enabled }); if (this.enabled) this.beep("tap"); Floor13UI.updateAudioButton(); }
};

const Floor13Engine = {
  mode: "DAILY", seed: 0, dictionary: {}, acceptedWords: new Set(), wordsByLength: {}, targetWordsByLength: {}, targetMetadataByWord: {}, run: null, targetWord: "", targetWordMetadata: {}, currentGuess: [], shatteredKeys: new Set(), transitionTimer: null, timerHandle: null, transitioning: false, transitionStage: "idle", transitionTargetFloor: 0, transitionFromFloor: 0, pendingTransitionRun: null,
  async boot() {
    try {
      const [dictionaryResponse, acceptedResponse] = await Promise.all([fetch("assets/data/dictionary.json"), fetch("assets/data/accepted-words.json")]);
      this.dictionary = await dictionaryResponse.json();
      this.acceptedWords = new Set((await acceptedResponse.json()).map(word => word.toUpperCase()));
      const puzzleFloors = FLOORS.slice(1);
      const targetEntries = puzzleFloors.flatMap(floor => {
        const entries = this.dictionary[`${floor}_letters`];
        if (!Array.isArray(entries)) throw new Error(`Missing curated target list for floor ${floor}.`);
        return entries.map(entry => {
          if (!entry || typeof entry.word !== "string" || entry.word.length !== floor || typeof entry.pos !== "string" || typeof entry.hint !== "string" || !entry.hint.trim()) throw new Error(`Invalid curated target metadata for floor ${floor}.`);
          return { ...entry, word: entry.word.toUpperCase() };
        });
      });
      this.targetMetadataByWord = Object.fromEntries(targetEntries.map(entry => [entry.word, entry]));
      this.targetWordsByLength = Object.fromEntries(puzzleFloors.map(floor => [floor, targetEntries.filter(entry => entry.word.length === floor).map(entry => entry.word)]));
      Object.values(this.targetMetadataByWord).forEach(entry => this.acceptedWords.add(entry.word));
      this.wordsByLength = Object.fromEntries(FLOORS.map(floor => [floor, [...this.acceptedWords].filter(word => word.length === floor)]));
      await Floor13Remote.initialize();
      Floor13UI.init(); this.showLobby();
      const savedRoom = Floor13Storage.read(STORAGE_KEYS.room, null); if (savedRoom?.roomId && Floor13Remote.isReady()) await Floor13Remote.attachRoom(savedRoom.roomId);
    } catch (error) { console.error("Failed to map building floors.", error); Floor13UI.showLobbyStatus("The elevator map could not load. Refresh to reconnect.", true); }
  },
  showLobby() { document.getElementById("lobby-screen").hidden = false; document.getElementById("game-screen").hidden = true; document.getElementById("game-container").scrollTop = 0; document.getElementById("resume-btn").hidden = !Floor13Storage.read(STORAGE_KEYS.active, null); Floor13UI.updateAudioButton(); Floor13UI.updateDailyRunCard(); Floor13UI.renderStats(); },
  startDaily() { const seed = this.dailySeed(); if (this.hasCompletedDaily(seed)) { this.startRun("FREEPLAY", this.freshSeed("daily-replay")); Floor13UI.setStatus("DAILY CLEAR // FRESH ASCENT GENERATED"); return; } this.startRun("DAILY", seed); },
  startChallenge() { const seed = this.freshSeed("challenge"); this.startRun("CHALLENGE", seed); Floor13UI.copyChallengeLink(seed); },
  startPassPlay() { this.startRun("PASS_PLAY", this.freshSeed("pass-play"), [Floor13UI.handle(), "Guest 2"]); },
  startOnlineRun(session) { this.mode = "ONLINE"; this.seed = session.seed; this.run = this.sessionToRun(session); this.showGame(); this.loadFloor(); Floor13UI.closeRoom(); },
  sessionToRun(session) { const players = (session.playerIds || []).map(id => session.players?.[id]?.name || "Operator"); const startedAt = typeof session.startedAt === "number" ? session.startedAt : session.startedAt?.toMillis?.() || Date.parse(session.startedAt) || Date.now(); return { ...session, mode: "ONLINE", players, handle: session.players?.[session.activePlayerId]?.name || players[0] || "Operator", playerId: Floor13Remote.uid, elapsedMs: session.elapsedMs || 0, startedAt }; },
  syncRemoteSession(session) {
    if (session.error) return Floor13UI.setRoomStatus(session.error, true);
    const previous = this.run; const nextRun = this.sessionToRun(session); const floorChanged = previous && previous.floor !== session.floor && session.floor > previous.floor && session.status === "IN_PROGRESS"; const shouldLoad = !previous || floorChanged || (previous.guesses || []).length !== (session.guesses || []).length || previous.status !== session.status;
    this.mode = "ONLINE"; this.seed = session.seed;
    if (session.status === "WAITING") return Floor13UI.renderRoom(session);
    if (session.status === "IN_PROGRESS") { this.showGame(); Floor13UI.closeRoom(); if (!previous) { this.run = nextRun; this.startClock(); this.loadFloor(); } else if (floorChanged) { if (!this.transitioning) this.beginFloorTransition(session.floor, nextRun); } else { this.run = nextRun; if (shouldLoad) this.loadFloor(); else { Floor13UI.updateHeader(); Floor13UI.updateOnlineState(session); } } }
    else if (previous?.result === "IN_PROGRESS") { this.showGame(); Floor13UI.updateHeader(); Floor13UI.openTerminal(session.result === "COMPLETE", { floorReached: session.floor, guessesUsed: (session.guesses || []).length, elapsedMs: session.elapsedMs || 0 }, this.targetWord); }
    Floor13UI.updateOnlineState(session);
  },
  hasCompletedDaily(seed = this.dailySeed()) { return Floor13Storage.getResults().some(result => result.mode === "DAILY" && result.seed === seed && result.outcome === "COMPLETE"); },
  freshSeed(prefix = "run") { let entropy = 0; if (window.crypto?.getRandomValues) { const values = new Uint32Array(1); window.crypto.getRandomValues(values); entropy = values[0]; } return this.hashSeed(`${prefix}-${Date.now()}-${entropy || Math.random()}`); },
  resumeRun() {
    const saved = Floor13Storage.read(STORAGE_KEYS.active, null);
    if (!saved) return this.showLobby();
    if (saved.mode === "ONLINE") {
      if (saved.roomId && Floor13Remote.isReady()) return void Floor13Remote.attachRoom(saved.roomId);
      Floor13UI.showLobbyStatus("That online room is unavailable. Start a local ascent instead.", true);
      return this.showLobby();
    }
    this.run = saved; this.mode = saved.mode; this.seed = saved.seed; this.run.startedAt = Date.now() - this.run.elapsedMs; this.startClock(); this.showGame(); this.loadFloor(); Floor13UI.announce(`Resumed on floor ${this.run.floor}.`);
  },
  startRun(mode, seed, players = [Floor13UI.handle()]) {
    Floor13Audio.unlock(); this.mode = mode; this.seed = seed;
    this.run = { version: 2, seed, mode, players, activePlayerIndex: 0, handle: players[0], floor: 1, attempts: 0, guesses: [], solvedFloors: [], lifelines: { reveal: true, clue: true, fifty: true }, elapsedMs: 0, startedAt: Date.now(), result: "IN_PROGRESS" };
    Floor13Storage.write(STORAGE_KEYS.active, this.run); this.startClock(); this.showGame(); this.loadFloor();
  },
  showGame() { document.getElementById("lobby-screen").hidden = true; document.getElementById("game-screen").hidden = false; document.getElementById("game-screen").classList.toggle("online-mode", this.mode === "ONLINE"); document.getElementById("game-container").scrollTop = 0; Floor13UI.closeAllOverlays(); },
  enterElevator() {
    if (!this.run || this.run.floor !== 1) return;
    if (this.transitioning) return;
    if (this.mode === "ONLINE") { if (this.run.activePlayerId !== Floor13Remote.uid) return Floor13UI.setStatus("WAIT FOR THE ACTIVE OPERATOR"); Floor13UI.setStatus("CALLING THE ELEVATOR // SYNCING"); Floor13Audio.play("button"); void Floor13Remote.advanceBoarding(this.run.version).catch(error => Floor13UI.setStatus(error.message)); return; }
    Floor13Audio.play("button"); this.beginFloorTransition(2);
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
    const floorList = this.targetWordsByLength[this.run.floor] || [];
    if (!floorList.length) {
      console.error(`No curated target is available for floor ${this.run.floor}.`);
      Floor13UI.showLobbyStatus("This floor's answer file could not load. Refresh to reconnect.", true);
      this.showLobby();
      return;
    }
    const index = Math.floor(Math.abs(Math.sin(this.seed + this.run.floor)) * floorList.length);
    this.targetWord = floorList[index];
    this.targetWordMetadata = this.targetMetadataByWord[this.targetWord];
    this.currentGuess = Array(this.run.floor).fill(""); this.shatteredKeys = new Set();
    document.documentElement.style.setProperty("--grid-columns", this.run.floor); Floor13UI.renderBoard(); Floor13UI.renderKeyboard(); Floor13UI.updateHeader(); this.replayFloorGuesses(); Floor13UI.updateKeyboardStates(); Floor13Storage.write(STORAGE_KEYS.active, this.run);
  },
  replayFloorGuesses() { this.run.guesses.filter(guess => guess.floor === this.run.floor).forEach(guess => Floor13UI.paintGuess(guess.row, guess.word, guess.evaluation)); },
  startClock() { clearInterval(this.timerHandle); this.timerHandle = setInterval(() => { if (!this.run || this.run.result !== "IN_PROGRESS") return; this.run.elapsedMs = Date.now() - this.run.startedAt; Floor13UI.updateHeader(); }, 1000); },
  addLetter(letter) { if (this.transitioning || !this.run || this.run.result !== "IN_PROGRESS" || this.run.attempts >= MAX_ATTEMPTS || this.shatteredKeys.has(letter)) return; const slot = this.currentGuess.indexOf(""); if (slot === -1) return; this.currentGuess[slot] = letter; Floor13UI.clearInvalidEntry(); Floor13Audio.beep("tap"); Floor13UI.updateCurrentGuess(); },
  removeLetter() { if (this.transitioning) return; const slot = this.currentGuess.map((letter, index) => letter ? index : -1).filter(index => index >= 0).pop(); if (slot === undefined) return; this.currentGuess[slot] = ""; Floor13UI.clearInvalidEntry(); Floor13UI.updateCurrentGuess(); },
  isValidGuess(guess) { return guess.length === this.run.floor && /^[A-Z]+$/.test(guess) && this.acceptedWords.has(guess); },
  submitCurrentRow() {
    if (this.transitioning || !this.run || this.run.result !== "IN_PROGRESS") return;
    if (this.mode === "ONLINE" && this.run.activePlayerId !== Floor13Remote.uid) return Floor13UI.setStatus("WAIT FOR THE ACTIVE OPERATOR");
    const guess = this.currentGuess.join("");
    if (guess.length !== this.run.floor) { Floor13UI.clearInvalidEntry(); Floor13UI.shakeActiveRow(); Floor13UI.announce(`Enter ${this.run.floor} letters before submitting.`); return; }
    if (!this.isValidGuess(guess)) { Floor13UI.showInvalidEntry(guess); Floor13Audio.beep("alarm"); return; }
    if (this.mode === "ONLINE") return this.submitOnlineGuess(guess);
    Floor13UI.clearInvalidEntry();
    const evaluation = this.evaluateGuess(guess, this.targetWord); const row = this.run.attempts;
    this.run.guesses.push({ floor: this.run.floor, row, word: guess, evaluation }); this.run.attempts += 1; Floor13UI.paintGuess(row, guess, evaluation); Floor13UI.updateKeyboardStates(); this.currentGuess = Array(this.run.floor).fill(""); Floor13Storage.write(STORAGE_KEYS.active, this.run);
    if (guess === this.targetWord) { Floor13Audio.play("correct"); Floor13Audio.beep("correct"); this.run.solvedFloors.push(this.run.floor); Floor13UI.announce(`Floor ${this.run.floor} solved. Elevator ascending.`); if (this.run.floor === 13) return this.finishRun(true); this.beginFloorTransition(this.run.floor + 1); }
    else if (this.run.attempts >= MAX_ATTEMPTS) { Floor13Audio.beep("fail"); this.finishRun(false); }
    else { Floor13UI.setStatus(`${MAX_ATTEMPTS - this.run.attempts} ATTEMPTS REMAIN`); Floor13UI.updateHeader(); }
  },
  async submitOnlineGuess(guess) {
    if (this.run.activePlayerId !== Floor13Remote.uid) return Floor13UI.setStatus("WAIT FOR THE ACTIVE OPERATOR");
    const evaluation = this.evaluateGuess(guess, this.targetWord); const guessRecord = { floor: this.run.floor, row: this.run.attempts, word: guess, evaluation };
    Floor13UI.clearInvalidEntry(); Floor13UI.setStatus("TRANSMITTING GUESS // WAITING FOR ROOM ACK");
    try { await Floor13Remote.submitGuess({ expectedVersion: this.run.version, floor: this.run.floor, attempts: this.run.attempts, guessRecord, correct: guess === this.targetWord }); } catch (error) { Floor13UI.setStatus(error.message); }
  },
  beginFloorTransition(targetFloor = this.run?.floor + 1, pendingRun = null) {
    if (!this.run || this.transitioning || targetFloor <= this.run.floor || targetFloor > 13) return;
    clearTimeout(this.transitionTimer);
    this.transitioning = true; this.transitionStage = "closing"; this.transitionFromFloor = this.run.floor; this.transitionTargetFloor = targetFloor; this.pendingTransitionRun = pendingRun;
    const screen = document.getElementById("game-screen"); screen.classList.add("transitioning"); screen.setAttribute("aria-busy", "true");
    Floor13UI.startFloorTransition(this.transitionFromFloor, targetFloor, "closing");
    Floor13UI.setStatus(`DOORS CLOSING // FLOOR ${String(targetFloor).padStart(2, "0")}`, "DOORS CLOSING");
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const durations = reducedMotion ? { ...FLOOR_TRANSITION_DURATIONS, closing: 0, traveling: 0, arrival: 0, opening: 0 } : FLOOR_TRANSITION_DURATIONS;
    const advance = (stage, delay, callback) => { this.transitionStage = stage; Floor13UI.updateFloorTransition(stage); this.transitionTimer = setTimeout(callback, delay); };
    this.transitionTimer = setTimeout(() => {
      Floor13Audio.play("step"); Floor13Audio.play("ascent");
      advance("traveling", durations.traveling, () => {
        const nextRun = this.pendingTransitionRun;
        if (nextRun) this.run = nextRun;
        else {
          this.run.floor = this.transitionTargetFloor; this.run.attempts = 0;
          if (this.run.mode === "PASS_PLAY") { this.run.activePlayerIndex = (this.run.activePlayerIndex + 1) % this.run.players.length; this.run.handle = this.run.players[this.run.activePlayerIndex]; }
        }
        this.loadFloor();
        Floor13Audio.beep("ascent");
        advance("arrival", durations.arrival, () => advance("opening", durations.opening, () => this.finishFloorTransition()));
      });
    }, durations.closing);
  },
  finishFloorTransition() {
    clearTimeout(this.transitionTimer); this.transitionTimer = null;
    const arrivedFloor = this.transitionTargetFloor; const passPlayPlayer = this.run?.mode === "PASS_PLAY" ? this.run.handle : "";
    this.transitioning = false; this.transitionStage = "idle"; this.transitionTargetFloor = 0; this.transitionFromFloor = 0; this.pendingTransitionRun = null;
    const screen = document.getElementById("game-screen"); screen.classList.remove("transitioning"); screen.setAttribute("aria-busy", "false");
    Floor13UI.finishFloorTransition(arrivedFloor);
    if (passPlayPlayer) Floor13UI.showHandoff(passPlayPlayer, () => { Floor13UI.setStatus(`FLOOR ${String(arrivedFloor).padStart(2, "0")} // YOUR TURN`); });
    else Floor13UI.setStatus(`FLOOR ${String(arrivedFloor).padStart(2, "0")} // PUZZLE READY`);
  },
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
  useReveal() { if (this.transitioning || !this.run?.lifelines.reveal || (this.mode === "ONLINE" && this.run.activePlayerId !== Floor13Remote.uid)) return; const apply = () => { this.run.lifelines.reveal = false; const position = this.currentGuess.findIndex((letter, index) => letter !== this.targetWord[index]); if (position > -1) this.currentGuess[position] = this.targetWord[position]; Floor13Audio.beep("correct"); Floor13UI.setStatus(`LETTER ${position + 1} REVEALED`); Floor13UI.updateCurrentGuess(); Floor13UI.updateHeader(); }; if (this.mode === "ONLINE") return void Floor13Remote.useLifeline("reveal", this.run.version).then(apply).catch(error => Floor13UI.setStatus(error.message)); apply(); },
  useClue() { if (this.transitioning || !this.run?.lifelines.clue || (this.mode === "ONLINE" && this.run.activePlayerId !== Floor13Remote.uid)) return; const apply = () => { this.run.lifelines.clue = false; Floor13Audio.beep("tap"); Floor13UI.openFeedback(this.targetWordMetadata); Floor13UI.updateHeader(); }; if (this.mode === "ONLINE") return void Floor13Remote.useLifeline("clue", this.run.version).then(apply).catch(error => Floor13UI.setStatus(error.message)); apply(); },
  useFifty() { if (this.transitioning || !this.run?.lifelines.fifty || (this.mode === "ONLINE" && this.run.activePlayerId !== Floor13Remote.uid)) return; const apply = () => { this.run.lifelines.fifty = false; const candidates = "QWERTYUIOPASDFGHJKLZXCVBNM".split("").filter(letter => !this.targetWord.includes(letter)); const count = Math.floor(candidates.length / 2); this.shatteredKeys = new Set(candidates.slice(0, count)); this.shatteredKeys.forEach(letter => document.querySelector(`[data-key="${letter}"]`)?.classList.add("shattered")); Floor13Audio.beep("alarm"); Floor13UI.setStatus(`${count} WRONG LETTERS DISABLED`); Floor13UI.updateHeader(); }; if (this.mode === "ONLINE") return void Floor13Remote.useLifeline("fifty", this.run.version).then(apply).catch(error => Floor13UI.setStatus(error.message)); apply(); },
  dailySeed() { return this.hashSeed(new Date().toISOString().slice(0, 10)); },
  hashSeed(value) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); return Math.abs(hash >>> 0); }
};

const Floor13InputController = { init() { window.addEventListener("keydown", event => { if (document.querySelector(".overlay-visible")) { if (event.key === "Escape") Floor13UI.closeTopOverlay(); return; } if (event.key === "Backspace") Floor13Engine.removeLetter(); else if (event.key === "Enter") Floor13Engine.submitCurrentRow(); else if (/^[a-zA-Z]$/.test(event.key)) Floor13Engine.addLetter(event.key.toUpperCase()); }); } };

const Floor13UI = {
  chatMessageCount: null, chatUnread: 0,
  init() {
    Floor13Remote.configure({ onSession: session => this.handleRemoteSession(session), onChat: messages => this.renderChat(messages), onPresence: presence => this.renderPresence(presence) });
    document.addEventListener("click", event => {
      const action = event.target.closest("[data-action]")?.dataset.action; if (!action) return; Floor13Audio.unlock();
      const actions = {
        daily: () => Floor13Engine.startDaily(), challenge: () => Floor13Engine.startChallenge(), "pass-play": () => Floor13Engine.startPassPlay(), "online-room": () => this.openRoom(), "create-room": () => this.createRoom(), "join-room": () => this.joinRoom(), "start-room": () => this.startRoom(), "copy-room": () => this.copyRoom(), "leave-room": () => this.leaveRoom(), "close-room": () => this.closeRoom(), resume: () => Floor13Engine.resumeRun(), "board-elevator": () => Floor13Engine.enterElevator(), stats: () => this.openStats(), "game-stats": () => this.openStats(), audio: () => Floor13Audio.toggle(),
        reveal: () => Floor13Engine.useReveal(), clue: () => Floor13Engine.useClue(), fifty: () => Floor13Engine.useFifty(), "close-feedback": () => this.closeFeedback(),
        "voice-enable": () => Floor13Voice.enable(),
        retry: () => { const mode = Floor13Engine.run?.mode || Floor13Engine.mode; const fresh = mode === "FREEPLAY" || (mode === "DAILY" && Floor13Engine.run?.result === "COMPLETE"); this.closeTerminal(); Floor13Engine.startRun(fresh ? "FREEPLAY" : mode, fresh ? Floor13Engine.freshSeed("replay") : Floor13Engine.seed, Floor13Engine.run?.players || [this.handle()]); if (fresh) this.setStatus("FRESH ASCENT GENERATED"); }, share: () => this.shareResult(), lobby: () => { this.closeAllOverlays(); Floor13Engine.showLobby(); },
        quit: () => { if (confirm("Leave this run? Your progress will be saved.")) Floor13Engine.showLobby(); }, "handoff-ready": () => this.closeHandoff(), "close-stats": () => this.closeStats()
      }; actions[action]?.();
    });
    ["online-chat-form", "room-chat-form"].forEach(id => document.getElementById(id)?.addEventListener("submit", event => { event.preventDefault(); const input = event.currentTarget.querySelector("input"); const body = input.value.trim(); if (!body) return; void Floor13Remote.sendChat(body).then(() => { input.value = ""; }).catch(error => this.setRoomStatus(error.message, true)); }));
    ["chat-input", "room-chat-input"].forEach(id => document.getElementById(id)?.addEventListener("focus", () => this.clearChatUnread()));
    ["voice-toggle", "room-voice-toggle"].forEach(id => { const button = document.getElementById(id); button?.addEventListener("pointerdown", event => { if (Floor13Voice.enabled) { event.preventDefault(); Floor13Voice.setTalking(true); } }); button?.addEventListener("pointerup", () => Floor13Voice.setTalking(false)); button?.addEventListener("pointerleave", () => Floor13Voice.setTalking(false)); button?.addEventListener("pointercancel", () => Floor13Voice.setTalking(false)); });
    Floor13InputController.init();
  },
  handle() { const input = document.getElementById("player-handle"); const handle = (input.value || "Operator").trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 16) || "Operator"; input.value = handle; Floor13Storage.write(STORAGE_KEYS.handle, handle); return handle; },
  updateAudioButton() { document.querySelectorAll("[data-action=audio]").forEach(button => { button.textContent = Floor13Audio.enabled ? "SOUND ON" : "SOUND OFF"; button.setAttribute("aria-pressed", String(Floor13Audio.enabled)); }); },
  updateDailyRunCard() { const cleared = Floor13Engine.hasCompletedDaily(); document.getElementById("daily-run-kicker").textContent = cleared ? "KEEP CLIMBING" : "TODAY'S RUN"; document.getElementById("daily-run-title").textContent = cleared ? "FRESH ASCENT" : "DAILY ASCENT"; document.getElementById("daily-run-description").textContent = cleared ? "New words, new seed, every time." : "Same seed for everyone."; },
  openRoom() { this.lastFocusedElement = document.activeElement; this.clearChatUnread(); this.showOverlay("room-overlay"); document.getElementById("room-entry-view").hidden = Boolean(Floor13Remote.roomId); document.getElementById("room-waiting-view").hidden = !Floor13Remote.roomId; document.getElementById("room-chat").hidden = !Floor13Remote.roomId; this.setRoomStatus(Floor13Remote.isReady() ? "Create a private room or enter a join code." : "Online rooms are offline until Firebase is configured.", !Floor13Remote.isReady()); this.updateVoice(); },
  async createRoom() { try { const roomId = await Floor13Remote.createRoom(this.handle()); document.getElementById("room-code-display").textContent = roomId; this.renderRoom(Floor13Remote.lastSession || { roomId, status: "WAITING", playerIds: [Floor13Remote.uid], players: { [Floor13Remote.uid]: { name: this.handle(), role: "host" } } }); } catch (error) { this.setRoomStatus(error.message, true); } },
  async joinRoom() { try { const roomId = await Floor13Remote.joinRoom(document.getElementById("room-code").value, this.handle()); document.getElementById("room-code").value = roomId; this.setRoomStatus("Joined room. Waiting for the host."); } catch (error) { this.setRoomStatus(error.message, true); } },
  async startRoom() { try { await Floor13Remote.startRoom(); } catch (error) { this.setRoomStatus(error.message, true); } },
  copyRoom() { if (!Floor13Remote.roomId) return; const url = `${window.location.origin}${window.location.pathname}?room=${Floor13Remote.roomId}`; const copy = navigator.clipboard?.writeText(url); copy?.then(() => this.setRoomStatus("ROOM LINK COPIED")); if (!copy) this.setRoomStatus(`ROOM CODE: ${Floor13Remote.roomId}`); },
  async leaveRoom() { try { await Floor13Remote.leaveRoom(); Floor13Voice.disconnect(); this.closeRoom(); Floor13Engine.showLobby(); } catch (error) { this.setRoomStatus(error.message, true); } },
  closeRoom() {
    const overlay = document.getElementById("room-overlay"); const active = document.activeElement;
    if (overlay.contains(active)) {
      const remembered = this.lastFocusedElement; const fallback = remembered && remembered !== document.body && remembered.isConnected && remembered.getClientRects().length ? remembered : document.querySelector("#game-screen:not([hidden]) #board-canvas, #lobby-screen:not([hidden]) [data-action='online-room']");
      if (fallback) { if (!fallback.hasAttribute("tabindex")) fallback.setAttribute("tabindex", "-1"); fallback.focus(); }
    }
    this.hideOverlay("room-overlay");
  },
  setRoomStatus(message, error = false) { ["room-status", "room-entry-status"].forEach(id => { const element = document.getElementById(id); if (element) { element.textContent = message; element.classList.toggle("error", error); } }); },
  handleRemoteSession(session) { if (session.error) return this.setRoomStatus(session.error, true); if (!Floor13Remote.roomId) return; if (session.status === "WAITING") this.renderRoom(session); else Floor13Engine.syncRemoteSession(session); },
  renderRoom(session) { document.getElementById("room-entry-view").hidden = true; document.getElementById("room-waiting-view").hidden = false; document.getElementById("room-chat").hidden = false; document.getElementById("room-code-display").textContent = session.roomId || Floor13Remote.roomId; const players = this.roomPlayers(session); document.getElementById("room-players").replaceChildren(...players); const isHost = session.players?.[Floor13Remote.uid]?.role === "host"; const startButton = document.getElementById("start-room-btn"); startButton.disabled = !isHost || (session.playerIds || []).length < 2; this.setRoomStatus((session.playerIds || []).length < 2 ? "Waiting for a second operator…" : isHost ? "Two operators linked. Start when ready." : "The host can start the ascent."); this.updateVoice(); this.showOverlay("room-overlay"); },
  roomPlayers(session) { return (session.playerIds || []).map(id => { const player = document.createElement("div"); player.className = "room-player"; player.dataset.playerId = id; const name = document.createElement("span"); name.textContent = session.players?.[id]?.name || "Operator"; const role = document.createElement("small"); role.textContent = id === Floor13Remote.uid ? "YOU" : session.players?.[id]?.role === "host" ? "HOST" : "LINKED"; player.append(name, role); return player; }); },
  renderPresence(presence) { if (presence?.error) return this.setRoomStatus(presence.error, true); const present = new Set(presence.map(entry => entry.id)); document.querySelectorAll("#room-players .room-player").forEach(player => { const role = player.querySelector("small"); if (role && player.dataset.playerId !== Floor13Remote.uid) role.textContent = present.has(player.dataset.playerId) ? "ONLINE" : "AWAY"; }); },
  clearChatUnread() { this.chatUnread = 0; ["chat-unread", "room-chat-unread"].forEach(id => { const badge = document.getElementById(id); if (badge) { badge.hidden = true; badge.textContent = "NEW"; } }); },
  updateChatUnread() { ["chat-unread", "room-chat-unread"].forEach(id => { const badge = document.getElementById(id); if (badge) { badge.hidden = this.chatUnread === 0; badge.textContent = this.chatUnread > 1 ? `${this.chatUnread} NEW` : "NEW"; } }); },
  renderChat(messages) { if (messages?.error) return this.setRoomStatus(messages.error, true); if (this.chatMessageCount !== null && messages.length > this.chatMessageCount && !["chat-input", "room-chat-input"].includes(document.activeElement?.id)) this.chatUnread += messages.length - this.chatMessageCount; this.chatMessageCount = messages.length; this.updateChatUnread(); ["chat-connection", "room-chat-connection"].forEach(id => { const element = document.getElementById(id); if (element) element.textContent = Floor13Remote.roomId ? "LINKED" : "OFFLINE"; }); const lists = [document.getElementById("chat-messages"), document.getElementById("room-chat-messages")]; lists.forEach(list => { if (!list) return; list.replaceChildren(); if (!messages.length) { const empty = document.createElement("span"); empty.className = "chat-empty"; empty.textContent = "No transmissions yet."; list.append(empty); return; } messages.forEach(message => { const row = document.createElement("div"); row.className = "chat-message"; const sender = document.createElement("strong"); sender.textContent = `${message.senderName || "Operator"}:`; const body = document.createElement("span"); body.textContent = message.body; row.append(sender, body); list.append(row); }); list.scrollTop = list.scrollHeight; }); },
  updateOnlineState(session = Floor13Remote.lastSession) { const online = Floor13Engine.run?.mode === "ONLINE"; document.getElementById("game-screen").classList.toggle("online-mode", online); document.getElementById("online-chat").hidden = !online; const connection = online && Floor13Remote.isReady() ? "LINKED" : "OFFLINE"; document.getElementById("chat-connection").textContent = connection; const active = online && session?.activePlayerId === Floor13Remote.uid; if (online && session?.status === "IN_PROGRESS") this.setStatus(active ? "YOUR TURN // TRANSMIT A GUESS" : `WAITING FOR ${session.players?.[session.activePlayerId]?.name?.toUpperCase() || "OTHER OPERATOR"}`); this.updateVoice(); },
  updateVoice() { ["voice-toggle", "room-voice-toggle"].forEach(id => { const button = document.getElementById(id); if (!button) return; button.hidden = !Floor13Remote.roomId; button.textContent = Floor13Voice.enabled ? (Floor13Voice.talking ? "TRANSMITTING" : "HOLD TO TALK") : "ENABLE VOICE"; button.dataset.voiceState = Floor13Voice.talking ? "talking" : Floor13Voice.enabled ? "ready" : "off"; }); },
  renderBoard() { const board = document.getElementById("board-canvas"); board.innerHTML = ""; board.setAttribute("tabindex", "-1"); const floor = Math.max(2, Floor13Engine.run.floor); for (let row = 0; row < MAX_ATTEMPTS; row += 1) { const rowElement = document.createElement("div"); rowElement.className = "board-row"; rowElement.dataset.row = row; for (let index = 0; index < floor; index += 1) { const cell = document.createElement("div"); cell.className = "letter-box"; cell.id = `cell-${row}-${index}`; cell.setAttribute("aria-label", `Floor ${Floor13Engine.run.floor}, row ${row + 1}, position ${index + 1}, empty`); rowElement.appendChild(cell); } board.appendChild(rowElement); } },
  updateCurrentGuess() { Floor13Engine.currentGuess.forEach((letter, index) => { const cell = document.getElementById(`cell-${Floor13Engine.run.attempts}-${index}`); if (cell) { cell.textContent = letter; cell.classList.toggle("filled", Boolean(letter)); } }); },
  paintGuess(row, word, evaluation) { word.split("").forEach((letter, index) => { const cell = document.getElementById(`cell-${row}-${index}`); if (!cell) return; cell.textContent = letter; cell.classList.add("filled", evaluation[index]); cell.setAttribute("aria-label", `${letter}, ${evaluation[index]}`); }); },
  renderKeyboard() { const wrapper = document.getElementById("keyboard-wrapper"); wrapper.innerHTML = ""; [["Q","W","E","R","T","Y","U","I","O","P"],["A","S","D","F","G","H","J","K","L"],["ENTER","Z","X","C","V","B","N","M","BACKSPACE"]].forEach(row => { const rowElement = document.createElement("div"); rowElement.className = "keyboard-row"; row.forEach(key => { const button = document.createElement("button"); button.type = "button"; button.className = "keyboard-key"; button.dataset.key = key; button.textContent = key === "BACKSPACE" ? "⌫" : key === "ENTER" ? "↵" : key; button.setAttribute("aria-label", key === "BACKSPACE" ? "Backspace" : key === "ENTER" ? "Submit guess" : `Letter ${key}`); button.addEventListener("click", () => key === "ENTER" ? Floor13Engine.submitCurrentRow() : key === "BACKSPACE" ? Floor13Engine.removeLetter() : Floor13Engine.addLetter(key)); rowElement.appendChild(button); }); wrapper.appendChild(rowElement); }); },
  updateKeyboardStates() { const states = {}; Floor13Engine.run?.guesses.filter(guess => guess.floor === Floor13Engine.run.floor).forEach(guess => guess.word.split("").forEach((letter, index) => { const next = guess.evaluation[index]; if (next === "correct" || (next === "present" && states[letter] !== "correct")) states[letter] = next; else if (!states[letter]) states[letter] = "absent"; })); document.querySelectorAll(".keyboard-key[data-key]").forEach(button => { const state = states[button.dataset.key]; if (state) button.classList.add(state); }); },
  updateHeader() { if (!Floor13Engine.run) return; const floor = Floor13Engine.run.floor; document.getElementById("stat-level").textContent = `FLOOR ${String(floor).padStart(2, "0")} / 13`; document.getElementById("stat-player").textContent = Floor13Engine.run.handle.toUpperCase(); document.getElementById("stat-timer").textContent = this.formatTime(Floor13Engine.run.elapsedMs); document.getElementById("mode-label").textContent = Floor13Engine.run.mode.replace("_", " "); document.getElementById("floor-progress").style.width = `${((floor - 1) / 12) * 100}%`; const remaining = Object.values(Floor13Engine.run.lifelines).filter(Boolean).length; document.getElementById("lifeline-status").textContent = `${remaining} AVAILABLE`; ["reveal", "clue", "fifty"].forEach(name => { const button = document.getElementById(`btn-${name}`); button.disabled = floor === 1 || !Floor13Engine.run.lifelines[name]; button.classList.toggle("spent", button.disabled); }); this.updateBoardingState(); this.updateParallax(); },
  updateBoardingState() { const floor = Floor13Engine.run?.floor || 1; document.getElementById("boarding-copy").textContent = floor === 1 ? "Step into the car. Floor 02 is waiting with a two-letter code." : `The car is moving through the building. Next stop: floor ${String(Math.min(13, floor + 1)).padStart(2, "0")}.`; },
  startFloorTransition(fromFloor, toFloor, stage) { const overlay = document.getElementById("elevator-transition"); overlay.hidden = false; overlay.setAttribute("aria-hidden", "false"); overlay.className = "transition-active"; document.getElementById("transition-from-floor").textContent = String(fromFloor).padStart(2, "0"); document.getElementById("transition-to-floor").textContent = String(toFloor).padStart(2, "0"); this.updateFloorTransition(stage); },
  updateFloorTransition(stage) { const labels = { closing: ["DOORS CLOSING", "Securing the car before ascent."], traveling: ["ASCENDING", "The shaft is clear. Hold steady."], arrival: ["ARRIVAL CONFIRMED", `Floor ${String(Floor13Engine.transitionTargetFloor).padStart(2, "0")} is standing by.`], opening: ["DOORS OPENING", "New floor, new code. The board is ready."] }; const [label, copy] = labels[stage] || labels.closing; const overlay = document.getElementById("elevator-transition"); overlay.classList.remove("transition-closing", "transition-traveling", "transition-arrival", "transition-opening"); overlay.classList.add(`transition-${stage}`); document.getElementById("transition-stage").textContent = label; document.getElementById("transition-copy").textContent = copy; if (Floor13Engine.transitioning) this.setStatus(`${label} // FLOOR ${String(Floor13Engine.transitionTargetFloor).padStart(2, "0")}`, label); },
  finishFloorTransition() { const overlay = document.getElementById("elevator-transition"); overlay.hidden = true; overlay.setAttribute("aria-hidden", "true"); overlay.className = ""; const board = document.getElementById("board-canvas"); if (board) board.focus(); },
  updateParallax() { const floor = Floor13Engine.run?.floor || 1; document.getElementById("game-screen")?.style.setProperty("--floor-shift", `${(floor - 1) * -3}px`); },
  formatTime(ms) { const totalSeconds = Math.floor(ms / 1000); return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`; },
  setStatus(message, visibleMessage = message) { document.getElementById("status-live").textContent = message; document.getElementById("visible-status").textContent = visibleMessage; }, announce(message) { this.setStatus(message); },
  shakeActiveRow(invalid = false) { const row = document.querySelector(`.board-row[data-row="${Floor13Engine.run.attempts}"]`); if (row) { row.classList.remove("shake-error"); row.classList.toggle("invalid-row", invalid); void row.offsetWidth; row.classList.add("shake-error"); } },
  showInvalidEntry(guess) { const panel = document.getElementById("invalid-entry"); document.getElementById("invalid-entry-message").textContent = `${guess} is not cleared for this floor.`; panel.hidden = false; panel.classList.remove("invalid-entry-flash"); void panel.offsetWidth; panel.classList.add("invalid-entry-flash"); this.shakeActiveRow(true); this.setStatus(`${guess} // UNKNOWN WORD // ATTEMPT RETAINED`, "EDIT ROW // TRY AGAIN"); },
  clearInvalidEntry() { const panel = document.getElementById("invalid-entry"); if (!panel.hidden) { panel.hidden = true; panel.classList.remove("invalid-entry-flash"); this.setStatus(""); } document.querySelector(`.board-row[data-row="${Floor13Engine.run?.attempts}"]`)?.classList.remove("invalid-row"); },
  openFeedback(metadata) { this.lastFocusedElement = document.activeElement; document.getElementById("feedback-pos").textContent = metadata.pos || "FIELD NOTE"; document.getElementById("feedback-copy").textContent = metadata.hint; this.showOverlay("feedback-overlay"); document.querySelector("#feedback-panel .panel-close").focus(); },
  closeFeedback() { const returnTarget = this.lastFocusedElement?.disabled ? document.getElementById("board-canvas") : this.lastFocusedElement; if (returnTarget && !returnTarget.hasAttribute("tabindex")) returnTarget.setAttribute("tabindex", "-1"); returnTarget?.focus?.(); this.hideOverlay("feedback-overlay"); },
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
  closeTopOverlay() { ["feedback-overlay", "terminal-overlay", "handoff-overlay", "stats-overlay", "room-overlay"].some(id => { if (document.getElementById(id).classList.contains("overlay-visible")) { if (id === "feedback-overlay") this.closeFeedback(); else if (id === "room-overlay") this.closeRoom(); else this.hideOverlay(id); return true; } return false; }); },
  closeAllOverlays() { if (document.getElementById("room-overlay").classList.contains("overlay-visible")) this.closeRoom(); ["feedback-overlay", "terminal-overlay", "handoff-overlay", "stats-overlay"].forEach(id => this.hideOverlay(id)); }
};

window.render_game_to_text = () => { const floorLogVisible = document.getElementById("feedback-overlay")?.classList.contains("overlay-visible"); return JSON.stringify({ screen: document.getElementById("game-screen").hidden ? "lobby" : "game", mode: Floor13Engine.run?.mode || "LOBBY", seed: Floor13Engine.run?.seed || null, player: Floor13Engine.run?.handle || null, floor: Floor13Engine.run?.floor || 0, attempt: Floor13Engine.run?.attempts || 0, currentGuess: Floor13Engine.currentGuess.join(""), lifelines: Floor13Engine.run?.lifelines || {}, transitioning: Floor13Engine.transitioning, transitionStage: Floor13Engine.transitionStage, transitionFromFloor: Floor13Engine.transitionFromFloor, transitionTargetFloor: Floor13Engine.transitionTargetFloor, timer: Floor13Engine.run?.elapsedMs || 0, onlineRoom: Floor13Remote.roomId || null, activePlayerId: Floor13Engine.run?.activePlayerId || null, chatMessageCount: document.querySelectorAll("#chat-messages .chat-message").length, invalidEntry: !document.getElementById("invalid-entry")?.hidden, floorLogVisible, floorLog: floorLogVisible ? { pos: Floor13Engine.targetWordMetadata.pos, hint: Floor13Engine.targetWordMetadata.hint } : null, status: document.getElementById("status-live")?.textContent || "" }); };
window.advanceTime = ms => { if (Floor13Engine.run?.result === "IN_PROGRESS") { Floor13Engine.run.elapsedMs += ms; Floor13Engine.run.startedAt -= ms; Floor13UI.updateHeader(); } };
window.onload = () => { document.getElementById("player-handle").value = Floor13Storage.read(STORAGE_KEYS.handle, "Operator"); Floor13Engine.boot().then(() => { const params = new URLSearchParams(window.location.search); if (params.get("seed")) Floor13Engine.startRun(params.get("mode") === "challenge" ? "CHALLENGE" : "DAILY", Number(params.get("seed")) || Floor13Engine.dailySeed()); if (params.get("room")) { document.getElementById("room-code").value = params.get("room").toUpperCase(); Floor13UI.openRoom(); } }); };
