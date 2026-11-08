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
  var section = CardService.newCardSection().setHeader("Last 30 days");

  if (keywords.length === 0) {
    section.addWidget(CardService.newTextParagraph().setText("Save a keyword first."));
  }

  keywords.forEach(function (word) {
    var safe = String(word).replace(/"/g, "");
    var threads = GmailApp.search('in:inbox "' + safe + '" newer_than:30d', 0, 5);
    threads.forEach(function (thread) {
      var message = thread.getMessages().pop();
      var subject = message.getSubject() || "(no subject)";
      var from = message.getFrom() || "";
      var snippet = "";
      try {
        snippet = String(message.getPlainBody() || "").slice(0, 500);
      } catch (err) {
        snippet = "";
      }
      var sentence = grokSentence(word, from, subject, snippet);
      var labeled = !/^no\b/i.test(sentence);
      if (labeled) {
        applyKeywordLabel(thread, word, labelMap);
      }
      hits.push({ word: word, subject: subject, sentence: sentence, labeled: labeled });
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
    .setNotification(CardService.newNotification().setText("Check finished."))
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

function grokSentence(keyword, from, subject, snippet) {
  var fallback = "Yes. Normal: New " + keyword + " email from " + (from || "an unknown sender") + ": " + (subject || "(no subject)") + ".";
  var base = PropertiesService.getScriptProperties().getProperty("GROK_URL");
  if (!base) {
    return "No GROK_URL is set.";
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
      return "Bot returned " + started.getResponseCode() + ".";
    }
    var session = JSON.parse(started.getContentText());
    if (!session.sessionId) {
      return "Bot did not start a session.";
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
    return "Bot did not answer in time.";
  } catch (err) {
    return "Bot error: " + err;
  }
}