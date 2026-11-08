// Full Cycle Plus — Work Order Creation page logic.
// Loaded by index.html after config.js.
// This page is a verbatim port of the "Create a Work Order" tab of the
// four-tab Full Cycle Plus Work Orders app (client/src/App.tsx, CreateView
// + DayScheduleNote in ~/workspace/ts-spaces/full-cycle-plus-work-orders-app).
// Same fields, same order, same labels and placeholders, same validation,
// same city -> ZIP autofill, same submit button, same day-schedule note.
// Differences from the tab, and only these: the page has no tab bar (it IS
// the Create tab), and on success it shows a short confirmation instead of
// opening the work-order detail (a public page has no detail view).
// No code is issued from this page — exactly like the tab, it passes empty
// code inputs, and the server creates the job unassigned with no code; a
// code is generated later from the work order detail / admin side.
// Pure functions are exposed on window.FCPCreate so they can be tested
// headlessly; DOM wiring only runs when `document` exists.
(function (global) {
  'use strict';

  var CFG = (global.FCP_CONFIG || {});

  function trim(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }

  // --- City -> ZIP autofill, copied verbatim from the app's Create tab ----
  // Typing a known city autofills the state (MI) and ZIP. Always editable.
  // Only overwrites the ZIP while it's empty or still holding the last
  // autofill — never stomps a ZIP typed by hand.
  var CITY_ZIP = {
    'waterford': '48329', 'oxford': '48371', 'auburn hills': '48326',
    'pontiac': '48341', 'lake orion': '48362', 'clarkston': '48346',
    'rochester': '48307', 'rochester hills': '48309', 'troy': '48083',
    'bloomfield hills': '48304', 'west bloomfield': '48324',
    'farmington hills': '48336', 'novi': '48375', 'holly': '48442',
    'ortonville': '48462', 'davisburg': '48350', 'white lake': '48383',
    'milford': '48380', 'highland': '48356', 'grand blanc': '48439',
    'fenton': '48430', 'lapeer': '48446', 'almont': '48003',
    'romeo': '48065', 'utica': '48317', 'shelby township': '48315',
    'sterling heights': '48310', 'royal oak': '48067', 'birmingham': '48009',
    'clawson': '48017', 'berkley': '48072', 'ferndale': '48220',
    'hazel park': '48030', 'madison heights': '48071', 'southfield': '48075',
    'livonia': '48150', 'plymouth': '48170', 'canton': '48187',
    'northville': '48167', 'brighton': '48116', 'howell': '48843',
    'fowlerville': '48836'
  };

  var ZIP_CITY = {};
  Object.keys(CITY_ZIP).forEach(function (c) {
    var z = CITY_ZIP[c];
    if (!ZIP_CITY[z]) ZIP_CITY[z] = c.replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  });
  // ZIP -> city name, or '' when the ZIP is not in the Michigan lookup.
  function zipToCity(zip) { return ZIP_CITY[trim(zip)] || ''; }

  // Returns { zip, state, autoZip } after a city change, given the current
  // zip and the last autofill value. Pure version of the tab's onCityChange.
  function cityChange(city, zip, autoZip) {
    var hit = CITY_ZIP[trim(city).toLowerCase()];
    if (!hit) return { zip: zip, state: null, autoZip: autoZip };
    var nextZip = zip;
    var nextAuto = autoZip;
    if (!zip || zip === autoZip) { nextZip = hit; nextAuto = hit; }
    return { zip: nextZip, state: 'MI', autoZip: nextAuto };
  }

  // --- "9:00 AM" -> minutes since midnight, or null. Verbatim from the app.
  function parseTimeToMinutes(t) {
    var m = trim(t).match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!m) return null;
    var h = parseInt(m[1] || '', 10);
    var mins = m[2] ? parseInt(m[2], 10) : 0;
    var ap = (m[3] || '').toUpperCase();
    if (isNaN(h) || isNaN(mins)) return null;
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + mins;
  }

  // A 2-hour block ("8:00-10:00 AM") -> { start, end } minutes since
  // midnight; a plain time ("9:00 AM") -> { start, end: start }.
  function parseTimeBlock(t) {
    if (!trim(t)) return null;
    var parts = String(t).split('-');
    /* The AM/PM designator sits on the end half ("2:00-4:00 PM") — the
       start half inherits it, or the end inherits the start's. */
    var apOf = function (x) { var m = String(x).match(/([AP]M)\s*$/i); return m ? m[1].toUpperCase() : ''; };
    var startPart = parts[0], endPart = parts.length > 1 ? parts[1] : '';
    if (!apOf(startPart) && apOf(endPart)) startPart = startPart + ' ' + apOf(endPart);
    if (!apOf(endPart) && apOf(startPart)) endPart = endPart + ' ' + apOf(startPart);
    var start = parseTimeToMinutes(startPart);
    if (start === null) return null;
    var end = endPart ? parseTimeToMinutes(endPart) : null;
    return { start: start, end: (end !== null && end > start) ? end : start + 120 };
  }

  // ISO timestamp from the backend's CalendarApp events -> "9:00 AM".
  function isoToTimeText(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var h = d.getHours();
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    var mm = d.getMinutes();
    return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ap;
  }

  // --- Appointment block display (James, Nov 7, 2026) ----------------------
  // The customer books a 2-hour window, not a sharp arrival time, so
  // everywhere an appointment shows, display the block: start to
  // start+2h, e.g. "9:00–11:00 AM". Stored times are block starts
  // (8, 10, 12, 2, 4, 6); a time off a block boundary still shows
  // start–start+2h — never invent a different block. A value that is
  // already a block ("8:00-10:00 AM") renders as-is, normalised.
  function minutesToTimeText(mins) {
    var h = Math.floor(mins / 60) % 24;
    var m = mins % 60;
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  function displayAppointmentBlock(t) {
    var s = trim(t);
    if (!s) return '';
    var blk = parseTimeBlock(s);
    if (!blk) return s;
    var startTxt = minutesToTimeText(blk.start);
    var endTxt = minutesToTimeText(blk.end);
    if (startTxt.slice(-2) === endTxt.slice(-2)) return startTxt.slice(0, -3) + '–' + endTxt;
    return startTxt + '–' + endTxt;
  }
  // "2026-11-07" (or any parseable date) -> "Sat, Nov 7, 2026".
  // Never the raw Date string. Unparseable input passes through.
  function formatApptDate(d) {
    var s = trim(d);
    if (!s) return '';
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    var dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
    if (isNaN(dt.getTime())) return s;
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  // Full appointment display: "Sat, Nov 7, 2026 9:00–11:00 AM".
  // Either half may be missing; '' when both are.
  function displayAppointment(dateText, timeText) {
    var d = formatApptDate(dateText);
    var t = displayAppointmentBlock(timeText);
    return [d, t].filter(function (x) { return x; }).join(' ');
  }

  // --- Validation ----------------------------------------------------------
  // Mandatory: first name, last name, phone, street address, city, state,
  // zip. Email is optional. Returns the first failing message, or ''.
  function validateForm(d) {
    if (!trim(d.firstName) || !trim(d.lastName)) return 'First and last name are required.';
    if (!trim(d.phone)) return 'Phone number is required.';
    if (!trim(d.street)) return 'Street address is required.';
    if (!trim(d.city)) return 'City is required.';
    if (!trim(d.state)) return 'State is required.';
    if (!trim(d.zip)) return 'Zip is required.';
    return '';
  }

  // --- Preferred contact method (v23: Text / Email tiles, one pick) ---
  // Two clickable tiles; the selected tile is orange, the other fades to
  // green. Tapping a tile picks that method. Default is Text.
  function setPrefTiles(v) {
    if (typeof document === 'undefined') return;
    var e = document.getElementById('preferred-contact-email');
    var t = document.getElementById('preferred-contact-text');
    if (!e || !t) return;
    if (v === 'Email') { e.className = 'contact-tile sel'; t.className = 'contact-tile'; }
    else { t.className = 'contact-tile sel'; e.className = 'contact-tile'; }
  }
  function preferredContactFromDom() {
    if (typeof document === 'undefined') return 'Text';
    var e = document.getElementById('preferred-contact-email');
    if (e && e.className && e.className.indexOf('sel') >= 0) return 'Email';
    return 'Text';
  }
  function wirePrefTiles() {
    if (typeof document === 'undefined') return;
    var e = document.getElementById('preferred-contact-email');
    var t = document.getElementById('preferred-contact-text');
    if (e) e.addEventListener('click', function () { setPrefTiles('Email'); });
    if (t) t.addEventListener('click', function () { setPrefTiles('Text'); });
  }

  // --- Payload for the backend createWorkOrder action ----------------------
  // Field names match the app's api.createWorkOrder call exactly, plus
  // `action` for the Apps Script backend (doPost dispatches on it).
  // Code inputs are empty, exactly like the tab: no code is issued from
  // this page — the job is created unassigned with no code.
  function buildPayload(d) {
    return {
      action: 'createWorkOrder',
      firstName: trim(d.firstName),
      lastName: trim(d.lastName),
      phone: trim(d.phone),
      email: trim(d.email),
      preferredContact: d.preferredContact === 'Email' ? 'Email' : 'Text',
      street: trim(d.street),
      city: trim(d.city),
      state: trim(d.state) || CFG.DEFAULT_STATE || 'MI',
      zip: trim(d.zip),
      accessNotes: trim(d.accessNotes),
      problem: trim(d.problem),
      applianceBrand: trim(d.applianceBrand),
      applianceModel: trim(d.applianceModel),
      applianceSerial: '', /* v22: serial no longer collected on create; stored serials on old records are untouched */
      scheduledDate: trim(d.scheduledDate),
      scheduledTime: trim(d.scheduledTime),
      codeSubtype: '',
      codeSource: '',
      codePropertyType: '',
      codePriority: ''
    };
  }

  // --- localStorage (demo mode) ---------------------------------------------
  function loadSaved() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(CFG.LOCAL_STORAGE_KEY || 'fcp_customer_work_orders');
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveLocal(record) {
    var all = loadSaved();
    all.push(record);
    try {
      global.localStorage.setItem(CFG.LOCAL_STORAGE_KEY || 'fcp_customer_work_orders', JSON.stringify(all));
    } catch (e) { /* storage unavailable — confirmation still shows */ }
    return all.length;
  }

  // --- Day schedule note, verbatim logic from the tab's DayScheduleNote ----
  // Takes the backend's getDaySchedule response (Apps Script shape:
  // workOrders[] with scheduledTime/displayId/customerName/problem, and
  // calendarEvents[] with ISO start/end, calendarSource 'host-side' or
  // 'CalendarApp') plus the picked time, and returns the HTML the tab
  // would show. Returns '' when there is nothing to show.
  var TIME_BLOCKS = ["8:00-10:00 AM", "10:00 AM-12:00 PM", "12:00-2:00 PM", "2:00-4:00 PM", "4:00-6:00 PM", "6:00-8:00 PM"];
  // --- Availability (PRIVACY — James, standing Nov 7, 2026) -----------------
  // NO personal calendar or personal information ever shows up in the Plus
  // work-order system. A scheduled date is an anonymous block of time:
  // availability comes only from the WORK calendar + booked work orders,
  // shown as anonymous free/busy 2-hour blocks — no titles, no details,
  // no names. The backend may return job/event details; this page NEVER
  // renders them. The personal calendar never collides with the business
  // calendar: only the WORK calendar (WO_CALENDAR_ID) feeds this.
  // Pure busy-block map for a getDaySchedule response: which 2-hour blocks
  // are taken by booked work orders or WORK-calendar events. Free/Busy
  // ticker (James, standing Nov 7, 2026): an event marked Free never
  // blocks a slot. No titles, details or names are used here.
  function computeBusyBlocks(res) {
    var jobs = (res && res.workOrders) || [];
    var events = ((res && res.calendarEvents) || []).map(function (ev) {
      return {
        startText: ev.startText || isoToTimeText(ev.start),
        endText: ev.endText || isoToTimeText(ev.end),
        allDay: !!ev.allDay,
        free: !!ev.free
      };
    });
    var busyBlocks = {};
    TIME_BLOCKS.forEach(function (b) {
      var blk = parseTimeBlock(b);
      var busy = false;
      jobs.forEach(function (j) {
        var jt = parseTimeToMinutes(j.scheduledTime || '');
        if (jt !== null && jt >= blk.start && jt < blk.end) busy = true;
      });
      events.forEach(function (e) {
        if (e.free) return;
        if (e.allDay) { busy = true; return; }
        var s = parseTimeToMinutes(e.startText || '');
        if (s === null) return;
        var en = parseTimeToMinutes(e.endText || '');
        if (en !== null ? (s < blk.end && en > blk.start) : (s >= blk.start && s < blk.end)) busy = true;
      });
      busyBlocks[b] = busy;
    });
    return busyBlocks;
  }

  // Busy blocks are not selectable (James, Nov 7, 2026): disable the
  // time-select option for every busy block, and clear the pick if the
  // block just picked turned out busy. Free blocks stay selectable.
  function applyTimeOptions(res) {
    if (typeof document === 'undefined') return;
    var timeEl = document.getElementById('scheduled-time');
    if (!timeEl || !res || !res.ok) return;
    var busy = computeBusyBlocks(res);
    for (var i = 0; i < timeEl.options.length; i++) {
      var o = timeEl.options[i];
      if (!o.value) continue;
      o.disabled = !!busy[o.value];
    }
    if (timeEl.value && busy[timeEl.value]) timeEl.value = '';
  }

  function dayScheduleHtml(res, time) {
    if (!res || !res.ok) return '';
    var busyBlocks = computeBusyBlocks(res);
    var calendarConnected = res.calendarSource === 'CalendarApp' || res.calendarSource === 'Calendar (Advanced)';
    var anyBusy = TIME_BLOCKS.some(function (b) { return busyBlocks[b]; });
    var html = '';
    if (!anyBusy) {
      html += '<span class="ok">Nothing booked that day — all times are open.</span><br>';
    }
    html += '<div>' + TIME_BLOCKS.map(function (b) {
      return b + ' — ' + (busyBlocks[b] ? 'Busy' : 'Free');
    }).join('<br>') + '</div>';
    if (!calendarConnected) {
      html += '<div class="muted">(Work calendar couldn\'t be read just now — showing booked work orders only.)</div>';
    }
    var block = parseTimeBlock(time || '');
    if (trim(time) && block !== null) {
      if (busyBlocks[trim(time)]) {
        html += '<div class="clash">⚠ That time is already booked — pick another time.</div>';
      } else {
        html += '<div class="ok">✓ You\'re open at ' + displayAppointmentBlock(time) + '.</div>';
      }
    }
    return html;
  }

  function fetchDaySchedule(dateStr) {
    var url = trim(CFG.BACKEND_URL) + '?action=getDaySchedule&date=' + encodeURIComponent(dateStr || '');
    if (CFG.WO_API_KEY) url += '&apiKey=' + encodeURIComponent(CFG.WO_API_KEY);
    return global.fetch(url).then(function (r) { return r.json(); });
  }

  // --- Submit ---------------------------------------------------------------
  // Returns a Promise resolving to a confirmation object. In demo mode the
  // submission is saved to localStorage, marked not-sent, and NO work-order
  // number or code is invented — the backend issues the number when the job
  // is filed. In live mode it POSTs createWorkOrder to the backend; the
  // backend's own displayId / creationCode / agreementToken are used as
  // returned (creationCode is null here — no code is issued from this page).
  // The Appointment Confirmation contact message is auto-sent by the
  // backend right after the job is filed (v21): sendContactMessage for
  // appointment_confirmation, by the customer's preferred contact method.
  // Email flips to sent only after MailApp succeeds; a text comes back
  // ready_text with the exact SMS body — James sends it from his phone,
  // and it is never marked sent by the backend.
  function submitWorkOrder(d) {
    var err = validateForm(d);
    if (err) return Promise.resolve({ ok: false, error: err });
    var payload = buildPayload(d);

    if (!trim(CFG.BACKEND_URL)) {
      var record = { payload: payload, savedAt: new Date().toISOString(), sentToBackend: false };
      saveLocal(record);
      return Promise.resolve({
        ok: true, mode: 'demo', displayId: null, creationCode: null, workOrderCode: null,
        agreementToken: null, sentToBackend: false,
        confirmationMessage: 'queued — ready, not sent yet',
        record: record
      });
    }

    var body = Object.assign({}, payload);
    if (CFG.WO_API_KEY) body.apiKey = CFG.WO_API_KEY;
    return global.fetch(trim(CFG.BACKEND_URL), {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Backend returned an error.');
      var wo = res.workOrder || {};
      var result = {
        ok: true, mode: 'live',
        displayId: wo.displayId || wo.id || null,
        creationCode: wo.creationCode || wo.creation_code || null,
        workOrderCode: wo.workOrderCode || wo.work_order_code || null,
        proCode: wo.proCode || wo.pro_code || null,
        agreementToken: wo.agreementToken || wo.agreement_token || null,
        sentToBackend: true,
        confirmationMessage: 'queued — ready, not sent yet',
        sendStatus: null,
        record: wo
      };
      /* Code first: the confirmation must show the order by its code
         from the start — fill a missing code (re-read by lookup key)
         before the confirmation send/render below. */
      return fillMissingCode(result, result.displayId).then(function (filled) {
        result = filled;
        /* Auto-send the appointment confirmation now, by preferred contact.
           A failed send does NOT fail the filing — the row stays ready and
           the app's sendDueMessages sweep retries it. */
        var sendBody = { action: 'sendContactMessage', workOrderId: result.displayId, stage: 'appointment_confirmation' };
        if (CFG.WO_API_KEY) sendBody.apiKey = CFG.WO_API_KEY;
        return global.fetch(trim(CFG.BACKEND_URL), {
          method: 'POST', headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(sendBody)
        }).then(function (r2) { return r2.json(); }).then(function (sendRes) {
          result.sendStatus = sendRes && sendRes.status ? sendRes.status : null;
          if (sendRes && sendRes.status === 'sent') result.confirmationMessage = 'sent by email';
          else if (sendRes && sendRes.status === 'ready_text') result.confirmationMessage = 'text ready — James will send it from his phone';
          else if (sendRes && sendRes.status === 'pending_email') result.confirmationMessage = 'waiting for an email address';
          return result;
        }).catch(function () { return result; });
      });
    }).catch(function (e) {
      return { ok: false, error: 'Could not reach the backend: ' + e.message + ' — nothing was sent. Your details are still on this screen; try again.' };
    });
  }

  // --- Repair booking (v1.9, Parts Have Arrived button) ----------------------
  // The Parts Have Arrived message links here with ?workOrder=<id>&step=repair.
  // In that mode the page books the repair visit on the EXISTING work order
  // via setRepairAppointment — it must NEVER call createWorkOrder, or the
  // customer would file a duplicate job. Only a date + 2-hour block are
  // needed; the customer's details are already on file.
  function parseRepairQuery(search) {
    var s = trim(search || '');
    try {
      var q = new URLSearchParams(s);
      var id = trim(q.get('workOrder'));
      if (!id) return null;
      return { workOrderId: id, step: trim(q.get('step')) || 'repair' };
    } catch (e) { /* no URLSearchParams (headless test sandbox) — manual parse below */ }
    if (s.charAt(0) === '?') s = s.slice(1);
    var out = {};
    s.split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 0) return;
      out[pair.slice(0, i)] = pair.slice(i + 1).replace(/\+/g, ' ').replace(/%23/g, '#').replace(/%20/g, ' ');
    });
    var wid = trim(out.workOrder);
    if (!wid) return null;
    return { workOrderId: wid, step: trim(out.step) || 'repair' };
  }

  function submitRepairAppointment(workOrderId, scheduledDate, scheduledTime) {
    var date = trim(scheduledDate), time = trim(scheduledTime);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Promise.resolve({ ok: false, error: 'Pick a repair date.' });
    if (!time) return Promise.resolve({ ok: false, error: 'Pick a 2-hour time block.' });
    var payload = { action: 'setRepairAppointment', workOrderId: trim(workOrderId), scheduledDate: date, scheduledTime: time };
    if (!trim(CFG.BACKEND_URL)) {
      var record = { payload: payload, savedAt: new Date().toISOString(), sentToBackend: false };
      saveLocal(record);
      return Promise.resolve({ ok: true, mode: 'demo', displayId: trim(workOrderId), workOrderCode: codeOf(trim(workOrderId)) ? trim(workOrderId).replace(/^#/, '').toUpperCase() : null, creationCode: null, sentToBackend: false, confirmationMessage: 'queued — ready, not sent yet', record: record });
    }
    var body = { action: 'setRepairAppointment', workOrderId: trim(workOrderId), scheduledDate: date, scheduledTime: time };
    if (CFG.WO_API_KEY) body.apiKey = CFG.WO_API_KEY;
    return global.fetch(trim(CFG.BACKEND_URL), {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Backend returned an error.');
      var wo = res.workOrder || {};
      var out = { ok: true, mode: 'live', displayId: wo.displayId || wo.id || trim(workOrderId), workOrderCode: wo.workOrderCode || wo.work_order_code || null, creationCode: wo.creationCode || wo.creation_code || null, proCode: wo.proCode || wo.pro_code || null, sentToBackend: true, confirmationMessage: 'Repair appointment set.', record: wo };
      return fillMissingCode(out, out.displayId);
    }).catch(function (e) {
      return { ok: false, error: 'Could not reach the backend: ' + e.message + ' — nothing was booked. Your date and time are still on this screen; try again.' };
    });
  }


  // --- Work-order display number (James, Nov 7, 2026) --------------------
  // Every work order keeps its OWN code — the FORMAT (#XXXX-XXXX) is what
  // applies everywhere, never one hard-coded code. Displayed number comes
  // from THAT order's live data: full workOrderCode when assigned, the
  // creation half (creationCode) only when unassigned. An old internal
  // record id (#MMDD-NN style) is NEVER visible text — it stays a lookup
  // key only. Returns '' when no code is known for this order.
  function codeOf(v) {
    var c = trim(v).replace(/^#/, '').toUpperCase();
    return /^[A-Z0-9]{4}(-[A-Z0-9]{4})?$/.test(c) ? c : '';
  }
  function displayWorkOrderNumber(wo) {
    if (!wo) return '';
    var full = codeOf(wo.workOrderCode || wo.work_order_code);
    var half = codeOf(wo.creationCode || wo.creation_code);
    var pro = codeOf(wo.proCode || wo.pro_code);
    // Backend may store the halves apart (creation half in
    // workOrderCode/creationCode, Pro half in proCode): the full number
    // for THIS order is half + '-' + pro half. A bare half alone means
    // the order is unassigned, so only the half shows.
    if (full && full.indexOf('-') >= 0) return '#' + full;
    if ((full || half) && pro && pro.indexOf('-') < 0) return '#' + (full || half) + '-' + pro;
    var c = full || half || codeOf(wo.displayId) || codeOf(wo.id);
    return c ? '#' + c : '';
  }
  function displayWorkOrderNumberFromResult(res) {
    if (!res) return '';
    return displayWorkOrderNumber(res) || displayWorkOrderNumber(res.record || null);
  }

  // --- Code-first confirmation (James, Nov 7, 2026) ----------------------
  // The code is issued at creation, before anything else touches the
  // order, and the confirmation must show the order by its code from
  // the start. If a create/set response somehow carries no code, re-read
  // the order by its internal lookup key (never displayed) BEFORE
  // anything renders, so no confirmation ever shows the order without
  // its code. Never rejects and never fails the filing: a failed
  // re-read just leaves the result as the backend returned it.
  function fetchCodeFor(workOrderId) {
    var url = trim(CFG.BACKEND_URL) + '?action=getWorkOrder&workOrderId=' + encodeURIComponent(trim(workOrderId));
    if (CFG.WO_API_KEY) url += '&apiKey=' + encodeURIComponent(CFG.WO_API_KEY);
    try {
      return Promise.resolve(global.fetch(url)).then(function (r) { return r.json(); }).then(function (j) {
        var w = (j && j.ok && j.workOrder) || null;
        if (!w) return null;
        return { workOrderCode: w.workOrderCode || w.work_order_code || null, creationCode: w.creationCode || w.creation_code || null, proCode: w.proCode || w.pro_code || null, record: w };
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function fillMissingCode(result, lookupId) {
    if (!result || result.workOrderCode || result.creationCode || !trim(lookupId) || !trim(CFG.BACKEND_URL)) return Promise.resolve(result);
    return fetchCodeFor(lookupId).then(function (c) {
      if (c) {
        if (c.workOrderCode) result.workOrderCode = c.workOrderCode;
        if (c.creationCode) result.creationCode = c.creationCode;
        if (c.proCode) result.proCode = c.proCode;
        if (c.record) result.record = c.record;
      }
      return result;
    });
  }
  // --- Repair-booking autofill (v2.1, James, Nov 7) ------------------------
  // When the customer comes back to ?workOrder=<id>&step=repair, the page
  // shows THEIR details read-only underneath — name, address, appliance,
  // problem, work order # — and they only pick a new date + 2-hour block.
  // Details are never re-asked and no new work order is ever created.
  function escHtml(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // Demo-mode example (no backend yet): Rizk, the same example the Pay Now
  // page shows. City/state only — no street address, no gate code, no phone.
  var RIZK_EXAMPLE = {
    id: '#HD7X-000B', displayId: '#HD7X-000B', workOrderCode: 'HD7X-000B', creationCode: 'HD7X', customerName: 'Rizk',
    firstName: '', lastName: 'Rizk', phone: '', email: '',
    street: '', city: 'Waterford', state: 'MI', zip: '',
    address: 'Waterford, MI', accessNotes: '',
    problem: 'Dryer — not heating',
    applianceBrand: '', applianceModel: '', applianceSerial: ''
  };
  function fetchWorkOrder(workOrderId) {
    if (!trim(CFG.BACKEND_URL)) return Promise.resolve(RIZK_EXAMPLE);
    var url = trim(CFG.BACKEND_URL) + '?action=getWorkOrder&workOrderId=' + encodeURIComponent(trim(workOrderId));
    if (CFG.WO_API_KEY) url += '&apiKey=' + encodeURIComponent(CFG.WO_API_KEY);
    return global.fetch(url).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.ok || !res.workOrder) return null;
      return res.workOrder;
    }).catch(function () { return null; });
  }
  function repairDetailsHtml(wo) {
    if (!wo) return '';
    var name = trim(wo.customerName) || [trim(wo.firstName), trim(wo.lastName)].join(' ').trim() || 'Not provided';
    var addr = trim(wo.address) || [trim(wo.street), trim(wo.city), trim(wo.state), trim(wo.zip)].filter(function (x) { return x; }).join(', ') || 'Not provided';
    var appl = [trim(wo.applianceBrand), trim(wo.applianceModel)].filter(function (x) { return x; }).join(' ') || 'Not provided';
    var rows = [
      ['Work order', displayWorkOrderNumber(wo) || 'Not provided'],
      ['Name', name],
      ['Address', addr],
      ['Appliance', appl],
      ['Problem', trim(wo.problem) || 'Not provided']
    ];
    var h = '<dl style="display:grid;grid-template-columns:130px 1fr;gap:4px 10px;font-size:15px;margin:0">';
    rows.forEach(function (r) {
      h += '<dt style="color:#bfcdc9">' + escHtml(r[0]) + '</dt><dd style="margin:0">' + escHtml(r[1]) + '</dd>';
    });
    return h + '</dl>';
  }
  function fillRepairInputs(wo) {
    if (!wo || typeof document === 'undefined') return;
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v || ''; };
    set('first-name', wo.firstName); set('last-name', wo.lastName);
    set('phone', wo.phone); set('email', wo.email);
    set('street', wo.street); set('city', wo.city);
    set('state', wo.state || 'MI'); set('zip', wo.zip);
    set('access-notes', wo.accessNotes); set('problem', wo.problem);
    set('appliance-brand', wo.applianceBrand); set('appliance-model', wo.applianceModel);
  }

  // --- DOM wiring (browser only) --------------------------------------------
  function wirePage() {
    var $ = function (id) { return document.getElementById(id); };
    var form = $('wo-form');
    if (!form) return;
    wirePrefTiles();

    /* Repair-booking mode (v1.9): ?workOrder=<id>&step=repair from the Parts
     * Have Arrived message. Banner + heading + button say so, and submit
     * books the repair on the EXISTING job — it never creates a new one. */
    var repairMode = null;
    try { repairMode = parseRepairQuery(global.location ? global.location.search : ''); } catch (e) { repairMode = null; }
    if (repairMode) {
      var panelH2 = document.querySelector('#create-panel h2');
      if (panelH2) panelH2.textContent = 'Set your repair appointment';
      var banner = document.createElement('div');
      banner.id = 'repair-note';
      banner.setAttribute('role', 'note');
      banner.style.cssText = 'background:#1d2623;border-left:4px solid #35917f;padding:10px 12px;margin-bottom:16px;font-size:15px;';
      banner.textContent = 'Your parts have arrived. Please pick an appointment date and time.';
      form.parentNode.insertBefore(banner, form);
      var repairBtn = $('submit-btn');
      if (repairBtn) repairBtn.textContent = 'Set repair appointment';
      /* v2.1: autofill — hide every create field except the date + time
         picker, and show the customer's details read-only underneath.
         They only pick a date + 2-hour block; nothing is re-asked. */
      var grid = form.querySelector('.grid');
      var dateEl0 = $('scheduled-date');
      var dtWrap = dateEl0;
      while (dtWrap && dtWrap.parentNode && dtWrap.parentNode !== grid) dtWrap = dtWrap.parentNode;
      if (grid) {
        var kids = grid.children || [];
        for (var gi = 0; gi < kids.length; gi++) {
          if (kids[gi] !== dtWrap) kids[gi].style.display = 'none';
        }
      }
      var details = document.createElement('div');
      details.id = 'repair-details';
      details.setAttribute('aria-label', 'Your work order details');
      details.style.cssText = 'background:#171e1b;border:1px solid #33413d;border-radius:10px;padding:12px;margin-bottom:16px;';
      details.innerHTML = '<p style="margin:0 0 8px;color:#bfcdc9;font-size:14px">Loading your details…</p>';
      form.parentNode.insertBefore(details, form);
      fetchWorkOrder(repairMode.workOrderId).then(function (wo) {
        if (wo) { details.innerHTML = repairDetailsHtml(wo); fillRepairInputs(wo); }
        else { var fb = codeOf(repairMode.workOrderId); details.innerHTML = '<p style="margin:0;color:#bfcdc9;font-size:14px">' + (fb ? 'Work order #' + escHtml(fb) + ' — pick a date and time below.' : 'Pick a date and time below.') + '</p>'; }
      });
    }

    var cityEl = $('city'), stateEl = $('state'), zipEl = $('zip');
    var autoZip = '';
    if (cityEl) cityEl.addEventListener('input', function () {
      var r = cityChange(cityEl.value, zipEl ? zipEl.value : '', autoZip);
      autoZip = r.autoZip;
      if (r.state && stateEl) stateEl.value = r.state;
      if (zipEl && r.zip !== zipEl.value) zipEl.value = r.zip;
    });
    var autoCity = '';
    if (zipEl) zipEl.addEventListener('input', function () {
      var c = zipToCity(zipEl.value);
      if (c && cityEl && (!cityEl.value || cityEl.value === autoCity)) { cityEl.value = c; autoCity = c; }
      if (c && stateEl) stateEl.value = 'MI';
    });

    var dateEl = $('scheduled-date'), timeEl = $('scheduled-time'), noteEl = $('day-note');
    function refreshDayNote() {
      if (!dateEl || !noteEl) return;
      var d = trim(dateEl.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { noteEl.innerHTML = ''; return; }
      if (!trim(CFG.BACKEND_URL)) { noteEl.innerHTML = ''; return; }
      noteEl.innerHTML = '<span class="muted">Checking your calendar…</span>';
      fetchDaySchedule(d).then(function (res) {
        noteEl.innerHTML = dayScheduleHtml(res, timeEl ? timeEl.value : '');
        applyTimeOptions(res);
      }).catch(function () { noteEl.innerHTML = ''; });
    }
    if (dateEl) dateEl.addEventListener('change', refreshDayNote);
    if (timeEl) timeEl.addEventListener('change', refreshDayNote);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = $('submit-btn'), errEl = $('form-error');
      if (repairMode) {
        var rDate = dateEl ? dateEl.value : '', rTime = timeEl ? timeEl.value : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Setting…'; }
        if (errEl) errEl.textContent = '';
        submitRepairAppointment(repairMode.workOrderId, rDate, rTime).then(function (res) {
          if (btn) { btn.disabled = false; btn.textContent = 'Set repair appointment'; }
          if (!res.ok) {
            if (errEl) errEl.textContent = res.error || 'Could not book it — try again.';
            return;
          }
          showConfirmation(res, { scheduledDate: rDate, scheduledTime: rTime }, true);
        });
        return;
      }
      var data = {
        firstName: $('first-name').value, lastName: $('last-name').value,
        phone: $('phone').value, email: $('email').value,
        preferredContact: preferredContactFromDom(),
        street: $('street').value, city: cityEl ? cityEl.value : '',
        state: stateEl ? stateEl.value : '', zip: zipEl ? zipEl.value : '',
        accessNotes: $('access-notes').value, problem: $('problem').value,
        applianceBrand: $('appliance-brand').value,
        applianceModel: $('appliance-model').value,
        applianceSerial: '', /* v22: serial no longer collected */
        scheduledDate: dateEl ? dateEl.value : '',
        scheduledTime: timeEl ? timeEl.value : ''
      };
      if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
      if (errEl) errEl.textContent = '';
      submitWorkOrder(data).then(function (res) {
        if (btn) { btn.disabled = false; btn.textContent = 'Create work order'; }
        if (!res.ok) {
          if (errEl) errEl.textContent = res.error || 'Could not create it — try again.';
          return;
        }
        showConfirmation(res, data);
      });
    });

    var again = $('new-request-btn');
    if (again) again.addEventListener('click', function () {
      $('confirmation').style.display = 'none';
      $('create-panel').style.display = 'block';
      form.reset();
      setPrefTiles('Text');
      if (stateEl) stateEl.value = CFG.DEFAULT_STATE || 'MI';
      if (noteEl) noteEl.innerHTML = '';
      autoZip = '';
      window.scrollTo(0, 0);
    });
  }

  function showConfirmation(res, data, isRepair) {
    var panel = document.getElementById('create-panel');
    var conf = document.getElementById('confirmation');
    if (panel) panel.style.display = 'none';
    if (!conf) return;
    conf.style.display = 'block';
    var set = function (id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; };
    var numLine = document.getElementById('conf-number-line');
    var dispNum = displayWorkOrderNumberFromResult(res);
    if (dispNum) {
      if (numLine) numLine.style.display = 'block';
      set('conf-number', dispNum);
    } else if (numLine) { numLine.style.display = 'none'; }
    if (isRepair) {
      var confH2 = document.querySelector('#confirmation h2');
      if (res.sentToBackend) {
        if (confH2) confH2.textContent = 'Repair appointment set';
        set('conf-code-note', 'Your repair visit is booked on this work order — no new work order was created.');
        set('conf-sent', 'Repair appointment set for ' + (displayAppointment(data.scheduledDate, data.scheduledTime) || '—') + '.');
        set('conf-agreement', 'No new agreement needed — your original agreement still stands. We\'ll confirm your repair appointment.');
      } else {
        // Demo mode (no backend wired): the pick was only saved on this
        // device — never say it was booked or set.
        if (confH2) confH2.textContent = 'Repair appointment picked';
        set('conf-code-note', 'No new work order was created — this is for your existing work order.');
        set('conf-sent', 'Saved on this device only — not yet sent to Full Cycle Plus.');
        set('conf-agreement', 'No new agreement needed — your original agreement still stands.');
      }
      window.scrollTo(0, 0);
      return;
    }
    /* v25 (James): no name / when / contact recap below the Create button —
       the confirmation keeps only the work-order number, code note, sent
       status and agreement line. The number is shown ONLY as the full
       "Work order #HD7X-000B" — never "work order code", never a bare
       creation half. */
    if (dispNum) {
      set('conf-code-note', 'Work order ' + dispNum);
    }
    set('conf-sent', res.sentToBackend
      ? 'Sent to Full Cycle Plus.'
      : 'Saved on this device only — not yet sent to Full Cycle Plus.');
    set('conf-agreement', res.agreementToken
      ? 'Your service agreement link will come with your appointment confirmation (agreement ref: ' + res.agreementToken + ').'
      : 'Your service agreement link will come with your appointment confirmation once the backend issues it. Appointment confirmation message: ' + res.confirmationMessage + '.');
    window.scrollTo(0, 0);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wirePage);
    else wirePage();
  }

  global.FCPCreate = {
    CITY_ZIP: CITY_ZIP, cityChange: cityChange,
    parseTimeToMinutes: parseTimeToMinutes, isoToTimeText: isoToTimeText,
    validateForm: validateForm, buildPayload: buildPayload,
    preferredContactFromDom: preferredContactFromDom,
    zipToCity: zipToCity, parseTimeBlock: parseTimeBlock, TIME_BLOCKS: TIME_BLOCKS,
    dayScheduleHtml: dayScheduleHtml, computeBusyBlocks: computeBusyBlocks,
    setPrefTiles: setPrefTiles, submitWorkOrder: submitWorkOrder,
    parseRepairQuery: parseRepairQuery,
    submitRepairAppointment: submitRepairAppointment,
    fetchWorkOrder: fetchWorkOrder, displayWorkOrderNumber: displayWorkOrderNumber,
    displayAppointmentBlock: displayAppointmentBlock, formatApptDate: formatApptDate,
    displayAppointment: displayAppointment,
    repairDetailsHtml: repairDetailsHtml,
    RIZK_EXAMPLE: RIZK_EXAMPLE,
    loadSaved: loadSaved
  };
})(typeof window !== 'undefined' ? window : globalThis);
