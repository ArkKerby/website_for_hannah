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

module.exports = async function rsvpHandler(req, res) {
  const appsScriptUrl = process.env.RSVP_APPS_SCRIPT_URL || '';
  const sharedSecret = process.env.RSVP_SHARED_SECRET || '';
  const configured = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(appsScriptUrl) && sharedSecret.length >= 32;

  if (req.method === 'GET') {
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const upstream = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: sharedSecret,
        name,
        email,
        attendance,
        tradition,
        ticketCode,
        submittedAt
      }),
      signal: controller.signal
    });

    let result = {};
    try { result = await upstream.json(); } catch { /* Apps Script may return an HTML deployment error. */ }

    if (!upstream.ok || !result.ok) {
      if (result.saved && result.emailSent === false) {
        return sendJson(res, 502, {
          ok: false,
          message: 'Your RSVP was saved, but the confirmation email could not be sent. Please try again or contact marklaguador09@gmail.com.'
        });
      }
      return sendJson(res, 502, {
        ok: false,
        message: 'We could not record and email your RSVP yet. Please try again in a moment.'
      });
    }

    return sendJson(res, 200, { ok: true, ticketCode });
  } catch {
    return sendJson(res, 502, {
      ok: false,
      message: 'The confirmation service could not be reached. Please try again in a moment.'
    });
  } finally {
    clearTimeout(timeout);
  }
};
