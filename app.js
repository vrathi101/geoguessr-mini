/* ═══════════════════════════════════════════════════════════
   GEOGUESSR MINI — app.js
   All game logic: Maps API loading, location generation,
   Street View, guess map, scoring, results, leaderboard.
═══════════════════════════════════════════════════════════ */

"use strict";

// ─── Constants ───────────────────────────────────────────
const TOTAL_ROUNDS   = 5;
const MAX_SCORE      = 5000;
const SCORE_K        = 2_000_000; // meters — world-map decay constant
const MAX_RETRIES    = 30;        // retries per location search

// ─── Zone Definitions ────────────────────────────────────
// Each entry: [minLat, maxLat, minLng, maxLng, weight]

const WORLD_ZONES = [
  [-10, 71,  -25,  45,  30], // Europe
  [15,  72, -170, -50,  20], // North America
  [24,  46,  122, 146,  12], // East Asia
  [-47, -10,  113, 179,  10], // Oceania
  [-56,  13,  -82, -34,  10], // South America
  [-10,  35,   68, 141,   8], // South/SE Asia
  [-35,   5,   10,  52,   5], // Southern Africa
  [12,   42,   25,  63,   5], // Middle East
];

const CURATED_ZONES = [
  [-10, 71,  -25,  45,  50], // Europe (dominant)
  [15,  72, -170, -50,  25], // North America
  [24,  46,  122, 146,  15], // East Asia
  [-47, -10,  113, 179,  10], // Oceania
];

const URBAN_CITIES = [
  // Europe
  [51.5074,-0.1278],[48.8566,2.3522],[52.5200,13.4050],[40.4168,-3.7038],
  [41.9028,12.4964],[52.3702,4.8952],[48.2082,16.3738],[52.2297,21.0122],
  [50.0755,14.4378],[59.3293,18.0686],[59.9139,10.7522],[55.6761,12.5683],
  [38.7169,-9.1399],[37.9838,23.7275],[53.3498,-6.2603],[50.8503,4.3517],
  [47.4979,19.0402],[44.4268,26.1025],[60.1699,24.9384],[47.3769,8.5417],
  [45.4642,9.1900],[48.1351,11.5820],[53.5511,9.9937],[41.3851,2.1734],
  [43.2965,5.3698],[45.7640,4.8357],[51.2277,6.7735],[50.9333,6.9500],
  // North America
  [40.7128,-74.0060],[34.0522,-118.2437],[41.8781,-87.6298],[29.7604,-95.3698],
  [39.9526,-75.1652],[32.7157,-117.1611],[32.7767,-96.7970],[25.7617,-80.1918],
  [47.6062,-122.3321],[42.3601,-71.0589],[39.7392,-104.9903],[45.5017,-73.5673],
  [49.2827,-123.1207],[43.7000,-79.4000],[19.4326,-99.1332],[37.7749,-122.4194],
  [36.1627,-86.7816],[33.7490,-84.3880],[38.9072,-77.0369],[35.2271,-80.8431],
  // East Asia
  [35.6762,139.6503],[37.5665,126.9780],[31.2304,121.4737],[25.0330,121.5654],
  [22.3964,114.1095],[34.6937,135.5023],[43.0618,141.3545],[35.1815,136.9066],
  [35.0116,135.7681],[35.4437,139.6380],[37.4563,126.7052],[35.1796,129.0756],
  // Oceania
  [-33.8688,151.2093],[-37.8136,144.9631],[-27.4698,153.0251],[-31.9505,115.8605],
  [-36.8485,174.7633],[-41.2865,174.7762],
  // Latin America
  [-23.5505,-46.6333],[-34.6037,-58.3816],[-22.9068,-43.1729],[4.7110,-74.0721],
  [-12.0464,-77.0428],[-33.4489,-70.6693],[-34.9011,-56.1745],
  // Middle East / Other
  [25.2048,55.2708],[32.0853,34.7818],[41.0082,28.9784],[30.0444,31.2357],
  [-26.2041,28.0473],[-33.9249,18.4241],[33.5731,-7.5898],
];

// Pre-compute cumulative weights for each zone list
function buildWeights(zones) {
  const total = zones.reduce((s, z) => s + z[4], 0);
  let cum = 0;
  return zones.map(z => { cum += z[4] / total; return cum; });
}

const WORLD_WEIGHTS   = buildWeights(WORLD_ZONES);
const CURATED_WEIGHTS = buildWeights(CURATED_ZONES);

// Legacy alias — kept so any possible references work
const COVERAGE_ZONES = WORLD_ZONES;
const ZONE_WEIGHTS   = WORLD_WEIGHTS;

// ─── Game Config State ───────────────────────────────────
let gameConfig = { timer: 0, difficulty: 'world', noMove: false };

function loadConfig() {
  try {
    const saved = localStorage.getItem('geo_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      gameConfig = Object.assign({ timer: 0, difficulty: 'world', noMove: false }, parsed);
    }
  } catch {
    // ignore parse errors
  }
}

function saveConfig() {
  try {
    localStorage.setItem('geo_config', JSON.stringify(gameConfig));
  } catch {
    // ignore storage errors
  }
}

function updateConfigUI() {
  document.querySelectorAll('.config-btn-group').forEach(group => {
    const key = group.dataset.key;
    const currentVal = String(gameConfig[key]);
    group.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.config === currentVal);
    });
  });
}

// ─── Supabase State ──────────────────────────────────────
let sb           = null;  // Supabase client (avoid conflict with CDN's window.supabase)
let currentUser  = null;

function initSupabase(url, anonKey) {
  if (!url || !anonKey || !window.supabase) return;
  sb = window.supabase.createClient(url, anonKey);
  sb.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user ?? null;
    updateAuthUI();
  });
}

async function signInWithGoogle() {
  if (!sb) return;
  await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

async function signOut() {
  if (!sb) return;
  await sb.auth.signOut();
  currentUser = null;
  updateAuthUI();
}

function updateAuthUI() {
  const lbAuth = document.getElementById('lb-auth');
  if (!lbAuth) return;

  if (!sb) {
    lbAuth.innerHTML = '';
    return;
  }

  if (currentUser) {
    const avatarUrl = currentUser.user_metadata?.avatar_url || '';
    const name = currentUser.user_metadata?.full_name || currentUser.email || 'User';
    lbAuth.innerHTML = `
      <div class="lb-user">
        ${avatarUrl ? `<img class="lb-user-avatar" src="${avatarUrl}" alt="${name}" />` : ''}
        <span class="lb-user-name">${name}</span>
      </div>
      <button id="btn-sign-out" type="button" class="btn-secondary" style="padding:8px 16px;font-size:0.8rem;">Sign Out</button>
    `;
    document.getElementById('btn-sign-out').addEventListener('click', () => signOut());
  } else {
    lbAuth.innerHTML = `
      <button id="btn-sign-in" type="button" class="btn-secondary" style="padding:8px 16px;font-size:0.8rem;">Sign in with Google</button>
    `;
    document.getElementById('btn-sign-in').addEventListener('click', () => signInWithGoogle());
  }

  updateFinalAuthUI();
}

function updateFinalAuthUI() {
  const signedIn  = document.getElementById('final-save-signed-in');
  const signedOut = document.getElementById('final-save-signed-out');
  if (!signedIn || !signedOut) return;

  if (!sb) {
    signedIn.style.display  = 'none';
    signedOut.style.display = 'none';
    return;
  }

  if (currentUser) {
    signedIn.style.display  = 'flex';
    signedIn.style.flexDirection = 'column';
    signedIn.style.gap = '8px';
    signedOut.style.display = 'none';
    // Re-enable save button
    const saveBtn = document.getElementById('btn-save-score');
    if (saveBtn) saveBtn.disabled = false;
    const statusEl = document.getElementById('save-score-status');
    if (statusEl) statusEl.textContent = '';
  } else {
    signedIn.style.display  = 'none';
    signedOut.style.display = 'block';
  }
}

async function saveScore() {
  if (!sb || !currentUser) return false;
  const total = roundScores.reduce((a, b) => a + b, 0);
  const roundData = roundScores.map((s, i) => ({
    score: s,
    guess: window._allGuesses[i],
    actual: locations[i],
  }));
  const { error } = await sb.from('scores').insert({
    user_id: currentUser.id,
    display_name: currentUser.user_metadata?.full_name || currentUser.email,
    avatar_url: currentUser.user_metadata?.avatar_url || null,
    total_score: total,
    max_possible: TOTAL_ROUNDS * MAX_SCORE,
    rounds: roundData,
    timer_seconds: gameConfig.timer,
    difficulty: gameConfig.difficulty,
    nmpz: gameConfig.noMove,
  });
  return !error;
}

async function handleSaveScore() {
  const btn = document.getElementById('btn-save-score');
  const statusEl = document.getElementById('save-score-status');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Saving…';

  const ok = await saveScore();
  if (statusEl) statusEl.textContent = ok ? 'Saved!' : 'Failed to save.';
}

// ─── Leaderboard ─────────────────────────────────────────
async function showLeaderboard() {
  showScreen('screen-leaderboard');
  updateAuthUI();
  await loadLeaderboard();
}

async function loadLeaderboard() {
  const contentEl = document.getElementById('lb-content');
  const statusEl  = document.getElementById('lb-status');

  if (!sb) {
    contentEl.innerHTML = '<p class="lb-status">Leaderboard requires Supabase configuration.</p>';
    return;
  }

  contentEl.innerHTML = '<p class="lb-status" id="lb-status">Loading&hellip;</p>';

  try {
    const { data, error } = await sb
      .from('scores')
      .select('*')
      .order('total_score', { ascending: false })
      .limit(20);

    if (error) throw error;

    if (!data || data.length === 0) {
      contentEl.innerHTML = '<p class="lb-status">No scores yet. Be the first to play!</p>';
      return;
    }

    const rows = data.map((row, i) => {
      const rank = i + 1;
      const avatarHtml = row.avatar_url
        ? `<img class="lb-player-avatar" src="${row.avatar_url}" alt="${row.display_name || ''}" />`
        : `<div class="lb-player-avatar" style="background:var(--bg-card2);border:1px solid var(--border);"></div>`;
      const diffLabel = { world: 'World', curated: 'Curated', urban: 'Urban' }[row.difficulty] || row.difficulty || 'World';
      const timerLabel = row.timer_seconds > 0 ? `${row.timer_seconds}s` : '∞';
      const modeLabel = row.nmpz ? 'No Move' : 'Move';
      const modeStr = `${diffLabel} | ${timerLabel} | ${modeLabel}`;
      const dateStr = row.played_at ? new Date(row.played_at).toLocaleDateString() : '—';
      return `
        <tr>
          <td class="lb-rank">#${rank}</td>
          <td>
            <div class="lb-player">
              ${avatarHtml}
              <span>${row.display_name || 'Anonymous'}</span>
            </div>
          </td>
          <td class="lb-score">${(row.total_score || 0).toLocaleString()}</td>
          <td><span class="lb-mode-badge">${modeStr}</span></td>
          <td style="color:var(--text-muted);font-size:0.8rem;">${dateStr}</td>
        </tr>
      `;
    }).join('');

    contentEl.innerHTML = `
      <table class="lb-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>Score</th>
            <th>Mode</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (err) {
    contentEl.innerHTML = `<p class="lb-status">Failed to load leaderboard: ${err.message}</p>`;
  }
}

// ─── Timer State ─────────────────────────────────────────
let timerInterval   = null;
let timerRemaining  = 0;

function stopTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  const hudTimer = document.getElementById('hud-timer');
  if (hudTimer) {
    hudTimer.style.display = 'none';
    hudTimer.classList.remove('hud-timer-warning');
  }
}

function startTimer(seconds) {
  stopTimer();
  if (seconds <= 0) return;

  timerRemaining = seconds;
  const hudTimer      = document.getElementById('hud-timer');
  const hudTimerValue = document.getElementById('hud-timer-value');

  hudTimer.style.display = 'flex';
  hudTimer.classList.remove('hud-timer-warning');
  hudTimerValue.textContent = formatTime(timerRemaining);

  timerInterval = setInterval(() => {
    timerRemaining--;
    hudTimerValue.textContent = formatTime(timerRemaining);

    if (timerRemaining <= 10) {
      hudTimer.classList.add('hud-timer-warning');
    }

    if (timerRemaining <= 0) {
      stopTimer();
      autoSubmitRound();
    }
  }, 1000);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function autoSubmitRound() {
  stopTimer();
  roundScores.push(0);
  window._allGuesses.push(null);
  showRoundResult(0, null, null);
}

// ─── Share Card ───────────────────────────────────────────
function scoreEmoji(score) {
  if (score >= 4000) return '🟩';
  if (score >= 2000) return '🟨';
  if (score >= 1000) return '🟧';
  return '🟥';
}

async function copyShareCard() {
  const total = roundScores.reduce((a, b) => a + b, 0);
  const diffLabel = { world: 'World', curated: 'Curated', urban: 'Urban' }[gameConfig.difficulty] || 'World';
  const timerLabel = gameConfig.timer > 0 ? `${gameConfig.timer}s` : '∞';
  const modeLabel = gameConfig.noMove ? 'No Move' : 'Move';
  const emojis = roundScores.map(s => scoreEmoji(s)).join(' ');

  const card = [
    `GeoGuessr Mini • ${total.toLocaleString()}/${(TOTAL_ROUNDS * MAX_SCORE).toLocaleString()}`,
    `${diffLabel} | ${timerLabel} | ${modeLabel}`,
    '',
    emojis,
  ].join('\n');

  const btn = document.getElementById('btn-share');

  try {
    await navigator.clipboard.writeText(card);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  } catch {
    // Fallback for browsers that block clipboard
    btn.textContent = 'Copy failed';
    setTimeout(() => { btn.textContent = '🔗 Share Result'; }, 2000);
  }
}

// ─── Map / Game State ─────────────────────────────────────
let googleMaps      = null;   // google.maps namespace (loaded dynamically)
let svService       = null;   // StreetViewService instance
let panorama        = null;   // StreetViewPanorama instance
let guessMap        = null;   // Map instance for guessing
let resultMap       = null;   // Map instance for round result
let finalMap        = null;   // Map instance for final results

let locations       = [];     // Array of {lat, lng} for all rounds
let roundIndex      = 0;      // Current round (0-based)
let roundScores     = [];     // Scores per round
let guessLatLng     = null;   // google.maps.LatLng of current guess
let guessMarker     = null;   // AdvancedMarkerElement on guess map
let miniMapExpanded = false;
let _nmpzPanoId     = null;   // locked pano ID when No Move is active

// Initialize global guess store
window._allGuesses  = [];

// ─── Utility: show/hide screens ──────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
  });
  const el = document.getElementById(id);
  // Force reflow so the opacity transition fires correctly
  void el.offsetHeight;
  el.classList.add('active');
}

// ─── Utility: format distance ────────────────────────────
function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// ─── Utility: format coords ──────────────────────────────
function formatCoords(lat, lng) {
  const latStr = `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}`;
  const lngStr = `${Math.abs(lng).toFixed(3)}°${lng >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lngStr}`;
}

// ─── Utility: score color class ──────────────────────────
function scoreClass(score) {
  if (score >= 4500) return 'score-gold';
  if (score >= 2500) return 'score-green';
  if (score >= 1000) return 'score-yellow';
  return 'score-red';
}

// ─── Utility: rating label ───────────────────────────────
function getRating(total) {
  const pct = total / (TOTAL_ROUNDS * MAX_SCORE);
  if (pct >= 0.90) return { label: 'Legendary',  cls: 'rating-legendary' };
  if (pct >= 0.70) return { label: 'Expert',     cls: 'rating-expert'    };
  if (pct >= 0.50) return { label: 'Good',       cls: 'rating-good'      };
  if (pct >= 0.30) return { label: 'Average',    cls: 'rating-average'   };
  return                  { label: 'Beginner',   cls: 'rating-beginner'  };
}

// ─── createPin helper (DRY) ───────────────────────────────
function createPin(color, size = 22) {
  const el = document.createElement('div');
  el.style.cssText = `width:${size}px;height:${size}px;background:${color};border:${Math.max(2, size / 7 | 0)}px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,.5)`;
  return el;
}

// ─── Weighted random zone selection ──────────────────────
function pickZoneFromList(zones, weights) {
  const r = Math.random();
  for (let i = 0; i < weights.length; i++) {
    if (r <= weights[i]) return zones[i];
  }
  return zones[zones.length - 1];
}

// ─── Find a valid Street View location ───────────────────
async function getRandomValidLocation() {
  const difficulty = gameConfig.difficulty;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let lat, lng, radius;

    if (difficulty === 'urban') {
      const city = URBAN_CITIES[Math.floor(Math.random() * URBAN_CITIES.length)];
      lat = city[0];
      lng = city[1];
      radius = 8000;
    } else if (difficulty === 'curated') {
      const zone = pickZoneFromList(CURATED_ZONES, CURATED_WEIGHTS);
      lat = zone[0] + Math.random() * (zone[1] - zone[0]);
      lng = zone[2] + Math.random() * (zone[3] - zone[2]);
      radius = 100_000;
    } else {
      // world
      const zone = pickZoneFromList(WORLD_ZONES, WORLD_WEIGHTS);
      lat = zone[0] + Math.random() * (zone[1] - zone[0]);
      lng = zone[2] + Math.random() * (zone[3] - zone[2]);
      radius = 100_000;
    }

    try {
      const result = await svService.getPanorama({
        location: { lat, lng },
        radius,
        preference: googleMaps.StreetViewPreference?.NEAREST ?? 'nearest',
      });
      const loc = result.data.location.latLng;
      return { lat: loc.lat(), lng: loc.lng() };
    } catch {
      // No coverage — retry
    }
  }
  throw new Error('Could not find a valid Street View location after retries.');
}

// ─── Pre-fetch all locations for the game ────────────────
async function prefetchLocations() {
  locations = [];
  const progressEl = document.getElementById('loading-progress');
  let found = 0;

  const promises = Array.from({ length: TOTAL_ROUNDS }, async () => {
    const loc = await getRandomValidLocation();
    found++;
    progressEl.textContent = `${found} / ${TOTAL_ROUNDS} found`;
    return loc;
  });

  locations = await Promise.all(promises);
}

// ─── Load a round ────────────────────────────────────────
function loadRound(index) {
  // Stop any running timer first
  stopTimer();

  const loc = locations[index];

  // Update HUD
  document.getElementById('hud-round-current').textContent = index + 1;
  document.getElementById('hud-total-score').textContent =
    roundScores.reduce((a, b) => a + b, 0).toLocaleString();

  // Remove stale guess marker from previous round
  if (guessMarker) {
    guessMarker.map = null;
    guessMarker = null;
  }

  // Reset guess state
  guessLatLng = null;
  document.getElementById('btn-guess').disabled = true;
  document.getElementById('guess-hint').textContent = 'Click on the map to place your pin';

  // Collapse mini-map
  setMiniMapExpanded(false);

  // Reset NMPZ lock so pano_changed treats the incoming scene as the new origin.
  _nmpzPanoId = null;

  // Set Street View position
  panorama.setPosition({ lat: loc.lat, lng: loc.lng });
  panorama.setPov({ heading: Math.random() * 360, pitch: 0 });

  // Hide navigation arrows in No Move mode (UX hint — actual lock is via pano_changed).
  panorama.setOptions({
    linksControl: !gameConfig.noMove,
    clickToGo:    !gameConfig.noMove,
  });

  showScreen('screen-game');

  // Start timer if configured
  startTimer(gameConfig.timer);
}

// ─── Mini-map expand/collapse ────────────────────────────
function setMiniMapExpanded(expanded) {
  miniMapExpanded = expanded;
  const container = document.getElementById('mini-map-container');
  const icon      = document.getElementById('mini-map-toggle-icon');
  const label     = document.getElementById('mini-map-toggle-label');

  if (expanded) {
    container.classList.remove('mini-map-collapsed');
    container.classList.add('mini-map-expanded');
    icon.textContent  = '▼';
    label.textContent = 'Map';
    // Trigger resize so the map tiles load correctly
    if (guessMap) {
      googleMaps.event.trigger(guessMap, 'resize');
    }
  } else {
    container.classList.remove('mini-map-expanded');
    container.classList.add('mini-map-collapsed');
    icon.textContent  = '▲';
    label.textContent = 'Click to guess';
  }
}

// ─── Place guess marker on mini-map ──────────────────────
async function placeGuessMarker(latLng) {
  // Remove old marker
  if (guessMarker) {
    guessMarker.map = null;
    guessMarker = null;
  }

  try {
    const { AdvancedMarkerElement } = await googleMaps.importLibrary('marker');

    guessMarker = new AdvancedMarkerElement({
      map: guessMap,
      position: latLng,
      content: createPin('#f87171', 20),
      title: 'Your guess',
    });

    guessLatLng = latLng;
    document.getElementById('btn-guess').disabled = false;
    document.getElementById('guess-hint').textContent = 'Pin placed! Click GUESS to submit.';
  } catch (err) {
    console.error('Failed to place marker:', err);
  }
}

// ─── Calculate score ─────────────────────────────────────
function calculateScore(distanceMeters) {
  return Math.round(MAX_SCORE * Math.exp(-distanceMeters / SCORE_K));
}

// ─── Show round result ───────────────────────────────────
async function showRoundResult(score, distanceMeters, guessPos) {
  const actual = locations[roundIndex];
  const total  = roundScores.reduce((a, b) => a + b, 0);

  // Update panel
  document.getElementById('result-round-num').textContent   = roundIndex + 1;
  document.getElementById('result-actual-coords').textContent = formatCoords(actual.lat, actual.lng);
  document.getElementById('result-total-score').textContent   = total.toLocaleString();
  document.getElementById('result-total-max').textContent     = `${(roundIndex + 1) * MAX_SCORE}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (guessPos === null) {
    document.getElementById('result-distance').textContent    = 'Timed out';
    document.getElementById('result-guess-coords').textContent = '—';
  } else {
    document.getElementById('result-distance').textContent    = formatDistance(distanceMeters);
    document.getElementById('result-guess-coords').textContent = formatCoords(guessPos.lat, guessPos.lng);
  }

  // Animate score counter
  const scoreEl = document.getElementById('result-round-score');
  scoreEl.className = 'result-score-value ' + scoreClass(score);
  animateCounter(scoreEl, 0, score, 800);

  showScreen('screen-round-result');

  // Init result map (only once)
  if (!resultMap) {
    resultMap = new googleMaps.Map(document.getElementById('result-map'), {
      zoom: 2,
      center: { lat: 20, lng: 0 },
      mapTypeId: 'roadmap',
      mapId: 'DEMO_MAP_ID',
      disableDefaultUI: false,
      zoomControl: true,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
    });
    resultMap._overlays = [];
  }

  // Clear old overlays
  resultMap._overlays.forEach(o => o.setMap ? o.setMap(null) : (o.map = null));
  resultMap._overlays = [];

  const { AdvancedMarkerElement } = await googleMaps.importLibrary('marker');

  // Actual location marker (green)
  const actualMarker = new AdvancedMarkerElement({
    map: resultMap,
    position: { lat: actual.lat, lng: actual.lng },
    content: createPin('#4ade80', 22),
    title: 'Actual location',
  });
  resultMap._overlays.push(actualMarker);

  const bounds = new googleMaps.LatLngBounds();
  bounds.extend({ lat: actual.lat, lng: actual.lng });

  if (guessPos !== null) {
    // Guess marker (red)
    const guessResultMarker = new AdvancedMarkerElement({
      map: resultMap,
      position: guessPos,
      content: createPin('#f87171', 22),
      title: 'Your guess',
    });
    resultMap._overlays.push(guessResultMarker);

    // Line between guess and actual
    const line = new googleMaps.Polyline({
      path: [guessPos, { lat: actual.lat, lng: actual.lng }],
      geodesic: true,
      strokeColor: '#f87171',
      strokeOpacity: 0.9,
      strokeWeight: 2,
      map: resultMap,
    });
    resultMap._overlays.push(line);
    bounds.extend(guessPos);
  }

  // Fit bounds after resize so tiles load at correct zoom
  setTimeout(() => {
    googleMaps.event.trigger(resultMap, 'resize');
    if (!bounds.isEmpty()) {
      resultMap.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
    }
    if (guessPos === null) {
      // Center on actual location with a reasonable zoom
      resultMap.setCenter({ lat: actual.lat, lng: actual.lng });
      resultMap.setZoom(6);
    }
  }, 150);
}

// ─── Show final results ───────────────────────────────────
async function showFinalResults() {
  // Defensive guard
  if (!Array.isArray(window._allGuesses)) window._allGuesses = [];

  const total  = roundScores.reduce((a, b) => a + b, 0);
  const rating = getRating(total);

  // Animate total score
  const scoreEl = document.getElementById('final-total-score');
  animateCounter(scoreEl, 0, total, 1200);

  // Rating badge
  const ratingEl = document.getElementById('final-rating');
  ratingEl.textContent = rating.label;
  ratingEl.className   = `final-rating ${rating.cls}`;

  // Per-round breakdown — iterate exactly TOTAL_ROUNDS times
  const breakdownEl = document.getElementById('final-rounds-breakdown');
  breakdownEl.innerHTML = '';
  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const s   = roundScores[i] ?? 0;
    const pct = (s / MAX_SCORE) * 100;
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    row.innerHTML = `
      <span class="breakdown-round-num">Round ${i + 1}</span>
      <div class="breakdown-bar-wrap">
        <div class="breakdown-bar" style="width: 0%; background: ${barColor(s)}"></div>
      </div>
      <span class="breakdown-score">${s.toLocaleString()}</span>
    `;
    breakdownEl.appendChild(row);
    // Animate bar after render
    setTimeout(() => {
      row.querySelector('.breakdown-bar').style.width = `${pct}%`;
    }, 100 + i * 80);
  }

  showScreen('screen-final');

  // Update save section auth state
  updateFinalAuthUI();

  // Init final map (only once)
  if (!finalMap) {
    finalMap = new googleMaps.Map(document.getElementById('final-map'), {
      zoom: 2,
      center: { lat: 20, lng: 0 },
      mapTypeId: 'roadmap',
      mapId: 'DEMO_MAP_ID',
      disableDefaultUI: false,
      zoomControl: true,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
    });
    finalMap._overlays = [];
  }

  // Clear old overlays (markers + lines)
  finalMap._overlays.forEach(o => o.setMap ? o.setMap(null) : (o.map = null));
  finalMap._overlays = [];

  const { AdvancedMarkerElement } = await googleMaps.importLibrary('marker');
  const bounds = new googleMaps.LatLngBounds();

  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const actual = locations[i];
    const guess  = window._allGuesses[i];

    // Always show actual location marker
    const aMarker = new AdvancedMarkerElement({
      map: finalMap,
      position: { lat: actual.lat, lng: actual.lng },
      content: createPin('#4ade80', 18),
    });
    finalMap._overlays.push(aMarker);
    bounds.extend({ lat: actual.lat, lng: actual.lng });

    if (!guess) continue; // timed-out round — no guess marker or line

    // Guess marker
    const gMarker = new AdvancedMarkerElement({
      map: finalMap,
      position: guess,
      content: createPin('#f87171', 18),
    });
    finalMap._overlays.push(gMarker);

    // Line
    const line = new googleMaps.Polyline({
      path: [guess, { lat: actual.lat, lng: actual.lng }],
      geodesic: true,
      strokeColor: '#f87171',
      strokeOpacity: 0.6,
      strokeWeight: 1.5,
      map: finalMap,
    });
    finalMap._overlays.push(line);

    bounds.extend(guess);
  }

  setTimeout(() => {
    googleMaps.event.trigger(finalMap, 'resize');
    if (!bounds.isEmpty()) {
      finalMap.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
    }
  }, 150);
}

// ─── Animate counter ─────────────────────────────────────
function animateCounter(el, from, to, duration) {
  if (el._rafId) cancelAnimationFrame(el._rafId);
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = Math.round(from + (to - from) * ease).toLocaleString();
    if (t < 1) el._rafId = requestAnimationFrame(step);
    else el._rafId = null;
  }
  el._rafId = requestAnimationFrame(step);
}

// ─── Bar color by score ───────────────────────────────────
function barColor(score) {
  if (score >= 4500) return '#fbbf24';
  if (score >= 2500) return '#4ade80';
  if (score >= 1000) return '#fb923c';
  return '#f87171';
}

// ─── Load Google Maps API dynamically ────────────────────
function loadGoogleMapsAPI(key) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(); return; }

    if (!key || key === 'YOUR_MAPS_KEY' || key === 'YOUR_API_KEY_HERE') {
      reject(new Error('NO_API_KEY'));
      return;
    }

    // Clean up callback after it fires
    window.__mapsCallback = () => { delete window.__mapsCallback; resolve(); };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=geometry,marker,streetView&callback=__mapsCallback&loading=async`;
    script.onerror = () => reject(new Error('SCRIPT_LOAD_FAILED'));
    document.head.appendChild(script);
  });
}

// ─── Initialize Maps objects ─────────────────────────────
async function initMaps() {
  googleMaps = google.maps;
  svService  = new googleMaps.StreetViewService();

  // Street View Panorama
  panorama = new googleMaps.StreetViewPanorama(
    document.getElementById('street-view-pano'),
    {
      position:            { lat: 48.857, lng: 2.295 },
      pov:                 { heading: 0, pitch: 0 },
      zoom:                1,
      addressControl:      false,
      showRoadLabels:      false,
      linksControl:        true,
      panControl:          true,
      zoomControl:         true,
      fullscreenControl:   false,
      motionTracking:      false,
      motionTrackingControl: false,
      enableCloseButton:   false,
    }
  );

  // Guess mini-map
  guessMap = new googleMaps.Map(document.getElementById('mini-map'), {
    zoom: 2,
    center: { lat: 20, lng: 0 },
    mapTypeId: 'roadmap',
    mapId: 'DEMO_MAP_ID',
    disableDefaultUI: true,
    clickableIcons: false,
    gestureHandling: 'greedy',
  });

  // Click on mini-map to place guess
  guessMap.addListener('click', (e) => {
    placeGuessMarker(e.latLng).catch(err => console.error('Failed to place marker:', err));
  });

  // No Move enforcement — lock the pano when NMPZ mode is active.
  // setOptions alone isn't reliable; tracking pano_changed is the correct approach.
  panorama.addListener('pano_changed', () => {
    if (!gameConfig.noMove) return;
    const pano = panorama.getPano();
    if (!_nmpzPanoId) {
      // First fire after loadRound → this is the starting panorama, lock it.
      _nmpzPanoId = pano;
    } else if (pano !== _nmpzPanoId) {
      // User navigated away — snap back.
      panorama.setPano(_nmpzPanoId);
    }
  });
}

// ─── Start a new game ────────────────────────────────────
async function startNewGame() {
  roundIndex         = 0;
  roundScores        = [];
  locations          = [];
  window._allGuesses = [];

  showScreen('screen-loading');

  try {
    await prefetchLocations();
  } catch (err) {
    alert('Failed to load locations. Please check your API key and try again.\n\n' + err.message);
    showScreen('screen-home');
    return;
  }

  loadRound(0);
}

// ─── Submit guess ─────────────────────────────────────────
function submitGuess() {
  if (!guessLatLng) return;

  // Stop timer
  stopTimer();

  // Prevent double-submission
  document.getElementById('btn-guess').disabled = true;

  const actual = locations[roundIndex];
  const actualLatLng = new googleMaps.LatLng(actual.lat, actual.lng);

  const distanceMeters = googleMaps.geometry.spherical.computeDistanceBetween(
    guessLatLng,
    actualLatLng
  );

  const score = calculateScore(distanceMeters);
  roundScores.push(score);

  const guessPos = { lat: guessLatLng.lat(), lng: guessLatLng.lng() };
  // Store guess for final map
  window._allGuesses.push(guessPos);

  showRoundResult(score, distanceMeters, guessPos);
}

// ─── Next round or final results ─────────────────────────
function nextRound() {
  stopTimer();
  roundIndex++;
  if (roundIndex >= TOTAL_ROUNDS) {
    showFinalResults();
  } else {
    loadRound(roundIndex);
  }
}

// ─── Play again ───────────────────────────────────────────
function playAgain() {
  stopTimer();

  // Clear guess marker
  if (guessMarker) {
    guessMarker.map = null;
    guessMarker = null;
  }
  // Clear result map overlays
  if (resultMap) {
    resultMap._overlays?.forEach(o => o.setMap ? o.setMap(null) : (o.map = null));
    resultMap._overlays = [];
  }
  // Clear final map overlays
  if (finalMap) {
    finalMap._overlays?.forEach(o => o.setMap ? o.setMap(null) : (o.map = null));
    finalMap._overlays = [];
  }
  startNewGame();
}

// ─── Exit modal ───────────────────────────────────────────
function showExitModal() {
  document.getElementById('exit-modal').classList.add('visible');
}

function hideExitModal() {
  document.getElementById('exit-modal').classList.remove('visible');
}

function exitToHome() {
  hideExitModal();
  stopTimer();
  if (guessMarker) { guessMarker.map = null; guessMarker = null; }
  showScreen('screen-home');
}

// ─── Show API key error ───────────────────────────────────
function showApiKeyError() {
  const homeContent = document.querySelector('.home-content');
  const existing = document.getElementById('api-key-error');
  if (existing) return;

  const errDiv = document.createElement('div');
  errDiv.id = 'api-key-error';
  errDiv.style.cssText = `
    background: rgba(248,113,113,0.1);
    border: 1px solid #f87171;
    border-radius: 8px;
    padding: 16px 20px;
    font-size: 0.85rem;
    color: #fca5a5;
    line-height: 1.6;
    text-align: left;
    width: 100%;
  `;
  errDiv.innerHTML = `
    <strong style="color:#f87171; display:block; margin-bottom:6px;">&#9888;&#65039; API Key Required</strong>
    Start the server with <code style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px;">node server.js</code>
    and open <a href="http://localhost:3000" style="color:#60a5fa;">http://localhost:3000</a>.<br><br>
    The server reads your API key from <code style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px;">.env</code> automatically.
  `;

  const btn = document.getElementById('btn-new-game');
  homeContent.insertBefore(errDiv, btn);
  btn.disabled = true;
}

// ─── Boot ─────────────────────────────────────────────────
async function boot() {
  if (boot._initialized) return;
  boot._initialized = true;

  loadConfig();           // from localStorage
  showScreen('screen-home');
  updateConfigUI();       // reflect loaded config in button groups

  // Try to get config: first from injected APP_CONFIG, fallback to /api/config
  let mapsKey = window.APP_CONFIG?.mapsKey;
  if (!mapsKey || mapsKey === 'YOUR_MAPS_KEY') {
    try {
      const resp = await fetch('/api/config');
      if (resp.ok) {
        const cfg = await resp.json();
        mapsKey = cfg.mapsKey;
        if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
          initSupabase(cfg.supabaseUrl, cfg.supabaseAnonKey);
        }
      }
    } catch {
      // ignore — no server or network error
    }
  } else {
    initSupabase(window.APP_CONFIG.supabaseUrl, window.APP_CONFIG.supabaseAnonKey);
  }

  // Check existing Supabase session
  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    currentUser = session?.user ?? null;
    updateAuthUI();
  }

  // Wire up buttons
  document.getElementById('btn-new-game').addEventListener('click', () => startNewGame());
  document.getElementById('btn-exit-game').addEventListener('click', () => showExitModal());
  document.getElementById('btn-exit-cancel').addEventListener('click', () => hideExitModal());
  document.getElementById('btn-exit-confirm').addEventListener('click', () => exitToHome());
  document.getElementById('exit-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideExitModal(); // click backdrop to dismiss
  });
  document.getElementById('btn-guess').addEventListener('click', () => submitGuess());
  document.getElementById('btn-next-round').addEventListener('click', () => nextRound());
  document.getElementById('btn-play-again').addEventListener('click', () => playAgain());
  document.getElementById('btn-share').addEventListener('click', () => copyShareCard());
  document.getElementById('btn-leaderboard').addEventListener('click', () => showLeaderboard());
  document.getElementById('btn-lb-back').addEventListener('click', () => showScreen('screen-home'));
  document.getElementById('btn-save-score').addEventListener('click', () => handleSaveScore());
  document.getElementById('btn-final-sign-in').addEventListener('click', () => signInWithGoogle());
  document.getElementById('btn-final-leaderboard').addEventListener('click', () => showLeaderboard());

  // Mini-map toggle
  document.getElementById('mini-map-toggle').addEventListener('click', e => {
    e.stopPropagation();
    setMiniMapExpanded(!miniMapExpanded);
  });
  document.getElementById('mini-map-header').addEventListener('click', () => {
    setMiniMapExpanded(!miniMapExpanded);
  });

  // Config button groups
  document.querySelectorAll('.config-btn-group').forEach(group => {
    group.addEventListener('click', e => {
      const btn = e.target.closest('button[data-config]');
      if (!btn) return;
      const key = group.dataset.key;
      let val = btn.dataset.config;
      // coerce types
      if (key === 'timer') val = parseInt(val, 10);
      if (key === 'noMove') val = val === 'true';
      gameConfig[key] = val;
      saveConfig();
      group.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Load Maps
  try {
    await loadGoogleMapsAPI(mapsKey);
    await initMaps();
  } catch (err) {
    if (err.message === 'NO_API_KEY') showApiKeyError();
    else { console.error('Maps load failed:', err); showApiKeyError(); }
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
