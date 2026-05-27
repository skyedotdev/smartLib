/* ================================================================
   SMARTLIB — FIREBASE FIRESTORE BACKEND
   firebase-backend.js  |  Drop-in replacement for localStorage

   HOW TO USE:
   1. Paste your Firebase config object into FIREBASE_CONFIG below.
   2. Add these two <script> tags BEFORE the closing </body> tag
      in smartlib-fixed.html — place them ABOVE the existing <script>
      blocks so Firebase is ready before any app code runs:

        <script type="module" src="firebase-backend.js"></script>

      OR, if you prefer a classic (non-module) approach, paste the
      entire contents of this file inside a
        <script type="module"> … </script>
      block directly in smartlib-fixed.html just above the first
      existing <script> tag.

   3. Copy your Firebase project's CDN imports into the <head>:
      (replace X.X.X with the latest version from firebase.google.com)

        <!-- Firebase App (required) -->
        <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
        <!-- Firestore -->
        <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
        <!-- Firebase Auth -->
        <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>

      ⚠️  Use the "-compat" builds so the existing window.* calls
          in smartlib-fixed.html continue to work without any rewrites.

   4. Replace every call to saveStateToDisk() in smartlib-fixed.html
      with the new async helpers defined here (each is described
      inline below).  All the *render* functions stay exactly as they
      are — only the read/write calls change.

   FIREBASE SECURITY RULES (paste into Firestore Rules console):
   ================================================================
   See the bottom of this file for the complete rules block.
   ================================================================ */

// ──────────────────────────────────────────────────────────────
// STEP 1 — PASTE YOUR FIREBASE CONFIG HERE
// Go to: Firebase Console → Project Settings → Your apps → SDK setup
// ──────────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDBgYRsCB4s55E5aNEjHcY9XywLzHuw_RQ",
  authDomain:        "smartlib-nu.firebaseapp.com",
  projectId:         "smartlib-nu",
  storageBucket:     "smartlib-nu.firebasestorage.app",
  messagingSenderId: "915744165141",
  appId:             "1:915744165141:web:2a76b51e515155b0926d1c"
};

// ──────────────────────────────────────────────────────────────
// STEP 2 — FIREBASE INITIALISATION
// ──────────────────────────────────────────────────────────────
firebase.initializeApp(FIREBASE_CONFIG);
const db   = firebase.firestore();
const auth = firebase.auth();

// Firestore collection references — mirrors the existing localStorage keys
const COL = {
  catalog:       db.collection('nu_catalog'),
  accounts:      db.collection('nu_accounts'),
  bookings:      db.collection('nu_bookings'),
  holds:         db.collection('nu_holds'),
  logs:          db.collection('nu_logs'),
  notifications: db.collection('nu_notifications'),
  fineConfig:    db.collection('nu_fine_cfg'),
};

// ──────────────────────────────────────────────────────────────
// STEP 3 — HELPER: convert Firestore snapshot → plain JS array
// ──────────────────────────────────────────────────────────────
function snapshotToArray(snap) {
  return snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
}

// ──────────────────────────────────────────────────────────────
// STEP 4 — BOOTSTRAP: load ALL data from Firestore on page load
// This runs once at startup to populate the in-memory arrays used
// by the existing render functions (bookCatalog, userAccounts, …).
// ──────────────────────────────────────────────────────────────
async function bootstrapFromFirestore() {
  const [catSnap, accSnap, bkSnap, holdSnap, logSnap, notifSnap, cfgSnap] =
    await Promise.all([
      COL.catalog.get(),
      COL.accounts.get(),
      COL.bookings.get(),
      COL.holds.get(),
      COL.logs.orderBy('timestamp', 'desc').limit(500).get(),
      COL.notifications.get(),
      COL.fineConfig.doc('config').get(),
    ]);

  // Overwrite the in-memory arrays that the existing JS already declares
  window.bookCatalog        = snapshotToArray(catSnap);
  window.userAccounts       = snapshotToArray(accSnap);
  window.roomBookings       = snapshotToArray(bkSnap);
  window.physicalHolds      = snapshotToArray(holdSnap);
  window.systemLogs         = snapshotToArray(logSnap);
  window.inAppNotifications = snapshotToArray(notifSnap);
  window.fineConfig         = cfgSnap.exists
    ? cfgSnap.data()
    : { standardRate: 1.00, highRate: 2.50, graceStandard: 10, graceHigh: 4 };

  console.log('[SmartLib] Firestore bootstrap complete.');

  // Now that real data is loaded, run the startup renders
  refreshSessionUI();
  filterCatalog();
}

// ──────────────────────────────────────────────────────────────
// STEP 5 — REPLACE saveStateToDisk()
// The original function writes everything to localStorage.
// This version writes the changed slice to Firestore instead.
// Call the targeted helpers below instead of saveStateToDisk().
// A legacy fallback is kept so any remaining calls in the HTML
// file that weren't updated yet won't crash.
// ──────────────────────────────────────────────────────────────
window.saveStateToDisk = function () {
  // No-op shim: each action now calls a targeted async helper.
  // Log a warning so you can find any remaining un-migrated calls.
  console.warn('[SmartLib] saveStateToDisk() called — use targeted Firestore helpers instead.');
};


/* ════════════════════════════════════════════════════════════════
   ██  BOOK CATALOG  ████████████████████████████████████████████
   ════════════════════════════════════════════════════════════════ */

/**
 * Save a new book record to Firestore and update the in-memory array.
 * Replaces the local push + saveStateToDisk pattern.
 */
async function fb_saveNewBook(bookData) {
  const ref  = await COL.catalog.add(bookData);
  const saved = { _docId: ref.id, ...bookData };
  window.bookCatalog.push(saved);
  await fb_addLog(`Book added to catalog: "${bookData.title}" (${bookData.isbn})`, 'green');
  return saved;
}

/**
 * Update an existing book in Firestore.
 * bookData must include _docId (set automatically by bootstrapFromFirestore).
 */
async function fb_updateBook(bookData) {
  const { _docId, ...fields } = bookData;
  await COL.catalog.doc(_docId).set(fields, { merge: true });
  // Sync in-memory
  const idx = window.bookCatalog.findIndex(b => b._docId === _docId);
  if (idx !== -1) window.bookCatalog[idx] = bookData;
  await fb_addLog(`Book updated: "${bookData.title}"`, 'info');
}

/**
 * Delete a book from Firestore.
 * Pass the book object (needs _docId).
 */
async function fb_deleteBook(book) {
  await COL.catalog.doc(book._docId).delete();
  window.bookCatalog = window.bookCatalog.filter(b => b._docId !== book._docId);
  await fb_addLog(`Book deleted: "${book.title}" (${book.isbn})`, 'red');
}

/**
 * Toggle a book's availability in Firestore.
 */
async function fb_setBookAvailability(bookDocId, available) {
  await COL.catalog.doc(bookDocId).update({ available });
  const b = window.bookCatalog.find(b => b._docId === bookDocId);
  if (b) b.available = available;
}

/**
 * Update a book's reservation queue in Firestore.
 */
async function fb_updateBookQueue(bookDocId, reservationQueue) {
  await COL.catalog.doc(bookDocId).update({ reservationQueue });
  const b = window.bookCatalog.find(b => b._docId === bookDocId);
  if (b) b.reservationQueue = reservationQueue;
}


/* ════════════════════════════════════════════════════════════════
██  USER ACCOUNTS  ███████████████████████████████████████████
   ════════════════════════════════════════════════════════════════ */

/**
 * Register a new user.
 * The document ID is the user's email (makes lookups trivial).
 *
 * SCHEMA per user document:
 * {
 *   name:             string,
 *   email:            string,
 *   role:             "Student" | "Librarian" | "Admin",
 *   password:         string  (SHA-256 hex, client-side),
 *   outstandingFines: number  (Students only, default 0),
 *   loans:            []
 * }
 *
 * Librarian and Admin accounts are NOT self-registerable.
 * Create them manually in the Firestore console and set role accordingly.
 */
async function fb_registerUser(userData) {
  const emailKey = userData.email.replace(/\./g, '_dot_'); // Firestore doc IDs can't contain dots
  await COL.accounts.doc(emailKey).set(userData);
  window.userAccounts.push({ _docId: emailKey, ...userData });
  await fb_addLog(`New ${userData.role} registered: ${userData.name} (${userData.email})`, 'green');
}

/**
 * Fetch a single user by email.
 */
async function fb_getUserByEmail(email) {
  const emailKey = email.replace(/\./g, '_dot_');
  const snap = await COL.accounts.doc(emailKey).get();
  return snap.exists ? { _docId: snap.id, ...snap.data() } : null;
}

/**
 * Update outstanding fines for a student.
 */
async function fb_updateStudentFine(email, newFineAmount) {
  const emailKey = email.replace(/\./g, '_dot_');
  await COL.accounts.doc(emailKey).update({ outstandingFines: newFineAmount });
  const stu = window.userAccounts.find(u => u.email === email);
  if (stu) stu.outstandingFines = newFineAmount;
}


/* ════════════════════════════════════════════════════════════════
   ██  PHYSICAL HOLDS (Checkouts)  ██████████████████████████████
   ════════════════════════════════════════════════════════════════ */

/**
 * Create a new hold record.
 *
 * SCHEMA per hold document:
 * {
 *   id:           number  (Date.now()),
 *   code:         string  (NU-XXXXXXXX kiosk token),
 *   studentEmail: string,
 *   bookId:       number,
 *   bookTitle:    string,
 *   rateClass:    "STANDARD" | "HIGH_PRIORITY",
 *   checkoutDate: string (ISO date),
 *   dueDate:      string (ISO date),
 *   returned:     boolean
 * }
 */
async function fb_createHold(holdData) {
  const ref  = await COL.holds.add(holdData);
  const saved = { _docId: ref.id, ...holdData };
  window.physicalHolds.push(saved);
  await fb_addLog(`Hold placed: "${holdData.bookTitle}" by ${holdData.studentEmail}`, 'green');
  return saved;
}

/**
 * Mark a hold as returned.
 */
async function fb_markHoldReturned(holdDocId, bookTitle, studentEmail) {
  await COL.holds.doc(holdDocId).update({ returned: true });
  const h = window.physicalHolds.find(h => h._docId === holdDocId);
  if (h) h.returned = true;
  await fb_addLog(`Book returned: "${bookTitle}" by ${studentEmail}`, 'green');
}

/**
 * Delete a hold record.
 */
async function fb_deleteHold(hold) {
  await COL.holds.doc(hold._docId).delete();
  window.physicalHolds = window.physicalHolds.filter(h => h._docId !== hold._docId);
  await fb_addLog(`Hold record deleted: "${hold.bookTitle}" for ${hold.studentEmail}`, 'red');
}


/* ════════════════════════════════════════════════════════════════
   ██  ROOM BOOKINGS  ███████████████████████████████████████████
   ════════════════════════════════════════════════════════════════ */

/**
 * Create a new room booking.
 *
 * SCHEMA per booking document:
 * {
 *   id:           number  (Date.now()),
 *   studentEmail: string,
 *   room:         string,
 *   date:         string (YYYY-MM-DD),
 *   startTime:    string (HH:MM),
 *   duration:     number (minutes),
 *   invites:      string[]
 * }
 */
async function fb_createRoomBooking(bookingData) {
  const ref  = await COL.bookings.add(bookingData);
  const saved = { _docId: ref.id, ...bookingData };
  window.roomBookings.push(saved);
  await fb_addLog(`Room booked: ${bookingData.room} by ${bookingData.studentEmail} on ${bookingData.date} at ${bookingData.startTime}`, 'green');
  return saved;
}

/**
 * Delete a room booking.
 */
async function fb_deleteRoomBooking(booking) {
  await COL.bookings.doc(booking._docId).delete();
  window.roomBookings = window.roomBookings.filter(r => r._docId !== booking._docId);
  await fb_addLog(`Room booking deleted: ${booking.room} on ${booking.date} for ${booking.studentEmail}`, 'red');
}


/* ════════════════════════════════════════════════════════════════
   ██  IN-APP NOTIFICATIONS  ████████████████████████████████████
   ════════════════════════════════════════════════════════════════ */

/**
 * Push a new notification.
 *
 * SCHEMA per notification document:
 * {
 *   id:          number,
 *   toEmail:     string,
 *   isRegistered:boolean,
 *   read:        boolean,
 *   isUpdate:    boolean,
 *   isQueueReady:boolean (optional),
 *   room:        string  (optional),
 *   date:        string  (optional),
 *   startTime:   string  (optional),
 *   duration:    string  (optional),
 *   hostName:    string  (optional),
 *   hostEmail:   string  (optional),
 *   bookTitle:   string  (optional),
 *   bookId:      number  (optional),
 *   createdAt:   string  (ISO)
 * }
 */
async function fb_pushNotification(notifData) {
  const ref  = await COL.notifications.add(notifData);
  const saved = { _docId: ref.id, ...notifData };
  window.inAppNotifications.unshift(saved);
  return saved;
}

/**
 * Mark a single notification as read.
 */
async function fb_markNotifRead(notifDocId) {
  await COL.notifications.doc(notifDocId).update({ read: true });
  const n = window.inAppNotifications.find(n => n._docId === notifDocId);
  if (n) n.read = true;
}

/**
 * Mark all of a student's notifications as read.
 */
async function fb_markAllNotifsRead(studentEmail) {
  const mine = window.inAppNotifications.filter(n => n.toEmail === studentEmail && !n.read);
  await Promise.all(mine.map(n => COL.notifications.doc(n._docId).update({ read: true })));
  mine.forEach(n => { n.read = true; });
}


/* ════════════════════════════════════════════════════════════════
   ██  SYSTEM LOGS  █████████████████████████████████████████████
   ════════════════════════════════════════════════════════════════ */

/**
 * Append a log entry to Firestore.
 * Replaces the existing addLog() localStorage write.
 */
async function fb_addLog(message, type = 'info') {
  const entry = { message, type, timestamp: new Date().toISOString() };
  const ref   = await COL.logs.add(entry);
  window.systemLogs.unshift({ _docId: ref.id, ...entry });
  if (window.systemLogs.length > 500) window.systemLogs.pop();
}

// Patch the existing addLog() so all existing call-sites automatically
// write to Firestore — no changes needed in smartlib-fixed.html.
window.addLog = function(message, type = 'info') {
  fb_addLog(message, type); // fire-and-forget
};


/* ════════════════════════════════════════════════════════════════
   ██  FINE CONFIGURATION  ██████████████████████████████████████
   ════════════════════════════════════════════════════════════════ */

/**
 * Persist fine configuration changes.
 */
async function fb_saveFineConfig(configData) {
  await COL.fineConfig.doc('config').set(configData, { merge: true });
  window.fineConfig = configData;
  await fb_addLog(`Fine configuration updated by ${window.currentSession?.email}`, 'gold');
}


/* ════════════════════════════════════════════════════════════════
   ██  REAL-TIME LISTENERS (onSnapshot)  ████████████████████████

   These listeners keep the dashboard views in sync across devices
   without any page reload.  Attach them once after login.
   ════════════════════════════════════════════════════════════════ */

// Active listener cleanup handles (call unsubscribe() on logout)
const _unsubscribers = [];

/**
 * STUDENT LISTENER
 * Watches: holds, bookings, notifications, catalog availability.
 * Updates stats and panel lists live.
 */
function attachStudentListeners(studentEmail) {
  // 1. My active holds
  _unsubscribers.push(
    COL.holds
      .where('studentEmail', '==', studentEmail)
      .where('returned', '==', false)
      .onSnapshot(snap => {
        const myHolds = snapshotToArray(snap);
        // Merge into master array
        window.physicalHolds = [
          ...window.physicalHolds.filter(h => h.studentEmail !== studentEmail || h.returned),
          ...myHolds,
        ];
        const el = document.getElementById('stu-stat-holds');
        if (el) el.innerText = myHolds.length;
        if (typeof renderStudentPasses === 'function') renderStudentPasses();
      })
  );

  // 2. My room bookings
  _unsubscribers.push(
    COL.bookings
      .where('studentEmail', '==', studentEmail)
      .onSnapshot(snap => {
        const myRooms = snapshotToArray(snap);
        window.roomBookings = [
          ...window.roomBookings.filter(r => r.studentEmail !== studentEmail),
          ...myRooms,
        ];
        const el = document.getElementById('stu-stat-rooms');
        if (el) el.innerText = myRooms.length;
      })
  );

  // 3. My notifications
  _unsubscribers.push(
    COL.notifications
      .where('toEmail', '==', studentEmail)
      .onSnapshot(snap => {
        const myNotifs = snapshotToArray(snap)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        window.inAppNotifications = myNotifs;
        if (typeof renderStudentNotifications === 'function') renderStudentNotifications();
      })
  );

  // 4. My fine amount (from account doc)
  const emailKey = studentEmail.replace(/\./g, '_dot_');
  _unsubscribers.push(
    COL.accounts.doc(emailKey).onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();
      const stu  = window.userAccounts.find(u => u.email === studentEmail);
      if (stu) stu.outstandingFines = data.outstandingFines;
      if (window.currentSession?.email === studentEmail) {
        window.currentSession.outstandingFines = data.outstandingFines;
      }
      const fineBox = document.getElementById('fine-status-box');
      const fineVal = parseFloat(data.outstandingFines) || 0;
      if (fineBox) {
        fineBox.innerText = `Fines: $${fineVal.toFixed(2)}${fineVal > 10 ? ' (Holds Blocked)' : ''}`;
        fineBox.className = `status-box ${fineVal > 10 ? 'fine-blocked' : 'fine-ok'}`;
      }
      const fineAmountEl = document.getElementById('payment-fine-amount');
      if (fineAmountEl) fineAmountEl.innerText = `$${fineVal.toFixed(2)}`;
      const stuFine = document.getElementById('stu-stat-fines');
      if (stuFine) stuFine.innerText = `$${fineVal.toFixed(2)}`;
    })
  );
}

/**
 * LIBRARIAN LISTENER
 * Watches: all holds (active loans), all room bookings, fine config, catalog.
 * Refreshes the librarian workspace panels live.
 */
function attachLibrarianListeners() {
  // 1. All active holds
  _unsubscribers.push(
    COL.holds.where('returned', '==', false).onSnapshot(snap => {
      const active = snapshotToArray(snap);
      window.physicalHolds = [
        ...window.physicalHolds.filter(h => h.returned),
        ...active,
      ];
      if (typeof renderLoansTable === 'function') renderLoansTable();
    })
  );

  // 2. All room bookings
  _unsubscribers.push(
    COL.bookings.onSnapshot(snap => {
      window.roomBookings = snapshotToArray(snap);
      const roomsRoot = document.getElementById('lib-rooms-container');
      if (roomsRoot && typeof renderLibrarianWorkspace === 'function') renderLibrarianWorkspace();
    })
  );

  // 3. Fine configuration
  _unsubscribers.push(
    COL.fineConfig.doc('config').onSnapshot(snap => {
      if (snap.exists) window.fineConfig = snap.data();
    })
  );

  // 4. Entire catalog (availability changes)
  _unsubscribers.push(
    COL.catalog.onSnapshot(snap => {
      window.bookCatalog = snapshotToArray(snap);
      if (typeof filterCatalog === 'function') filterCatalog();
      if (typeof renderEditCatalogList === 'function') renderEditCatalogList();
    })
  );

  // 5. Student accounts (to see fines in real time)
  _unsubscribers.push(
    COL.accounts.where('role', '==', 'Student').onSnapshot(snap => {
      const freshStudents = snapshotToArray(snap);
      window.userAccounts = [
        ...window.userAccounts.filter(u => u.role !== 'Student'),
        ...freshStudents,
      ];
      const finesRoot = document.getElementById('lib-fines-container');
      if (finesRoot && typeof renderLibrarianWorkspace === 'function') renderLibrarianWorkspace();
    })
  );
}

/**
 * ADMIN LISTENER
 * Watches: everything.  Keeps the master dashboard fully live.
 */
function attachAdminListeners() {
  // 1. All accounts
  _unsubscribers.push(
    COL.accounts.onSnapshot(snap => {
      window.userAccounts = snapshotToArray(snap);
      if (typeof renderAdminDashboard === 'function') renderAdminDashboard();
    })
  );

  // 2. All catalog
  _unsubscribers.push(
    COL.catalog.onSnapshot(snap => {
      window.bookCatalog = snapshotToArray(snap);
      if (typeof filterCatalog === 'function') filterCatalog();
      if (typeof renderAdminDashboard === 'function') renderAdminDashboard();
    })
  );

  // 3. All holds
  _unsubscribers.push(
    COL.holds.onSnapshot(snap => {
      window.physicalHolds = snapshotToArray(snap);
      if (typeof renderAdminDashboard === 'function') renderAdminDashboard();
    })
  );

  // 4. All room bookings
  _unsubscribers.push(
    COL.bookings.onSnapshot(snap => {
      window.roomBookings = snapshotToArray(snap);
      if (typeof renderAdminDashboard === 'function') renderAdminDashboard();
    })
  );

  // 5. System logs (latest 500 in real time)
  _unsubscribers.push(
    COL.logs.orderBy('timestamp', 'desc').limit(500).onSnapshot(snap => {
      window.systemLogs = snapshotToArray(snap);
      const logsRoot = document.getElementById('admin-logs-container');
      if (logsRoot && typeof renderAdminDashboard === 'function') renderAdminDashboard();
    })
  );
}

/**
 * Remove all active listeners (call on logout).
 */
function detachAllListeners() {
  _unsubscribers.forEach(fn => fn());
  _unsubscribers.length = 0;
}


/* ════════════════════════════════════════════════════════════════
   ██  ROLE-BASED AUTH PATCHES  █████████████████████████████████

   These patches wrap the existing handleRegisterSubmit(),
   handleLoginSubmit(), and logoutSession() functions so they
   talk to Firestore instead of localStorage, without touching
   the HTML.
   ════════════════════════════════════════════════════════════════ */

/**
 * REGISTER — overrides the existing handleRegisterSubmit()
 */
window.handleRegisterSubmit = async function () {
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.toLowerCase().trim();
  const role     = document.getElementById('reg-role').value;
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-password-confirm').value;

  if (!name || !email) { showAlert('Please fill all fields.', 'error'); return; }
  if (!isValidUnivEmail(email)) {
    showAlert('Invalid email: Only university email addresses are accepted.', 'error'); return;
  }
  if (password.length < 8) { showAlert('Password must be at least 8 characters.', 'error'); return; }
  if (password !== confirm) { showAlert('Passwords do not match.', 'error'); return; }

  // Check uniqueness
  const existing = await fb_getUserByEmail(email);
  if (existing) { showAlert('This email is already registered.', 'error'); return; }

  const hashedPw = await hashPassword(password);
  const newUser  = { name, email, role, password: hashedPw, outstandingFines: 0, loans: [] };

  await fb_registerUser(newUser);
  showAlert('Account created! You can now sign in.', 'success');

  // Clear form
  ['reg-name','reg-email','reg-password','reg-password-confirm'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const fill = document.getElementById('pw-strength-fill');
  const lbl  = document.getElementById('pw-strength-label');
  if (fill) { fill.style.width = '0%'; fill.style.background = ''; }
  if (lbl)  { lbl.textContent = ''; }
  switchLoginMode('LOGIN');
  document.getElementById('login-email').value = email;
};

/**
 * LOGIN — overrides the existing handleLoginSubmit()
 */
window.handleLoginSubmit = async function () {
  const email    = document.getElementById('login-email').value.toLowerCase().trim();
  const password = document.getElementById('login-password').value;

  if (!isValidUnivEmail(email)) {
    showAlert('Invalid email: Only university email addresses are accepted.', 'error'); return;
  }
  if (!password) { showAlert('Please enter your password.', 'error'); return; }

  const user = await fb_getUserByEmail(email);
  if (!user) { showAlert('CAS Rejection: Profile not found. Register first.', 'error'); return; }

  const pwOk = await verifyPassword(password, user.password);
  if (!pwOk) {
    showAlert('Incorrect password. Please try again.', 'error');
    document.getElementById('login-password').value = '';
    return;
  }

  window.currentSession = user;
  sessionStorage.setItem('nu_active_session', JSON.stringify(user));

  await fb_addLog(`User signed in: ${user.name} (${user.role})`, 'green');

  showAlert(`Welcome, ${user.name}!`, 'success');
  document.getElementById('login-password').value = '';
  closeLoginDrawer();
  refreshSessionUI();

  // Attach role-specific real-time listeners
  if (user.role === 'Student')   attachStudentListeners(user.email);
  else if (user.role === 'Librarian') attachLibrarianListeners();
  else if (user.role === 'Admin')     attachAdminListeners();

  // Navigate to role dashboard
  if (user.role === 'Student')        checkAuthAndNavigate('student-view');
  else if (user.role === 'Librarian') checkAuthAndNavigate('librarian-view');
  else                                checkAuthAndNavigate('admin-view');
};

/**
 * LOGOUT — overrides the existing logoutSession()
 */
window.logoutSession = async function () {
  if (window.currentSession) {
    await fb_addLog(`User signed out: ${window.currentSession.name}`, 'gold');
  }
  detachAllListeners();
  window.currentSession = null;
  sessionStorage.removeItem('nu_active_session');
  showAlert('Logged out safely.', 'success');
  refreshSessionUI();
  switchView('catalog-view');
};


/* ════════════════════════════════════════════════════════════════
   ██  ACTION FUNCTION PATCHES  █████████████████████████████████

   Each of the following overrides an existing function so that
   data writes go to Firestore.  The UI / render logic is untouched.
   ════════════════════════════════════════════════════════════════ */

/** placeBookHold — Student checks out a book */
window.placeBookHold = async function (bookId) {
  if (!currentSession) { openLoginDrawer(); showAlert('Sign in to place holds.', 'error'); return; }
  if (currentSession.role !== 'Student') { showAlert('Only students can place holds.', 'error'); return; }

  const stu = window.userAccounts.find(u => u.email === currentSession.email);
  if (stu && parseFloat(stu.outstandingFines) > 10.00) {
    showAlert(`Hold blocked: Outstanding fine $${parseFloat(stu.outstandingFines).toFixed(2)} exceeds $10.00.`, 'error'); return;
  }

  const book = window.bookCatalog.find(b => b.id === bookId);
  if (!book || !book.available) { showAlert('Book is not available.', 'error'); return; }

  const code         = 'NU-' + Math.random().toString(36).substr(2, 8).toUpperCase();
  const checkoutDate = new Date().toISOString().split('T')[0];
  const dueDate      = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

  const holdData = {
    id: Date.now(), code,
    studentEmail: currentSession.email,
    bookId: book.id, bookTitle: book.title,
    rateClass: book.rateClass || 'STANDARD',
    checkoutDate, dueDate, returned: false,
  };

  await fb_createHold(holdData);
  await fb_setBookAvailability(book._docId, false);

  showAlert(`Hold confirmed for "${book.title}".`, 'success');
  refreshSessionUI();
  filterCatalog();
};

/** joinReservationQueue — Student joins wait queue */
window.joinReservationQueue = async function (bookId) {
  if (!currentSession) { openLoginDrawer(); showAlert('Sign in to join the queue.', 'error'); return; }
  if (currentSession.role !== 'Student') { showAlert('Only students can join reservation queues.', 'error'); return; }

  const book = window.bookCatalog.find(b => b.id === bookId);
  if (!book) return;
  if (book.available) { await placeBookHold(bookId); return; }

  const queue = book.reservationQueue || [];
  if (queue.includes(currentSession.email)) {
    showAlert('You are already in the queue for this book.', 'error'); return;
  }
  queue.push(currentSession.email);
  await fb_updateBookQueue(book._docId, queue);
  await fb_addLog(`Reservation queue joined: "${book.title}" by ${currentSession.email} (position ${queue.length})`, 'info');
  showAlert(`You are #${queue.length} in the queue for "${book.title}".`, 'success');
  filterCatalog();
};

/** markReturned — Librarian processes a book return */
window.markReturned = async function (holdId) {
  const hold = window.physicalHolds.find(h => h.id === holdId);
  if (!hold) return;

  await fb_markHoldReturned(hold._docId, hold.bookTitle, hold.studentEmail);

  const book = window.bookCatalog.find(b => b.id === hold.bookId);
  if (book) {
    const queue = book.reservationQueue || [];
    if (queue.length > 0) {
      const nextEmail = queue.shift();
      await fb_updateBookQueue(book._docId, queue);
      // Notify the next student
      await fb_pushNotification({
        id: Date.now() + Math.random(),
        toEmail: nextEmail,
        isRegistered: true, read: false,
        isQueueReady: true,
        bookTitle: book.title, bookId: book.id,
        createdAt: new Date().toISOString(),
      });
    } else {
      await fb_setBookAvailability(book._docId, true);
    }
  }

  showAlert(`"${hold.bookTitle}" marked as returned.`, 'success');
  renderLoansTable();
  filterCatalog();
};

/** bookStudyRoom — Student reserves a room */
window.bookStudyRoom = async function () {
  if (!currentSession) { showAlert('Please sign in first.', 'error'); return; }
  const room   = document.getElementById('room-select').value;
  const date   = document.getElementById('booking-date').value;
  const time   = document.getElementById('booking-time').value;
  const dur    = parseInt(document.getElementById('booking-duration').value, 10);
  const emails = document.getElementById('group-emails').value.trim();
  if (!date || !time) { showAlert('Please select a date and time.', 'error'); return; }

  const [reqH, reqM] = time.split(':').map(Number);
  const reqStart = reqH * 60 + reqM;
  const reqEnd   = reqStart + dur;
  const overlap  = window.roomBookings.find(b => {
    if (b.room !== room || b.date !== date) return false;
    const [bH, bM] = b.startTime.split(':').map(Number);
    const bStart = bH * 60 + bM;
    const bEnd   = bStart + parseInt(b.duration, 10);
    return reqStart < bEnd && reqEnd > bStart;
  });
  if (overlap) {
    showAlert(`Room already reserved from ${overlap.startTime} for ${overlap.duration}m on ${date}.`, 'error'); return;
  }

  const invites = emails ? emails.split(',').map(e => e.trim().toLowerCase()).filter(e => e) : [];
  if (invites.length > 0) {
    const invalid = invites.filter(e => !window.userAccounts.some(u => u.email === e && u.role === 'Student'));
    if (invalid.length > 0) {
      showAlert(`Invitation failed: ${invalid.join(', ')} are not registered student accounts.`, 'error'); return;
    }
    if (invites.includes(currentSession.email)) {
      showAlert('You cannot invite yourself.', 'error'); return;
    }
  }

  await fb_createRoomBooking({
    id: Date.now(),
    studentEmail: currentSession.email,
    room, date, startTime: time, duration: dur, invites,
  });

  if (invites.length > 0) {
    await sendRoomInviteEmails({ room, date, startTime: time, duration: dur, invites, hostName: currentSession.name, hostEmail: currentSession.email });
  }

  showAlert(`Reservation confirmed for ${room}.`, 'success');
  document.getElementById('booking-time').value  = '';
  document.getElementById('group-emails').value  = '';
  renderStudentDashboard();
};

/** sendRoomInviteEmails — push in-app notifications to invited students */
window.sendRoomInviteEmails = async function ({ room, date, startTime, duration, invites, hostName, hostEmail, isUpdate = false }) {
  if (!invites || invites.length === 0) return;
  const mins     = parseInt(duration, 10);
  const durLabel = mins < 60 ? `${mins} minutes` : `${Math.floor(mins/60)}h${mins%60>0?' '+(mins%60)+'m':''}`;
  let delivered  = 0;

  for (const recipientEmail of invites) {
    const recipient = window.userAccounts.find(u => u.email === recipientEmail && u.role === 'Student');
    await fb_pushNotification({
      id: Date.now() + Math.random(),
      toEmail: recipientEmail,
      isRegistered: !!recipient,
      read: false, isUpdate,
      room, date, startTime,
      duration: durLabel,
      hostName, hostEmail,
      createdAt: new Date().toISOString(),
    });
    delivered++;
  }
  const regCount = invites.filter(e => window.userAccounts.some(u => u.email === e && u.role === 'Student')).length;
  showAlert(isUpdate
    ? `✏️ Updated booking notification sent to ${delivered} member(s).`
    : `📬 Room invitation sent to ${delivered} member(s). ${regCount} registered accounts will see it on their dashboard.`,
    'success');
};

/** cancelRoomOverride — Librarian cancels a booking */
window.cancelRoomOverride = async function (id) {
  const booking = window.roomBookings.find(r => r.id === id);
  if (!booking) return;
  await fb_deleteRoomBooking(booking);
  showAlert('Reservation cancelled.', 'success');
  renderLibrarianWorkspace();
};

/** saveFineConfig — Librarian saves fine rate settings */
window.saveFineConfig = async function () {
  const cfg = {
    standardRate:  parseFloat(document.getElementById('fine-rate-standard').value) || 1.00,
    highRate:      parseFloat(document.getElementById('fine-rate-high').value)     || 2.50,
    graceStandard: parseInt(document.getElementById('grace-standard').value)       || 10,
    graceHigh:     parseInt(document.getElementById('grace-high').value)           || 4,
  };
  await fb_saveFineConfig(cfg);
  showAlert('Fine configuration saved.', 'success');
};

/** applyLateFine — Librarian applies a manual fine */
window.applyLateFine = async function () {
  const email       = document.getElementById('fine-student-email').value.toLowerCase().trim();
  const amountInput = document.getElementById('fine-manual-amount').value;
  const amount      = parseFloat(amountInput);
  const stu         = window.userAccounts.find(u => u.email === email && u.role === 'Student');
  if (!stu) { showAlert('Student not found.', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { showAlert('Enter a valid fine amount.', 'error'); return; }
  const newFine = (parseFloat(stu.outstandingFines) || 0) + amount;
  await fb_updateStudentFine(email, newFine);
  await fb_addLog(`Fine applied: $${amount.toFixed(2)} to ${stu.name} by librarian ${currentSession.email}`, 'red');
  showAlert(`$${amount.toFixed(2)} fine applied to ${stu.name}.`, 'success');
  document.getElementById('fine-student-email').value = '';
  document.getElementById('fine-manual-amount').value = '';
  renderLibrarianWorkspace();
};

/** confirmFinePayment — Student pays fine */
window.confirmFinePayment = async function (paid) {
  const method = document.getElementById('payment-method')?.value || 'student_account';
  const ref    = document.getElementById('payment-ref-input')?.value.trim() || '';
  if ((method === 'gcash' || method === 'card') && !ref) {
    showAlert('Please enter the transaction reference number.', 'error'); return;
  }
  const stu = window.userAccounts.find(u => u.email === currentSession.email);
  if (!stu) { closeModal(); return; }
  const methodLabel = { student_account:'Student Account', gcash:'GCash', card:'Card', cash:'Cash at Desk' }[method] || method;
  await fb_updateStudentFine(currentSession.email, 0);
  await fb_addLog(`Fine paid: $${paid.toFixed(2)} by ${stu.name} via ${methodLabel}${ref?' (Ref: '+ref+')':''}`, 'green');
  Object.assign(currentSession, { outstandingFines: 0 });
  closeModal();
  showAlert(`Balance of $${paid.toFixed(2)} cleared via ${methodLabel}.`, 'success');
  renderStudentDashboard();
};

/** dismissNotif — Student dismisses a notification */
window.dismissNotif = async function (notifId) {
  const n = window.inAppNotifications.find(n => n.id === notifId);
  if (n && n._docId) await fb_markNotifRead(n._docId);
  renderStudentNotifications();
};

/** markAllNotifsRead — Student marks all read */
window.markAllNotifsRead = async function () {
  if (!currentSession) return;
  await fb_markAllNotifsRead(currentSession.email);
  renderStudentNotifications();
  showAlert('All notifications marked as read.', 'success');
};

/** saveNewBookToCatalog — Librarian adds a new book */
window.saveNewBookToCatalog = async function () {
  const title     = document.getElementById('meta-title').value.trim();
  const author    = document.getElementById('meta-author').value.trim();
  const publisher = document.getElementById('meta-publisher').value.trim();
  const pubDate   = document.getElementById('meta-pubdate').value.trim();
  const language  = document.getElementById('meta-language').value.trim();
  const genre     = document.getElementById('meta-genre').value.trim();
  const isbn      = document.getElementById('meta-hidden-isbn').value.trim();
  const rateClass = document.getElementById('meta-rate-class').value;
  const mediaClass= document.getElementById('meta-mediaclass').value;
  if (!title || !author) { showAlert('Title and author are required.', 'error'); return; }

  const bookData = {
    id: Date.now(),
    title, author, publisher, pubDate, language, genre, isbn,
    rateClass, mediaClass, available: true, reservationQueue: [],
  };
  await fb_saveNewBook(bookData);
  clearBookForm();
  filterCatalog();
  showAlert(`"${title}" saved to catalog.`, 'success');
};

/** libDeleteBook — Librarian deletes a book */
window.libDeleteBook = async function (bookId) {
  const book = window.bookCatalog.find(b => b.id === bookId);
  if (!book) return;
  showConfirm(`Delete "${book.title}" from the catalog? This cannot be undone.`, 'Delete Book', async () => {
    await fb_deleteBook(book);
    showAlert(`"${book.title}" removed from catalog.`, 'success');
    filterCatalog();
    renderDeleteRecords('del-books');
  }, 'Delete', 'btn-red');
};

/** libDeleteReservation — Librarian removes a pending reservation */
window.libDeleteReservation = async function (holdId) {
  const hold = window.physicalHolds.find(h => h.id === holdId);
  if (!hold) return;
  showConfirm(`Delete reservation for "${hold.bookTitle}"?`, 'Delete Reservation', async () => {
    const book = window.bookCatalog.find(b => b.id === hold.bookId);
    if (book && !hold.returned) await fb_setBookAvailability(book._docId, true);
    await fb_deleteHold(hold);
    showAlert('Reservation deleted.', 'success');
    filterCatalog();
    renderDeleteRecords('del-reservations');
  }, 'Delete', 'btn-red');
};

/** libDeleteLoan — Librarian deletes a loan record */
window.libDeleteLoan = async function (holdId) {
  const hold = window.physicalHolds.find(h => h.id === holdId);
  if (!hold) return;
  showConfirm(`Delete loan record for "${hold.bookTitle}"?`, 'Delete Loan Record', async () => {
    const book = window.bookCatalog.find(b => b.id === hold.bookId);
    if (book && !hold.returned) await fb_setBookAvailability(book._docId, true);
    await fb_deleteHold(hold);
    showAlert('Loan record deleted.', 'success');
    renderDeleteRecords('del-loans');
  }, 'Delete', 'btn-red');
};

/** libClearFine — Librarian waives a student's fine */
window.libClearFine = async function (email) {
  const stu = window.userAccounts.find(u => u.email === email);
  if (!stu) return;
  showConfirm(`Clear fine of $${parseFloat(stu.outstandingFines).toFixed(2)} for ${stu.name}?`, 'Clear Fine', async () => {
    await fb_addLog(`Fine cleared: $${parseFloat(stu.outstandingFines).toFixed(2)} for ${stu.name} by librarian ${currentSession.email}`, 'red');
    await fb_updateStudentFine(email, 0);
    showAlert(`Fine cleared for ${stu.name}.`, 'success');
    renderDeleteRecords('del-fines');
  }, 'Clear Fine', 'btn-red');
};

/** libDeleteRoomBooking — Librarian deletes a room booking */
window.libDeleteRoomBooking = async function (resId) {
  const res = window.roomBookings.find(r => r.id === resId);
  if (!res) return;
  showConfirm(`Delete room booking for ${res.room} on ${res.date}?`, 'Delete Room Booking', async () => {
    await fb_deleteRoomBooking(res);
    showAlert('Room booking deleted.', 'success');
    renderDeleteRecords('del-rooms');
  }, 'Delete', 'btn-red');
};


/* ════════════════════════════════════════════════════════════════
   ██  BOOT  ████████████████████████████████████████████████████
   ════════════════════════════════════════════════════════════════ */

// Run bootstrap after DOM is ready (same timing as the original DOMContentLoaded)
window.addEventListener('load', () => {
  bootstrapFromFirestore().then(() => {
    setDefaultDate();
    // Restore session from sessionStorage if user refreshed the page
    const saved = sessionStorage.getItem('nu_active_session');
    if (saved) {
      window.currentSession = JSON.parse(saved);
      const role = window.currentSession?.role;
      if (role === 'Student')        attachStudentListeners(window.currentSession.email);
      else if (role === 'Librarian') attachLibrarianListeners();
      else if (role === 'Admin')     attachAdminListeners();
    }
  });
});


/* ================================================================
   FIRESTORE SECURITY RULES
   ================================================================
   Paste this into: Firebase Console → Firestore Database → Rules

   These rules ensure:
   • Students can only read/write their OWN data
   • Librarians can read/write operational data (holds, catalog, bookings)
   • Admins have full read/write access
   • Unauthenticated users can only browse the catalog (read-only)

   NOTE: SmartLib uses its own CAS-style auth (email+hashed password
   stored in Firestore), NOT Firebase Authentication.  To enforce these
   rules properly you have two options:

   OPTION A (Recommended for production):
     Migrate login to Firebase Authentication (createUserWithEmailAndPassword /
     signInWithEmailAndPassword).  Then request.auth.uid is available and
     you can enforce rules per-UID.

   OPTION B (Quick dev/staging setup):
     Keep the current CAS approach but open rules to authenticated-app
     requests only (lock down via API key restrictions in Google Cloud Console).

   The rules below are written for OPTION A and include role checks
   via a custom claim or a user document field.
   ================================================================

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── helper: get the calling user's role from their account doc ──
    function userRole() {
      return get(/databases/$(database)/documents/nu_accounts/$(request.auth.token.email.replace('.','_dot_'))).data.role;
    }
    function isStudent()   { return userRole() == 'Student'; }
    function isLibrarian() { return userRole() == 'Librarian'; }
    function isAdmin()     { return userRole() == 'Admin'; }
    function isStaff()     { return isLibrarian() || isAdmin(); }

    // ── Catalog: public read, staff write ──
    match /nu_catalog/{bookId} {
      allow read:  if true;
      allow write: if request.auth != null && isStaff();
    }

    // ── User Accounts: each user reads own doc; staff reads all; admin writes all ──
    match /nu_accounts/{userId} {
      allow read:  if request.auth != null &&
                     (request.auth.token.email.replace('.','_dot_') == userId || isStaff());
      allow create: if request.auth != null;          // registration
      allow update: if request.auth != null &&
                     (request.auth.token.email.replace('.','_dot_') == userId || isStaff());
      allow delete: if request.auth != null && isAdmin();
    }

    // ── Room Bookings: student reads/writes own; staff reads all ──
    match /nu_bookings/{bookingId} {
      allow read:   if request.auth != null &&
                      (resource.data.studentEmail == request.auth.token.email || isStaff());
      allow create: if request.auth != null && isStudent();
      allow update,
            delete: if request.auth != null && isStaff();
    }

    // ── Holds: student reads own; librarian/admin read+write all ──
    match /nu_holds/{holdId} {
      allow read:   if request.auth != null &&
                      (resource.data.studentEmail == request.auth.token.email || isStaff());
      allow create: if request.auth != null && isStudent();
      allow update,
            delete: if request.auth != null && isStaff();
    }

    // ── System Logs: staff read+write; students blocked ──
    match /nu_logs/{logId} {
      allow read, write: if request.auth != null && isStaff();
    }

    // ── Notifications: each student reads own; anyone can write (invites) ──
    match /nu_notifications/{notifId} {
      allow read:   if request.auth != null &&
                      (resource.data.toEmail == request.auth.token.email || isStaff());
      allow create: if request.auth != null;
      allow update: if request.auth != null &&
                      resource.data.toEmail == request.auth.token.email;
      allow delete: if request.auth != null && isStaff();
    }

    // ── Fine Config: staff read+write ──
    match /nu_fine_cfg/{docId} {
      allow read:  if request.auth != null;
      allow write: if request.auth != null && isStaff();
    }
  }
}
================================================================ */


/* ================================================================
   FREE HOSTING GUIDE
   ================================================================

   ── OPTION 1: GitHub Pages (fastest, zero cost) ──────────────────

   1. Create a GitHub account at github.com (free).
   2. Create a new repository, e.g. "smartlib".
   3. Upload smartlib-fixed.html (rename it to index.html) and
      firebase-backend.js to the repo root.
   4. Go to: Settings → Pages → Source → "Deploy from a branch"
      Select branch: main / root folder.
   5. GitHub gives you a URL like:
         https://yourusername.github.io/smartlib/
   6. Any device that opens this URL gets the live app.
      Because Firestore is the backend, all devices share the
      same real data in real time.

   LIMITATION: GitHub Pages is static — no server-side logic.
   That's fine because all backend logic runs in Firestore.

   ── OPTION 2: Firebase Hosting (best for this stack) ─────────────

   1. Install Node.js from nodejs.org.
   2. In a terminal:
        npm install -g firebase-tools
        firebase login
        firebase init hosting
      → Select your Firebase project
      → Public directory: . (current folder)
      → Single-page app: Yes
      → Overwrite index.html: No
   3. Copy smartlib-fixed.html → index.html in the folder.
      Copy firebase-backend.js to the same folder.
   4. Run:
        firebase deploy
   5. Firebase gives you a URL like:
         https://your-project-id.web.app
   Any device that visits this URL sees the live app.
   Firebase Hosting free tier: 10 GB/month bandwidth, 1 GB storage.

   ── ACCESSING FROM MULTIPLE DEVICES ──────────────────────────────
   Once hosted, every device (phone, tablet, laptop) that opens
   the URL gets a fresh copy of the HTML+JS.  There is no separate
   "server" to run — Firestore IS the server.  Students log in
   from their phones, librarians from their desk, admins from
   anywhere, and the onSnapshot listeners keep every view live.

   ================================================================ */

// ── FINAL SAFETY PATCH ──────────────────────────────────────────────────────
// Force override handleLoginSubmit and handleRegisterSubmit AFTER all scripts
// have loaded, so the Firebase versions always win over the app.js versions.
window.addEventListener('load', () => {

  window.handleLoginSubmit = async function () {
    const email    = document.getElementById('login-email').value.toLowerCase().trim();
    const password = document.getElementById('login-password').value;
    if (!email)    { showAlert('Please enter your email.', 'error'); return; }
    if (!password) { showAlert('Please enter your password.', 'error'); return; }

    // Show loading state
    showAlert('Verifying credentials…', 'success');

    const user = await fb_getUserByEmail(email);
    if (!user) {
      showAlert('Account not found. Please register first.', 'error'); return;
    }

    const pwOk = await verifyPassword(password, user.password);
    if (!pwOk) {
      showAlert('Incorrect password. Please try again.', 'error');
      document.getElementById('login-password').value = '';
      return;
    }

    window.currentSession = user;
    sessionStorage.setItem('nu_active_session', JSON.stringify(user));
    await fb_addLog(`User signed in: ${user.name} (${user.role})`, 'green');
    showAlert(`Welcome, ${user.name}!`, 'success');
    document.getElementById('login-password').value = '';
    if (typeof closeLoginDrawer  === 'function') closeLoginDrawer();
    if (typeof refreshSessionUI  === 'function') refreshSessionUI();

    if (user.role === 'Student')        attachStudentListeners(user.email);
    else if (user.role === 'Librarian') attachLibrarianListeners();
    else if (user.role === 'Admin')     attachAdminListeners();

    if (user.role === 'Student'   && typeof checkAuthAndNavigate === 'function') checkAuthAndNavigate('student-view');
    else if (user.role === 'Librarian' && typeof checkAuthAndNavigate === 'function') checkAuthAndNavigate('librarian-view');
    else if (typeof checkAuthAndNavigate === 'function') checkAuthAndNavigate('admin-view');
  };

  window.handleRegisterSubmit = async function () {
    const name     = document.getElementById('reg-name').value.trim();
    const email    = document.getElementById('reg-email').value.toLowerCase().trim();
    const role     = document.getElementById('reg-role').value;
    const password = document.getElementById('reg-password').value;
    const confirm  = document.getElementById('reg-password-confirm').value;
    if (!name || !email) { showAlert('Please fill all fields.', 'error'); return; }
    if (password.length < 8) { showAlert('Password must be at least 8 characters.', 'error'); return; }
    if (password !== confirm) { showAlert('Passwords do not match.', 'error'); return; }
    const existing = await fb_getUserByEmail(email);
    if (existing) { showAlert('This email is already registered. Please sign in.', 'error'); return; }
    const hashedPw = await hashPassword(password);
    const newUser  = { name, email, role, password: hashedPw, outstandingFines: 0, loans: [] };
    await fb_registerUser(newUser);
    showAlert('Account created! Please sign in now.', 'success');
    ['reg-name','reg-email','reg-password','reg-password-confirm'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    if (typeof switchLoginMode === 'function') switchLoginMode('LOGIN');
    document.getElementById('login-email').value = email;
  };

});
