// Full Cycle Laundry Repair — Work Order Creation page
// ===========================================================
// SINGLE CONFIG FILE. This is the ONLY place the backend address lives.
// Set BACKEND_URL to the deployed Apps Script web-app /exec URL (and
// WO_API_KEY to the matching Script Property) when the backend is deployed.
//
// DEDICATED BACKEND (Nov 12, 2026): this page and its pay / agreement /
// track pages talk ONLY to the dedicated GitHub Work Orders backend on
// the Full Cycle Laundry Repair business account
// (script 1MzIQ9TyLNLi0LyjQuGZgNybSeKSKm5vlzYWJaDLX58pPFvmC_Ge03fvF).
// It is NOT the shared Full Cycle Plus backend — nothing here reads or
// writes Plus data. Same action names (createWorkOrder, getDaySchedule,
// ...) as the shared backend, but a different URL, sheet, and key.
//
// This page is a verbatim port of the "Create a Work Order" tab of the
// four-tab Full Cycle Plus Work Orders app — same fields, order, labels,
// placeholders, validation, and city -> ZIP autofill. It issues NO
// work-order code (like the tab, it passes empty code inputs); a code is
// generated later from the work order detail / admin side.

window.FCP_CONFIG = {
  // Apps Script web-app URL, e.g. 'https://script.google.com/macros/s/XXXX/exec'
  // Dedicated GitHub Work Orders backend (business account), deployment @4.
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbwwxlXIYS9NGec6nj1B9E2ojknETKj0XSKne0p0Lgh8X7-WDCP-RkpwL6aIaLMQihMt2A/exec',

  // Script Property WO_API_KEY from the dedicated backend project.
  // Sent as `apiKey` on every call when non-empty. The dedicated
  // backend currently has NO key set (verified live Nov 12, 2026:
  // calls without a key are accepted), so this stays empty until a
  // key is set on the backend via setGithubProps — then paste the
  // same value here. Never put a real key in a public repo.
  WO_API_KEY: '',

  // Service area — the page serves Michigan; State defaults to MI.
  DEFAULT_STATE: 'MI',

  // Service Agreement page — lives alongside this page on the same
  // GitHub site (agreement.html next to index.html). The Appointment
  // Confirmation links here (Section 1, "View and agree to service
  // agreement") with ?workOrder=<id> only. The page shows the full
  // agreement (Sections 1-10), pre-filled from the backend, and submits
  // via submitAgreement (checkbox + typed name + drawn signature).
  AGREEMENT_PAGE_URL: 'https://fullcyclelaundryrepair.github.io/full-cycle-website/agreement.html',
  // (pay.html next to index.html). Receipt emails link to it with
  // ?workOrder=<id>&stage=diagnosis|closing. Its Pay Now button opens
  // Square's secure checkout via the backend's createSquarePaymentLink.
  PAY_PAGE_URL: 'https://fullcyclelaundryrepair.github.io/full-cycle-website/pay.html',

  // Track page — lives alongside this page on the same GitHub site
  // (track.html next to index.html). The customer looks up their own
  // order by work order code (?workOrder=<code>); it never lists orders.
  TRACK_PAGE_URL: 'https://fullcyclelaundryrepair.github.io/full-cycle-website/track.html',

  // localStorage key for demo-mode submissions (this browser only).
  LOCAL_STORAGE_KEY: 'fcp_customer_work_orders'
};
