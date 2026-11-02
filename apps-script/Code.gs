const RESPONSE_TAB = 'RSVP Responses';
const SENDER_EMAIL = 'marklaguador09@gmail.com';
const HEADERS = ['Name', 'Email', 'Attendance', 'Tradition', 'Ticket Code', 'Submitted At', 'Confirmation Email Sent'];
const TRADITIONS = ['18 Roses', '18 Candles', '18 Gifts', '18 Shots', '18 Bills', 'Other Guest'];

function doPost(event) {
  let payload;
  try {
    payload = JSON.parse(event && event.postData && event.postData.contents || '{}');
  } catch (error) {
    return json_({ ok: false, error: 'Invalid request.' });
  }

  const properties = PropertiesService.getScriptProperties();
  const expectedSecret = properties.getProperty('RSVP_SHARED_SECRET');
  const spreadsheetId = properties.getProperty('RSVP_SPREADSHEET_ID');
  if (!expectedSecret || !constantTimeEquals_(String(payload.secret || ''), expectedSecret)) {
    return json_({ ok: false, error: 'Unauthorized.' });
  }
  if (!spreadsheetId) return json_({ ok: false, error: 'Spreadsheet setup is incomplete.' });

  const name = String(payload.name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const email = String(payload.email || '').trim();
  const attendance = String(payload.attendance || '');
  const tradition = TRADITIONS.indexOf(String(payload.tradition || '')) >= 0 ? String(payload.tradition) : 'Other Guest';
  const ticketCode = String(payload.ticketCode || '');
  const submittedAt = String(payload.submittedAt || new Date().toISOString());

  if (!name || name.length > 100 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json_({ ok: false, error: 'Invalid name or email.' });
  }
  if (attendance !== 'Yes' && attendance !== 'No') {
    return json_({ ok: false, error: 'Invalid attendance response.' });
  }
  if ((attendance === 'Yes' && !/^HANNAH18-[A-F0-9]{8}$/.test(ticketCode)) || (attendance === 'No' && ticketCode !== '')) {
    return json_({ ok: false, error: 'Invalid ticket code.' });
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    let sheet = spreadsheet.getSheetByName(RESPONSE_TAB);
    if (!sheet) sheet = spreadsheet.insertSheet(RESPONSE_TAB);
    const columns = ensureHeaders_(sheet);

    let row = findEmailRow_(sheet, columns.Email, email);
    if (!row) {
      row = sheet.getLastRow() + 1;
      sheet.getRange(row, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length)).clearContent();
    }

    const values = {
      Name: name,
      Email: email,
      Attendance: attendance,
      Tradition: tradition,
      'Ticket Code': ticketCode,
      'Submitted At': submittedAt,
      'Confirmation Email Sent': 'Pending'
    };
    HEADERS.forEach((header) => sheet.getRange(row, columns[header]).setValue(safeText_(values[header])));
    SpreadsheetApp.flush();

    try {
      MailApp.sendEmail({
        to: email,
        subject: attendance === 'Yes' ? "Hannah's Debut — Your Entry Confirmation" : "Hannah's Debut — RSVP Received",
        body: confirmationMessage_(name, attendance, ticketCode),
        htmlBody: confirmationHtml_(name, attendance, ticketCode),
        name: "Hannah's Debut",
        replyTo: SENDER_EMAIL
      });
      sheet.getRange(row, columns['Confirmation Email Sent']).setValue('Yes');
      SpreadsheetApp.flush();
      return json_({ ok: true, saved: true, emailSent: true });
    } catch (mailError) {
      sheet.getRange(row, columns['Confirmation Email Sent']).setValue('No');
      SpreadsheetApp.flush();
      return json_({ ok: false, saved: true, emailSent: false, error: 'Email could not be sent.' });
    }
  } catch (error) {
    return json_({ ok: false, error: 'RSVP could not be saved. Check the sheet permissions and setup.' });
  } finally {
    try { lock.releaseLock(); } catch (error) { /* The lock may not have been acquired. */ }
  }
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }

  let lastColumn = Math.max(sheet.getLastColumn(), 1);
  let current = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map((value) => String(value).trim());
  HEADERS.forEach((header) => {
    if (current.indexOf(header) < 0) {
      lastColumn += 1;
      sheet.getRange(1, lastColumn).setValue(header);
      current.push(header);
    }
  });

  const columns = {};
  HEADERS.forEach((header) => { columns[header] = current.indexOf(header) + 1; });
  return columns;
}

function findEmailRow_(sheet, emailColumn, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const target = email.toLocaleLowerCase();
  const values = sheet.getRange(2, emailColumn, lastRow - 1, 1).getDisplayValues();
  for (let index = 0; index < values.length; index += 1) {
    if (String(values[index][0]).trim().toLocaleLowerCase() === target) return index + 2;
  }
  return 0;
}

function confirmationMessage_(name, attendance, ticketCode) {
  if (attendance === 'No') {
    return `Hello ${name},\n\nThank you for responding. Your RSVP is recorded as unable to attend Hannah's eighteenth birthday celebration.\n\nThis email acknowledges your response and is not an entrance pass.\n\nWith love,\nHannah's Debut`;
  }

  return `Hello ${name},\n\nYour RSVP is confirmed for Hannah's eighteenth birthday celebration.\n\nDATE: December 19, 2026\nLOCATION: Twinville Civic Center, Marikina City\n\nENTRY CONFIRMATION CODE: ${ticketCode}\n\nPlease present this email at the entrance. This confirmation is for the named guest only. Strictly no Plus 1.\n\nWith love,\nHannah's Debut`;
}

function confirmationHtml_(name, attendance, ticketCode) {
  const safeName = escapeHtml_(name);
  const attending = attendance === 'Yes';
  const message = attending
    ? `<p style="margin:0 0 20px;color:#70563f;font-size:17px;line-height:1.55">Your RSVP is confirmed for Hannah's eighteenth birthday celebration.</p>
       <table role="presentation" style="width:100%;margin:0 0 20px;border-collapse:collapse;background:#e8deca"><tr><td style="padding:14px 16px;color:#694b31;font-size:15px;line-height:1.6"><strong>DATE</strong><br>December 19, 2026<br><strong>LOCATION</strong><br>Twinville Civic Center, Marikina City</td></tr></table>
       <div style="margin:0 0 18px;padding:15px;border:1px dashed #a64f67;background:#d8c9b0"><span style="display:block;color:#794653;font-size:12px;font-weight:bold;letter-spacing:2px">ENTRY CONFIRMATION CODE</span><strong style="display:block;margin-top:5px;color:#71384b;font-size:24px;letter-spacing:2px">${escapeHtml_(ticketCode)}</strong></div>
       <p style="margin:0;color:#70563f;font-size:15px;line-height:1.55">Please present this email at the entrance. This confirmation is for the named guest only. <strong>Strictly no Plus 1.</strong></p>`
    : `<p style="margin:0 0 18px;color:#70563f;font-size:17px;line-height:1.55">We recorded your response as unable to attend. Thank you for letting us know.</p>
       <p style="margin:0;color:#794653;font-size:14px;line-height:1.5"><strong>This email acknowledges your response; it is not an entrance pass.</strong></p>`;

  return `<div style="margin:0;padding:28px 12px;background:#e8deca;font-family:Georgia,'Times New Roman',serif;color:#49382f">
    <table role="presentation" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;background:#eee4d2;border:1px solid #c5a47d">
      <tr><td style="padding:30px 26px 28px;text-align:center;border:7px solid #e8deca;outline:1px solid #c5a47d">
        <p style="margin:0 0 8px;color:#8b633d;font-size:14px;font-weight:bold;letter-spacing:1px">HANNAH'S DEBUT</p>
        <h1 style="margin:0 0 8px;color:#a64f67;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.15">${attending ? 'Entry Confirmation' : 'RSVP Received'}</h1>
        <p style="margin:0 0 22px;color:#794653;font-size:18px">For ${safeName}</p>
        ${message}
        <p style="margin:25px 0 0;color:#8b633d;font-size:14px;line-height:1.5">With love,<br><strong>Hannah</strong></p>
      </td></tr>
    </table>
  </div>`;
}

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function safeText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function constantTimeEquals_(first, second) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
