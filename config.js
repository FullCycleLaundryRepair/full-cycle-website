// Full Cycle Plus — Work Order Creation page
// ===========================================================
// SINGLE CONFIG FILE. This is the ONLY place the backend address lives.
// Set BACKEND_URL to the deployed Apps Script web-app /exec URL (and
// WO_API_KEY to the matching Script Property) when the backend is deployed.
// SHARED BACKEND LOCK: this page and the Work Orders app share ONE backend
// / ONE source of truth — the standalone work-order backend
// (plus-work-order-backend/Code.gs, interim business account). A work order
// created here appears in the app; a change made in the app shows in the
// shared data. Same BACKEND_URL value in both pieces, same action names
// (createWorkOrder, getDaySchedule, ...). No separate copies, no divergent
// data. See SYNC-LOCK.md in this folder.
//
// This page is a verbatim port of the "Create a Work Order" tab of the
// four-tab Full Cycle Plus Work Orders app — same fields, order, labels,
// placeholders, validation, and city -> ZIP autofill. It issues NO
// work-order code (like the tab, it passes empty code inputs); a code is
// generated later from the work order detail / admin side.
//
// Until the backend is deployed both stay empty and the page runs in
// DEMO / LOCAL mode: it validates, shows the confirmation screen, and
// saves the submission to this browser's localStorage with a clear "not
// yet sent to the backend" note. It NEVER fakes a live connection, and
// it NEVER invents a work-order number or code.

window.FCP_CONFIG = {
  // Apps Script web-app URL, e.g. 'https://script.google.com/macros/s/XXXX/exec'
  // Empty = demo/local mode (backend NOT deployed yet).
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbyl7w09du00Zniz_eUXzoITQluUjT56s3gqdnazzg5xnuOPNpFlQVZzTWx8FTfW8UNm/exec',

  // Script Property WO_API_KEY from the backend project. Empty = no key set.
  // Sent as `apiKey` on every call when non-empty. Never put a real key in
  // a public repo — set it here only after the backend is deployed, or
  // keep the page behind your own hosting.
  WO_API_KEY: '62a7fd9be2ac78d6faeba449216fb8fd287cf08f6b941f8e',

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

  // localStorage key for demo-mode submissions (this browser only).
  LOCAL_STORAGE_KEY: 'fcp_customer_work_orders'
};
