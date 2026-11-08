var LABEL_TEXT = "#ffffff";
var LABEL_COLORS = ["#fb4c2f", "#a479e2", "#ffad47", "#16a765", "#4a86e8"];

function onHomepage() {
  return buildHomeCard();
}

function loadKeywords() {
  var raw = PropertiesService.getUserProperties().getProperty("keywords");
  if (raw === null) {
    return ["invoice"];
  }
  return JSON.parse(raw);
}

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

function menuRow(title, detail, icon, functionName) {
  return CardService.newDecoratedText()
    .setText(title)
    .setBottomLabel(detail)
    .setWrapText(true)
    .setStartIcon(CardService.newIconImage().setIcon(icon))
    .setOnClickAction(CardService.newAction().setFunctionName(functionName));
}

function openKeywords() {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildKeywordsCard()))
    .build();
}

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
        .setHint("invoice")
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

function scanInbox() {
  var keywords = loadKeywords();
  var hits = [];
  var labelMap = loadLabelMap();
  var askedGrok = false;
  var section = CardService.newCardSection().setHeader("Last 30 days");

  if (keywords.length === 0) {
    section.addWidget(CardService.newTextParagraph().setText("Save a keyword first."));
  }

  keywords.forEach(function (word) {
    var safe = String(word).replace(/"/g, "");
    var threads = GmailApp.search('in:inbox "' + safe + '" newer_than:30d', 0, 20);
    threads.forEach(function (thread) {
      var message = thread.getMessages().pop();
      var subject = message.getSubject() || "(no subject)";
      applyKeywordLabel(thread, word, labelMap);
      var sentence = "Matched keyword: " + word;
      if (!askedGrok) {
        sentence = grokSentence(word, subject);
        askedGrok = true;
      }
      hits.push({ word: word, subject: subject, sentence: sentence });
    });
  });

  section.addWidget(
    CardService.newDecoratedText()
      .setText(hits.length + " hit(s)")
      .setBottomLabel("Matching mail from the last 30 days")
      .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.EMAIL))
  );
  if (hits.length === 0) {
    section.addWidget(CardService.newTextParagraph().setText("No matches in the last 30 days."));
  } else {
    hits.forEach(function (hit) {
      section.addWidget(CardService.newDivider());
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel("Keyword/" + hit.word)
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
    .setNotification(CardService.newNotification().setText(hits.length + " message(s) labeled."))
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

function showHome() {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popCard())
    .build();
}

function grokSentence(keyword, subject) {
  var fallback = "Matched keyword: " + keyword;
  var base = PropertiesService.getScriptProperties().getProperty("GROK_URL");
  if (!base) {
    return fallback;
  }
  try {
    var started = UrlFetchApp.fetch(base + "/v1/session", {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify({
        message: "Keyword: " + keyword + "\nSubject: " + subject,
      }),
    });
    if (started.getResponseCode() !== 200) {
      return fallback;
    }
    var session = JSON.parse(started.getContentText());
    if (!session.sessionId) {
      return fallback;
    }
    var deadline = Date.now() + 20000;
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
  } catch (err) {
    return fallback;
  }
  return fallback;
}

function colorForKeyword(word) {
  var sum = 0;
  for (var i = 0; i < word.length; i++) {
    sum = (sum + word.charCodeAt(i)) % LABEL_COLORS.length;
  }
  return LABEL_COLORS[sum];
}

function loadLabelMap() {
  var map = {};
  var listed = Gmail.Users.Labels.list("me");
  (listed.labels || []).forEach(function (label) {
    map[label.name] = label;
  });
  return map;
}

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