# RSVP email and Google Sheet setup

The RSVP page sends submissions to the Vercel endpoint at `/api/rsvp`. That server endpoint forwards them to the Google Apps Script in `apps-script/Code.gs`; the script writes to the Google Sheet and sends the email as the Google account that deploys the script. The spreadsheet ID and shared secret stay in Apps Script properties, not the public website code.

The script creates a separate `RSVP Responses` tab and adds these columns:

| Column | What it records |
| --- | --- |
| Name | Guest's name from the RSVP form |
| Email | Address receiving the confirmation |
| Attendance | Yes or No |
| Tradition | 18 Roses, 18 Candles, 18 Gifts, 18 Shots, 18 Bills, or Other Guest |
| Ticket Code | Entry code for Yes responses; blank for No |
| Submitted At | Submission time in ISO format |
| Confirmation Email Sent | Yes or No |

The same email address updates its existing row if the guest changes their answer. Each guest should submit their own email. A Yes response receives an entry code by email; a No response receives an acknowledgement without an entry code. Both messages say there is no plus one.

## One-time Google Apps Script deployment

1. Open the linked spreadsheet while signed in as `marklaguador09@gmail.com`. Make sure that account has Editor access. Keep the spreadsheet restricted to the people who need it, since it will contain guest emails and RSVP answers.
2. Go to [script.google.com](https://script.google.com), create a project, and replace its `Code.gs` with the contents of this project's `apps-script/Code.gs`.
3. In the Apps Script project, open **Project Settings** and add these Script Properties:
   - Property: `RSVP_SPREADSHEET_ID`
   - Value: the ID in the spreadsheet link (the part between `/d/` and `/edit`)
   - Property: `RSVP_SHARED_SECRET`
   - Value: a newly generated random secret with at least 32 characters
4. Choose **Deploy → New deployment → Web app**. Set **Execute as** to your account (`marklaguador09@gmail.com`) and access to **Anyone**. The secret check in the script protects the public endpoint. Authorize access to the spreadsheet and email when Google prompts you.
5. Copy the deployed web app URL ending in `/exec`.

## Vercel environment variables

In the Vercel project settings, add these two Environment Variables for Production (and Preview if you use preview deployments):

| Variable | Value |
| --- | --- |
| `RSVP_APPS_SCRIPT_URL` | The deployed Apps Script `/exec` URL |
| `RSVP_SHARED_SECRET` | The exact same random secret stored in Script Properties |

Keep the secret out of `index.html`, this repository, and messages. Redeploy the Vercel site after saving the variables. Once set, the site can submit the form, update the Sheet, and email the receipt. If either variable is missing, the page will say the confirmation service is not connected instead of claiming an RSVP succeeded.

## Confirmation messages

Deploy the Apps Script as `marklaguador09@gmail.com` so Google sends the messages from that account. A Yes confirmation includes Hannah's event date and venue, the guest's entry code, and the instruction to present the email at the entrance. A No response receives an acknowledgement that is not an entry pass.

The web app runs with the deploying account's access and sends the mail using Apps Script's Mail service. See Google's [web app deployment guide](https://developers.google.com/apps-script/guides/web) and [Mail service reference](https://developers.google.com/apps-script/reference/mail/mail-app) for the deployment and authorization model.
