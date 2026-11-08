/*
  This file is the Gmail sidebar.

  It shows a menu, saves the words this person is watching, searches the last
  30 days of the inbox, asks the Grok bot about each match, and labels the
  messages the bot accepts. The bot address is GROK_URL in Script properties.
*/

// White text, and the Gmail colors used for a Keyword label.
var LABEL_TEXT = "#ffffff";
var LABEL_COLORS = ["#fb4c2f", "#a479e2", "#ffad47", "#16a765", "#4a86e8"];

// Gmail calls this when the sidebar opens. Show the home menu.
function onHomepage() {
  return buildHomeCard();
}

// Read the saved words for this Gmail user. If none are saved, use "invoice".
function loadKeywords() {
  var raw = PropertiesService.getUserProperties().getProperty("keywords");
  if (raw === null) {
    return ["invoice"];
  }
  return JSON.parse(raw);
}

// Draw the opening menu: Check inbox, Keywords, and Reset.
function buildHomeCard() {
  var keywords = loadKeywords();
  var saved = keywords.length ? keywords.length + " saved" : "None saved";
  var section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText(
      "Label the last 30 days of mail that matches a word you choose."
    ))
    .addWidget(CardService.newDivider())
    .addWidget(menuRow("Check inbox", "Label mail from the last 30 days", CardService.Icon.EMAIL, "scanInbox"))
    .addWidget(CardService.newDivider())
    .addWidget(menuRow("Keywords", saved, CardService.Icon.BOOKMARK, "openKeywords"))
    .addWidget(CardService.newDivider())
    .addWidget(menuRow("Reset", "Remove keyword labels", CardService.Icon.DESCRIPTION, "confirmReset"));
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle("Keyword alerts")
        .setSubtitle("Inbox, sorted by what you asked for")
        .setImageUrl("https://www.gstatic.com/images/icons/material/system/1x/bookmark_black_24dp.png")
        .setImageStyle(CardService.ImageStyle.CIRCLE)
    )
    .addSection(section)
    .setFixedFooter(
      CardService.newFixedFooter().setPrimaryButton(
        CardService.newTextButton()
          .setText("Check inbox")
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor("#1a73e8")
          .setOnClickAction(CardService.newAction().setFunctionName("scanInbox"))
      )
    )
    .build();
}

// Draw one clickable row. The last argument is the function that runs when it is clicked.
function menuRow(title, detail, icon, functionName) {
  return CardService.newDecoratedText()
    .setText(title)
    .setBottomLabel(detail)
    .setWrapText(true)
    .setStartIcon(CardService.newIconImage().setIcon(icon))
    .setOnClickAction(CardService.newAction().setFunctionName(functionName));
}

// Open the keyword page on top of the home menu.
function openKeywords() {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildKeywordsCard()))
    .build();
}

// Draw the saved words and the box used to add a new one.
function buildKeywordsCard() {
  var keywords = loadKeywords();
  var section = CardService.newCardSection().setHeader("Saved words");
  if (keywords.length === 0) {
    section.addWidget(CardService.newTextParagraph().setText("No words saved yet."));
  } else {
    keywords.forEach(function (word) {
      section.addWidget(
        CardService.newDecoratedText()
          .setText(word)
          .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.BOOKMARK))
      );
    });
  }
  section
    .addWidget(CardService.newDivider())
    .addWidget(
      CardService.newTextInput()
        .setFieldName("keyword")
        .setTitle("Add a keyword")
    )
    .addWidget(
      CardService.newTextButton()
        .setText("Save keyword")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor("#1a73e8")
        .setOnClickAction(CardService.newAction().setFunctionName("saveKeyword"))
    )
    .addWidget(
      CardService.newTextButton()
        .setText("Back")
        .setOnClickAction(CardService.newAction().setFunctionName("showHome"))
    );
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("Keywords").setSubtitle("These words are checked in the inbox"))
    .addSection(section)
    .build();
}

// Save the typed word for this Gmail user, then show the keyword page again.
function saveKeyword(e) {
  var word = String((e.formInput && e.formInput.keyword) || "")
    .trim()
    .toLowerCase();
  if (word) {
    var keywords = loadKeywords();
    if (keywords.indexOf(word) === -1) {
      keywords.push(word);
    }
    PropertiesService.getUserProperties().setProperty("keywords", JSON.stringify(keywords));
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildKeywordsCard()))
    .build();
}

// Label High, Normal, Low, and Yes. Leave No, and a bot-down sentence, unlabeled.
function shouldLabel(sentence) {
  var text = String(sentence || "").trim();
  if (/^no\b/i.test(text)) {
    return false;
  }
  if (/^normal:\s*new\s/i.test(text)) {
    return false;
  }
  return /^(yes\b|high:|normal:|low:)/i.test(text);
}

// Search the last 30 days, ask Grok about each match, label the real ones, and show the results.
function scanInbox() {
  var keywords = loadKeywords();
  var hits = [];
  var labelMap = loadLabelMap();
  var section = CardService.newCardSection().setHeader("Last 30 days");
  var started = Date.now();
  var stop = false;
  if (keywords.length === 0) {
    section.addWidget(CardService.newTextParagraph().setText("Save a keyword first."));
  }
  keywords.forEach(function (word) {
    if (stop) {
      return;
    }
    var safe = String(word).replace(/"/g, "");
    var threads = GmailApp.search('in:inbox "' + safe + '" newer_than:30d', 0, 10);
    threads.forEach(function (thread) {
      if (stop) {
        return;
      }
      var message = thread.getMessages().pop();
      var subject = message.getSubject() || "(no subject)";
      var from = message.getFrom() || "";
      var already = thread.getLabels().some(function (label) {
        return label.getName() === "Keyword/" + word;
      });
      if (already) {
        hits.push({ word: word, subject: subject, sentence: "Already labeled.", labeled: true });
        return;
      }
      var remaining = 25000 - (Date.now() - started);
      if (remaining < 4000) {
        stop = true;
        return;
      }
      var snippet = "";
      try {
        snippet = String(message.getPlainBody() || "").slice(0, 500);
      } catch (err) {
        snippet = "";
      }
      var sentence = grokSentence(word, from, subject, snippet, Math.min(8000, remaining - 2000));
      var labeled = shouldLabel(sentence);
      if (labeled) {
        applyKeywordLabel(thread, word, labelMap);
      }
      hits.push({ word: word, subject: subject, sentence: sentence, labeled: labeled });
    });
  });
  section.addWidget(
    CardService.newDecoratedText()
      .setText(hits.length + " hit(s)")
      .setBottomLabel(stop ? "Stopped early so Gmail would not time out. Click Check inbox again for the rest." : "Matching mail from the last 30 days")
      .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.EMAIL))
  );
  if (hits.length === 0) {
    section.addWidget(CardService.newTextParagraph().setText("No matches in the last 30 days."));
  } else {
    hits.forEach(function (hit) {
      section.addWidget(CardService.newDivider());
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel((hit.labeled ? "Labeled" : "Not labeled") + " · Keyword/" + hit.word)
          .setText(hit.sentence)
          .setBottomLabel(hit.subject)
          .setWrapText(true)
          .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.STAR))
      );
    });
  }
  section.addWidget(
    CardService.newTextButton()
      .setText("Back")
      .setOnClickAction(CardService.newAction().setFunctionName("showHome"))
  );
  return CardService.newActionResponseBuilder()
    .setStateChanged(true)
    .setNotification(CardService.newNotification().setText(stop ? "Finished part of the inbox." : "Check finished."))
    .setNavigation(
      CardService.newNavigation().pushCard(
        CardService.newCardBuilder()
          .setHeader(CardService.newCardHeader().setTitle("Results").setSubtitle("Labeled in Gmail"))
          .addSection(section)
          .build()
      )
    )
    .build();
}

// Close the current page and return to the page under it.
function showHome() {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popCard())
    .build();
}

// A plain sentence for when Grok is missing or slow. It is shown, and it is not labeled.
function matcherSentence(keyword, from, subject) {
  return "Normal: New " + keyword + " email from " + (from || "an unknown sender") + ": " + (subject || "(no subject)") + ".";
}

// Ask the Grok bot for one sentence. GROK_URL is the tunnel address, with no path on the end.
function grokSentence(keyword, from, subject, snippet, maxMs) {
  var fallback = matcherSentence(keyword, from, subject);
  var waitMs = maxMs || 8000;
  var base = PropertiesService.getScriptProperties().getProperty("GROK_URL");
  if (!base) {
    return fallback;
  }
  base = String(base).trim().replace(/\/$/, "");
  try {
    var started = UrlFetchApp.fetch(base + "/v1/session", {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify({
        message: "Keyword: " + keyword + ". From: " + from + ". Subject: " + subject + ". Snippet: " + snippet + ".",
      }),
    });
    if (started.getResponseCode() !== 200) {
      return fallback;
    }
    var session = JSON.parse(started.getContentText());
    if (!session.sessionId) {
      return fallback;
    }
    var deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      Utilities.sleep(500);
      var events = UrlFetchApp.fetch(
        base + "/v1/session/" + session.sessionId + "/events?format=json",
        { muteHttpExceptions: true }
      );
      if (events.getResponseCode() !== 200) {
        continue;
      }
      var list = (JSON.parse(events.getContentText()).events) || [];
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i].type === "message.completed" && list[i].data && list[i].data.text) {
          return list[i].data.text;
        }
      }
    }
    return fallback;
  } catch (err) {
    return fallback;
  }
}


// Pick a stable color from the word, so the same word stays the same color.
function colorForKeyword(word) {
  var sum = 0;
  for (var i = 0; i < word.length; i++) {
    sum = (sum + word.charCodeAt(i)) % LABEL_COLORS.length;
  }
  return LABEL_COLORS[sum];
}

// Read the Gmail labels once, so each keyword label can be found by name.
function loadLabelMap() {
  var map = {};
  var listed = Gmail.Users.Labels.list("me");
  (listed.labels || []).forEach(function (label) {
    map[label.name] = label;
  });
  return map;
}

// Create the colored Keyword/word label if needed, then put it on this thread.
function applyKeywordLabel(thread, word, labelMap) {
  var name = "Keyword/" + word;
  var background = colorForKeyword(word);
  if (!labelMap) {
    labelMap = loadLabelMap();
  }
  var existing = labelMap[name];
  if (!existing) {
    existing = Gmail.Users.Labels.create({
      name: name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
      color: { backgroundColor: background, textColor: LABEL_TEXT }
    }, "me");
    labelMap[name] = existing;
  } else if (!existing.color || !existing.color.backgroundColor) {
    Gmail.Users.Labels.patch({
      color: { backgroundColor: background, textColor: LABEL_TEXT }
    }, "me", existing.id);
    existing.color = { backgroundColor: background, textColor: LABEL_TEXT };
  }
  Gmail.Users.Threads.modify({ addLabelIds: [existing.id] }, "me", thread.getId());
  var gmailLabel = GmailApp.getUserLabelByName(name);
  if (!gmailLabel) {
    Utilities.sleep(500);
    gmailLabel = GmailApp.getUserLabelByName(name);
  }
  if (gmailLabel) {
    thread.addLabel(gmailLabel);
  }
}

// Ask before removing every Keyword label and the saved words.
function confirmReset() {
  var section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText(
      "This removes every Keyword label from your mail and clears the saved words."
    ))
    .addWidget(
      CardService.newTextButton()
        .setText("Remove labels")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor("#d93025")
        .setOnClickAction(CardService.newAction().setFunctionName("resetAlerts"))
    )
    .addWidget(
      CardService.newTextButton()
        .setText("Cancel")
        .setOnClickAction(CardService.newAction().setFunctionName("showHome"))
    );
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().pushCard(
        CardService.newCardBuilder()
          .setHeader(CardService.newCardHeader().setTitle("Reset"))
          .addSection(section)
          .build()
      )
    )
    .build();
}

// Delete the Keyword labels and clear the saved words for this Gmail account.
function resetAlerts() {
  PropertiesService.getUserProperties().setProperty("keywords", "[]");
  var listed = Gmail.Users.Labels.list("me");
  var labels = (listed.labels || []).filter(function (label) {
    return label.name === "Keyword" || (label.name && label.name.indexOf("Keyword/") === 0);
  });
  labels.sort(function (a, b) {
    return b.name.length - a.name.length;
  });
  labels.forEach(function (label) {
    Gmail.Users.Labels.remove("me", label.id);
  });
  return CardService.newActionResponseBuilder()
    .setStateChanged(true)
    .setNavigation(CardService.newNavigation().popCard().updateCard(buildHomeCard()))
    .setNotification(CardService.newNotification().setText("Keyword labels removed."))
    .build();
}