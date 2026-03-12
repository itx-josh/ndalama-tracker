/* ══════════════════════════════════════════════════
   NDALAMA — app.js  (v3 — full features)
   Features: income, savings goals, month-vs-month,
   6-month trend, insights, dark mode, search,
   edit expense, CSV export, currency, weekly notif,
   budget alert, streak tracker
   ══════════════════════════════════════════════════ */

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword,
         signInWithEmailAndPassword, signOut,
         sendPasswordResetEmail, GoogleAuthProvider,
         signInWithPopup, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, addDoc, deleteDoc, updateDoc,
         doc, onSnapshot, query, orderBy, setDoc, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ── FIREBASE ────────────────────────────────── */
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

/* ── STATE ───────────────────────────────────── */
let currentUser    = null;
let userProfile    = {};
let expenses       = [];
let goals          = [];
let expenseUnsub   = null;
let goalUnsub      = null;
let selectedGender = 'Male';
let pendingPhotoB64= null;
let budget         = 0;
let monthlyIncome  = 0;
let notifEnabled   = false;
let reminderTime   = '18:00';
let analysisPeriod = 'week';
let editingField   = '';
let exportType     = 'pdf';  // 'pdf' or 'csv'
let currency       = { code:'MWK', symbol:'MK', name:'Malawian Kwacha', flag:'🇲🇼' };
let darkMode       = false;

const CURRENCIES = [
  { code:'MWK', symbol:'MK',  name:'Malawian Kwacha',    flag:'🇲🇼' },
  { code:'USD', symbol:'$',   name:'US Dollar',           flag:'🇺🇸' },
  { code:'ZAR', symbol:'R',   name:'South African Rand',  flag:'🇿🇦' },
  { code:'GBP', symbol:'£',   name:'British Pound',       flag:'🇬🇧' },
  { code:'EUR', symbol:'€',   name:'Euro',                flag:'🇪🇺' },
  { code:'KES', symbol:'KSh', name:'Kenyan Shilling',     flag:'🇰🇪' },
  { code:'TZS', symbol:'TSh', name:'Tanzanian Shilling',  flag:'🇹🇿' },
  { code:'ZMW', symbol:'ZK',  name:'Zambian Kwacha',      flag:'🇿🇲' },
  { code:'BWP', symbol:'P',   name:'Botswana Pula',       flag:'🇧🇼' },
  { code:'NGN', symbol:'₦',   name:'Nigerian Naira',      flag:'🇳🇬' },
];

const ICONS = {
  'Food & Groceries':'🍽️','Transport':'🚌','Housing & Rent':'🏠',
  'Health & Medical':'💊','Education':'📚','Entertainment':'🎬',
  'Clothing':'👕','Utilities':'💡','Other':'📌'
};

/* ═══════════════════════════════════════════════
   SCREEN NAVIGATION
   ═══════════════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}
window.showScreen = showScreen;

/* ═══════════════════════════════════════════════
   SPLASH → AUTH STATE
   ═══════════════════════════════════════════════ */
setTimeout(() => {
  onAuthStateChanged(auth, async user => {
    if (user) {
      currentUser = user;
      await loadProfile();
      startListeners();
      loadPrefs();
      showScreen('screenApp');
      document.querySelector('.fab').classList.add('show');
      document.querySelector('.bot-nav').classList.add('show');
      updateTopbar();
      updateProfileView();
      applyDarkMode(darkMode);
    } else {
      showScreen('screenLogin');
    }
  });
}, 2200);

/* ═══════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════ */
async function handleLogin() {
  const email = v('loginEmail'), pw = v('loginPassword');
  if (!email || !pw) { toast('Please fill in all fields.'); return; }
  try {
    await signInWithEmailAndPassword(auth, email, pw);
  } catch (e) { toast(friendlyError(e.code)); }
}
window.handleLogin = handleLogin;

async function handleGoogleLogin() {
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const user   = result.user;
    const snap   = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) {
      await setDoc(doc(db, 'users', user.uid), {
        fullName: user.displayName || '', nickname: (user.displayName||'User').split(' ')[0],
        email: user.email, phone:'', dob:'', gender:'', photoURL: user.photoURL||''
      });
    }
  } catch (e) { toast(friendlyError(e.code)); }
}
window.handleGoogleLogin = handleGoogleLogin;

async function handleForgotPassword() {
  const email = v('forgotEmail');
  if (!email) { toast('Please enter your email.'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    toast('✉️ Reset link sent! Check your inbox.');
    showScreen('screenLogin');
  } catch (e) { toast(friendlyError(e.code)); }
}
window.handleForgotPassword = handleForgotPassword;

function handleSignup1() {
  const email = v('su1Email'), pw = v('su1Password'), confirm = v('su1Confirm');
  if (!email||!pw||!confirm)   { toast('Please fill in all fields.'); return; }
  if (!isValidEmail(email))    { toast('Please enter a valid email address.'); return; }
  if (getStrength(pw) < 5)     { toast('Password does not meet all requirements.'); return; }
  if (pw !== confirm)          { toast('Passwords do not match.'); return; }
  window._su1 = { email, pw };
  showScreen('screenSignup2');
}
window.handleSignup1 = handleSignup1;

async function handleSignup2() {
  const name = v('su2Name'), nick = v('su2Nick'), phone = v('su2Phone'), dob = v('su2DOB');
  if (!name||!nick||!phone||!dob) { toast('Please fill in all required fields.'); return; }
  const { email, pw } = window._su1 || {};
  if (!email||!pw) { showScreen('screenSignup1'); return; }
  const btn = document.querySelector('#screenSignup2 .btn-primary');
  btn.disabled = true; btn.textContent = 'Creating account...';
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    let photoURL = '';
    if (pendingPhotoB64) photoURL = await compressPhoto(pendingPhotoB64, 200);
    await setDoc(doc(db, 'users', cred.user.uid), {
      fullName:name, nickname:nick, email, phone, dob, gender:selectedGender, photoURL
    });
    toast('🎉 Account created! Welcome!');
  } catch (e) {
    toast(friendlyError(e.code));
    btn.disabled = false; btn.textContent = 'CREATE MY ACCOUNT 🎉';
  }
}
window.handleSignup2 = handleSignup2;

async function handleLogout() {
  if (!confirm('Sign out of Ndalama?')) return;
  if (expenseUnsub) expenseUnsub();
  if (goalUnsub)    goalUnsub();
  await signOut(auth);
  expenses = []; goals = []; userProfile = {}; currentUser = null;
  showScreen('screenLogin');
  document.querySelector('.fab').classList.remove('show');
  document.querySelector('.bot-nav').classList.remove('show');
}
window.handleLogout = handleLogout;

async function handleChangePassword() {
  if (!currentUser?.email) return;
  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    toast('✉️ Reset link sent to ' + currentUser.email);
  } catch (e) { toast(friendlyError(e.code)); }
}
window.handleChangePassword = handleChangePassword;

/* ── Password Helpers ─────────────────────────── */
function checkStrength(pw) {
  const rules = { 'r-len':pw.length>=8,'r-up':/[A-Z]/.test(pw),'r-lo':/[a-z]/.test(pw),'r-num':/[0-9]/.test(pw),'r-sym':/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw) };
  const score = Object.values(rules).filter(Boolean).length;
  Object.entries(rules).forEach(([id,pass])=>document.getElementById(id)?.classList.toggle('pass',pass));
  const fill=document.getElementById('strengthFill'), txt=document.getElementById('strengthTxt');
  if(!fill||!txt) return;
  const map=[[0,'0%','#ccc',''],[1,'20%','#e53e3e','Very Weak'],[2,'40%','#e53e3e','Weak'],[3,'60%','#dd6b20','Fair'],[4,'80%','#1BC9C9','Strong'],[5,'100%','var(--green)','Very Strong']];
  const [,w,bg,label]=map[score]||map[0];
  fill.style.width=w; fill.style.background=bg; txt.textContent=label; txt.style.color=bg;
}
window.checkStrength = checkStrength;
function getStrength(pw){let s=0;if(pw.length>=8)s++;if(/[A-Z]/.test(pw))s++;if(/[a-z]/.test(pw))s++;if(/[0-9]/.test(pw))s++;if(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw))s++;return s;}
function pickGender(g){selectedGender=g;document.getElementById('gBtn-Male').classList.toggle('active',g==='Male');document.getElementById('gBtn-Female').classList.toggle('active',g==='Female');}
window.pickGender=pickGender;
function previewPhoto(input){const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=e=>{pendingPhotoB64=e.target.result;const img=document.getElementById('photoPreviewImg'),ph=document.getElementById('photoPlaceholder');img.src=pendingPhotoB64;img.style.display='block';if(ph)ph.style.display='none';};reader.readAsDataURL(file);}
window.previewPhoto=previewPhoto;
function togglePw(id,btn){const inp=document.getElementById(id);if(!inp)return;inp.type=inp.type==='password'?'text':'password';btn.textContent=inp.type==='password'?'👁':'🙈';}
window.togglePw=togglePw;

/* ═══════════════════════════════════════════════
   PROFILE
   ═══════════════════════════════════════════════ */
async function loadProfile() {
  if (!currentUser) return;
  try {
    const snap = await getDoc(doc(db,'users',currentUser.uid));
    if (snap.exists()) userProfile = snap.data();
  } catch(e) { console.error(e); }
}

function updateTopbar() {
  const nick = userProfile.nickname || 'there';
  const h    = new Date().getHours();
  const greet = h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  setText('tbGreeting', `${greet}, ${nick}!`);
  setText('tbDate', new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}));

  const img = document.getElementById('tbAvatar'), fb = document.getElementById('tbAvatarFb');
  const url = userProfile.photoURL || currentUser?.photoURL;
  if (url&&img) { img.src=url; img.style.display='block'; if(fb) fb.style.display='none'; }
  else { if(img) img.style.display='none'; if(fb) fb.style.display='flex'; }

  // Streak badge
  updateStreakBadge();
}

function updateStreakBadge() {
  const streak = calcStreak();
  const badge  = document.getElementById('streakBadge');
  const cnt    = document.getElementById('streakCount');
  if (streak > 0 && badge && cnt) {
    badge.style.display = 'flex';
    cnt.textContent = streak;
  } else if (badge) {
    badge.style.display = 'none';
  }
}

function updateProfileView() {
  setText('profName',    userProfile.fullName || '—');
  setText('profEmail',   userProfile.email    || currentUser?.email || '—');
  setText('pr-nickname', userProfile.nickname || '—');
  setText('pr-phone',    userProfile.phone    || '—');
  setText('pr-dob',      userProfile.dob ? new Date(userProfile.dob).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—');
  setText('pr-gender',   userProfile.gender   || '—');

  const img = document.getElementById('profAvatar'), fb = document.getElementById('profAvaFb');
  const url = userProfile.photoURL || currentUser?.photoURL;
  if (url&&img) { img.src=url; img.style.display='block'; if(fb) fb.style.display='none'; }
  else { if(img) img.style.display='none'; if(fb) fb.style.display='flex'; }

  const streak = calcStreak();
  const sEl    = document.getElementById('profStreak');
  if (sEl) sEl.textContent = streak > 0 ? `🔥 ${streak}-day logging streak!` : '';

  updatePrefRows();
}

function updatePrefRows() {
  setText('pr-reminder', notifEnabled ? formatTime12hr(reminderTime)+' daily' : 'Not set');
  setText('pr-budget',   budget       ? fmt(budget)+' / month' : 'Not set');
  setText('pr-income',   monthlyIncome? fmt(monthlyIncome)+' / month' : 'Not set');
  setText('pr-currency', `${currency.flag} ${currency.code}`);
  updateCurrencySymbols();
}

function updateCurrencySymbols() {
  ['currSymbol','incCurrSymbol','budCurrSymbol','goalCurrSymbol','goalCurrSymbol2','contCurrSymbol'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.textContent = currency.symbol;
  });
}

function editProfileField(field, label) {
  editingField = field;
  setText('editFldTitle', 'Edit '+label);
  document.getElementById('editFldInput').value = userProfile[field]||'';
  openModal('editFldModal');
}
window.editProfileField = editProfileField;

async function saveProfileField() {
  const val = document.getElementById('editFldInput')?.value.trim();
  if (!val||!editingField||!currentUser) return;
  try {
    userProfile[editingField] = val;
    await setDoc(doc(db,'users',currentUser.uid), userProfile);
    closeModal('editFldModal');
    updateTopbar(); updateProfileView();
    toast('✓ Saved!');
  } catch(e) { toast('Could not save. Check connection.'); }
}
window.saveProfileField = saveProfileField;

async function updateProfilePhoto(input) {
  const file = input.files[0];
  if (!file||!currentUser) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      userProfile.photoURL = await compressPhoto(e.target.result, 200);
      await setDoc(doc(db,'users',currentUser.uid), userProfile);
      updateTopbar(); updateProfileView();
      toast('✓ Profile photo updated!');
    } catch(err) { toast('Could not save photo.'); }
  };
  reader.readAsDataURL(file);
}
window.updateProfilePhoto = updateProfilePhoto;

/* ═══════════════════════════════════════════════
   DARK MODE
   ═══════════════════════════════════════════════ */
function toggleDarkMode(on) {
  darkMode = on;
  localStorage.setItem('ndalama_dark', on ? '1' : '0');
  applyDarkMode(on);
}
window.toggleDarkMode = toggleDarkMode;

function applyDarkMode(on) {
  document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
  const toggle = document.getElementById('darkModeToggle');
  if (toggle) toggle.checked = on;
}

/* ═══════════════════════════════════════════════
   CURRENCY
   ═══════════════════════════════════════════════ */
function openCurrencyModal() {
  const list = document.getElementById('currencyList');
  if (!list) return;
  list.innerHTML = CURRENCIES.map(c => `
    <div class="curr-item ${c.code===currency.code?'active':''}" onclick="selectCurrency('${c.code}')">
      <span class="curr-flag">${c.flag}</span>
      <span class="curr-code">${c.code}</span>
      <span class="curr-name">${c.name}</span>
    </div>`).join('');
  openModal('currencyModal');
}
window.openCurrencyModal = openCurrencyModal;

function selectCurrency(code) {
  currency = CURRENCIES.find(c=>c.code===code) || CURRENCIES[0];
  localStorage.setItem('ndalama_currency', JSON.stringify(currency));
  closeModal('currencyModal');
  updatePrefRows();
  renderHome();
  renderAnalysis();
  toast(`✓ Currency set to ${currency.code}`);
}
window.selectCurrency = selectCurrency;

/* ═══════════════════════════════════════════════
   INCOME & BUDGET
   ═══════════════════════════════════════════════ */
function openIncomeModal() {
  document.getElementById('incomeAmt').value = monthlyIncome||'';
  openModal('incomeModal');
}
window.openIncomeModal = openIncomeModal;

function saveIncome() {
  const val = parseFloat(document.getElementById('incomeAmt')?.value);
  if (!val||val<=0) { toast('Please enter a valid income amount.'); return; }
  monthlyIncome = val;
  localStorage.setItem('ndalama_income_'+(currentUser?.uid||''), val);
  closeModal('incomeModal');
  updatePrefRows(); renderHome();
  toast('✓ Income saved — '+fmt(val));
}
window.saveIncome = saveIncome;

function openBudgetModal() {
  document.getElementById('budgetAmt').value = budget||'';
  openModal('budgetModal');
}
window.openBudgetModal = openBudgetModal;

function saveBudget() {
  const val = parseFloat(document.getElementById('budgetAmt')?.value);
  if (!val||val<=0) { toast('Please enter a valid budget amount.'); return; }
  budget = val;
  localStorage.setItem('ndalama_budget_'+(currentUser?.uid||''), val);
  closeModal('budgetModal');
  updatePrefRows(); renderHome();
  toast('✓ Budget set — '+fmt(val));
}
window.saveBudget = saveBudget;

/* ═══════════════════════════════════════════════
   SAVINGS GOALS
   ═══════════════════════════════════════════════ */
function openGoalModal() { openModal('goalModal'); }
window.openGoalModal = openGoalModal;

async function saveGoal() {
  const name    = v('goalName');
  const target  = parseFloat(document.getElementById('goalTarget')?.value);
  const current = parseFloat(document.getElementById('goalCurrent')?.value||'0')||0;
  if (!name)          { toast('Please enter a goal name.'); return; }
  if (!target||target<=0) { toast('Please enter a target amount.'); return; }
  if (!currentUser)   return;
  try {
    await addDoc(collection(db,'users',currentUser.uid,'goals'), {
      name, target, current, completed:false, createdAt:Date.now()
    });
    closeModal('goalModal');
    document.getElementById('goalName').value    = '';
    document.getElementById('goalTarget').value  = '';
    document.getElementById('goalCurrent').value = '0';
    toast('💎 Goal created!');
  } catch(e) { toast('Could not save goal.'); }
}
window.saveGoal = saveGoal;

function openContributeModal(goalId, goalName) {
  document.getElementById('contributeGoalId').value = goalId;
  setText('contributeTitle', 'Add to: '+goalName);
  document.getElementById('contributeAmt').value = '';
  openModal('contributeModal');
}
window.openContributeModal = openContributeModal;

async function contributeToGoal() {
  const id  = document.getElementById('contributeGoalId')?.value;
  const amt = parseFloat(document.getElementById('contributeAmt')?.value);
  if (!id||!amt||amt<=0||!currentUser) { toast('Please enter a valid amount.'); return; }

  const goal = goals.find(g=>g.id===id);
  if (!goal) return;

  const newCurrent   = Math.min(goal.current + amt, goal.target);
  const isCompleted  = newCurrent >= goal.target;

  try {
    await updateDoc(doc(db,'users',currentUser.uid,'goals',id), {
      current: newCurrent, completed: isCompleted
    });
    closeModal('contributeModal');
    if (isCompleted) {
      setText('congratsText', `You reached your "${goal.name}" goal of ${fmt(goal.target)}! 🎉`);
      openModal('congratsModal');
    } else {
      toast(`✓ Added ${fmt(amt)} to ${goal.name}`);
    }
  } catch(e) { toast('Could not update goal.'); }
}
window.contributeToGoal = contributeToGoal;

async function deleteGoal(id) {
  if (!currentUser||!confirm('Delete this savings goal?')) return;
  try {
    await deleteDoc(doc(db,'users',currentUser.uid,'goals',id));
    toast('Goal removed.');
  } catch(e) { toast('Could not delete.'); }
}
window.deleteGoal = deleteGoal;

function renderGoals() {
  const el = document.getElementById('goalsList');
  if (!el) return;
  if (!goals.length) {
    el.innerHTML = `<div class="empty-msg" style="padding:1rem;"><div class="em-ico">💎</div>No goals yet. Tap + New Goal to start saving!</div>`;
    return;
  }
  el.innerHTML = goals.map(g => {
    const pct = Math.min((g.current/g.target)*100,100).toFixed(0);
    return `
    <div class="goal-card">
      <div class="goal-top">
        <span class="goal-name">${g.name}</span>
        <span class="goal-amt">${fmt(g.current)} / ${fmt(g.target)}</span>
      </div>
      <div class="goal-track"><div class="goal-fill ${g.completed?'complete':''}" style="width:${pct}%"></div></div>
      <div class="goal-bottom">
        <span class="goal-pct">${pct}% complete</span>
        <div class="goal-actions">
          ${g.completed
            ? `<span class="goal-complete-badge">✓ Completed!</span>`
            : `<button class="goal-btn" onclick="openContributeModal('${g.id}','${g.name.replace(/'/g,"\\'")}')">+ Add</button>`}
          <button class="goal-btn danger" onclick="deleteGoal('${g.id}')">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════
   FIRESTORE LISTENERS
   ═══════════════════════════════════════════════ */
function startListeners() {
  if (!currentUser) return;
  if (expenseUnsub) expenseUnsub();
  if (goalUnsub)    goalUnsub();

  const expQ = query(collection(db,'users',currentUser.uid,'expenses'), orderBy('createdAt','desc'));
  expenseUnsub = onSnapshot(expQ, snap => {
    expenses = snap.docs.map(d=>({id:d.id,...d.data()}));
    renderHome(); renderAnalysis(); renderHistory();
    checkBudgetAlert();
    updateStreakBadge();
  }, err => { console.error(err); toast('⚠️ Could not sync expenses.'); });

  const goalQ = query(collection(db,'users',currentUser.uid,'goals'), orderBy('createdAt','asc'));
  goalUnsub = onSnapshot(goalQ, snap => {
    goals = snap.docs.map(d=>({id:d.id,...d.data()}));
    renderGoals();
  }, err => console.error(err));
}

/* ═══════════════════════════════════════════════
   ADD / EDIT / DELETE EXPENSE
   ═══════════════════════════════════════════════ */
function openAddModal() {
  const d = document.getElementById('expDate');
  if (d && !d.value) d.value = new Date().toISOString().split('T')[0];
  document.getElementById('editExpenseId').value = '';
  setText('addModalTitle', 'Add Expense');
  setText('saveExpenseBtn', 'SAVE EXPENSE');
  document.getElementById('expDesc').value = '';
  document.getElementById('expAmt').value  = '';
  openModal('addModal');
}
window.openAddModal = openAddModal;

function openEditModal(id) {
  const exp = expenses.find(e=>e.id===id);
  if (!exp) return;
  document.getElementById('editExpenseId').value = id;
  document.getElementById('expDate').value  = exp.date;
  document.getElementById('expCat').value   = exp.category;
  document.getElementById('expDesc').value  = exp.description||'';
  document.getElementById('expAmt').value   = exp.amount;
  setText('addModalTitle', 'Edit Expense');
  setText('saveExpenseBtn', 'UPDATE EXPENSE');
  openModal('addModal');
}
window.openEditModal = openEditModal;

async function saveExpense() {
  const editId = document.getElementById('editExpenseId')?.value;
  const date   = document.getElementById('expDate')?.value;
  const cat    = document.getElementById('expCat')?.value;
  const desc   = document.getElementById('expDesc')?.value.trim()||'';
  const amt    = parseFloat(document.getElementById('expAmt')?.value);

  if (!date)          { toast('Please select a date.');         return; }
  if (!amt||amt<=0)   { toast('Please enter a valid amount.');  return; }
  if (!currentUser)   return;

  const btn = document.getElementById('saveExpenseBtn');
  if (btn) { btn.disabled=true; btn.textContent='Saving...'; }

  try {
    if (editId) {
      await updateDoc(doc(db,'users',currentUser.uid,'expenses',editId), {
        date, category:cat, description:desc, amount:amt
      });
      toast('✓ Expense updated!');
    } else {
      await addDoc(collection(db,'users',currentUser.uid,'expenses'), {
        date, category:cat, description:desc, amount:amt, createdAt:Date.now()
      });
      document.getElementById('expAmt').value  = '';
      document.getElementById('expDesc').value = '';
      toast('✓ Expense saved — '+fmt(amt));
    }
    closeModal('addModal');
  } catch(e) {
    toast('⚠️ Failed to save. Check connection.');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent=editId?'UPDATE EXPENSE':'SAVE EXPENSE'; }
  }
}
window.saveExpense = saveExpense;

async function deleteExpense(id) {
  if (!currentUser||!confirm('Delete this expense?')) return;
  try {
    await deleteDoc(doc(db,'users',currentUser.uid,'expenses',id));
    toast('Expense removed.');
  } catch(e) { toast('⚠️ Could not delete.'); }
}
window.deleteExpense = deleteExpense;

/* ═══════════════════════════════════════════════
   RENDER — HOME
   ═══════════════════════════════════════════════ */
function renderHome() {
  const now   = new Date();
  const today = now.toISOString().split('T')[0];
  const mExp  = monthExpenses(now.getMonth(), now.getFullYear());
  const mAmt  = mExp.reduce((s,e)=>s+e.amount, 0);

  // Balance = income - expenses
  const balance = monthlyIncome > 0 ? monthlyIncome - mAmt : 0;
  const heroEl  = document.getElementById('heroBalance');
  if (heroEl) {
    heroEl.innerHTML = (monthlyIncome > 0 ? fmt(Math.max(balance,0)) : fmt(mAmt)) + '<span class="hero-dec">.00</span>';
  }
  const incEl = document.getElementById('heroIncome');
  if (incEl) incEl.textContent = monthlyIncome > 0 ? fmt(monthlyIncome) : 'Set income ✏️';

  // Hero label
  const heroLbl = document.querySelector('.hero-lbl');
  if (heroLbl) heroLbl.textContent = monthlyIncome > 0 ? 'Available Balance' : 'Total Spent This Month';

  // Stats
  const todayAmt = expenses.filter(e=>e.date===today).reduce((s,e)=>s+e.amount,0);
  setText('sToday', fmtShort(todayAmt));
  const ws    = weekStart();
  const wkAmt = expenses.filter(e=>new Date(e.date)>=ws).reduce((s,e)=>s+e.amount,0);
  setText('sWeek',  fmtShort(wkAmt));
  setText('sMonth', fmtShort(mAmt));

  // Budget bar
  const bFill = document.getElementById('budgetFill');
  const bPct  = document.getElementById('budgetPct');
  const bLbl  = document.getElementById('budgetSpentLbl');
  if (budget > 0) {
    const pct = Math.min((mAmt/budget)*100, 100);
    if (bFill) { bFill.style.width=pct.toFixed(1)+'%'; bFill.style.background=pct>=90?'#ff6b6b':'white'; }
    if (bPct)  bPct.textContent = pct.toFixed(0)+'%';
    if (bLbl)  bLbl.textContent = fmt(mAmt)+' of '+fmt(budget);
  } else {
    if (bFill) bFill.style.width='0%';
    if (bPct)  bPct.textContent='—';
    if (bLbl)  bLbl.textContent='Set a budget to track progress';
  }

  // Insights
  if (mExp.length) {
    const biggest = mExp.reduce((a,b)=>a.amount>b.amount?a:b);
    setText('icBiggest',    fmt(biggest.amount));
    setText('icBiggestCat', biggest.category);
    const daysLogged = new Set(mExp.map(e=>e.date)).size;
    const avgDay     = daysLogged > 0 ? mAmt / daysLogged : 0;
    setText('icAvgDay', fmt(avgDay));
    setText('icAvgSub', `over ${daysLogged} day${daysLogged!==1?'s':''} logged`);
  } else {
    setText('icBiggest','—'); setText('icBiggestCat','No data yet');
    setText('icAvgDay','—'); setText('icAvgSub','this month');
  }

  // Goals
  renderGoals();

  // Recent list
  const recent = [...expenses].slice(0,5);
  const el = document.getElementById('recentList');
  if (!el) return;
  el.innerHTML = recent.length ? recent.map(e=>txHTML(e)).join('')
    : `<div class="empty-msg"><div class="em-ico">📭</div>No expenses yet. Tap + to add one.</div>`;
}

/* ═══════════════════════════════════════════════
   RENDER — ANALYSIS
   ═══════════════════════════════════════════════ */
function renderAnalysis() {
  const now = new Date();
  let data, labels, barData;

  if (analysisPeriod === 'week') {
    const ws   = weekStart();
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const todayLabel = now.toLocaleDateString('en-GB',{weekday:'short'}).slice(0,3);
    labels  = days;
    barData = days.map((_,i)=>{
      const d = new Date(ws); d.setDate(ws.getDate()+i);
      return expenses.filter(e=>e.date===d.toISOString().split('T')[0]).reduce((s,e)=>s+e.amount,0);
    });
    data    = expenses.filter(e=>new Date(e.date)>=ws);

    // Highlight today
    const chart = document.getElementById('barChart');
    if (chart) {
      const max = Math.max(...barData,1);
      chart.innerHTML = barData.map((v,i)=>`
        <div class="bar-col">
          <div class="bar-col-val">${v>0?fmtShort(v):''}</div>
          <div class="bar-col-fill ${days[i]===todayLabel?'today-bar':''}" style="height:${Math.max((v/max)*100,2).toFixed(1)}%"></div>
        </div>`).join('');
      document.getElementById('barLabels').innerHTML = days.map(d=>`<div class="bar-lbl">${d}</div>`).join('');
    }
  } else {
    const m = now.getMonth(), y = now.getFullYear();
    data    = monthExpenses(m,y);
    const dim = new Date(y,m+1,0).getDate();
    labels=[]; barData=[];
    for(let d=1;d<=dim;d++){
      const key=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      labels.push(d%5===1?String(d):'');
      barData.push(expenses.filter(e=>e.date===key).reduce((s,e)=>s+e.amount,0));
    }
    const max   = Math.max(...barData,1);
    const chart = document.getElementById('barChart');
    if (chart) {
      chart.innerHTML = barData.map((v,i)=>`
        <div class="bar-col">
          <div class="bar-col-fill" style="height:${Math.max((v/max)*100,2).toFixed(1)}%"></div>
        </div>`).join('');
      document.getElementById('barLabels').innerHTML = labels.map(l=>`<div class="bar-lbl">${l}</div>`).join('');
    }
  }

  // ── Month vs Month ────────────────────────────
  const curM  = now.getMonth(), curY = now.getFullYear();
  const prevM = curM===0?11:curM-1, prevY = curM===0?curY-1:curY;
  const curTotal  = monthExpenses(curM,curY).reduce((s,e)=>s+e.amount,0);
  const prevTotal = monthExpenses(prevM,prevY).reduce((s,e)=>s+e.amount,0);
  const momCard   = document.getElementById('momCard');
  if (momCard) {
    if (prevTotal > 0) {
      const diff    = curTotal - prevTotal;
      const pct     = Math.abs((diff/prevTotal)*100).toFixed(0);
      const isUp    = diff > 0;
      const isSame  = diff === 0;
      const prevName = new Date(prevY,prevM).toLocaleDateString('en-GB',{month:'long'});
      momCard.className = 'mom-card';
      momCard.innerHTML = `
        <div class="mom-icon">${isUp?'📈':'📉'}</div>
        <div class="mom-info">
          <div class="mom-title">Month vs Last Month</div>
          <div class="mom-val">${fmt(curTotal)} this month</div>
          <div class="mom-sub">vs ${fmt(prevTotal)} in ${prevName}</div>
        </div>
        <div class="mom-badge ${isSame?'same':isUp?'up':'down'}">
          ${isSame?'No change':isUp?`▲ ${pct}% more`:`▼ ${pct}% less`}
        </div>`;
    } else {
      momCard.className = 'mom-card hidden';
    }
  }

  // ── 6-Month Trend ─────────────────────────────
  const months6 = [];
  for (let i=5; i>=0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months6.push({ m:d.getMonth(), y:d.getFullYear(),
      label:d.toLocaleDateString('en-GB',{month:'short'}),
      current: i===0
    });
  }
  const trend6     = months6.map(mo=>({ ...mo, total:monthExpenses(mo.m,mo.y).reduce((s,e)=>s+e.amount,0) }));
  const trendMax   = Math.max(...trend6.map(t=>t.total),1);
  const trendChart = document.getElementById('trendChart');
  const trendLbls  = document.getElementById('trendLabels');
  if (trendChart) {
    trendChart.innerHTML = trend6.map(t=>`
      <div class="trend-col">
        <div class="trend-fill ${t.current?'current':''}" style="height:${Math.max((t.total/trendMax)*100,3).toFixed(1)}%"></div>
      </div>`).join('');
    trendLbls.innerHTML = trend6.map(t=>`<div class="trend-lbl">${t.label}</div>`).join('');
  }

  // ── Top Categories ────────────────────────────
  const cats   = {};
  data.forEach(e=>{ cats[e.category]=(cats[e.category]||0)+e.amount; });
  const total  = data.reduce((s,e)=>s+e.amount,0);
  const sorted = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const topEl  = document.getElementById('topCats');
  if (topEl) {
    topEl.innerHTML = sorted.length ? sorted.map(([cat,amt])=>`
      <div class="top-cat-item">
        <div class="tc-icon">${ICONS[cat]||'📌'}</div>
        <div class="tc-info"><div class="tc-name">${cat}</div><div class="tc-pct">${total?((amt/total)*100).toFixed(0):0}% of total</div></div>
        <div class="tc-bar-wrap"><div class="tc-bar-track"><div class="tc-bar-fill" style="width:${total?(amt/total*100).toFixed(1):0}%"></div></div></div>
        <div class="tc-amt">${fmt(amt)}</div>
      </div>`).join('')
    : `<div class="empty-msg"><div class="em-ico">📊</div>No data for this period.</div>`;
  }
}

function setPeriod(p, btn) {
  analysisPeriod = p;
  document.querySelectorAll('.p-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  renderAnalysis();
}
window.setPeriod = setPeriod;

/* ═══════════════════════════════════════════════
   RENDER — HISTORY (with search)
   ═══════════════════════════════════════════════ */
function renderHistory() {
  const filter = document.getElementById('histFilter')?.value;
  const search = (document.getElementById('searchInput')?.value||'').toLowerCase().trim();

  // Show/hide clear button
  const clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) clearBtn.style.display = search ? 'block' : 'none';

  let data = [...expenses];
  if (filter) data = data.filter(e=>e.date===filter);
  if (search) data = data.filter(e=>
    e.category.toLowerCase().includes(search) ||
    (e.description||'').toLowerCase().includes(search)
  );
  data.sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);

  const el = document.getElementById('historyList');
  if (!el) return;
  if (!data.length) {
    el.innerHTML = `<div class="empty-msg"><div class="em-ico">🔍</div>${search?'No results for "'+search+'"':'No expenses found.'}</div>`;
    return;
  }

  const byDate = {};
  data.forEach(e=>{ (byDate[e.date]=byDate[e.date]||[]).push(e); });
  const dates = Object.keys(byDate).sort((a,b)=>b.localeCompare(a));

  el.innerHTML = dates.map(date=>{
    const items = byDate[date];
    const total = items.reduce((s,e)=>s+e.amount,0);
    const label = new Date(date+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    return `<div class="tx-day-group">
      <div class="tx-day-header"><span>${label}</span><span>${fmt(total)}</span></div>
      ${items.map(e=>txHTML(e)).join('')}
    </div>`;
  }).join('');
}
window.renderHistory = renderHistory;

function clearSearch() {
  const inp = document.getElementById('searchInput');
  if (inp) inp.value = '';
  renderHistory();
}
window.clearSearch = clearSearch;

/* ── Transaction HTML ─────────────────────────── */
function txHTML(e) {
  return `
    <div class="tx-item">
      <div class="tx-icon">${ICONS[e.category]||'📌'}</div>
      <div class="tx-info">
        <div class="tx-cat">${e.category}</div>
        ${e.description?`<div class="tx-desc">${e.description}</div>`:''}
        <div class="tx-meta">${new Date(e.date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>
      </div>
      <div class="tx-right"><div class="tx-amt">−${fmt(e.amount)}</div></div>
      <div class="tx-actions">
        <button class="tx-btn" onclick="openEditModal('${e.id}')" title="Edit">✏️</button>
        <button class="tx-btn del" onclick="deleteExpense('${e.id}')" title="Delete">✕</button>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════
   VIEW NAVIGATION
   ═══════════════════════════════════════════════ */
function showView(id) {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  const map = { viewHome:'bn-home', viewAnalysis:'bn-analysis', viewHistory:'bn-history', viewProfile:'bn-profile' };
  document.querySelectorAll('.bn-btn').forEach(b=>b.classList.remove('active'));
  const navId = map[id];
  if (navId) document.getElementById(navId)?.classList.add('active');
  if (id==='viewAnalysis') renderAnalysis();
  if (id==='viewHistory')  renderHistory();
  if (id==='viewProfile')  updateProfileView();
}
window.showView = showView;

/* ═══════════════════════════════════════════════
   MODALS
   ═══════════════════════════════════════════════ */
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
window.openModal  = openModal;
window.closeModal = closeModal;

document.querySelectorAll('.modal-ov').forEach(ov=>{
  ov.addEventListener('click', e=>{ if(e.target===ov) closeModal(ov.id); });
});

function openMonthPicker(type) {
  exportType = type;
  const now  = new Date();
  document.getElementById('reportMonth').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  setText('monthModalTitle', type==='csv' ? '📊 Export CSV' : '📄 Monthly Report');
  setText('downloadBtn', type==='csv' ? 'DOWNLOAD CSV' : 'DOWNLOAD PDF');
  openModal('monthModal');
}
window.openMonthPicker = openMonthPicker;

function openReminderModal() {
  document.getElementById('reminderTime').value = reminderTime;
  const st = document.getElementById('notifStatus');
  if (st) st.textContent = notifEnabled ? `Set for ${formatTime12hr(reminderTime)} daily.` : 'No active reminder.';
  openModal('reminderModal');
}
window.openReminderModal = openReminderModal;

async function saveReminder() {
  if (!('Notification' in window)) { toast('Notifications not supported.'); return; }
  const t = document.getElementById('reminderTime')?.value;
  if (!t) { toast('Please pick a time.'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    const st = document.getElementById('notifStatus');
    if (st) st.textContent = 'Permission denied — enable in browser settings.';
    return;
  }
  reminderTime = t; notifEnabled = true;
  localStorage.setItem('ndalama_notif','true');
  localStorage.setItem('ndalama_reminder', reminderTime);
  scheduleDailyReminder();
  document.getElementById('notifBtn')?.classList.add('active');
  closeModal('reminderModal');
  updatePrefRows();
  toast('✓ Reminder set for '+formatTime12hr(reminderTime));
}
window.saveReminder = saveReminder;

/* ═══════════════════════════════════════════════
   EXPORT — PDF
   ═══════════════════════════════════════════════ */
function doExport() {
  exportType === 'csv' ? exportCSV() : generatePDF();
}
window.doExport = doExport;

function generatePDF() {
  const { jsPDF } = window.jspdf;
  const val = document.getElementById('reportMonth')?.value;
  if (!val) { toast('Please select a month.'); return; }
  const [y,m] = val.split('-').map(Number);
  const monthName = new Date(y,m-1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  const mExp = monthExpenses(m-1,y);
  if (!mExp.length) { toast('No expenses for '+monthName); return; }

  const doc   = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const total = mExp.reduce((s,e)=>s+e.amount,0);

  doc.setFillColor(27,201,201); doc.rect(0,0,210,40,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(22);
  doc.text('NDALAMA EXPENSE TRACKER',14,18);
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.text('Monthly Report — '+monthName,14,28);
  doc.text('Generated: '+new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}),14,35);
  if (userProfile.fullName) {
    doc.setFontSize(9);
    doc.text('Account: '+userProfile.fullName+' ('+( userProfile.email||'')+') | Currency: '+currency.code,14,35);
  }

  let y2=50;
  doc.setFillColor(232,250,250); doc.roundedRect(14,y2,182,22,3,3,'F');
  doc.setTextColor(26,26,46); doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text('TOTAL EXPENDITURE FOR '+monthName.toUpperCase(),20,y2+8);
  doc.setFontSize(16); doc.setTextColor(14,143,143);
  doc.text(currency.symbol+' '+total.toLocaleString(),20,y2+17);
  if (monthlyIncome>0) {
    doc.setFontSize(9); doc.setTextColor(100,100,120); doc.setFont('helvetica','normal');
    doc.text('Income: '+currency.symbol+' '+monthlyIncome.toLocaleString()+' | Balance: '+currency.symbol+' '+Math.max(monthlyIncome-total,0).toLocaleString(),130,y2+10);
  }
  y2+=30;

  const cats       = {};
  mExp.forEach(e=>{ cats[e.category]=(cats[e.category]||0)+e.amount; });
  const sortedCats = Object.entries(cats).sort((a,b)=>b[1]-a[1]);

  doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(26,26,46);
  doc.text('SPENDING BY CATEGORY',14,y2); y2+=4;

  if (sortedCats.length) {
    const [tc,ta]=sortedCats[0];
    doc.setFillColor(27,201,201); doc.roundedRect(14,y2,182,10,2,2,'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text('★ Highest: '+tc+' → '+currency.symbol+' '+ta.toLocaleString()+' ('+((ta/total)*100).toFixed(1)+'%)',18,y2+6.5);
    y2+=14;
  }

  doc.autoTable({
    startY:y2,
    head:[['Category','Amount ('+currency.code+')','% of Total','Count']],
    body:sortedCats.map(([c,a])=>[c,currency.symbol+' '+a.toLocaleString(),((a/total)*100).toFixed(1)+'%',mExp.filter(e=>e.category===c).length]),
    headStyles:{fillColor:[26,26,46],textColor:[27,201,201],fontStyle:'bold',fontSize:10},
    bodyStyles:{fontSize:9,textColor:[26,26,46]},
    alternateRowStyles:{fillColor:[240,253,253]},
    columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'center'}},
    margin:{left:14,right:14}
  });

  y2=doc.lastAutoTable.finalY+10;
  if (y2>230){doc.addPage();y2=20;}

  doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(26,26,46);
  doc.text('DETAILED TRANSACTIONS',14,y2); y2+=2;

  doc.autoTable({
    startY:y2,
    head:[['Date','Category','Description','Amount ('+currency.code+')']],
    body:[...mExp].sort((a,b)=>a.date.localeCompare(b.date)).map(e=>[
      new Date(e.date+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),
      e.category,e.description||'—',currency.symbol+' '+e.amount.toLocaleString()
    ]),
    headStyles:{fillColor:[26,26,46],textColor:[27,201,201],fontStyle:'bold',fontSize:9},
    bodyStyles:{fontSize:8.5,textColor:[26,26,46]},
    alternateRowStyles:{fillColor:[240,253,253]},
    columnStyles:{3:{halign:'right'}},
    margin:{left:14,right:14},
    foot:[['','','TOTAL',currency.symbol+' '+total.toLocaleString()]],
    footStyles:{fillColor:[27,201,201],textColor:[255,255,255],fontStyle:'bold',fontSize:9}
  });

  const pc=doc.internal.getNumberOfPages();
  for(let i=1;i<=pc;i++){
    doc.setPage(i);
    doc.setFillColor(232,250,250); doc.rect(0,285,210,12,'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(100,100,120);
    doc.text('Ndalama Expense Tracker · Personal Finance Report · '+(userProfile.fullName||''),14,292);
    doc.text('Page '+i+' of '+pc,185,292);
  }

  closeModal('monthModal');
  doc.save('Ndalama_'+monthName.replace(' ','_')+'.pdf');
  toast('📄 PDF downloaded!');
}
window.generatePDF = generatePDF;

/* ═══════════════════════════════════════════════
   EXPORT — CSV
   ═══════════════════════════════════════════════ */
function exportCSV() {
  const val = document.getElementById('reportMonth')?.value;
  if (!val) { toast('Please select a month.'); return; }
  const [y,m] = val.split('-').map(Number);
  const monthName = new Date(y,m-1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  const mExp = monthExpenses(m-1,y);
  if (!mExp.length) { toast('No expenses for '+monthName); return; }

  const rows = [
    ['Date','Category','Description','Amount ('+currency.code+')'],
    ...[...mExp].sort((a,b)=>a.date.localeCompare(b.date)).map(e=>[
      e.date, e.category, e.description||'', e.amount
    ]),
    ['','','TOTAL', mExp.reduce((s,e)=>s+e.amount,0)]
  ];

  const csv = rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `Ndalama_${monthName.replace(' ','_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  closeModal('monthModal');
  toast('📊 CSV downloaded!');
}
window.exportCSV = exportCSV;

/* ═══════════════════════════════════════════════
   NOTIFICATIONS & ALERTS
   ═══════════════════════════════════════════════ */
function scheduleDailyReminder() {
  if (!notifEnabled || Notification.permission!=='granted') return;
  if (window._notifTimer) clearTimeout(window._notifTimer);
  const [h,m] = reminderTime.split(':').map(Number);
  const now   = new Date();
  const fire  = new Date(now);
  fire.setHours(h,m,0,0);
  if (now>=fire) fire.setDate(fire.getDate()+1);
  window._notifTimer = setTimeout(()=>{
    const today = new Date().toISOString().split('T')[0];
    const cnt   = expenses.filter(e=>e.date===today).length;
    new Notification('Ndalama 💰',{
      body: cnt===0 ? "You haven't logged any expenses today!" : `You've logged ${cnt} expense${cnt>1?'s':''} today. Anything else?`
    });
    scheduleDailyReminder();
  }, fire-now);
}

function scheduleWeeklySummary() {
  if (!notifEnabled || Notification.permission!=='granted') return;
  if (window._weeklyTimer) clearTimeout(window._weeklyTimer);
  const now    = new Date();
  const sunday = new Date(now);
  // next Sunday at 9:00 AM
  const daysUntilSun = (7 - now.getDay()) % 7 || 7;
  sunday.setDate(now.getDate() + daysUntilSun);
  sunday.setHours(9,0,0,0);
  window._weeklyTimer = setTimeout(()=>{
    const ws       = weekStart();
    const wkExp    = expenses.filter(e=>new Date(e.date)>=ws);
    const wkTotal  = wkExp.reduce((s,e)=>s+e.amount,0);
    new Notification('Ndalama — Weekly Summary 📊',{
      body:`This week you spent ${fmt(wkTotal)} across ${wkExp.length} transaction${wkExp.length!==1?'s':''}.`
    });
    scheduleWeeklySummary();
  }, sunday-now);
}

function checkBudgetAlert() {
  if (!budget || !notifEnabled || Notification.permission!=='granted') return;
  const now   = new Date();
  const mAmt  = monthExpenses(now.getMonth(),now.getFullYear()).reduce((s,e)=>s+e.amount,0);
  const pct   = (mAmt/budget)*100;
  const key   = 'ndalama_budget_alerted_'+new Date().toISOString().slice(0,7);
  if (pct>=80 && !localStorage.getItem(key)) {
    localStorage.setItem(key,'1');
    new Notification('Ndalama ⚠️ Budget Alert',{
      body:`You've used ${pct.toFixed(0)}% of your ${fmt(budget)} monthly budget!`
    });
    toast('⚠️ You\'ve reached '+pct.toFixed(0)+'% of your monthly budget!');
  }
}

/* ═══════════════════════════════════════════════
   STREAK TRACKER
   ═══════════════════════════════════════════════ */
function calcStreak() {
  if (!expenses.length) return 0;
  const dates  = [...new Set(expenses.map(e=>e.date))].sort((a,b)=>b.localeCompare(a));
  const today  = new Date().toISOString().split('T')[0];
  let streak   = 0;
  let check    = new Date(today);

  for (let i=0; i<365; i++) {
    const key = check.toISOString().split('T')[0];
    if (dates.includes(key)) {
      streak++;
      check.setDate(check.getDate()-1);
    } else {
      // Allow today to be missing (day not over yet)
      if (key === today) { check.setDate(check.getDate()-1); continue; }
      break;
    }
  }
  return streak;
}

/* ═══════════════════════════════════════════════
   PREFERENCES LOADER
   ═══════════════════════════════════════════════ */
function loadPrefs() {
  const uid     = currentUser?.uid||'';
  notifEnabled  = JSON.parse(localStorage.getItem('ndalama_notif')    ||'false');
  reminderTime  = localStorage.getItem('ndalama_reminder')             ||'18:00';
  budget        = parseFloat(localStorage.getItem('ndalama_budget_'+uid)||'0');
  monthlyIncome = parseFloat(localStorage.getItem('ndalama_income_'+uid)||'0');
  darkMode      = localStorage.getItem('ndalama_dark')==='1';
  const savedCurr = localStorage.getItem('ndalama_currency');
  if (savedCurr) try { currency = JSON.parse(savedCurr); } catch(e){}
  if (notifEnabled) {
    scheduleDailyReminder();
    scheduleWeeklySummary();
  }
  updatePrefRows();
}

/* ═══════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════ */
function v(id)           { return (document.getElementById(id)?.value||'').trim(); }
function setText(id,val) { const el=document.getElementById(id); if(el) el.textContent=val; }

function fmt(n) {
  return currency.symbol+' '+Number(n).toLocaleString('en',{minimumFractionDigits:0,maximumFractionDigits:2});
}
function fmtShort(n) {
  const s = currency.symbol;
  if(n>=1_000_000) return s+' '+(n/1_000_000).toFixed(1)+'M';
  if(n>=1_000)     return s+' '+(n/1_000).toFixed(1)+'K';
  return fmt(n);
}
function formatTime12hr(t) {
  const [h,m]=t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}
function weekStart() {
  const d=new Date(); d.setDate(d.getDate()-d.getDay()+(d.getDay()===0?-6:1)); d.setHours(0,0,0,0); return d;
}
function monthExpenses(m,y) {
  return expenses.filter(e=>{ const d=new Date(e.date); return d.getMonth()===m&&d.getFullYear()===y; });
}
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

function friendlyError(code) {
  const map={
    'auth/user-not-found':'No account found with that email.',
    'auth/wrong-password':'Incorrect password.',
    'auth/email-already-in-use':'An account with this email already exists.',
    'auth/invalid-email':'Please enter a valid email address.',
    'auth/weak-password':'Password is too weak.',
    'auth/too-many-requests':'Too many attempts. Try again later.',
    'auth/network-request-failed':'No internet connection.',
    'auth/popup-closed-by-user':'Google sign-in was cancelled.',
    'auth/invalid-credential':'Incorrect email or password.'
  };
  return map[code]||'Something went wrong. Please try again.';
}

let _toastTimer;
function toast(msg) {
  const el=document.getElementById('toast'); if(!el) return;
  el.textContent=msg; el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>el.classList.remove('show'),3500);
}

function compressPhoto(base64, maxSize=200) {
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      const canvas=document.createElement('canvas');
      let w=img.width, h=img.height;
      if(w>h){if(w>maxSize){h=Math.round(h*maxSize/w);w=maxSize;}}
      else{if(h>maxSize){w=Math.round(w*maxSize/h);h=maxSize;}}
      canvas.width=w; canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      resolve(canvas.toDataURL('image/jpeg',0.75));
    };
    img.onerror=reject; img.src=base64;
  });
}
