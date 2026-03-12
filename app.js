/* ══════════════════════════════════════════════════
   NDALAMA — app.js
   Firebase Auth + Firestore (no Storage — photo
   stored as base64 string directly in Firestore)
   ══════════════════════════════════════════════════ */

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword,
         signInWithEmailAndPassword, signOut,
         sendPasswordResetEmail, GoogleAuthProvider,
         signInWithPopup, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, addDoc, deleteDoc,
         doc, onSnapshot, query, orderBy, setDoc, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ── FIREBASE INIT ─────────────────────────── */
const firebaseConfig = {
  apiKey:            "AIzaSyC-mcl-2pLwqnD-4MlbWMFSGq1p7-eMd7g",
  authDomain:        "ndalama-tracker.firebaseapp.com",
  projectId:         "ndalama-tracker",
  storageBucket:     "ndalama-tracker.firebasestorage.app",
  messagingSenderId: "296131026271",
  appId:             "1:296131026271:web:9b9be7d09cd7e045dfaaea",
  measurementId:     "G-YKYL1MXBKP"
};

const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);

/* ── STATE ─────────────────────────────────── */
let currentUser    = null;
let userProfile    = {};
let expenses       = [];
let expenseUnsub   = null;
let selectedGender = 'Male';
let pendingPhotoB64= null;   // base64 for signup photo
let budget         = 0;
let notifEnabled   = false;
let reminderTime   = '18:00';
let analysisPeriod = 'week';
let editingField   = '';

const ICONS = {
  'Food & Groceries':'🍽️','Transport':'🚌','Housing & Rent':'🏠',
  'Health & Medical':'💊','Education':'📚','Entertainment':'🎬',
  'Clothing':'👕','Utilities':'💡','Other':'📌'
};

/* ════════════════════════════════════════════
   SCREEN NAVIGATION
   ════════════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
window.showScreen = showScreen;

/* ════════════════════════════════════════════
   SPLASH → AUTH STATE
   ════════════════════════════════════════════ */
setTimeout(() => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      await loadProfile();
      startExpenseListener();
      loadPrefs();
      showScreen('screenApp');
      document.querySelector('.fab').classList.add('show');
      document.querySelector('.bot-nav').classList.add('show');
      updateTopbar();
      updateProfileView();
      renderHome();
    } else {
      showScreen('screenLogin');
    }
  });
}, 2200);

/* ════════════════════════════════════════════
   AUTH — LOGIN
   ════════════════════════════════════════════ */
async function handleLogin() {
  const email = v('loginEmail');
  const pw    = v('loginPassword');
  if (!email || !pw) { toast('Please fill in all fields.'); return; }
  const btn = lockBtn('btn-login', 'Signing in...');
  try {
    await signInWithEmailAndPassword(auth, email, pw);
  } catch (e) {
    toast(friendlyError(e.code));
  } finally { btn && (btn.disabled = false, btn.textContent = 'SIGN IN'); }
}
window.handleLogin = handleLogin;

/* ── GOOGLE LOGIN ─────────────────────────── */
async function handleGoogleLogin() {
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const user   = result.user;
    const snap   = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) {
      // First time Google user — pre-fill profile
      await setDoc(doc(db, 'users', user.uid), {
        fullName:  user.displayName || '',
        nickname:  (user.displayName || 'User').split(' ')[0],
        email:     user.email,
        phone:     '',
        dob:       '',
        gender:    '',
        photoURL:  user.photoURL || ''
      });
    }
  } catch (e) {
    toast(friendlyError(e.code));
  }
}
window.handleGoogleLogin = handleGoogleLogin;

/* ── FORGOT PASSWORD ──────────────────────── */
async function handleForgotPassword() {
  const email = v('forgotEmail');
  if (!email) { toast('Please enter your email.'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    toast('✉️ Reset link sent! Check your inbox.');
    showScreen('screenLogin');
  } catch (e) {
    toast(friendlyError(e.code));
  }
}
window.handleForgotPassword = handleForgotPassword;

/* ════════════════════════════════════════════
   AUTH — SIGN UP STEP 1
   ════════════════════════════════════════════ */
function handleSignup1() {
  const email   = v('su1Email');
  const pw      = v('su1Password');
  const confirm = v('su1Confirm');

  if (!email || !pw || !confirm) { toast('Please fill in all fields.'); return; }
  if (!isValidEmail(email))      { toast('Please enter a valid email address.'); return; }

  const strength = getStrength(pw);
  if (strength < 5) { toast('Password does not meet all requirements.'); return; }
  if (pw !== confirm) { toast('Passwords do not match.'); return; }

  // Store for step 2
  window._su1 = { email, pw };
  showScreen('screenSignup2');
}
window.handleSignup1 = handleSignup1;

/* ── SIGN UP STEP 2 ───────────────────────── */
async function handleSignup2() {
  const name  = v('su2Name');
  const nick  = v('su2Nick');
  const phone = v('su2Phone');
  const dob   = v('su2DOB');

  if (!name || !nick || !phone || !dob) { toast('Please fill in all required fields.'); return; }

  const { email, pw } = window._su1 || {};
  if (!email || !pw) { showScreen('screenSignup1'); return; }

  const btn = document.querySelector('#screenSignup2 .btn-primary');
  btn.disabled    = true;
  btn.textContent = 'Creating account...';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    const uid  = cred.user.uid;

    // Compress photo and save as base64 string directly in Firestore
    // (no Firebase Storage needed — free tier friendly)
    let photoURL = '';
    if (pendingPhotoB64) {
      photoURL = await compressPhoto(pendingPhotoB64, 200);
    }

    await setDoc(doc(db, 'users', uid), {
      fullName: name, nickname: nick, email,
      phone, dob, gender: selectedGender, photoURL
    });

    toast('🎉 Account created! Welcome!');
  } catch (e) {
    toast(friendlyError(e.code));
    btn.disabled    = false;
    btn.textContent = 'CREATE MY ACCOUNT 🎉';
  }
}
window.handleSignup2 = handleSignup2;

/* ── PASSWORD STRENGTH ────────────────────── */
function checkStrength(pw) {
  const rules = {
    'r-len':  pw.length >= 8,
    'r-up':   /[A-Z]/.test(pw),
    'r-lo':   /[a-z]/.test(pw),
    'r-num':  /[0-9]/.test(pw),
    'r-sym':  /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)
  };

  let score = Object.values(rules).filter(Boolean).length;

  Object.entries(rules).forEach(([id, pass]) => {
    document.getElementById(id)?.classList.toggle('pass', pass);
  });

  const fill  = document.getElementById('strengthFill');
  const txt   = document.getElementById('strengthTxt');
  if (!fill || !txt) return;

  const map = [
    [0, '0%',   '#ccc',          ''],
    [1, '20%',  '#e53e3e',       'Very Weak'],
    [2, '40%',  '#e53e3e',       'Weak'],
    [3, '60%',  '#dd6b20',       'Fair'],
    [4, '80%',  '#1BC9C9',       'Strong'],
    [5, '100%', 'var(--green)',  'Very Strong']
  ];

  const [,w,bg,label] = map[score] || map[0];
  fill.style.width      = w;
  fill.style.background = bg;
  txt.textContent       = label;
  txt.style.color       = bg;
}
window.checkStrength = checkStrength;

function getStrength(pw) {
  let s = 0;
  if (pw.length >= 8)   s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[a-z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)) s++;
  return s;
}

/* ── GENDER PICKER ────────────────────────── */
function pickGender(g) {
  selectedGender = g;
  document.getElementById('gBtn-Male').classList.toggle('active',   g === 'Male');
  document.getElementById('gBtn-Female').classList.toggle('active', g === 'Female');
}
window.pickGender = pickGender;

/* ── PHOTO PREVIEW (signup) ───────────────── */
function previewPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    pendingPhotoB64 = e.target.result;
    const img = document.getElementById('photoPreviewImg');
    const ph  = document.getElementById('photoPlaceholder');
    img.src   = pendingPhotoB64;
    img.style.display = 'block';
    if (ph) ph.style.display = 'none';
  };
  reader.readAsDataURL(file);
}
window.previewPhoto = previewPhoto;

/* ── TOGGLE PASSWORD VISIBILITY ───────────── */
function togglePw(id, btn) {
  const inp = document.getElementById(id);
  if (!inp) return;
  inp.type  = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}
window.togglePw = togglePw;

/* ════════════════════════════════════════════
   LOGOUT / PASSWORD CHANGE
   ════════════════════════════════════════════ */
async function handleLogout() {
  if (!confirm('Sign out of Ndalama?')) return;
  if (expenseUnsub) expenseUnsub();
  await signOut(auth);
  expenses = []; userProfile = {}; currentUser = null;
  showScreen('screenLogin');
  document.querySelector('.fab').classList.remove('show');
  document.querySelector('.bot-nav').classList.remove('show');
}
window.handleLogout = handleLogout;

async function handleChangePassword() {
  if (!currentUser?.email) return;
  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    toast('✉️ Password reset link sent to ' + currentUser.email);
  } catch (e) {
    toast(friendlyError(e.code));
  }
}
window.handleChangePassword = handleChangePassword;

/* ════════════════════════════════════════════
   PROFILE — LOAD / UPDATE
   ════════════════════════════════════════════ */
async function loadProfile() {
  if (!currentUser) return;
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    if (snap.exists()) userProfile = snap.data();
  } catch (e) { console.error(e); }
}

function updateTopbar() {
  const nick = userProfile.nickname || 'there';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const el = document.getElementById('tbGreeting');
  if (el) el.textContent = `${greet}, ${nick}!`;

  const dateEl = document.getElementById('tbDate');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});

  // Avatar
  const img = document.getElementById('tbAvatar');
  const fb  = document.getElementById('tbAvatarFb');
  const url = userProfile.photoURL || currentUser?.photoURL;
  if (url && img) {
    img.src           = url;
    img.style.display = 'block';
    if (fb) fb.style.display = 'none';
  } else {
    if (img) img.style.display = 'none';
    if (fb)  fb.style.display  = 'flex';
  }
}

function updateProfileView() {
  setText('profName',    userProfile.fullName  || '—');
  setText('profEmail',   userProfile.email     || currentUser?.email || '—');
  setText('pr-nickname', userProfile.nickname  || '—');
  setText('pr-phone',    userProfile.phone     || '—');
  setText('pr-dob',      userProfile.dob ? new Date(userProfile.dob).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—');
  setText('pr-gender',   userProfile.gender    || '—');

  const img = document.getElementById('profAvatar');
  const fb  = document.getElementById('profAvaFb');
  const url = userProfile.photoURL || currentUser?.photoURL;
  if (url && img) {
    img.src = url; img.style.display = 'block';
    if (fb) fb.style.display = 'none';
  } else {
    if (img) img.style.display = 'none';
    if (fb)  fb.style.display  = 'flex';
  }

  updatePrefRows();
}

function updatePrefRows() {
  const rEl = document.getElementById('pr-reminder');
  if (rEl) rEl.textContent = notifEnabled ? formatTime12hr(reminderTime) + ' daily' : 'Not set';
  const bEl = document.getElementById('pr-budget');
  if (bEl) bEl.textContent = budget ? fmt(budget) + ' / month' : 'Not set';
}

/* ── EDIT PROFILE FIELD ───────────────────── */
function editProfileField(field, label) {
  editingField = field;
  document.getElementById('editFldTitle').textContent = 'Edit ' + label;
  document.getElementById('editFldInput').value = userProfile[field] || '';
  openModal('editFldModal');
}
window.editProfileField = editProfileField;

async function saveProfileField() {
  const val = document.getElementById('editFldInput').value.trim();
  if (!val || !editingField || !currentUser) return;
  try {
    userProfile[editingField] = val;
    await setDoc(doc(db, 'users', currentUser.uid), userProfile);
    closeModal('editFldModal');
    updateTopbar();
    updateProfileView();
    toast('✓ Saved!');
  } catch (e) { toast('Could not save. Check your connection.'); }
}
window.saveProfileField = saveProfileField;

/* ── UPDATE PROFILE PHOTO ─────────────────── */
async function updateProfilePhoto(input) {
  const file = input.files[0];
  if (!file || !currentUser) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      // Compress to a small size before saving to Firestore
      const compressed = await compressPhoto(e.target.result, 200);
      userProfile.photoURL = compressed;
      await setDoc(doc(db, 'users', currentUser.uid), userProfile);
      updateTopbar();
      updateProfileView();
      toast('✓ Profile photo updated!');
    } catch (err) {
      console.error(err);
      toast('Could not save photo. Try a smaller image.');
    }
  };
  reader.readAsDataURL(file);
}
window.updateProfilePhoto = updateProfilePhoto;

/* ════════════════════════════════════════════
   EXPENSES — FIRESTORE LISTENER
   ════════════════════════════════════════════ */
function startExpenseListener() {
  if (!currentUser) return;
  if (expenseUnsub) expenseUnsub();
  const q = query(
    collection(db, 'users', currentUser.uid, 'expenses'),
    orderBy('createdAt', 'desc')
  );
  expenseUnsub = onSnapshot(q, snap => {
    expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHome();
    renderAnalysis();
    renderHistory();
  }, err => {
    console.error(err);
    toast('⚠️ Could not sync expenses.');
  });
}

/* ── ADD EXPENSE ──────────────────────────── */
async function addExpense() {
  const date = document.getElementById('expDate')?.value;
  const cat  = document.getElementById('expCat')?.value;
  const desc = document.getElementById('expDesc')?.value.trim() || '';
  const amt  = parseFloat(document.getElementById('expAmt')?.value);

  if (!date)              { toast('Please select a date.');         return; }
  if (!amt || amt <= 0)   { toast('Please enter a valid amount.');  return; }
  if (!currentUser)       { toast('Not signed in.');                return; }

  const btn = document.querySelector('#addModal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    await addDoc(collection(db, 'users', currentUser.uid, 'expenses'), {
      date, category: cat, description: desc, amount: amt, createdAt: Date.now()
    });
    closeModal('addModal');
    document.getElementById('expAmt').value  = '';
    document.getElementById('expDesc').value = '';
    toast('✓ Expense saved — ' + fmt(amt));
  } catch (e) {
    toast('⚠️ Failed to save. Check connection.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'SAVE EXPENSE'; }
  }
}
window.addExpense = addExpense;

/* ── DELETE EXPENSE ───────────────────────── */
async function deleteExpense(id) {
  if (!currentUser) return;
  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'expenses', id));
    toast('Expense removed.');
  } catch (e) { toast('⚠️ Could not delete.'); }
}
window.deleteExpense = deleteExpense;

/* ════════════════════════════════════════════
   RENDER — HOME
   ════════════════════════════════════════════ */
function renderHome() {
  const now   = new Date();
  const today = now.toISOString().split('T')[0];

  // Today
  const todayAmt = expenses.filter(e => e.date === today).reduce((s,e)=>s+e.amount,0);
  setText('sToday', fmtShort(todayAmt));

  // Week
  const ws = weekStart();
  const wkAmt = expenses.filter(e => new Date(e.date) >= ws).reduce((s,e)=>s+e.amount,0);
  setText('sWeek', fmtShort(wkAmt));

  // Month
  const mExp = monthExpenses(now.getMonth(), now.getFullYear());
  const mAmt = mExp.reduce((s,e)=>s+e.amount,0);
  setText('sMonth',  fmtShort(mAmt));
  setText('heroAmt', 'MK ' + mAmt.toLocaleString());

  // Budget bar
  const bFill = document.getElementById('budgetFill');
  const bPct  = document.getElementById('budgetPct');
  const bLbl  = document.getElementById('budgetSpentLbl');
  if (budget > 0) {
    const pct = Math.min((mAmt / budget) * 100, 100);
    if (bFill) bFill.style.width = pct.toFixed(1) + '%';
    if (bPct)  bPct.textContent  = pct.toFixed(0) + '%';
    if (bLbl)  bLbl.textContent  = fmt(mAmt) + ' of ' + fmt(budget);
    if (bFill) bFill.style.background = pct >= 90 ? '#ff6b6b' : 'white';
  } else {
    if (bFill) bFill.style.width = '0%';
    if (bPct)  bPct.textContent  = '—';
    if (bLbl)  bLbl.textContent  = 'Set a budget to track progress';
  }

  // Recent transactions (last 5)
  const recent = [...expenses].slice(0, 5);
  const el = document.getElementById('recentList');
  if (!el) return;
  if (!recent.length) {
    el.innerHTML = `<div class="empty-msg"><div class="em-ico">📭</div>No expenses yet. Tap + to add one.</div>`;
    return;
  }
  el.innerHTML = recent.map(e => txHTML(e)).join('');
}

/* ════════════════════════════════════════════
   RENDER — ANALYSIS
   ════════════════════════════════════════════ */
function renderAnalysis() {
  const now = new Date();
  let data, labels, barData;

  if (analysisPeriod === 'week') {
    const ws   = weekStart();
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    labels  = days;
    barData = days.map((_, i) => {
      const d = new Date(ws);
      d.setDate(ws.getDate() + i);
      const key = d.toISOString().split('T')[0];
      return expenses.filter(e => e.date === key).reduce((s,e)=>s+e.amount,0);
    });
    data = expenses.filter(e => new Date(e.date) >= ws);
  } else {
    const m = now.getMonth(), y = now.getFullYear();
    data    = monthExpenses(m, y);
    const daysInMonth = new Date(y, m+1, 0).getDate();
    labels  = [];
    barData = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      labels.push(d % 5 === 1 ? String(d) : '');
      barData.push(expenses.filter(e => e.date === key).reduce((s,e)=>s+e.amount,0));
    }
  }

  const max = Math.max(...barData, 1);

  // Bar chart
  const chart  = document.getElementById('barChart');
  const lblsEl = document.getElementById('barLabels');
  if (chart) {
    chart.innerHTML = barData.map((v, i) => `
      <div class="bar-col">
        <div class="bar-col-val">${v > 0 ? fmtShort(v) : ''}</div>
        <div class="bar-col-fill" style="height:${Math.max((v/max)*100,2).toFixed(1)}%"></div>
      </div>`).join('');
  }
  if (lblsEl) {
    lblsEl.innerHTML = labels.map(l => `<div class="bar-lbl">${l}</div>`).join('');
  }

  // Top categories
  const cats = {};
  data.forEach(e => { cats[e.category] = (cats[e.category]||0) + e.amount; });
  const total    = data.reduce((s,e)=>s+e.amount,0);
  const sorted   = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const topCatsEl = document.getElementById('topCats');
  if (topCatsEl) {
    topCatsEl.innerHTML = sorted.length ? sorted.map(([cat,amt]) => `
      <div class="top-cat-item">
        <div class="tc-icon">${ICONS[cat]||'📌'}</div>
        <div class="tc-info">
          <div class="tc-name">${cat}</div>
          <div class="tc-pct">${total ? ((amt/total)*100).toFixed(0) : 0}% of total</div>
        </div>
        <div class="tc-amt">${fmt(amt)}</div>
      </div>`).join('')
    : '<div class="empty-msg"><div class="em-ico">📊</div>No data for this period.</div>';
  }
}

function setPeriod(p, btn) {
  analysisPeriod = p;
  document.querySelectorAll('.p-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderAnalysis();
}
window.setPeriod = setPeriod;

/* ════════════════════════════════════════════
   RENDER — HISTORY
   ════════════════════════════════════════════ */
function renderHistory() {
  const filter = document.getElementById('histFilter')?.value;
  let data = [...expenses];
  if (filter) data = data.filter(e => e.date === filter);
  data.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  const el = document.getElementById('historyList');
  if (!el) return;

  if (!data.length) {
    el.innerHTML = `<div class="empty-msg"><div class="em-ico">📋</div>No expenses found.</div>`;
    return;
  }

  // Group by date
  const byDate = {};
  data.forEach(e => { (byDate[e.date] = byDate[e.date]||[]).push(e); });
  const dates = Object.keys(byDate).sort((a,b)=>b.localeCompare(a));

  el.innerHTML = dates.map(date => {
    const items = byDate[date];
    const total = items.reduce((s,e)=>s+e.amount,0);
    const label = new Date(date+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    return `
      <div class="tx-day-group">
        <div class="tx-day-header"><span>${label}</span><span>${fmt(total)}</span></div>
        ${items.map(e => txHTML(e)).join('')}
      </div>`;
  }).join('');
}
window.renderHistory = renderHistory;

/* ── TRANSACTION HTML ─────────────────────── */
function txHTML(e) {
  return `
    <div class="tx-item">
      <div class="tx-icon">${ICONS[e.category]||'📌'}</div>
      <div class="tx-info">
        <div class="tx-cat">${e.category}</div>
        ${e.description ? `<div class="tx-desc">${e.description}</div>` : ''}
        <div class="tx-meta">${new Date(e.date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>
      </div>
      <div class="tx-right">
        <div class="tx-amt">−${fmt(e.amount)}</div>
      </div>
      <button class="tx-del" onclick="deleteExpense('${e.id}')" title="Delete">✕</button>
    </div>`;
}

/* ════════════════════════════════════════════
   VIEW NAVIGATION
   ════════════════════════════════════════════ */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');

  // Highlight correct nav button
  const map = { viewHome:'bn-home', viewAnalysis:'bn-analysis', viewHistory:'bn-history', viewProfile:'bn-profile' };
  document.querySelectorAll('.bn-btn').forEach(b => b.classList.remove('active'));
  const navId = map[id];
  if (navId) document.getElementById(navId)?.classList.add('active');

  if (id === 'viewAnalysis') renderAnalysis();
  if (id === 'viewHistory')  renderHistory();
  if (id === 'viewProfile')  updateProfileView();

  // Set today's date when opening add modal from home
  const expDate = document.getElementById('expDate');
  if (expDate && !expDate.value) expDate.value = new Date().toISOString().split('T')[0];
}
window.showView = showView;

/* ════════════════════════════════════════════
   MODALS
   ════════════════════════════════════════════ */
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
window.openModal  = openModal;
window.closeModal = closeModal;

function openAddModal() {
  const d = document.getElementById('expDate');
  if (d && !d.value) d.value = new Date().toISOString().split('T')[0];
  openModal('addModal');
}
window.openAddModal = openAddModal;

// Close modals on backdrop click
document.querySelectorAll('.modal-ov').forEach(ov => {
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov.id); });
});

/* ── BUDGET MODAL ─────────────────────────── */
function openBudgetModal() {
  document.getElementById('budgetAmt').value = budget || '';
  openModal('budgetModal');
}
window.openBudgetModal = openBudgetModal;

function saveBudget() {
  const val = parseFloat(document.getElementById('budgetAmt')?.value);
  if (!val || val <= 0) { toast('Please enter a valid budget amount.'); return; }
  budget = val;
  localStorage.setItem('ndalama_budget_' + (currentUser?.uid || ''), val);
  closeModal('budgetModal');
  renderHome();
  updatePrefRows();
  toast('✓ Budget set to ' + fmt(val));
}
window.saveBudget = saveBudget;

/* ── REMINDER MODAL ───────────────────────── */
function openReminderModal() {
  document.getElementById('reminderTime').value = reminderTime;
  const st = document.getElementById('notifStatus');
  if (st) st.textContent = notifEnabled ? `Currently set for ${formatTime12hr(reminderTime)} daily.` : 'No active reminder.';
  openModal('reminderModal');
}
window.openReminderModal = openReminderModal;

async function saveReminder() {
  if (!('Notification' in window)) { toast('Notifications not supported.'); return; }
  const t    = document.getElementById('reminderTime')?.value;
  if (!t)    { toast('Please pick a time.'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    const st = document.getElementById('notifStatus');
    if (st) st.textContent = 'Permission denied — enable in browser settings.';
    return;
  }
  reminderTime = t; notifEnabled = true;
  localStorage.setItem('ndalama_notif',    'true');
  localStorage.setItem('ndalama_reminder', reminderTime);
  scheduleNotification();
  const btn = document.getElementById('notifBtn');
  if (btn) { btn.textContent = '🔔'; btn.classList.add('active'); }
  closeModal('reminderModal');
  updatePrefRows();
  toast('✓ Reminder set for ' + formatTime12hr(reminderTime));
}
window.saveReminder = saveReminder;

/* ── MONTH PICKER (PDF) ───────────────────── */
function openMonthPicker() {
  const now = new Date();
  document.getElementById('reportMonth').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  openModal('monthModal');
}
window.openMonthPicker = openMonthPicker;

/* ════════════════════════════════════════════
   PDF REPORT
   ════════════════════════════════════════════ */
function generatePDF() {
  const { jsPDF } = window.jspdf;
  const val  = document.getElementById('reportMonth')?.value;
  if (!val) { toast('Please select a month.'); return; }
  const [y, m] = val.split('-').map(Number);
  const monthName = new Date(y, m-1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  const mExp = monthExpenses(m-1, y);
  if (!mExp.length) { toast('No expenses for ' + monthName); return; }

  const doc   = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const total = mExp.reduce((s,e)=>s+e.amount,0);

  // Header
  doc.setFillColor(27,201,201); doc.rect(0,0,210,40,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(22);
  doc.text('NDALAMA EXPENSE TRACKER',14,18);
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.text('Monthly Report — ' + monthName,14,28);
  doc.text('Generated: ' + new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}),14,35);

  // User info
  if (userProfile.fullName) {
    doc.setFontSize(10);
    doc.text('Account: ' + userProfile.fullName + ' (' + (userProfile.email||'') + ')',14,35);
  }

  let y2 = 50;

  // Summary box
  doc.setFillColor(232,250,250); doc.roundedRect(14,y2,182,22,3,3,'F');
  doc.setTextColor(26,26,46); doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text('TOTAL EXPENDITURE FOR ' + monthName.toUpperCase(),20,y2+8);
  doc.setFontSize(16); doc.setTextColor(14,143,143);
  doc.text('MK ' + total.toLocaleString(),20,y2+17);
  const dl = new Set(mExp.map(e=>e.date)).size;
  doc.setFontSize(9); doc.setTextColor(100,100,120); doc.setFont('helvetica','normal');
  doc.text(mExp.length+' transactions · '+dl+' days logged',130,y2+13);
  y2 += 30;

  // Category breakdown
  const cats = {};
  mExp.forEach(e=>{ cats[e.category]=(cats[e.category]||0)+e.amount; });
  const sortedCats = Object.entries(cats).sort((a,b)=>b[1]-a[1]);

  doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(26,26,46);
  doc.text('SPENDING BY CATEGORY',14,y2); y2+=4;

  if (sortedCats.length) {
    const [tc,ta] = sortedCats[0];
    doc.setFillColor(27,201,201); doc.roundedRect(14,y2,182,10,2,2,'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text('★  Highest: '+tc+'  →  MK '+ta.toLocaleString()+' ('+((ta/total)*100).toFixed(1)+'%)',18,y2+6.5);
    y2+=14;
  }

  doc.autoTable({
    startY: y2,
    head:[['Category','Amount (MK)','% of Total','Count']],
    body: sortedCats.map(([c,a])=>[c,'MK '+a.toLocaleString(),((a/total)*100).toFixed(1)+'%',mExp.filter(e=>e.category===c).length]),
    headStyles:{fillColor:[26,26,46],textColor:[27,201,201],fontStyle:'bold',fontSize:10},
    bodyStyles:{fontSize:9,textColor:[26,26,46]},
    alternateRowStyles:{fillColor:[240,253,253]},
    columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'center'}},
    margin:{left:14,right:14}
  });

  y2 = doc.lastAutoTable.finalY+10;
  if (y2>230){doc.addPage();y2=20;}

  doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(26,26,46);
  doc.text('DETAILED TRANSACTIONS',14,y2); y2+=2;

  doc.autoTable({
    startY:y2,
    head:[['Date','Category','Description','Amount (MK)']],
    body:[...mExp].sort((a,b)=>a.date.localeCompare(b.date)).map(e=>[
      new Date(e.date+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),
      e.category, e.description||'—', 'MK '+e.amount.toLocaleString()
    ]),
    headStyles:{fillColor:[26,26,46],textColor:[27,201,201],fontStyle:'bold',fontSize:9},
    bodyStyles:{fontSize:8.5,textColor:[26,26,46]},
    alternateRowStyles:{fillColor:[240,253,253]},
    columnStyles:{3:{halign:'right'}},
    margin:{left:14,right:14},
    foot:[['','','TOTAL','MK '+total.toLocaleString()]],
    footStyles:{fillColor:[27,201,201],textColor:[255,255,255],fontStyle:'bold',fontSize:9}
  });

  const pc = doc.internal.getNumberOfPages();
  for(let i=1;i<=pc;i++){
    doc.setPage(i);
    doc.setFillColor(232,250,250); doc.rect(0,285,210,12,'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(100,100,120);
    doc.text('Ndalama Expense Tracker · Personal Finance Report · ' + (userProfile.fullName||''),14,292);
    doc.text('Page '+i+' of '+pc,185,292);
  }

  closeModal('monthModal');
  doc.save('Ndalama_'+monthName.replace(' ','_')+'.pdf');
  toast('📄 PDF downloaded!');
}
window.generatePDF = generatePDF;

/* ════════════════════════════════════════════
   NOTIFICATIONS
   ════════════════════════════════════════════ */
function scheduleNotification() {
  if (!notifEnabled || Notification.permission !== 'granted') return;
  if (window._notifTimer) clearTimeout(window._notifTimer);
  const [h,m] = reminderTime.split(':').map(Number);
  const now   = new Date();
  const fire  = new Date(now);
  fire.setHours(h,m,0,0);
  if (now >= fire) fire.setDate(fire.getDate()+1);
  window._notifTimer = setTimeout(()=>{
    const today = new Date().toISOString().split('T')[0];
    const cnt   = expenses.filter(e=>e.date===today).length;
    new Notification('Ndalama 💰',{
      body: cnt===0 ? "You haven't logged any expenses today!" : `You've logged ${cnt} expense${cnt>1?'s':''} today. Anything else?`
    });
    scheduleNotification();
  }, fire-now);
}

function loadPrefs() {
  const uid = currentUser?.uid || '';
  notifEnabled  = JSON.parse(localStorage.getItem('ndalama_notif')    || 'false');
  reminderTime  = localStorage.getItem('ndalama_reminder')             || '18:00';
  budget        = parseFloat(localStorage.getItem('ndalama_budget_'+uid) || '0');
  if (notifEnabled) scheduleNotification();
  updatePrefRows();
}

/* ════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════ */
function v(id) { return (document.getElementById(id)?.value||'').trim(); }
function setText(id, val) { const el=document.getElementById(id); if(el) el.textContent=val; }

function fmt(n) {
  return 'MK ' + Number(n).toLocaleString('en-MW',{minimumFractionDigits:0,maximumFractionDigits:2});
}

function fmtShort(n) {
  if (n>=1_000_000) return 'MK '+(n/1_000_000).toFixed(1)+'M';
  if (n>=1_000)     return 'MK '+(n/1_000).toFixed(1)+'K';
  return fmt(n);
}

function formatTime12hr(t) {
  const [h,m] = t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}

function weekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + (d.getDay()===0?-6:1));
  d.setHours(0,0,0,0);
  return d;
}

function monthExpenses(m, y) {
  return expenses.filter(e=>{ const d=new Date(e.date); return d.getMonth()===m && d.getFullYear()===y; });
}

function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

function friendlyError(code) {
  const map = {
    'auth/user-not-found':       'No account found with that email.',
    'auth/wrong-password':       'Incorrect password. Please try again.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/invalid-email':        'Please enter a valid email address.',
    'auth/weak-password':        'Password is too weak.',
    'auth/too-many-requests':    'Too many attempts. Please try again later.',
    'auth/network-request-failed':'No internet connection.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/invalid-credential':   'Incorrect email or password.'
  };
  return map[code] || 'Something went wrong. Please try again.';
}

let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=>el.classList.remove('show'), 3500);
}

/* ── COMPRESS PHOTO ───────────────────────────────────────────────────────────
   Resizes image to maxSize x maxSize pixels and returns a base64 JPEG string.
   This keeps the data small enough to store in Firestore (1MB document limit).
   ──────────────────────────────────────────────────────────────────────────── */
function compressPhoto(base64, maxSize = 200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;

      // Scale down keeping aspect ratio
      if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
      else        { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }

      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      // Quality 0.75 gives a good balance of size vs clarity for avatars
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = reject;
    img.src = base64;
  });
}

function lockBtn(cls, txt) {
  const btn = document.querySelector('.'+cls);
  if (!btn) return null;
  btn.disabled = true; btn.textContent = txt;
  return btn;
}
