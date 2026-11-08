# Keyword alerts

A Gmail sidebar watches the inbox for a few saved words. Grok reads the keyword, the sender, the subject, and a short snippet, then writes one sentence.

If the email is really about that word, the sentence starts with "Yes." and then "High:", "Normal:", or "Low:". That message gets a colored Keyword label and Gmail's Important marker. If the word only appears in passing, in an ad, or in an unrelated message, the sentence starts with "No." and the message is not labeled.

## What the sentence means

High means a deadline, registration, submission, travel, or account alert that the person should handle today.
Normal means a hackathon update worth reading soon.
Low means a newsletter, promotion, or note that can wait.

The sentence names the keyword and what the person should do. It is one English sentence after Yes or No.

## Keywords

| Word | What it means in the demo |
|---|---|
| spacexsi | High. An account or security alert to handle today. |
| major league hacking | Normal. A hackathon update worth reading soon. |
| invoice | High when a payment or deadline is due. Low when it is only a notice that can wait. |

SpaceXSI is the live example. Send one email with SpaceXSI in the subject, click Check inbox, and the sidebar should show a sentence like:

`Yes. High: SpaceXSI reports a new login. If it was not you, secure the account today.`

The message also gets the colored label `Keyword/spacexsi`.

## What the demo does

1. Start the Grok bot and the Cloudflare tunnel.
2. In the Gmail sidebar, save `spacexsi`.
3. Send the SpaceXSI test email.
4. Click **Check inbox**.
5. Show the colored label and the High sentence.

The sidebar searches the last 30 days and checks up to 10 matching threads for each word. Gmail stops the sidebar after about 30 seconds, so a long run stops early and the next click continues.

If Grok is slow or `GROK_URL` is missing, the sidebar still shows the keyword hit with a plain sentence: `Normal: New spacexsi email from …`. That fallback is not labeled.