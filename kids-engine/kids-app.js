/**
 * VELOCE Kids — Unified Play-and-Learn Italian Engine
 * Powers PICCOLO (Ages 3-6), BAMBINI (Ages 4-11), AVVENTURA Junior (Ages 7-12),
 * and Embedded Kids Mode inside Adult VELOCE.
 */

const CFG = window.VELOCE_KIDS_CONFIG || {
  defaultEdition: 'adaptive',
  showEditionHero: true,
  appTitle: 'VELOCE Kids'
};

const KApp = {
  apiBase: '../',
  kidId: 'leo',
  edition: CFG.defaultEdition || 'adaptive',
  curriculum: null,
  profile: null,
  leaderboard: [],
  activeTab: 'worlds',

  // Audio / Mic
  audioEl: new Audio(),
  recognition: null,
  storyPlayToken: 0,

  // Worlds State
  activeSceneId: 'zoo',
  worldMode: 'explore', // 'explore' | 'hunt'
  huntTarget: null,

  // Chef State
  chefStation: 'pizza', // 'pizza' | 'gelato'
  chefCustomer: null,
  chefRequired: [], // [{ id, count }]
  chefPlate: [], // [id, id...]
  chefShowVisualHint: true,
  chefScore: 0,
  chefStreak: 0,
  chefTimerMax: 28,
  chefTimerLeft: 28,
  chefTimerId: null,

  // Balloon Pop State
  popCategory: 'all',
  popTarget: null,
  popItems: [],
  popScore: 0,
  popStreak: 0,
  popHearts: 3,
  popTimeLeft: 60,
  popTimerId: null,
  popBlitzActive: false,

  // Leo Mascot State
  leoSnackTarget: null,
  leoSpeechIt: 'Ciao! Giochiamo insieme!',
  leoAnimClass: '',

  // Stories State
  activeStoryId: 'pizza-magica',
  storyShowEnglish: true,
  storyQuizAnswers: {},

  // Modal State
  pickedNewAvatar: '🦁'
};

/* ==================== HELPERS & API ==================== */
function showKidToast(msg) {
  const el = document.getElementById('kidsToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showKidToast._t);
  showKidToast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeSpeech(str = '') {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shuffleArr(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getWordById(id) {
  return KApp.curriculum?.KIDS_WORDS?.find(w => w.id === id) || null;
}

function kUrl(rel) {
  return `${KApp.apiBase}${rel}`;
}

async function resolveKidsApiBase() {
  if (window.location.hostname.endsWith('github.io')) {
    try {
      const cfg = await fetch(`../tunnel_config.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json());
      if (cfg && cfg.veloce_url) return cfg.veloce_url.replace(/\/+$/, '') + '/';
      if (cfg && cfg.api_url) return cfg.api_url.replace(/\/+$/, '') + '/veloce/';
    } catch (_) {}
  }
  return '../';
}

async function kidsPost(endpoint, payload) {
  try {
    const res = await fetch(kUrl(endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kidId: KApp.kidId, ...payload })
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ==================== AUDIO & SPEECH ==================== */
function stopKidsSpeech() {
  try {
    KApp.audioEl.pause();
    KApp.audioEl.currentTime = 0;
  } catch (_) {}
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
}

function browserTtsFallback(text, slow = false) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) return resolve();
    try { window.speechSynthesis.cancel(); } catch (_) {}
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'it-IT';
    utt.rate = slow ? 0.78 : 0.96;
    utt.pitch = 1.08;
    const voices = window.speechSynthesis.getVoices() || [];
    const match = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('it'));
    if (match) utt.voice = match;
    utt.onend = () => resolve();
    utt.onerror = () => resolve();
    window.speechSynthesis.speak(utt);
  });
}

async function speakKidsItalian(text, { gender = 'kid', slow = false } = {}) {
  if (!text) return;
  stopKidsSpeech();
  const slowMode = slow || KApp.edition === 'piccolo';
  const url = kUrl(`api/tts?text=${encodeURIComponent(text)}&lang=it&gender=${gender}&slow=${slowMode ? '1' : '0'}`);

  return new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const safety = setTimeout(done, 7500);
    KApp.audioEl.onended = () => { clearTimeout(safety); done(); };
    KApp.audioEl.onerror = async () => {
      clearTimeout(safety);
      await browserTtsFallback(text, slowMode);
      done();
    };
    KApp.audioEl.src = url;
    const p = KApp.audioEl.play();
    if (p && typeof p.catch === 'function') {
      p.catch(async () => {
        clearTimeout(safety);
        await browserTtsFallback(text, slowMode);
        done();
      });
    }
  });
}

function listenKidsItalian({ onInterim, onFinal, onStateChange }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showKidToast('Voice Mic needs Safari/Chrome HTTPS — tap any Spell card below!');
    if (onStateChange) onStateChange(false);
    return;
  }
  if (KApp.recognition) {
    try { KApp.recognition.abort(); } catch (_) {}
    KApp.recognition = null;
  }
  stopKidsSpeech();
  const rec = new SR();
  rec.lang = 'it-IT';
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  KApp.recognition = rec;

  let finalText = '';
  if (onStateChange) onStateChange(true);

  rec.onresult = evt => {
    let interim = '';
    for (let i = evt.resultIndex; i < evt.results.length; i++) {
      const tr = evt.results[i][0].transcript;
      if (evt.results[i].isFinal) finalText += tr + ' ';
      else interim += tr;
    }
    if (onInterim) onInterim((finalText + interim).trim());
  };
  rec.onend = () => {
    KApp.recognition = null;
    if (onStateChange) onStateChange(false);
    if (finalText.trim() && onFinal) onFinal(finalText.trim());
  };
  rec.onerror = () => {
    KApp.recognition = null;
    if (onStateChange) onStateChange(false);
  };
  rec.start();
}

async function awardKidProgress(payload) {
  const res = await kidsPost('api/kids/reward', payload);
  if (res && res.ok && res.kidProfile) {
    KApp.profile = res.kidProfile;
    if (Array.isArray(res.leaderboard)) KApp.leaderboard = res.leaderboard;
    renderTopHud();
  }
  return res;
}

/* ==================== EDITION & TAB SWITCHING ==================== */
function applyEditionTheme(edition) {
  KApp.edition = ['piccolo', 'junior', 'adaptive'].includes(edition) ? edition : 'adaptive';
  document.body.setAttribute('data-edition', KApp.edition);
  document.querySelectorAll('.edition-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.edition === KApp.edition);
  });
}

async function changeEdition(nextEdition) {
  applyEditionTheme(nextEdition);
  const res = await kidsPost('api/kids/profile', { kidId: KApp.kidId, ageEdition: nextEdition });
  if (res && res.ok && res.kidProfile) {
    KApp.profile = res.kidProfile;
    if (res.leaderboard) KApp.leaderboard = res.leaderboard;
  }
  if (KApp.activeTab === 'chef') startNewChefOrder(false);
  if (KApp.activeTab === 'pop') startNewPopRound(false);
  renderAllViews();
  const labelMap = {
    piccolo: '🐣 Piccolo Mode (Ages 3–6)',
    adaptive: '🌈 Multi-Age Mode (Ages 4–11)',
    junior: '⚡ Avventura Arcade (Ages 7–12)'
  };
  showKidToast(labelMap[nextEdition] || nextEdition);
}

function switchKidsTab(tabId) {
  KApp.storyPlayToken++;
  clearInterval(KApp.popTimerId);
  clearInterval(KApp.chefTimerId);
  KApp.activeTab = tabId;

  document.querySelectorAll('.game-view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`kview-${tabId}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.mode-tab, .kbnav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });

  if (tabId === 'chef' && !KApp.chefCustomer) startNewChefOrder(true);
  if (tabId === 'pop' && !KApp.popTarget) startNewPopRound(true);
  if (tabId === 'leo' && !KApp.leoSnackTarget) pickNextLeoSnack();
  if (tabId === 'album') renderAlbumAndLeaderboard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ==================== SHELL & HUD RENDERING ==================== */
function renderShell() {
  const root = document.getElementById('kidsAppRoot');
  const params = new URLSearchParams(window.location.search);
  const isEmbedded = params.get('embedded') === '1' || window.self !== window.top;

  root.innerHTML = `
    <div class="kids-tricolore"><span></span><span></span><span></span></div>
    <header class="kids-header">
      <div class="hud-left">
        <button class="avatar-chip" id="openKidProfileBtn" title="Switch Kid Profile">
          <span class="avatar-emoji" id="hudAvatarEmoji">🦁</span>
          <span id="hudKidName">Leo</span>
        </button>
        <div class="edition-pill-group" title="Switch Age Difficulty">
          <button class="edition-btn" data-edition="piccolo">🐣 3–6</button>
          <button class="edition-btn" data-edition="adaptive">🌈 4–11</button>
          <button class="edition-btn" data-edition="junior">⚡ 7–12</button>
        </div>
      </div>

      <div class="hud-stats">
        <div class="hud-pill coins" title="Coins">🪙 <span id="hudCoins">60</span></div>
        <div class="hud-pill stars" title="Stars">⭐ <span id="hudStars">3</span></div>
        ${isEmbedded
          ? `<button class="btn-back-adult" id="backAdultBtn">← Adult VELOCE</button>`
          : `<a class="btn-back-adult" href="../">Adult App</a>`
        }
      </div>
    </header>

    <nav class="desktop-tabs">
      <button class="mode-tab active" data-tab="worlds">🗺️ Worlds</button>
      <button class="mode-tab" data-tab="chef">🍕 Chef</button>
      <button class="mode-tab" data-tab="pop">🎈 Pop!</button>
      <button class="mode-tab" data-tab="leo">🦁 Leo Pet</button>
      <button class="mode-tab" data-tab="stories">🎬 Stories &amp; SFX</button>
      <button class="mode-tab" data-tab="album">🏆 Stickers</button>
    </nav>

    <main class="kids-main">
      <section class="game-view active" id="kview-worlds"></section>
      <section class="game-view" id="kview-chef"></section>
      <section class="game-view" id="kview-pop"></section>
      <section class="game-view" id="kview-leo"></section>
      <section class="game-view" id="kview-stories"></section>
      <section class="game-view" id="kview-album"></section>
    </main>

    <nav class="kids-bottom-nav">
      <button class="kbnav-btn active" data-tab="worlds"><span class="kbnav-icon">🗺️</span><span>Worlds</span></button>
      <button class="kbnav-btn" data-tab="chef"><span class="kbnav-icon">🍕</span><span>Chef</span></button>
      <button class="kbnav-btn" data-tab="pop"><span class="kbnav-icon">🎈</span><span>Pop</span></button>
      <button class="kbnav-btn" data-tab="leo"><span class="kbnav-icon">🦁</span><span>Leo</span></button>
      <button class="kbnav-btn" data-tab="stories"><span class="kbnav-icon">🎬</span><span>Stories</span></button>
      <button class="kbnav-btn" data-tab="album"><span class="kbnav-icon">🏆</span><span>Prizes</span></button>
    </nav>

    <!-- Kid Profile Switcher / Creator Modal -->
    <div class="kmodal-backdrop hidden" id="kidProfileModal">
      <div class="kmodal-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h2 style="margin:0;">👋 Choose Kid Player</h2>
          <button class="kbtn kbtn-soft" id="closeProfileModalBtn" style="padding:0.4rem 0.75rem;">✕</button>
        </div>
        <div id="existingProfilesList" style="margin:0.85rem 0;"></div>
        <hr style="border:none;border-top:2px solid var(--border);margin:0.85rem 0;" />
        <h3 style="margin:0 0 0.45rem;">✨ Or Create a New Kid Profile</h3>
        <input type="text" id="newKidNameInput" placeholder="Kid's First Name (e.g. Marco)" style="width:100%;padding:0.65rem 0.85rem;border-radius:14px;border:2px solid var(--border);font-size:1rem;" />
        <div class="avatar-picker-grid" id="newAvatarPicker"></div>
        <button class="kbtn kbtn-primary" id="createKidProfileBtn" style="width:100%;">🚀 Start Playing!</button>
      </div>
    </div>

    <div class="kids-toast hidden" id="kidsToast"></div>
  `;

  // Wire top / bottom tabs & edition pills
  root.querySelectorAll('.mode-tab, .kbnav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.KidsSFX?.unlock();
      switchKidsTab(btn.dataset.tab);
    });
  });

  root.querySelectorAll('.edition-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.KidsSFX?.pop();
      changeEdition(btn.dataset.edition);
    });
  });

  document.getElementById('openKidProfileBtn').addEventListener('click', openKidProfileModal);
  document.getElementById('closeProfileModalBtn').addEventListener('click', () => {
    document.getElementById('kidProfileModal').classList.add('hidden');
  });
  document.getElementById('createKidProfileBtn').addEventListener('click', createOrSwitchCustomKid);

  const backAdultBtn = document.getElementById('backAdultBtn');
  if (backAdultBtn) {
    backAdultBtn.addEventListener('click', () => {
      try {
        window.parent.postMessage({ type: 'veloce-close-kids' }, '*');
      } catch (_) {
        window.location.href = '../';
      }
    });
  }
}

function renderTopHud() {
  if (!KApp.profile) return;
  document.getElementById('hudAvatarEmoji').textContent = KApp.profile.avatar || '🦁';
  document.getElementById('hudKidName').textContent = KApp.profile.name || 'Leo';
  document.getElementById('hudCoins').textContent = KApp.profile.coins ?? 0;
  document.getElementById('hudStars').textContent = KApp.profile.stars ?? 0;
}

/* ==================== TAB 1: WORLDS & STICKER TREASURE HUNT ==================== */
function renderWorldsView() {
  const host = document.getElementById('kview-worlds');
  if (!KApp.curriculum || !KApp.profile) return;
  const { WORLD_SCENES } = KApp.curriculum;
  const scene = WORLD_SCENES.find(s => s.id === KApp.activeSceneId) || WORLD_SCENES[0];
  const unlocked = new Set(KApp.profile.unlockedStickers || []);
  const xpInLevel = (KApp.profile.xp || 0) % 120;
  const xpPct = Math.max(8, Math.round((xpInLevel / 120) * 100));

  const edCopy = {
    piccolo: { title: `Ciao ${escapeHtml(KApp.profile.name)}! Tap to Hear Italian!`, sub: 'No reading needed — tap big pictures, collect stickers & play!' },
    adaptive: { title: `Ciao ${escapeHtml(KApp.profile.name)}! Play & Speak Italian!`, sub: 'Pick an age mode anytime or explore all 5 worlds & games!' },
    junior: { title: `Avventura Quest — ${escapeHtml(KApp.profile.name)}!`, sub: 'Crack Italian riddles, beat rush orders & climb the Family Leaderboard!' }
  }[KApp.edition];

  host.innerHTML = `
    <div class="play-card hero-banner">
      <div style="flex:1;min-width:240px;">
        <h1>${KApp.profile.avatar || '🦁'} ${edCopy.title}</h1>
        <p>${edCopy.sub}</p>
        ${KApp.edition !== 'piccolo' ? `
          <div class="junior-rank-bar">
            <span style="font-weight:800;white-space:nowrap;">⚡ Lv ${KApp.profile.level || 1} • ${escapeHtml(KApp.profile.rankTitle || 'Esploratore')}</span>
            <div class="xp-track"><div class="xp-fill" style="width:${xpPct}%"></div></div>
            <span style="font-size:0.82rem;font-weight:800;white-space:nowrap;">${KApp.profile.xp || 0} XP</span>
          </div>
        ` : ''}
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <button class="kbtn kbtn-soft" id="heroQuickChefBtn" style="background:rgba(255,255,255,0.92);color:#1e293b;">🍕 Make Pizza!</button>
        <button class="kbtn kbtn-soft" id="heroQuickPopBtn" style="background:rgba(255,255,255,0.92);color:#1e293b;">🎈 Balloon Pop!</button>
      </div>
    </div>

    ${(CFG.showEditionHero || KApp.edition === 'adaptive') ? `
      <div class="edition-hub-grid">
        <button class="edition-pick-card ${KApp.edition === 'piccolo' ? 'active' : ''}" data-pick-ed="piccolo">
          <span class="edition-pick-icon">🐣</span>
          <div>
            <div class="edition-pick-title">Piccolo (Ages 3–6)</div>
            <div class="edition-pick-sub">Zero reading, giant pictures, gentle voice play</div>
          </div>
        </button>
        <button class="edition-pick-card ${KApp.edition === 'adaptive' ? 'active' : ''}" data-pick-ed="adaptive">
          <span class="edition-pick-icon">🌈</span>
          <div>
            <div class="edition-pick-title">Bambini Hub (Ages 4–11)</div>
            <div class="edition-pick-sub">Balanced bilingual words, games &amp; sticker quest</div>
          </div>
        </button>
        <button class="edition-pick-card ${KApp.edition === 'junior' ? 'active' : ''}" data-pick-ed="junior">
          <span class="edition-pick-icon">⚡</span>
          <div>
            <div class="edition-pick-title">Avventura Junior (Ages 7–12)</div>
            <div class="edition-pick-sub">Timed blitz, Italian riddles, phrases &amp; leaderboard</div>
          </div>
        </button>
      </div>
    ` : ''}

    <div class="scene-pills">
      ${WORLD_SCENES.map(s => `
        <button class="scene-pill ${s.id === scene.id ? 'active' : ''}" data-scene="${s.id}">
          ${s.emoji} ${escapeHtml(s.titleIt)}
        </button>
      `).join('')}
    </div>

    <div class="world-stage" style="background:${scene.bgGradient};">
      <div class="world-stage-head">
        <div>
          <strong style="font-family:'Fredoka',sans-serif;font-size:1.15rem;">${scene.emoji} ${escapeHtml(scene.titleIt)}</strong>
          ${KApp.edition !== 'piccolo' ? `<span style="margin-left:0.45rem;font-size:0.85rem;color:#64748b;">(${escapeHtml(scene.titleEn)})</span>` : ''}
        </div>
        <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
          <button class="kbtn ${KApp.worldMode === 'explore' ? 'kbtn-blue' : 'kbtn-soft'}" id="wModeExploreBtn" style="padding:0.45rem 0.85rem;font-size:0.9rem;">👆 Tap &amp; Hear</button>
          <button class="kbtn ${KApp.worldMode === 'hunt' ? 'kbtn-primary' : 'kbtn-soft'}" id="wModeHuntBtn" style="padding:0.45rem 0.85rem;font-size:0.9rem;">🕵️ Treasure Hunt!</button>
        </div>
      </div>

      ${KApp.worldMode === 'hunt' && KApp.huntTarget ? `
        <div class="hunt-banner">
          <div>
            <div style="font-size:0.78rem;font-weight:800;text-transform:uppercase;">🔍 Caccia al Tesoro! Find This One:</div>
            <div style="font-family:'Fredoka',sans-serif;font-size:1.22rem;font-weight:700;">
              ${KApp.edition === 'junior'
                ? escapeHtml(KApp.huntTarget.riddleIt)
                : `Dov'è "${escapeHtml(KApp.huntTarget.it)}"?`
              }
            </div>
            ${KApp.edition === 'adaptive' ? `<div style="font-size:0.85rem;opacity:0.85;">${escapeHtml(KApp.huntTarget.riddleEn)}</div>` : ''}
          </div>
          <button class="kbtn kbtn-primary" id="replayHuntClueBtn" style="padding:0.5rem 0.9rem;">🔊 Hear Clue</button>
        </div>
      ` : ''}

      <div class="world-items-grid">
        ${scene.items.map(itemId => {
          const w = getWordById(itemId);
          if (!w) return '';
          const hasSticker = unlocked.has(w.id);
          return `
            <button class="world-tile" data-word-id="${w.id}">
              <span class="sticker-star-badge">${hasSticker ? '⭐' : ''}</span>
              <span class="world-tile-emoji">${w.emoji}</span>
              <span class="world-tile-it">${escapeHtml(w.it)}</span>
              <span class="world-tile-en">${escapeHtml(w.en)}</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;

  host.querySelector('#heroQuickChefBtn')?.addEventListener('click', () => switchKidsTab('chef'));
  host.querySelector('#heroQuickPopBtn')?.addEventListener('click', () => switchKidsTab('pop'));
  host.querySelectorAll('[data-pick-ed]').forEach(b => {
    b.addEventListener('click', () => {
      window.KidsSFX?.pop();
      changeEdition(b.dataset.pickEd);
    });
  });

  host.querySelectorAll('.scene-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      window.KidsSFX?.pop();
      KApp.activeSceneId = btn.dataset.scene;
      if (KApp.worldMode === 'hunt') pickHuntTarget();
      renderWorldsView();
    });
  });

  host.querySelector('#wModeExploreBtn').addEventListener('click', () => {
    KApp.worldMode = 'explore';
    renderWorldsView();
  });
  host.querySelector('#wModeHuntBtn').addEventListener('click', () => {
    KApp.worldMode = 'hunt';
    pickHuntTarget(true);
    renderWorldsView();
  });
  host.querySelector('#replayHuntClueBtn')?.addEventListener('click', () => {
    if (!KApp.huntTarget) return;
    const clue = KApp.edition === 'junior' ? KApp.huntTarget.riddleIt : `Dov'è ${KApp.huntTarget.it}?`;
    speakKidsItalian(clue, { gender: 'kid' });
  });

  host.querySelectorAll('.world-tile').forEach(tile => {
    tile.addEventListener('click', () => handleWorldTileTap(tile, tile.dataset.wordId));
  });
}

function pickHuntTarget(speakNow = false) {
  const scene = KApp.curriculum.WORLD_SCENES.find(s => s.id === KApp.activeSceneId) || KApp.curriculum.WORLD_SCENES[0];
  const randomId = scene.items[Math.floor(Math.random() * scene.items.length)];
  KApp.huntTarget = getWordById(randomId);
  if (speakNow && KApp.huntTarget) {
    const clue = KApp.edition === 'junior' ? KApp.huntTarget.riddleIt : `Dov'è ${KApp.huntTarget.it}?`;
    speakKidsItalian(clue, { gender: 'kid' });
  }
}

async function handleWorldTileTap(tileEl, wordId) {
  const w = getWordById(wordId);
  if (!w) return;
  tileEl.classList.remove('bouncing');
  void tileEl.offsetWidth;
  tileEl.classList.add('bouncing');

  if (KApp.worldMode === 'hunt' && KApp.huntTarget) {
    if (w.id === KApp.huntTarget.id) {
      window.KidsSFX?.fanfare();
      window.launchKidsConfetti?.(24);
      const res = await awardKidProgress({
        coinsDelta: KApp.edition === 'junior' ? 15 : 10,
        xpDelta: 22,
        starsDelta: 1,
        stickerId: w.id
      });
      await speakKidsItalian(`Bravissimo! È ${w.it}!`, { gender: 'kid' });
      showKidToast(res?.unlockedNewSticker ? `✨ New Sticker: ${w.emoji} ${w.it}!` : `⭐ Trovato! +10 Coins!`);
      pickHuntTarget(true);
      renderWorldsView();
    } else {
      window.KidsSFX?.gentleNudge();
      await speakKidsItalian(`Questo è ${w.it}. Cerchiamo ${KApp.huntTarget.it}!`, { gender: 'kid' });
    }
    return;
  }

  // Explore mode: SFX + speak + unlock sticker
  window.KidsSFX?.playByName(w.sfx);
  speakKidsItalian(w.it, { gender: 'kid' });
  const isNew = !(KApp.profile.unlockedStickers || []).includes(w.id);
  const res = await awardKidProgress({
    coinsDelta: isNew ? 8 : 2,
    xpDelta: isNew ? 15 : 4,
    stickerId: w.id
  });
  if (res?.unlockedNewSticker) {
    window.launchKidsConfetti?.(16);
    showKidToast(`🌟 Sticker Unlocked: ${w.emoji} ${w.it}!`);
    renderWorldsView();
  }
}

/* ==================== MODE 1: PIZZERIA & GELATERIA CHEF ==================== */
function startNewChefOrder(speakOrder = true) {
  clearInterval(KApp.chefTimerId);
  const { CHEF_CUSTOMERS, CHEF_INGREDIENTS } = KApp.curriculum;
  const cust = CHEF_CUSTOMERS[Math.floor(Math.random() * CHEF_CUSTOMERS.length)];
  const pool = KApp.chefStation === 'pizza' ? CHEF_INGREDIENTS.pizza : CHEF_INGREDIENTS.gelato;

  const countWanted = KApp.edition === 'piccolo' ? (Math.random() < 0.55 ? 1 : 2) : (KApp.edition === 'junior' ? 3 : 2);
  const picked = shuffleArr(pool).slice(0, countWanted);

  KApp.chefCustomer = cust;
  KApp.chefRequired = picked.map(item => ({ id: item.id, count: 1 }));
  KApp.chefPlate = [];
  KApp.chefShowVisualHint = KApp.edition !== 'junior';

  if (KApp.edition === 'junior') {
    KApp.chefTimerMax = 28;
    KApp.chefTimerLeft = 28;
    KApp.chefTimerId = setInterval(() => {
      if (KApp.activeTab !== 'chef') return;
      KApp.chefTimerLeft = Math.max(0, KApp.chefTimerLeft - 1);
      const fill = document.getElementById('chefPatienceFill');
      if (fill) fill.style.width = `${Math.round((KApp.chefTimerLeft / KApp.chefTimerMax) * 100)}%`;
      if (KApp.chefTimerLeft === 0) {
        clearInterval(KApp.chefTimerId);
        KApp.chefStreak = 0;
        showKidToast('⏰ Time up! New friendly customer!');
        startNewChefOrder(true);
      }
    }, 1000);
  }

  renderChefView();
  if (speakOrder) speakChefOrder();
}

function buildChefOrderSentence() {
  const { CHEF_INGREDIENTS } = KApp.curriculum;
  const pool = KApp.chefStation === 'pizza' ? CHEF_INGREDIENTS.pizza : CHEF_INGREDIENTS.gelato;
  const names = KApp.chefRequired.map(r => pool.find(i => i.id === r.id)?.it).filter(Boolean);
  const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : names[0];

  if (KApp.chefStation === 'pizza') {
    return KApp.edition === 'junior'
      ? `Buongiorno Chef! Vorrei una pizza con ${joined}, per favore!`
      : `Vorrei una pizza con ${joined}!`;
  }
  return KApp.edition === 'junior'
    ? `Ciao! Vorrei un gelato con ${joined}, per favore!`
    : `Vorrei un gelato alla ${joined}!`;
}

function speakChefOrder() {
  if (!KApp.chefCustomer) return;
  const line = buildChefOrderSentence();
  speakKidsItalian(line, { gender: KApp.chefCustomer.voiceGender || 'kid' });
}

function renderChefView() {
  const host = document.getElementById('kview-chef');
  if (!KApp.curriculum || !KApp.chefCustomer) return;
  const { CHEF_INGREDIENTS } = KApp.curriculum;
  const pool = KApp.chefStation === 'pizza' ? CHEF_INGREDIENTS.pizza : CHEF_INGREDIENTS.gelato;

  const isPizza = KApp.chefStation === 'pizza';
  const orderText = buildChefOrderSentence();

  const plateCounts = {};
  for (const id of KApp.chefPlate) plateCounts[id] = (plateCounts[id] || 0) + 1;

  host.innerHTML = `
    <div class="play-card">
      <div class="chef-header-row">
        <div class="chef-station-switch">
          <button class="station-btn ${isPizza ? 'active' : ''}" id="stPizzaBtn">🍕 Pizzeria</button>
          <button class="station-btn ${!isPizza ? 'active' : ''}" id="stGelatoBtn">🍨 Gelateria</button>
        </div>
        <div style="display:flex;gap:0.55rem;align-items:center;font-weight:800;">
          <span>🍽️ Served: ${KApp.profile?.ordersServed || 0}</span>
          ${KApp.chefStreak > 1 ? `<span style="background:#fef08a;color:#854d0e;padding:0.2rem 0.6rem;border-radius:999px;">🔥 ${KApp.chefStreak}x!</span>` : ''}
        </div>
      </div>

      <div class="chef-customer-bar">
        <div class="customer-avatar">${KApp.chefCustomer.emoji}</div>
        <div class="customer-bubble">
          <div class="customer-name">${escapeHtml(KApp.chefCustomer.name)}</div>
          <div class="customer-order-it">"${escapeHtml(orderText)}"</div>
          <div class="customer-visual-icons">
            ${(KApp.chefShowVisualHint || KApp.edition !== 'junior') ? KApp.chefRequired.map(req => {
              const item = pool.find(i => i.id === req.id);
              const done = (plateCounts[req.id] || 0) >= req.count;
              return item ? `<span class="order-chip-icon ${done ? 'fulfilled' : ''}">${item.emoji} ${KApp.edition !== 'piccolo' ? escapeHtml(item.it) : ''} ${done ? '✓' : ''}</span>` : '';
            }).join('') : `<button class="kbtn kbtn-soft" id="revealChefHintBtn" style="padding:0.35rem 0.7rem;font-size:0.82rem;">👀 Peek Pictures</button>`}
          </div>
          ${KApp.edition === 'junior' ? `
            <div class="patience-track"><div class="patience-fill" id="chefPatienceFill" style="width:${Math.round((KApp.chefTimerLeft / KApp.chefTimerMax) * 100)}%"></div></div>
          ` : ''}
        </div>
        <button class="kbtn kbtn-blue" id="chefHearOrderBtn" style="padding:0.65rem 0.85rem;">🔊</button>
      </div>

      <div class="chef-workbench">
        <div class="plate-stage">
          ${isPizza ? `
            <div class="pizza-crust" id="pizzaCrustEl">
              ${KApp.chefPlate.length === 0 ? `<span style="color:#92400e;font-weight:800;font-size:0.85rem;text-align:center;">Tap toppings!</span>` : ''}
              ${KApp.chefPlate.map(id => {
                const itm = pool.find(i => i.id === id);
                return itm ? `<span class="pizza-topping-dot" title="${escapeHtml(itm.it)}">${itm.emoji}</span>` : '';
              }).join('')}
            </div>
          ` : `
            <div class="gelato-cone-wrap">
              <div class="gelato-scoops">
                ${KApp.chefPlate.map(id => {
                  const itm = pool.find(i => i.id === id);
                  return itm ? `<div class="gelato-scoop" style="background:${itm.color};">${itm.emoji}</div>` : '';
                }).join('')}
              </div>
              <div class="waffle-cone"></div>
            </div>
          `}

          <div style="display:flex;gap:0.6rem;margin-top:1rem;flex-wrap:wrap;justify-content:center;">
            <button class="kbtn kbtn-soft" id="chefClearPlateBtn">🗑️ Clear</button>
            <button class="kbtn kbtn-green" id="chefServeBtn">${isPizza ? '🔥 Bake &amp; Serve!' : '🍨 Serve Gelato!'}</button>
          </div>
        </div>

        <div class="ingredients-grid">
          ${pool.map(item => `
            <button class="ing-btn" data-ing-id="${item.id}">
              <span class="ing-emoji">${item.emoji}</span>
              <span class="ing-it">${escapeHtml(item.it)}</span>
              <span class="ing-en">${escapeHtml(item.en)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  host.querySelector('#stPizzaBtn').addEventListener('click', () => {
    KApp.chefStation = 'pizza';
    window.KidsSFX?.pop();
    startNewChefOrder(true);
  });
  host.querySelector('#stGelatoBtn').addEventListener('click', () => {
    KApp.chefStation = 'gelato';
    window.KidsSFX?.pop();
    startNewChefOrder(true);
  });
  host.querySelector('#chefHearOrderBtn').addEventListener('click', speakChefOrder);
  host.querySelector('#revealChefHintBtn')?.addEventListener('click', () => {
    KApp.chefShowVisualHint = true;
    renderChefView();
  });
  host.querySelector('#chefClearPlateBtn').addEventListener('click', () => {
    KApp.chefPlate = [];
    window.KidsSFX?.pop();
    renderChefView();
  });
  host.querySelectorAll('.ing-btn').forEach(btn => {
    btn.addEventListener('click', () => handleChefIngredientTap(btn.dataset.ingId));
  });
  host.querySelector('#chefServeBtn').addEventListener('click', handleChefServe);
}

function handleChefIngredientTap(ingId) {
  const { CHEF_INGREDIENTS } = KApp.curriculum;
  const pool = KApp.chefStation === 'pizza' ? CHEF_INGREDIENTS.pizza : CHEF_INGREDIENTS.gelato;
  const item = pool.find(i => i.id === ingId);
  if (!item) return;

  window.KidsSFX?.pop();
  speakKidsItalian(item.it, { gender: 'kid' });

  const reqIds = KApp.chefRequired.map(r => r.id);
  if (KApp.edition === 'piccolo' && !reqIds.includes(ingId)) {
    window.KidsSFX?.gentleNudge();
    showKidToast(`${item.emoji} ${item.it}! Look at the customer's icons!`);
    return;
  }
  if (KApp.chefPlate.length < 7) {
    KApp.chefPlate.push(ingId);
    renderChefView();
  }
}

async function handleChefServe() {
  const reqIds = KApp.chefRequired.map(r => r.id);
  const hasAll = reqIds.every(id => KApp.chefPlate.includes(id));
  const noWrong = KApp.chefPlate.every(id => reqIds.includes(id));

  if (!hasAll) {
    window.KidsSFX?.gentleNudge();
    const { CHEF_INGREDIENTS } = KApp.curriculum;
    const pool = KApp.chefStation === 'pizza' ? CHEF_INGREDIENTS.pizza : CHEF_INGREDIENTS.gelato;
    const missing = pool.find(i => reqIds.find(r => r === i.id && !KApp.chefPlate.includes(r)));
    showKidToast(`Add ${missing ? missing.emoji + ' ' + missing.it : 'the toppings'} first!`);
    if (missing) speakKidsItalian(`Manca ${missing.it}!`, { gender: 'kid' });
    return;
  }

  if (KApp.edition === 'junior' && !noWrong) {
    window.KidsSFX?.gentleNudge();
    KApp.chefStreak = 0;
    showKidToast('Oops, extra topping! Tap Clear & try just what they asked!');
    return;
  }

  // Success!
  clearInterval(KApp.chefTimerId);
  const crust = document.getElementById('pizzaCrustEl');
  if (crust) crust.classList.add('baking');
  window.KidsSFX?.playByName(KApp.chefStation === 'pizza' ? 'sizzle' : 'sparkle');
  setTimeout(() => window.KidsSFX?.coin(), 260);
  window.launchKidsConfetti?.(30);

  KApp.chefStreak += 1;
  const gainedCoins = KApp.edition === 'junior' ? 15 + Math.min(15, KApp.chefStreak * 3) : 12;
  KApp.chefScore += gainedCoins;

  await awardKidProgress({
    coinsDelta: gainedCoins,
    xpDelta: 25,
    starsDelta: KApp.chefStreak % 2 === 1 ? 1 : 0,
    ordersDelta: 1,
    gameKey: 'chef',
    score: KApp.chefScore
  });

  await speakKidsItalian('Mamma mia! Che buono! Grazie chef!', { gender: KApp.chefCustomer?.voiceGender || 'female' });
  showKidToast(`🎉 Order Served! +${gainedCoins} Coins!`);
  startNewChefOrder(true);
}

/* ==================== MODE 2: BALLOON & BUBBLE POP ARCADE ==================== */
function getPopPool() {
  const { KIDS_WORDS, KIDS_PHRASES } = KApp.curriculum;
  let pool = [];
  if (KApp.popCategory === 'phrases') {
    pool = KIDS_PHRASES;
  } else if (KApp.popCategory === 'all') {
    pool = KApp.edition === 'junior' ? [...KIDS_WORDS, ...KIDS_PHRASES] : KIDS_WORDS;
  } else {
    pool = KIDS_WORDS.filter(w => w.cat === KApp.popCategory);
  }
  return pool.length >= 4 ? pool : KIDS_WORDS;
}

function startNewPopRound(speakTarget = true) {
  const pool = getPopPool();
  const numBalloons = KApp.edition === 'piccolo' ? 4 : (KApp.edition === 'junior' ? 8 : 6);
  const choices = shuffleArr(pool).slice(0, Math.min(numBalloons, pool.length));
  const target = choices[Math.floor(Math.random() * choices.length)];
  const palette = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff924c', '#ec4899', '#06b6d4'];

  KApp.popTarget = target;
  KApp.popItems = choices.map((c, idx) => ({
    ...c,
    balloonColor: palette[idx % palette.length],
    delay: (idx * 0.28).toFixed(2)
  }));

  if (KApp.edition === 'junior' && !KApp.popTimerId && KApp.popBlitzActive) {
    startPopBlitzTimer();
  }

  renderPopView();
  if (speakTarget && target) speakKidsItalian(target.it, { gender: 'kid' });
}

function startPopBlitzTimer() {
  clearInterval(KApp.popTimerId);
  KApp.popHearts = 3;
  KApp.popTimeLeft = 60;
  KApp.popScore = 0;
  KApp.popStreak = 0;
  KApp.popBlitzActive = true;
  KApp.popTimerId = setInterval(async () => {
    if (KApp.activeTab !== 'pop') return;
    KApp.popTimeLeft = Math.max(0, KApp.popTimeLeft - 1);
    const el = document.getElementById('popTimerVal');
    if (el) el.textContent = `${KApp.popTimeLeft}s`;
    if (KApp.popTimeLeft === 0) {
      clearInterval(KApp.popTimerId);
      KApp.popTimerId = null;
      KApp.popBlitzActive = false;
      window.KidsSFX?.fanfare();
      window.launchKidsConfetti?.(36);
      await awardKidProgress({ coinsDelta: Math.max(10, Math.round(KApp.popScore / 5)), xpDelta: 35, starsDelta: 1, gameKey: 'pop', score: KApp.popScore });
      showKidToast(`🏁 Blitz Complete! Score: ${KApp.popScore}!`);
      renderPopView();
    }
  }, 1000);
}

function renderPopView() {
  const host = document.getElementById('kview-pop');
  if (!KApp.curriculum || !KApp.popTarget) return;

  const cats = [
    { id: 'all', label: '🌟 Tutti' },
    { id: 'animals', label: '🦁 Animali' },
    { id: 'colors', label: '🎨 Colori' },
    { id: 'numbers', label: '🔢 Numeri' },
    { id: 'food', label: '🍕 Cibo' },
    ...(KApp.edition !== 'piccolo' ? [{ id: 'phrases', label: '💬 Frasi' }] : [])
  ];

  host.innerHTML = `
    <div class="play-card">
      <div class="pop-hud-bar">
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
          ${cats.map(c => `
            <button class="kbtn ${KApp.popCategory === c.id ? 'kbtn-primary' : 'kbtn-soft'}" data-pop-cat="${c.id}" style="padding:0.42rem 0.78rem;font-size:0.86rem;">
              ${c.label}
            </button>
          `).join('')}
        </div>
        <div style="display:flex;gap:0.65rem;align-items:center;font-weight:800;">
          <span>🏆 Best: ${KApp.profile?.highScores?.pop || 0}</span>
          ${KApp.edition === 'junior' ? `
            <span>${'❤️'.repeat(Math.max(0, KApp.popHearts))}${'🤍'.repeat(Math.max(0, 3 - KApp.popHearts))}</span>
            <span>⏱️ <span id="popTimerVal">${KApp.popTimeLeft}s</span></span>
            <button class="kbtn kbtn-green" id="popBlitzStartBtn" style="padding:0.38rem 0.75rem;font-size:0.84rem;">${KApp.popBlitzActive ? 'Restart Blitz' : '⚡ 60s Blitz!'}</button>
          ` : ''}
        </div>
      </div>

      <div class="pop-prompt-box">
        <div>
          <div style="font-size:0.8rem;font-weight:800;opacity:0.9;">🎈 POP THIS ONE IN ITALIAN!</div>
          <div class="pop-target-word">${escapeHtml(KApp.popTarget.it)}</div>
          ${KApp.edition === 'adaptive' ? `<div style="font-size:0.86rem;opacity:0.9;">${escapeHtml(KApp.popTarget.phonetic || '')}</div>` : ''}
        </div>
        <button class="kbtn" id="popReplayAudioBtn" style="background:#fff;color:#0284c7;padding:0.65rem 1rem;">🔊 Hear Again</button>
      </div>

      <div class="balloon-arena">
        ${KApp.popItems.map(item => `
          <button class="balloon-btn" data-pop-id="${item.id}" style="--b-color:${item.balloonColor};animation-delay:${item.delay}s;">
            <span class="balloon-emoji">${item.emoji}</span>
            <span class="balloon-label">${escapeHtml(item.it)}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  host.querySelectorAll('[data-pop-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      KApp.popCategory = btn.dataset.popCat;
      window.KidsSFX?.pop();
      startNewPopRound(true);
    });
  });
  host.querySelector('#popReplayAudioBtn').addEventListener('click', () => {
    if (KApp.popTarget) speakKidsItalian(KApp.popTarget.it, { gender: 'kid' });
  });
  host.querySelector('#popBlitzStartBtn')?.addEventListener('click', () => {
    startPopBlitzTimer();
    startNewPopRound(true);
  });
  host.querySelectorAll('.balloon-btn').forEach(btn => {
    btn.addEventListener('click', () => handleBalloonTap(btn, btn.dataset.popId));
  });
}

async function handleBalloonTap(btnEl, itemId) {
  const item = KApp.popItems.find(i => i.id === itemId);
  if (!item || !KApp.popTarget) return;

  if (item.id === KApp.popTarget.id) {
    btnEl.classList.add('popped');
    window.KidsSFX?.pop();
    window.KidsSFX?.coin();
    window.launchKidsConfetti?.(20);
    KApp.popStreak += 1;
    const mult = Math.min(5, 1 + Math.floor(KApp.popStreak / 3));
    const pts = 10 * mult;
    KApp.popScore += pts;

    await awardKidProgress({
      coinsDelta: 5 * mult,
      xpDelta: 12 * mult,
      starsDelta: KApp.popStreak % 5 === 0 ? 1 : 0,
      gameKey: 'pop',
      score: KApp.popScore
    });

    showKidToast(mult > 1 ? `🔥 ${mult}x COMBO! +${pts} pts!` : `🎈 Bravissimo! +5 Coins!`);
    setTimeout(() => startNewPopRound(true), 420);
  } else {
    btnEl.classList.remove('wiggle');
    void btnEl.offsetWidth;
    btnEl.classList.add('wiggle');
    window.KidsSFX?.gentleNudge();
    KApp.popStreak = 0;

    if (KApp.edition === 'junior' && KApp.popBlitzActive) {
      KApp.popHearts = Math.max(0, KApp.popHearts - 1);
      if (KApp.popHearts === 0) {
        clearInterval(KApp.popTimerId);
        KApp.popTimerId = null;
        KApp.popBlitzActive = false;
        showKidToast(`💫 Round Over! Score: ${KApp.popScore}`);
        await awardKidProgress({ coinsDelta: 8, xpDelta: 15, gameKey: 'pop', score: KApp.popScore });
      }
      renderPopView();
    }
    speakKidsItalian(`${item.it}! Cerchiamo ${KApp.popTarget.it}!`, { gender: 'kid' });
  }
}

/* ==================== MODE 3: TALKING MASCOT PET "LEO" & COIN SHOP ==================== */
function pickNextLeoSnack() {
  const snacks = KApp.curriculum.KIDS_WORDS.filter(w => w.cat === 'food').slice(0, 6);
  KApp.leoSnackTarget = snacks[Math.floor(Math.random() * snacks.length)];
}

function renderLeoView() {
  const host = document.getElementById('kview-leo');
  if (!KApp.curriculum || !KApp.profile) return;
  const { LEO_SPELLS, LEO_SHOP_ITEMS, KIDS_WORDS } = KApp.curriculum;
  const equipped = KApp.profile.equippedItems || {};
  const owned = new Set(KApp.profile.ownedItems || []);
  const snacks = KIDS_WORDS.filter(w => ['pizza', 'gelato', 'mela', 'pasta', 'fragola', 'banana'].includes(w.id));

  const renderSlotAcc = (slot) => {
    const item = LEO_SHOP_ITEMS.find(i => i.id === equipped[slot]);
    return item ? `<span class="leo-acc ${slot}">${item.emoji}</span>` : '';
  };

  host.innerHTML = `
    <div class="leo-layout">
      <div class="play-card leo-stage-card">
        <div class="leo-character-box ${KApp.leoAnimClass}" id="leoCharacterBox">
          ${renderSlotAcc('back')}
          ${renderSlotAcc('hat')}
          ${renderSlotAcc('glasses')}
          ${renderSlotAcc('neck')}
          ${renderSlotAcc('hand')}
          <svg viewBox="0 0 200 200" width="184" height="184" aria-label="Leo the Lion">
            <circle cx="100" cy="105" r="72" fill="#d97706" />
            <circle cx="100" cy="105" r="56" fill="#fbbf24" />
            <circle cx="62" cy="58" r="16" fill="#f59e0b" />
            <circle cx="138" cy="58" r="16" fill="#f59e0b" />
            <circle cx="62" cy="58" r="9" fill="#fde68a" />
            <circle cx="138" cy="58" r="9" fill="#fde68a" />
            <circle cx="80" cy="96" r="10" fill="#1e293b" />
            <circle cx="120" cy="96" r="10" fill="#1e293b" />
            <circle cx="83" cy="93" r="3.5" fill="#fff" />
            <circle cx="123" cy="93" r="3.5" fill="#fff" />
            <ellipse cx="100" cy="112" rx="11" ry="8" fill="#92400e" />
            <path d="M84 126 Q100 142 116 126" fill="none" stroke="#78350f" stroke-width="5" stroke-linecap="round" />
            <ellipse cx="66" cy="114" rx="8" ry="5" fill="#fb7185" opacity="0.6" />
            <ellipse cx="134" cy="114" rx="8" ry="5" fill="#fb7185" opacity="0.6" />
          </svg>
        </div>

        <div class="leo-speech" id="leoSpeechBubble">🦁 "${escapeHtml(KApp.leoSpeechIt)}"</div>

        <div style="display:flex;flex-direction:column;gap:0.55rem;width:100%;margin-top:0.8rem;">
          <button class="kbtn kbtn-primary kbtn-mic" id="leoMicSpellBtn" style="width:100%;">
            🎙️ <span id="leoMicLbl">Speak Italian Spell to Leo!</span>
          </button>
          <div style="font-size:0.78rem;color:var(--text-muted);font-weight:700;" id="leoHeardTxt">
            Say: "Salta!", "Balla!", "Ruggisci!", "Canta!", or "Ciao Leo!"
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:1rem;">
        <div class="play-card" style="margin-bottom:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.65rem;">
            <h3 style="margin:0;">🍎 Feed Leo! (${KApp.leoSnackTarget ? `"Ho fame! Vorrei ${escapeHtml(KApp.leoSnackTarget.it)}!"` : ''})</h3>
            <button class="kbtn kbtn-soft" id="leoAskFoodBtn" style="padding:0.35rem 0.7rem;font-size:0.85rem;">🔊 Hear</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(95px,1fr));gap:0.5rem;">
            ${snacks.map(sn => `
              <button class="kbtn kbtn-soft" data-feed-id="${sn.id}" style="flex-direction:column;padding:0.55rem;">
                <span style="font-size:2rem;">${sn.emoji}</span>
                <span style="font-size:0.84rem;">${escapeHtml(sn.it)}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="play-card" style="margin-bottom:0;">
          <h3 style="margin:0 0 0.55rem;">🪄 Voice Magic Spells (Speak or Tap!)</h3>
          <div class="spells-grid">
            ${LEO_SPELLS.map(sp => `
              <button class="kbtn kbtn-soft" data-spell-id="${sp.id}" style="flex-direction:column;padding:0.65rem 0.4rem;">
                <span style="font-size:1.85rem;">${sp.emoji}</span>
                <span style="font-size:0.9rem;">${escapeHtml(sp.it)}</span>
                ${KApp.edition !== 'piccolo' ? `<span style="font-size:0.7rem;color:var(--text-muted);">${escapeHtml(sp.en)}</span>` : ''}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="play-card" style="margin-bottom:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.55rem;">
            <h3 style="margin:0;">🛍️ Leo's Coin Wardrobe</h3>
            <span style="font-weight:800;color:#d97706;">🪙 ${KApp.profile.coins || 0} Coins</span>
          </div>
          <div class="shop-grid">
            ${LEO_SHOP_ITEMS.map(item => {
              const isOwned = owned.has(item.id);
              const isEquipped = equipped[item.slot] === item.id;
              return `
                <button class="kbtn ${isEquipped ? 'kbtn-green' : 'kbtn-soft'}" data-shop-id="${item.id}" style="flex-direction:column;padding:0.65rem 0.4rem;">
                  <span style="font-size:2rem;">${item.emoji}</span>
                  <span style="font-size:0.84rem;">${escapeHtml(item.it)}</span>
                  <span style="font-size:0.75rem;font-weight:800;">
                    ${isEquipped ? '✓ Wearing' : (isOwned ? 'Tap to Wear' : `🪙 ${item.costCoins}`)}
                  </span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  host.querySelector('#leoAskFoodBtn').addEventListener('click', () => {
    if (KApp.leoSnackTarget) {
      speakKidsItalian(`Ho fame! Vorrei ${KApp.leoSnackTarget.it}!`, { gender: 'kid' });
    }
  });

  host.querySelectorAll('[data-feed-id]').forEach(btn => {
    btn.addEventListener('click', () => handleFeedLeo(btn.dataset.feedId));
  });

  host.querySelectorAll('[data-spell-id]').forEach(btn => {
    btn.addEventListener('click', () => triggerLeoSpell(btn.dataset.spellId));
  });

  host.querySelectorAll('[data-shop-id]').forEach(btn => {
    btn.addEventListener('click', () => handleShopAction(btn.dataset.shopId));
  });

  const micBtn = host.querySelector('#leoMicSpellBtn');
  const micLbl = host.querySelector('#leoMicLbl');
  const heardEl = host.querySelector('#leoHeardTxt');
  micBtn.addEventListener('click', () => {
    listenKidsItalian({
      onStateChange: active => {
        micBtn.classList.toggle('listening', active);
        micLbl.textContent = active ? 'Listening... Say Italian!' : 'Speak Italian Spell to Leo!';
      },
      onInterim: txt => { heardEl.textContent = `🎙️ Hearing: "${txt}"...`; },
      onFinal: txt => matchSpokenSpell(txt, heardEl)
    });
  });
}

async function handleFeedLeo(snackId) {
  const snack = getWordById(snackId);
  if (!snack) return;
  if (KApp.leoSnackTarget && snack.id === KApp.leoSnackTarget.id) {
    window.KidsSFX?.coin();
    window.launchKidsConfetti?.(18);
    KApp.leoAnimClass = 'leo-jump';
    KApp.leoSpeechIt = `GNAM! Adoro ${snack.it}! Grazie mille!`;
    await awardKidProgress({ coinsDelta: 8, xpDelta: 15 });
    await speakKidsItalian(KApp.leoSpeechIt, { gender: 'kid' });
    pickNextLeoSnack();
    renderLeoView();
  } else {
    window.KidsSFX?.pop();
    KApp.leoSpeechIt = `Mmm, ${snack.it}! Ma vorrei ${KApp.leoSnackTarget?.it || 'qualcosa altro'}!`;
    speakKidsItalian(KApp.leoSpeechIt, { gender: 'kid' });
    renderLeoView();
  }
}

async function triggerLeoSpell(spellId) {
  const spell = KApp.curriculum.LEO_SPELLS.find(s => s.id === spellId);
  if (!spell) return;
  window.KidsSFX?.playByName(spell.sfx);
  if (spell.id === 'arcobaleno') window.launchKidsConfetti?.(30);
  KApp.leoAnimClass = spell.animClass;
  KApp.leoSpeechIt = `${spell.emoji} ${spell.reactionIt}`;
  renderLeoView();
  await awardKidProgress({ coinsDelta: 4, xpDelta: 10 });
  await speakKidsItalian(spell.reactionIt, { gender: 'kid' });
  setTimeout(() => {
    KApp.leoAnimClass = '';
    const box = document.getElementById('leoCharacterBox');
    if (box) box.className = 'leo-character-box';
  }, 1700);
}

function matchSpokenSpell(transcript, heardEl) {
  const norm = normalizeSpeech(transcript);
  if (heardEl) heardEl.textContent = `🎙️ You said: "${transcript}"`;
  const spell = KApp.curriculum.LEO_SPELLS.find(sp => sp.triggerWords.some(kw => norm.includes(kw)));
  if (spell) {
    showKidToast(`✨ Magic Voice Cast: ${spell.emoji} ${spell.it}`);
    triggerLeoSpell(spell.id);
  } else {
    window.KidsSFX?.sparkle();
    KApp.leoAnimClass = 'leo-wave';
    KApp.leoSpeechIt = `Bravissimo! Hai detto "${transcript}"!`;
    renderLeoView();
    speakKidsItalian(`Bravo! Hai detto ${transcript}!`, { gender: 'kid' });
  }
}

async function handleShopAction(itemId) {
  const item = KApp.curriculum.LEO_SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return;
  const owned = new Set(KApp.profile.ownedItems || []);
  const equipped = KApp.profile.equippedItems || {};

  let action = 'buy';
  if (equipped[item.slot] === item.id) action = 'unequip';
  else if (owned.has(item.id)) action = 'equip';

  const res = await kidsPost('api/kids/shop', { kidId: KApp.kidId, action, itemId });
  if (!res.ok) {
    window.KidsSFX?.gentleNudge();
    showKidToast(`Need ${item.costCoins} Coins! Play Chef or Pop to earn more!`);
    return;
  }
  KApp.profile = res.kidProfile;
  window.KidsSFX?.sparkle();
  renderTopHud();
  renderLeoView();
  speakKidsItalian(item.it, { gender: 'kid' });
}

/* ==================== MODE 5: ANIMATED COMIC STORIES & SOUNDBOARD ==================== */
function renderStoriesView() {
  const host = document.getElementById('kview-stories');
  if (!KApp.curriculum) return;
  const { KIDS_STORIES, SOUNDBOARD_PADS } = KApp.curriculum;
  const story = KIDS_STORIES.find(s => s.id === KApp.activeStoryId) || KIDS_STORIES[0];
  const doneSet = new Set(KApp.profile?.completedStories || []);

  host.innerHTML = `
    <div class="play-card">
      <div class="scene-pills">
        ${KIDS_STORIES.map(s => `
          <button class="scene-pill ${s.id === story.id ? 'active' : ''}" data-story-id="${s.id}">
            ${s.emoji} ${escapeHtml(s.titleIt)} ${doneSet.has(s.id) ? '⭐' : ''}
          </button>
        `).join('')}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.65rem;">
        <div>
          <h2 style="margin:0;">${story.emoji} ${escapeHtml(story.titleIt)}</h2>
          ${KApp.edition !== 'piccolo' ? `<div style="color:var(--text-muted);font-weight:700;font-size:0.9rem;">${escapeHtml(story.titleEn)}</div>` : ''}
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <button class="kbtn kbtn-primary" id="playFullStoryBtn">▶ Play Story</button>
          <button class="kbtn kbtn-soft" id="toggleStoryEnBtn">${KApp.storyShowEnglish ? 'Hide English' : 'Show English'}</button>
        </div>
      </div>

      <div class="stories-panels-grid">
        ${story.panels.map((p, idx) => `
          <div class="comic-panel" data-panel-idx="${idx}">
            <div class="panel-art">${p.emoji}</div>
            <div class="panel-speaker">${escapeHtml(p.speaker)} • 🔊 Tap</div>
            <div class="panel-it">${escapeHtml(p.it)}</div>
            ${KApp.storyShowEnglish && KApp.edition !== 'piccolo' ? `<div class="panel-en">${escapeHtml(p.en)}</div>` : ''}
          </div>
        `).join('')}
      </div>

      <div style="background:var(--bg-soft);border:2px solid var(--border);border-radius:22px;padding:0.95rem;margin-top:0.5rem;">
        <h3 style="margin:0 0 0.6rem;">⭐ Story Star Quiz (Win +25 Coins!)</h3>
        ${story.quiz.map((q, qIdx) => {
          const pickedIdx = KApp.storyQuizAnswers[`${story.id}:${qIdx}`];
          return `
            <div style="margin-bottom:0.85rem;">
              <div style="font-weight:800;margin-bottom:0.4rem;">
                ${escapeHtml(q.questionIt)}
                ${KApp.edition !== 'piccolo' ? `<span style="color:var(--text-muted);font-weight:600;font-size:0.85rem;"> — ${escapeHtml(q.questionEn)}</span>` : ''}
              </div>
              <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                ${q.options.map((opt, oIdx) => `
                  <button class="kbtn ${pickedIdx === oIdx ? (opt.correct ? 'kbtn-green' : 'kbtn-soft') : 'kbtn-soft'}" data-quiz="${qIdx}:${oIdx}">
                    <span style="font-size:1.45rem;">${opt.emoji}</span>
                    <span>${escapeHtml(opt.labelIt)}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <div class="play-card">
      <h2 style="margin:0 0 0.7rem;">🔊 Silly Italian Soundboard — Tap Any Pad!</h2>
      <div class="soundboard-grid">
        ${SOUNDBOARD_PADS.map(pad => `
          <button class="sb-pad" data-sb-id="${pad.id}" style="background:${pad.color};">
            <span class="sb-emoji">${pad.emoji}</span>
            <span class="sb-it">${escapeHtml(pad.it)}</span>
            ${KApp.edition !== 'piccolo' ? `<span style="font-size:0.72rem;opacity:0.92;">${escapeHtml(pad.en)}</span>` : ''}
          </button>
        `).join('')}
      </div>
    </div>
  `;

  host.querySelectorAll('[data-story-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      KApp.storyPlayToken++;
      KApp.activeStoryId = btn.dataset.storyId;
      window.KidsSFX?.pop();
      renderStoriesView();
    });
  });

  host.querySelector('#toggleStoryEnBtn').addEventListener('click', () => {
    KApp.storyShowEnglish = !KApp.storyShowEnglish;
    renderStoriesView();
  });

  host.querySelectorAll('[data-panel-idx]').forEach(panelEl => {
    panelEl.addEventListener('click', async () => {
      const idx = Number(panelEl.dataset.panelIdx);
      const p = story.panels[idx];
      if (!p) return;
      document.querySelectorAll('.comic-panel').forEach(el => el.classList.remove('speaking'));
      panelEl.classList.add('speaking');
      window.KidsSFX?.playByName(p.sfx);
      await speakKidsItalian(p.it, { gender: p.voiceGender || 'kid' });
      panelEl.classList.remove('speaking');
    });
  });

  host.querySelector('#playFullStoryBtn').addEventListener('click', async () => {
    const token = ++KApp.storyPlayToken;
    for (let i = 0; i < story.panels.length; i++) {
      if (token !== KApp.storyPlayToken || KApp.activeTab !== 'stories') return;
      const p = story.panels[i];
      const panels = host.querySelectorAll('.comic-panel');
      panels.forEach(el => el.classList.remove('speaking'));
      if (panels[i]) panels[i].classList.add('speaking');
      window.KidsSFX?.playByName(p.sfx);
      await speakKidsItalian(p.it, { gender: p.voiceGender || 'kid' });
    }
    host.querySelectorAll('.comic-panel').forEach(el => el.classList.remove('speaking'));
  });

  host.querySelectorAll('[data-quiz]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const [qIdx, oIdx] = btn.dataset.quiz.split(':').map(Number);
      const q = story.quiz[qIdx];
      const opt = q.options[oIdx];
      KApp.storyQuizAnswers[`${story.id}:${qIdx}`] = oIdx;
      if (opt.correct) {
        window.KidsSFX?.fanfare();
        window.launchKidsConfetti?.(24);
        await speakKidsItalian(`Bravissimo! ${opt.labelIt}!`, { gender: 'kid' });
        const allCorrect = story.quiz.every((qq, qi) => {
          const ans = KApp.storyQuizAnswers[`${story.id}:${qi}`];
          return typeof ans === 'number' && qq.options[ans]?.correct;
        });
        await awardKidProgress({
          coinsDelta: allCorrect ? 25 : 8,
          xpDelta: allCorrect ? 30 : 10,
          starsDelta: allCorrect ? 1 : 0,
          completedStoryId: allCorrect ? story.id : null
        });
        showKidToast(allCorrect ? `⭐ Story Mastered! +25 Coins!` : `🎉 Great answer! +8 Coins!`);
      } else {
        window.KidsSFX?.gentleNudge();
        speakKidsItalian(`Ops, questo è ${opt.labelIt}. Riprova!`, { gender: 'kid' });
      }
      renderStoriesView();
    });
  });

  host.querySelectorAll('[data-sb-id]').forEach(padEl => {
    padEl.addEventListener('click', async () => {
      const pad = SOUNDBOARD_PADS.find(p => p.id === padEl.dataset.sbId);
      if (!pad) return;
      window.KidsSFX?.playByName(pad.sfx);
      speakKidsItalian(pad.it, { gender: pad.voiceGender || 'kid' });
      await awardKidProgress({ coinsDelta: 1, xpDelta: 3 });
    });
  });
}

/* ==================== TAB 6: STICKER BOOK & FAMILY LEADERBOARD ==================== */
function renderAlbumAndLeaderboard() {
  const host = document.getElementById('kview-album');
  if (!KApp.curriculum || !KApp.profile) return;
  const { WORLD_SCENES } = KApp.curriculum;
  const unlocked = new Set(KApp.profile.unlockedStickers || []);
  const stickerIds = WORLD_SCENES.flatMap(s => s.items);

  host.innerHTML = `
    <div class="play-card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.8rem;">
        <h2 style="margin:0;">🌟 Shiny Sticker Album (${unlocked.size} / ${stickerIds.length})</h2>
        <span style="font-weight:800;color:var(--accent);">Tap unlocked stickers to hear them!</span>
      </div>
      <div class="sticker-grid">
        ${stickerIds.map(id => {
          const w = getWordById(id);
          if (!w) return '';
          const ok = unlocked.has(w.id);
          return `
            <button class="sticker-slot ${ok ? 'unlocked' : ''}" data-sticker-word="${w.id}" style="background:${ok ? '' : 'var(--bg-soft)'};cursor:pointer;">
              <div style="font-size:2.3rem;">${w.emoji}</div>
              <div style="font-family:'Fredoka',sans-serif;font-weight:700;font-size:0.88rem;">${ok ? escapeHtml(w.it) : '???'}</div>
            </button>
          `;
        }).join('')}
      </div>
    </div>

    <div class="play-card">
      <h2 style="margin:0 0 0.75rem;">🏆 Family &amp; Kids Leaderboard</h2>
      ${(KApp.leaderboard || []).map((row, idx) => `
        <div class="leaderboard-row">
          <div style="display:flex;align-items:center;gap:0.65rem;">
            <strong style="font-size:1.1rem;width:24px;">#${idx + 1}</strong>
            <span style="font-size:1.65rem;">${row.avatar || '🦁'}</span>
            <div>
              <div style="font-family:'Fredoka',sans-serif;font-weight:700;">${escapeHtml(row.name)} <span style="font-size:0.75rem;color:var(--text-muted);">(${escapeHtml(row.rankTitle || 'Esploratore')})</span></div>
              <div style="font-size:0.78rem;color:var(--text-muted);">🍕 ${row.ordersServed || 0} orders • 🎈 Best ${row.popHigh || 0} • 🌟 ${row.stickersCount || 0} stickers</div>
            </div>
          </div>
          <div style="font-weight:800;text-align:right;">
            <div>⚡ ${row.xp || 0} XP</div>
            <div style="font-size:0.8rem;color:#f59e0b;">🪙 ${row.coins || 0}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  host.querySelectorAll('[data-sticker-word]').forEach(btn => {
    btn.addEventListener('click', () => {
      const w = getWordById(btn.dataset.stickerWord);
      if (!w) return;
      if (unlocked.has(w.id)) {
        window.KidsSFX?.playByName(w.sfx);
        speakKidsItalian(w.it, { gender: 'kid' });
      } else {
        window.KidsSFX?.gentleNudge();
        showKidToast('Play Worlds Explore or Treasure Hunt to unlock this sticker!');
      }
    });
  });
}

/* ==================== PROFILE PICKER MODAL ==================== */
function openKidProfileModal() {
  const modal = document.getElementById('kidProfileModal');
  const listEl = document.getElementById('existingProfilesList');
  const pickerEl = document.getElementById('newAvatarPicker');
  const avatars = KApp.curriculum?.KID_AVATARS || [];

  listEl.innerHTML = (KApp.leaderboard || []).map(p => `
    <button class="kbtn ${p.kidId === KApp.kidId ? 'kbtn-green' : 'kbtn-soft'}" data-switch-kid="${p.kidId}" style="width:100%;justify-content:space-between;margin-bottom:0.45rem;">
      <span><strong style="font-size:1.3rem;">${p.avatar || '🦁'}</strong> ${escapeHtml(p.name)}</span>
      <span>🪙 ${p.coins || 0} • ⭐ ${p.stars || 0}</span>
    </button>
  `).join('');

  listEl.querySelectorAll('[data-switch-kid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await switchKidProfile(btn.dataset.switchKid);
      modal.classList.add('hidden');
    });
  });

  pickerEl.innerHTML = avatars.map(av => `
    <button class="avatar-pick-btn ${KApp.pickedNewAvatar === av.emoji ? 'selected' : ''}" data-pick-av="${av.emoji}">
      <span style="font-size:1.75rem;">${av.emoji}</span>
      <span>${escapeHtml(av.name)}</span>
    </button>
  `).join('');

  pickerEl.querySelectorAll('[data-pick-av]').forEach(btn => {
    btn.addEventListener('click', () => {
      KApp.pickedNewAvatar = btn.dataset.pickAv;
      pickerEl.querySelectorAll('.avatar-pick-btn').forEach(x => x.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  modal.classList.remove('hidden');
}

async function switchKidProfile(kidId) {
  KApp.kidId = kidId;
  try { localStorage.setItem('veloce_kid_id', kidId); } catch (_) {}
  const data = await fetch(kUrl(`api/kids/bootstrap?kid=${encodeURIComponent(kidId)}&edition=${encodeURIComponent(KApp.edition)}`)).then(r => r.json());
  if (data && data.ok) {
    KApp.profile = data.kidProfile;
    KApp.leaderboard = data.leaderboard || [];
    renderTopHud();
    renderAllViews();
    showKidToast(`👋 Welcome back, ${KApp.profile.name}!`);
  }
}

async function createOrSwitchCustomKid() {
  const inp = document.getElementById('newKidNameInput');
  const rawName = (inp.value || '').trim();
  if (!rawName) {
    showKidToast('Enter a kid name first!');
    return;
  }
  const kidId = rawName.toLowerCase().replace(/[^a-z0-9]/g, '') || `kid${Date.now().toString(36)}`;
  const res = await kidsPost('api/kids/profile', {
    kidId,
    name: rawName,
    avatar: KApp.pickedNewAvatar || '🦁',
    ageEdition: KApp.edition
  });
  if (res && res.ok) {
    KApp.kidId = res.kidProfile.kidId;
    KApp.profile = res.kidProfile;
    KApp.leaderboard = res.leaderboard || [];
    try { localStorage.setItem('veloce_kid_id', KApp.kidId); } catch (_) {}
    document.getElementById('kidProfileModal').classList.add('hidden');
    inp.value = '';
    renderTopHud();
    renderAllViews();
    window.KidsSFX?.fanfare();
    window.launchKidsConfetti?.(24);
    showKidToast(`🎉 Ciao ${KApp.profile.name}!`);
  }
}

function renderAllViews() {
  renderWorldsView();
  if (KApp.chefCustomer) renderChefView();
  if (KApp.popTarget) renderPopView();
  renderLeoView();
  renderStoriesView();
  renderAlbumAndLeaderboard();
}

/* ==================== BOOTSTRAP KIDS ENGINE ==================== */
async function bootstrapKidsApp() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderShell();

  const params = new URLSearchParams(window.location.search);
  const urlKid = (params.get('kid') || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const savedKid = (() => { try { return localStorage.getItem('veloce_kid_id') || ''; } catch (_) { return ''; } })();
  KApp.kidId = urlKid || savedKid || 'leo';

  const urlEd = params.get('edition');
  const startEdition = ['piccolo', 'junior', 'adaptive'].includes(urlEd) ? urlEd : (CFG.defaultEdition || 'adaptive');
  applyEditionTheme(startEdition);

  KApp.apiBase = await resolveKidsApiBase();
  const res = await fetch(kUrl(`api/kids/bootstrap?kid=${encodeURIComponent(KApp.kidId)}&edition=${encodeURIComponent(startEdition)}`)).then(r => r.json());

  if (res && res.ok) {
    KApp.curriculum = res.curriculum;
    KApp.profile = res.kidProfile;
    KApp.leaderboard = res.leaderboard || [];
    renderTopHud();
    pickNextLeoSnack();
    startNewChefOrder(false);
    startNewPopRound(false);
    renderAllViews();
  }
}

document.addEventListener('DOMContentLoaded', bootstrapKidsApp);
