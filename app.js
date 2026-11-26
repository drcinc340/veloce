/**
 * VELOCE — Client Application Engine
 * Powers: Daily Sprint, 80/20 Phonetics/Cognates/Lego Matrix, FSRS-5 3s Reflex,
 * Hands-Free Commute Audio Loop, Karaoke Micro-Stories & Live AI Voice Tutor.
 */

const App = {
  profileId: 'adriano',
  apiBase: '',
  curriculum: null,
  userState: null,
  telemetry: null,
  publicTunnelUrl: '',

  // Active tab state
  activeTab: 'sprint',
  activeBuilderSubtab: 'builder-sounds',

  // Lego Combinator state
  selectedStarterIdx: 0,
  selectedActionIdx: 0,
  selectedComplementIdx: 6,
  activeChallengeIdx: 0,
  assembledBlocks: [],

  // FSRS Reflex state
  reflexQueue: [],
  currentCard: null,
  cardStartMs: 0,
  cardRevealed: false,
  lastRevealLatencyMs: 0,
  reflexTimerId: null,

  // Commute / Driving loop state
  driveRunning: false,
  driveAbortToken: 0,
  driveDeck: [],
  driveIdx: 0,
  wakeLock: null,

  // Micro-Stories state
  activeStoryId: null,
  storyPlayingToken: 0,
  storyBlindMode: false,
  storyQuizAnswers: {},

  // AI Voice Tutor state
  activeScenarioId: 'bar-roma',
  tutorStepIndex: 0,
  tutorHistory: [],
  tutorSuggestions: [],

  // Shared Audio Player
  audioEl: new Audio(),
  activeRecognition: null
};

/* ==================== UTILITIES & TOAST ==================== */
function showToast(msg) {
  const el = document.getElementById('appToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2800);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeCompare(str = '') {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function playGentleChime(freq = 660, durationSec = 0.14) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
    setTimeout(() => ctx.close().catch(() => {}), 300);
  } catch (_) {}
}

/* ==================== DUAL-LAYER NEURAL TTS + OFFLINE FALLBACK ==================== */
function stopAllAudio() {
  try {
    App.audioEl.pause();
    App.audioEl.currentTime = 0;
  } catch (_) {}
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
}

function speakBrowserFallback(text, lang = 'it', slow = false) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) return resolve();
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = lang === 'en' ? 'en-US' : 'it-IT';
    utt.rate = slow ? 0.76 : 0.98;
    const voices = window.speechSynthesis.getVoices() || [];
    const targetPrefix = lang === 'en' ? 'en' : 'it';
    const match = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(targetPrefix));
    if (match) utt.voice = match;
    utt.onend = () => resolve();
    utt.onerror = () => resolve();
    window.speechSynthesis.speak(utt);
  });
}

async function speakText(text, { lang = 'it', slow = false, gender = null } = {}) {
  if (!text) return;
  stopAllAudio();
  const voiceGender = gender || App.userState?.settings?.voiceGender || 'female';
  const url = apiUrl(`api/tts?text=${encodeURIComponent(text)}&lang=${lang}&gender=${voiceGender}&slow=${slow ? '1' : '0'}`);

  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    App.audioEl.onended = finish;
    App.audioEl.onerror = async () => {
      await speakBrowserFallback(text, lang, slow);
      finish();
    };
    App.audioEl.src = url;
    App.audioEl.playbackRate = 1.0;
    const playPromise = App.audioEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(async () => {
        await speakBrowserFallback(text, lang, slow);
        finish();
      });
    }
  });
}

/* ==================== LIVE ITALIAN SPEECH RECOGNITION ==================== */
function listenItalianOnce({ onInterim, onFinal, onStateChange }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast('Live Mic requires Chrome, Edge, or Safari over HTTPS.');
    if (onStateChange) onStateChange(false);
    return null;
  }

  if (App.activeRecognition) {
    try { App.activeRecognition.abort(); } catch (_) {}
    App.activeRecognition = null;
  }

  stopAllAudio();
  const rec = new SR();
  rec.lang = 'it-IT';
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  App.activeRecognition = rec;

  let finalTranscript = '';
  if (onStateChange) onStateChange(true);

  rec.onresult = event => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalTranscript += t + ' ';
      else interim += t;
    }
    if (onInterim) onInterim((finalTranscript + interim).trim());
  };

  rec.onend = () => {
    App.activeRecognition = null;
    if (onStateChange) onStateChange(false);
    if (finalTranscript.trim() && onFinal) {
      onFinal(finalTranscript.trim());
    }
  };

  rec.onerror = err => {
    App.activeRecognition = null;
    if (onStateChange) onStateChange(false);
    if (err.error !== 'aborted' && err.error !== 'no-speech') {
      showToast(`Mic notice: ${err.error}. Check HTTPS/mic permission.`);
    }
  };

  rec.start();
  return rec;
}

/* ==================== API HELPERS ==================== */
function resolveProfileId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = (params.get('u') || params.get('profile') || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (fromUrl) {
      localStorage.setItem('veloce_profile', fromUrl);
      return fromUrl;
    }
    const saved = (localStorage.getItem('veloce_profile') || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (saved) return saved;
  } catch (_) {}
  return 'adriano';
}

function apiUrl(relPath) {
  return `${App.apiBase || ''}${relPath}`;
}

async function resolveApiBase() {
  if (window.location.hostname.endsWith('github.io')) {
    try {
      const cfg = await fetch(`tunnel_config.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json());
      if (cfg && cfg.veloce_url) return cfg.veloce_url.replace(/\/+$/, '') + '/';
      if (cfg && cfg.api_url) return cfg.api_url.replace(/\/+$/, '') + '/veloce/';
    } catch (_) {}
  }
  return '';
}

async function apiPost(path, body) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: App.profileId || 'adriano', ...body })
  });
  return res.json();
}

async function recordProgress(payload) {
  try {
    const data = await apiPost('api/progress', payload);
    if (data.ok) {
      if (typeof data.xp === 'number') App.userState.xp = data.xp;
      if (data.masteredPhonetics) App.userState.masteredPhonetics = data.masteredPhonetics;
      if (data.masteredCognateLaws) App.userState.masteredCognateLaws = data.masteredCognateLaws;
      if (data.completedBuilderChallenges) App.userState.completedBuilderChallenges = data.completedBuilderChallenges;
      if (data.completedStories) App.userState.completedStories = data.completedStories;
      if (data.completedMissions) App.userState.completedMissions = data.completedMissions;
      if (typeof data.unlockedTier === 'number') App.userState.unlockedTier = data.unlockedTier;
      if (data.telemetry) App.telemetry = data.telemetry;
      renderHeaderAndSprint();
    }
  } catch (_) {}
}

async function minePhrase({ it, en, phonetic = '', tip = 'Mined phrase', category = 'Mined Phrases' }) {
  const data = await apiPost('api/mine', { it, en, phonetic, tip, category });
  if (data.ok) {
    if (data.minedCards) App.userState.minedCards = data.minedCards;
    if (typeof data.xp === 'number') App.userState.xp = data.xp;
    if (data.telemetry) App.telemetry = data.telemetry;
    renderHeaderAndSprint();
    buildReflexQueue();
    showToast(data.alreadyExists ? 'Already in your Reflex Deck!' : `⚡ Mined "${it}" to 3s Reflex Deck!`);
  }
}

/* ==================== NAVIGATION ==================== */
function switchTab(tabId) {
  if (App.activeTab === 'drive' && tabId !== 'drive' && App.driveRunning) {
    stopCommuteSession();
  }
  App.activeTab = tabId;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${tabId}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-pill, .bnav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  if (tabId === 'reflex') {
    if (!App.currentCard) nextReflexCard();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ==================== 1. HEADER & TODAY'S SPRINT ==================== */
function renderHeaderAndSprint() {
  if (!App.userState || !App.telemetry) return;
  const t = App.telemetry;
  const u = App.userState;
  const eb = document.getElementById('heroEyebrowUser');
  if (eb) eb.textContent = 'ZERO-TO-SPEAKING PROTOCOL • FOR ' + (App.profileId || 'adriano').toUpperCase();

  document.getElementById('hdrCoverage').textContent = `${t.spokenCoveragePct}%`;
  document.getElementById('hdrStreak').textContent = u.streakDays || 1;
  document.getElementById('hdrXp').textContent = u.xp || 0;
  document.getElementById('navDueBadge').textContent = t.dueCount + Math.min(8, t.newAvailableCount);

  document.getElementById('sprintCoverageBig').textContent = `${t.spokenCoveragePct}%`;
  document.getElementById('sprintCoverageBar').style.width = `${Math.max(5, t.spokenCoveragePct)}%`;
  document.getElementById('sprintLatencyStat').textContent = t.avgLatencyMs
    ? `Avg Recall Speed: ${(t.avgLatencyMs / 1000).toFixed(2)}s ${t.avgLatencyMs <= 3000 ? '⚡ Automatic!' : '(Aim < 3.0s)'}`
    : 'Target Reflex: < 3.0s (Zero mental translation)';

  document.getElementById('kpiDue').textContent = t.dueCount;
  document.getElementById('kpiNewAvail').textContent = `+${t.newAvailableCount} new cards unlocked`;
  document.getElementById('kpiLatency').textContent = t.avgLatencyMs ? `${(t.avgLatencyMs / 1000).toFixed(2)}s` : 'Ready';
  document.getElementById('kpiMastered').textContent = `${t.masteredCount + t.learningCount} / ${t.totalDeckCount}`;
  document.getElementById('kpiTierLabel').textContent = `Pareto Tiers 1–${u.unlockedTier || 2} Active`;
  document.getElementById('kpiCognates').textContent = `${(u.masteredCognateLaws || []).length} / 8`;

  const sp = t.sprintToday || {};
  const steps = [
    {
      key: 'sounds',
      mins: '2 MIN',
      title: '1. Unlock the 7 Sound Keys',
      desc: 'Read & pronounce any Italian word accurately.',
      done: Boolean(sp.sounds),
      action: () => { switchTab('builder'); switchBuilderSubtab('builder-sounds'); }
    },
    {
      key: 'builder',
      mins: '4 MIN',
      title: '2. Stack Power Verbs & Cognates',
      desc: 'Build full sentences with Vorrei, Posso & Devo.',
      done: Boolean(sp.builder),
      action: () => { switchTab('builder'); switchBuilderSubtab('builder-lego'); }
    },
    {
      key: 'reflex',
      mins: '4 MIN',
      title: '3. 3-Second FSRS Reflex Blitz',
      desc: `Complete 8 rapid recalls (${t.reviewsToday}/8 done today).`,
      done: Boolean(sp.reflex),
      action: () => switchTab('reflex')
    },
    {
      key: 'story',
      mins: '3 MIN',
      title: '4. Decode a Native Micro-Story',
      desc: 'Train your ear on real Italian speed & mine idioms.',
      done: Boolean(sp.story),
      action: () => switchTab('stories')
    },
    {
      key: 'tutor',
      mins: '2 MIN',
      title: '5. Speak Out Loud With AI Coach',
      desc: 'Order coffee or chat in Rome using your voice.',
      done: Boolean(sp.tutor),
      action: () => switchTab('tutor')
    }
  ];

  const container = document.getElementById('sprintChecklist');
  container.innerHTML = steps
    .map(
      (s, idx) => `
      <div class="sprint-step-card ${s.done ? 'done' : ''}" data-sprint-idx="${idx}">
        <div>
          <div class="sprint-step-top">
            <span>${s.mins}</span>
            <span>${s.done ? '✓ DONE' : 'START →'}</span>
          </div>
          <div class="sprint-step-title" style="margin-top:0.35rem;">${escapeHtml(s.title)}</div>
          <div class="sprint-step-desc" style="margin-top:0.2rem;">${escapeHtml(s.desc)}</div>
        </div>
        <div class="sprint-go">${s.done ? 'Replay Engine →' : 'Launch Now →'}</div>
      </div>`
    )
    .join('');

  container.querySelectorAll('.sprint-step-card').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.sprintIdx);
      if (steps[idx]) steps[idx].action();
    });
  });
}

/* ==================== 2. 80/20 BUILDER (SOUNDS + COGNATES + LEGO) ==================== */
function switchBuilderSubtab(subId) {
  App.activeBuilderSubtab = subId;
  document.querySelectorAll('.subtab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.subtab === subId);
  });
  document.querySelectorAll('.subview').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(subId);
  if (el) el.classList.add('active');
}

function renderPhoneticsAndCognates() {
  const showPh = App.userState?.settings?.showPhonetics !== false;

  // A. 7 Sound Keys
  const pContainer = document.getElementById('phoneticKeysList');
  pContainer.innerHTML = App.curriculum.phoneticKeys
    .map(rule => {
      const isMastered = (App.userState.masteredPhonetics || []).includes(rule.id);
      return `
      <div class="rule-card ${isMastered ? 'mastered' : ''}">
        <div class="rule-badge-row">
          <span class="rule-code">Rule ${rule.ruleNumber}: ${escapeHtml(rule.badge)}</span>
          <button class="btn-secondary btn-sm mark-phonetic-btn" data-id="${rule.id}">
            ${isMastered ? '✓ Mastered' : 'Mark Got It +15 XP'}
          </button>
        </div>
        <h3>${escapeHtml(rule.title)}</h3>
        <p class="muted">${escapeHtml(rule.hook)}</p>
        <div style="font-size:0.84rem;font-weight:600;color:var(--green);">${escapeHtml(rule.secret)}</div>
        <div class="trap-box">⚠️ <strong>English Trap:</strong> ${escapeHtml(rule.trap)}</div>
        <div class="ex-chips-grid">
          ${rule.examples
            .map(
              ex => `
            <button class="audio-ex-chip" data-speak="${escapeHtml(ex.it)}">
              <div class="chip-it"><span>${escapeHtml(ex.it)}</span><span>🔊</span></div>
              ${showPh ? `<div class="chip-ph">${escapeHtml(ex.phonetic)}</div>` : ''}
              <div class="chip-en">${escapeHtml(ex.en)}</div>
            </button>`
            )
            .join('')}
        </div>
      </div>`;
    })
    .join('');

  pContainer.querySelectorAll('.audio-ex-chip').forEach(btn => {
    btn.addEventListener('click', () => speakText(btn.dataset.speak, { lang: 'it' }));
  });
  pContainer.querySelectorAll('.mark-phonetic-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await recordProgress({ phoneticId: btn.dataset.id });
      renderPhoneticsAndCognates();
      showToast('Sound Rule locked in! +15 XP');
    });
  });

  // B. 8 Cognate Laws
  const cContainer = document.getElementById('cognateLawsList');
  cContainer.innerHTML = App.curriculum.cognateLaws
    .map(law => {
      const isMastered = (App.userState.masteredCognateLaws || []).includes(law.id);
      return `
      <div class="rule-card ${isMastered ? 'mastered' : ''}">
        <div class="rule-badge-row">
          <span class="rule-code">${escapeHtml(law.enPattern)} → ${escapeHtml(law.itPattern)}</span>
          <span style="font-size:0.76rem;color:var(--green);font-weight:800;">+${law.unlockedCount} words</span>
        </div>
        <h3>${escapeHtml(law.genderHint)}</h3>
        <p class="muted">${escapeHtml(law.ruleSummary)}</p>
        <div class="ex-chips-grid">
          ${law.pairs
            .map(
              p => `
            <button class="audio-ex-chip" data-speak="${escapeHtml(p.sentenceIt)}" title="Tap to hear full Italian sentence">
              <div class="chip-it"><span>${escapeHtml(p.it)}</span><span>🔊</span></div>
              ${showPh ? `<div class="chip-ph">${escapeHtml(p.phonetic)}</div>` : ''}
              <div class="chip-en">${escapeHtml(p.en)} — "${escapeHtml(p.sentenceIt)}"</div>
            </button>`
            )
            .join('')}
        </div>
        <div style="margin-top:0.35rem;border-top:1px solid var(--border);padding-top:0.6rem;">
          <div style="font-size:0.78rem;font-weight:700;color:var(--gold);">
            ⚡ Instant Predictor Test: Convert "${escapeHtml(law.quizPrompt.enWord)}" → Italian:
          </div>
          <div class="cognate-quiz-row">
            <input type="text" placeholder="${escapeHtml(law.quizPrompt.hint)}" data-quiz-input="${law.id}" />
            <button class="btn-primary btn-sm cognate-check-btn" data-id="${law.id}">Check</button>
          </div>
        </div>
      </div>`;
    })
    .join('');

  cContainer.querySelectorAll('.audio-ex-chip').forEach(btn => {
    btn.addEventListener('click', () => speakText(btn.dataset.speak, { lang: 'it' }));
  });
  cContainer.querySelectorAll('.cognate-check-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const law = App.curriculum.cognateLaws.find(l => l.id === btn.dataset.id);
      const inp = cContainer.querySelector(`input[data-quiz-input="${law.id}"]`);
      const val = normalizeCompare(inp.value);
      if (val === normalizeCompare(law.quizPrompt.expectedIt) || val === normalizeCompare(law.quizPrompt.bareIt)) {
        inp.value = law.quizPrompt.expectedIt;
        speakText(law.quizPrompt.expectedIt, { lang: 'it' });
        await recordProgress({ cognateId: law.id });
        renderPhoneticsAndCognates();
        showToast(`Bravissimo! +${law.unlockedCount} cognates unlocked!`);
      } else {
        inp.value = law.quizPrompt.expectedIt;
        speakText(law.quizPrompt.expectedIt, { lang: 'it' });
        showToast(`Close! It’s "${law.quizPrompt.expectedIt}" — listen & try again!`);
      }
    });
  });

  // C. Polyglot Verb/Tense Shortcuts & Numbers/Time Grid
  const vh = App.curriculum.verbAndTimeHacks;
  const vContainer = document.getElementById('verbHacksList');
  if (vh && vContainer) {
    vContainer.innerHTML = vh.shortcuts
      .map(
        sc => `
        <div class="rule-card">
          <div class="rule-badge-row">
            <span class="rule-code">${escapeHtml(sc.badge)}</span>
          </div>
          <h3>${escapeHtml(sc.title)}</h3>
          <p class="muted">${escapeHtml(sc.summary)}</p>
          <div style="font-size:0.84rem;font-weight:700;color:var(--green);">${escapeHtml(sc.formula)}</div>
          <div class="ex-chips-grid">
            ${sc.examples
              .map(
                ex => `
              <button class="audio-ex-chip" data-speak="${escapeHtml(ex.it)}">
                <div class="chip-it"><span>${escapeHtml(ex.it)}</span><span>🔊</span></div>
                ${showPh ? `<div class="chip-ph">${escapeHtml(ex.phonetic)}</div>` : ''}
                <div class="chip-en">${escapeHtml(ex.en)}</div>
              </button>`
              )
              .join('')}
          </div>
        </div>`
      )
      .join('');
    vContainer.querySelectorAll('.audio-ex-chip').forEach(btn => {
      btn.addEventListener('click', () => speakText(btn.dataset.speak, { lang: 'it' }));
    });
  }

  const ntGrid = document.getElementById('numbersTimeGrid');
  if (vh && ntGrid) {
    ntGrid.innerHTML = (vh.numbersAndTime || [])
      .map(
        item => `
        <button class="audio-ex-chip" data-speak="${escapeHtml(item.it.replace(/•/g, ','))}">
          <div class="chip-it"><span>${escapeHtml(item.it)}</span><span>🔊</span></div>
          ${showPh ? `<div class="chip-ph">${escapeHtml(item.phonetic)}</div>` : ''}
          <div class="chip-en">${escapeHtml(item.en)}</div>
        </button>`
      )
      .join('');
    ntGrid.querySelectorAll('.audio-ex-chip').forEach(btn => {
      btn.addEventListener('click', () => speakText(btn.dataset.speak, { lang: 'it' }));
    });
  }
}

function renderLegoCombinator() {
  const pm = App.curriculum.powerMatrix;
  const s = pm.starters[App.selectedStarterIdx] || pm.starters[0];
  const a = pm.actions[App.selectedActionIdx] || pm.actions[0];
  const c = pm.complements[App.selectedComplementIdx] || pm.complements[0];

  const renderSlotList = (elId, arr, selectedIdx, onPick) => {
    const box = document.getElementById(elId);
    box.innerHTML = arr
      .map(
        (item, idx) => `
      <button class="lego-item ${idx === selectedIdx ? 'selected' : ''}" data-idx="${idx}">
        <strong>${escapeHtml(item.it)}</strong>
        <span>${escapeHtml(item.en)}</span>
      </button>`
      )
      .join('');
    box.querySelectorAll('.lego-item').forEach(btn => {
      btn.addEventListener('click', () => onPick(Number(btn.dataset.idx)));
    });
  };

  renderSlotList('legoStarters', pm.starters, App.selectedStarterIdx, idx => {
    App.selectedStarterIdx = idx;
    renderLegoCombinator();
    speakCurrentLego(false);
  });
  renderSlotList('legoActions', pm.actions, App.selectedActionIdx, idx => {
    App.selectedActionIdx = idx;
    renderLegoCombinator();
    speakCurrentLego(false);
  });
  renderSlotList('legoComplements', pm.complements, App.selectedComplementIdx, idx => {
    App.selectedComplementIdx = idx;
    renderLegoCombinator();
    speakCurrentLego(false);
  });

  const isQuestion = ['posso', 'puo', 'vuoi'].includes(s.id);
  const fullIt = `${s.it} ${a.it} ${c.it}${isQuestion && !c.it.endsWith('?') ? '?' : ''}`;
  const fullPh = `${s.phonetic} ${a.phonetic} ${c.phonetic}`;
  const fullEn = `${s.en} ${a.en} ${c.en}${isQuestion ? '?' : ''}`;

  document.getElementById('legoBuiltIt').textContent = fullIt;
  document.getElementById('legoBuiltPh').textContent = fullPh;
  document.getElementById('legoBuiltEn').textContent = fullEn;
  document.getElementById('legoBuiltNote').textContent = `💡 ${s.note}`;
}

function getCurrentLegoSentence() {
  return {
    it: document.getElementById('legoBuiltIt').textContent,
    ph: document.getElementById('legoBuiltPh').textContent,
    en: document.getElementById('legoBuiltEn').textContent
  };
}

function speakCurrentLego(slow = false) {
  const { it } = getCurrentLegoSentence();
  speakText(it, { lang: 'it', slow });
}

function renderLegoChallenge() {
  const challenges = App.curriculum.powerMatrix.challenges;
  const ch = challenges[App.activeChallengeIdx % challenges.length];
  document.getElementById('challengeProgressBadge').textContent = `${(App.activeChallengeIdx % challenges.length) + 1} / ${challenges.length}`;

  // Shuffle bank deterministically per render if needed
  if (!App._currentBank || App._currentChallengeId !== ch.id) {
    App._currentChallengeId = ch.id;
    App.assembledBlocks = [];
    App._currentBank = [...ch.blocks, ...ch.distractors].sort(() => Math.random() - 0.5);
  }

  const arena = document.getElementById('legoChallengeArena');
  arena.innerHTML = `
    <div style="font-size:0.76rem;font-weight:800;color:var(--gold);margin-bottom:0.25rem;">${escapeHtml(ch.level)} CHALLENGE</div>
    <div class="challenge-prompt-en">"${escapeHtml(ch.promptEn)}"</div>
    <div class="assembled-tray" id="chTray">
      ${
        App.assembledBlocks.length === 0
          ? '<span class="muted" style="font-size:0.84rem;">Tap Italian blocks below in order (or use 🎙️ Speak It)...</span>'
          : App.assembledBlocks.map((b, i) => `<button class="block-token" data-remove="${i}">${escapeHtml(b)} ✕</button>`).join('')
      }
    </div>
    <div class="word-bank" id="chBank">
      ${App._currentBank
        .map((b, i) => `<button class="block-token" data-bank="${i}">${escapeHtml(b)}</button>`)
        .join('')}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:0.55rem;">
      <button class="btn-primary" id="chCheckBtn">Check Sentence</button>
      <button class="btn-secondary" id="chSpeakMicBtn">🎙️ Speak It Instead</button>
      <button class="btn-secondary" id="chResetBtn">Clear</button>
      <button class="btn-outline" id="chNextBtn">Skip / Next →</button>
    </div>
    <div class="mic-feedback-inline hidden" id="chFeedback"></div>
  `;

  arena.querySelectorAll('[data-bank]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.bank);
      const word = App._currentBank.splice(idx, 1)[0];
      App.assembledBlocks.push(word);
      renderLegoChallenge();
    });
  });

  arena.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.remove);
      const word = App.assembledBlocks.splice(idx, 1)[0];
      App._currentBank.push(word);
      renderLegoChallenge();
    });
  });

  const evaluateAttempt = async attemptStr => {
    const fb = document.getElementById('chFeedback');
    fb.classList.remove('hidden');
    const cleanAttempt = normalizeCompare(attemptStr);
    const cleanTarget = normalizeCompare(ch.expectedIt);
    await speakText(ch.expectedIt, { lang: 'it' });
    if (cleanAttempt === cleanTarget || (cleanAttempt.length > 10 && cleanTarget.includes(cleanAttempt))) {
      fb.innerHTML = `✅ <strong>Perfetto!</strong> "${escapeHtml(ch.expectedIt)}" (${escapeHtml(ch.phonetic)})<br/><span class="muted">${escapeHtml(ch.whyItWorks)}</span>`;
      await recordProgress({ challengeId: ch.id });
      showToast('Sentence Mastered! +25 XP');
    } else {
      fb.innerHTML = `💡 <strong>Target Italian:</strong> "${escapeHtml(ch.expectedIt)}" (${escapeHtml(ch.phonetic)})<br/><span class="muted">${escapeHtml(ch.whyItWorks)}</span>`;
    }
  };

  document.getElementById('chCheckBtn').addEventListener('click', () => {
    evaluateAttempt(App.assembledBlocks.join(' '));
  });

  document.getElementById('chResetBtn').addEventListener('click', () => {
    App._currentChallengeId = null;
    renderLegoChallenge();
  });

  document.getElementById('chNextBtn').addEventListener('click', () => {
    App.activeChallengeIdx = (App.activeChallengeIdx + 1) % challenges.length;
    App._currentChallengeId = null;
    renderLegoChallenge();
  });

  document.getElementById('chSpeakMicBtn').addEventListener('click', () => {
    const fb = document.getElementById('chFeedback');
    fb.classList.remove('hidden');
    fb.textContent = '🎙️ Listening in Italian... Speak now!';
    listenItalianOnce({
      onInterim: txt => { fb.textContent = `🎙️ Heard: "${txt}"...`; },
      onFinal: txt => evaluateAttempt(txt)
    });
  });
}

/* ==================== 3. FSRS-5 3-SECOND REFLEX DRILLS ==================== */
function getAllDeckCards() {
  return [...(App.userState?.minedCards || []), ...(App.curriculum?.paretoDeck || [])];
}

function buildReflexQueue() {
  const filterVal = document.getElementById('reflexTierSelect')?.value || 'unlocked';
  const all = getAllDeckCards();
  const fsrsMap = App.userState?.fsrsCards || {};
  const now = Date.now();
  const unlockedTier = App.userState?.unlockedTier || 2;

  let pool = all;
  if (filterVal === 'mined') {
    pool = App.userState?.minedCards || [];
  } else if (filterVal !== 'unlocked') {
    const tNum = Number(filterVal);
    pool = all.filter(c => Number(c.tier) === tNum);
  } else {
    pool = all.filter(c => String(c.id).startsWith('mine-') || (c.tier || 1) <= unlockedTier);
  }

  if (pool.length === 0) pool = all.slice(0, 18);

  const due = [];
  const fresh = [];
  const ahead = [];

  for (const card of pool) {
    const st = fsrsMap[card.id];
    if (!st || st.state === 'new') fresh.push(card);
    else if (st.dueAt <= now) due.push(card);
    else ahead.push(card);
  }

  due.sort((a, b) => (fsrsMap[a.id]?.dueAt || 0) - (fsrsMap[b.id]?.dueAt || 0));
  ahead.sort((a, b) => (fsrsMap[a.id]?.dueAt || 0) - (fsrsMap[b.id]?.dueAt || 0));

  App.reflexQueue = [...due, ...fresh, ...ahead];
}

function stopReflexTimer() {
  if (App.reflexTimerId) {
    clearInterval(App.reflexTimerId);
    App.reflexTimerId = null;
  }
}

function startReflexTimerRing() {
  stopReflexTimer();
  const circle = document.getElementById('rfTimerCircle');
  const txt = document.getElementById('rfTimerText');
  const circumference = 113.1;
  const targetMs = App.userState?.settings?.reflexTargetMs || 3000;
  App.cardStartMs = performance.now();

  App.reflexTimerId = setInterval(() => {
    if (App.cardRevealed) return stopReflexTimer();
    const elapsed = performance.now() - App.cardStartMs;
    const remain = Math.max(0, targetMs - elapsed);
    const ratio = remain / targetMs;
    circle.style.strokeDashoffset = String(circumference * (1 - ratio));

    if (remain > 1200) circle.style.stroke = '#2ea86f';
    else if (remain > 0) circle.style.stroke = '#e6b34b';
    else circle.style.stroke = '#e05a3a';

    txt.textContent = remain > 0 ? `${(remain / 1000).toFixed(1)}s` : '>3s';
  }, 80);
}

function nextReflexCard() {
  buildReflexQueue();
  if (!App.reflexQueue.length) return;
  const candidate =
    App.reflexQueue.find(c => !App.currentCard || c.id !== App.currentCard.id) || App.reflexQueue[0];
  App.currentCard = candidate;
  App.cardRevealed = false;

  const direction = document.getElementById('reflexDirectionSelect').value;
  document.getElementById('rfCategoryTag').textContent = `Tier ${candidate.tier} • ${candidate.category}`;
  document.getElementById('rfPreReveal').classList.remove('hidden');
  document.getElementById('rfAnswerZone').classList.add('hidden');
  document.getElementById('rfMicStatus').classList.add('hidden');

  if (direction === 'audio-to-en') {
    document.getElementById('rfInstruction').textContent = 'LISTEN TO NATIVE ITALIAN — WHAT DOES IT MEAN?';
    document.getElementById('rfPromptMain').textContent = '🎧 Listen & Comprehend...';
    document.getElementById('rfReplayPromptAudioBtn').classList.remove('hidden');
    speakText(candidate.it, { lang: 'it' });
  } else {
    document.getElementById('rfInstruction').textContent = 'SAY THIS OUT LOUD IN ITALIAN BEFORE 3.0s:';
    document.getElementById('rfPromptMain').textContent = candidate.en;
    document.getElementById('rfReplayPromptAudioBtn').classList.add('hidden');
  }

  startReflexTimerRing();
}

function revealReflexCard(spokenAttempt = null) {
  if (!App.currentCard || App.cardRevealed) return;
  App.cardRevealed = true;
  stopReflexTimer();

  const c = App.currentCard;
  const latency = Math.round(performance.now() - App.cardStartMs);
  App.lastRevealLatencyMs = latency;

  document.getElementById('rfPreReveal').classList.add('hidden');
  document.getElementById('rfAnswerZone').classList.remove('hidden');

  const showPh = App.userState?.settings?.showPhonetics !== false;
  document.getElementById('rfAnswerIt').textContent = c.it;
  document.getElementById('rfAnswerPh').textContent = showPh ? c.phonetic : '';
  document.getElementById('rfAnswerSub').textContent = `${c.en}${c.literal ? `  •  Literal: "${c.literal}"` : ''}`;
  document.getElementById('rfExampleIt').textContent = c.exampleIt || c.it;
  document.getElementById('rfExampleEn').textContent = c.exampleEn || c.en;
  document.getElementById('rfTip').textContent = `💡 ${c.tip || 'Speak out loud right now to wire muscle memory!'}`;

  const latBadge = document.getElementById('rfLatencyBadge');
  const secStr = (latency / 1000).toFixed(2);
  let recGrade = latency <= 1800 ? 4 : latency <= 3100 ? 3 : 2;

  if (spokenAttempt) {
    const cleanSpoken = normalizeCompare(spokenAttempt);
    const cleanTarget = normalizeCompare(c.it.split('/')[0]);
    const matched = cleanSpoken && (cleanTarget.includes(cleanSpoken) || cleanSpoken.includes(cleanTarget));
    latBadge.textContent = matched
      ? `🎙️ Heard "${spokenAttempt}" in ${secStr}s — Spot On!`
      : `🎙️ Heard "${spokenAttempt}" — Compare with native audio below`;
    latBadge.classList.toggle('slow', !matched);
    recGrade = matched ? (latency <= 3100 ? 3 : 2) : 1;
  } else if (latency <= 3000) {
    latBadge.textContent = `⚡ ${secStr}s — Automatic Italian Reflex!`;
    latBadge.classList.remove('slow');
  } else {
    latBadge.textContent = `⏱️ ${secStr}s — Recalled, now tighten speed < 3.0s`;
    latBadge.classList.add('slow');
  }

  // Highlight recommended FSRS rating button
  document.querySelectorAll('.grade-btn').forEach(btn => {
    btn.classList.toggle('recommended', Number(btn.dataset.rating) === recGrade);
  });

  // Preview intervals cleanly
  const st = App.userState?.fsrsCards?.[c.id];
  document.getElementById('int-1').textContent = st && st.reps ? '5m' : '1m';
  document.getElementById('int-2').textContent = st && st.reps ? '1d' : '6m';
  document.getElementById('int-3').textContent = st && st.reps ? `${Math.max(2, Math.round((st.stability || 2) * 1.9))}d` : (latency <= 2800 ? '3d' : '15m');
  document.getElementById('int-4').textContent = st && st.reps ? `${Math.max(5, Math.round((st.stability || 3) * 3.2))}d` : '15d';

  if (App.userState?.settings?.autoPlayAudio !== false) {
    speakText(c.it.split('/')[0].trim(), { lang: 'it' });
  }
}

async function submitReflexRating(rating) {
  if (!App.currentCard) return;
  const cardId = App.currentCard.id;
  const res = await apiPost('api/review', {
    cardId,
    rating: Number(rating),
    latencyMs: App.lastRevealLatencyMs
  });
  if (res.ok) {
    App.userState.fsrsCards[cardId] = res.cardState;
    App.userState.xp = res.xp;
    App.userState.unlockedTier = res.unlockedTier;
    App.telemetry = res.telemetry;
    renderHeaderAndSprint();
  }
  nextReflexCard();
}

/* ==================== 4. HANDS-FREE DRIVING / COMMUTE AUDIO LOOP ==================== */
function sleepWithCancel(ms, token) {
  return new Promise(resolve => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (!App.driveRunning || App.driveAbortToken !== token) {
        clearInterval(iv);
        return resolve(false);
      }
      const pct = Math.min(100, ((Date.now() - start) / ms) * 100);
      const fill = document.getElementById('driveProgressFill');
      if (fill) fill.style.width = `${pct}%`;
      if (Date.now() - start >= ms) {
        clearInterval(iv);
        resolve(true);
      }
    }, 80);
  });
}

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      App.wakeLock = await navigator.wakeLock.request('screen');
      document.getElementById('wakeLockBadge').textContent = '🔒 Screen Awake Active';
    }
  } catch (_) {}
}

function releaseWakeLock() {
  if (App.wakeLock) {
    try { App.wakeLock.release(); } catch (_) {}
    App.wakeLock = null;
  }
  const b = document.getElementById('wakeLockBadge');
  if (b) b.textContent = '📱 Screen Awake Ready';
}

function buildCommuteDeck() {
  const topic = document.getElementById('driveTopicSelect').value;
  const all = getAllDeckCards();
  if (topic === 'smart') {
    buildReflexQueue();
    App.driveDeck = App.reflexQueue.slice(0, 30);
  } else {
    App.driveDeck = all.filter(c => Number(c.tier) === Number(topic));
  }
  if (!App.driveDeck.length) App.driveDeck = all.slice(0, 20);
  App.driveIdx = 0;
}

function stopCommuteSession() {
  App.driveRunning = false;
  App.driveAbortToken += 1;
  stopAllAudio();
  releaseWakeLock();
  const btn = document.getElementById('driveToggleBtn');
  btn.textContent = '▶️ Resume Commute Session';
  btn.classList.remove('running');
  document.getElementById('drivePhaseBadge').textContent = 'PAUSED';
}

async function startCommuteSession() {
  if (!App.driveDeck.length) buildCommuteDeck();
  App.driveRunning = true;
  const token = ++App.driveAbortToken;
  const btn = document.getElementById('driveToggleBtn');
  btn.textContent = '⏸️ Pause Commute Session';
  btn.classList.add('running');

  await acquireWakeLock();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'VELOCE Hands-Free Italian',
      artist: '80/20 Commute Reflex Loop',
      album: 'Active Speaking Practice'
    });
    navigator.mediaSession.setActionHandler('pause', () => stopCommuteSession());
    navigator.mediaSession.setActionHandler('play', () => startCommuteSession());
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      App.driveIdx = (App.driveIdx + 1) % App.driveDeck.length;
    });
  }

  const pauseMs = Math.max(2000, (Number(App.userState?.settings?.commutePauseSec) || 3.5) * 1000);

  while (App.driveRunning && App.driveAbortToken === token) {
    const card = App.driveDeck[App.driveIdx % App.driveDeck.length];
    const primaryIt = card.it.split('/')[0].trim();

    // Step 1: Speak English Prompt
    document.getElementById('drivePhaseBadge').textContent = '1/4 • LISTEN TO ENGLISH';
    document.getElementById('drivePromptEn').textContent = `How do you say: "${card.en}"?`;
    document.getElementById('driveTargetIt').textContent = '•••';
    document.getElementById('driveTargetPh').textContent = '';
    document.getElementById('driveProgressFill').style.width = '0%';

    await speakText(`How do you say: ${card.en}?`, { lang: 'en' });
    if (!App.driveRunning || App.driveAbortToken !== token) break;

    // Step 2: Timed Recall Pause (Speak Out Loud!)
    playGentleChime(740, 0.12);
    document.getElementById('drivePhaseBadge').textContent = '2/4 • SPEAK ITALIAN OUT LOUD NOW!';
    const okPause = await sleepWithCancel(pauseMs, token);
    if (!okPause) break;

    // Step 3: Reveal & Play Slow 0.8x Native Italian
    document.getElementById('drivePhaseBadge').textContent = '3/4 • CRISP SLOW ITALIAN (0.8x)';
    document.getElementById('driveTargetIt').textContent = primaryIt;
    document.getElementById('driveTargetPh').textContent = card.phonetic || '';
    await speakText(primaryIt, { lang: 'it', slow: true });
    if (!App.driveRunning || App.driveAbortToken !== token) break;

    // Brief shadow pause
    const okShadow = await sleepWithCancel(1800, token);
    if (!okShadow) break;

    // Step 4: Natural 1.0x Speed Italian
    document.getElementById('drivePhaseBadge').textContent = '4/4 • NATURAL STREET SPEED (1.0x)';
    await speakText(primaryIt, { lang: 'it', slow: false });
    if (!App.driveRunning || App.driveAbortToken !== token) break;

    await sleepWithCancel(1100, token);
    App.driveIdx = (App.driveIdx + 1) % App.driveDeck.length;
  }
}

/* ==================== 5. NATIVE EAR & MICRO-STORIES ==================== */
function renderStories() {
  const stories = App.curriculum.microStories;
  if (!App.activeStoryId) App.activeStoryId = stories[0].id;
  const activeStory = stories.find(s => s.id === App.activeStoryId) || stories[0];

  const listEl = document.getElementById('storiesList');
  listEl.innerHTML = stories
    .map(s => {
      const done = (App.userState.completedStories || []).includes(s.id);
      return `
      <button class="story-nav-card ${s.id === activeStory.id ? 'active' : ''}" data-story-id="${s.id}">
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;font-weight:800;color:var(--gold);">
          <span>${escapeHtml(s.level)}</span>
          <span>${done ? '✓ Mastered' : `${s.durationSec}s`}</span>
        </div>
        <div style="font-weight:700;margin-top:0.2rem;">${escapeHtml(s.title)}</div>
        <div style="font-size:0.76rem;color:var(--text-muted);">${escapeHtml(s.subtitle)}</div>
      </button>`;
    })
    .join('');

  listEl.querySelectorAll('.story-nav-card').forEach(btn => {
    btn.addEventListener('click', () => {
      App.storyPlayingToken += 1;
      stopAllAudio();
      App.activeStoryId = btn.dataset.storyId;
      App.storyQuizAnswers = {};
      renderStories();
    });
  });

  const showPh = App.userState?.settings?.showPhonetics !== false;
  const reader = document.getElementById('storyReader');
  reader.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;">
      <div>
        <span class="eyebrow">${escapeHtml(activeStory.level)} • TAP ANY LINE TO HEAR</span>
        <h2>${escapeHtml(activeStory.title)}</h2>
        <p class="muted">${escapeHtml(activeStory.subtitle)}</p>
      </div>
    </div>

    <div class="story-controls">
      <button class="btn-primary btn-sm" id="playStoryNormalBtn">▶️ Play Dialogue (1.0x)</button>
      <button class="btn-secondary btn-sm" id="playStorySlowBtn">🐢 Ear Training (0.8x)</button>
      <button class="btn-secondary btn-sm" id="stopStoryBtn">⏹️ Stop</button>
      <button class="btn-outline btn-sm" id="toggleBlindBtn">
        ${App.storyBlindMode ? '👁️ Show English' : '🙈 Blind Ear Mode (Hide English)'}
      </button>
    </div>

    <div class="banner-note" style="font-size:0.82rem;">
      🇮🇹 <strong>Insider Culture Tip:</strong> ${escapeHtml(activeStory.cultureNote)}
    </div>

    <div class="${App.storyBlindMode ? 'blind-mode' : ''}" id="storyLinesWrap">
      ${activeStory.lines
        .map(
          (ln, idx) => `
        <div class="dialogue-line" data-line-idx="${idx}">
          <div class="dl-speaker">${escapeHtml(ln.speaker)} 🔊</div>
          <div class="dl-it">${escapeHtml(ln.it)}</div>
          ${showPh ? `<div class="dl-ph">${escapeHtml(ln.phonetic)}</div>` : ''}
          <div class="dl-en">${escapeHtml(ln.en)}</div>
        </div>`
        )
        .join('')}
    </div>

    <div style="margin-top:1.3rem;border-top:1px solid var(--border);padding-top:1rem;">
      <h3>⛏️ High-Leverage Phrases to Mine (1-Tap to FSRS Deck)</h3>
      <div class="minable-grid">
        ${activeStory.minablePhrases
          .map(
            (mp, idx) => `
          <div class="mine-chip-card">
            <div>
              <div style="font-weight:700;color:var(--gold);">${escapeHtml(mp.it)}</div>
              <div style="font-size:0.76rem;color:var(--green);">${escapeHtml(mp.phonetic)}</div>
              <div style="font-size:0.82rem;margin-top:0.15rem;">${escapeHtml(mp.en)}</div>
              <div style="font-size:0.74rem;color:var(--text-muted);margin-top:0.2rem;">${escapeHtml(mp.tip)}</div>
            </div>
            <div style="display:flex;gap:0.4rem;">
              <button class="btn-secondary btn-sm story-hear-mp" data-idx="${idx}">🔊</button>
              <button class="btn-outline btn-sm story-mine-mp" data-idx="${idx}">+ Mine to Deck</button>
            </div>
          </div>`
          )
          .join('')}
      </div>
    </div>

    <div style="margin-top:1.3rem;border-top:1px solid var(--border);padding-top:1rem;">
      <h3>✅ Quick Comprehension Lock-In (+35 XP)</h3>
      ${activeStory.quiz
        .map(
          (q, qIdx) => `
        <div style="margin-top:0.75rem;">
          <div style="font-weight:700;font-size:0.9rem;">${qIdx + 1}. ${escapeHtml(q.q)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:0.45rem;margin-top:0.4rem;">
            ${q.options
              .map(
                (opt, oIdx) => `
              <button class="btn-secondary btn-sm story-quiz-opt" data-q="${qIdx}" data-o="${oIdx}">
                ${escapeHtml(opt)}
              </button>`
              )
              .join('')}
          </div>
        </div>`
        )
        .join('')}
    </div>
  `;

  reader.querySelectorAll('.dialogue-line').forEach(el => {
    el.addEventListener('click', () => {
      App.storyPlayingToken += 1;
      const idx = Number(el.dataset.lineIdx);
      const ln = activeStory.lines[idx];
      reader.querySelectorAll('.dialogue-line').forEach(d => d.classList.remove('playing'));
      el.classList.add('playing');
      speakText(ln.it, {
        lang: 'it',
        gender: ln.speaker.toLowerCase().includes('adriano') || ln.speaker.toLowerCase().includes('cameriere') || ln.speaker.toLowerCase().includes('tassista') ? 'male' : 'female'
      });
    });
  });

  const playWholeStory = async slow => {
    const token = ++App.storyPlayingToken;
    const els = reader.querySelectorAll('.dialogue-line');
    for (let i = 0; i < activeStory.lines.length; i++) {
      if (App.storyPlayingToken !== token) break;
      els.forEach(d => d.classList.remove('playing'));
      els[i].classList.add('playing');
      els[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const ln = activeStory.lines[i];
      const isMale = /adriano|cameriere|tassista|artigiano|marco/i.test(ln.speaker);
      await speakText(ln.it, { lang: 'it', slow, gender: isMale ? 'male' : 'female' });
    }
    els.forEach(d => d.classList.remove('playing'));
  };

  document.getElementById('playStoryNormalBtn').addEventListener('click', () => playWholeStory(false));
  document.getElementById('playStorySlowBtn').addEventListener('click', () => playWholeStory(true));
  document.getElementById('stopStoryBtn').addEventListener('click', () => {
    App.storyPlayingToken += 1;
    stopAllAudio();
  });
  document.getElementById('toggleBlindBtn').addEventListener('click', () => {
    App.storyBlindMode = !App.storyBlindMode;
    renderStories();
  });

  reader.querySelectorAll('.story-hear-mp').forEach(btn => {
    btn.addEventListener('click', () => {
      const mp = activeStory.minablePhrases[Number(btn.dataset.idx)];
      speakText(mp.it, { lang: 'it' });
    });
  });
  reader.querySelectorAll('.story-mine-mp').forEach(btn => {
    btn.addEventListener('click', () => {
      const mp = activeStory.minablePhrases[Number(btn.dataset.idx)];
      minePhrase({ it: mp.it, en: mp.en, phonetic: mp.phonetic, tip: mp.tip, category: activeStory.title });
    });
  });

  reader.querySelectorAll('.story-quiz-opt').forEach(btn => {
    btn.addEventListener('click', async () => {
      const qIdx = Number(btn.dataset.q);
      const oIdx = Number(btn.dataset.o);
      const correct = activeStory.quiz[qIdx].answerIndex === oIdx;
      if (correct) {
        btn.style.borderColor = '#2ea86f';
        btn.style.color = '#2ea86f';
        App.storyQuizAnswers[qIdx] = true;
        if (Object.keys(App.storyQuizAnswers).length >= activeStory.quiz.length) {
          await recordProgress({ storyId: activeStory.id });
          showToast(`🎉 "${activeStory.title}" Mastered! +35 XP`);
          renderStories();
        } else {
          showToast('Esatto! Correct!');
        }
      } else {
        btn.style.borderColor = '#e05a3a';
        showToast('Try another option!');
      }
    });
  });
}

/* ==================== 6. LIVE AI ITALIAN VOICE TUTOR ==================== */
function initTutorScenario(scenarioId) {
  const scenarios = App.curriculum.scenarios;
  const sc = scenarios.find(s => s.id === scenarioId) || scenarios[0];
  App.activeScenarioId = sc.id;
  App.tutorStepIndex = 0;

  const step0 = sc.steps[0];
  App.tutorHistory = [
    {
      role: 'tutor',
      it: step0.openingIt,
      phonetic: step0.openingPhonetic,
      en: step0.openingEn,
      voiceGender: sc.voiceGender
    }
  ];
  App.tutorSuggestions = step0.suggestions || [];
  renderTutor();
}

function renderTutor() {
  const scenarios = App.curriculum.scenarios;
  const sc = scenarios.find(s => s.id === App.activeScenarioId) || scenarios[0];

  const sideEl = document.getElementById('tutorScenarioList');
  sideEl.innerHTML = scenarios
    .map(item => {
      const done = (App.userState.completedMissions || []).includes(item.id);
      return `
      <button class="story-nav-card ${item.id === sc.id ? 'active' : ''}" data-sc-id="${item.id}">
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;font-weight:800;color:var(--gold);">
          <span>${escapeHtml(item.difficulty)}</span>
          <span>${done ? '✓ Completed' : ''}</span>
        </div>
        <div style="font-weight:700;margin-top:0.2rem;">${escapeHtml(item.title)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(item.persona)}</div>
      </button>`;
    })
    .join('');

  sideEl.querySelectorAll('.story-nav-card').forEach(btn => {
    btn.addEventListener('click', () => {
      initTutorScenario(btn.dataset.scId);
      const first = App.tutorHistory[0];
      if (first) speakText(first.it, { lang: 'it', gender: first.voiceGender });
    });
  });

  document.getElementById('tutorPersonaTitle').textContent = sc.persona;
  document.getElementById('tutorMissionGoal').textContent = sc.missionGoal;
  document.getElementById('tutorStepBadge').textContent =
    sc.id === 'free-coach' ? 'Open Practice' : `Step ${Math.min(App.tutorStepIndex + 1, sc.steps.length)} / ${sc.steps.length}`;

  const showPh = App.userState?.settings?.showPhonetics !== false;
  const msgContainer = document.getElementById('tutorMessages');
  msgContainer.innerHTML = App.tutorHistory
    .map((m, idx) => {
      if (m.role === 'tutor') {
        return `
        <div class="msg-bubble tutor">
          <div class="msg-it">${escapeHtml(m.it)}</div>
          ${showPh && m.phonetic ? `<div class="msg-ph">${escapeHtml(m.phonetic)}</div>` : ''}
          <div class="msg-en">${escapeHtml(m.en)}</div>
          <div class="msg-actions">
            <button class="btn-secondary btn-sm tutor-msg-play" data-idx="${idx}" data-slow="0">🔊 1.0x</button>
            <button class="btn-secondary btn-sm tutor-msg-play" data-idx="${idx}" data-slow="1">🐢 0.8x</button>
          </div>
        </div>`;
      }
      return `
      <div class="msg-bubble user">
        <div class="msg-it">🗣️ "${escapeHtml(m.text)}"</div>
        ${
          m.coach
            ? `
          <div class="coach-feedback-box">
            <div style="font-weight:800;color:var(--gold);">${escapeHtml(m.coach.badge)} (${m.coach.score}%)</div>
            ${
              m.coach.polishedIt && normalizeCompare(m.coach.polishedIt) !== normalizeCompare(m.text)
                ? `<div style="margin-top:0.2rem;">✨ <strong>Polished Italian:</strong> ${escapeHtml(m.coach.polishedIt)}</div>`
                : ''
            }
            <div style="color:var(--text-muted);margin-top:0.2rem;">${escapeHtml(m.coach.microTip)}</div>
            ${
              m.coach.canMine
                ? `<button class="btn-outline btn-sm tutor-mine-btn" style="margin-top:0.4rem;" data-it="${escapeHtml(m.coach.polishedIt || m.text)}" data-ph="${escapeHtml(m.coach.polishedPhonetic || '')}">+ Mine Phrase</button>`
                : ''
            }
          </div>`
            : ''
        }
      </div>`;
    })
    .join('');

  msgContainer.scrollTop = msgContainer.scrollHeight;

  msgContainer.querySelectorAll('.tutor-msg-play').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = App.tutorHistory[Number(btn.dataset.idx)];
      speakText(m.it, { lang: 'it', slow: btn.dataset.slow === '1', gender: m.voiceGender || sc.voiceGender });
    });
  });

  msgContainer.querySelectorAll('.tutor-mine-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      minePhrase({
        it: btn.dataset.it,
        en: `Practiced in ${sc.title}`,
        phonetic: btn.dataset.ph,
        category: 'AI Tutor'
      });
    });
  });

  // Render 3 Beginner Lifelines
  const lifeGrid = document.getElementById('tutorLifelines');
  lifeGrid.innerHTML = (App.tutorSuggestions || [])
    .map(
      (sug, idx) => `
      <div class="lifeline-chip">
        <div class="lifeline-top">
          <span class="lifeline-tag">${escapeHtml(sug.label)}</span>
          <button class="btn-secondary btn-sm life-hear-btn" data-idx="${idx}" title="Preview pronunciation">🔊</button>
        </div>
        <div class="lifeline-it" data-idx="${idx}">${escapeHtml(sug.it)}</div>
        ${showPh ? `<div style="font-size:0.72rem;color:var(--green);">${escapeHtml(sug.phonetic)}</div>` : ''}
        <div style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(sug.en)}</div>
      </div>`
    )
    .join('');

  lifeGrid.querySelectorAll('.life-hear-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const sug = App.tutorSuggestions[Number(btn.dataset.idx)];
      speakText(sug.it, { lang: 'it' });
    });
  });

  lifeGrid.querySelectorAll('.lifeline-it').forEach(el => {
    el.addEventListener('click', () => {
      const sug = App.tutorSuggestions[Number(el.dataset.idx)];
      sendTutorUserTurn(sug.it);
    });
  });
}

async function sendTutorUserTurn(userText) {
  const clean = String(userText || '').trim();
  if (!clean) return;
  document.getElementById('tutorTextInput').value = '';

  const userEntry = { role: 'user', text: clean, coach: null };
  App.tutorHistory.push(userEntry);
  renderTutor();

  const res = await apiPost('api/tutor/turn', {
    scenarioId: App.activeScenarioId,
    stepIndex: App.tutorStepIndex,
    userText: clean,
    history: App.tutorHistory.map(h => ({ role: h.role, text: h.text || h.it }))
  });

  if (res.ok) {
    userEntry.coach = res.coach;
    App.tutorStepIndex = res.missionProgress?.step ?? App.tutorStepIndex + 1;
    App.tutorSuggestions = res.suggestions || [];
    App.tutorHistory.push({
      role: 'tutor',
      it: res.replyIt,
      phonetic: res.replyPhonetic,
      en: res.replyEn,
      voiceGender: res.voiceGender
    });
    if (typeof res.xp === 'number') App.userState.xp = res.xp;
    if (res.telemetry) App.telemetry = res.telemetry;
    renderHeaderAndSprint();
    renderTutor();
    speakText(res.replyIt, { lang: 'it', gender: res.voiceGender });
  }
}

/* ==================== BOOTSTRAP & EVENT WIRING ==================== */
async function bootstrapApp() {
  App.profileId = resolveProfileId();
  App.apiBase = await resolveApiBase();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const resp = await fetch(apiUrl(`api/bootstrap?profile=${encodeURIComponent(App.profileId)}`));
  const data = await resp.json();
  App.curriculum = data.curriculum;
  App.userState = data.userState;
  App.telemetry = data.telemetry;
  App.publicTunnelUrl = data.publicTunnelUrl || window.location.origin;

  renderHeaderAndSprint();
  renderPhoneticsAndCognates();
  renderLegoCombinator();
  renderLegoChallenge();
  nextReflexCard();
  buildCommuteDeck();
  renderStories();
  initTutorScenario('bar-roma');

  // Top & Bottom Nav
  document.querySelectorAll('.nav-pill, .bnav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.getElementById('brandHomeBtn').addEventListener('click', () => switchTab('sprint'));

  // Builder Subtabs
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchBuilderSubtab(btn.dataset.subtab));
  });

  // Custom Miner Form
  document.getElementById('customMineForm').addEventListener('submit', async e => {
    e.preventDefault();
    const it = document.getElementById('mineItInput').value.trim();
    const en = document.getElementById('mineEnInput').value.trim();
    const phonetic = document.getElementById('minePhInput').value.trim();
    await minePhrase({ it, en, phonetic, category: 'Personal Custom' });
    e.target.reset();
  });

  // Lego Combinator Buttons
  document.getElementById('legoSpeakNormalBtn').addEventListener('click', () => speakCurrentLego(false));
  document.getElementById('legoSpeakSlowBtn').addEventListener('click', () => speakCurrentLego(true));
  document.getElementById('legoMineBtn').addEventListener('click', () => {
    const s = getCurrentLegoSentence();
    minePhrase({ it: s.it, en: s.en, phonetic: s.ph, category: 'Power-Verb Lego' });
  });
  document.getElementById('legoMicPracticeBtn').addEventListener('click', () => {
    const fb = document.getElementById('legoMicFeedback');
    const target = getCurrentLegoSentence().it;
    fb.classList.remove('hidden');
    fb.textContent = '🎙️ Listening in Italian... Say the sentence out loud!';
    listenItalianOnce({
      onInterim: txt => { fb.textContent = `🎙️ Hearing: "${txt}"...`; },
      onFinal: txt => {
        const match = normalizeCompare(txt) === normalizeCompare(target) || normalizeCompare(target).includes(normalizeCompare(txt));
        fb.innerHTML = match
          ? `✅ <strong>Spot-On Pronunciation!</strong> Heard: "${escapeHtml(txt)}"`
          : `🎙️ Heard: "${escapeHtml(txt)}" — Tap 🔊 to compare rhythm and try once more!`;
      }
    });
  });

  // Reflex Events
  document.getElementById('reflexDirectionSelect').addEventListener('change', () => nextReflexCard());
  document.getElementById('reflexTierSelect').addEventListener('change', () => nextReflexCard());
  document.getElementById('unlockAllTiersBtn').addEventListener('click', async () => {
    const nextT = Math.min(8, (App.userState.unlockedTier || 2) + 1);
    await recordProgress({ unlockedTier: nextT });
    nextReflexCard();
    showToast(`🔓 Pareto Tier ${nextT} Unlocked!`);
  });
  document.getElementById('rfRevealBtn').addEventListener('click', () => revealReflexCard());
  document.getElementById('rfReplayPromptAudioBtn').addEventListener('click', () => {
    if (App.currentCard) speakText(App.currentCard.it, { lang: 'it' });
  });
  document.getElementById('rfVoiceAnswerBtn').addEventListener('click', () => {
    const st = document.getElementById('rfMicStatus');
    st.classList.remove('hidden');
    st.textContent = '🎙️ Speak Italian now...';
    listenItalianOnce({
      onInterim: txt => { st.textContent = `🎙️ "${txt}"...`; },
      onFinal: txt => revealReflexCard(txt)
    });
  });
  document.getElementById('rfHearNormalBtn').addEventListener('click', () => {
    if (App.currentCard) speakText(App.currentCard.it.split('/')[0].trim(), { lang: 'it', slow: false });
  });
  document.getElementById('rfHearSlowBtn').addEventListener('click', () => {
    if (App.currentCard) speakText(App.currentCard.it.split('/')[0].trim(), { lang: 'it', slow: true });
  });
  document.getElementById('rfHearExampleBtn').addEventListener('click', () => {
    if (App.currentCard) speakText(App.currentCard.exampleIt || App.currentCard.it, { lang: 'it' });
  });
  document.querySelectorAll('.grade-btn').forEach(btn => {
    btn.addEventListener('click', () => submitReflexRating(Number(btn.dataset.rating)));
  });

  // Keyboard shortcuts for fast desktop Reflex drilling
  window.addEventListener('keydown', e => {
    if (App.activeTab !== 'reflex') return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!App.cardRevealed) revealReflexCard();
    } else if (App.cardRevealed && ['1', '2', '3', '4'].includes(e.key)) {
      submitReflexRating(Number(e.key));
    }
  });

  // Commute / Drive Events
  document.getElementById('driveTopicSelect').addEventListener('change', () => {
    buildCommuteDeck();
    if (App.driveRunning) {
      stopCommuteSession();
      startCommuteSession();
    }
  });
  document.getElementById('driveToggleBtn').addEventListener('click', () => {
    if (App.driveRunning) stopCommuteSession();
    else startCommuteSession();
  });
  document.getElementById('driveRepeatBtn').addEventListener('click', () => {
    const card = App.driveDeck[App.driveIdx % App.driveDeck.length];
    if (card) speakText(card.it.split('/')[0].trim(), { lang: 'it', slow: false });
  });
  document.getElementById('driveSlowBtn').addEventListener('click', () => {
    const card = App.driveDeck[App.driveIdx % App.driveDeck.length];
    if (card) speakText(card.it.split('/')[0].trim(), { lang: 'it', slow: true });
  });
  document.getElementById('driveSkipBtn').addEventListener('click', () => {
    App.driveIdx = (App.driveIdx + 1) % Math.max(1, App.driveDeck.length);
    if (App.driveRunning) {
      stopCommuteSession();
      startCommuteSession();
    }
  });

  // Tutor Events
  document.getElementById('tutorRestartBtn').addEventListener('click', () => {
    initTutorScenario(App.activeScenarioId);
    const first = App.tutorHistory[0];
    if (first) speakText(first.it, { lang: 'it', gender: first.voiceGender });
  });
  document.getElementById('tutorSendBtn').addEventListener('click', () => {
    sendTutorUserTurn(document.getElementById('tutorTextInput').value);
  });
  document.getElementById('tutorTextInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendTutorUserTurn(e.target.value);
  });
  document.getElementById('tutorMicBtn').addEventListener('click', () => {
    const micBtn = document.getElementById('tutorMicBtn');
    const lbl = document.getElementById('tutorMicLabel');
    const inp = document.getElementById('tutorTextInput');
    listenItalianOnce({
      onStateChange: active => {
        micBtn.classList.toggle('listening', active);
        lbl.textContent = active ? 'Listening...' : 'Speak';
      },
      onInterim: txt => { inp.value = txt; },
      onFinal: txt => sendTutorUserTurn(txt)
    });
  });

  // Settings & Mobile HTTPS Link Modal
  const modal = document.getElementById('settingsModal');
  document.getElementById('openSettingsBtn').addEventListener('click', async () => {
    try {
      const tRes = await fetch(apiUrl('api/tunnel')).then(r => r.json());
      document.getElementById('modalTunnelUrl').value = tRes.publicTunnelUrl || tRes.lanUrl || tRes.localUrl || window.location.origin;
      const qrImg = document.getElementById('modalQrImg');
      if (qrImg) qrImg.src = apiUrl(`api/qr?t=${Date.now()}`);
    } catch (_) {
      document.getElementById('modalTunnelUrl').value = window.location.origin;
    }
    const st = App.userState.settings || {};
    document.getElementById('settingVoiceGender').value = st.voiceGender || 'female';
    document.getElementById('settingCommutePause').value = st.commutePauseSec || 3.5;
    document.getElementById('settingShowPhonetics').checked = st.showPhonetics !== false;
    document.getElementById('settingGeminiKey').value = st.geminiApiKey || '';
    document.getElementById('settingOpenaiKey').value = st.openaiApiKey || '';
    modal.classList.remove('hidden');
  });

  document.getElementById('closeSettingsBtn').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('copyTunnelBtn').addEventListener('click', () => {
    const url = document.getElementById('modalTunnelUrl').value;
    navigator.clipboard?.writeText(url);
    showToast('Copied Mobile App URL!');
  });
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const newSettings = {
      voiceGender: document.getElementById('settingVoiceGender').value,
      commutePauseSec: Number(document.getElementById('settingCommutePause').value) || 3.5,
      showPhonetics: document.getElementById('settingShowPhonetics').checked,
      geminiApiKey: document.getElementById('settingGeminiKey').value.trim(),
      openaiApiKey: document.getElementById('settingOpenaiKey').value.trim()
    };
    App.userState.settings = { ...App.userState.settings, ...newSettings };
    await recordProgress({ settings: newSettings });
    renderPhoneticsAndCognates();
    renderStories();
    renderTutor();
    modal.classList.add('hidden');
    showToast('Settings saved!');
  });

  // In-App Kids Mode Switcher & Embedded Launcher
  const kidsOverlay = document.getElementById('kidsModeOverlay');
  const kidsFrame = document.getElementById('kidsEmbeddedFrame');
  const kidsStandaloneLink = document.getElementById('kidsStandaloneLink');

  function openKidsOverlay(editionFolder = 'kids') {
    const folder = ['piccolo', 'junior', 'kids'].includes(editionFolder) ? editionFolder : 'kids';
    kidsOverlay?.querySelectorAll('.kids-ov-ed').forEach(b => {
      b.classList.toggle('active', b.dataset.ovEd === folder);
    });
    if (kidsStandaloneLink) kidsStandaloneLink.href = `${folder}/`;
    if (kidsFrame) kidsFrame.src = `${folder}/?embedded=1`;
    kidsOverlay?.classList.remove('hidden');
  }

  function closeKidsOverlay() {
    kidsOverlay?.classList.add('hidden');
    if (kidsFrame) kidsFrame.src = 'about:blank';
  }

  document.getElementById('openKidsModeBtn')?.addEventListener('click', () => openKidsOverlay('kids'));
  document.getElementById('closeKidsModeBtn')?.addEventListener('click', closeKidsOverlay);
  document.querySelectorAll('.kids-launch-btn').forEach(btn => {
    btn.addEventListener('click', () => openKidsOverlay(btn.dataset.kidsEdition));
  });
  kidsOverlay?.querySelectorAll('.kids-ov-ed').forEach(btn => {
    btn.addEventListener('click', () => openKidsOverlay(btn.dataset.ovEd));
  });
  window.addEventListener('message', e => {
    if (e?.data?.type === 'veloce-close-kids') closeKidsOverlay();
  });
}

document.addEventListener('DOMContentLoaded', bootstrapApp);
