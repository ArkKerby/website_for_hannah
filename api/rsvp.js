const crypto = require('node:crypto');

const allowedTraditions = new Set([
  '18 Roses',
  '18 Candles',
  '18 Gifts',
  '18 Shots',
  '18 Bills',
  'Other Guest'
]);

function sendJson(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

async function postToAppsScript(url, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    let result = {};
    try { result = await upstream.json(); } catch { /* Google may return an HTML deployment error. */ }
    return { upstreamOk: upstream.ok, result };
  } finally {
    clearTimeout(timeout);
  }
}

function getDiagnosticIssue(code) {
  const messages = {
    SHARED_SECRET_NOT_SET: 'Apps Script is missing the RSVP_SHARED_SECRET script property.',
    SHARED_SECRET_MISMATCH: 'The Vercel and Apps Script shared secrets do not match.',
    SPREADSHEET_ID_NOT_SET: 'Apps Script is missing the RSVP_SPREADSHEET_ID script property.',
    SPREADSHEET_ACCESS_FAILED: 'Apps Script cannot access or edit the configured Google Sheet.',
    MAIL_QUOTA_EXHAUSTED: 'The Apps Script account has no email sending quota remaining today.',
    MAIL_SERVICE_NOT_AUTHORIZED: 'Apps Script email permission has not been authorized. Run authorizeRsvpServices in the Apps Script editor.',
    INVALID_JSON: 'Apps Script did not receive a valid JSON response.',
    BACKEND_UNAVAILABLE: 'The Apps Script deployment did not return the expected diagnostic response.'
  };
  return messages[code] || messages.BACKEND_UNAVAILABLE;
}

module.exports = async function rsvpHandler(req, res) {
  const appsScriptUrl = process.env.RSVP_APPS_SCRIPT_URL || '';
  const sharedSecret = process.env.RSVP_SHARED_SECRET || '';
  const configured = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(appsScriptUrl) && sharedSecret.length >= 32;

  if (req.method === 'GET') {
    const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
    if (url.searchParams.get('diagnose') === '1') {
      if (!configured) {
        return sendJson(res, 503, { ok: false, configured: false, diagnostic: true, issue: 'VERCEL_CONFIGURATION_MISSING' });
      }

      try {
        const { upstreamOk, result } = await postToAppsScript(appsScriptUrl, {
          action: 'health',
          secret: sharedSecret
        });
        if (!upstreamOk || !result.ok) {
          const issue = result.code || 'BACKEND_UNAVAILABLE';
          console.error('[RSVP diagnostic] Apps Script check failed:', issue);
          return sendJson(res, 502, {
            ok: false,
            configured: true,
            diagnostic: true,
            issue,
            spreadsheetAccessible: result.spreadsheetAccessible === true,
            responseTabReady: result.responseTabReady === true,
            message: getDiagnosticIssue(issue)
          });
        }

        return sendJson(res, 200, {
          ok: true,
          configured: true,
          diagnostic: true,
          spreadsheetAccessible: result.spreadsheetAccessible === true,
          responseTabReady: result.responseTabReady === true,
          emailServiceReady: result.emailServiceReady === true
        });
      } catch (error) {
        console.error('[RSVP diagnostic] Apps Script could not be reached:', error && error.name || 'network error');
        return sendJson(res, 502, {
          ok: false,
          configured: true,
          diagnostic: true,
          issue: 'BACKEND_UNAVAILABLE',
          message: getDiagnosticIssue('BACKEND_UNAVAILABLE')
        });
      }
    }
    return sendJson(res, 200, { ok: true, configured });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, message: 'Use the RSVP form to submit your response.' });
  }

  if (!configured) {
    return sendJson(res, 503, {
      ok: false,
      message: "The RSVP confirmation service is still being connected. Please try again later."
    });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // Quietly ignore bots that fill the visually hidden field.
  if (String(body.website || '').trim()) {
    return sendJson(res, 200, { ok: true, attendance: 'No' });
  }

  const name = String(body.name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const email = String(body.email || '').trim();
  const attendance = String(body.attendance || '');
  const tradition = allowedTraditions.has(String(body.tradition || '')) ? String(body.tradition) : 'Other Guest';
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!name || name.length > 100 || !emailPattern.test(email) || email.length > 254 || !['Yes', 'No'].includes(attendance)) {
    return sendJson(res, 400, { ok: false, message: 'Please enter a valid name, email, and Yes or No response.' });
  }

  const ticketCode = attendance === 'Yes'
    ? `HANNAH18-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
    : '';
  const submittedAt = new Date().toISOString();

  try {
    const { upstreamOk, result } = await postToAppsScript(appsScriptUrl, {
      secret: sharedSecret,
      name,
      email,
      attendance,
      tradition,
      ticketCode,
      submittedAt
    });

    if (!upstreamOk || !result.ok) {
      const code = result.code || 'BACKEND_UNAVAILABLE';
      console.error('[RSVP submission] Apps Script rejected request:', code);

      if (result.saved && result.emailSent === false) {
        return sendJson(res, 502, {
          ok: false,
          code,
          message: 'Your RSVP was saved, but the confirmation email could not be sent. Please contact marklaguador09@gmail.com.'
        });
      }

      return sendJson(res, 502, {
        ok: false,
        code,
        message: 'We could not record and email your RSVP yet. Please try again in a moment.'
      });
    }

    return sendJson(res, 200, { ok: true, ticketCode });
  } catch (error) {
    console.error('[RSVP submission] Apps Script request failed:', error && error.name || 'network error');
    return sendJson(res, 502, {
      ok: false,
      message: 'The confirmation service could not be reached. Please try again in a moment.'
    });
  }
};
