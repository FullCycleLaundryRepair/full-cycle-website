// Full Cycle Plus — Service Agreement page logic.
// Loaded by agreement.html after config.js (same folder as the Work
// Order Creation / Pay Now pages, same GitHub site:
// fullcyclelaundryrepair.github.io/full-cycle-website/agreement.html?
// workOrder=<id>).
//
// WHAT THIS PAGE IS: our page, our format and colors (dark #0d0d0d,
// v11 header, Create-page coloring). TWO tiles, step by step:
//   1. Service Agreement — the full agreement (Sections 1-10), only
//      the fields required inside a service agreement, auto-filled;
//      checkbox "agree to all terms and conditions" + sign here.
//   2. Appointment Confirmation — all their info: customer, service
//      address, appliance, problem, appointment. The customer taps
//      "Confirm appointment" to confirm it, then Submit (at the bottom
//      of tile 2). Nothing is due at this stage, so there is no payment
//      schedule on this page (James, Nov 7, 2026). Submit is enabled
//      only once tiles 1 and 2 are done. Submit locks the snapshot +
//      checkbox + signature + timestamp via the backend's
//      submitAgreement, which also makes the job active.
// Unknowns show "Not provided" — never invented. "Sole Proprietor"
// never appears (James, Nov 7, 2026).
//
// WHAT IT IS NOT: it never invents details, never fakes a live
// filing, and never shows another customer's information. The link
// carries only ?workOrder=<id> — no amount, no token, no personal
// detail in the URL. The page loads the job from the backend
// (getAgreement + getWorkOrder) when configured.
// In demo mode (no BACKEND_URL yet) the page shows the Rizk example
// (#HD7X-000B, Diagnostic $50, Parts $0, Labor $0, Total $50) and
// says clearly that it is an example: signing there sends nothing.
// A failed load is different: it shows an error panel only and never
// renders the example, and never leaves a live submit path on a demo.
// Pure functions are exposed on window.FCPAgreement so they can be
// tested headlessly; DOM wiring only runs when `document` exists.
(function (global) {
  'use strict';

  var CFG = (global.FCP_CONFIG || {});
  var AGREEMENT_PAGE_URL = CFG.AGREEMENT_PAGE_URL || 'https://fullcyclelaundryrepair.github.io/full-cycle-website/agreement.html';

  function trim(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }
  function money(cents) { return '$' + (num(cents) / 100).toFixed(2); }
  function display(v) { return trim(v) ? trim(v) : 'Not provided'; }

  // Work order id from the query string — the ONLY thing the link
  // carries. Never an amount, a token, or a personal detail.
  function parseWorkOrder(q) { return trim(q && q.workOrder); }

  // The agreement link for an email / text: our page, work order id
  // only. The page itself fetches the live details from the backend.
  function agreementLink(workOrderId) {
    return AGREEMENT_PAGE_URL + '?workOrder=' + encodeURIComponent(trim(workOrderId));
  }

  // Demo/example agreement (Rizk #HD7X-000B) shown only when no
  // backend is configured. Clearly labelled as an example on the page;
  // never presented as a live job. No street address, phone, or gate
  // code — those never belong on a public page.
  function demoAgreement() {
    return {
      workOrderId: 'HD7X-000B',
      displayId: '#HD7X-000B',
      workOrderCode: 'HD7X-000B',
      creationCode: 'HD7X',
      customerName: 'Rizk',
      phone: '', email: '',
      address: 'Waterford, MI',
      problem: 'Dryer — not heating',
      applianceBrand: '', applianceModel: '', applianceSerial: '',
      scheduledDate: '2026-11-07', scheduledTime: '9:00 AM',
      services: [{ description: 'Diagnostic', priceCents: 5000 }],
      diagnosticCents: 5000, partsCents: 0, laborCents: 0, totalCents: 5000,
      demo: true
    };
  }

  // Display number: the work-order code (#HD7X-000B) when the job has
  // one, otherwise the record id. Never called "work order code" on
  // the page — it is just Work Order #… (James, Nov 7, 2026).
  // Per-order display number: this order's own code when it has one
  // (full code when assigned, creation half when unassigned). An old
  // internal record id (#MMDD-NN style) is never visible text — if no
  // code is known for this order, show '—' rather than the internal id.
  function codeOf(v) {
    var c = trim(v).replace(/^#/, '').toUpperCase();
    return /^[A-Z0-9]{4}(-[A-Z0-9]{4})?$/.test(c) ? c : '';
  }
  function displayNumber(ag) {
    if (!ag) return '—';
    var full = codeOf(ag.workOrderCode || ag.work_order_code);
    var half = codeOf(ag.creationCode || ag.creation_code);
    var pro = codeOf(ag.proCode || ag.pro_code);
    if (full && full.indexOf('-') >= 0) return '#' + full;
    if ((full || half) && pro && pro.indexOf('-') < 0) return '#' + (full || half) + '-' + pro;
    var c = full || half || codeOf(ag.displayId) || codeOf(ag.workOrderId);
    return c ? '#' + c : '—';
  }

  // Signature image check (mirrors the backend's
  // woValidateSignatureImage): PNG/JPEG data URL, non-empty payload,
  // max 48,000 chars. A blank pad has no ink and is rejected here
  // before anything is sent.
  function validateSignatureImage(dataUrl, hasInk) {
    if (!hasInk) return { ok: false, error: 'Please sign in the signature box.' };
    if (!dataUrl || typeof dataUrl !== 'string') return { ok: false, error: 'Please sign in the signature box.' };
    if (dataUrl.length > 48000) return { ok: false, error: 'Signature image is too large. Please sign again with a smaller signature.' };
    if (!/^data:image\/(png|jpeg);base64,/.test(dataUrl)) return { ok: false, error: 'Signature image must be a PNG or JPEG.' };
    var payload = dataUrl.split(',')[1] || '';
    if (payload.length < 20) return { ok: false, error: 'Signature looks empty — please sign in the signature box.' };
    return { ok: true };
  }

  // Submit guards: checkbox + typed name + drawn signature, all
  // three, or nothing is sent. Returns { ok } or { ok:false, error }.
  function validateSubmit(input) {
    if (!input || input.consent !== true) return { ok: false, error: 'Please tick “agree to all terms and conditions” to continue.' };
    if (!trim(input.signatureName)) return { ok: false, error: 'Please type your full name to sign.' };
    var sig = validateSignatureImage(input.signatureImage, !!input.hasInk);
    if (!sig.ok) return sig;
    return { ok: true };
  }

  // Tile gating (James, Nov 7): Submit is enabled only once tile 1
  // (agreement: checkbox + typed name + drawn signature) AND tile 2
  // (appointment confirmed) are both done.
  function validateTiles(input) {
    var ag = validateSubmit(input || {});
    return { agreementDone: ag.ok, appointmentDone: !!(input && input.appointmentConfirmed), submitOk: ag.ok && !!(input && input.appointmentConfirmed) };
  }

  function backendUrl() { return trim(CFG.BACKEND_URL); }
  function apiKey() { return trim(CFG.WO_API_KEY); }

  function callBackend(action, body, cb) {
    var url = backendUrl();
    if (!url) { cb({ ok: false, error: 'BACKEND_NOT_CONFIGURED' }); return; }
    var opts = { method: body ? 'POST' : 'GET', headers: {} };
    var full = url + '?action=' + encodeURIComponent(action);
    if (apiKey()) full += '&apiKey=' + encodeURIComponent(apiKey());
    if (body) { opts.headers['Content-Type'] = 'text/plain'; opts.body = JSON.stringify(body); }
    global.fetch(full, opts).then(function (r) { return r.json(); }).then(function (j) { cb(j); })
      .catch(function (e) { cb({ ok: false, error: 'BACKEND_ERROR', detail: String(e && e.message || e) }); });
  }

  // --- DOM wiring (browser only) -------------------------------------
  function el(id) { return document.getElementById(id); }
  function setText(id, v) { var n = el(id); if (n) n.textContent = v; }
  function show(id, on) { var n = el(id); if (n) n.style.display = on ? '' : 'none'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Tile 1 shows the agreement + work order number. Tile 2 shows the
  // appointment confirmation (customer, service address, appliance,
  // problem, appointment) plus the Submit button — nothing is due at
  // this stage, so there is no payment schedule on this page (James,
  // Nov 7, 2026). Fields come from the work order (wo) when available,
  // else from the agreement record's prefill (ag.prefill — the
  // already-signed/locked path never fetches the work order), else
  // from the agreement record itself (demo mode is the Rizk example).
  // Unknowns show "Not provided".
  function render(ag, wo) {
    var src = wo || (ag && ag.prefill) || ag || {};
    setText('agree-wo', 'Work Order ' + displayNumber(ag));
    show('demo-note', !!(ag && ag.demo));
    var name = trim(src.customerName) || [trim(src.firstName), trim(src.lastName)].join(' ').trim();
    setText('appt-name', display(name));
    var addr = trim(src.address) || [trim(src.street), trim(src.city), trim(src.state), trim(src.zip)].filter(function (x) { return x; }).join(', ');
    setText('appt-address', display(addr));
    var appl = [trim(src.applianceBrand), trim(src.applianceModel)].filter(function (x) { return x; }).join(' ');
    setText('appt-appliance', display(appl));
    setText('appt-problem', display(src.problem));
    var when = [trim(src.scheduledDate), trim(src.scheduledTime)].filter(function (x) { return x; }).join(' ');
    setText('appt-when', display(when));
  }

  function init() {
    var params = {};
    try {
      var q = new URLSearchParams(global.location.search);
      params = { workOrder: q.get('workOrder') || '' };
    } catch (e) { params = { workOrder: '' }; }
    var woId = parseWorkOrder(params);

    var check = el('agree-check');
    var nameInput = el('sig-name');
    var canvas = el('sig-pad');
    var hint = el('sig-hint');
    var clearBtn = el('sig-clear');
    var missing = el('missing');
    var submitBtn = el('submit-agreement');
    var submitNote = el('submit-note');
    var hasInk = false, drawing = false, sized = false, last = null, locked = false;
    var loadedCode = ''; // this order's own code, from getWorkOrder when loaded
    var apptConfirmed = false;
    var confirmBtn = el('confirm-appt-btn');
    var apptStatus = el('appt-status');

    function sizeCanvas() {
      if (sized || !canvas) return;
      var r = canvas.getBoundingClientRect();
      if (!r.width) return;
      var dpr = global.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1c2421';
      sized = true;
    }
    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function tileState() {
      return validateTiles({ consent: !!(check && check.checked), signatureName: nameInput ? nameInput.value : '', signatureImage: hasInk ? 'data:image/png;base64,aaaaaaaaaaaaaaaaaaaa' : '', hasInk: hasInk, appointmentConfirmed: apptConfirmed });
    }
    function update() {
      if (!missing) return;
      var t = tileState();
      if (submitBtn) submitBtn.disabled = locked || !t.submitOk;
      if (apptStatus) {
        apptStatus.textContent = apptConfirmed ? 'Confirmed' : 'Not confirmed';
        if (apptStatus.classList) { if (apptConfirmed) apptStatus.classList.add('done'); else apptStatus.classList.remove('done'); }
      }
      if (t.submitOk) {
        missing.classList.add('ready');
        missing.textContent = 'Ready — tap Submit to agree and confirm.';
      } else if (!t.agreementDone) {
        var v = validateSubmit({ consent: !!(check && check.checked), signatureName: nameInput ? nameInput.value : '', signatureImage: hasInk ? 'data:image/png;base64,aaaaaaaaaaaaaaaaaaaa' : '', hasInk: hasInk });
        missing.classList.remove('ready');
        missing.textContent = 'Still needed: ' + v.error.replace(/^Please /, '').replace(/\.$/, '') + '.';
      } else {
        missing.classList.remove('ready');
        missing.textContent = 'Still needed: confirm your appointment in step 2.';
      }
    }
    if (confirmBtn) confirmBtn.addEventListener('click', function () {
      if (locked) return;
      apptConfirmed = true;
      if (confirmBtn) confirmBtn.disabled = true;
      update();
    });
    if (canvas) {
      // The page must NOT scroll while the customer is drawing.
      canvas.style.touchAction = 'none';
      canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
      canvas.addEventListener('pointerdown', function (e) {
        if (locked) return;
        sizeCanvas();
        drawing = true;
        last = pos(e);
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!drawing) return;
        var ctx = canvas.getContext('2d');
        var p = pos(e);
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        last = p;
        if (!hasInk) { hasInk = true; if (hint) hint.classList.add('off'); update(); }
        e.preventDefault();
      });
      var endDraw = function () {
        if (drawing && last) {
          var ctx = canvas.getContext('2d');
          ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2); ctx.fillStyle = '#1c2421'; ctx.fill();
          if (!hasInk) { hasInk = true; if (hint) hint.classList.add('off'); }
        }
        drawing = false;
        update();
      };
      canvas.addEventListener('pointerup', endDraw);
      canvas.addEventListener('pointercancel', endDraw);
    }
    if (clearBtn) clearBtn.addEventListener('click', function () {
      if (locked || !canvas) return;
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasInk = false;
      if (hint) hint.classList.remove('off');
      update();
    });
    if (check) check.addEventListener('change', update);
    if (nameInput) nameInput.addEventListener('input', update);

    function lockUI(sigImage, whenText) {
      locked = true;
      if (check) check.disabled = true;
      if (nameInput) nameInput.disabled = true;
      if (clearBtn) clearBtn.disabled = true;
      if (canvas) canvas.style.pointerEvents = 'none';
      if (submitBtn) submitBtn.disabled = true;
      if (confirmBtn) confirmBtn.disabled = true;
      setText('locked-when', whenText);
      var img = el('locked-sig');
      if (img) img.src = sigImage;
      show('locked', true);
      setText('missing', '');
    }

    if (submitBtn) submitBtn.addEventListener('click', function () {
      var sigImage = '';
      try { sigImage = canvas ? canvas.toDataURL('image/png') : ''; } catch (e) { sigImage = ''; }
      if (!apptConfirmed) { setText('submit-note', 'Please confirm your appointment in step 2 first.'); update(); return; }
      var v = validateSubmit({ consent: !!(check && check.checked), signatureName: nameInput ? nameInput.value : '', signatureImage: sigImage, hasInk: hasInk });
      if (!v.ok) { setText('submit-note', v.error); update(); return; }
      if (!backendUrl()) {
        setText('submit-note', 'Demo mode — this example is not sent anywhere. Open the agreement from your appointment confirmation email to sign for real.');
        return;
      }
      submitBtn.disabled = true;
      setText('submit-note', 'Sending your agreement…');
      callBackend('submitAgreement', { workOrderId: woId, consent: true, signatureName: trim(nameInput.value), signatureImage: sigImage }, function (r) {
        if (r && r.ok) {
          var when = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
          lockUI(sigImage, 'Signed ' + when + ' by ' + trim(nameInput.value) + ' · Work order ' + (loadedCode ? '#' + loadedCode : displayNumber({ workOrderId: woId })));
          setText('submit-note', 'Thank you — your signed agreement has been sent back to us, and your job is now active.');
        } else {
          submitBtn.disabled = false;
          setText('submit-note', 'That did not go through: ' + ((r && r.error) || 'please try again, or call (248) 429-9878.'));
        }
      });
    });

    update();

    // Failed load: error panel only — never render the demo example,
    // and never leave a live sign/submit path on a demo. Hides both
    // tiles and shows only the error.
    function showLoadError(note) {
      ['tile-agreement', 'tile-appointment'].forEach(function (id) {
        var t = el(id);
        if (t) t.style.display = 'none';
      });
      var panel = el('agreement-panel');
      if (panel && !el('load-error')) {
        var err = document.createElement('div');
        err.id = 'load-error';
        err.setAttribute('role', 'alert');
        err.style.cssText = 'border:1.5px solid #e07a6e;border-radius:8px;padding:14px;background:#2a1a17;font-size:15px;';
        err.textContent = note;
        panel.appendChild(err);
      }
      if (submitBtn) submitBtn.disabled = true;
      if (confirmBtn) confirmBtn.disabled = true;
    }

    if (!backendUrl()) {
      render(demoAgreement());
      return;
    }
    if (!woId) {
      showLoadError('No work order was linked to this page. Open it from the agreement link in your appointment confirmation email.');
      return;
    }
    var url = backendUrl() + '?action=getAgreement&workOrderId=' + encodeURIComponent(woId);
    if (apiKey()) url += '&apiKey=' + encodeURIComponent(apiKey());
    global.fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok || !j.found) {
        showLoadError('We could not load that work order. Please use the agreement link in your appointment confirmation email, or call (248) 429-9878.');
        return;
      }
      if (j.accepted) {
        render(j);
        lockUI(j.agreement ? j.agreement.signatureImageDataUrl : '', 'Already signed ' + (j.signedAt || j.acceptedAt || '') + ' by ' + (j.acceptedName || ''));
        setText('submit-note', 'This agreement is already signed and locked.');
        return;
      }
      // Display code comes from getWorkOrder.
      var url2 = backendUrl() + '?action=getWorkOrder&workOrderId=' + encodeURIComponent(woId);
      if (apiKey()) url2 += '&apiKey=' + encodeURIComponent(apiKey());
      global.fetch(url2).then(function (r2) { return r2.json(); }).then(function (j2) {
        var wo = (j2 && j2.ok && j2.workOrder) || null;
        render(j, wo);
        if (wo) { var c2 = codeOf(wo.workOrderCode || wo.work_order_code) || codeOf(wo.creationCode || wo.creation_code); if (c2) { loadedCode = c2; setText('agree-wo', 'Work Order #' + c2); } }
      }).catch(function () { render(j); });
    }).catch(function () {
      showLoadError('We could not reach the agreement backend. No agreement has been sent — please call (248) 429-9878.');
    });
  }

  global.FCPAgreement = {
    parseWorkOrder: parseWorkOrder, agreementLink: agreementLink,
    demoAgreement: demoAgreement, displayNumber: displayNumber,
    validateSignatureImage: validateSignatureImage,
    validateSubmit: validateSubmit, validateTiles: validateTiles, money: money, display: display,
    AGREEMENT_PAGE_URL: AGREEMENT_PAGE_URL
  };

  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : global);
