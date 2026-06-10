// ============================================================
//  Team Hub — parent/child model. Talks to Supabase RPCs.
// ============================================================
const C = window.CONFIG;
const FUNCTIONS = C.SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co');
const RPC = (fn, body) => fetch(`${C.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: C.SUPABASE_KEY, Authorization: `Bearer ${C.SUPABASE_KEY}` },
  body: JSON.stringify(body || {}),
}).then(async r => {
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error((data && data.message) || text || ('HTTP ' + r.status));
  return data;
});

// ---- durable storage (cookie mirror so iOS home-screen keeps the login) ----
const MIRROR = ['th_code','th_acct','th_name'];
function setCookie(k,v){ try { document.cookie = `${k}=${encodeURIComponent(v)}; max-age=34560000; path=/; samesite=lax`; } catch(e){} }
function getCookie(k){ const m = document.cookie.match('(?:^|; )'+k+'=([^;]*)'); return m ? decodeURIComponent(m[1]) : ''; }
function delCookie(k){ try { document.cookie = `${k}=; max-age=0; path=/`; } catch(e){} }
function restoreSession(){ MIRROR.forEach(k => { if (!localStorage.getItem(k)) { const c=getCookie(k); if(c) localStorage.setItem(k,c); } }); }

const LS = {
  code: () => localStorage.getItem('th_code'),
  acct: () => localStorage.getItem('th_acct'),
  name: () => localStorage.getItem('th_name'),
  pass: () => localStorage.getItem('th_pass'),
  set: (k,v) => { localStorage.setItem('th_'+k, v); if (MIRROR.includes('th_'+k)) setCookie('th_'+k, v); },
  clear: () => MIRROR.forEach(k => { localStorage.removeItem(k); delCookie(k); }),
};

// ---- helpers ----------------------------------------------------------------
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => (s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
const initials = n => (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
function avatarHTML(name, photo, cls){
  return photo ? `<img class="avatar ${cls||''}" src="${esc(photo)}" alt="${esc(name)}">`
               : `<span class="avatar ph ${cls||''}">${esc(initials(name))}</span>`;
}
function fmtDate(iso){
  const d = new Date(iso);
  return { day:d.getDate(), mon:d.toLocaleDateString('en-GB',{month:'short'}),
    weekday:d.toLocaleDateString('en-GB',{weekday:'long'}),
    full:d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}),
    time:d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) };
}

// add events to the phone's calendar via an .ics file
function icsEvent(ev){
  const dt = s => new Date(s).toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
  const end = new Date(new Date(ev.starts_at).getTime() + (ev.duration_min||60)*60000).toISOString();
  const escT = t => (t||'').replace(/([,;\\])/g,'\\$1').replace(/\n/g,'\\n');
  return ['BEGIN:VEVENT',
    `UID:${ev.id||Math.random().toString(36).slice(2)}@northwood`,`DTSTART:${dt(ev.starts_at)}`,`DTEND:${dt(end)}`,
    `SUMMARY:${escT(ev.title)}`, ev.location?`LOCATION:${escT(ev.location)}`:'', ev.notes?`DESCRIPTION:${escT(ev.notes)}`:'',
    'END:VEVENT'].filter(Boolean).join('\r\n');
}
function icsWrap(body){
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Northwood//Team Hub//EN', body, 'END:VCALENDAR'].join('\r\n');
}
function downloadICS(ics, name){
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    window.location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type:'text/calendar' }));
    a.download = (name||'event').replace(/[^\w]+/g,'-') + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
  }
}
function addToCalendar(ev){ if (ev) downloadICS(icsWrap(icsEvent(ev)), ev.title); }
function addAllToCalendar(evs){ downloadICS(icsWrap(evs.map(icsEvent).join('\r\n')), 'team-schedule'); }
function compressImage(file, max=256){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{ const s=Math.min(1,max/Math.max(img.width,img.height));
      const w=Math.round(img.width*s),h=Math.round(img.height*s);
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      cv.toBlob(b=>b?resolve(b):reject(new Error('Could not process image')),'image/jpeg',0.85); };
    img.onerror=()=>reject(new Error('That file is not a valid image'));
    img.src=URL.createObjectURL(file);
  });
}
async function uploadAvatar(playerId, blob){
  const path = `${playerId}.jpg`;
  const res = await fetch(`${C.SUPABASE_URL}/storage/v1/object/avatars/${path}`, {
    method:'POST', headers:{ apikey:C.SUPABASE_KEY, Authorization:`Bearer ${C.SUPABASE_KEY}`,
      'Content-Type':'image/jpeg', 'x-upsert':'true' }, body:blob });
  if (!res.ok) throw new Error('Photo upload failed: ' + (await res.text()));
  return `${C.SUPABASE_URL}/storage/v1/object/public/avatars/${path}?v=${Date.now()}`;
}

// ---- state ------------------------------------------------------------------
let EVENTS = [], MYPLAYERS = [], ATT = {}, OPTIONS = {};

// ---- tabs -------------------------------------------------------------------
$$('nav.tabs button').forEach(b => b.addEventListener('click', () => {
  const tab = b.dataset.tab;
  $$('nav.tabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
  if (tab === 'team') loadTeam();
  if (tab === 'schedule') loadSchedule();
  if (tab === 'news') loadNews();
  if (tab === 'you') loadAccount();
}));

// coach tools live on their own page, reached from You / the + button / the stats chip
function showCoach(sub){
  $$('nav.tabs button').forEach(x => x.classList.remove('active'));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-coach'));
  if (LS.pass()) {
    showCoachPanel();
    if (sub) $(`#coachPanel .subnav [data-sub="${sub}"]`)?.click();
  }
}
$('#coachBack').addEventListener('click', () => $('nav.tabs [data-tab="schedule"]').click());
$('#coachToolsBtn').addEventListener('click', () => showCoach());

// ============================================================
//  LOGIN / SIGN-UP
// ============================================================
function hideJoin(){ $('#joinModal').classList.add('hide'); }
function showStep(s){ ['code','pick','new'].forEach(x => $('#step-'+x).classList.toggle('hide', x!==s)); }

async function showJoin(){
  $('#joinModal').classList.remove('hide');
  const saved = getCookie('th_code');
  if (saved) { $('#joinCode').value = saved; openPicker(saved); }
  else showStep('code');
}

$('#codeBtn').addEventListener('click', () => openPicker($('#joinCode').value.trim()));
async function openPicker(code){
  const err = $('#codeErr'); err.textContent='';
  if (!code) { err.textContent='Enter your team code.'; showStep('code'); return; }
  try {
    const ok = await RPC('check_code', { p_code: code });
    if (!ok) { err.textContent='That team code is not right.'; showStep('code'); return; }
    setCookie('th_code', code);
    const accounts = (await RPC('list_accounts_public', { p_code: code })) || [];
    $('#pickList').innerHTML = accounts.length
      ? accounts.map(a => `<button class="pick-item" data-id="${a.id}" data-name="${esc(a.name)}">
          ${avatarHTML(a.name,null)}<span class="pick-text"><b>${esc(a.name)}</b>${a.children?`<small>${esc(a.children)}</small>`:''}</span></button>`).join('')
      : '<div class="muted center" style="padding:14px">No accounts yet — tap below to be first.</div>';
    $$('#pickList .pick-item').forEach(b => b.addEventListener('click', () => {
      LS.set('code', code); LS.set('acct', b.dataset.id); LS.set('name', b.dataset.name);
      hideJoin(); boot();
    }));
    showStep('pick');
  } catch (e) { err.textContent = e.message; showStep('code'); }
}

$('#newBtn').addEventListener('click', () => { ensureChildRow(); showStep('new'); });
$$('#joinModal .backlink').forEach(a => a.addEventListener('click', () => {
  const d = a.dataset.back;
  if (d === 'pick') openPicker($('#joinCode').value.trim()); else showStep('code');
}));

// dynamic child-name rows in the signup form
function ensureChildRow(){ if (!$('#childRows').children.length) addChildRow(); }
function addChildRow(){
  const div = document.createElement('div');
  div.className = 'child-input';
  div.innerHTML = `<input class="child-name" placeholder="Child's name">`;
  $('#childRows').appendChild(div);
}
$('#addChildRow').addEventListener('click', addChildRow);

$('#createAcctBtn').addEventListener('click', async () => {
  const code = $('#joinCode').value.trim();
  const name = $('#pName').value.trim();
  const email = $('#pEmail').value.trim();
  const kids = $$('#childRows .child-name').map(i => i.value.trim()).filter(Boolean);
  const err = $('#newErr'); err.textContent='';
  if (!code) { err.textContent='Enter your team code first.'; showStep('code'); return; }
  if (!name) { err.textContent='Please enter your name.'; return; }
  if (!kids.length) { err.textContent='Add at least one child.'; return; }
  const btn = $('#createAcctBtn'); btn.disabled = true;
  try {
    const acct = await RPC('create_account', { p_code: code, p_name: name, p_email: email });
    for (const k of kids) await RPC('add_player', { p_code: code, p_account: acct, p_name: k });
    LS.set('code', code); LS.set('acct', acct); LS.set('name', name);
    hideJoin(); boot();
  } catch (e) {
    err.textContent = /bad code/.test(e.message) ? 'That team code is not right.' : 'Could not create account: ' + e.message;
  } finally { btn.disabled = false; }
});

// ---- header identity --------------------------------------------------------
function renderWho(){
  $('#whoBox').innerHTML =
    `<span class="who-av" data-act="account" title="Your family / account">${esc(initials(LS.name()))}</span>`
    + `<span class="who-text">${esc(LS.name())}<br><a data-act="account">My family</a></span>`;
}
$('#whoBox').addEventListener('click', e => {
  if (e.target.closest('[data-act]')?.dataset.act === 'account') showAccount();
});

// ============================================================
//  SCHEDULE + availability (per child)
// ============================================================
// "Upcoming ▾" toggles between upcoming and past (ended) sessions, like HEJA
let SCHED_MODE = 'upcoming';
$('#schedToggle').addEventListener('click', () => {
  SCHED_MODE = SCHED_MODE === 'upcoming' ? 'past' : 'upcoming';
  $('#schedToggle').innerHTML = (SCHED_MODE === 'upcoming' ? 'Upcoming' : 'Past') + ' <span class="pt-chev">▾</span>';
  loadSchedule();
});
$('#addEvBtn').addEventListener('click', () => showCoach('manage'));
$('#statsChip').addEventListener('click', () => showCoach('stats'));
$('#syncChip').addEventListener('click', () => {
  if (!EVENTS.length) { toast('No sessions to sync'); return; }
  addAllToCalendar(EVENTS);
  toast('Adding schedule to your calendar');
});

async function loadSchedule(){
  const code=LS.code(), acct=LS.acct();
  const list = $('#scheduleList');
  list.innerHTML = '<div class="muted center" style="padding:30px">Loading…</div>';
  try {
    const [events, att, players, options] = await Promise.all([
      RPC(SCHED_MODE === 'past' ? 'get_events_past' : 'get_events',{p_code:code,p_account:acct}),
      RPC('get_attendance',{p_code:code,p_account:acct}),
      RPC('get_my_players',{p_code:code,p_account:acct}),
      RPC('get_account_options',{p_code:code,p_account:acct}),
    ]);
    EVENTS = events||[]; MYPLAYERS = players||[];
    ATT = {}; (att||[]).forEach(a => { (ATT[a.event_id] ||= []).push(a); });
    OPTIONS = {}; (options||[]).forEach(o => { (OPTIONS[o.event_id] ||= []).push(o.player_id); });
    renderSchedule();
  } catch (e) {
    list.innerHTML = `<div class="empty"><div class="big">⚠️</div><div class="lead">Couldn't load the schedule</div>${esc(e.message)}</div>`;
  }
}

function renderSchedule(){
  const list = $('#scheduleList');
  if (!MYPLAYERS.length){
    list.innerHTML = `<div class="empty"><div class="big">👶</div><div class="lead">Add your child</div>
      You haven't added a child yet — add one to start setting their availability.
      <button class="btn" id="goAddChild" style="max-width:220px;margin:16px auto 0">Add a child</button></div>`;
    $('#goAddChild')?.addEventListener('click', showAccount);
    return;
  }
  if (!EVENTS.length){
    list.innerHTML = SCHED_MODE === 'past'
      ? `<div class="empty"><div class="big">🏁</div><div class="lead">No past sessions yet</div>Finished sessions will appear here.</div>`
      : `<div class="empty"><div class="big">📅</div><div class="lead">No sessions yet</div>Your coach will add training and matches here.</div>`;
    return;
  }
  const isPast = SCHED_MODE === 'past';
  const pName  = id => (MYPLAYERS.find(p=>p.id===id)||{}).name || '';
  const pPhoto = id => (MYPLAYERS.find(p=>p.id===id)||{}).photo_url || '';
  const TYPE = { training:'Training', match:'Match', tournament:'Tournament', social:'Social' };
  const ICO  = { '':'+', going:'✓', maybe:'?', out:'✕' };
  const now = Date.now(), wk = now + 7*864e5;
  let bucketLabel = null, html = '';

  EVENTS.forEach(ev => {
    const d = fmtDate(ev.starts_at);
    const rows = ATT[ev.id] || [];
    const mineIds = OPTIONS[ev.id] || [];
    const statusOf = pid => (rows.find(r=>r.player_id===pid)||{}).status || '';
    const noteOf   = pid => (rows.find(r=>r.player_id===pid)||{}).note || '';

    const bucket = isPast ? 'Earlier' : (new Date(ev.starts_at).getTime() <= wk ? 'Next 7 days' : 'Later');
    if (bucket !== bucketLabel) { html += `<div class="sched-group">${bucket}</div>`; bucketLabel = bucket; }

    const kidLines = mineIds.map(pid => {
      const st = statusOf(pid);
      return `<div class="kid-line" data-ev="${ev.id}" data-player="${pid}">
        ${avatarHTML(pName(pid),pPhoto(pid))}
        <span class="kid-name">${esc(pName(pid))}</span>
        <input class="kid-note" placeholder="Add a note…" value="${esc(noteOf(pid))}">
        <div class="status ${st}">
          <span class="status-ico">${ICO[st]}</span><span class="status-chev"></span>
          <select class="kid-status">
            <option value=""      ${!st?'selected':''}>No reply</option>
            <option value="going" ${st==='going'?'selected':''}>Going</option>
            <option value="maybe" ${st==='maybe'?'selected':''}>Maybe</option>
            <option value="out"   ${st==='out'?'selected':''}>Can't make it</option>
          </select>
        </div>
      </div>`;
    }).join('');

    html += `<div class="card hcard kind-${ev.kind}">
      <div class="hcard-type">${TYPE[ev.kind]||ev.kind}</div>
      <div class="hcard-head tap" data-open="${ev.id}">
        <span class="accent"></span>
        <div class="hdate"><div class="hm">${d.mon}</div><div class="hd">${d.day}</div></div>
        <div class="hbody">
          <div class="htitle">${esc(ev.title)}</div>
          <div class="hsub">${d.weekday}, ${d.time}${isPast?', Ended':''}</div>
          ${ev.location?`<div class="hloc">📍 ${esc(ev.location)}</div>`:''}
        </div>
        <span class="chev">›</span>
      </div>
      ${isPast ? '' : kidLines}
      ${isPast ? '' : `<div class="cal-link" data-cal="${ev.id}">📅 Add to calendar</div>`}
    </div>`;
  });
  list.innerHTML = html;

  // header tap → detail page (ignore taps on the interactive child controls)
  $$('#scheduleList .hcard-head').forEach(h => h.addEventListener('click', () =>
    showSession(EVENTS.find(e => e.id === h.dataset.open))));
  $$('#scheduleList .cal-link').forEach(b => b.addEventListener('click', () =>
    addToCalendar(EVENTS.find(e => e.id === b.dataset.cal))));
  $$('#scheduleList .kid-status').forEach(sel => sel.addEventListener('change', () => saveKid(sel.closest('.kid-line'))));
  $$('#scheduleList .kid-note').forEach(inp => inp.addEventListener('change', () => saveKid(inp.closest('.kid-line'))));
}

async function saveKid(line){
  const ev = line.dataset.ev, pid = line.dataset.player;
  const status = line.querySelector('.kid-status').value;
  const note = line.querySelector('.kid-note').value.trim();
  // always reflect the chosen status on the pill (including "No reply" → grey +)
  const pill = line.querySelector('.status');
  pill.className = 'status ' + status;
  pill.querySelector('.status-ico').textContent = { '':'+', going:'✓', maybe:'?', out:'✕' }[status];
  try {
    if (!status) {
      await RPC('clear_rsvp', { p_code:LS.code(), p_player:pid, p_event:ev });
      const arr = ATT[ev]; if (arr) { const i = arr.findIndex(r => r.player_id===pid); if (i>=0) arr.splice(i,1); }
      toast('Set to no reply');
    } else {
      await RPC('set_rsvp', { p_code:LS.code(), p_player:pid, p_event:ev, p_status:status, p_note:note });
      const arr = ATT[ev] ||= []; const mine = arr.find(r => r.player_id===pid);
      const pl = MYPLAYERS.find(p=>p.id===pid) || {};
      if (mine) { mine.status = status; mine.note = note; }
      else arr.push({ event_id:ev, player_id:pid, player_name:pl.name, player_photo:pl.photo_url, status, note });
      toast('Saved');
    }
  } catch (e) { toast('Could not save: ' + e.message); }
}

// ============================================================
//  SESSION DETAIL PAGE
// ============================================================
$('#sessionBack').addEventListener('click', () => {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-schedule'));
  $$('nav.tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === 'schedule'));
});

const TYPE_LABEL = { training:'Practice', match:'Match', tournament:'Tournament', social:'Social' };
async function showSession(ev){
  if (!ev) return;
  $$('nav.tabs button').forEach(x => x.classList.remove('active'));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-session'));
  const d = fmtDate(ev.starts_at);
  const endT = new Date(new Date(ev.starts_at).getTime() + (ev.duration_min||60)*60000)
    .toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const maps = ev.location ? 'https://maps.apple.com/?q=' + encodeURIComponent(ev.location) : '';

  let rows = [];
  try { rows = (await RPC('get_event_players', { p_code: LS.code(), p_event: ev.id })) || []; } catch (e) {}
  const ICO = { '':'+', going:'✓', maybe:'?', out:'✕' };
  const myKids = rows.filter(r => MYPLAYERS.some(p => p.id === r.player_id));
  const kidLines = myKids.map(r => { const st = r.status || '';
    return `<div class="kid-line" data-ev="${ev.id}" data-player="${r.player_id}">
      ${avatarHTML(r.name,r.photo_url)}<span class="kid-name">${esc(r.name)}</span>
      <input class="kid-note" placeholder="Add a note…" value="${esc(r.note||'')}">
      <div class="status ${st}"><span class="status-ico">${ICO[st]}</span><span class="status-chev"></span>
        <select class="kid-status"><option value="" ${!st?'selected':''}>No reply</option>
          <option value="going" ${st==='going'?'selected':''}>Going</option>
          <option value="maybe" ${st==='maybe'?'selected':''}>Maybe</option>
          <option value="out" ${st==='out'?'selected':''}>Can't make it</option></select></div>
    </div>`; }).join('');

  $('#sessionDetail').innerHTML = `<div class="card kind-${ev.kind}">
      <div class="detail-type">${TYPE_LABEL[ev.kind]||ev.kind}</div>
      <div class="detail-title">${esc(ev.title)}</div>
      <div class="detail-rows">
        <div class="drow"><span class="dico">🕑</span><div><b>${d.weekday}, ${d.day} ${d.mon} at ${d.time}</b><div class="dsub">Ends at ${endT}</div></div></div>
        ${ev.location?`<div class="drow"><span class="dico">📍</span><div style="flex:1;min-width:0"><b>${esc(ev.location)}</b></div>${maps?`<a class="dir" href="${maps}" target="_blank" title="Directions">➤</a>`:''}</div>`:''}
      </div>
      ${ev.notes?`<div class="detail-notes">📝 ${esc(ev.notes)}</div>`:''}
      <div id="coachNoteBox"></div>
      ${kidLines?`<div class="detail-kids">${kidLines}</div>`:''}
      <button class="btn ghost" id="detailCalBtn">📅 Add to calendar</button>
    </div>
    <div class="section-title">Who's coming</div>
    <div id="sessionRoster"></div>
    <div id="coachRemind"></div>`;
  $('#detailCalBtn').addEventListener('click', () => addToCalendar(ev));
  $$('#sessionDetail .kid-status').forEach(sel => sel.addEventListener('change', () => saveKid(sel.closest('.kid-line'))));
  $$('#sessionDetail .kid-note').forEach(inp => inp.addEventListener('change', () => saveKid(inp.closest('.kid-line'))));
  renderRoster(rows, ev);
  if (LS.pass()) {
    renderCoachRemind(ev, rows);
    try { renderCoachNote(ev.id, (await RPC('get_coach_note', { p_passcode: LS.pass(), p_event: ev.id })) || ''); } catch (e) {}
  }
}

// yellow "Private notes for coaches" box (coach-only, like HEJA)
function renderCoachNote(evId, note){
  const box = $('#coachNoteBox'); if (!box) return;
  box.innerHTML = `<div class="coach-note">
      <div class="cn-head"><b>Private notes for coaches</b><a id="cnEdit">Edit</a></div>
      <div class="cn-body">${note ? esc(note) : 'Tap Edit to leave a note for this activity'}</div>
    </div>`;
  $('#cnEdit').addEventListener('click', () => {
    box.innerHTML = `<div class="coach-note">
        <div class="cn-head"><b>Private notes for coaches</b></div>
        <textarea id="cnText" placeholder="Only coaches see this…">${esc(note)}</textarea>
        <button class="btn small" id="cnSave">Save note</button>
      </div>`;
    $('#cnSave').addEventListener('click', async () => {
      const v = $('#cnText').value.trim();
      try { await RPC('admin_set_coach_note', { p_passcode: LS.pass(), p_event: evId, p_note: v });
        toast('Note saved'); renderCoachNote(evId, v);
      } catch (e) { toast(e.message); }
    });
  });
}

// when the daily automatic reminder next fires (17:00 UTC cron)
function nextReminderText(){
  const n = new Date();
  const next = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 17, 0, 0));
  if (next <= n) next.setUTCDate(next.getUTCDate() + 1);
  return next.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
}

function renderRoster(rows, ev){
  const total = rows.length;
  const groups = [['going','Going','var(--going)','✓'],['maybe','Maybe','var(--maybe)','?'],['out','Not going','var(--out)','✕'],[null,'Unanswered','#c4cad4','?']];
  const av = (r,st) => `<span class="rost-av">${avatarHTML(r.name,r.photo_url)}<span class="rost-badge ${st||'un'}">${st==='going'?'✓':st==='out'?'✕':st==='maybe'?'?':'?'}</span></span>`;
  const row = (r,st) => `<div class="rost-row">
      ${av(r,st)}
      <div class="rost-main">
        ${r.shirt_no?`<span class="num-chip">#${r.shirt_no}</span>`:''}
        <div class="rost-name">${esc(r.name)}</div>
        ${r.note?`<div class="note-bubble">✏️ ${esc(r.note)}</div>`:''}
      </div>
    </div>`;
  $('#sessionRoster').innerHTML = groups.map(([st,label,col,ic]) => {
    const arr = rows.filter(r => (r.status||null) === st);
    if (!arr.length) return '';
    const unanswered = st === null;
    return `<div class="card rost-sec">
      <div class="rost-sec-head"><span class="rh-ico" style="background:${col}">${ic}</span><span>${label}</span></div>
      ${(unanswered && LS.pass()) ? `<div class="remind-row"><span>Next automatic reminder:<br><b>${nextReminderText()}</b></span><button class="btn-dark" id="remindNowBtn">Remind now</button></div>` : ''}
      <div class="rost-sub">PLAYERS ${arr.length}/${total}</div>
      ${arr.map(r => row(r,st)).join('')}
    </div>`;
  }).join('') || '<div class="muted card">No players for this session.</div>';
  const rb = $('#remindNowBtn');
  if (rb && ev) rb.addEventListener('click', () => sendReminderTo(ev.id, rows.filter(r=>!r.status).map(r=>r.player_id), 'push', rb));
}

// coach-only: pick who to remind (non-responders pre-ticked), send by push or email
function renderCoachRemind(ev, rows){
  const status = s => s==='going'?'Going':s==='maybe'?'Maybe':s==='out'?"Can't":'No reply';
  const items = rows.map(r => `<label class="chk"><input type="checkbox" class="rmd" value="${r.player_id}" ${r.status?'':'checked'}>
      ${esc(r.name)} <span class="muted" style="font-size:12px">(${status(r.status)})</span></label>`).join('');
  $('#coachRemind').innerHTML = `<div class="section-title">Or choose exactly who / send email</div>
    <div class="card">
      <p class="muted" style="margin:0 0 9px">Everyone who hasn't replied is ticked. Untick anyone you don't want, then send.</p>
      <div class="invite-list" id="remindList">${items || '<div class="muted">No players for this session.</div>'}</div>
      <div class="row" style="margin-top:14px">
        <button class="btn" id="sendPushBtn">🔔 Send push</button>
        <button class="btn ghost" id="sendEmailBtn">📧 Send email</button>
      </div>
    </div>`;
  $('#sendPushBtn').addEventListener('click', e => sendReminder(ev.id, 'push', e.target));
  $('#sendEmailBtn').addEventListener('click', e => sendReminder(ev.id, 'email', e.target));
}

// shared sender used by both "Remind now" and the custom (pick-people) card
async function sendReminderTo(eventId, ids, channel, btn){
  if (!ids || !ids.length) { toast('Everyone has already replied 🎉'); return; }
  const label = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const r = await fetch(`${FUNCTIONS}/send-reminders`, { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ passcode: LS.pass(), event_id: eventId, player_ids: ids, channel }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('failed');
    if (channel === 'push') toast(j.sent ? `🔔 Push sent to ${j.sent} ${j.sent===1?'parent':'parents'}` : "No one selected has notifications turned on yet");
    else toast(j.emailed ? `📧 Email sent to ${j.emailed} ${j.emailed===1?'parent':'parents'}` : 'No selected parents have an email saved');
  } catch (e) { toast('Could not send reminder'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

async function sendReminder(eventId, channel, btn){
  const ids = $$('#remindList .rmd:checked').map(c => c.value);
  if (!ids.length) { toast('Tick at least one person'); return; }
  sendReminderTo(eventId, ids, channel, btn);
}

// ============================================================
//  ACCOUNT / FAMILY
// ============================================================
function showAccount(){
  $$('nav.tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === 'you'));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-you'));
  loadAccount();
}

const POSITIONS = ['Goalkeeper','Defender','Midfielder','Forward'];
let photoForPlayer = null;
async function loadAccount(){
  try {
    const info = (await RPC('get_account', { p_code:LS.code(), p_account:LS.acct() }))[0] || {};
    $('#setName').value = info.name || LS.name() || '';
    $('#setEmail').value = info.email || '';
    $('#setPhone').value = info.phone || '';
  } catch (e) { $('#setErr').textContent = e.message; }

  const box = $('#childrenAdmin');
  try {
    const kids = await RPC('get_my_players', { p_code:LS.code(), p_account:LS.acct() });
    MYPLAYERS = kids || [];
    box.innerHTML = MYPLAYERS.length ? MYPLAYERS.map(k => `<div class="card child-card">
        <span class="child-av" data-player="${k.id}" title="Change photo">${avatarHTML(k.name,k.photo_url,'')}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700">${esc(k.name)}</div>
          <div class="row" style="align-items:center">
            <select class="pos-sel" data-player="${k.id}">
              <option value="">Position…</option>
              ${POSITIONS.map(p=>`<option ${k.pos===p?'selected':''}>${p}</option>`).join('')}
            </select>
            <input type="number" class="num-input" data-player="${k.id}" value="${k.shirt_no||''}" placeholder="No." min="1" max="99">
          </div>
          <div class="muted" style="font-size:12px;margin-top:3px">Tap photo to ${k.photo_url?'change':'add a picture'}</div>
        </div>
      </div>`).join('')
      : '<div class="muted card">No children added yet.</div>';
    $$('#childrenAdmin .child-av').forEach(s => s.addEventListener('click', () => {
      photoForPlayer = s.dataset.player; $('#childPhotoInput').click();
    }));
    $$('#childrenAdmin .pos-sel').forEach(sel => sel.addEventListener('change', async () => {
      try { await RPC('set_player_position', { p_code:LS.code(), p_player:sel.dataset.player, p_position:sel.value });
        const pl = MYPLAYERS.find(p=>p.id===sel.dataset.player); if (pl) pl.pos = sel.value; toast('Position saved');
      } catch (e) { toast(e.message); }
    }));
    $$('#childrenAdmin .num-input').forEach(inp => inp.addEventListener('change', async () => {
      const n = parseInt(inp.value) || null;
      try { await RPC('set_player_number', { p_code:LS.code(), p_player:inp.dataset.player, p_number:n });
        const pl = MYPLAYERS.find(p=>p.id===inp.dataset.player); if (pl) pl.shirt_no = n; toast('Shirt number saved');
      } catch (e) { toast(e.message); }
    }));
  } catch (e) { box.innerHTML = `<div class="err card">${esc(e.message)}</div>`; }
}

$('#saveAcctBtn').addEventListener('click', async () => {
  const name=$('#setName').value.trim(), email=$('#setEmail').value.trim(), phone=$('#setPhone').value.trim();
  const err=$('#setErr'); err.textContent='';
  if (!name) { err.textContent='Enter your name.'; return; }
  try {
    await RPC('update_account', { p_code:LS.code(), p_account:LS.acct(), p_name:name, p_email:email, p_phone:phone });
    LS.set('name', name); renderWho(); toast('Details saved');
  } catch (e) { err.textContent = e.message; }
});

$('#childPhotoInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file || !photoForPlayer) return;
  try {
    const blob = await compressImage(file);
    const url = await uploadAvatar(photoForPlayer, blob);
    await RPC('set_player_photo', { p_code:LS.code(), p_player:photoForPlayer, p_url:url });
    toast('Photo updated'); loadAccount(); loadSchedule();
  } catch (err) { toast(err.message); } finally { e.target.value=''; photoForPlayer=null; }
});

$('#addChildBtn').addEventListener('click', async () => {
  const name = $('#newChildName').value.trim();
  const err = $('#addChildErr'); err.textContent='';
  if (!name) { err.textContent='Enter the child\'s name.'; return; }
  try {
    await RPC('add_player', { p_code:LS.code(), p_account:LS.acct(), p_name:name });
    $('#newChildName').value=''; toast('Child added'); loadAccount(); loadSchedule();
  } catch (e) { err.textContent = e.message; }
});

$('#logoutBtn').addEventListener('click', () => {
  if (confirm('Log out on this device?')) { LS.clear(); location.reload(); }
});

// ============================================================
//  NEWS
// ============================================================
async function loadNews(){
  const list = $('#newsList');
  list.innerHTML = '<div class="muted center" style="padding:30px">Loading…</div>';
  try {
    const ann = await RPC('get_announcements', { p_code: LS.code() });
    if (!ann || !ann.length){ list.innerHTML = `<div class="empty"><div class="big">📣</div><div class="lead">No announcements yet</div>Updates from your coach will appear here.</div>`; return; }
    list.innerHTML = ann.map(a => {
      const d = new Date(a.created_at).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
      return `<div class="card ann">${a.title?`<h3>${esc(a.title)}</h3>`:''}<div class="body">${esc(a.body)}</div><div class="when">${d}</div></div>`;
    }).join('');
  } catch (e) { list.innerHTML = `<div class="empty"><div class="big">⚠️</div>${esc(e.message)}</div>`; }
}

// ============================================================
//  COACH
// ============================================================
const ALL_KINDS = [['training','Training'],['match','Matches'],['tournament','Tournaments'],['social','Socials']];
let coachPlayers = [];
async function loadCoachPlayers(force){
  if (coachPlayers.length && !force) return coachPlayers;
  coachPlayers = (await RPC('admin_list_players', { p_passcode: LS.pass() })) || [];
  return coachPlayers;
}

$('#coachLoginBtn').addEventListener('click', async () => {
  const pass = $('#coachPass').value.trim(); const err = $('#coachErr'); err.textContent='';
  try { const ok = await RPC('check_admin', { p_passcode: pass });
    if (!ok) { err.textContent='Wrong passcode.'; return; }
    LS.set('pass', pass); showCoachPanel();
  } catch (e) { err.textContent = e.message; }
});
$('#coachLogout').addEventListener('click', () => {
  localStorage.removeItem('th_pass'); coachPlayers=[];
  $('#coachPanel').classList.add('hide'); $('#coachGate').classList.remove('hide'); $('#coachPass').value='';
});
$$('#coachPanel .subnav button').forEach(b => b.addEventListener('click', () => {
  const s = b.dataset.sub;
  $$('#coachPanel .subnav button').forEach(x => x.classList.toggle('active', x===b));
  $$('#coachPanel .subview').forEach(v => v.classList.toggle('active', v.id==='sub-'+s));
  if (s==='manage') loadCoachEvents();
  if (s==='players') loadPlayersAdmin();
  if (s==='stats') loadStats();
}));

function showCoachPanel(){
  $('#coachGate').classList.add('hide'); $('#coachPanel').classList.remove('hide');
  $('#addEvBtn').classList.remove('hide'); $('#statsChip').classList.remove('hide');
  if (!$('#evDate').value) $('#evDate').value = new Date(Date.now()+864e5).toISOString().slice(0,10);
  if (C.DEFAULT_LOCATION && !$('#evLoc').value) $('#evLoc').value = C.DEFAULT_LOCATION;
  const cur = $('#teamName').textContent;
  if (cur && cur!=='Team Hub' && !$('#teamNameInput').value) $('#teamNameInput').value = cur;
  loadCoachEvents();
}

$('#saveTeamNameBtn').addEventListener('click', async () => {
  const name = $('#teamNameInput').value.trim(); const err = $('#teamErr'); err.textContent='';
  if (!name) { err.textContent='Enter a team name.'; return; }
  try { await RPC('admin_set_team_name', { p_passcode:LS.pass(), p_name:name });
    $('#teamName').textContent=name; document.title=name; toast('Team name saved');
  } catch (e) { err.textContent = e.message; }
});

// team photo (banner on the Schedule)
let TEAMPHOTO = '';
function renderTeamBanner(url){
  TEAMPHOTO = url || '';
  ['#teamBanner','#teamBanner2'].forEach(sel => {
    const b = $(sel); if (!b) return;
    if (url) { b.innerHTML = `<img src="${esc(url)}" alt="Team photo">`; b.classList.remove('hide'); }
    else b.classList.add('hide');
  });
}

// ============================================================
//  TEAM page (photo + roster)
// ============================================================
// invite link with the team code built in
const inviteURL = () => location.origin + location.pathname + '?join=' + encodeURIComponent(LS.code() || '');
const inviteMsg = () => `Join ${$('#teamName').textContent} on our team app! ⚽ Tap to sign up: ${inviteURL()}`;
$('#waShareBtn').addEventListener('click', () => {
  if (navigator.share) navigator.share({ text: inviteMsg() }).catch(() => {});
  else window.open('https://wa.me/?text=' + encodeURIComponent(inviteMsg()), '_blank');
});
$('#copyLinkBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(inviteURL()); toast('Invite link copied 📋'); }
  catch (e) { prompt('Copy this link:', inviteURL()); }
});

async function loadTeam(){
  $('#teamNameBig').textContent = $('#teamName').textContent;
  $('#inviteCode').textContent = LS.code() || '';
  renderTeamBanner(TEAMPHOTO);
  const box = $('#teamRoster');
  try {
    const ps = (await RPC('list_players_public', { p_code: LS.code() })) || [];
    $('#teamCount').textContent = `${ps.length} player${ps.length===1?'':'s'}`;
    box.innerHTML = ps.length ? `<div class="card">` + ps.map(p => `<div class="rost-row">
        <span class="rost-av">${avatarHTML(p.name,p.photo_url)}</span>
        ${p.shirt_no?`<span class="num-chip">#${p.shirt_no}</span>`:''}
        <span class="rost-name">${esc(p.name)}</span>
        ${p.pos?`<span class="rost-note">${esc(p.pos)}</span>`:''}
      </div>`).join('') + `</div>` : '<div class="muted card">No players yet — they appear as families join.</div>';
  } catch (e) { box.innerHTML = `<div class="err card">${esc(e.message)}</div>`; }
}
$('#teamPhotoBtn').addEventListener('click', () => $('#teamPhotoInput').click());
$('#teamPhotoInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const btn = $('#teamPhotoBtn'); const label = btn.textContent; btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    const blob = await compressImage(file, 1100);
    const url = await uploadAvatar('team', blob);
    await RPC('admin_set_team_photo', { p_passcode:LS.pass(), p_url:url });
    renderTeamBanner(url); toast('Team photo updated');
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; btn.textContent = label; e.target.value = ''; }
});

$('#evAudience').addEventListener('change', async () => {
  const invite = $('#evAudience').value==='invite';
  $('#evInviteList').classList.toggle('hide', !invite);
  if (invite) {
    const players = await loadCoachPlayers();
    $('#evInviteList').innerHTML = players.length
      ? players.map(p => `<label class="chk"><input type="checkbox" class="ev-invitee" value="${p.id}"> ${esc(p.name)}<span class="muted" style="font-size:12px"> (${esc(p.parent_name)})</span></label>`).join('')
      : '<div class="muted">No players have joined yet.</div>';
  }
});

// build the "repeat until" date dropdown from the chosen date (weekly steps)
function buildUntilOptions(){
  const date = $('#evDate').value, sel = $('#evUntil');
  if (!date) { sel.innerHTML = '<option value="">Pick a date first</option>'; return; }
  const base = new Date(date + 'T00:00:00'); let html = '';
  for (let k = 1; k <= 26; k++){
    const d = new Date(base.getTime()); d.setDate(d.getDate() + k*7);
    const label = d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
    html += `<option value="${k+1}">${label}  ·  ${k+1} sessions</option>`;
  }
  sel.innerHTML = html;
}
$('#evRepeat').addEventListener('change', () => {
  const weekly = $('#evRepeat').value === 'weekly';
  $('#evUntilWrap').classList.toggle('hide', !weekly);
  if (weekly) buildUntilOptions();
});
$('#evDate').addEventListener('change', () => { if ($('#evRepeat').value === 'weekly') buildUntilOptions(); });

$('#addEventBtn').addEventListener('click', async () => {
  const err = $('#evErr'); err.textContent='';
  const title=$('#evTitle').value.trim(), date=$('#evDate').value, time=$('#evTime').value;
  if (!title || !date || !time) { err.textContent='Title, date and time are required.'; return; }
  const starts = new Date(`${date}T${time}`).toISOString();
  const inviteOnly = $('#evAudience').value==='invite';
  const invitees = inviteOnly ? $$('#evInviteList .ev-invitee:checked').map(c=>c.value) : null;
  if (inviteOnly && (!invitees||!invitees.length)) { err.textContent='Pick at least one player, or choose "Everyone".'; return; }
  const weekly = $('#evRepeat').value === 'weekly';
  const occurrences = weekly ? (parseInt($('#evUntil').value) || 1) : 1;
  const common = { p_passcode:LS.pass(), p_title:title, p_kind:$('#evKind').value,
    p_starts_at:starts, p_duration:parseInt($('#evDur').value)||60, p_location:$('#evLoc').value,
    p_notes:$('#evNotes').value, p_invite_only:inviteOnly, p_invitees:invitees };
  try {
    if (weekly) await RPC('admin_add_event_series', { ...common, p_occurrences:occurrences });
    else await RPC('admin_add_event', common);
    $('#evTitle').value=''; $('#evNotes').value='';
    $('#evAudience').value='all'; $('#evInviteList').classList.add('hide'); $('#evInviteList').innerHTML='';
    $('#evRepeat').value='none'; $('#evUntilWrap').classList.add('hide');
    toast(weekly ? `Added ${occurrences} weekly sessions` : 'Event added'); loadCoachEvents();
  } catch (e) { err.textContent = e.message; }
});

$('#postAnnBtn').addEventListener('click', async () => {
  const err = $('#anErr'); err.textContent=''; const body = $('#anBody').value.trim();
  if (!body) { err.textContent='Write a message first.'; return; }
  try { await RPC('admin_post_announcement', { p_passcode:LS.pass(), p_title:$('#anTitle').value, p_body:body });
    $('#anTitle').value=''; $('#anBody').value=''; toast('Announcement posted');
  } catch (e) { err.textContent = e.message; }
});

$('#emailAnnBtn').addEventListener('click', async () => {
  const body = $('#anBody').value.trim(); const subject = $('#anTitle').value.trim() || 'Team update';
  try {
    const players = await loadCoachPlayers(true);
    const emails = [...new Set(players.map(p=>p.parent_email).filter(Boolean))];
    if (!emails.length) { toast('No parent emails on file yet'); return; }
    window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  } catch (e) { toast(e.message); }
});

async function loadCoachEvents(){
  const box = $('#coachEvents');
  try {
    const evs = (await RPC('admin_list_events', { p_passcode:LS.pass() })) || [];
    if (!evs.length) { box.innerHTML='<div class="muted">No events yet.</div>'; return; }
    const now = Date.now();
    box.innerHTML = evs.map(e => { const d=fmtDate(e.starts_at); const past=new Date(e.starts_at).getTime()<now;
      return `<div class="card ev-row"><div class="tap" data-open="${e.id}" style="flex:1;min-width:0;cursor:pointer">
        <div style="font-weight:700">${esc(e.title)} <span class="badge ${e.kind}">${e.kind}</span>${e.invite_only?' <span class="badge invite">invite</span>':''}</div>
        <div class="muted" style="font-size:13px">${d.full}, ${d.time}${past?' · past':''}</div>
        <div class="muted" style="font-size:13px">✅ ${e.going} · 🤔 ${e.maybe} · ❌ ${e.out_count}${e.invite_only?` · ${e.invited} invited`:''}</div>
        </div>
        <div class="ev-actions">
          ${past?'':`<button class="btn ghost small" data-remind="${e.id}">🔔 Remind</button>`}
          <button class="btn danger" data-del="${e.id}">Delete</button>
        </div></div>`;
    }).join('');
    const evObj = id => { const e = evs.find(x => x.id === id);
      return { id:e.id, title:e.title, kind:e.kind, starts_at:e.starts_at, duration_min:e.duration_min, location:e.location, notes:e.notes }; };
    $$('#coachEvents [data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this event? Its responses are removed too.')) return;
      try { await RPC('admin_delete_event', { p_passcode:LS.pass(), p_event:b.dataset.del }); toast('Deleted'); loadCoachEvents(); }
      catch (e) { toast(e.message); }
    }));
    $$('#coachEvents [data-remind]').forEach(b => b.addEventListener('click', () => showSession(evObj(b.dataset.remind))));
    $$('#coachEvents [data-open]').forEach(b => b.addEventListener('click', () => showSession(evObj(b.dataset.open))));
  } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

async function loadPlayersAdmin(){
  const box = $('#playersAdmin');
  try {
    const players = await loadCoachPlayers(true);
    if (!players.length) { box.innerHTML='<div class="muted">No players have joined yet.</div>'; return; }
    box.innerHTML = players.map(m => { const vk = m.visible_kinds || [];
      return `<div class="card"><div class="pa-head" data-contact="${m.id}" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">
        ${avatarHTML(m.name,m.photo_url)}<span style="font-weight:700">${esc(m.name)}</span>
        ${m.shirt_no?`<span class="num-chip">#${m.shirt_no}</span>`:''}
        ${m.pos?`<span class="pos-tag">${esc(m.pos)}</span>`:''}
        <span class="muted" style="font-size:12.5px">${esc(m.parent_name||'')}</span>
        <button class="btn danger" data-remove="${m.id}" data-name="${esc(m.name)}" style="margin-left:auto">Remove</button></div>
        <div class="contact-box hide" id="contact-${m.id}">
          <div class="contact-row">👤 <b>${esc(m.parent_name||'—')}</b> <span class="muted">(parent/guardian)</span></div>
          <div class="contact-row">📧 ${m.parent_email?`<a href="mailto:${esc(m.parent_email)}">${esc(m.parent_email)}</a>`:'<span class="muted">No email saved</span>'}</div>
          <div class="contact-row">📞 ${m.parent_phone?`<a href="tel:${esc(m.parent_phone)}">${esc(m.parent_phone)}</a>`:'<span class="muted">No phone saved</span>'}</div>
        </div>
        <div class="kinds">${ALL_KINDS.map(([k,l])=>`<label class="chk"><input type="checkbox" class="pa" data-m="${m.id}" value="${k}" ${vk.includes(k)?'checked':''}> ${l}</label>`).join('')}</div>
      </div>`;
    }).join('');
    $$('#playersAdmin .pa-head').forEach(h => h.addEventListener('click', e => {
      if (e.target.closest('[data-remove]')) return;   // don't toggle when tapping Remove
      $('#contact-' + h.dataset.contact).classList.toggle('hide');
    }));
    $$('#playersAdmin .pa').forEach(c => c.addEventListener('change', async () => {
      const mid = c.dataset.m;
      const kinds = $$(`#playersAdmin .pa[data-m="${mid}"]:checked`).map(x=>x.value);
      try { await RPC('admin_set_player_access', { p_passcode:LS.pass(), p_player:mid, p_kinds:kinds });
        const cm = coachPlayers.find(p=>p.id===mid); if (cm) cm.visible_kinds = kinds; toast('Saved');
      } catch (e) { toast(e.message); c.checked = !c.checked; }
    }));
    $$('#playersAdmin [data-remove]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`Remove ${b.dataset.name} from the team? This deletes their availability history.`)) return;
      try { await RPC('admin_remove_player', { p_passcode:LS.pass(), p_player:b.dataset.remove });
        toast('Player removed'); loadPlayersAdmin(true);
      } catch (e) { toast(e.message); }
    }));
  } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

$('#remindBtn').addEventListener('click', remindFlow);
async function remindFlow(){
  try {
    const evs = (await RPC('admin_list_events', { p_passcode:LS.pass() })) || [];
    const up = evs.filter(e=>new Date(e.starts_at).getTime()>Date.now()).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
    if (!up.length) { toast('No upcoming events to remind about'); return; }
    const ev = up[0];
    const people = await RPC('admin_non_responders', { p_passcode:LS.pass(), p_event:ev.id });
    if (!people || !people.length) { toast('Everyone has replied 🎉'); return; }
    const emails = [...new Set(people.map(p=>p.email).filter(Boolean))];
    const d = fmtDate(ev.starts_at);
    const subject = `Can your child make it? ${ev.title} — ${d.full}`;
    const body = `Hi,\n\nWe haven't heard about ${people.map(p=>p.child).join(', ')} for "${ev.title}" on ${d.full} at ${d.time}.\n`
      + (ev.location?`Location: ${ev.location}\n`:'') + `\nPlease open the team app and set their availability.\n\nThanks!`;
    if (!emails.length) { alert('No parent emails on file for: ' + people.map(p=>p.child).join(', ')); return; }
    window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  } catch (e) { toast(e.message); }
}

async function loadStats(){
  const box = $('#statsBox');
  try {
    const rows = (await RPC('admin_player_stats', { p_passcode:LS.pass() })) || [];
    if (!rows.length) { box.innerHTML='<div class="muted">No past events yet — stats appear once sessions have happened.</div>'; return; }
    const KINDS = [['match','Games','match'],['training','Practices','training'],['tournament','Tournaments','tournament'],['social','Other','social']];
    const byP = {};
    rows.forEach(r => { const m = byP[r.player_id] ||= { name:r.name, photo:r.photo_url, kinds:{}, el:0, at:0 };
      m.kinds[r.kind]={el:r.eligible,at:r.attended}; m.el+=r.eligible; m.at+=r.attended; });
    const pct = (a,e) => e ? Math.round(a/e*100) : 0;
    const bar = (p,cls) => `<div class="stat-bar"><div class="stat-fill ${cls}" style="width:${p}%"></div></div>`;
    const members = Object.values(byP).sort((a,b) => (b.el?b.at/b.el:0) - (a.el?a.at/a.el:0));

    // team summary
    let sumPct=0, n=0; const teamKind={};
    members.forEach(m => { if (m.el){ sumPct += m.at/m.el; n++; } });
    KINDS.forEach(([k]) => { let e=0,a=0; members.forEach(m=>{ const o=m.kinds[k]; if(o){e+=o.el;a+=o.at;} }); teamKind[k]={el:e,at:a}; });
    const avg = n ? Math.round(sumPct/n*100) : 0;

    box.innerHTML = `<div class="card stat-summary">
        <div class="stat-big">${avg}%</div>
        <div class="stat-cap">Average player attendance</div>
        ${bar(avg,'main')}
        <div class="stat-cols">${KINDS.map(([k,l]) => `<div><div class="stat-col-n">${pct(teamKind[k].at,teamKind[k].el)}%</div><div class="stat-col-l">${l}</div></div>`).join('')}</div>
      </div>
      <div class="section-title" style="margin-left:2px">Player attendance</div>`
      + members.map(m => `<div class="card stat-player">
        <div class="stat-head">${avatarHTML(m.name,m.photo)}<span class="stat-name">${esc(m.name)}</span><span class="stat-pct">${pct(m.at,m.el)}%</span></div>
        <div class="stat-grid">${KINDS.map(([k,l,kc]) => { const o=m.kinds[k]||{el:0,at:0}; const p=pct(o.at,o.el);
          return `<div class="stat-cell"><div class="stat-cell-top"><span>${l}</span><b>${p}%</b></div>${bar(p,'kind-'+kc)}</div>`; }).join('')}</div>
      </div>`).join('');
  } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

// ============================================================
//  PUSH NOTIFICATIONS
// ============================================================
let swReg = null;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function urlB64ToUint8(b64){ const pad='='.repeat((4-b64.length%4)%4); const base=(b64+pad).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base); const a=new Uint8Array(raw.length); for (let i=0;i<raw.length;i++) a[i]=raw.charCodeAt(i); return a; }
function setPushBanner(mode){
  const banner=$('#pushBanner'), text=$('#pushBannerText'), btn=$('#pushBtn');
  banner.classList.remove('hide','on'); btn.classList.remove('hide');
  if (mode==='on'){ banner.classList.add('on'); text.textContent='🔔 Phone reminders are on'; btn.classList.add('hide'); }
  else if (mode==='offer'){ text.textContent="🔔 Get a reminder on your phone to set your child's availability"; btn.textContent='Turn on'; }
  else if (mode==='ios'){ text.textContent='🔔 For phone reminders: tap Share → "Add to Home Screen", then open it from there.'; btn.classList.add('hide'); }
  else banner.classList.add('hide');
}
async function initPush(){
  if (!C.VAPID_PUBLIC || C.VAPID_PUBLIC.includes('YOUR_')) { setPushBanner('hide'); return; }
  if (!pushSupported()) {
    const iOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone=window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    setPushBanner(iOS && !standalone ? 'ios' : 'hide'); return;
  }
  try { swReg = await navigator.serviceWorker.register('sw.js'); } catch(e){ setPushBanner('hide'); return; }
  const sub = await swReg.pushManager.getSubscription();
  if (sub) setPushBanner('on'); else if (Notification.permission==='denied') setPushBanner('hide'); else setPushBanner('offer');
}
$('#pushBtn').addEventListener('click', async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm!=='granted') { toast('Notifications not allowed'); return; }
    const sub = await swReg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlB64ToUint8(C.VAPID_PUBLIC) });
    const j = sub.toJSON();
    await RPC('save_push_subscription', { p_code:LS.code(), p_account:LS.acct(), p_endpoint:sub.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth });
    setPushBanner('on'); toast('Reminders on 🔔');
  } catch (e) { toast('Could not enable: ' + e.message); }
});

// ============================================================
//  BOOT
// ============================================================
async function boot(){
  // make sure the saved login still exists (the account may have been removed/reset);
  // if it's gone, clear the stale session and show the login instead of erroring later
  try {
    const acc = await RPC('get_account', { p_code: LS.code(), p_account: LS.acct() });
    if (!Array.isArray(acc) || !acc.length) { LS.clear(); showJoin(); return; }
  } catch (e) { /* network blip — don't lock the user out, carry on */ }
  renderWho();
  initPush();
  try {
    const info = (await RPC('get_team_info', { p_code: LS.code() }))[0];
    if (info) { if (info.name) { $('#teamName').textContent=info.name; document.title=info.name; } renderTeamBanner(info.photo); }
  } catch {}
  if (LS.pass()) showCoachPanel();
  await loadSchedule();
}

if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(()=>{}); }
restoreSession();

// invite links (?join=CODE) carry the team code, so parents who get the
// link on WhatsApp can sign up without typing anything
const joinParam = new URLSearchParams(location.search).get('join');
if (joinParam) {
  setCookie('th_code', joinParam.trim().toUpperCase());
  history.replaceState(null, '', location.pathname);   // tidy the address bar
}

if (!C.SUPABASE_URL || C.SUPABASE_URL.includes('YOUR_PROJECT')) {
  $('#scheduleList').innerHTML = `<div class="empty"><div class="big">🔧</div>Not configured yet.</div>`;
} else if (LS.code() && LS.acct()) {
  boot();
} else {
  showJoin();
}
