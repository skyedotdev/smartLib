// ── IN-APP NOTIFICATION SYSTEM ───────────────────────────────────────────
// Room invitations are delivered directly to invited students' dashboards.
// No external email service needed.
// ─────────────────────────────────────────────────────────────────────────
/* =====================================================
   SMARTLIB – NATIONAL UNIVERSITY
   Complete Application Engine
   ===================================================== */

// ── DATA STORES (localStorage-backed) ──
let bookCatalog        = JSON.parse(localStorage.getItem('nu_catalog'))        || [];
let userAccounts       = JSON.parse(localStorage.getItem('nu_accounts'))       || [];
let roomBookings       = JSON.parse(localStorage.getItem('nu_bookings'))       || [];
let physicalHolds      = JSON.parse(localStorage.getItem('nu_holds'))          || [];
let systemLogs         = JSON.parse(localStorage.getItem('nu_logs'))           || [];
let inAppNotifications = JSON.parse(localStorage.getItem('nu_notifications'))  || [];
let fineConfig         = JSON.parse(localStorage.getItem('nu_fine_cfg'))       || {
  standardRate: 1.00, highRate: 2.50, graceStandard: 10, graceHigh: 4
};
let currentSession = JSON.parse(sessionStorage.getItem('nu_active_session')) || null;

function saveStateToDisk() {
  localStorage.setItem('nu_catalog',        JSON.stringify(bookCatalog));
  localStorage.setItem('nu_accounts',       JSON.stringify(userAccounts));
  localStorage.setItem('nu_bookings',       JSON.stringify(roomBookings));
  localStorage.setItem('nu_holds',          JSON.stringify(physicalHolds));
  localStorage.setItem('nu_logs',           JSON.stringify(systemLogs));
  localStorage.setItem('nu_notifications',  JSON.stringify(inAppNotifications));
  localStorage.setItem('nu_fine_cfg',       JSON.stringify(fineConfig));
}

function addLog(message, type = 'info') {
  systemLogs.unshift({ message, type, timestamp: new Date().toISOString() });
  if (systemLogs.length > 100) systemLogs.pop();
  saveStateToDisk();
}

// ── BOOT ──
document.addEventListener('DOMContentLoaded', () => {
  refreshSessionUI();
  filterCatalog();
  setDefaultDate();
  setTimeout(() => {
    const splash = document.getElementById('welcome-splash');
    const app    = document.getElementById('main-app-container');
    if (splash) splash.classList.add('splash-fade-out');
    if (app) app.classList.remove('app-dimmed');
    setTimeout(() => splash && splash.remove(), 700);
  }, 3400);
});

function setDefaultDate() {
  const d = document.getElementById('booking-date');
  if (d) d.value = new Date().toISOString().split('T')[0];
}

// ── NAVIGATION ──
function switchView(viewId) {
  document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const sec = document.getElementById(viewId);
  if (sec) sec.classList.add('active');
  const tabMap = { 'catalog-view':'tab-catalog','student-view':'tab-student','librarian-view':'tab-librarian','admin-view':'tab-admin' };
  const tab = document.getElementById(tabMap[viewId]);
  if (tab) tab.classList.add('active');
}

function checkAuthAndNavigate(viewId) {
  if (!currentSession) { openLoginDrawer(); showAlert('Authentication required. Please sign in via CAS.', 'error'); return; }
  const roleMap = { 'student-view':'Student','librarian-view':'Librarian','admin-view':'Admin' };
  if (roleMap[viewId] && currentSession.role !== roleMap[viewId]) {
    showAlert(`Access Denied: ${roleMap[viewId]} credentials required.`, 'error'); return;
  }
  switchView(viewId);
  // Lazy render: populate dashboard only when its view is visited
  if (viewId === 'student-view' && currentSession.role === 'Student') renderStudentDashboard();
  else if (viewId === 'librarian-view' && currentSession.role === 'Librarian') renderLibrarianWorkspace();
  else if (viewId === 'admin-view' && currentSession.role === 'Admin') renderAdminDashboard();
}

// ── AUTH ──
function openLoginDrawer() {
  document.getElementById('login-drawer-overlay').classList.remove('hidden');
  switchLoginMode('LOGIN');
}
function closeLoginDrawer() { document.getElementById('login-drawer-overlay').classList.add('hidden'); }

function switchLoginMode(mode) {
  const isLogin = mode === 'LOGIN';
  document.getElementById('toggle-btn-login').classList.toggle('active', isLogin);
  document.getElementById('toggle-btn-register').classList.toggle('active', !isLogin);
  document.getElementById('form-login').classList.toggle('hidden', !isLogin);
  document.getElementById('form-register').classList.toggle('hidden', isLogin);
}

function handleRegisterSubmit() {
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.toLowerCase().trim();
  const role     = document.getElementById('reg-role').value;
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-password-confirm').value;
  if (!name || !email) { showAlert('Please fill all fields.', 'error'); return; }
  if (!isValidUnivEmail(email)) {
    showAlert('Invalid email: Only university email addresses are accepted (e.g. username@univ.edu). Gmail, Yahoo, Outlook, and other personal addresses are not allowed.', 'error'); return;
  }
  if (password.length < 8) { showAlert('Password must be at least 8 characters long.', 'error'); return; }
  if (password !== confirm) { showAlert('Passwords do not match. Please re-enter them.', 'error'); return; }
  if (userAccounts.some(u => u.email === email)) { showAlert('This email is already registered.', 'error'); return; }
  const newUser = { name, email, role, password, ...(role === 'Student' ? { outstandingFines: 0.00 } : {}), loans: [] };
  userAccounts.push(newUser);
  addLog(`New ${role} registered: ${name} (${email})`, 'green');
  saveStateToDisk();
  showAlert('Account created! You can now sign in.', 'success');
  document.getElementById('reg-name').value = '';
  document.getElementById('reg-email').value = '';
  document.getElementById('reg-password').value = '';
  document.getElementById('reg-password-confirm').value = '';
  const fill = document.getElementById('pw-strength-fill');
  const lbl  = document.getElementById('pw-strength-label');
  if (fill) { fill.style.width='0%'; fill.style.background=''; }
  if (lbl)  { lbl.textContent = ''; }
  switchLoginMode('LOGIN');
  document.getElementById('login-email').value = email;
}

function handleLoginSubmit() {
  const email    = document.getElementById('login-email').value.toLowerCase().trim();
  const password = document.getElementById('login-password').value;
  const role     = document.getElementById('login-role').value;
  if (!isValidUnivEmail(email)) {
    showAlert('Invalid email: Only university email addresses are accepted (e.g. username@univ.edu).', 'error'); return;
  }
  if (!password) { showAlert('Please enter your password.', 'error'); return; }
  const user = userAccounts.find(u => u.email === email && u.role === role);
  if (!user) { showAlert('CAS Rejection: Profile not found. Register first.', 'error'); return; }
  // Support legacy accounts that were created before passwords were added
  if (user.password && user.password !== password) {
    showAlert('Incorrect password. Please try again.', 'error');
    document.getElementById('login-password').value = '';
    return;
  }
  currentSession = user;
  sessionStorage.setItem('nu_active_session', JSON.stringify(currentSession));
  addLog(`User signed in: ${user.name} (${role})`, 'green');
  saveStateToDisk();
  showAlert(`Welcome, ${user.name}!`, 'success');
  document.getElementById('login-password').value = '';
  closeLoginDrawer();
  refreshSessionUI();
  if (role === 'Student') checkAuthAndNavigate('student-view');
  else if (role === 'Librarian') checkAuthAndNavigate('librarian-view');
  else checkAuthAndNavigate('admin-view');
}

function logoutSession() {
  addLog(`User signed out: ${currentSession ? currentSession.name : 'Unknown'}`, 'gold');
  saveStateToDisk();
  currentSession = null;
  sessionStorage.removeItem('nu_active_session');
  showAlert('Logged out safely.', 'success');
  refreshSessionUI();
  switchView('catalog-view');
}

function refreshSessionUI() {
  const loginBtn = document.getElementById('login-trigger-btn');
  const badge    = document.getElementById('user-profile-badge');
  ['tab-student','tab-librarian','tab-admin'].forEach(id => document.getElementById(id).classList.add('hidden'));

  if (currentSession) {
    // Sync from accounts
    const fresh = userAccounts.find(u => u.email === currentSession.email);
    if (fresh) currentSession = fresh;
    loginBtn.classList.add('hidden');
    badge.classList.remove('hidden');
    document.getElementById('badge-username').innerText = currentSession.name;
    document.getElementById('badge-userrole').innerText = currentSession.role;
    const parts = currentSession.name.split(' ');
    document.getElementById('avatar-letters').innerText = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0][0].toUpperCase();
    if (currentSession.role === 'Student') {
      document.getElementById('tab-student').classList.remove('hidden');
    } else if (currentSession.role === 'Librarian') {
      document.getElementById('tab-librarian').classList.remove('hidden');
    } else {
      document.getElementById('tab-admin').classList.remove('hidden');
    }
  } else {
    loginBtn.classList.remove('hidden');
    badge.classList.add('hidden');
  }
  filterCatalog();
}

// ── CATALOG ──
function filterCatalog() {
  const q    = document.getElementById('search-input').value.toLowerCase().trim();
  const type = document.getElementById('type-filter').value;
  const grid = document.getElementById('catalog-grid');
  grid.innerHTML = '';

  const books = bookCatalog.filter(b => {
    const match = b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || (b.isbn||'').includes(q);
    const fmt   = type === 'ALL' || b.mediaClass === type;
    return match && fmt;
  });

  if (books.length === 0) {
    grid.innerHTML = '<div class="empty-box-text" style="grid-column:1/-1;">No records found in the national database.</div>';
    return;
  }

  books.forEach(book => {
    const card = document.createElement('div');
    card.className = `book-showcase-card${book.mediaClass === 'DIGITAL' ? ' digital-card' : ''}`;
    const typeLabel = book.mediaClass === 'DIGITAL' ? 'Digital Asset' : 'Physical Book';
    const rateLabel = book.rateClass === 'HIGH_PRIORITY' ? ' · High-Priority' : '';
    card.innerHTML = `
      <div>
        <span class="badge-tag ${book.mediaClass==='DIGITAL'?'tag-digital':'tag-physical'}">${typeLabel}</span>
        <span class="availability-pill ${book.available?'avail-yes':'avail-no'}">${book.available?'Available':'On Loan'}</span>
        <h4 class="book-title">${escapeHTML(book.title)}</h4>
        <p class="book-author">by ${escapeHTML(book.author)}</p>
        <div class="spec-details-list">
          <span class="spec-item"><strong>Publisher:</strong> ${escapeHTML(book.publisher||'—')}</span>
          <span class="spec-item"><strong>Year:</strong> ${escapeHTML(book.pubDate||'—')}</span>
          <span class="spec-item"><strong>ISBN:</strong> ${escapeHTML(book.isbn||'—')}</span>
          <span class="spec-item"><strong>Genre:</strong> ${escapeHTML(book.genre||'General')}</span>
          <span class="spec-item"><strong>Rate:</strong> ${book.rateClass==='HIGH_PRIORITY'?'$2.50/day (High-Priority)':'$1.00/day (Standard)'}${rateLabel}</span>
        </div>
      </div>
      <div>
        ${book.mediaClass==='DIGITAL'
          ? `<button onclick="downloadPaper('${escapeHTML(book.title)}')" class="btn btn-gray w-100">📖 Access Digital Paper</button>`
          : `<button onclick="placeBookHold(${book.id})" class="btn btn-blue w-100" ${!book.available?'disabled':''}>
               ${book.available?'Place a Hold':'On Loan'}
             </button>`
        }
      </div>`;
    grid.appendChild(card);
  });
}

function downloadPaper(title) {
  if (!currentSession) { openLoginDrawer(); showAlert('Sign in to access digital papers.', 'error'); return; }
  openModal(`
    <div style="text-align:center;padding:.5rem;">
      <div style="font-size:2.5rem;margin-bottom:.75rem;">📄</div>
      <h3 style="color:var(--nu-navy-dark);margin-bottom:.5rem;">Digital Access Confirmed</h3>
      <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:1.25rem;">Identity verified via CAS. You are authorized to access <strong>"${title}"</strong>.</p>
      <a href="#" class="btn btn-gold w-100" onclick="closeModal();showAlert('Download initialized.','success');return false;">⬇️ Download Academic PDF</a>
    </div>`);
  addLog(`Digital paper accessed: "${title}" by ${currentSession.email}`, 'info');
  saveStateToDisk();
}

function placeBookHold(bookId) {
  if (!currentSession) { openLoginDrawer(); showAlert('Sign in to place holds.', 'error'); return; }
  if (currentSession.role !== 'Student') { showAlert('Only students can place holds.', 'error'); return; }
  const stu = userAccounts.find(u => u.email === currentSession.email);
  if (stu && parseFloat(stu.outstandingFines) > 10.00) {
    showAlert(`Hold blocked: Outstanding fine $${parseFloat(stu.outstandingFines).toFixed(2)} exceeds $10.00. Settle with librarian first.`, 'error'); return;
  }
  const book = bookCatalog.find(b => b.id === bookId);
  if (!book || !book.available) { showAlert('Book is not available.', 'error'); return; }
  book.available = false;
  const code = 'NU-' + Math.random().toString(36).substr(2,8).toUpperCase();
  const checkoutDate = new Date().toISOString().split('T')[0];
  const dueDate = new Date(Date.now() + 14*86400000).toISOString().split('T')[0];
  physicalHolds.push({ id: Date.now(), code, studentEmail: currentSession.email, bookId: book.id, bookTitle: book.title, rateClass: book.rateClass||'STANDARD', checkoutDate, dueDate, returned: false });
  addLog(`Hold placed: "${book.title}" by ${currentSession.email}`, 'green');
  saveStateToDisk();
  showAlert(`Hold confirmed for "${book.title}". Pick up token from your dashboard.`, 'success');
  refreshSessionUI();
  filterCatalog();
}

// ── STUDENT DASHBOARD ──
function renderStudentDashboard() {
  if (!currentSession || currentSession.role !== 'Student') return;
  const stu = userAccounts.find(u => u.email === currentSession.email);
  if (stu) Object.assign(currentSession, stu);

  // Populate greeting
  const firstName = currentSession.name.split(' ')[0];
  const greetingName = document.getElementById('greeting-name-stu');
  if (greetingName) greetingName.textContent = `Welcome back, ${firstName}!`;
  const greetingAvatar = document.getElementById('greeting-avatar-stu');
  if (greetingAvatar) {
    const parts = currentSession.name.split(' ');
    greetingAvatar.textContent = parts.length > 1 ? (parts[0][0]+parts[1][0]).toUpperCase() : parts[0][0].toUpperCase();
  }

  const fineVal = parseFloat(currentSession.outstandingFines)||0;
  const fineBox = document.getElementById('fine-status-box');
  if (fineBox) {
    fineBox.innerText = `Fines: $${fineVal.toFixed(2)}${fineVal>10?' (Holds Blocked)':''}`;
    fineBox.className = `status-box ${fineVal>10?'fine-blocked':'fine-ok'}`;
  }

  // Update fine card content (inside panel — just keep it accurate)
  const fineAmountEl = document.getElementById('payment-fine-amount');
  if (fineAmountEl) fineAmountEl.innerText = `$${fineVal.toFixed(2)}`;

  // Stats strip
  const statsStrip = document.getElementById('student-stats-strip');
  if (statsStrip) statsStrip.style.display = '';
  const myHolds = physicalHolds.filter(h => h.studentEmail === currentSession.email && !h.returned);
  const myRooms = roomBookings.filter(r => r.studentEmail === currentSession.email);
  document.getElementById('stu-stat-holds').innerText = myHolds.length;
  document.getElementById('stu-stat-rooms').innerText = myRooms.length;
  document.getElementById('stu-stat-fines').innerText = `$${fineVal.toFixed(2)}`;

  // Pre-populate panel content so it's ready when opened
  renderRoomAvailability();
  renderStudentPasses();
  renderStudentNotifications();
  renderDigitalPapers();
}

function renderRoomAvailability() {
  const rooms = ['Group Discussion Room A','Quiet Study Room 102','Tech Lab Room 305','Creative Hub B'];
  const grid = document.getElementById('room-availability-grid');
  const todayStr = new Date().toISOString().split('T')[0];
  grid.innerHTML = '';
  rooms.forEach(room => {
    // A room is "filled" if there's any booking for today (or any future booking)
    const activeBookings = roomBookings.filter(b => b.room === room && b.date >= todayStr);
    const isFilled = activeBookings.length > 0;
    const tile = document.createElement('div');
    tile.className = `room-status-tile ${isFilled?'room-filled':'room-available'}`;
    tile.innerHTML = `
      <div class="room-name">${room}</div>
      <span class="room-status">${isFilled?'Has Bookings':'Available'}</span>
      <div class="room-meta">${isFilled?`${activeBookings.length} upcoming booking(s)`:'Open for reservation'}</div>`;
    grid.appendChild(tile);
  });
}

function renderStudentPasses() {
  const container = document.getElementById('student-passes-container');
  container.innerHTML = '';
  const myHolds = physicalHolds.filter(h => h.studentEmail === currentSession.email && !h.returned);
  const myRooms = roomBookings.filter(r => r.studentEmail === currentSession.email);
  if (myHolds.length === 0 && myRooms.length === 0) {
    container.innerHTML = '<div class="empty-box-text">No active holds or reservations on your account.</div>';
    return;
  }
  const today = new Date();
  myHolds.forEach(hold => {
    const due = new Date(hold.dueDate);
    const overdue = due < today;
    const div = document.createElement('div');
    div.className = `pass-row${overdue?' alert-left':''}`;
    div.innerHTML = `
      <div class="pass-info">
        <p>📘 ${overdue?'⚠️ OVERDUE — ':''} Book Hold</p>
        <small><strong>${escapeHTML(hold.bookTitle)}</strong></small>
        <small>Checked out: ${hold.checkoutDate} · Due: ${hold.dueDate}</small>
        ${overdue?'<small style="color:#991B1B;font-weight:700;">Please proceed to the Librarian Desk for payment.</small>':''}
      </div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;">
        <button onclick="viewBarcode('${hold.code}')" class="btn btn-gold" style="font-size:.72rem;padding:.4rem .7rem;">Fetch Token</button>
        <button onclick="cancelStudentHold(${hold.id})" class="btn btn-red" style="font-size:.72rem;padding:.4rem .7rem;">Cancel Hold</button>
      </div>`;
    container.appendChild(div);
  });
  myRooms.forEach(room => {
    const mins = parseInt(room.duration, 10);
    const dur = mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h${mins%60>0?' '+(mins%60)+'m':''}`;
    const div = document.createElement('div');
    div.className = 'pass-row gold-left';
    let inv = '';
    if (room.invites && room.invites.length > 0)
      inv = `<div class="pass-emails-row">${room.invites.map(e=>`<span class="email-pill">${escapeHTML(e)}</span>`).join('')}</div>`;
    div.innerHTML = `
      <div class="pass-info">
        <p>🏢 Room Reservation</p>
        <small><strong>${escapeHTML(room.room)}</strong></small>
        <small>Date: ${room.date} · ${room.startTime} (${dur})</small>
        ${inv}
      </div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;">
        <button onclick="modifyRoomBooking(${room.id})" class="btn btn-gray" style="font-size:.72rem;padding:.4rem .7rem;">✏️ Modify</button>
        <button onclick="cancelStudentRoom(${room.id})" class="btn btn-red" style="font-size:.72rem;padding:.4rem .7rem;">Cancel</button>
      </div>`;
    container.appendChild(div);
  });
}

function cancelStudentHold(holdId) {
  const hold = physicalHolds.find(h => h.id === holdId);
  if (!hold) return;
  if (!confirm(`Cancel hold for "${hold.bookTitle}"?`)) return;
  hold.returned = true;
  const book = bookCatalog.find(b => b.id === hold.bookId);
  if (book) book.available = true;
  addLog(`Hold cancelled by student: "${hold.bookTitle}" by ${currentSession.email}`, 'gold');
  saveStateToDisk();
  showAlert(`Hold for "${hold.bookTitle}" has been cancelled.`, 'success');
  renderStudentDashboard();
  filterCatalog();
}

function cancelStudentRoom(roomId) {
  const res = roomBookings.find(r => r.id === roomId);
  if (!res) return;
  if (!confirm(`Cancel reservation for ${res.room} on ${res.date} at ${res.startTime}?`)) return;
  roomBookings = roomBookings.filter(r => r.id !== roomId);
  addLog(`Room reservation cancelled by student: ${res.room} on ${res.date} by ${currentSession.email}`, 'gold');
  saveStateToDisk();
  showAlert('Room reservation cancelled.', 'success');
  renderStudentDashboard();
}

function modifyRoomBooking(roomId) {
  const res = roomBookings.find(r => r.id === roomId);
  if (!res) return;
  openModal(`
    <div>
      <h3 style="color:var(--nu-navy-dark);margin-bottom:.25rem;">✏️ Modify Room Reservation</h3>
      <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:1rem;"><strong>${escapeHTML(res.room)}</strong></p>
      <div class="simple-form">
        <div class="form-group">
          <label>New Date</label>
          <input type="date" id="mod-date" value="${res.date}">
        </div>
        <div class="form-group">
          <label>New Arrival Time</label>
          <input type="time" id="mod-time" value="${res.startTime}">
        </div>
        <div class="form-group">
          <label>Duration (minutes)</label>
          <input type="number" id="mod-dur" value="${res.duration}" min="15" max="180" step="15">
        </div>
        <div class="form-group">
          <label>Group Members</label>
          <input type="text" id="mod-emails" value="${(res.invites||[]).join(', ')}">
        </div>
        <div class="form-footer-buttons">
          <button onclick="closeModal()" class="btn btn-gray">Discard</button>
          <button onclick="saveModifiedRoom(${roomId})" class="btn btn-blue">Save Changes</button>
        </div>
      </div>
    </div>`);
}

function saveModifiedRoom(roomId) {
  const res = roomBookings.find(r => r.id === roomId);
  if (!res) { closeModal(); return; }
  const newDate = document.getElementById('mod-date').value;
  const newTime = document.getElementById('mod-time').value;
  const newDur  = parseInt(document.getElementById('mod-dur').value, 10);
  const newEmails = document.getElementById('mod-emails').value.trim();
  if (!newDate || !newTime) { showAlert('Date and time are required.', 'error'); return; }

  // Overlap check (exclude the booking being modified)
  const [reqH, reqM] = newTime.split(':').map(Number);
  const reqStart = reqH * 60 + reqM;
  const reqEnd   = reqStart + newDur;
  const overlap = roomBookings.find(b => {
    if (b.id === roomId || b.room !== res.room || b.date !== newDate) return false;
    const [bH, bM] = b.startTime.split(':').map(Number);
    const bStart = bH * 60 + bM;
    const bEnd   = bStart + parseInt(b.duration, 10);
    return reqStart < bEnd && reqEnd > bStart;
  });
  if (overlap) {
    showAlert(`Overlap conflict: Room is already reserved at that time. Choose a different slot.`, 'error'); return;
  }

  res.date      = newDate;
  res.startTime = newTime;
  res.duration  = newDur;
  res.invites   = newEmails ? newEmails.split(',').map(e=>e.trim().toLowerCase()).filter(e=>e) : [];

  // Validate every invited email against registered student accounts
  if (res.invites.length > 0) {
    const invalidEmails = res.invites.filter(e => !userAccounts.some(u => u.email === e && u.role === 'Student'));
    if (invalidEmails.length > 0) {
      showAlert(`Invitation failed: The following email(s) are not registered SmartLib student accounts — ${invalidEmails.join(', ')}. Please check and try again.`, 'error');
      return;
    }
    if (res.invites.includes(currentSession.email)) {
      showAlert('You cannot invite yourself to your own room booking.', 'error');
      return;
    }
  }

  addLog(`Room reservation modified: ${res.room} on ${newDate} by ${currentSession.email}`, 'gold');
  saveStateToDisk();
  showAlert('Reservation updated.', 'success');
  if (res.invites.length > 0) sendRoomInviteEmails({ room: res.room, date: newDate, startTime: newTime, duration: newDur, invites: res.invites, hostName: currentSession.name, hostEmail: currentSession.email, isUpdate: true });
  closeModal();
  renderStudentDashboard();
}

// ── IN-APP ROOM INVITATION DELIVERY ──
function sendRoomInviteEmails({ room, date, startTime, duration, invites, hostName, hostEmail, isUpdate = false }) {
  if (!invites || invites.length === 0) return;
  const mins = parseInt(duration, 10);
  const durLabel = mins < 60
    ? `${mins} minutes`
    : `${Math.floor(mins/60)} hour${Math.floor(mins/60)>1?'s':''}${mins%60>0?' '+(mins%60)+' min':''}`;

  let delivered = 0;
  invites.forEach(recipientEmail => {
    // Only deliver if the invitee has a registered student account
    const recipient = userAccounts.find(u => u.email === recipientEmail && u.role === 'Student');
    const notif = {
      id: Date.now() + Math.random(),
      toEmail: recipientEmail,
      isRegistered: !!recipient,
      read: false,
      isUpdate,
      room,
      date,
      startTime,
      duration: durLabel,
      hostName,
      hostEmail,
      createdAt: new Date().toISOString()
    };
    inAppNotifications.unshift(notif);
    delivered++;
  });
  saveStateToDisk();
  const regCount = invites.filter(e => userAccounts.some(u => u.email === e && u.role === 'Student')).length;
  const msg = isUpdate
    ? `✏️ Updated booking notification sent to ${delivered} member(s).`
    : `📬 Room invitation sent to ${delivered} member(s). ${regCount} registered SmartLib account(s) will see it on their dashboard.`;
  showAlert(msg, 'success');
}

function renderDigitalPapers() {
  const list = document.getElementById('digital-papers-list');
  const papers = bookCatalog.filter(b => b.mediaClass === 'DIGITAL');
  if (papers.length === 0) {
    list.innerHTML = '<div class="empty-box-text">No digital papers in the catalog yet.</div>';
    return;
  }
  list.innerHTML = '';
  papers.forEach(p => {
    const row = document.createElement('div');
    row.className = 'pass-row';
    row.innerHTML = `
      <div class="pass-info">
        <p>📄 ${escapeHTML(p.title)}</p>
        <small>by ${escapeHTML(p.author)} · ${escapeHTML(p.publisher||'')} ${p.pubDate||''}</small>
      </div>
      <button onclick="downloadPaper('${escapeHTML(p.title)}')" class="btn btn-gray" style="font-size:.75rem;">Access PDF</button>`;
    list.appendChild(row);
  });
}

function renderStudentNotifications() {
  if (!currentSession || currentSession.role !== 'Student') return;
  const container = document.getElementById('student-notifs-container');
  if (!container) return;

  // Get notifications addressed to this student
  const mine = inAppNotifications.filter(n => n.toEmail === currentSession.email);

  if (mine.length === 0) {
    container.innerHTML = '<div class="empty-box-text">No notifications yet. Room invitations from other students will appear here.</div>';
    return;
  }

  container.innerHTML = '';
  mine.forEach(notif => {
    const div = document.createElement('div');
    div.className = `pass-row${notif.read ? '' : ' gold-left'}`;
    div.style.opacity = notif.read ? '0.65' : '1';
    const label = notif.isUpdate ? '✏️ Updated Room Booking' : '📬 Room Invitation';
    const when = new Date(notif.createdAt).toLocaleString();
    div.innerHTML = `
      <div class="pass-info" style="flex:1;">
        <p>${label}${notif.read ? '' : ' <span style="background:#FEF9C3;color:#854D0E;font-size:.62rem;font-weight:800;padding:.1rem .4rem;border-radius:4px;vertical-align:middle;">NEW</span>'}</p>
        <small><strong>${escapeHTML(notif.hostName)}</strong> (${escapeHTML(notif.hostEmail)}) invited you to:</small>
        <small>🏢 <strong>${escapeHTML(notif.room)}</strong> · ${notif.date} at ${notif.startTime} (${notif.duration})</small>
        <small style="color:var(--text-muted);">Received: ${when}</small>
      </div>
      <button onclick="dismissNotif(${notif.id})" class="btn btn-gray" style="font-size:.7rem;padding:.3rem .6rem;flex-shrink:0;">✓ Dismiss</button>`;
    container.appendChild(div);
  });

  // Update unread count badge
  const unread = mine.filter(n => !n.read).length;
  const tab = document.getElementById('tab-student');
  if (tab) tab.innerText = unread > 0 ? `🎯 Student (${unread})` : '🎯 Student';
}

function dismissNotif(notifId) {
  const n = inAppNotifications.find(n => n.id === notifId);
  if (n) n.read = true;
  saveStateToDisk();
  renderStudentNotifications();
}

function markAllNotifsRead() {
  if (!currentSession) return;
  inAppNotifications.filter(n => n.toEmail === currentSession.email).forEach(n => n.read = true);
  saveStateToDisk();
  renderStudentNotifications();
  showAlert('All notifications marked as read.', 'success');
}

function executeFinePayment() {
  const stu = userAccounts.find(u => u.email === currentSession.email);
  if (!stu) return;
  const paid = parseFloat(stu.outstandingFines)||0;
  addLog(`Fine paid: $${paid.toFixed(2)} by ${stu.name} via Student Account`, 'green');
  stu.outstandingFines = 0;
  Object.assign(currentSession, stu);
  saveStateToDisk();
  showAlert(`Balance of $${paid.toFixed(2)} cleared via student account.`, 'success');
  renderStudentDashboard();
}

// ── ROOM BOOKING ──
function bookStudyRoom() {
  if (!currentSession) { showAlert('Please sign in first.', 'error'); return; }
  const room   = document.getElementById('room-select').value;
  const date   = document.getElementById('booking-date').value;
  const time   = document.getElementById('booking-time').value;
  const dur    = parseInt(document.getElementById('booking-duration').value, 10);
  const emails = document.getElementById('group-emails').value.trim();
  if (!date || !time) { showAlert('Please select a date and time.', 'error'); return; }

  // Convert requested time to minutes for overlap check
  const [reqH, reqM] = time.split(':').map(Number);
  const reqStart = reqH * 60 + reqM;
  const reqEnd   = reqStart + dur;

  // Check for overlap with existing bookings for same room and date
  const overlap = roomBookings.find(b => {
    if (b.room !== room || b.date !== date) return false;
    const [bH, bM] = b.startTime.split(':').map(Number);
    const bStart = bH * 60 + bM;
    const bEnd   = bStart + parseInt(b.duration, 10);
    return reqStart < bEnd && reqEnd > bStart;
  });

  if (overlap) {
    showAlert(`This room is already reserved from ${overlap.startTime} for ${overlap.duration} minutes on ${date}. Please choose a different time slot.`, 'error');
    return;
  }

  const invites = emails ? emails.split(',').map(e=>e.trim().toLowerCase()).filter(e=>e) : [];

  // Validate every invited email against registered student accounts
  if (invites.length > 0) {
    const invalidEmails = invites.filter(e => !userAccounts.some(u => u.email === e && u.role === 'Student'));
    if (invalidEmails.length > 0) {
      showAlert(`Invitation failed: The following email(s) are not registered SmartLib student accounts — ${invalidEmails.join(', ')}. Please check and try again.`, 'error');
      return;
    }
    // Prevent inviting yourself
    if (invites.includes(currentSession.email)) {
      showAlert('You cannot invite yourself to your own room booking.', 'error');
      return;
    }
  }

  const bookingId = Date.now();
  roomBookings.push({ id: bookingId, studentEmail: currentSession.email, room, date, startTime: time, duration: dur, invites });
  addLog(`Room booked: ${room} by ${currentSession.email} on ${date} at ${time}`, 'green');
  saveStateToDisk();
  showAlert(`Reservation confirmed for ${room}.`, 'success');
  document.getElementById('booking-time').value = '';
  document.getElementById('group-emails').value = '';
  // Send email invitations to group members
  if (invites.length > 0) sendRoomInviteEmails({ room, date, startTime: time, duration: dur, invites, hostName: currentSession.name, hostEmail: currentSession.email });
  renderStudentDashboard();
}

function updateDurationReadout(v) {
  const m = parseInt(v,10);
  const el = document.getElementById('duration-readout');
  if (m < 60) el.innerText = `${m} Minutes`;
  else {
    const h = Math.floor(m/60), rem = m%60;
    el.innerText = rem ? `${h}h ${rem}m` : `${h} Hour${h>1?'s':''}`;
  }
}

function viewBarcode(code) {
  openModal(`
    <div style="text-align:center;">
      <h3 style="color:var(--nu-navy-dark);margin-bottom:.25rem;">Kiosk Verification Token</h3>
      <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:1.25rem;">Present this to any NU scanner kiosk for checkout.</p>
      <div id="qrcode-target-node" style="display:flex;justify-content:center;margin:1.5rem auto;padding:10px;background:white;border:2px solid var(--border-gray);width:max-content;border-radius:8px;"></div>
      <code style="display:block;font-size:1rem;font-weight:800;color:var(--nu-blue-accent);background:var(--canvas-bg);padding:.5rem;border-radius:4px;font-family:monospace;border:1px solid var(--border-gray);">${code}</code>
    </div>`);
  setTimeout(() => {
    const node = document.getElementById('qrcode-target-node');
    if (node && typeof QRCode !== 'undefined') {
      new QRCode(node, { text: code, width: 160, height: 160, colorDark: '#0F172A', colorLight: '#FFFFFF', correctLevel: QRCode.CorrectLevel.H });
    }
  }, 100);
}

// ── LIBRARIAN ──
function switchLibrarianSubTab(key) {
  // Now handled via showRolePanel — trigger the correct panel
  const panelId = `panel-lib-${key}`;
  showRolePanel(panelId);
  if (key === 'loans') renderLoansTable();
  if (key === 'fines-rooms') renderLibrarianWorkspace();
  if (key === 'records') { switchDeleteSubTab('del-books'); renderDeleteRecords(); }
  if (key === 'edit') renderEditCatalogList();
}

// ── EDIT BOOK CATALOG ──
function renderEditCatalogList() {
  const el = document.getElementById('lib-edit-catalog-list');
  el.innerHTML = '';
  if (bookCatalog.length === 0) {
    el.innerHTML = '<div class="empty-box-text">No books in the catalog to edit.</div>';
    return;
  }
  bookCatalog.forEach(book => {
    const row = document.createElement('div');
    row.className = 'pass-row';
    row.innerHTML = `
      <div class="pass-info">
        <p>📘 ${escapeHTML(book.title)}</p>
        <small>${escapeHTML(book.author)} · ISBN: ${escapeHTML(book.isbn||'—')} · ${book.mediaClass} · ${book.rateClass==='HIGH_PRIORITY'?'High-Priority':'Standard'}</small>
        <small>Genre: ${escapeHTML(book.genre||'General')} · Publisher: ${escapeHTML(book.publisher||'—')} · ${escapeHTML(book.pubDate||'—')}</small>
      </div>
      <button onclick="openEditBookModal(${book.id})" class="btn btn-blue" style="font-size:.72rem;padding:.35rem .6rem;">✏️ Edit</button>`;
    el.appendChild(row);
  });
}

function openEditBookModal(bookId) {
  const book = bookCatalog.find(b => b.id === bookId);
  if (!book) return;
  openModal(`
    <div>
      <h3 style="color:var(--nu-navy-dark);margin-bottom:.25rem;">✏️ Edit Book Record</h3>
      <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:1rem;">ISBN: <strong>${escapeHTML(book.isbn||'—')}</strong></p>
      <div class="simple-form">
        <div class="form-group">
          <label>Book Title</label>
          <input type="text" id="edit-title" value="${escapeHTML(book.title)}" style="padding:.65rem .85rem;border-radius:8px;border:1px solid var(--border-gray);font-size:.88rem;outline:none;width:100%;font-family:var(--font-body);">
        </div>
        <div class="form-group">
          <label>Author</label>
          <input type="text" id="edit-author" value="${escapeHTML(book.author)}" style="padding:.65rem .85rem;border-radius:8px;border:1px solid var(--border-gray);font-size:.88rem;outline:none;width:100%;font-family:var(--font-body);">
        </div>
        <div class="form-row">
          <div class="form-group size-1">
            <label>Publisher</label>
            <input type="text" id="edit-publisher" value="${escapeHTML(book.publisher||'')}" style="padding:.65rem .85rem;border-radius:8px;border:1px solid var(--border-gray);font-size:.88rem;outline:none;width:100%;font-family:var(--font-body);">
          </div>
          <div class="form-group size-1">
            <label>Publication Year</label>
            <input type="text" id="edit-pubdate" value="${escapeHTML(book.pubDate||'')}" style="padding:.65rem .85rem;border-radius:8px;border:1px solid var(--border-gray);font-size:.88rem;outline:none;width:100%;font-family:var(--font-body);">
          </div>
        </div>
        <div class="form-group">
          <label>Genre / Subjects</label>
          <input type="text" id="edit-genre" value="${escapeHTML(book.genre||'')}" style="padding:.65rem .85rem;border-radius:8px;border:1px solid var(--border-gray);font-size:.88rem;outline:none;width:100%;font-family:var(--font-body);">
        </div>
        <div class="form-row">
          <div class="form-group size-1">
            <label>Item Rate Class</label>
            <select id="edit-rateclass" style="padding:.6rem;border:1px solid var(--border-gray);border-radius:6px;font-size:.85rem;font-family:var(--font-body);width:100%;">
              <option value="STANDARD" ${book.rateClass==='STANDARD'?'selected':''}>Standard ($1.00/day)</option>
              <option value="HIGH_PRIORITY" ${book.rateClass==='HIGH_PRIORITY'?'selected':''}>High-Priority ($2.50/day)</option>
            </select>
          </div>
          <div class="form-group size-1">
            <label>Media Class</label>
            <select id="edit-mediaclass" style="padding:.6rem;border:1px solid var(--border-gray);border-radius:6px;font-size:.85rem;font-family:var(--font-body);width:100%;">
              <option value="PHYSICAL" ${book.mediaClass==='PHYSICAL'?'selected':''}>Physical Book</option>
              <option value="DIGITAL" ${book.mediaClass==='DIGITAL'?'selected':''}>Digital / PDF</option>
            </select>
          </div>
        </div>
        <div class="form-footer-buttons">
          <button onclick="closeModal()" class="btn btn-gray">Cancel</button>
          <button onclick="saveEditedBook(${bookId})" class="btn btn-blue">Save Changes</button>
        </div>
      </div>
    </div>`);
}

function saveEditedBook(bookId) {
  const book = bookCatalog.find(b => b.id === bookId);
  if (!book) { closeModal(); return; }
  const newTitle = document.getElementById('edit-title').value.trim();
  const newAuthor = document.getElementById('edit-author').value.trim();
  if (!newTitle || !newAuthor) { showAlert('Title and Author are required.', 'error'); return; }
  book.title      = newTitle;
  book.author     = newAuthor;
  book.publisher  = document.getElementById('edit-publisher').value.trim();
  book.pubDate    = document.getElementById('edit-pubdate').value.trim();
  book.genre      = document.getElementById('edit-genre').value.trim();
  book.rateClass  = document.getElementById('edit-rateclass').value;
  book.mediaClass = document.getElementById('edit-mediaclass').value;
  addLog(`Book record updated: "${book.title}" (${book.isbn||'no ISBN'}) by librarian ${currentSession.email}`, 'gold');
  saveStateToDisk();
  showAlert(`"${book.title}" has been updated successfully.`, 'success');
  closeModal();
  renderEditCatalogList();
  filterCatalog();
}

async function fetchBookMetadata() {
  const raw = document.getElementById('isbn-search-field').value.replace(/[-\s]/g,'').trim();
  if (raw.length !== 10 && raw.length !== 13) { showAlert('ISBN must be 10 or 13 digits.', 'error'); return; }
  showAlert('Querying Open Library bibliographic database…', 'success');
  document.getElementById('meta-title').placeholder = 'Fetching…';
  document.getElementById('meta-author').placeholder = 'Fetching…';
  document.getElementById('meta-genre').placeholder = 'Fetching…';
  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${raw}&format=json&jscmd=data`);
    const data = await res.json();
    const key = `ISBN:${raw}`;
    if (!data || !data[key]) {
      document.getElementById('meta-title').placeholder = 'Not found in database.';
      document.getElementById('meta-genre').placeholder = 'Not found.';
      showAlert('ISBN not indexed in the open bibliographic archive.', 'error'); return;
    }
    const rec = data[key];
    document.getElementById('meta-title').value = rec.title || 'Unknown';
    document.getElementById('meta-author').value = rec.authors ? rec.authors.map(a=>a.name).join(', ') : 'Unknown';
    document.getElementById('meta-publisher').value = rec.publishers?.[0]?.name || 'Unknown';
    document.getElementById('meta-pubdate').value = rec['publish_date'] || rec['publish-date'] || 'N/A';
    document.getElementById('meta-language').value = 'English';
    document.getElementById('meta-hidden-isbn').value = raw;

    // Auto-fetch genre from subjects array returned by the API
    let genre = 'General';
    if (rec.subjects && rec.subjects.length > 0) {
      // Take the first 3 subjects as a readable genre string
      genre = rec.subjects.slice(0, 3).map(s => typeof s === 'string' ? s : s.name || '').filter(Boolean).join(', ');
    } else if (rec.subject_places && rec.subject_places.length > 0) {
      genre = rec.subject_places.slice(0, 2).map(s => s.name || s).join(', ');
    }
    document.getElementById('meta-genre').value = genre;

    showAlert('Metadata synced successfully!', 'success');
  } catch(e) {
    showAlert('Network error: Could not reach bibliographic API.', 'error');
  }
}

function saveNewBookToCatalog() {
  const title   = document.getElementById('meta-title').value;
  const isbn    = document.getElementById('meta-hidden-isbn').value;
  if (!title || !isbn) { showAlert('Run a metadata fetch first.', 'error'); return; }
  if (bookCatalog.some(b => b.isbn === isbn)) {
    showAlert(`Error: A book with ISBN "${isbn}" already exists in the catalog. Duplicate entries are not allowed.`, 'error'); return;
  }
  const payload = {
    id: Date.now(),
    title,
    author:    document.getElementById('meta-author').value,
    publisher: document.getElementById('meta-publisher').value,
    pubDate:   document.getElementById('meta-pubdate').value,
    language:  document.getElementById('meta-language').value,
    mediaClass:document.getElementById('meta-mediaclass').value,
    rateClass: document.getElementById('meta-rate-class').value,
    genre:     document.getElementById('meta-genre').value,
    isbn,
    available: true
  };
  bookCatalog.unshift(payload);
  addLog(`Book added to catalog: "${title}" (${isbn}) by ${currentSession.email}`, 'green');
  saveStateToDisk();
  showAlert('Book saved to catalog.', 'success');
  clearBookForm();
  filterCatalog();
}

function clearBookForm() {
  ['meta-title','meta-author','meta-publisher','meta-pubdate','meta-language','meta-hidden-isbn','isbn-search-field','meta-genre'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function renderLoansTable() {
  const tbody = document.getElementById('lib-loans-table-body');
  tbody.innerHTML = '';
  const filterEl = document.getElementById('loans-filter');
  const filterVal = filterEl ? filterEl.value : 'ALL';
  const today = new Date();
  const activeHolds = physicalHolds.filter(h => !h.returned);
  if (activeHolds.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">No active loans.</td></tr>`;
    return;
  }
  let rendered = 0;
  activeHolds.forEach(hold => {
    const due = new Date(hold.dueDate);
    const overdue = due < today;
    if (filterVal === 'OVERDUE' && !overdue) return;
    rendered++;
    const daysOver = overdue ? Math.floor((today - due)/86400000) : 0;
    const rate = hold.rateClass === 'HIGH_PRIORITY' ? parseFloat(fineConfig.highRate) : parseFloat(fineConfig.standardRate);
    const fine = overdue ? (daysOver * rate).toFixed(2) : '0.00';
    const stu = userAccounts.find(u => u.email === hold.studentEmail);
    if (stu && overdue) {
      stu.outstandingFines = Math.max(parseFloat(stu.outstandingFines)||0, parseFloat(fine));
      saveStateToDisk();
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHTML(hold.bookTitle)}</strong><br><span style="font-size:.7rem;color:var(--text-muted);">${hold.rateClass==='HIGH_PRIORITY'?'High-Priority':'Standard'}</span></td>
      <td>${escapeHTML(hold.studentEmail)}</td>
      <td style="text-align:center;">${hold.checkoutDate}</td>
      <td style="text-align:center;">${hold.dueDate}</td>
      <td style="text-align:center;"><span class="status-pill ${overdue?'status-overdue':'status-active'}">${overdue?'Overdue':'Active'}</span></td>
      <td style="text-align:right;font-weight:700;${overdue?'color:#991B1B':''}">$${fine}</td>
      <td style="text-align:center;">
        <button onclick="markReturned(${hold.id})" class="btn btn-green" style="font-size:.72rem;padding:.35rem .65rem;">✓ Return</button>
      </td>`;
    tbody.appendChild(tr);
  });
  if (rendered === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">No overdue loans found.</td></tr>`;
  }
}

function markReturned(holdId) {
  const hold = physicalHolds.find(h => h.id === holdId);
  if (!hold) return;
  hold.returned = true;
  const book = bookCatalog.find(b => b.id === hold.bookId);
  if (book) book.available = true;
  addLog(`Book returned: "${hold.bookTitle}" by ${hold.studentEmail}`, 'green');
  saveStateToDisk();
  showAlert(`"${hold.bookTitle}" marked as returned.`, 'success');
  renderLoansTable();
  filterCatalog();
}

function switchDeleteSubTab(key) {
  ['del-books','del-reservations','del-loans','del-fines','del-rooms'].forEach(k => {
    document.getElementById(`del-subtab-${k.replace('del-','')}`)?.classList.remove('active');
    document.getElementById(`${k}-panel`)?.classList.add('hidden');
  });
  document.getElementById(`del-subtab-${key.replace('del-','')}`)?.classList.add('active');
  document.getElementById(`${key}-panel`)?.classList.remove('hidden');
  renderDeleteRecords(key);
}

function renderDeleteRecords(activeKey) {
  const key = activeKey || 'del-books';
  // Books
  if (key === 'del-books') {
    const el = document.getElementById('lib-delete-catalog-list');
    el.innerHTML = '';
    if (bookCatalog.length === 0) { el.innerHTML = '<div class="empty-box-text">No books in catalog.</div>'; return; }
    bookCatalog.forEach(book => {
      const row = document.createElement('div');
      row.className = 'pass-row';
      row.innerHTML = `
        <div class="pass-info">
          <p>📘 ${escapeHTML(book.title)}</p>
          <small>${escapeHTML(book.author)} · ISBN: ${escapeHTML(book.isbn||'—')} · ${book.mediaClass} · Genre: ${escapeHTML(book.genre||'General')}</small>
        </div>
        <button onclick="libDeleteBook(${book.id})" class="btn btn-red" style="font-size:.72rem;padding:.35rem .6rem;">🗑 Delete</button>`;
      el.appendChild(row);
    });
  }
  // Reservations (holds - pending, not returned)
  if (key === 'del-reservations') {
    const el = document.getElementById('lib-delete-reservations-list');
    el.innerHTML = '';
    const pending = physicalHolds.filter(h => !h.returned);
    if (pending.length === 0) { el.innerHTML = '<div class="empty-box-text">No active book reservations.</div>'; return; }
    pending.forEach(hold => {
      const row = document.createElement('div');
      row.className = 'pass-row';
      row.innerHTML = `
        <div class="pass-info">
          <p>📋 ${escapeHTML(hold.bookTitle)}</p>
          <small>${escapeHTML(hold.studentEmail)} · Checked out: ${hold.checkoutDate} · Due: ${hold.dueDate}</small>
        </div>
        <button onclick="libDeleteReservation(${hold.id})" class="btn btn-red" style="font-size:.72rem;padding:.35rem .6rem;">🗑 Delete</button>`;
      el.appendChild(row);
    });
  }
  // Loans (all physicalHolds)
  if (key === 'del-loans') {
    const el = document.getElementById('lib-delete-loans-list');
    el.innerHTML = '';
    if (physicalHolds.length === 0) { el.innerHTML = '<div class="empty-box-text">No loan records.</div>'; return; }
    physicalHolds.slice().reverse().forEach(hold => {
      const row = document.createElement('div');
      row.className = 'pass-row';
      row.innerHTML = `
        <div class="pass-info">
          <p>📖 ${escapeHTML(hold.bookTitle)} <span style="font-size:.7rem;color:var(--text-muted);">${hold.returned?'[Returned]':'[Active]'}</span></p>
          <small>${escapeHTML(hold.studentEmail)} · Code: ${hold.code} · Out: ${hold.checkoutDate} · Due: ${hold.dueDate}</small>
        </div>
        <button onclick="libDeleteLoan(${hold.id})" class="btn btn-red" style="font-size:.72rem;padding:.35rem .6rem;">🗑 Delete</button>`;
      el.appendChild(row);
    });
  }
  // Fines
  if (key === 'del-fines') {
    const el = document.getElementById('lib-delete-fines-list');
    el.innerHTML = '';
    const fined = userAccounts.filter(u => u.role === 'Student' && parseFloat(u.outstandingFines) > 0);
    if (fined.length === 0) { el.innerHTML = '<div class="empty-box-text">No outstanding fines.</div>'; return; }
    fined.forEach(stu => {
      const row = document.createElement('div');
      row.className = 'pass-row';
      row.innerHTML = `
        <div class="pass-info">
          <p>💸 ${escapeHTML(stu.name)}</p>
          <small>${escapeHTML(stu.email)} · Outstanding: $${parseFloat(stu.outstandingFines).toFixed(2)}</small>
        </div>
        <button onclick="libClearFine('${stu.email}')" class="btn btn-red" style="font-size:.72rem;padding:.35rem .6rem;">🗑 Clear Fine</button>`;
      el.appendChild(row);
    });
  }
  // Room bookings
  if (key === 'del-rooms') {
    const el = document.getElementById('lib-delete-rooms-list');
    el.innerHTML = '';
    if (roomBookings.length === 0) { el.innerHTML = '<div class="empty-box-text">No room bookings.</div>'; return; }
    roomBookings.forEach(res => {
      const row = document.createElement('div');
      row.className = 'pass-row';
      row.innerHTML = `
        <div class="pass-info">
          <p>🏢 ${escapeHTML(res.room)}</p>
          <small>${escapeHTML(res.studentEmail)} · ${res.date} at ${res.startTime} (${res.duration}m)</small>
        </div>
        <button onclick="libDeleteRoomBooking(${res.id})" class="btn btn-red" style="font-size:.72rem;padding:.35rem .6rem;">🗑 Delete</button>`;
      el.appendChild(row);
    });
  }
}

function libDeleteBook(bookId) {
  const book = bookCatalog.find(b => b.id === bookId);
  if (!book) return;
  if (!confirm(`Delete "${book.title}" from catalog? This cannot be undone.`)) return;
  bookCatalog = bookCatalog.filter(b => b.id !== bookId);
  addLog(`Book deleted from catalog: "${book.title}" (${book.isbn}) by librarian ${currentSession.email}`, 'red');
  saveStateToDisk();
  showAlert(`"${book.title}" removed from catalog.`, 'success');
  filterCatalog();
  renderDeleteRecords('del-books');
}

function libDeleteReservation(holdId) {
  const hold = physicalHolds.find(h => h.id === holdId);
  if (!hold) return;
  if (!confirm(`Delete reservation for "${hold.bookTitle}"?`)) return;
  const book = bookCatalog.find(b => b.id === hold.bookId);
  if (book && !hold.returned) book.available = true;
  physicalHolds = physicalHolds.filter(h => h.id !== holdId);
  addLog(`Book reservation deleted: "${hold.bookTitle}" for ${hold.studentEmail} by librarian ${currentSession.email}`, 'red');
  saveStateToDisk();
  showAlert('Reservation deleted.', 'success');
  filterCatalog();
  renderDeleteRecords('del-reservations');
}

function libDeleteLoan(holdId) {
  const hold = physicalHolds.find(h => h.id === holdId);
  if (!hold) return;
  if (!confirm(`Delete loan record for "${hold.bookTitle}"?`)) return;
  const book = bookCatalog.find(b => b.id === hold.bookId);
  if (book && !hold.returned) book.available = true;
  physicalHolds = physicalHolds.filter(h => h.id !== holdId);
  addLog(`Loan record deleted: "${hold.bookTitle}" by librarian ${currentSession.email}`, 'red');
  saveStateToDisk();
  showAlert('Loan record deleted.', 'success');
  renderDeleteRecords('del-loans');
}

function libClearFine(email) {
  const stu = userAccounts.find(u => u.email === email);
  if (!stu) return;
  if (!confirm(`Clear fine of $${parseFloat(stu.outstandingFines).toFixed(2)} for ${stu.name}?`)) return;
  addLog(`Fine cleared: $${parseFloat(stu.outstandingFines).toFixed(2)} for ${stu.name} by librarian ${currentSession.email}`, 'red');
  stu.outstandingFines = 0;
  saveStateToDisk();
  showAlert(`Fine cleared for ${stu.name}.`, 'success');
  renderDeleteRecords('del-fines');
}

function libDeleteRoomBooking(resId) {
  const res = roomBookings.find(r => r.id === resId);
  if (!res) return;
  if (!confirm(`Delete room booking for ${res.room} on ${res.date}?`)) return;
  roomBookings = roomBookings.filter(r => r.id !== resId);
  addLog(`Room booking deleted: ${res.room} on ${res.date} for ${res.studentEmail} by librarian ${currentSession.email}`, 'red');
  saveStateToDisk();
  showAlert('Room booking deleted.', 'success');
  renderDeleteRecords('del-rooms');
}

function renderLibrarianWorkspace() {
  // Populate greeting
  if (currentSession) {
    const firstName = currentSession.name.split(' ')[0];
    const greetingName = document.getElementById('greeting-name-lib');
    if (greetingName) greetingName.textContent = `Welcome, ${firstName}!`;
    const greetingAvatar = document.getElementById('greeting-avatar-lib');
    if (greetingAvatar) {
      const parts = currentSession.name.split(' ');
      greetingAvatar.textContent = parts.length > 1 ? (parts[0][0]+parts[1][0]).toUpperCase() : parts[0][0].toUpperCase();
    }
  }
  // Rooms
  const roomsRoot = document.getElementById('lib-rooms-container');
  roomsRoot.innerHTML = '';
  if (roomBookings.length === 0) {
    roomsRoot.innerHTML = '<div class="empty-box-text">No room reservations active.</div>';
  } else {
    roomBookings.forEach(res => {
      const row = document.createElement('div');
      row.className = 'pass-row alert-left';
      row.innerHTML = `
        <div class="pass-info">
          <p>🏢 ${escapeHTML(res.room)}</p>
          <small>${escapeHTML(res.studentEmail)} · ${res.date} ${res.startTime} (${res.duration}m)</small>
        </div>
        <button onclick="cancelRoomOverride(${res.id})" class="btn btn-red" style="font-size:.72rem;padding:.35rem .6rem;">Cancel</button>`;
      roomsRoot.appendChild(row);
    });
  }
  // Fine config defaults
  document.getElementById('fine-rate-standard').value = fineConfig.standardRate;
  document.getElementById('fine-rate-high').value = fineConfig.highRate;
  document.getElementById('grace-standard').value = fineConfig.graceStandard;
  document.getElementById('grace-high').value = fineConfig.graceHigh;
  // Fined students
  const finesRoot = document.getElementById('lib-fines-container');
  finesRoot.innerHTML = '';
  const fined = userAccounts.filter(u => u.role==='Student' && parseFloat(u.outstandingFines)>0);
  if (fined.length === 0) {
    finesRoot.innerHTML = '<div class="empty-box-text">All student accounts clear.</div>';
  } else {
    fined.forEach(stu => {
      const row = document.createElement('div');
      row.className = 'pass-row';
      row.innerHTML = `
        <div class="pass-info">
          <p>👤 ${escapeHTML(stu.name)}</p>
          <small>${escapeHTML(stu.email)}</small>
        </div>
        <span class="status-box fine-blocked" style="font-size:.72rem;">$${parseFloat(stu.outstandingFines).toFixed(2)}</span>`;
      finesRoot.appendChild(row);
    });
  }
}

function saveFineConfig() {
  fineConfig.standardRate  = parseFloat(document.getElementById('fine-rate-standard').value)||1.00;
  fineConfig.highRate      = parseFloat(document.getElementById('fine-rate-high').value)||2.50;
  fineConfig.graceStandard = parseInt(document.getElementById('grace-standard').value)||10;
  fineConfig.graceHigh     = parseInt(document.getElementById('grace-high').value)||4;
  addLog(`Fine configuration updated by ${currentSession.email}`, 'gold');
  saveStateToDisk();
  showAlert('Fine configuration saved.', 'success');
}

function cancelRoomOverride(id) {
  const booking = roomBookings.find(r => r.id === id);
  addLog(`Room reservation cancelled by librarian: ${booking?.room||'unknown'} for ${booking?.studentEmail||'unknown'}`, 'red');
  roomBookings = roomBookings.filter(r => r.id !== id);
  saveStateToDisk();
  showAlert('Reservation cancelled.', 'success');
  renderLibrarianWorkspace();
}

function applyLateFine() {
  const email = document.getElementById('fine-student-email').value.toLowerCase().trim();
  const amountInput = document.getElementById('fine-manual-amount').value;
  const manualFineAmount = parseFloat(amountInput);
  const stu = userAccounts.find(u => u.email === email && u.role === 'Student');
  if (!stu) { showAlert('No student found with that email.', 'error'); return; }
  if (!amountInput || isNaN(manualFineAmount) || manualFineAmount <= 0) { showAlert('Please enter a valid fine amount ($).', 'error'); return; }
  stu.outstandingFines = (parseFloat(stu.outstandingFines)||0) + manualFineAmount;
  addLog(`Manual fine applied: $${manualFineAmount.toFixed(2)} to ${stu.name} (${stu.email}) by librarian ${currentSession.email}`, 'red');
  saveStateToDisk();
  showAlert(`$${manualFineAmount.toFixed(2)} fine added to ${stu.name}'s account.`, 'success');
  document.getElementById('fine-student-email').value = '';
  document.getElementById('fine-manual-amount').value = '';
  renderLibrarianWorkspace();
}

// ── ADMIN ──
function renderAdminDashboard() {
  // Populate greeting
  if (currentSession) {
    const firstName = currentSession.name.split(' ')[0];
    const greetingName = document.getElementById('greeting-name-adm');
    if (greetingName) greetingName.textContent = `Welcome, ${firstName}!`;
    const greetingAvatar = document.getElementById('greeting-avatar-adm');
    if (greetingAvatar) {
      const parts = currentSession.name.split(' ');
      greetingAvatar.textContent = parts.length > 1 ? (parts[0][0]+parts[1][0]).toUpperCase() : parts[0][0].toUpperCase();
    }
  }
  // Stats
  const strip = document.getElementById('admin-stats-strip');
  const totalFines = userAccounts.filter(u=>u.role==='Student').reduce((t,u)=>t+parseFloat(u.outstandingFines||0),0);
  strip.innerHTML = `
    <div class="stat-card highlight"><div class="stat-label">Total Users</div><div class="stat-value">${userAccounts.length}</div><div class="stat-sub">registered accounts</div></div>
    <div class="stat-card"><div class="stat-label">Catalog Size</div><div class="stat-value">${bookCatalog.length}</div><div class="stat-sub">books &amp; papers</div></div>
    <div class="stat-card"><div class="stat-label">Room Bookings</div><div class="stat-value">${roomBookings.length}</div><div class="stat-sub">active reservations</div></div>
    <div class="stat-card warning"><div class="stat-label">Total Fines</div><div class="stat-value">$${totalFines.toFixed(2)}</div><div class="stat-sub">outstanding</div></div>
    <div class="stat-card"><div class="stat-label">Active Holds</div><div class="stat-value">${physicalHolds.filter(h=>!h.returned).length}</div><div class="stat-sub">books on loan</div></div>`;

  // Logs
  const logsRoot = document.getElementById('admin-logs-container');
  logsRoot.innerHTML = '';
  if (systemLogs.length === 0) {
    logsRoot.innerHTML = '<div class="empty-box-text">No system events recorded yet.</div>';
  } else {
    systemLogs.slice(0,30).forEach(log => {
      const div = document.createElement('div');
      div.className = 'log-entry';
      div.innerHTML = `<div class="log-dot ${log.type==='red'?'red':log.type==='green'?'green':log.type==='gold'?'gold':''}"></div><div><p>${escapeHTML(log.message)}</p><small>${new Date(log.timestamp).toLocaleString()}</small></div>`;
      logsRoot.appendChild(div);
    });
  }

  // Users table
  const tbody = document.getElementById('admin-users-table');
  tbody.innerHTML = '';
  if (userAccounts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No registered users.</td></tr>`;
  } else {
  userAccounts.forEach(u => {
      const tr = document.createElement('tr');
      tr.className = 'user-table-row';
      const finesCell = u.role === 'Student'
        ? `<td style="text-align:right;${parseFloat(u.outstandingFines)>0?'color:#991B1B;font-weight:700;':''}">$${parseFloat(u.outstandingFines||0).toFixed(2)}</td>`
        : `<td style="text-align:right;color:var(--text-muted);font-size:.72rem;">N/A</td>`;
      const isSelf = currentSession && currentSession.email === u.email;
      tr.innerHTML = `
        <td><strong>${escapeHTML(u.name)}</strong></td>
        <td>${escapeHTML(u.email)}</td>
        <td><span class="role-badge role-${u.role.toLowerCase()}">${u.role}</span></td>
        ${finesCell}
        <td style="text-align:center;">
          ${isSelf
            ? `<span style="font-size:.68rem;color:var(--text-muted);font-style:italic;">You</span>`
            : `<button onclick="openEditUserModal('${escapeHTML(u.email)}')" class="btn btn-blue" style="font-size:.68rem;padding:.28rem .6rem;">✏️ Edit</button>`
          }
        </td>
        <td style="text-align:center;">
          ${isSelf
            ? `<span style="font-size:.68rem;color:var(--text-muted);font-style:italic;">—</span>`
            : `<button onclick="deleteUserAccount('${escapeHTML(u.email)}')" class="btn btn-red" style="font-size:.68rem;padding:.28rem .6rem;">🗑 Delete</button>`
          }
        </td>`;
      tbody.appendChild(tr);
    });
  }
}

function generateSystemReport() {
  const box = document.getElementById('admin-report-box');
  box.classList.remove('hidden');
  const totalFines = userAccounts.filter(u=>u.role==='Student').reduce((t,u)=>t+parseFloat(u.outstandingFines||0),0);
  const activeLoans = physicalHolds.filter(h=>!h.returned).length;
  const students = userAccounts.filter(u=>u.role==='Student').length;
  const librarians = userAccounts.filter(u=>u.role==='Librarian').length;
  const admins = userAccounts.filter(u=>u.role==='Admin').length;
  const physical = bookCatalog.filter(b=>b.mediaClass==='PHYSICAL').length;
  const digital  = bookCatalog.filter(b=>b.mediaClass==='DIGITAL').length;

  // Build charts HTML
  const chartsEl = document.getElementById('admin-report-charts');
  chartsEl.innerHTML = '';

  // Helper: draw a simple SVG bar chart
  function makeBarChart(title, labels, values, colors) {
    const max = Math.max(...values, 1);
    const bars = labels.map((label, i) => {
      const pct = Math.round((values[i] / max) * 100);
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:.3rem;flex:1;">
        <span style="font-size:.9rem;font-weight:800;color:#0F172A;">${values[i]}</span>
        <div style="width:100%;background:#E2E8F0;border-radius:6px;height:120px;display:flex;align-items:flex-end;overflow:hidden;">
          <div style="width:100%;height:${pct}%;background:${colors[i]};border-radius:6px 6px 0 0;transition:height .6s cubic-bezier(.34,1.56,.64,1);"></div>
        </div>
        <span style="font-size:.68rem;font-weight:700;color:#64748B;text-align:center;line-height:1.2;">${label}</span>
      </div>`;
    }).join('');
    return `<div style="background:white;border-radius:12px;border:1px solid #E2E8F0;padding:1.25rem;box-shadow:0 2px 4px rgba(0,0,0,.04);">
      <div style="font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#64748B;margin-bottom:1rem;">${title}</div>
      <div style="display:flex;gap:.75rem;align-items:flex-end;">${bars}</div>
    </div>`;
  }

  // Helper: donut chart via SVG
  function makeDonutChart(title, labels, values, colors) {
    const total = values.reduce((a,b)=>a+b,0)||1;
    let offset = 0;
    const r = 60, cx = 80, cy = 80, stroke = 22;
    const circumference = 2 * Math.PI * r;
    const segments = values.map((v, i) => {
      const pct = v / total;
      const dash = pct * circumference;
      const gap  = circumference - dash;
      const seg  = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i]}" stroke-width="${stroke}" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${(-offset * circumference).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" style="transition:all .6s;"/>`;
      offset += pct;
      return seg;
    });
    const legend = labels.map((l, i) => `<div style="display:flex;align-items:center;gap:.4rem;font-size:.72rem;"><span style="width:10px;height:10px;border-radius:50%;background:${colors[i]};display:inline-block;"></span><span style="color:#64748B;">${l}: <strong style="color:#0F172A;">${values[i]}</strong></span></div>`).join('');
    return `<div style="background:white;border-radius:12px;border:1px solid #E2E8F0;padding:1.25rem;box-shadow:0 2px 4px rgba(0,0,0,.04);">
      <div style="font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#64748B;margin-bottom:.75rem;">${title}</div>
      <div style="display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;">
        <svg width="160" height="160" viewBox="0 0 160 160">${segments.join('')}<text x="${cx}" y="${cy+5}" text-anchor="middle" font-size="18" font-weight="800" fill="#0F172A">${total}</text><text x="${cx}" y="${cy+20}" text-anchor="middle" font-size="9" fill="#64748B">TOTAL</text></svg>
        <div style="display:flex;flex-direction:column;gap:.5rem;">${legend}</div>
      </div>
    </div>`;
  }

  chartsEl.innerHTML =
    makeBarChart('📚 Catalog Breakdown', ['Physical Books','Digital Papers','Active Loans','Room Bookings'], [physical,digital,activeLoans,roomBookings.length], ['#35408E','#D97706','#10B981','#7C3AED']) +
    makeDonutChart('👥 User Accounts', ['Students','Librarians','Admins'], [students,librarians,admins], ['#2b6ad0','#7C3AED','#C2410C']) +
    makeBarChart('💸 Financial Overview', ['Fined Students','Clear Accounts'], [userAccounts.filter(u=>u.role==='Student'&&parseFloat(u.outstandingFines)>0).length, userAccounts.filter(u=>u.role==='Student'&&!(parseFloat(u.outstandingFines)>0)).length], ['#EF4444','#10B981']) +
    makeDonutChart('📋 Hold Records', ['Returned','Active Loans'], [physicalHolds.filter(h=>h.returned).length, activeLoans], ['#10B981','#EF4444']);

  document.getElementById('admin-report-text').textContent = `
══════════════════════════════════════════════════════
  NATIONAL UNIVERSITY — SMARTLIB SYSTEM MANIFEST
══════════════════════════════════════════════════════
  Generated  : ${new Date().toLocaleString()}
  Status     : Online · All Systems Normal
  CAS Link   : Connected and Secure
──────────────────────────────────────────────────────
  [DATABASE METRICS]
  Total Accounts       : ${userAccounts.length} profiles
    · Students         : ${students}
    · Librarians       : ${librarians}
    · Admins           : ${admins}
  Catalog Resources    : ${bookCatalog.length} items
    · Physical Books   : ${physical}
    · Digital Papers   : ${digital}
  Active Loans         : ${activeLoans} items checked out
  Room Reservations    : ${roomBookings.length} active
  Kiosk Hold Tokens    : ${physicalHolds.length} total issued

  [FINE CONFIGURATION]
  Standard Rate        : $${fineConfig.standardRate}/day (grace: ${fineConfig.graceStandard} days)
  High-Priority Rate   : $${fineConfig.highRate}/day (grace: ${fineConfig.graceHigh} days)

  [FINANCIAL AUDIT — STUDENTS ONLY]
  Consolidated Fines   : $${totalFines.toFixed(2)} outstanding

  [SYSTEM HEALTH]
  Status Code          : 200 SUCCESS
  Log Entries          : ${systemLogs.length} recorded
══════════════════════════════════════════════════════`;
  addLog(`Monthly report generated by ${currentSession.email}`, 'gold');
  saveStateToDisk();
  showAlert('Monthly activity summary compiled successfully.', 'success');
}

// ── UTILITIES ──
function showAlert(msg, type='success') {
  const b = document.getElementById('alert-banner');
  const msgEl = document.getElementById('alert-banner-msg');
  if (msgEl) msgEl.textContent = msg; else b.childNodes[0].textContent = msg;
  b.className = `alert-toast ${type}`;
  b.classList.remove('hidden');
  clearTimeout(b._timer);
  b._timer = setTimeout(() => b.classList.add('hidden'), 4500);
}

function openModal(html) {
  document.getElementById('modal-content-root').innerHTML = html;
  document.getElementById('app-modal').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('app-modal').classList.add('hidden');
  document.getElementById('modal-content-root').innerHTML = '';
}

// ── UNIVERSITY EMAIL VALIDATOR ──
// Blocks well-known personal/consumer email providers.
// Only structurally valid addresses that are NOT from blocked domains are accepted.
const BLOCKED_EMAIL_DOMAINS = [
  'gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com',
  'aol.com','protonmail.com','mail.com','live.com','msn.com',
  'ymail.com','googlemail.com','me.com','mac.com'
];
function isValidUnivEmail(email) {
  // Must match basic email structure
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  const domain = email.split('@')[1].toLowerCase();
  // Reject known personal/consumer providers
  if (BLOCKED_EMAIL_DOMAINS.includes(domain)) return false;
  return true;
}

// ── ADMIN: EDIT USER PERMISSIONS ──
function openEditUserModal(email) {
  const user = userAccounts.find(u => u.email === email);
  if (!user) return;
  openModal(`
    <div>
      <h3 style="color:var(--nu-navy-dark);margin-bottom:.25rem;">✏️ Manage User Permissions</h3>
      <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:1rem;"><strong>${escapeHTML(user.name)}</strong> · ${escapeHTML(user.email)}</p>
      <div class="simple-form">
        <div class="form-group">
          <label>Full Name</label>
          <input type="text" id="edit-user-name" value="${escapeHTML(user.name)}" style="padding:.65rem .85rem;border-radius:8px;border:1px solid var(--border-gray);font-size:.88rem;outline:none;width:100%;font-family:var(--font-body);">
        </div>
        <div class="form-group">
          <label>Account Role</label>
          <select id="edit-user-role" style="padding:.65rem .85rem;border-radius:8px;border:1px solid var(--border-gray);font-size:.88rem;outline:none;width:100%;font-family:var(--font-body);">
            <option value="Student" ${user.role==='Student'?'selected':''}>Student</option>
            <option value="Librarian" ${user.role==='Librarian'?'selected':''}>Librarian</option>
            <option value="Admin" ${user.role==='Admin'?'selected':''}>Admin</option>
          </select>
        </div>
        <div class="form-group">
          <label>Reset Password <span style="font-size:.7rem;color:var(--text-muted);font-weight:400;">(leave blank to keep current)</span></label>
          <div class="password-wrapper">
            <input type="password" id="edit-user-password" placeholder="Enter new password (min. 8 characters)" style="width:100%;padding:.65rem .85rem;border-radius:8px;border:1px solid var(--border-gray);font-size:.88rem;outline:none;background:var(--canvas-bg);transition:all .15s;font-family:var(--font-body);">
            <button type="button" class="pw-toggle-btn" onclick="togglePwVisibility('edit-user-password',this)" title="Show/hide password">👁</button>
          </div>
        </div>
        <div class="form-footer-buttons">
          <button onclick="closeModal()" class="btn btn-gray">Cancel</button>
          <button onclick="saveUserPermissions('${escapeHTML(email)}')" class="btn btn-blue">Save Changes</button>
        </div>
      </div>
    </div>`);
}

function saveUserPermissions(email) {
  const user = userAccounts.find(u => u.email === email);
  if (!user) { closeModal(); return; }
  const newName     = document.getElementById('edit-user-name').value.trim();
  const newRole     = document.getElementById('edit-user-role').value;
  const newPassword = document.getElementById('edit-user-password').value;
  if (!newName) { showAlert('Name cannot be empty.', 'error'); return; }
  if (newPassword && newPassword.length < 8) { showAlert('New password must be at least 8 characters.', 'error'); return; }
  const oldRole = user.role;
  user.name = newName;
  user.role = newRole;
  if (newPassword) user.password = newPassword;
  // If role changed to/from Student, handle outstandingFines field
  if (oldRole !== 'Student' && newRole === 'Student' && user.outstandingFines === undefined) {
    user.outstandingFines = 0;
  }
  addLog(`User permissions updated: ${user.name} (${email}) role ${oldRole}→${newRole} by admin ${currentSession.email}`, 'gold');
  saveStateToDisk();
  showAlert(`Permissions updated for "${user.name}".`, 'success');
  closeModal();
  renderAdminDashboard();
}

// ── ADMIN: DELETE USER ACCOUNT ──
function deleteUserAccount(email) {
  const user = userAccounts.find(u => u.email === email);
  if (!user) return;

  // Prevent deleting your own currently active account
  if (currentSession && currentSession.email === email) {
    showAlert('You cannot delete your own account while you are logged in.', 'error'); return;
  }

  // Block deletion if student still has unreturned book holds
  const activeHolds = physicalHolds.filter(h => h.studentEmail === email && !h.returned);
  if (activeHolds.length > 0) {
    showAlert(`Cannot delete: ${user.name} still has ${activeHolds.length} active book hold(s). Ensure all books are returned first.`, 'error'); return;
  }

  if (!confirm(`Permanently delete the account of "${user.name}" (${user.email})?\nRole: ${user.role}\n\nThis cannot be undone.`)) return;

  userAccounts = userAccounts.filter(u => u.email !== email);

  // Clean up associated data for this account
  roomBookings       = roomBookings.filter(r => r.studentEmail !== email);
  inAppNotifications = inAppNotifications.filter(n => n.toEmail !== email && n.hostEmail !== email);

  addLog(`Account deleted: ${user.name} (${user.role} · ${email}) by admin ${currentSession.email}`, 'red');
  saveStateToDisk();
  showAlert(`Account for "${user.name}" has been permanently deleted.`, 'success');
  renderAdminDashboard();
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]||c));
}

// ── PASSWORD HELPERS ──
function togglePwVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.textContent = showing ? '👁' : '🙈';
  btn.title = showing ? 'Show password' : 'Hide password';
}

function checkPasswordStrength(pw) {
  const fill = document.getElementById('pw-strength-fill');
  const lbl  = document.getElementById('pw-strength-label');
  if (!fill || !lbl) return;
  if (!pw) { fill.style.width='0%'; lbl.textContent=''; return; }
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    { label:'Too short',  color:'#EF4444', pct:'15%' },
    { label:'Weak',       color:'#F97316', pct:'30%' },
    { label:'Fair',       color:'#FBBF24', pct:'55%' },
    { label:'Good',       color:'#34D399', pct:'75%' },
    { label:'Strong',     color:'#10B981', pct:'90%' },
    { label:'Very strong',color:'#059669', pct:'100%'},
  ];
  const lvl = levels[Math.min(score, levels.length - 1)];
  fill.style.width      = lvl.pct;
  fill.style.background = lvl.color;
  lbl.textContent       = lvl.label;
  lbl.style.color       = lvl.color;
}
// ── DARK MODE ──────────────────────────────────────────────────────────────
function toggleDarkMode() {
  const checkbox = document.getElementById('darkmode-checkbox');
  const isDark = checkbox ? checkbox.checked : document.body.classList.contains('dark-mode');
  document.body.classList.toggle('dark-mode', isDark);
  localStorage.setItem('nu_dark_mode', isDark ? '1' : '0');
  const lbl = document.getElementById('darkmode-label');
  if (lbl) lbl.textContent = isDark ? 'Dark' : 'Light';
}
function applyStoredTheme() {
  if (localStorage.getItem('nu_dark_mode') === '1') {
    document.body.classList.add('dark-mode');
    const checkbox = document.getElementById('darkmode-checkbox');
    if (checkbox) checkbox.checked = true;
    const lbl = document.getElementById('darkmode-label');
    if (lbl) lbl.textContent = 'Dark';
  }
}
document.addEventListener('DOMContentLoaded', applyStoredTheme);

// ── SIDEBAR ────────────────────────────────────────────────────────────────
const SIDEBAR_MAP = {
  // No session — public
  null: [
    { section: 'EXPLORE' },
    { icon:'📚', label:'Catalog',          view:'catalog-view' },
  ],
  Student: [
    { section: 'EXPLORE' },
    { icon:'📚', label:'Catalog',            view:'catalog-view' },
    { section: 'STUDENT' },
    { icon:'🎯', label:'My Dashboard',       view:'student-view' },
    { icon:'🗓', label:'Book a Study Room',  view:'student-view', sub:'room' },
    { icon:'🎟', label:'Active Passes & Holds', view:'student-view', sub:'passes' },
    { icon:'🔔', label:'Notifications',      view:'student-view', sub:'notifs' },
    { icon:'📂', label:'Digital Repository', view:'student-view', sub:'digital' },
    { icon:'💳', label:'Pay Fine',           view:'student-view', sub:'fine' },
  ],
  Librarian: [
    { section: 'EXPLORE' },
    { icon:'📚', label:'Catalog',            view:'catalog-view' },
    { section: 'LIBRARIAN DESK' },
    { icon:'💼', label:'Desk Overview',      view:'librarian-view' },
    { icon:'📥', label:'Add Books',          view:'librarian-view', lib:'books' },
    { icon:'✏️', label:'Edit Books',         view:'librarian-view', lib:'edit' },
    { icon:'🗑', label:'Delete Records',     view:'librarian-view', lib:'records' },
    { icon:'📖', label:'Active Loans',       view:'librarian-view', lib:'loans' },
    { icon:'⚠️', label:'Fines & Rooms',      view:'librarian-view', lib:'fines-rooms' },
  ],
  Admin: [
    { section: 'EXPLORE' },
    { icon:'📚', label:'Catalog',            view:'catalog-view' },
    { section: 'ADMIN CONTROL' },
    { icon:'⚙️', label:'Admin Overview',     view:'admin-view' },
    { icon:'📋', label:'System Transaction Log', view:'admin-view', scroll:'admin-logs-container' },
    { icon:'👥', label:'Registered User Profiles', view:'admin-view', scroll:'admin-users-table' },
    { icon:'📊', label:'Monthly Activity Summary', view:'admin-view', scroll:'admin-report-box', report:true },
  ],
};

// Currently active sidebar item key
let _sidebarActiveKey = 'catalog-view';

function buildSidebar() {
  const role   = currentSession ? currentSession.role : null;
  const items  = SIDEBAR_MAP[role] || SIDEBAR_MAP[null];
  const nav    = document.getElementById('sidebar-nav-content');
  const footer = document.getElementById('sidebar-footer');
  const userInfo   = document.getElementById('sidebar-user-info');
  const logoutBtn  = document.getElementById('sidebar-logout-btn');
  const avatarEl   = document.getElementById('sidebar-avatar-letters');
  const nameEl     = document.getElementById('sidebar-username');
  const roleEl     = document.getElementById('sidebar-userrole');

  // Footer user info
  if (currentSession) {
    userInfo.style.display = 'flex';
    logoutBtn.style.display = 'block';
    const parts = currentSession.name.split(' ');
    avatarEl.textContent = parts.length > 1
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : parts[0][0].toUpperCase();
    nameEl.textContent = currentSession.name;
    roleEl.textContent = currentSession.role;
  } else {
    userInfo.style.display = 'none';
    logoutBtn.style.display = 'none';
  }

  nav.innerHTML = '';
  items.forEach(item => {
    if (item.section) {
      const lbl = document.createElement('div');
      lbl.className = 'sidebar-section-label';
      lbl.textContent = item.section;
      nav.appendChild(lbl);
      return;
    }
    // Build a unique key for active tracking
    const key = item.lib ? `lib-${item.lib}` : item.scroll ? `scroll-${item.scroll}` : item.view;
    const btn = document.createElement('button');
    btn.className = 'sidebar-item' + (_sidebarActiveKey === key ? ' active' : '');
    btn.innerHTML = `<span class="sidebar-item-icon">${item.icon}</span><span class="sidebar-item-label">${item.label}</span>`;
    btn.onclick = () => sidebarNavigate(item, key);
    nav.appendChild(btn);
  });
}

// ── PANEL SYSTEM ───────────────────────────────────────────────────────────
// Maps sidebar item keys to the panel IDs they should reveal
const PANEL_MAP = {
  // Student panels (keyed by item.sub)
  'room':    'panel-student-room',
  'passes':  'panel-student-passes',
  'notifs':  'panel-student-notifs',
  'digital': 'panel-student-digital',
  'fine':    'panel-student-fine',
  // Librarian panels (keyed by item.lib)
  'books':       'panel-lib-books',
  'edit':        'panel-lib-edit',
  'records':     'panel-lib-records',
  'loans':       'panel-lib-loans',
  'fines-rooms': 'panel-lib-fines-rooms',
  // Admin panels (keyed by item.scroll target prefix)
  'admin-logs-container':  'panel-admin-logs',
  'admin-users-table':     'panel-admin-users',
  'admin-report-box':      'panel-admin-report',
};

function hideAllPanelsInView(viewId) {
  document.querySelectorAll(`#${viewId} .role-panel`).forEach(p => p.classList.add('hidden'));
}

function showRolePanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  // Find parent view and hide all sibling panels first
  const view = panel.closest('.view-section');
  if (view) view.querySelectorAll('.role-panel').forEach(p => p.classList.add('hidden'));
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function sidebarNavigate(item, key) {
  closeSidebar();
  _sidebarActiveKey = key;

  // Navigate to the right view
  if (item.view === 'catalog-view') {
    switchView('catalog-view');
    buildSidebar();
    return;
  }

  checkAuthAndNavigate(item.view);

  // Determine which panel to open
  const panelKey = item.sub || item.lib || item.scroll || null;

  if (panelKey && PANEL_MAP[panelKey]) {
    // Show the specific panel
    setTimeout(() => {
      if (item.report) generateSystemReport();
      showRolePanel(PANEL_MAP[panelKey]);
    }, 80);
  } else {
    // "Overview" / "My Dashboard" items — show greeting only, hide all panels
    setTimeout(() => hideAllPanelsInView(item.view), 80);
  }

  buildSidebar();
}

function toggleSidebar() {
  const sidebar  = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const btn      = document.getElementById('hamburger-btn');
  const isOpen   = sidebar.classList.contains('open');
  if (isOpen) {
    closeSidebar();
  } else {
    buildSidebar();
    sidebar.classList.add('open');
    backdrop.classList.add('open');
    btn.classList.add('open');
  }
}

function closeSidebar() {
  document.getElementById('app-sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
  document.getElementById('hamburger-btn').classList.remove('open');
}

// Patch refreshSessionUI to also rebuild sidebar if it's open
const _origRefreshSessionUI = refreshSessionUI;
refreshSessionUI = function() {
  _origRefreshSessionUI();
  const sidebar = document.getElementById('app-sidebar');
  if (sidebar && sidebar.classList.contains('open')) buildSidebar();
  syncHiddenTabs();
};

// Patch switchView to track active key
const _origSwitchView = switchView;
switchView = function(viewId) {
  _origSwitchView(viewId);
  if (!_sidebarActiveKey.startsWith('lib-') && !_sidebarActiveKey.startsWith('scroll-')) {
    _sidebarActiveKey = viewId;
  }
};

function syncHiddenTabs() {
  // Keep menu-tab-* IDs working for any remaining callers (no-op now — sidebar replaced them)
}

// Stub: navMenuGo still used by branding badge click
function navMenuGo(viewId) {
  closeSidebar();
  if (viewId === 'catalog-view') switchView(viewId);
  else checkAuthAndNavigate(viewId);
}

// Close sidebar on Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });