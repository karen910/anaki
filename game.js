(() => {
  // ===== Utilities =====
  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();
  const todayKey = () => {
    // Local date key (YYYY-MM-DD). Using local time avoids UTC date shift issues.
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  // ===== Elements =====
  const startBtn = $("#startBtn");
  const overlay = $("#overlay");
  const countdownEl = $("#countdown");
  const appleWrap = $("#appleWrap");
  const appleImg = $("#appleImg");
  const bitesLayer = $("#bites");
  const feverEl = $("#fever");

  const timebarFill = $("#timebarFill");
  const timeLeftEl = $("#timeLeft");
  const timerText = document.getElementById("timerText");

  const bestScoreEl = $("#bestScore");

  const result = $("#result");
  const resultCountEl = $("#resultCount");
  const resultRankEl = $("#resultRank");
  const homeBtn = $("#homeBtn");

  if (!startBtn || !overlay || !countdownEl || !appleWrap || !appleImg || !timebarFill || !timeLeftEl || !bestScoreEl || !result || !resultCountEl || !resultRankEl || !homeBtn || !feverEl) {
    console.error("Required DOM elements not found.");
    return;
  }

  // ===== Assets =====
  const normalStates = [
    "./assets/apple-01.png",
    "./assets/apple-02.png",
    "./assets/apple-03.png",
    "./assets/apple-04.png",
  ];

  // Golden: 1st(normal) -> 2nd -> 3rd -> 4th (plate)
  const goldenStates = [
    "./assets/golden-07.png",
    "./assets/golden-08.png",
    "./assets/golden-09.png",
    "./assets/golden-10.png",
  ];

  const bubbleImgSrc = "./assets/bubble.png";

  // ===== Audio (WebAudio) =====
  let audioCtx = null;
  function ensureAudio(){
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(()=>{});
  }

  // click = bite (crunch)
  
function biteSound(){
  if (!audioCtx) return;
  const t = audioCtx.currentTime;

  // Cute "paku" bite sound
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc1.type = "triangle";
  osc2.type = "sine";

  // quick downward pitch = mouth closing feeling
  osc1.frequency.setValueAtTime(700, t);
  osc1.frequency.exponentialRampToValueAtTime(280, t + 0.12);

  osc2.frequency.setValueAtTime(400, t);
  osc2.frequency.exponentialRampToValueAtTime(180, t + 0.12);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.45, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(audioCtx.destination);

  osc1.start(t);
  osc2.start(t);
  osc1.stop(t + 0.16);
  osc2.stop(t + 0.16);
}


  // shape change = cute boing
  function boingSound(){
    if (!audioCtx) return;
    const t = audioCtx.currentTime;

    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    const f = audioCtx.createBiquadFilter();

    o.type = "sine";
    f.type = "lowpass";
    f.frequency.setValueAtTime(1800, t);

    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(760, t + 0.03);
    o.frequency.exponentialRampToValueAtTime(240, t + 0.18);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

    o.connect(f);
    f.connect(g);
    g.connect(audioCtx.destination);

    o.start(t);
    o.stop(t + 0.24);
  }

  // ===== Leaderboard (localStorage per-day) =====
  const LS_KEY = "anaki_bite_scores_v1";
  function loadScores(){
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return {};
      return data;
    } catch {
      return {};
    }
  }
  function saveScores(obj){
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch {}
  }
  function cleanupOldDays(all, keepDays = 3){
    try{
      const keys = Object.keys(all).filter(k => Array.isArray(all[k]));
      // Keep newest N day-keys (YYYY-MM-DD) lexicographically sorts by date.
      keys.sort(); // old -> new
      const remove = keys.slice(0, Math.max(0, keys.length - keepDays));
      for (const k of remove) delete all[k];
    } catch {}
    return all;
  }

  function getTodayScores(){
    const all = cleanupOldDays(loadScores());
    const k = todayKey();
    const arr = Array.isArray(all[k]) ? all[k] : [];
    return { all, k, arr };
  }

  function rankFromArray(arr, score){
    const scores = arr.map(x => x.score).slice().sort((a,b) => b-a);
    return scores.indexOf(score) + 1;
  }

  function pushTodayScore(score){
    const { all, k, arr } = getTodayScores();
    arr.push({ t: Date.now(), score });
    all[k] = arr;
    saveScores(all);
    return { all, k, arr };
  }

  function bestToday(){
    const { arr } = getTodayScores();
    if (!arr.length) return 0;
    return Math.max(...arr.map(x => x.score));
  }

  function refreshBest(){
    bestScoreEl.textContent = String(bestToday());
  }
  // ===== Game State =====
  const GAME_TIME_MS = 25_000;
  const FEVER_MS = 5_000;

  let running = false;
    document.body.classList.remove("running");
  let startTime = 0;
  let rafId = 0;

  let appleClicks = 0;   // clicks on current apple
  let applesEaten = 0;   // eaten count
  let bitesTotal = 0;    // total clicks
  let inFever = false;

  let nextGoldenAt = 5;  // every 5 apples
  let appleType = "normal"; // normal | golden
  let leaving = false;

  let feverTimer = null;

  function appleThresholdsFor(type){
    if (type === "normal"){
      if (inFever) return [1, 2, 3]; // 3 clicks total
      return [5, 8, 10]; // 10 clicks total
    }
    // golden
    return [5, 8, 10];
  }

  function statesFor(type){
    return type === "golden" ? goldenStates : normalStates;
  }

  function setAppleStage(stageIdx){
    const states = statesFor(appleType);
    const src = states[clamp(stageIdx, 0, states.length - 1)];

    // shake on shape change
    appleImg.classList.remove("shake");
    void appleImg.offsetWidth;
    appleImg.classList.add("shake");

    appleImg.src = src;
  }

  function resetApple(type){
    leaving = false;
    appleType = type;
    appleClicks = 0;
    onAppleClick._lastStage = 0;

    appleWrap.style.transition = "none";
    appleWrap.style.transform = "translateX(40vw)";
    appleWrap.getBoundingClientRect();
    appleWrap.style.transition = "transform 520ms cubic-bezier(.2,.8,.2,1)";
    appleWrap.style.transform = "translateX(0)";
    setAppleStage(0);
  }

  function showCountdown(text){
    countdownEl.textContent = text;
    countdownEl.classList.add("show");
  }
  function hideCountdown(){
    countdownEl.classList.remove("show");
  }

  function showBiteBubble(text){
    const rect = appleWrap.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const angle = Math.random() * Math.PI * 2;
    const r = (Math.min(rect.width, rect.height) * 0.42) * (0.65 + Math.random() * 0.5);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;

    const el = document.createElement("div");
    el.className = "bite";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    const img = document.createElement("img");
    img.src = bubbleImgSrc;
    img.alt = "bubble";
    img.draggable = false;

    const txt = document.createElement("div");
    txt.className = "txt";
    txt.textContent = text;

    el.appendChild(img);
    el.appendChild(txt);
    bitesLayer.appendChild(el);
    setTimeout(() => el.remove(), 720);
  }

  function startFever(){
    inFever = true;
if (feverTimer) clearTimeout(feverTimer);
    feverTimer = setTimeout(() => {
      inFever = false;
feverTimer = null;
    }, FEVER_MS);
  }

  function finishApple(){
    if (leaving) return;
    leaving = true;

    appleWrap.style.transform = "translateX(-60vw)";
    applesEaten += 1;

    const goldenWas = appleType === "golden";
    if (goldenWas) startFever();

    setTimeout(() => {
      const shouldSpawnGolden = (!inFever) && (applesEaten >= nextGoldenAt);
      if (shouldSpawnGolden) nextGoldenAt += 5;
      resetApple(shouldSpawnGolden ? "golden" : "normal");
    }, 540);
  }

  function onAppleClick(){
    if (!running) return;
    if (leaving) return;

    ensureAudio();
    biteSound();

    // bite animation
    appleImg.style.setProperty("--rot", `${(-3 + Math.random()*6).toFixed(2)}deg`);
    appleImg.classList.remove("chomp");
    void appleImg.offsetWidth;
    appleImg.classList.add("chomp");

    appleClicks += 1;
    bitesTotal += 1;

    showBiteBubble(`${appleClicks} BITE!`);

    const [t1, t2, t3] = appleThresholdsFor(appleType);

    let stage = 0;
    if (appleClicks >= t1) stage = 1;
    if (appleClicks >= t2) stage = 2;
    if (appleClicks >= t3) stage = 3;

    if (stage !== onAppleClick._lastStage){
      boingSound();
      onAppleClick._lastStage = stage;
    }

    setAppleStage(stage);

    if (appleClicks >= t3){
      finishApple();
    }
  }
  onAppleClick._lastStage = 0;

  appleWrap.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    onAppleClick();
  }, { passive: false });

  // ===== Timer =====
  function tick(){
    const t = now();
    const elapsed = t - startTime;
    const remain = clamp(GAME_TIME_MS - elapsed, 0, GAME_TIME_MS);

    timebarFill.style.transform = `scaleX(${remain / GAME_TIME_MS})`;
    timeLeftEl.textContent = (remain / 1000).toFixed(1);
    if (timerText){
      const s = Math.ceil(remain/1000);
      const mm = String(Math.floor(s/60)).padStart(2,"0");
      const ss = String(s%60).padStart(2,"0");
      timerText.textContent = mm + ":" + ss;
    }

    if (remain <= 0){
      endGame();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  // ===== Start / End =====
  async function startSequence(){
    if (running) return;

    refreshBest();
    ensureAudio();

    overlay.style.display = "none";
    document.body.classList.add("running");
    hideCountdown();
// reset state
    running = false;
    inFever = false;
    applesEaten = 0;
    bitesTotal = 0;
    nextGoldenAt = 5;
    onAppleClick._lastStage = 0;

    if (feverTimer) { clearTimeout(feverTimer); feverTimer = null; }

    appleWrap.style.pointerEvents = "auto";
    resetApple("normal");

    const wait = (ms) => new Promise(res => setTimeout(res, ms));

    showCountdown("Ready...");
    await wait(700);
    showCountdown("3");
    await wait(650);
    showCountdown("2");
    await wait(650);
    showCountdown("1");
    await wait(650);
    showCountdown("Go!");
    await wait(420);
    hideCountdown();

    running = true;
    startTime = now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function endGame(){
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);

    const score = applesEaten;
    const { arr } = pushTodayScore(score);
    refreshBest();
    const rank = rankFromArray(arr, score);

    resultCountEl.textContent = String(score);
    resultRankEl.textContent = String(rank);

    result.classList.add("show");
    homeBtn.classList.remove("show");

    appleWrap.style.pointerEvents = "none";

    setTimeout(() => homeBtn.classList.add("show"), 3000);
  }

  function backHome(){
    document.body.classList.remove("running");
    result.classList.remove("show");
    overlay.style.display = "flex";

    timebarFill.style.transform = "scaleX(1)";
    timeLeftEl.textContent = "25.0";

    if (feverTimer) { clearTimeout(feverTimer); feverTimer = null; }
    inFever = false;
appleWrap.style.pointerEvents = "auto";
    resetApple("normal");
  }

  // ===== Wiring =====
  startBtn.addEventListener("click", startSequence);
  startBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); startSequence(); }, { passive: false });

  homeBtn.addEventListener("click", backHome);
  homeBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); backHome(); }, { passive: false });

  // Initial paint
  refreshBest();
  resetApple("normal");
})();
