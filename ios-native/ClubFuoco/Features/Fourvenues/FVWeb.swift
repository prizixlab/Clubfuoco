import SwiftUI
import WebKit

// ── Driving Fourvenues' own pages ────────────────────────────────────────────
//
// Two web views, never one:
//
//  • FVFormRunner — HIDDEN. For anything with no online payment (free entry,
//    pay-at-the-door lists) it fills name + email, ticks the two required
//    terms the guest accepted in OUR sheet, submits, and reads the ticket.
//
//  • FVCheckoutView — VISIBLE. For paid tickets and tables. It must not run a
//    single line of our JavaScript until the money has moved: iOS turns Apple
//    Pay off in any WKWebView the app has injected script into. It only watches
//    URLs, and reads the page once the guest is back from pay.fourvenues.com.
//
// Both hand back the ticket PDF's URL (connector-service.fourvenues.com/
// tickets/<token>/…pdf); FVTicketReader turns that into the door QR.

enum FVJS {
    /// Where are we? Finds the ticket PDF link and whether this is the
    /// confirmation page. Read-only.
    static let probe = """
    (() => {
      const body = document.body ? document.body.innerText : '';
      const pdf = [...document.querySelectorAll('a[href]')].map(a => a.href)
        .find(h => /connector-service\\.fourvenues\\.com\\/tickets\\/.+\\.pdf/i.test(h)) || null;
      const done = /Process completed|Proceso completado|My tickets|Mis entradas/i.test(body);
      const challenge = /verify you are human|captcha|you are now in line/i.test(body)
        || !!document.querySelector('iframe[src*="captcha"], iframe[src*="turnstile"]');
      const hasForm = !!document.getElementById('field-email');
      const needsPhone = !!document.getElementById('field-telefono');
      return JSON.stringify({ pdf, done, challenge, hasForm, needsPhone, url: location.href });
    })()
    """

    /// Fill the attendee form. Values are passed as JSON so a name with a quote
    /// in it cannot break out of the string.
    static func fill(name: String, email: String) -> String {
        let args = (try? String(data: JSONEncoder().encode([name, email]), encoding: .utf8)) ?? "[\"\",\"\"]"
        return """
        (() => {
          const [name, email] = \(args);
          const set = (id, v) => {
            const el = document.getElementById(id); if (!el) return false;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
            ['input', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
            // Their validation lives in inline onchange/onblur handlers on a
            // component that boots AFTER the fields render. Call them directly
            // too, so a fill that lands early still gets validated.
            try { el.onchange && el.onchange(); } catch (e) {}
            try { el.onblur && el.onblur(); } catch (e) {}
            return true;
          };
          // The checkboxes are hidden inputs; Fourvenues toggles them from the
          // wrapping div's onclick. Only the two REQUIRED terms — the guest
          // ticked those in our sheet. Promotions and SMS stay off.
          const tick = id => {
            const el = document.getElementById(id); if (!el) return false;
            if (!el.checked) el.parentElement.click();
            return el.checked;
          };
          const ok = set('field-nombre', name) && set('field-email', email) && set('field-email-confirm', email);
          const terms = tick('checkbox-promotor') && tick('checkbox-fourvenues-condiciones');
          return JSON.stringify({ ok, terms });
        })()
        """
    }

    /// Press the form's submit button: "Sign up on list" for lists, "Download
    /// ticket" for a €0 ticket. Never a button that leads to payment.
    static let submit = """
    (() => {
      const b = [...document.querySelectorAll('button')].find(b => !b.disabled &&
        /sign up|download ticket|apuntar|inscrib|descargar entrada/i.test(b.innerText));
      if (!b) return 'none';
      b.click(); return 'clicked';
    })()
    """

    /// The whole sign-up in one in-page async function (callAsyncJavaScript):
    /// wait for the form, fill, and click the moment validation enables the
    /// button. Their validator boots a beat AFTER the fields render, so the
    /// fill repeats until it takes. Returns 'clicked' or why it could not.
    static let fillAndSubmit = """
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + budgetMs;
    // On success their form does NOT navigate: it posts {key:'openUrl', url}
    // to window.parent, expecting to be embedded in a venue's site. Loaded on
    // its own, parent is this window — so listen here for the confirmation.
    let opened = null;
    window.addEventListener('message', e => {
      const d = e.data;
      if (d && typeof d === 'object' && d.key === 'openUrl' && d.url) opened = d.url;
    });
    const t0 = Date.now();
    const times = {};
    const mark = k => { if (!(k in times)) times[k] = Date.now() - t0; };
    // Result, step timings, and the sign-up response Fourvenues returned to
    // its own page (the booking record — where the ticket code lives).
    const done = r => r + '\t' + JSON.stringify(times) + '\t' +
      (posted ? JSON.stringify(posted.data).slice(0, 60000) : '');
    // Faster than waiting for that message: their send() POSTs through
    // connector.http, then pauses a deliberate second, then posts the message.
    // Watch the POST itself — a response carrying an id IS the confirmation.
    // The wrapper outlives this run (it stays on the page), so it reports
    // through a window-level hook each run re-points at its own variables —
    // a retry on the same page would otherwise never see the answer.
    let posted = null, postFailed = null;
    window.__fvReport = (ok, v) => { if (ok) posted = v; else postFailed = v; };
    const wrapPost = () => {
      const http = window.connector && window.connector.http;
      if (!http || http.__fv) return;
      const orig = http.post.bind(http);
      http.post = async (path, body) => {
        if (/^(listas|tickets|entradas|reservas|bookings)/.test(path)) mark('post');
        try {
          const r = await orig(path, body);
          if (/^(listas|tickets|entradas|reservas|bookings)/.test(path)) { mark('response'); window.__fvReport(true, { path, body, data: (r || {}).data }); }
          return r;
        } catch (e) {
          if (/^(listas|tickets|entradas|reservas|bookings)/.test(path)) { mark('response'); window.__fvReport(false, e); }
          throw e;
        }
      };
      http.__fv = true;
    };
    const body = () => document.body ? document.body.innerText : '';
    while (!document.getElementById('field-email')) {
      if (/verify you are human|captcha|you are now in line/i.test(body())) return done('challenge');
      if (Date.now() > deadline) return done('noform');
      await sleep(60);
    }
    mark('form');
    if (document.getElementById('field-telefono') && !phone) return done('phone');
    // Every pass re-fires the events. Their validator is wired to oninput
    // (debounced), onchange and onblur on a component that boots only after
    // several scripts load — a fill that lands before it boots is never seen
    // unless the events fire again once it is up.
    const set = (id, v) => {
      const el = document.getElementById(id); if (!el) return false;
      if (el.value !== v) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      ['input', 'keyup', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
      return true;
    };
    const validate = () => {
      for (const k of ['guestListFormComponent', 'ticketsFormComponent']) {
        try { window[k] && window[k].validateForm && window[k].validateForm(); } catch (e) {}
      }
    };
    const pick = (id, v) => {
      const el = document.getElementById(id); if (!el || v == null || v === '') return false;
      if (el.value !== v) Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v);
      ['input', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
      return true;
    };
    const tick = id => {
      const el = document.getElementById(id); if (!el) return false;
      if (!el.checked) el.parentElement.click();
      return el.checked;
    };
    // 'join' presses the sign-up button; 'pay' presses Proceed to payment —
    // never the other way round.
    const button = () => [...document.querySelectorAll('button')].find(b => mode === 'pay'
      ? /proceed to payment|continue to payment|ir al pago|continuar al pago|pagar/i.test(b.innerText)
      : /sign up|download ticket|apuntar|inscrib|descargar entrada/i.test(b.innerText));
    while (Date.now() < deadline) {
      set('field-nombre', name); set('field-email', email); set('field-email-confirm', email);
      // International format ("+34 612…", "+1 312…") — the phone widget picks
      // the country from the prefix and validates it.
      if (phone && document.getElementById('field-telefono')) set('field-telefono', phone);
      // Some events also ask date of birth, gender, country and postal code.
      // Filled from the account (date of birth, gender) and fixed values.
      if (extras.dob) set('field-fecha_nacimiento', extras.dob);
      if (extras.postal) set('field-codigo_postal', extras.postal);
      pick('field-sexo', extras.gender); pick('field-country', extras.country);
      // Tables: deposit or the whole table now, as the guest chose in our
      // sheet. checkFullPayment() is ASYNC — it flips their tick icon and
      // recalculates the price after it returns, while the button is already
      // enabled. Clicking in that gap books the deposit. So: flip, await it,
      // and never click until the tick shows the state the guest picked.
      const resumen = window.bookingsResumenComponent;
      if (resumen && typeof resumen.checkFullPayment === 'function') {
        const wantFull = extras.full === '1';
        const tickOn = () => {
          const i = document.getElementById('icon-check');
          return i ? /check-circle/.test(i.className) : !!resumen.isFullPayment;
        };
        if (tickOn() !== wantFull) {
          try { await resumen.checkFullPayment(); } catch (e) {}
          mark('fullPayment');
          await sleep(300);
          continue;
        }
      }
      tick('checkbox-promotor'); tick('checkbox-fourvenues-condiciones');
      validate();
      const b = button();
      if (b && !b.disabled) {
        mark('enabled');
        wrapPost();
        const before = body();
        b.click();
        mark('clicked');
        const channel = (location.pathname.split('/iframe/')[1] || 'clubfuoco-hype/').split('/')[0];
        const until = Date.now() + confirmMs;
        while (Date.now() < until) {
          // Paid: the reply carries the payment page's address — a plain URL
          // the app opens in a FRESH web view, where Apple Pay still works.
          if (mode === 'pay') {
            const payUrl = (posted && posted.data && posted.data.payment_url) || opened;
            if (payUrl) return done('pay ' + payUrl);
            if (postFailed) return done('error ' + String((postFailed && (postFailed.data || postFailed.message)) || 'rejected').slice(0, 300));
            await sleep(60);
            continue;
          }
          if (posted && posted.data && (posted.data._id || posted.data.id)) {
            const bd = posted.body || {};
            // A list's success page can be built from the request — no waiting.
            if (/^listas/.test(posted.path) && bd.purchase_id != null) {
              return done('ok ' + `https://web.fourvenues.com/en/${channel}/success/guest-lists/${bd.purchase_id}-${bd.idx}`);
            }
            // A €0 ticket's we don't know how to build: give their own
            // success message a moment to name it, then go without.
            if (!posted.graceUntil) posted.graceUntil = Date.now() + 2500;
            if (Date.now() > posted.graceUntil) return done('ok ');
          }
          if (opened) return done('ok ' + opened);
          if (!location.pathname.endsWith('/form')) return done('ok ' + location.href);
          if (postFailed) return done('error ' + String((postFailed && (postFailed.data || postFailed.message)) || 'rejected').slice(0, 300));
          const now = body();
          if (now !== before && /algo ha pasado|superando el l[ií]mite|ya est[aá]s? apuntad|already (signed|registered)/i.test(now)) {
            return done('error ' + now.slice(0, 300));
          }
          await sleep(60);
        }
        return done('sent');   // pressed, request in flight, no confirmation seen
      }
      await sleep(120);
    }
    // Why not: enough to tell a slow boot from a throttled page from a new field.
    const b = button();
    mark('gaveup');
    const errs = [...document.querySelectorAll('[id^="error-"]')]
      .filter(e => e.innerText.trim()).map(e => e.id + ': ' + e.innerText.trim());
    // Required inputs still empty — names the field a new form layout added.
    const empty = [...document.querySelectorAll('input, select, textarea')]
      .filter(e => e.type !== 'hidden' && e.type !== 'checkbox' && !e.value && (e.required || /field-/.test(e.id)))
      .map(e => e.id || e.name || e.type);
    return done('disabled ' + JSON.stringify({
      ready: document.readyState, visible: document.visibilityState,
      gl: !!window.guestListFormComponent, tk: !!window.ticketsFormComponent,
      connector: typeof window.connector, moment: typeof window.moment, iti: typeof window.intlTelInput,
      button: b ? b.innerText.trim() + (b.disabled ? ' [disabled]' : '') : null,
      filled: ['field-nombre', 'field-email', 'field-email-confirm'].map(id => !!(document.getElementById(id) || {}).value),
      terms: ['checkbox-promotor', 'checkbox-fourvenues-condiciones'].map(id => !!(document.getElementById(id) || {}).checked),
      errors: errs.slice(0, 4), empty: empty.slice(0, 6),
      phone: !!(document.getElementById('field-telefono') || {}).value,
    }));
    """

    /// On the confirmation page when the PDF isn't a plain link: press
    /// Download and let the navigation delegate catch the URL.
    /// What the checkout will actually charge, read off Fourvenues' own
    /// summary on the preloaded form — their fee and per-person table
    /// supplements are computed there and nowhere else. Waits for the page.
    static let quote = """
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const eur = el => {
      if (!el) return null;
      const a = el.getAttribute('data-currency-amount');
      if (a != null && a !== '') return Number(a);
      // "1.50 €" (first render) and "1.234,50 €" (after it localises) both
      // occur: the LAST separator followed by exactly two digits is decimal.
      const t = (el.innerText || '').replace(/[^0-9.,]/g, '');
      if (!t) return null;
      const m = t.match(/^(.*?)[.,](\\d{2})$/);
      return m ? Number(m[1].replace(/[.,]/g, '') + '.' + m[2]) : Number(t.replace(/[.,]/g, ''));
    };
    // Their summary re-renders a few times while it boots — report only once
    // two reads in a row agree.
    let last = '';
    const settled = v => { const same = v === last; last = v; return same ? v : null; };
    const until = Date.now() + 8000;
    while (Date.now() < until) {
      const r = window.bookingsResumenComponent;
      if (r && r.prepago && r.prepago.precio != null) {
        const p = r.prepago;
        const v = settled(JSON.stringify({ kind: 'table', total: p.precio, deposit: p.fianza, depositFee: p.ggdd,
          full: p.full_payment, fullFee: p.full_payment_ggdd }));
        if (v) return v;
        await sleep(350); continue;
      }
      const sub = document.getElementById('resumen-subtotal'), tot = document.getElementById('resumen-total');
      if (window.ticketsResumenComponent && tot && eur(tot) != null) {
        const v = settled(JSON.stringify({ kind: 'ticket', subtotal: eur(sub), fee: eur(document.getElementById('resumen-ggdd')),
          total: eur(tot) }));
        if (v) return v;
        await sleep(350); continue;
      }
      await sleep(150);
    }
    return '';
    """

    static let pressDownload = """
    (() => {
      const b = [...document.querySelectorAll('button, a')].find(b => /^\\s*download/i.test(b.innerText));
      if (!b) return 'none';
      b.click(); return 'clicked';
    })()
    """
}

struct FVProbe: Decodable {
    let pdf: String?
    let done: Bool
    let challenge: Bool
    let hasForm: Bool
    let needsPhone: Bool
    let url: String
}

func isTicketPDF(_ url: URL?) -> Bool {
    guard let url else { return false }
    return url.host?.contains("connector-service.fourvenues.com") == true
        && url.path.lowercased().hasSuffix(".pdf")
}

// ── Background sign-up ───────────────────────────────────────────────────────
//
// Budget: the guest waits at most ~5 s. So:
//  1. preload() starts loading the form the moment a free product is SELECTED,
//     while the guest is still ticking the terms;
//  2. submit() runs ONE in-page async routine that fills, re-checks every
//     120 ms and clicks the instant the button enables — no native polling;
//  3. success is Fourvenues confirming the sign-up (the page leaving /form).
//     The PDF + QR are fetched AFTERWARDS by ticketPDF(), off the spinner.

/// The rest of what some Fourvenues forms ask for, beyond name, email and
/// phone. Date of birth and gender come from the account; country and postal
/// code are fixed (a Barcelona guest).
struct FVAttendee {
    var dob: String?        // YYYY-MM-DD
    var gender: String?     // their codes: 0 female, 1 male, 2 other
    var country = "ES"
    var postal = "08019"
    /// Tables: pay the whole table now rather than the deposit.
    var fullPayment = false

    init(profile: UserProfile?) {
        dob = profile?.birthday.map { String($0.prefix(10)) }
        gender = switch profile?.gender {
        case "female": "0"
        case "male": "1"
        case .some: "2"
        case nil: nil
        }
    }

    var js: [String: String] {
        var d = ["country": country, "postal": postal, "full": fullPayment ? "1" : "0"]
        if let dob { d["dob"] = dob }
        if let gender { d["gender"] = gender }
        return d
    }
}

@MainActor
final class FVFormRunner: NSObject, WKNavigationDelegate, WKUIDelegate {
    enum Failure: Error {
        /// Needs the guest's own hands: a captcha, a phone field, a form we
        /// don't recognise, a button that never enables. The caller shows the
        /// same URL visibly.
        case needsForm(String)
        case timedOut
        /// Sent, but Fourvenues never confirmed. Don't show the form again.
        case sentUnconfirmed
        /// Fourvenues said no (full, already on the list, …) — its words.
        case rejected(String)
    }

    let webView: WKWebView
    private var caught: URL?
    private(set) var loadedURL: URL?
    /// Fourvenues' success page for this sign-up, from its confirmation.
    private(set) var successURL: URL?
    /// What Fourvenues' server answered the sign-up with.
    private(set) var confirmation: FVConfirmation?
    /// The form's document has replaced about:blank — scripts run now survive.
    private var committed = false
    private var lastLoadError: String?

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        if let rules = FVContentRules.compiled { config.userContentController.add(rules) }
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    /// Start loading now; submit() reuses the page if the URL still matches.
    func preload(_ url: URL) {
        guard url != loadedURL else { return }
        FVTrace.log("preload \(url.path)")
        loadedURL = url
        caught = nil
        committed = false
        webView.load(URLRequest(url: url))
    }

    /// The price summary of the page loaded for `url`, once it has loaded.
    func quote(for url: URL) async -> FVQuote? {
        let deadline = Date().addingTimeInterval(10)
        while !(committed && loadedURL == url) {
            if Date() > deadline || loadedURL != url { return nil }
            try? await Task.sleep(for: .milliseconds(100))
        }
        guard let raw = try? await webView.callAsyncJavaScript(FVJS.quote, arguments: [:], contentWorld: .page) as? String,
              let data = raw.data(using: .utf8), !raw.isEmpty,
              let q = try? JSONDecoder().decode(FVQuote.self, from: data)
        else { return nil }
        return loadedURL == url ? q : nil
    }

    /// Fill, submit, and return once Fourvenues has accepted the sign-up.
    /// Paid tickets and tables: fill everything, press Proceed to payment, and
    /// return Fourvenues' payment page URL — to be opened in a fresh, visible
    /// web view (this one has run script, so Apple Pay is off in it).
    func payURL(url: URL, name: String, email: String, phone: String, extras: FVAttendee) async throws -> URL {
        let raw = try await run(url: url, name: name, email: email, phone: phone, extras: extras, mode: "pay", eventCode: "")
        guard raw.hasPrefix("pay "), let pay = URL(string: String(raw.dropFirst(4)).trimmingCharacters(in: .whitespaces))
        else {
            if raw.hasPrefix("error ") { throw Failure.rejected(String(raw.dropFirst(6))) }
            throw Failure.needsForm(raw)
        }
        return pay
    }

    func submit(url: URL, name: String, email: String, phone: String?, extras: FVAttendee, eventCode: String) async throws {
        let result = try await run(url: url, name: name, email: email, phone: phone ?? "", extras: extras, mode: "join", eventCode: eventCode)
        if result.hasPrefix("ok ") {
            let u = String(result.dropFirst(3)).trimmingCharacters(in: .whitespaces)
            successURL = u.isEmpty ? nil : URL(string: u)
            return
        }
        // Pressed but unconfirmed: the sign-up may well have landed. Showing
        // the form again would risk signing the guest up twice.
        if result == "sent" { throw Failure.sentUnconfirmed }
        if result.hasPrefix("error ") { throw Failure.rejected(String(result.dropFirst(6))) }
        throw Failure.needsForm(result)
    }

    /// Load (or reuse the preloaded) form, run the in-page routine, return its
    /// result line.
    private func run(url: URL, name: String, email: String, phone: String, extras: FVAttendee,
                     mode: String, eventCode: String) async throws -> String {
        preload(url)
        // If the tap beat the preload, the page is still about:blank — a script
        // run there dies when the real page replaces it. Wait for the document.
        let loadDeadline = Date().addingTimeInterval(8)
        let tapped = Date()
        while !committed {
            if Date() > loadDeadline {
                FVTrace.log("page never committed (loading=\(webView.isLoading) progress=\(webView.estimatedProgress) error=\(lastLoadError ?? "none"))")
                throw Failure.needsForm("load")
            }
            try await Task.sleep(for: .milliseconds(50))
        }
        FVTrace.log(String(format: "page ready %.2fs after tap", Date().timeIntervalSince(tapped)))
        var reply: String?
        for _ in 0..<2 where reply == nil {   // a nil = the page swapped under us; once more
            reply = try? await webView.callAsyncJavaScript(
                FVJS.fillAndSubmit,
                arguments: ["name": name, "email": email, "phone": phone, "extras": extras.js, "mode": mode,
                            "budgetMs": 6000, "confirmMs": 9000],
                contentWorld: .page) as? String
        }
        guard let raw = reply else {
            FVTrace.log("in-page routine → nil")
            throw Failure.needsForm("script")
        }
        let parts = raw.split(separator: "\t", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
        let result = parts[0]
        if parts.count > 2, let data = parts[2].data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) {
            confirmation = FVConfirmation(json: json, eventCode: eventCode)
            FVTrace.log("sign-up response keys: \(confirmation?.shape ?? "-")  code: \(confirmation?.ticketCode ?? "none")  pdf: \(confirmation?.pdfURL != nil)")
        }
        FVTrace.log("in-page routine (\(mode)) → \(result.hasPrefix("ok ") ? "ok" : result.hasPrefix("pay ") ? "pay url" : result)  ms: \(parts.count > 1 ? parts[1] : "-")")
        return result
    }

    // No hidden visit to the success page: it sits behind a Cloudflare bot
    // check ("No bots on the guest list") that a hidden page never clears, and
    // we do not try to get past one. The QR comes from the sign-up response
    // (FVConfirmation); failing that, the guest opens the page themselves.

    private func probe() async -> FVProbe? {
        guard let s = try? await webView.evaluateJavaScript(FVJS.probe) as? String,
              let d = s.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(FVProbe.self, from: d)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        if webView.url?.host?.contains("fourvenues") == true { committed = true }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        lastLoadError = (error as NSError).localizedDescription
        FVTrace.log("load failed: \(lastLoadError ?? "")")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        lastLoadError = (error as NSError).localizedDescription
    }

    // The ticket PDF is caught as a navigation — never loaded in here.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        if isTicketPDF(action.request.url) { caught = action.request.url; return .cancel }
        return .allow
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if isTicketPDF(action.request.url) { caught = action.request.url }
        return nil
    }
}

/// Blocks trackers, images and fonts in the HIDDEN runner only — nobody sees
/// that page, and it loads faster without them. A content blocker is not
/// injected script. Compiled once at launch (FVContentRules.prepare()).
@MainActor
enum FVContentRules {
    static var compiled: WKContentRuleList?

    static func prepare() async {
        guard compiled == nil else { return }
        let json = """
        [
          {"trigger":{"url-filter":".*","resource-type":["image","font","media"]},"action":{"type":"block"}},
          {"trigger":{"url-filter":"google-analytics\\.com|googletagmanager\\.com|clarity\\.ms|cloudflareinsights\\.com|facebook\\.net|doubleclick\\.net"},"action":{"type":"block"}}
        ]
        """
        compiled = try? await WKContentRuleListStore.default()
            .compileContentRuleList(forIdentifier: "fv-runner", encodedContentRuleList: json)
    }
}

/// Hosts the runner's web view inside the sheet, invisible. A web view that is
/// not in a window gets its timers throttled, and Fourvenues' form is built by
/// timers.
struct FVHiddenWeb: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

// ── Visible checkout (paid) ──────────────────────────────────────────────────

struct FVCheckoutView: View {
    let url: URL
    let title: String
    /// False for the visible fallback of a FREE sign-up: there is no Apple Pay
    /// to protect, so the page may be read as soon as it loads.
    var paymentExpected = true
    /// Free fallback only: fill Fourvenues' form from the account, so the
    /// guest just taps the button. Never set when payment is expected.
    var prefill: (name: String, email: String)? = nil
    let onTicket: (URL) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var coordinator = FVCheckoutCoordinator()

    var body: some View {
        NavigationStack {
            FVCheckoutWeb(url: url, coordinator: coordinator, paymentExpected: paymentExpected, prefill: prefill)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { dismiss() }
                    }
                    ToolbarItem(placement: .principal) {
                        HStack(spacing: 5) {
                            Image(systemName: "lock.fill").font(.system(size: 10))
                            Text(coordinator.host).font(.cfMono(11))
                        }
                        .foregroundStyle(Theme.stone)
                    }
                }
                .overlay(alignment: .bottom) {
                    if coordinator.reading {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Getting your ticket…").font(.cfSans(14, weight: .medium))
                        }
                        .padding(.horizontal, 18).padding(.vertical, 12)
                        .background(.regularMaterial, in: .capsule)
                        .padding(.bottom, 30)
                    }
                }
        }
        .onChange(of: coordinator.ticketPDF) { _, pdf in
            if let pdf { onTicket(pdf); dismiss() }
        }
    }
}

@MainActor @Observable
final class FVCheckoutCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    var host = "fourvenues.com"
    var reading = false
    var ticketPDF: URL?

    /// Set once the guest has been to the payment page. From then on — and
    /// ONLY then — we may read the page, because Apple Pay is behind us.
    private var visitedPayment = false
    var prefill: (name: String, email: String)?
    private weak var webView: WKWebView?

    func attach(_ webView: WKWebView, paymentExpected: Bool) {
        self.webView = webView
        if !paymentExpected { visitedPayment = true }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        if isTicketPDF(action.request.url) { ticketPDF = action.request.url; return .cancel }
        return .allow
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if isTicketPDF(action.request.url) { ticketPDF = action.request.url }
        else if let u = action.request.url { webView.load(URLRequest(url: u)) }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url else { return }
        host = url.host ?? host
        if url.host?.hasPrefix("pay.") == true { visitedPayment = true; return }
        // Back on Fourvenues after paying: now it is safe to look for the ticket.
        if let prefill, url.path.hasSuffix("/form") {
            // Free sign-up: no Apple Pay here, so filling is safe. Twice, a beat
            // apart — their validator boots after the fields render.
            Task {
                for _ in 0..<3 {
                    _ = try? await webView.evaluateJavaScript(FVJS.fill(name: prefill.name, email: prefill.email))
                    try? await Task.sleep(for: .milliseconds(400))
                }
            }
        }
        if visitedPayment { Task { await findTicket() } }
    }

    private func findTicket() async {
        guard let webView, ticketPDF == nil, !reading else { return }
        reading = true
        defer { reading = false }
        for attempt in 0..<30 {
            if ticketPDF != nil { return }
            if let s = try? await webView.evaluateJavaScript(FVJS.probe) as? String,
               let probe = s.data(using: .utf8).flatMap({ try? JSONDecoder().decode(FVProbe.self, from: $0) }) {
                if let pdf = probe.pdf.flatMap(URL.init(string:)) { ticketPDF = pdf; return }
                if probe.done && attempt % 5 == 2 {
                    _ = try? await webView.evaluateJavaScript(FVJS.pressDownload)
                }
            }
            try? await Task.sleep(for: .milliseconds(700))
        }
    }
}

private struct FVCheckoutWeb: UIViewRepresentable {
    let url: URL
    let coordinator: FVCheckoutCoordinator
    let paymentExpected: Bool
    let prefill: (name: String, email: String)?

    func makeUIView(context: Context) -> WKWebView {
        // Default data store: Fourvenues' own session and the guest's Safari
        // autofill behave as they would in a browser.
        let web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        web.navigationDelegate = coordinator
        web.uiDelegate = coordinator
        web.allowsBackForwardNavigationGestures = true
        coordinator.attach(web, paymentExpected: paymentExpected)
        coordinator.prefill = paymentExpected ? nil : prefill
        web.load(URLRequest(url: url))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// A step-by-step log of the background sign-up, on the device, so a failure
/// on a real phone can be read back (devicectl copy from the app container:
/// Library/Application Support/fv-trace.log). No names or emails are written.
enum FVTrace {
    private static let file: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("fv-trace.log")
    }()

    static func log(_ line: String) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        let entry = "\(stamp) \(line)\n"
        NSLog("[FV] %@", line)
        if let h = try? FileHandle(forWritingTo: file) {
            h.seekToEndOfFile(); h.write(Data(entry.utf8)); try? h.close()
        } else {
            try? Data(entry.utf8).write(to: file)
        }
    }
}

/// The booking record Fourvenues' server returns for a sign-up, searched for
/// the door code and the ticket PDF. The exact shape isn't documented, so this
/// looks by pattern: the door code starts with the event's own code (LNKO →
/// "LNKO1S1G1"), the PDF lives on connector-service.fourvenues.com.
struct FVConfirmation {
    let ticketCode: String?
    let pdfURL: URL?
    /// Key paths only, never values — for the trace.
    let shape: String

    init(json: Any, eventCode: String) {
        var strings: [(path: String, value: String)] = []
        var keys: [String] = []
        func walk(_ v: Any, _ path: String) {
            if let d = v as? [String: Any] {
                for (k, x) in d { keys.append(path + k); walk(x, path + k + ".") }
            } else if let a = v as? [Any] {
                for (i, x) in a.prefix(20).enumerated() { walk(x, path + "\(i).") }
            } else if let s = v as? String {
                strings.append((path, s))
            }
        }
        walk(json, "")
        let code = eventCode.uppercased()
        ticketCode = strings.first { $0.value.uppercased().hasPrefix(code) && $0.value.count >= code.count + 3
            && $0.value.count <= 24 && $0.value.allSatisfy { $0.isLetter || $0.isNumber } }?.value
        pdfURL = strings.first { $0.value.contains("connector-service.fourvenues.com") && $0.value.lowercased().contains(".pdf") }
            .flatMap { URL(string: $0.value) }
        shape = keys.prefix(60).joined(separator: ",")
    }
}

/// Fourvenues' own price summary for the selected way in — what Apple Pay
/// will show. Tables carry both the deposit and the pay-in-full figures.
struct FVQuote: Decodable, Equatable {
    let kind: String
    // tickets
    var subtotal: Double?
    var fee: Double?
    // both
    var total: Double?
    // tables
    var deposit: Double?
    var depositFee: Double?
    var full: Double?
    var fullFee: Double?
}
