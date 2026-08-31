/*
 * DailyGameTree — Consent Mode v2 defaults, shared across every page.
 *
 * Every page includes this with:
 *   <script src="/tags.js"></script>
 * as the very first thing in <head>, before Google Analytics' and
 * AdSense's own script tags. This has to run first so those tags see
 * "denied" defaults before anything else executes.
 *
 * NOTE: Google Analytics' and AdSense's own <script src="..."> tags are
 * kept as static tags directly in each page, NOT loaded from here.
 * Google's own guidance is explicit that ad/analytics scripts should be
 * plain <script async> tags written into the HTML, not created
 * dynamically via JavaScript — a dynamically-injected script tag bypasses
 * the browser's preload scanner, which can delay (or in the worst case
 * prevent) ads from loading. See:
 * https://developers.google.com/publisher-ads-audits/reference/audits/script-injected-tags
 * So only the logic that ISN'T itself a remote ad/analytics resource
 * lives in this file — the two Google script tags are written directly
 * into each page, right after this one.
 */
(function () {
  'use strict';

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  // Nothing is granted until Google's consent message (AdSense > Privacy &
  // messaging) says otherwise.
  gtag('consent', 'default', {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500
  });
})();
