# Keyword alerts

A Gmail sidebar watches the inbox for a few saved words. Grok reads the keyword, the sender, the subject, and a short snippet, then writes one sentence.

If the email is really about that word, the sentence starts with "Yes." and then "High:", "Normal:", or "Low:". That message gets a colored Keyword label and Gmail's Important marker. If the word only appears in passing, in an ad, or in an unrelated message, the sentence starts with "No." and the message is not labeled.

Cursor helped build the project. Grok 4.7 writes the sentence during Check inbox.

## What the sentence means

High means a deadline, registration, submission, travel, or account alert that the person should handle today.
Normal means a hackathon update worth reading soon.
Low means a newsletter, promotion, or note that can wait.

The sentence names the keyword and what the person should do. It is one English sentence after Yes or No.

## Keywords

Each Gmail account saves its own words. Pick a word that already appears in that inbox.

| Example | What a matching email can mean |
|---|---|
| spacexsi | High. An account or security alert to handle today. |
| major league hacking | Normal. A hackathon update worth reading soon. |
| invoice | High when a payment or deadline is due. Low when it is only a notice that can wait. |

A High result looks like this:

`Yes. High: SpaceXSI reports a new login. If it was not you, secure the account today.`

The matching message gets a colored label named `Keyword/` plus the saved word, such as `Keyword/invoice`.

## What the demo does

1. Start the Grok bot and the Cloudflare tunnel.
2. In the Gmail sidebar, save a word that is in this inbox.
3. Send a test email that contains that same word, or use one that is already there.
4. Click **Check inbox**.
5. Show the colored label and Grok's sentence.

The sidebar searches the last 30 days and checks up to 10 matching threads for each word. Gmail stops the sidebar after about 30 seconds, so a long run stops early and the next click continues.

If Grok is slow or `GROK_URL` is missing, the sidebar still shows the keyword hit with a plain sentence: `Normal: New invoice email from …`. That fallback is not labeled.

## How the pieces fit

Google Cloud is the permission booth. The Gmail API is turned on there, and the consent screen stays in Testing, so only the demo Gmail accounts can click Allow. The Desktop client is saved as `server/credentials.json`. After the first Allow click, `token.json` remembers that account. Both files stay off GitHub.

Google Apps Script runs the sidebar inside Gmail. `add-on/Code.js` is the program: it saves each account's keywords, searches the inbox, asks Grok, and applies the colored label. `add-on/appsscript.json` holds the add-on name and the permissions. Saving those files in the editor updates GitHub. The live sidebar changes only after the same `Code.js` is pasted into the Apps Script editor.

## Start the demo

Use two terminals. Leave both running.

Terminal 1, from the `alert-bot` folder:

```bash
npx @grok/agent-sdk serve --dir . --mode single --dev --allow-anonymous
```

Terminal 2, from the project folder:

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Copy the `https://….trycloudflare.com` address, with no path on the end, into the Apps Script property `GROK_URL`. Install `cloudflared` on the computer. Leave that program out of Git.

## Who can open it

The Google app stays in Testing, so only the demo Gmail accounts can click Allow. The live sidebar is the copy in Apps Script. This repo is the code and the README. `credentials.json` and `token.json` stay off GitHub.