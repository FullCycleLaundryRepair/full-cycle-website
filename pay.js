// Full Cycle Laundry Repair — Pay Now page logic.
// Loaded by pay.html after config.js (same folder as the Work Order
// Creation page, same GitHub site: fullcyclelaundryrepair.github.io/
// full-cycle-website/pay.html?workOrder=<id>&stage=diagnosis|closing).
//
// WHAT THIS PAGE IS: our page, our format and colors (dark #0d0d0d,
// v11 header, Create-page coloring). It shows the work order and what
// is due, and its Pay Now button opens the Square payment flow.
// WHAT IT IS NOT: it never asks for card details, never embeds a card
// form, never stores a card number. The card is entered on Square's
// own secure checkout page, reached through the backend's
// createSquarePaymentLink. Until Square is configured (Script
// Properties SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID — James sets
// those, no token anywhere in this repo), the button stays disabled
// and the page says so honestly. No live payment is ever faked.
//
// AMOUNTS (never trusted from the URL — always computed from the
// backend work order when configured):
//   diagnosis stage = the bill James sent: every service + part on
//     the order, MI sales tax 6%, Square fee 3.3% + 30¢, minus what is
//     already paid at the diagnosis step. The bill message links here,
//     so this MUST equal the bill total. (v1.2, James, Nov 12, 2026)
//   closing stage   = total − already paid (the balance due)
// In demo mode (no BACKEND_URL yet) the page shows the Rizk example
// (#HD7X-000B, Diagnostic $50, Parts $0, Labor $0, Total $50) and
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
    return stage === 'diagnosis' ? 'Diagnosis payment' : 'Closing payment';
  }

  // What this payment is for, in plain words.
  function stageDescription(stage) {
    return stage === 'diagnosis'
      ? 'Diagnostic visit: $50, plus parts if needed on that visit.'
      : 'Final payment: repair labor $75, plus parts if needed.';
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
  // Diagnosis: the bill — every service + part on the order, tax 6% +
  // Square fee 3.3% + 30¢, minus what is already paid at the diagnosis
  // step. Closing: total − paid.
  function stageAmountCents(wo, stage) {
    if (!wo) return 0;
    if (stage === 'diagnosis') {
      var bt = billTotals(num(wo.servicesTotalCents) + num(wo.partsTotalCents));
      var diagPaid = 0;
      (wo.payments || []).forEach(function (p) { if (p.stage === 'diagnosis') diagPaid += num(p.amountCents); });
      return Math.max(0, bt.totalCents - diagPaid);
    }
    var paid = 0;
    (wo.payments || []).forEach(function (p) { paid += num(p.amountCents); });
    return Math.max(0, num(wo.totalCents) - paid);
  }

  // Totals row for the page, from a loaded backend work order.
  function totalsFor(wo) {
    if (!wo) return null;
    var paid = 0;
    (wo.payments || []).forEach(function (p) { paid += num(p.amountCents); });
    var bt = billTotals(num(wo.servicesTotalCents) + num(wo.partsTotalCents));
    return {
      services: num(wo.servicesTotalCents),
      parts: num(wo.partsTotalCents),
      urgency: num(wo.estimateUrgencyCents),
      urgencyName: wo.urgency || 'Standard',
      tax: bt.taxCents,
      fee: bt.squareFeeCents,
      total: num(wo.totalCents),
      paid: paid,
      due: Math.max(0, num(wo.totalCents) - paid)
    };
  }

  // The Pay Now link for an email / text: our page, work order id +
  // stage as query params. The page itself fetches the live amounts
  // from the backend — the link never carries an amount.
  function payLink(workOrderId, stage) {
    return PAY_PAGE_URL + '?workOrder=' + encodeURIComponent(trim(workOrderId))
      + '&stage=' + (stage === 'diagnosis' ? 'diagnosis' : 'closing');
  }

  // Demo/example work order (Rizk #HD7X-000B) shown only when no
  // backend is configured. Clearly labelled as an example on the page;
  // never presented as a live job. No street address, phone, or gate
  // code — those never belong on a public page.
  function demoWorkOrder(stage) {
    return {
      id: 'HD7X-000B',
      displayId: '#HD7X-000B',
      workOrderCode: 'HD7X-000B',
      creationCode: 'HD7X',
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

  // Display number: the work-order code (#HD7X-000B) when the job has
  // one, otherwise the record id. Never called "work order code" on
  // the page — it is just Work Order #… (James, Nov 7, 2026).
  // Per-order display number: this order's own code when it has one
  // (full code when assigned, creation half when unassigned). An old
  // internal record id (#MMDD-NN style) is never visible text — if no
  // code is known for this order, show '—' rather than the internal id.
  function displayNumber(wo) {
    if (!wo) return '—';
    var c = function (v) { var x = trim(v).replace(/^#/, '').toUpperCase(); return /^[A-Z0-9]{4}(-[A-Z0-9]{4})?$/.test(x) ? x : ''; };
    var full = c(wo.workOrderCode || wo.work_order_code);
    var half = c(wo.creationCode || wo.creation_code);
    var pro = c(wo.proCode || wo.pro_code);
    if (full && full.indexOf('-') >= 0) return '#' + full;
    if ((full || half) && pro && pro.indexOf('-') < 0) return '#' + (full || half) + '-' + pro;
    var n = full || half || c(wo.displayId) || c(wo.id);
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
    var t = totalsFor(wo);
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
      (wo.services || []).forEach(function (s) {
        rows += '<tr><td>' + esc(s.description) + '</td><td>' + money(s.priceCents) + '</td></tr>';
      });
      (wo.parts || []).forEach(function (p) {
        rows += '<tr><td>Part — ' + esc(p.name || p.partName || 'Part') + (p.qty ? ' × ' + p.qty : '') + '</td><td>' + money(num(p.unitPriceCents) * num(p.qty, 1)) + '</td></tr>';
      });
      if (t && t.urgency) rows += '<tr><td>Urgency (' + esc(t.urgencyName) + ')</td><td>' + money(t.urgency) + '</td></tr>';
      if (t && stage === 'diagnosis') {
        rows += '<tr><td>Tax (6%)</td><td>' + money(t.tax) + '</td></tr>';
        rows += '<tr><td>Square fee</td><td>' + money(t.fee) + '</td></tr>';
      }
      if (t) {
        rows += '<tr><td>Already paid</td><td>−' + money(t.paid) + '</td></tr>';
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
    // state: 'not-configured' | 'ready' | 'busy' | 'error'
    var btn = el('pay-now-btn');
    if (btn) btn.disabled = (state !== 'ready');
    setText('square-note', note || '');
    show('square-not-configured', state === 'not-configured');
  }

  function init() {
    var params = {};
    try {
      var q = new URLSearchParams(global.location.search);
      params = { workOrder: q.get('workOrder') || '', stage: q.get('stage') || '' };
    } catch (e) { params = { workOrder: '', stage: '' }; }
    var stage = parseStage(params);
    var woId = trim(params.workOrder);

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
      render(wo, stage);
      var amt = stageAmountCents(wo, stage);
      // Check Square before enabling Pay Now.
      callBackend('getSquareStatus', null, function (s) {
        if (amt <= 0) {
          setSquareState('error', 'Nothing is due for this step — no payment needed.');
        } else if (s && s.ok && s.configured) {
          setSquareState('ready', 'Pay securely with Square — your card details go straight to Square, never to us.');
        } else {
          setSquareState('not-configured', 'Square is not set up yet — the payment link will appear here once Square is connected. No payment has been taken.');
        }
      });
      var btn = el('pay-now-btn');
      if (btn) btn.onclick = function () {
        setSquareState('busy', 'Opening Square’s secure checkout…');
        var amt = stageAmountCents(wo, stage);
        callBackend('createSquarePaymentLink', { workOrderId: wo.id, stage: stage, amountCents: amt }, function (r) {
          if (r && r.ok && (r.url || r.longUrl)) {
            global.open(r.url || r.longUrl, '_blank');
            setSquareState('ready', 'Square checkout opened in a new tab. Once you have paid, tap “I agree to the payment” below.');
            show('agree-block', true);
          } else if (r && r.error === 'SQUARE_NOT_CONFIGURED') {
            setSquareState('not-configured', 'Square is not set up yet — the payment link will appear here once Square is connected. No payment has been taken.');
          } else {
            setSquareState('error', 'Square could not start a payment right now. Please try again, or call (248) 429-9878.');
          }
        });
      };
      var agreeBtn = el('agree-btn');
      if (agreeBtn) agreeBtn.onclick = function () {
        agreeBtn.disabled = true;
        setText('agree-note', 'Sending your agreement…');
        callBackend('acceptReceipt', { workOrderId: wo.id, stage: stage }, function (r) {
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
    stageAmountCents: stageAmountCents, totalsFor: totalsFor, payLink: payLink,
    billTotals: billTotals,
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
