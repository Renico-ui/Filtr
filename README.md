# Keyword alerts
A Gmail sidebar watches the inbox for a few saved words. Grok reads each match and writes one sentence. A sentence that starts with "Yes" gets a colored Keyword label and Gmail's Important marker.

## Keywords
| Word | What it means in the demo |
|---|---|
| spacexsi | High. An account or security alert to handle today. |
| major league hacking | Normal. A hackathon update to read soon. |
| invoice | Low, unless the message has a deadline or a payment due. |
SpaceXSI is the live example. Send one email with SpaceXSI in the subject, click Check inbox, and the sidebar should show a sentence like:
`Yes. High: SpaceXSI reports a new login. If it was not you, secure the account today.`
The message also gets the colored label `Keyword/spacexsi`.

## What the demo does
1. Start the Grok bot and the Cloudflare tunnel.
2. In the Gmail sidebar, save `spacexsi`.
3. Send the SpaceXSI test email.
4. Click **Check inbox**.
5. Show the colored label and the High sentence.
The sidebar searches the last 30 days and stops after 5 matching threads for each word, so Gmail does not time out.
If Grok is slow or `GROK_URL` is missing, the sidebar still shows the keyword hit with a plain sentence. That sentence does not start with Yes, so the message is not labeled.