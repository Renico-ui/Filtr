function onHomepage() {
  return buildHomeCard();
}

function loadKeywords() {
  const raw = PropertiesService.getUserProperties().getProperty("keywords");
  if (!raw) {
    return ["invoice"];
  }
  return JSON.parse(raw);
}

function buildHomeCard() {
  const keywords = loadKeywords();
  const section = CardService.newCardSection()
    .addWidget(
      CardService.newTextInput()
        .setFieldName("keyword")
        .setTitle("Keyword")
        .setHint("invoice")
    )
    .addWidget(
      CardService.newTextButton()
        .setText("Save keyword")
        .setOnClickAction(CardService.newAction().setFunctionName("saveKeyword"))
    )
    .addWidget(
      CardService.newTextButton()
        .setText("Check inbox")
        .setOnClickAction(CardService.newAction().setFunctionName("scanInbox"))
    )
    .addWidget(
  CardService.newTextButton()
    .setText("Reset")
    .setOnClickAction(CardService.newAction().setFunctionName("confirmReset"))
)
    .addWidget(
      CardService.newTextParagraph().setText("Saved: " + keywords.join(", "))
    );
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("Keyword alerts"))
    .addSection(section)
    .build();
}

function saveKeyword(e) {
  const word = String((e.formInput && e.formInput.keyword) || "")
    .trim()
    .toLowerCase();
  if (word) {
    const keywords = loadKeywords();
    if (keywords.indexOf(word) === -1) {
      keywords.push(word);
    }
    PropertiesService.getUserProperties().setProperty(
      "keywords",
      JSON.stringify(keywords)
    );
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildHomeCard()))
    .build();
}

function scanInbox() {
  const keywords = loadKeywords();
  const hits = [];
  const matchedThreads = {};
  const queries = [
    "in:inbox category:primary newer_than:21d",
    "in:inbox category:promotions newer_than:21d",
    "in:inbox category:social newer_than:21d",
    "in:inbox category:updates newer_than:21d",
  ];
  const seen = {};
  const threads = [];
  queries.forEach(function (query) {
    GmailApp.search(query, 0, 25).forEach(function (thread) {
      if (!seen[thread.getId()]) {
        seen[thread.getId()] = true;
        threads.push(thread);
      }
    });
  });
  threads.forEach(function (thread) {
    const message = thread.getMessages().pop();
    const subject = message.getSubject() || "";
    const preview = message.getPlainBody() || "";
    const haystack = (subject + "\n" + preview).toLowerCase();
    keywords.forEach(function (word) {
      if (haystack.indexOf(word) === -1) {
        return;
      }
      matchedThreads[thread.getId()] = true;
      const labelName = "Keyword/" + word;
const label = ensureColoredLabel(word);
thread.addLabel(label);
hits.push(labelName + " — " + subject + " — " + grokSentence(word, subject));
    });
  });

  const perKeyword = {};
  hits.forEach(function (line) {
    const word = String(line).split(" — ")[0].replace("Keyword/", "");
    perKeyword[word] = (perKeyword[word] || 0) + 1;
  });
  const summary = Object.keys(perKeyword).map(function (word) {
    return word + " " + perKeyword[word];
  }).join(" · ");
  const skippedCount = threads.length - Object.keys(matchedThreads).length;

  const section = CardService.newCardSection();
  section.addWidget(
    CardService.newTextParagraph().setText(
      hits.length + " hit(s), " + skippedCount + " skipped. " + summary
    )
  );
  if (hits.length === 0) {
    section.addWidget(
      CardService.newTextParagraph().setText("No matches in recent inbox mail.")
    );
  } else {
    hits.forEach(function (hit) {
      section.addWidget(CardService.newTextParagraph().setText(hit));
    });
  }
  section.addWidget(
    CardService.newTextButton()
      .setText("Back")
      .setOnClickAction(CardService.newAction().setFunctionName("showHome"))
  );
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().pushCard(
        CardService.newCardBuilder()
          .setHeader(CardService.newCardHeader().setTitle("Hits"))
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
    var deadline = Date.now() + 8000;
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

var LABEL_TEXT = "#ffffff";
var LABEL_COLORS = ["#fb4c2f", "#a479e2", "#ffad47", "#16a765", "#4a86e8"];

function colorForKeyword(word) {
  var sum = 0;
  for (var i = 0; i < word.length; i++) {
    sum = (sum + word.charCodeAt(i)) % LABEL_COLORS.length;
  }
  return LABEL_COLORS[sum];
}

function ensureColoredLabel(word) {
  var name = "Keyword/" + word;
  var background = colorForKeyword(word);
  var listed = Gmail.Users.Labels.list("me");
  var existing = null;
  (listed.labels || []).forEach(function (label) {
    if (label.name === name) {
      existing = label;
    }
  });
  if (existing) {
    if (!existing.color || !existing.color.backgroundColor) {
      Gmail.Users.Labels.patch({
        color: { backgroundColor: background, textColor: LABEL_TEXT }
      }, "me", existing.id);
    }
    return GmailApp.getUserLabelByName(name);
  }
  Gmail.Users.Labels.create({
    name: name,
    labelListVisibility: "labelShow",
    messageListVisibility: "show",
    color: { backgroundColor: background, textColor: LABEL_TEXT }
  }, "me");
  return GmailApp.getUserLabelByName(name);
}

function confirmReset() {
  var section = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph().setText(
        "This removes every Keyword label from your mail and clears the saved words."
      )
    )
    .addWidget(
      CardService.newTextButton()
        .setText("Remove labels")
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
    .setNavigation(
      CardService.newNavigation().popCard().updateCard(buildHomeCard())
    )
    .setNotification(CardService.newNotification().setText("Keyword labels removed."))
    .build();
}