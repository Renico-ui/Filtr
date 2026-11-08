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
      const labelName = "Keyword/" + word;
      let label = GmailApp.getUserLabelByName(labelName);
      if (!label) {
        label = GmailApp.createLabel(labelName);
      }
      thread.addLabel(label);
     hits.push(labelName + " — " + subject + " — " + grokSentence(word, subject));
    });
  });

  const section = CardService.newCardSection();
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