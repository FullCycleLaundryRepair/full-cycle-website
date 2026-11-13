// Full Cycle Laundry Repair — Track Your Work Order page logic.
// Loaded by track.html after config.js (same folder as the Work Order
// Creation page, same GitHub site: fullcyclelaundryrepair.github.io/
// full-cycle-website/track.html?workOrder=<code>).
//
// WHAT THIS PAGE IS: a per-code lookup. The client types their work
// order code (A7K2-001, from the confirmation email) and sees ONLY
// that one order: status, problem, scheduled date/time, parts, payments,
// totals, plus links to the Pay Now and agreement pages for that order.
// WHAT IT IS NOT: it never lists orders. There is no sign-in on this
// site, so a list would show everyone's orders to everyone — this page
// never calls listWorkOrders, only getWorkOrder with the typed code.
// Pure functions are exposed on window.FCTrack so they can be tested
// headlessly; DOM wiring only runs when `document` exists.
(function (global) {
  'use strict';

  var CFG = (global.FCP_CONFIG || {});
  var PAY_PAGE_URL = CFG.PAY_PAGE_URL || 'https://fullcyclelaundryrepair.github.io/full-cycle-website/pay.html';
  var AGREEMENT_PAGE_URL = CFG.AGREEMENT_PAGE_URL || 'https://fullcyclelaundryrepair.github.io/full-cycle-website/agreement.html';

  function trim(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }
  function money(cents) { return '$' + (num(cents) / 100).toFixed(2); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // The code as the client types it: "a7k2-001", "#A7K2-001",
  // "A7K2 001" all become "A7K2-001". Legacy codes pass through
  // untouched too: "hd7x-000b" stays "HD7X-000B", bare "TD5W" stays
  // "TD5W", and an internal id "#1126-01" stays "1126-01" — the
  // backend resolves every format, so this only tidies the display
  // + URL, never rejects a format. A dashless code just gets its dash
  // back (7 chars = new XXXX-001, 8 chars = legacy XXXX-XXXX).
  function normalizeCode(v) {
    var c = trim(v).toUpperCase().replace(/\s+/g, '');
    if (c.charAt(0) === '#') c = c.slice(1);
    if (/^[A-Z0-9]{7,8}$/.test(c)) c = c.slice(0, 4) + '-' + c.slice(4);
    return c;
  }

  function statusLabel(wo) {
    if (!wo) return '—';
    if (wo.closed) return 'Closed';
    return wo.status || 'Open';
  }

  // Bill math (v1.2, James, Nov 12, 2026) — ONE formula everywhere the
  // bill total appears (billing page, pay.html, this balance). Subtotal
  // = services + parts. Tax 6% on the subtotal. Square fee 3.3% + 30¢
  // on the whole ticket (subtotal + tax). No tax/fee on $0.
  function billTotals(subtotalCents) {
    var sub = Math.max(0, Math.round(num(subtotalCents)));
    if (!sub) return { subtotalCents: 0, taxCents: 0, squareFeeCents: 0, totalCents: 0 };
    var tax = Math.round(sub * 0.06);
    var fee = Math.round((sub + tax) * 0.033) + 30;
    return { subtotalCents: sub, taxCents: tax, squareFeeCents: fee, totalCents: sub + tax + fee };
  }

  function totalsFor(wo) {
    if (!wo) return null;
    var paid = 0;
    (wo.payments || []).forEach(function (p) { paid += num(p.amountCents); });
    var bt = billTotals(num(wo.servicesTotalCents) + num(wo.partsTotalCents));
    /* v2.1 — the frozen billed total wins when a bill went out (Deep Dive
     * 3, Problem 10): the balance is the billed total minus paid, never
     * a live recompute after parts changed. Otherwise the bill formula
     * over the current services + parts. */
    var billed = num(wo.billedTotalCents) > 0;
    var total = billed ? num(wo.billedTotalCents) : num(wo.totalCents) + bt.taxCents + bt.squareFeeCents;
    /* Deep Dive 4, Problem 19 — when billed, the services/parts split
     * comes from the frozen billedLines (mirror of the backend's
     * woBillBalance), not the live totals: a part added after billing
     * must not move the rows while the total stays frozen. */
    var servicesCents = num(wo.servicesTotalCents), partsCents = num(wo.partsTotalCents);
    if (billed && wo.billedLines) {
      servicesCents = 0; partsCents = 0;
      (wo.billedLines.services || []).forEach(function (s) { servicesCents += num(s.priceCents); });
      (wo.billedLines.parts || []).forEach(function (pp) { partsCents += num(pp.qty, 1) * num(pp.unitPriceCents); });
    }
    return {
      servicesCents: servicesCents,
      partsCents: partsCents,
      taxCents: billed ? num(wo.billedTaxCents) : bt.taxCents,
      feeCents: billed ? num(wo.billedFeeCents) : bt.squareFeeCents,
      totalCents: total,
      paidCents: paid,
      balanceCents: Math.max(0, total - paid)
    };
  }

  /* Deep Dive 4, Problem 20 — the pay stage the customer still owes
   * for: diagnosis while the diagnosis step is unpaid, else closing.
   * The pay link carries it, so the customer lands on "Bill payment"
   * instead of "Closing payment" before the diagnosis bill is paid. */
  function payStage(wo) {
    if (!wo) return 'closing';
    var t = totalsFor(wo);
    var diagPaid = 0;
    (wo.payments || []).forEach(function (p) { if (p.stage === 'diagnosis') diagPaid += num(p.amountCents); });
    return Math.max(0, t.totalCents - diagPaid) > 0 ? 'diagnosis' : 'closing';
  }

  function backendUrl() { return trim(CFG.BACKEND_URL); }
  function apiKey() { return trim(CFG.WO_API_KEY); }

  function fetchWorkOrder(code, cb) {
    var url = backendUrl() + '?action=getWorkOrder&workOrderId=' + encodeURIComponent(code);
    if (apiKey()) url += '&apiKey=' + encodeURIComponent(apiKey());
    // cache: no-store — the track link must show the live order every
    // open (a bill sent after the customer got the link still shows
    // up: new charges, amount due, payment status). (v1.2)
    global.fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { cb(null, j); })
      .catch(function (err) { cb(err); });
  }

  // DOM wiring (skipped headlessly).
  function $(id) { return global.document.getElementById(id); }
  function show(el, on) { if (el) el.style.display = on ? '' : 'none'; }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }

  function partsHtml(wo) {
    var parts = wo.parts || [];
    if (!parts.length) return '<p class="empty-note">No parts on this order yet.</p>';
    var rows = parts.map(function (p) {
      var price = num(p.qty, 1) * num(p.unitPriceCents);
      return '<tr><td>' + esc(p.name) + (p.qty > 1 ? ' ×' + p.qty : '') + '<br><span class="faint">' + esc(p.status || '') + '</span></td><td>' + money(price) + '</td></tr>';
    }).join('');
    return '<table class="rows"><thead><tr><th>Part</th><th>Price</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function paymentsHtml(wo) {
    var pays = wo.payments || [];
    if (!pays.length) return '<p class="empty-note">No payments recorded yet.</p>';
    var rows = pays.map(function (p) {
      var label = (p.stage === 'diagnosis' ? 'Diagnosis' : p.stage === 'closing' ? 'Closing' : (p.stage || 'Payment'))
        + ' · ' + (p.method || '—');
      return '<tr><td>' + esc(label) + '<br><span class="faint">' + esc(p.paidAt || '') + '</span></td><td>' + money(p.amountCents) + '</td></tr>';
    }).join('');
    return '<table class="rows"><thead><tr><th>Payment</th><th>Amount</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }


  /* v2.5 — diagnostic report, photos, notes (James, Nov 13, 2026).
   * Headers + values only — no admin language, no builder language.
   * The approval is a STATE here: the track page carries no token, so
   * the tap that records approval lives in the bill message (token-
   * carrying link, backend woApproveDiagnosisPage / acceptReceipt).
   * Photos are this order's only — the backend load filters by
   * work_order_id, so another order's photos can never render here. */
  function diagnosisHtml(wo) {
    if (!wo.diagnosis) return '<p class="empty-note">No diagnostic report yet.</p>';
    var t = totalsFor(wo);
    var rows = '';
    (wo.services || []).forEach(function (sv) { rows += '<tr><td>' + esc(sv.description) + '</td><td>' + money(sv.priceCents) + '</td></tr>'; });
    (wo.parts || []).forEach(function (pp) { rows += '<tr><td>' + esc(pp.name) + (pp.qty > 1 ? ' \u00d7' + pp.qty : '') + '</td><td>' + money(num(pp.qty, 1) * num(pp.unitPriceCents)) + '</td></tr>'; });
    var approval = wo.diagnosisApproved ? 'Approved' : 'Awaiting approval';
    return '<p>' + esc(wo.diagnosis) + '</p>'
      + (rows ? '<table class="rows"><thead><tr><th>Item</th><th>Price</th></tr></thead><tbody>' + rows + '</tbody></table>' : '')
      + '<table class="money"><tbody>'
      + '<tr><td>Subtotal</td><td>' + money(t.servicesCents + t.partsCents) + '</td></tr>'
      + '<tr><td>Tax (6%)</td><td>' + money(t.taxCents) + '</td></tr>'
      + '<tr><td>Square fee</td><td>' + money(t.feeCents) + '</td></tr>'
      + '<tr class="total"><td>Total</td><td>' + money(t.totalCents) + '</td></tr>'
      + '<tr><td>Approval</td><td>' + esc(approval) + '</td></tr>'
      + '</tbody></table>';
  }

  function photosHtml(wo) {
    var photos = wo.photos || [];
    if (!photos.length) return '<p class="empty-note">No photos on this order yet.</p>';
    var items = photos.map(function (ph) {
      return '<a href="' + esc(ph.url) + '" target="_blank" rel="noopener"><img src="' + esc(ph.thumbnailUrl || ph.url) + '" alt="' + esc(ph.caption || '') + '" style="width:96px;height:96px;object-fit:cover;border-radius:8px;margin:0 8px 8px 0;border:1px solid #33413d;"></a>';
    }).join('');
    return '<div>' + items + '</div>';
  }

  function notesHtml(wo) {
    if (!wo.notes) return '<p class="empty-note">No notes on this order yet.</p>';
    return '<p>' + esc(wo.notes) + '</p>';
  }

  function render(wo) {
    var code = wo.workOrderCode || wo.creationCode || '';
    setText('track-wo', 'Work Order #' + code);
    var st = $('track-status');
    if (st) { st.textContent = statusLabel(wo); st.className = 'v ' + (wo.closed ? 'status-closed' : 'status-open'); }
    setText('track-problem', wo.problem || '—');
    setText('track-when', (wo.scheduledDateDisplay || wo.scheduledDate || '—') + (wo.scheduledTime ? ' at ' + wo.scheduledTime : ''));
    setText('track-appliance', [wo.applianceBrand, wo.applianceModel].filter(function (x) { return x; }).join(' ') || '—');
    var dg = $('track-diagnosis'); if (dg) dg.innerHTML = diagnosisHtml(wo);
    var ph = $('track-photos'); if (ph) ph.innerHTML = photosHtml(wo);
    var nt = $('track-notes'); if (nt) nt.innerHTML = notesHtml(wo);
    var pe = $('track-parts'); if (pe) pe.innerHTML = partsHtml(wo);
    var pa = $('track-payments'); if (pa) pa.innerHTML = paymentsHtml(wo);
    var t = totalsFor(wo);
    var te = $('track-totals');
    if (te) {
      te.innerHTML = '<tr><td>Services</td><td>' + money(t.servicesCents) + '</td></tr>'
        + '<tr><td>Parts</td><td>' + money(t.partsCents) + '</td></tr>'
        + ((t.servicesCents + t.partsCents) > 0
          ? '<tr><td>Tax (6%)</td><td>' + money(t.taxCents) + '</td></tr>'
          + '<tr><td>Square fee</td><td>' + money(t.feeCents) + '</td></tr>' : '')
        + '<tr><td>Total paid</td><td>' + money(t.paidCents) + '</td></tr>'
        + '<tr class="total"><td>Balance due</td><td>' + money(t.balanceCents) + '</td></tr>';
    }
    var pl = $('track-pay-link'); if (pl) pl.href = PAY_PAGE_URL + '?workOrder=' + encodeURIComponent(code) + '&stage=' + payStage(wo);
    var al = $('track-agreement-link'); if (al) al.href = AGREEMENT_PAGE_URL + '?workOrder=' + encodeURIComponent(code);
    show($('track-result'), true);
  }

  function showError(msg) {
    var el = $('track-error');
    if (el) { el.textContent = msg; show(el, true); }
    show($('track-result'), false);
  }

  function lookup(rawCode) {
    var code = normalizeCode(rawCode);
    show($('track-error'), false);
    if (!code) { showError('Enter your work order code — it looks like A7K2-001.'); return; }
    if (!backendUrl()) { showError('Tracking is not connected yet — please try again shortly.'); return; }
    var btn = $('track-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Looking up…'; }
    fetchWorkOrder(code, function (err, j) {
      if (btn) { btn.disabled = false; btn.textContent = 'Look up'; }
      if (err || !j || !j.ok || !j.workOrder) {
        showError('We could not find that work order code. Check the code from your confirmation email and try again.');
        return;
      }
      render(j.workOrder);
    });
  }

  if (global.document) {
    global.document.addEventListener('DOMContentLoaded', function () {
      var btn = $('track-btn');
      var input = $('track-code');
      if (btn) btn.addEventListener('click', function () { lookup(input ? input.value : ''); });
      if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); lookup(input.value); } });
      // Deep link: ?workOrder=<code> prefills + looks up.
      try {
        var q = new URLSearchParams(global.location.search);
        var pre = normalizeCode(q.get('workOrder') || '');
        if (pre) { if (input) input.value = pre; lookup(pre); }
      } catch (e) { /* no query support — manual lookup still works */ }
    });
  }

  global.FCTrack = { normalizeCode: normalizeCode, money: money, statusLabel: statusLabel, totalsFor: totalsFor, billTotals: billTotals, payStage: payStage, diagnosisHtml: diagnosisHtml, photosHtml: photosHtml, notesHtml: notesHtml };
})(typeof window !== 'undefined' ? window : global);
