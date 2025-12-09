// app.js
// Minimal QMemorize front-end wiring with Firebase (Auth + Firestore).
// NOTE: This file uses the compat modules referenced in index.html and simple functions.
// Your firebaseConfig is inserted here.

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js";
import { getAuth, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js";

/* ====== YOUR FIREBASE CONFIG ====== */
const firebaseConfig = {
  apiKey: "AIzaSyBKLVF9ZWAg4VuDvtSOdzy7WfsKQde4Afc",
  authDomain: "hifz-39dcc.firebaseapp.com",
  projectId: "hifz-39dcc",
  storageBucket: "hifz-39dcc.firebasestorage.app",
  messagingSenderId: "929409407098",
  appId: "1:929409407098:web:82476490b6a1c4b99f83c3",
  measurementId: "G-BM1GM34H0B"
};
/* ================================== */

const app = initializeApp(firebaseConfig);
const auth = getAuth();
const db = getFirestore();

/* ====== SAMPLE QURAN DATA (small for demo) ======
 Replace with full dataset (e.g., /data/quran.json), or store `quran/surahs` & `quran/pages` in Firestore.
=================================================*/
const Q = {
  surahs: [
    { id: 67, name: "Al-Mulk", ayahCount: 30, ayahs: Array.from({length:30}, (_,i)=>({number:i+1, text:`آية ${i+1} من سورة الملك — نص تجريبي`})) },
    { id: 1, name: "Al-Fatihah", ayahCount: 7, ayahs: Array.from({length:7}, (_,i)=>({number:i+1, text:`سورة الفاتحة آية ${i+1}`})) },
  ]
};

/* ====== Selectors & UI references ====== */
const el = s => document.querySelector(s);
const elAll = s => Array.from(document.querySelectorAll(s));
const pages = {
  home: el('#page-home'),
  memorize: el('#page-memorize'),
  ayah: el('#page-ayah'),
  revision: el('#page-revision')
};

const navRight = el('#nav-right');
const loginModal = el('#login-modal');
const btnLogin = el('#btn-login');
const btnLogout = el('#btn-logout');
const loginForm = el('#login-form');
const googleBtn = el('#btn-google');
const startMemorizeBtn = el('#start-memorize');
const surahListEl = el('#surah-list');
const ayahContainer = el('#ayah-container');
const startMarkBtn = el('#mark-memorized');
const progressWidget = el('#progress-widget');
const weeklyCountEl = el('#weekly-count');
const streakEl = el('#streak');
const continueLine = el('#continue-line');
const revisionPage = el('#page-revision');
const weekSelect = el('#week-select');
const btnStartWeek = el('#btn-start-week');

const backToSurahsBtn = el('#back-to-surahs');
const prev3Btn = el('#prev-3');
const next3Btn = el('#next-3');
const playAudioBtn = el('#play-audio');

let currentUser = null;
let userProgress = {}; // { "surah_ayah": { ... } }
let currentSurah = null;
let todayChunk = { start: 1, end: 3 }; // default 1-3
let chunkStartAyah = 1;

/* ====== UI helpers ====== */
function showPage(name){
  Object.values(pages).forEach(p=>p.classList.add('hidden'));
  pages[name].classList.remove('hidden');
  window.scrollTo(0,0);
}

function showLoginModal(show=true){
  if(show) loginModal.classList.remove('hidden');
  else loginModal.classList.add('hidden');
}

/* ====== Auth handlers ====== */
btnLogin.addEventListener('click', ()=> showLoginModal(true));
el('#close-login').addEventListener('click', ()=> showLoginModal(false));
el('#forgot-pw').addEventListener('click', (e)=>{ e.preventDefault(); alert('Password reset will be implemented via Firebase console password reset.'); });

loginForm.addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const email = el('#email').value.trim();
  const password = el('#password').value.trim();
  try{
    await signInWithEmailAndPassword(auth, email, password);
    showLoginModal(false);
  }catch(err){
    // If user not found, create an account for convenience
    if(err.code === 'auth/user-not-found'){
      try{
        await createUserWithEmailAndPassword(auth, email, password);
        showLoginModal(false);
      }catch(e){ alert(e.message); }
    }else{
      alert(err.message);
    }
  }
});

googleBtn.addEventListener('click', async ()=>{
  const provider = new GoogleAuthProvider();
  try{
    await signInWithPopup(auth, provider);
    showLoginModal(false);
  }catch(e){ alert(e.message); }
});

btnLogout.addEventListener('click', async ()=>{
  await signOut(auth);
});

/* ====== Auth state change ====== */
onAuthStateChanged(auth, async (user)=>{
  currentUser = user;
  if(user){
    btnLogin.classList.add('d-none');
    btnLogout.classList.remove('d-none');
    await ensureUserDoc(user);
    await loadUserProgress();
    renderSurahList();
    showRevisionIfNeeded();
    showUserProgressWidget();
  } else {
    btnLogin.classList.remove('d-none');
    btnLogout.classList.add('d-none');
    userProgress = {};
    hideRevisionNav();
    progressWidget.classList.add('d-none');
    renderSurahList(); // show list but not progress
  }
});

/* ====== Firestore helpers ====== */
async function ensureUserDoc(user){
  const uref = doc(db, 'users', user.uid);
  const snap = await getDoc(uref);
  if(!snap.exists()){
    await setDoc(uref, {
      uid: user.uid,
      email: user.email||null,
      createdAt: serverTimestamp()
    });
  }
}

/* ===== Load per-user ayah progress (users/{uid}/ayahProgress/{id}) ===== */
async function loadUserProgress(){
  userProgress = {};
  if(!currentUser) return;
  try{
    const colRef = collection(db, `users/${currentUser.uid}/ayahProgress`);
    const snap = await getDocs(colRef);
    snap.forEach(d => {
      const data = d.data();
      // key: `${surah}_${ayah}`
      const key = `${data.surahId}_${data.ayahNumber}`;
      userProgress[key] = data;
    });
  }catch(e){
    console.warn('loadUserProgress error:', e.message);
  }
}

/* ====== Render Surah List ====== */
function renderSurahList(){
  surahListEl.innerHTML = '';
  const list = Q.surahs;
  list.forEach(s => {
    const card = document.createElement('div');
    card.className = 'surah-card';
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="surah-title">${s.name}</div>
      <div class="surah-meta">${s.ayahCount} ayahs</div>
      <div class="surah-progress tiny muted">${calcSurahProgress(s.id)} memorized</div>
    `;
    card.addEventListener('click', ()=> openSurah(s.id));
    surahListEl.appendChild(card);
  });
}

/* count how many ayahs memorized in this surah (simple) */
function calcSurahProgress(surahId){
  if(!currentUser) return '0';
  let count = 0;
  const s = Q.surahs.find(x=>x.id===surahId);
  if(!s) return '0';
  for(let i=1;i<=s.ayahCount;i++){
    if(userProgress[`${surahId}_${i}`] && userProgress[`${surahId}_${i}`].memorized) count++;
  }
  return `${count}/${s.ayahCount}`;
}

/* ====== Open Surah & render ayahs ====== */
function openSurah(surahId){
  currentSurah = Q.surahs.find(x=>x.id===surahId);
  if(!currentSurah) return;
  // determine today's chunk for this surah: find first non-memorized ayah or continue from saved dailyPlan
  let start = 1;
  for(let i=1;i<=currentSurah.ayahCount;i++){
    if(!(userProgress[`${surahId}_${i}`] && userProgress[`${surahId}_${i}`].memorized)){
      start = i;
      break;
    } else {
      start = Math.min(start, i+1);
    }
  }
  if(start > currentSurah.ayahCount) start = Math.max(1, currentSurah.ayahCount-2);
  chunkStartAyah = start;
  todayChunk.start = chunkStartAyah;
  todayChunk.end = Math.min(currentSurah.ayahCount, chunkStartAyah + 2);
  renderAyahView();
  showPage('ayah');
}

/* ===== Render Ayah View (digital layout) ===== */
function renderAyahView(){
  if(!currentSurah) return;
  el('#ayah-surah-title').textContent = `${currentSurah.name}`;
  el('#today-indicator').textContent = `Today's: ${todayChunk.start}–${todayChunk.end}`;
  ayahContainer.innerHTML = '';
  currentSurah.ayahs.forEach(ay => {
    const k = `${currentSurah.id}_${ay.number}`;
    const state = userProgress[k] && userProgress[k].memorized ? 'memorized' : (ay.number >= todayChunk.start && ay.number <= todayChunk.end ? 'active' : (ay.number < todayChunk.start ? 'faded' : ''));
    const div = document.createElement('div');
    div.className = 'ayah ' + (state || '');
    div.dataset.ayah = ay.number;
    div.innerHTML = `<div style="font-size:12px;color:var(--muted);margin-bottom:6px">(${ay.number})</div><div>${ay.text}</div>`;
    ayahContainer.appendChild(div);
  });
}

/* ====== Mark Today's Ayahs as Memorized ====== */
startMarkBtn.addEventListener('click', async ()=>{
  if(!currentUser){ alert('Please log in to save progress.'); showLoginModal(true); return; }
  if(!currentSurah){ alert('Open a Surah first.'); return; }
  if(!confirm(`Mark ayahs ${todayChunk.start}–${todayChunk.end} of ${currentSurah.name} as memorized for this week?`)) return;
  try{
    for(let i = todayChunk.start; i <= todayChunk.end; i++){
      const docId = `${currentSurah.id}_${i}`;
      const ref = doc(db, `users/${currentUser.uid}/ayahProgress`, docId);
      const payload = {
        surahId: currentSurah.id,
        ayahNumber: i,
        memorized: true,
        memorizedAt: serverTimestamp(),
        memorizedWeek: getISOWeekString(new Date()),
        revisionSRS: { ease: 2.5, intervalDays: 7, nextDueAt: null },
      };
      await setDoc(ref, payload, { merge: true });
      userProgress[`${currentSurah.id}_${i}`] = payload;
    }
    renderAyahView();
    showRevisionIfNeeded();
    showUserProgressWidget();
    alert('Marked as memorized. You can revise these in the Revision tab.');
  }catch(e){
    console.error('mark memorized error', e);
    alert('Could not mark memorized: ' + e.message);
  }
});

/* ====== Utility: iso week string like 2025-W49 ====== */
function getISOWeekString(d){
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}

/* ====== Show/hide Revision nav based on progress ====== */
function showRevisionIfNeeded(){
  const hasMem = Object.values(userProgress).some(v => v.memorized);
  if(hasMem) addRevisionNav();
  else hideRevisionNav();
}

function addRevisionNav(){
  if(el('#nav-revision')) return;
  const a = document.createElement('a');
  a.id = 'nav-revision';
  a.className = 'nav-item';
  a.href = '#';
  a.dataset.route = 'revision';
  a.textContent = 'Revision';
  a.addEventListener('click', (e)=>{ e.preventDefault(); openRevision(); });
  navRight.prepend(a);
}

function hideRevisionNav(){
  const n = el('#nav-revision');
  if(n) n.remove();
}

/* ====== Show simple progress widget ====== */
function showUserProgressWidget(){
  const total = Object.values(userProgress).filter(v=>v.memorized).length;
  weeklyCountEl.textContent = total;
  streakEl.textContent = '—';
  if(total > 0){
    progressWidget.classList.remove('d-none');
    continueLine.textContent = `Continue → ${currentSurah ? currentSurah.name + ' (Ayah ' + todayChunk.start + ')' : ''}`;
  } else {
    progressWidget.classList.add('d-none');
  }
}

/* ====== Navigation wiring ====== */
startMemorizeBtn.addEventListener('click', ()=> {
  renderSurahList();
  showPage('memorize');
});

elAll('.nav-item').forEach(a=> {
  a.addEventListener('click', (ev)=>{
    ev.preventDefault();
    const r = a.dataset.route;
    if(r === 'home') showPage('home');
    if(r === 'memorize') { renderSurahList(); showPage('memorize'); }
  });
});

backToSurahsBtn.addEventListener('click', ()=> { renderSurahList(); showPage('memorize'); });

prev3Btn.addEventListener('click', ()=> {
  if(!currentSurah) return;
  chunkStartAyah = Math.max(1, chunkStartAyah - 3);
  todayChunk.start = chunkStartAyah;
  todayChunk.end = Math.min(currentSurah.ayahCount, chunkStartAyah + 2);
  renderAyahView();
});

next3Btn.addEventListener('click', ()=> {
  if(!currentSurah) return;
  chunkStartAyah = Math.min(currentSurah.ayahCount - 2, chunkStartAyah + 3);
  if(chunkStartAyah < 1) chunkStartAyah = 1;
  todayChunk.start = chunkStartAyah;
  todayChunk.end = Math.min(currentSurah.ayahCount, chunkStartAyah + 2);
  renderAyahView();
});

playAudioBtn.addEventListener('click', ()=> {
  alert('Audio playback not configured in demo. You can integrate an audio source per ayah and play it here.');
});

/* ====== Revision / Weekly flows (basic) ====== */
function openRevision(){
  const weeks = new Set();
  Object.values(userProgress).forEach(v => {
    if(v.memorizedWeek) weeks.add(v.memorizedWeek);
  });
  weekSelect.innerHTML = '';
  Array.from(weeks).forEach(w => {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = w;
    weekSelect.appendChild(opt);
  });
  showPage('revision');
}

btnStartWeek.addEventListener('click', ()=> {
  const week = weekSelect.value;
  if(!week){ alert('No week selected.'); return; }
  const ayahs = Object.values(userProgress).filter(v => v.memorizedWeek === week);
  if(ayahs.length === 0){ alert('No ayahs for selected week.'); return; }
  alert(`Starting weekly revision for ${week} — ${ayahs.length} ayahs (demo)`);
});

/* ====== Initial render ====== */
renderSurahList();
showPage('home');
