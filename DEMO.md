# Demo script: Gmail keyword alerts

Four steps, about two minutes.

## 1. Connect Gmail
Open Gmail and click the Keyword Alerts icon in the right-hand side panel. Click **Connect Gmail** and approve read access. The sidebar shows "Connected as <your address>".

## 2. Add the word "invoice"
Type `invoice` in the keyword box and click **Save**. It appears in the keyword list and is stored on the server.

## 3. Send yourself a message with that word
From the second test address, send an email to the first one with the subject **Invoice 1842 is due Friday**.

## 4. Show the alert and the label
Within a few seconds the sidebar shows the alert: "Matched *invoice* in *Invoice 1842 is due Friday* from <sender>." Open the message: it now carries the Gmail label **Keyword/invoice**. Point out that the alert sentence still appears if the Grok bot is slow or its key is missing, because the server's own matcher produced it.
