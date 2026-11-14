// Full Cycle Laundry Repair — Pay Now page logic.
// Loaded by pay.html after config.js (same folder as the Work Order
// Creation page, same GitHub site: fullcyclelaundryrepair.github.io/
// full-cycle-website/pay.html?workOrder=<id>&stage=diagnosis|closing).
//
// WHAT THIS PAGE IS: our page, our format and colors (dark #0d0d0d,
// v11 header, Create-page coloring). It shows the work order and what
// is due, and the customer pays by card right here: the card form is
// Square's Web Payments SDK (v2.8) — its fields are Square-hosted
// iframes styled to match, so the card number never touches our
// servers. On Pay, the SDK tokenizes the card to a one-time nonce and
// the backend charges it (chargeCard, server-computed amount).
// WHAT IT IS NOT: it never stores a card number, never sees one — the
// iframes send the card straight to Square. If the SDK cannot load or
// the Application ID is not set yet, the Pay Now button falls back to
// the Square payment link (createSquarePaymentLink) and opens Square's
// own checkout. Until Square is configured (Script Properties
// SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID — James sets those, no
// token anywhere in this repo), the button stays disabled and the page
// says so honestly. No live payment is ever faked. SANDBOX ONLY in
// v2.8 — the embedded form loads only when the backend says sandbox.
//
// AMOUNTS (never trusted from the URL — always computed from the
// backend work order when configured):
//   diagnosis stage = the bill James sent: the frozen billed total when
//     a bill went out, otherwise every service + part on the order, MI
//     sales tax 6%, Square fee 3.3% + 30¢, minus what is already paid
//     at the diagnosis step. The bill message links here, so this MUST
//     equal the bill total. (v1.2, James, Nov 12, 2026; frozen billed
//     total v2.1, Nov 13, 2026)
//   closing stage   = the same bill total minus everything already paid
//     (the balance due). The old closing amount omitted tax + fee;
//     v2.1 charges the bill total for both stages.
// In demo mode (no BACKEND_URL yet) the page shows the Rizk example
// (#A7K2-001, Diagnostic $50, Parts $0, Labor $0, Total $50) and
// says clearly that it is an example and nothing has been paid. A
// failed load is different: it shows an error only and never renders
// the example as if it were the customer's real work order.
//
// AFTER PAYMENT: the customer taps "I agree to the payment" here (or
// in the final receipt email). That calls acceptReceipt, which is the
// ping back to us that unlocks the Close Work Order button. Payment
// alone does NOT unlock it; agreeing never closes the job on its own
// — closing is always manual, by us.
// Pure functions are exposed on window.FCPPay so they can be tested
// headlessly; DOM wiring only runs when `document` exists.
(function (global) {
  'use strict';

  var CFG = (global.FCP_CONFIG || {});
  var PAY_PAGE_URL = CFG.PAY_PAGE_URL || 'https://fullcyclelaundryrepair.github.io/full-cycle-website/pay.html';

  function trim(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }
  function money(cents) { return '$' + (num(cents) / 100).toFixed(2); }

  // Stage from the query string. Anything unknown becomes 'closing'
  // (the final receipt is the default pay step); 'diagnosis' is the
  // post-diagnosis step. Never trust a stage the backend rejects —
  // createSquarePaymentLink only accepts these two.
  function parseStage(q) {
    var s = trim(q && q.stage).toLowerCase();
    return s === 'diagnosis' ? 'diagnosis' : 'closing';
  }

  function stageLabel(stage) {
    return stage === 'diagnosis' ? 'Bill payment' : 'Closing payment';
  }

  // What this payment is for, in plain words.
  function stageDescription(stage) {
    return stage === 'diagnosis'
      ? 'Your bill for this job — all services and parts, plus 6% tax and the Square fee.'
      : 'Final payment: the balance left on your bill.';
  }

  // Bill math (v1.2, James, Nov 12, 2026) — ONE formula everywhere
  // the bill total appears (billing page, this page, track balance).
  // Subtotal = services + parts. Tax 6% on the subtotal. Square fee
  // 3.3% + 30¢ on the whole ticket (subtotal + tax). No tax/fee on $0.
  function billTotals(subtotalCents) {
    var sub = Math.max(0, Math.round(num(subtotalCents)));
    if (!sub) return { subtotalCents: 0, taxCents: 0, squareFeeCents: 0, totalCents: 0 };
    var tax = Math.round(sub * 0.06);
    var fee = Math.round((sub + tax) * 0.033) + 30;
    return { subtotalCents: sub, taxCents: tax, squareFeeCents: fee, totalCents: sub + tax + fee };
  }

  // Amount due (cents) for a stage, from a loaded backend work order.
  // ONE formula everywhere (v2.1, Deep Dive 3, Problems 2 + 10): the
  // bill total — the frozen billed total when a bill went out, otherwise
  // services + parts + 6% tax + 3.3% Square fee + 30¢ — minus what is
  // already paid. Diagnosis subtracts only diagnosis-stage payments;
  // closing subtracts everything paid. The old closing amount was
  // totalCents − paid with no tax or fee, undercharging every balance
  // (a $170 job billed $186.45; the old page asked $65.68 after a
  // $104.32 diagnosis payment instead of $82.13).
  function stageAmountCents(wo, stage) {
    if (!wo) return 0;
    var billTotal = num(wo.billedTotalCents) > 0
      ? num(wo.billedTotalCents)
      : billTotals(num(wo.servicesTotalCents) + num(wo.partsTotalCents)).totalCents;
    if (stage === 'diagnosis') {
      var diagPaid = 0;
      (wo.payments || []).forEach(function (p) { if (p.stage === 'diagnosis') diagPaid += num(p.amountCents); });
      return Math.max(0, billTotal - diagPaid);
    }
    var paid = 0;
    (wo.payments || []).forEach(function (p) { paid += num(p.amountCents); });
    return Math.max(0, billTotal - paid);
  }

  // Deep Dive 4, Problem 20 — the stage the customer still owes for:
  // diagnosis when the diagnosis step is unpaid, else closing. The
  // track page and the pay page (no stage in the link) both use this,
  // so a customer who has not paid the diagnosis bill lands on
  // "Bill payment", not "Closing payment".
  function stageForOrder(wo) {
    if (!wo) return 'closing';
    return stageAmountCents(wo, 'diagnosis') > 0 ? 'diagnosis' : 'closing';
  }

  // Totals row for the page, from a loaded backend work order.
  // Deep Dive 4, Problem 23 — paid is stage-appropriate: paidStage
  // is the diagnosis-step payments on the diagnosis page and every
  // payment on the closing page, so "Already paid" never contradicts
  // the "Total due for this step" next to it. `paid` stays the
  // all-payments total for callers that need it.
  function totalsFor(wo, stage) {
    if (!wo) return null;
    var paid = 0, diagPaid = 0;
    (wo.payments || []).forEach(function (p) { paid += num(p.amountCents); if (p.stage === 'diagnosis') diagPaid += num(p.amountCents); });
    var bt = billTotals(num(wo.servicesTotalCents) + num(wo.partsTotalCents));
    var billed = num(wo.billedTotalCents) > 0;
    var billTotal = billed ? num(wo.billedTotalCents) : bt.totalCents;
    /* Deep Dive 4, Problem 19 — when billed, the services/parts
     * split comes from the frozen billedLines (mirror of the
     * backend's woBillBalance), not the live totals: a part added
     * after billing must not move the rows while the total stays
     * frozen, or services + parts + tax + fee stops equalling the
     * total. */
    var services = num(wo.servicesTotalCents), parts = num(wo.partsTotalCents);
    if (billed && wo.billedLines) {
      services = 0; parts = 0;
      (wo.billedLines.services || []).forEach(function (s) { services += num(s.priceCents); });
      (wo.billedLines.parts || []).forEach(function (pp) { parts += num(pp.qty, 1) * num(pp.unitPriceCents); });
    }
    var st = (stage === 'diagnosis') ? 'diagnosis' : 'closing';
    return {
      services: services,
      parts: parts,
      urgency: num(wo.estimateUrgencyCents),
      urgencyName: wo.urgency || 'Standard',
      tax: billed ? num(wo.billedTaxCents) : bt.taxCents,
      fee: billed ? num(wo.billedFeeCents) : bt.squareFeeCents,
      total: billTotal,
      paid: paid,
      paidDiagnosis: diagPaid,
      paidStage: st === 'diagnosis' ? diagPaid : paid,
      due: Math.max(0, billTotal - paid)
    };
  }

  // The Pay Now link for an email / text: our page, work order id +
  // stage as query params. The page itself fetches the live amounts
  // from the backend — the link never carries an amount. v2.4 (Track
  // B, Deep Dive 4 Problem 3): acceptReceipt is token-gated, so a
  // link built for the customer carries &key=<token> with it; a bare
  // code-only link never carries one.
  function payLink(workOrderId, stage, token) {
    var url = PAY_PAGE_URL + '?workOrder=' + encodeURIComponent(trim(workOrderId))
      + '&stage=' + (stage === 'diagnosis' ? 'diagnosis' : 'closing');
    if (token) url += '&key=' + encodeURIComponent(trim(token));
    return url;
  }

  // --- Embedded card payments (v2.8) — pure helpers ------------------
  // Square Web Payments SDK URL. SANDBOX ONLY in v2.8: the embedded
  // form loads only when the backend reports sandbox; anything else
  // returns null so the page falls back to the payment link instead of
  // ever loading the production SDK.
  function squareSdkUrl(environment) {
    if (trim(environment).toLowerCase() === 'sandbox') return 'https://sandbox.web.squarecdn.com/v1/square.js';
    return null;
  }

  // A tokenized card nonce from Square's SDK always starts 'cnon:'.
  // Anything else never came from the card form.
  function isCardNonce(v) {
    return /^cnon:/.test(trim(v));
  }

  // The backend charge payload: work order + stage + the one-time
  // nonce. No amount — the backend computes what is due (v2.1 rule).
  function chargeCardPayload(workOrderId, stage, token) {
    return { workOrderId: trim(workOrderId), stage: stage === 'diagnosis' ? 'diagnosis' : 'closing', sourceId: trim(token) };
  }

  // Square tokenize errors → plain words. Square's error objects carry
  // { code, detail, field }; unknown codes fall back to Square's own
  // detail, then a generic line. Never surfaces a raw code alone.
  function cardErrorText(errors) {
    var list = errors || [];
    if (!list.length) return 'Square could not read that card. Please check the details and try again.';
    var e = list[0];
    var code = String(e.code || '');
    var detail = String(e.detail || '');
    if (code === 'CARD_DECLINED' || code === 'GENERIC_DECLINE') return 'That card was declined. Please use a different card or call (248) 429-9878.';
    if (code === 'CARD_EXPIRED') return 'That card is expired — please use a different card.';
    if (code === 'INVALID_CARD_NUMBER' || code === 'INVALID_CARD') return 'Check the card number and try again.';
    if (code === 'INVALID_EXPIRATION' || code === 'INVALID_EXPIRATION_DATE') return 'Check the expiration date and try again.';
    if (code === 'INVALID_CVV' || code === 'INVALID_CVV_OR_CVC') return 'Check the security code on the back of the card and try again.';
    if (code === 'INVALID_POSTAL_CODE') return 'Check the ZIP / postal code and try again.';
    if (code === 'VERIFY_BUYER_FAILED' || code === 'VERIFICATION_REQUIRED') return 'Square could not verify that card. Please use a different card or call (248) 429-9878.';
    return detail || 'Square could not read that card. Please check the details and try again.';
  }

  // A failed chargeCard response → plain words for the page. A decline
  // named in Square's detail reads as a decline, not a raw error code.
  function chargeErrorText(r) {
    if (!r) return 'Square could not take that payment. Please check the card and try again, or call (248) 429-9878.';
    var d = String(r.detail || '');
    if (d.indexOf('CARD_DECLINED') >= 0 || d.indexOf('GENERIC_DECLINE') >= 0) return 'That card was declined. Please use a different card or call (248) 429-9878.';
    if (String(r.error) === 'Invalid card token — please re-enter your card details and try again.') return 'Square could not read that card. Please check the details and try again.';
    if (String(r.error) === 'SQUARE_CARD_NOT_AVAILABLE') return 'Card payments on this page are not available right now — use Pay Now to pay on Square’s secure checkout instead.';
    return d || String(r.error || '') || 'Square could not take that payment. Please check the card and try again, or call (248) 429-9878.';
  }

  // Demo/example work order (Rizk #A7K2-001) shown only when no
  // backend is configured. Clearly labelled as an example on the page;
  // never presented as a live job. No street address, phone, or gate
  // code — those never belong on a public page.
  function demoWorkOrder(stage) {
    return {
      id: 'A7K2-001',
      displayId: '#A7K2-001',
      workOrderCode: 'A7K2-001',
      creationCode: 'A7K2-001',
      customerName: 'Rizk',
      problem: 'Dryer — not heating',
      city: 'Waterford', state: 'MI',
      scheduledDate: '2026-11-07', scheduledTime: '9:00 AM',
      services: [{ description: 'Diagnostic', priceCents: 5000 }],
      parts: [],
      payments: [],
      servicesTotalCents: 5000,
      partsTotalCents: 0,
      estimateDiagnosticCents: 5000,
      estimatePartsCents: 0,
      estimateLaborCents: 0,
      estimateUrgencyCents: 0,
      urgency: 'Standard',
      totalCents: 5000,
      demo: true
    };
  }

  // Display number: the work-order code (#A7K2-001) when the job has
  // one, otherwise '—'. Never called "work order code" on the page —
  // it is just Work Order #… (James, Nov 7, 2026). The code is shown
  // exactly as the backend returns it (new XXXX-001 system, Nov 13,
  // 2026; legacy codes pass through untouched). An old internal record
  // id (#MMDD-NN style) is never visible text — if no code is known
  // for this order, show '—' rather than the internal id.
  function displayNumber(wo) {
    if (!wo) return '—';
    var c = function (v) { var x = trim(v).replace(/^#/, '').toUpperCase(); if (!x || /^\d{4}-\d{2}$/.test(x)) return ''; return x; };
    var n = c(wo.workOrderCode || wo.work_order_code) || c(wo.creationCode || wo.creation_code) || c(wo.displayId) || c(wo.id);
    return n ? '#' + n : '—';
  }

  // --- Appointment block display (James, Nov 7, 2026) ----------------------
  // Same rule as the Create page: the customer books a 2-hour window,
  // so show the block ("9:00–11:00 AM"), never just the start time,
  // and the date as "Sat, Nov 7, 2026", never the raw Date string.
  // Stored times are block starts; a time off a block boundary still
  // shows start–start+2h — never invent a different block. A value
  // that is already a block ("8:00-10:00 AM") renders as-is, normalised.
  function apptMinutes(t) {
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
  function apptBlock(t) {
    if (!trim(t)) return null;
    var parts = String(t).split('-');
    var apOf = function (x) { var m = String(x).match(/([AP]M)\s*$/i); return m ? m[1].toUpperCase() : ''; };
    var startPart = parts[0], endPart = parts.length > 1 ? parts[1] : '';
    if (!apOf(startPart) && apOf(endPart)) startPart = startPart + ' ' + apOf(endPart);
    if (!apOf(endPart) && apOf(startPart)) endPart = endPart + ' ' + apOf(startPart);
    var start = apptMinutes(startPart);
    if (start === null) return null;
    var end = endPart ? apptMinutes(endPart) : null;
    return { start: start, end: (end !== null && end > start) ? end : start + 120 };
  }
  function apptTimeText(mins) {
    var h = Math.floor(mins / 60) % 24;
    var m = mins % 60;
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  function displayAppointmentBlock(t) {
    var s = trim(t);
    if (!s) return '';
    var blk = apptBlock(s);
    if (!blk) return s;
    var startTxt = apptTimeText(blk.start);
    var endTxt = apptTimeText(blk.end);
    if (startTxt.slice(-2) === endTxt.slice(-2)) return startTxt.slice(0, -3) + '–' + endTxt;
    return startTxt + '–' + endTxt;
  }
  function formatApptDate(d) {
    var s = trim(d);
    if (!s) return '';
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    var dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
    if (isNaN(dt.getTime())) return s;
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function displayAppointment(dateText, timeText) {
    var d = formatApptDate(dateText);
    var t = displayAppointmentBlock(timeText);
    return [d, t].filter(function (x) { return x; }).join(' ');
  }

  function backendUrl() { return trim(CFG.BACKEND_URL); }
  function apiKey() { return trim(CFG.WO_API_KEY); }

  // One backend call. GET for reads, POST for actions. Returns the
  // parsed JSON, or { ok:false, error } on any failure — never throws
  // into the page, so a dead backend shows an honest note instead of
  // a broken page.
  function callBackend(action, body, cb) {
    var url = backendUrl();
    if (!url) { cb({ ok: false, error: 'BACKEND_NOT_CONFIGURED' }); return; }
    var opts = { method: body ? 'POST' : 'GET', headers: {}, cache: 'no-store' };
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

  function render(wo, stage) {
    var t = totalsFor(wo, stage);
    var amt = stageAmountCents(wo, stage);
    setText('pay-wo', 'Work Order ' + displayNumber(wo));
    setText('pay-customer', wo.customerName || '—');
    setText('pay-problem', wo.problem || '—');
    setText('pay-when', displayAppointment(wo.scheduledDate, wo.scheduledTime) || '—');
    setText('pay-where', [wo.city, wo.state].filter(Boolean).join(', ') || '—');
    setText('pay-stage', stageLabel(stage));
    setText('pay-stage-desc', stageDescription(stage));
    var lines = el('pay-lines');
    if (lines) {
      var rows = '';
      /* Deep Dive 4, Problem 19 — the invoice rows are the frozen
       * bill when one went out (same billedLines split as
       * totalsFor): a part added after billing must not appear here
       * with a price the frozen total does not include. */
      var billedLines = (num(wo.billedTotalCents) > 0 && wo.billedLines) ? wo.billedLines : null;
      var lineServices = billedLines ? billedLines.services : wo.services;
      var lineParts = billedLines ? billedLines.parts : wo.parts;
      (lineServices || []).forEach(function (s) {
        rows += '<tr><td>' + esc(s.description) + '</td><td>' + money(s.priceCents) + '</td></tr>';
      });
      (lineParts || []).forEach(function (p) {
        rows += '<tr><td>Part — ' + esc(p.name || p.partName || 'Part') + (p.qty ? ' × ' + p.qty : '') + '</td><td>' + money(num(p.unitPriceCents) * num(p.qty, 1)) + '</td></tr>';
      });
      if (t && t.urgency) rows += '<tr><td>Urgency (' + esc(t.urgencyName) + ')</td><td>' + money(t.urgency) + '</td></tr>';
      if (t) {
        rows += '<tr><td>Tax (6%)</td><td>' + money(t.tax) + '</td></tr>';
        rows += '<tr><td>Square fee</td><td>' + money(t.fee) + '</td></tr>';
      }
      if (t) {
        rows += '<tr><td>Already paid</td><td>−' + money(t.paidStage) + '</td></tr>';
        rows += '<tr class="total"><td>Total due' + (stage === 'diagnosis' ? ' for this step' : ' (balance)') + '</td><td>' + money(amt) + '</td></tr>';
      }
      lines.innerHTML = rows || '<tr><td>Diagnostic</td><td>$50.00</td></tr>';
    }
    setText('pay-amount', money(amt));
    show('agree-block', stage === 'closing');
  }

  // Failed load: error only — never render the demo example as if it
  // were the customer's real work order. Details stay blank, the
  // amount stays blank, and Pay Now stays disabled.
  function renderLoadError(note) {
    setText('pay-wo', 'Work Order —');
    setText('pay-customer', '—');
    setText('pay-problem', '—');
    setText('pay-when', '—');
    setText('pay-where', '—');
    var lines = el('pay-lines');
    if (lines) lines.innerHTML = '';
    setText('pay-amount', '—');
    show('agree-block', false);
    setSquareState('error', note);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function setSquareState(state, note) {
    // state: 'not-configured' | 'ready' | 'busy' | 'error' | 'paid'
    // ('paid' disables the button after a payment lands — nothing
    // left to pay — and shows the thank-you note.)
    var btn = el('pay-now-btn');
    if (btn) btn.disabled = (state !== 'ready');
    setText('square-note', note || '');
    show('square-not-configured', state === 'not-configured');
  }

  // --- Embedded card form (v2.8) — DOM wiring ------------------------
  // Which way the Pay Now button pays: 'embedded' once the Square
  // card form is attached, 'link' otherwise (the fallback).
  var payMode = 'link';
  var cardHandle = null;

  // Load Square's SDK script. Calls back false if the script cannot
  // load (or the URL is null — production in v2.8) so the page falls
  // back to the payment link instead of a dead form.
  function loadSquareSdk(url, cb) {
    if (!url) { cb(false); return; }
    if (global.Square) { cb(true); return; }
    var s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = function () { cb(!!global.Square); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  // Card-field styling, to match the page (dark #0d0d0d, teal accent).
  // These style the Square iframes from the outside — the fields
  // themselves stay Square-hosted.
  // SQUARE ALLOWLIST (Web Payments SDK v1.87.2, read from the served
  // square.js source Nov 14, 2026 — the SDK rejects the WHOLE card
  // form when one selector carries a property outside its list, and
  // the page falls back to the payment link): `.input-container`
  // accepts ONLY borderColor / borderRadius / borderWidth.
  // `backgroundColor` there made payments.card() reject on the live
  // page (Nov 14: the form never rendered, "Card fields could not
  // load"). The card area's background comes from `input`'s
  // backgroundColor instead — the SDK maps that onto the iframe
  // container — so the dark #171e1b surface lives there. Never put
  // backgroundColor (or anything else) back on `.input-container`.
  function cardFormStyle() {
    return {
      input: { fontSize: '15.5px', fontFamily: 'Barlow, system-ui, sans-serif', color: '#eef3f1', backgroundColor: '#171e1b' },
      '.input-container': { borderColor: '#3d4b47', borderRadius: '8px' },
      '.input-container.is-focus': { borderColor: '#35917f' },
      '.input-container.is-error': { borderColor: '#e07a6e' },
      '.message-text': { color: '#e07a6e' }
    };
  }

  // Step-1 wording depends on the mode: the embedded form IS on this
  // page, the link opens Square's checkout. The old "We never ask for
  // your card on this page" line is only true for the link mode.
  function setStepText(mode) {
    var n = el('step-1');
    if (!n) return;
    n.innerHTML = mode === 'embedded'
      ? '<strong>Pay by card</strong> below — the card fields send your details straight to Square, never to us.'
      : '<strong>Pay Now</strong> opens Square’s secure checkout — your card details go straight to Square, never to us. We never ask for your card on this page.';
  }

  // The embedded form cannot render (no Application ID yet) — show
  // the card area with an honest note, not a crash and not a dead
  // form. The Pay Now button below still pays via Square's checkout.
  function showCardUnavailable(note) {
    show('card-section', true);
    var c = el('card-container');
    if (c) c.innerHTML = '';
    setText('card-note', note);
  }

  // Fall back to the payment link: the button opens Square's checkout.
  // Leaves the card section alone — if showCardUnavailable already put
  // its note up, it stays visible.
  function enableLinkPay(note) {
    payMode = 'link';
    cardHandle = null;
    setStepText('link');
    var btn = el('pay-now-btn');
    if (btn) btn.textContent = 'Pay Now with Square';
    setSquareState('ready', note || 'Pay securely with Square — your card details go straight to Square, never to us.');
  }

  // Render Square's card form into #card-container and switch the Pay
  // Now button to the embedded flow. Any failure here falls back to
  // the payment link — the customer always has a way to pay.
  function initEmbeddedCard(status, wo, stage, amt) {
    var payments;
    try {
      payments = global.Square.payments(status.appId, status.locationId);
    } catch (e) {
      enableLinkPay('Card fields could not load — Pay Now opens Square’s secure checkout instead.');
      return;
    }
    payments.card({ style: cardFormStyle() }).then(function (card) {
      return card.attach('#card-container').then(function () { return card; });
    }).then(function (card) {
      cardHandle = card;
      payMode = 'embedded';
      show('card-section', true);
      setText('card-note', '');
      setStepText('embedded');
      var btn = el('pay-now-btn');
      if (btn) btn.textContent = 'Pay ' + money(amt);
      setSquareState('ready', 'Your card details go straight to Square, never to us.');
    }).catch(function () {
      enableLinkPay('Card fields could not load — Pay Now opens Square’s secure checkout instead.');
    });
  }

  // The old flow, unchanged: mint a Square payment link and open it.
  function payWithLink(wo, stage) {
    setSquareState('busy', 'Opening Square’s secure checkout…');
    var amt = stageAmountCents(wo, stage);
    callBackend('createSquarePaymentLink', { workOrderId: wo.id, stage: stage, amountCents: amt }, function (r) {
      if (r && r.ok && (r.url || r.longUrl)) {
        global.open(r.url || r.longUrl, '_blank');
        /* Deep Dive 4, Problem 20 — the agree block is
         * closing-only: forcing it open after ANY Pay Now click
         * let a diagnosis-stage customer record a diagnosis
         * acceptance believing it was the close-unlocking ping. */
        if (stage === 'closing') {
          setSquareState('ready', 'Square checkout opened in a new tab. Once you have paid, tap “I agree to the payment” below.');
          show('agree-block', true);
        } else {
          setSquareState('ready', 'Square checkout opened in a new tab. Once you have paid, come back here — the page will show the updated balance.');
        }
      } else if (r && r.error === 'SQUARE_NOT_CONFIGURED') {
        setSquareState('not-configured', 'Square is not set up yet — the payment link will appear here once Square is connected. No payment has been taken.');
      } else {
        setSquareState('error', 'Square could not start a payment right now. Please try again, or call (248) 429-9878.');
      }
    });
  }

  // After a card payment lands: re-load the order so the balance and
  // paid state are live, then show the paid state. The receipt itself
  // is sent by the backend when the payment is recorded.
  function refreshAfterPayment(wo, stage) {
    var url = backendUrl() + '?action=getWorkOrder&workOrderId=' + encodeURIComponent(wo.id);
    if (apiKey()) url += '&apiKey=' + encodeURIComponent(apiKey());
    var done = function (j) {
      if (j && j.ok && j.workOrder) render(j.workOrder, stage);
      setSquareState('paid', 'Payment received — thank you. Your receipt is on its way.');
      if (stage === 'closing') show('agree-block', true);
    };
    global.fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(done)
      .catch(function () { done(null); });
  }

  // Embedded flow: tokenize the card to a one-time nonce, then charge
  // it through the backend. The card number never leaves Square's
  // iframes — this code only ever sees the nonce.
  function payWithCard(card, wo, stage) {
    setSquareState('busy', 'Processing your payment…');
    setText('card-note', '');
    card.tokenize().then(function (result) {
      if (!result || result.status !== 'OK' || !result.token) {
        setSquareState('ready', 'Your card details go straight to Square, never to us.');
        setText('card-note', cardErrorText(result && result.errors));
        return;
      }
      callBackend('chargeCard', chargeCardPayload(wo.id, stage, result.token), function (r) {
        if (r && r.ok) {
          refreshAfterPayment(wo, stage);
        } else if (r && r.error === 'SQUARE_NOT_CONFIGURED') {
          setSquareState('not-configured', 'Square is not set up yet — the payment link will appear here once Square is connected. No payment has been taken.');
        } else if (r && r.error === 'SQUARE_CARD_NOT_AVAILABLE') {
          enableLinkPay('Card payments on this page are not available right now — Pay Now opens Square’s secure checkout instead.');
        } else if (r && r.error && String(r.error).indexOf('Nothing is due') === 0) {
          refreshAfterPayment(wo, stage);
        } else {
          setSquareState('ready', 'Your card details go straight to Square, never to us.');
          setText('card-note', chargeErrorText(r));
        }
      });
    }).catch(function () {
      setSquareState('ready', 'Your card details go straight to Square, never to us.');
      setText('card-note', 'Square could not read that card. Please check the details and try again.');
    });
  }

  function init() {
    var params = {};
    try {
      var q = new URLSearchParams(global.location.search);
      params = { workOrder: q.get('workOrder') || '', stage: q.get('stage') || '', key: q.get('key') || '' };
    } catch (e) { params = { workOrder: '', stage: '', key: '' }; }
    var stage = parseStage(params);
    /* Deep Dive 4, Problem 20 — no stage in the link: pick it from
     * the order once it loads (diagnosis while that step is unpaid),
     * instead of always landing on "Closing payment". */
    var stageGiven = ['diagnosis', 'closing'].indexOf(trim(params.stage).toLowerCase()) >= 0;
    var woId = trim(params.workOrder);
    var pageKey = trim(params.key); // v2.4: token-gates acceptReceipt

    if (!backendUrl()) {
      // Demo mode: Rizk example, honestly labelled. Pay Now stays
      // disabled — Square is not configured and no backend exists yet.
      render(demoWorkOrder(stage), stage);
      setSquareState('not-configured', 'Square is not set up yet — the payment link will appear here once Square is connected. No payment has been taken.');
      setText('agree-note', '');
      return;
    }

    if (!woId) {
      renderLoadError('No work order was linked to this page. Open it from the Pay Now link in your receipt email.');
      return;
    }

    setText('pay-amount', 'Loading…');
    // getWorkOrder is a GET: build it directly (callBackend only POSTs
    // with a body, so the GET goes here). cache: no-store — the page
    // must show the live order every open (a bill sent after the
    // customer got the link still shows up). (v1.2)
    var url = backendUrl() + '?action=getWorkOrder&workOrderId=' + encodeURIComponent(woId);
    if (apiKey()) url += '&apiKey=' + encodeURIComponent(apiKey());
    global.fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok || !j.workOrder) {
        renderLoadError('We could not load that work order. Please use the Pay Now link in your receipt email, or call (248) 429-9878.');
        return;
      }
      var wo = j.workOrder;
      if (!stageGiven) stage = stageForOrder(wo);
      render(wo, stage);
      var amt = stageAmountCents(wo, stage);
      // Check Square before enabling Pay Now. v2.8: when the backend
      // says card payments are ready (configured + Application ID +
      // sandbox), load Square's SDK and render the card form on this
      // page; otherwise the Pay Now button pays via the Square link.
      callBackend('getSquareStatus', null, function (s) {
        if (amt <= 0) {
          setSquareState('error', 'Nothing is due for this step — no payment needed.');
        } else if (s && s.ok && s.configured) {
          if (s.cardPayments && s.appId && s.locationId) {
            loadSquareSdk(squareSdkUrl(s.environment), function (loaded) {
              if (loaded) initEmbeddedCard(s, wo, stage, amt);
              else enableLinkPay('Card fields could not load — Pay Now opens Square’s secure checkout instead.');
            });
          } else {
            showCardUnavailable('Card payments on this page are not set up yet — use Pay Now below to pay on Square’s secure checkout.');
            enableLinkPay('Pay securely with Square — your card details go straight to Square, never to us.');
          }
        } else {
          setSquareState('not-configured', 'Square is not set up yet — the payment link will appear here once Square is connected. No payment has been taken.');
        }
      });
      var btn = el('pay-now-btn');
      if (btn) btn.onclick = function () {
        if (payMode === 'embedded' && cardHandle) { payWithCard(cardHandle, wo, stage); return; }
        payWithLink(wo, stage);
      };
      var agreeBtn = el('agree-btn');
      if (agreeBtn) agreeBtn.onclick = function () {
        /* v2.4 (Track B): acceptReceipt is token-gated. Without the
         * token (e.g. arrived from the track page by code only) the
         * ping cannot be recorded — point at the agree link in the
         * closing receipt email, which carries it. */
        if (!pageKey) {
          setText('agree-note', 'Please use the "I agree to the payment" link in your closing receipt email — it carries the agreement for this order.');
          return;
        }
        agreeBtn.disabled = true;
        setText('agree-note', 'Sending your agreement…');
        callBackend('acceptReceipt', { workOrderId: wo.id, token: pageKey, stage: stage }, function (r) {
          if (r && r.ok) {
            setText('agree-note', 'Your agreement has been sent back to us.');
            show('agree-done', true);
          } else {
            agreeBtn.disabled = false;
            setText('agree-note', 'That did not go through. Please try again, or reply to your receipt email instead.');
          }
        });
      };
    }).catch(function () {
      renderLoadError('We could not reach the payment page backend. No payment has been taken — please call (248) 429-9878.');
    });
  }

  global.FCPPay = {
    parseStage: parseStage, stageLabel: stageLabel, stageDescription: stageDescription,
    stageAmountCents: stageAmountCents, stageForOrder: stageForOrder, totalsFor: totalsFor, payLink: payLink,
    billTotals: billTotals,
    squareSdkUrl: squareSdkUrl, isCardNonce: isCardNonce, chargeCardPayload: chargeCardPayload,
    cardFormStyle: cardFormStyle,
    cardErrorText: cardErrorText, chargeErrorText: chargeErrorText,
    demoWorkOrder: demoWorkOrder, displayNumber: displayNumber, money: money,
    displayAppointmentBlock: displayAppointmentBlock, formatApptDate: formatApptDate,
    displayAppointment: displayAppointment,
    PAY_PAGE_URL: PAY_PAGE_URL
  };

  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : global);
