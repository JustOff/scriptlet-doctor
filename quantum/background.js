var defaultDomains = "yandex.by;yandex.kz;yandex.ru;yandex.ua;yandex.net;yastatic.net";
var enabled = false, limitToDomains, domainPattern;

function updateCSP(e) {
  e.responseHeaders.forEach(header => {
    if (header.name.toLowerCase() == "content-security-policy") {
      header.value = header.value.replace(/script-src.+?(;|$)/, m => {
        m = m.replace(/ '(none|unsafe-hashes|strict-dynamic|nonce-.+?|sha[0-9]+-.+?=)'/g, "");
        m = m.replace(/script-src(?!.+?'unsafe-inline')/, "script-src 'unsafe-inline'");
        return m;
      });
    }
  });
  return {responseHeaders: e.responseHeaders};
}

function enableScDoctor(updateIcon = true) {
  var matchPattern;
  if (limitToDomains) {
    matchPattern = domainPattern;
  } else {
    matchPattern = ["*://*/*"];
  }
  browser.webRequest.onHeadersReceived.addListener(
    updateCSP,
    {urls : matchPattern},
    ["blocking", "responseHeaders"]
  );
  if (updateIcon) {
    browser.browserAction.setIcon({path: "skin/icon.png"});
  }
}

function disableScDoctor(updateIcon = true) {
  browser.webRequest.onHeadersReceived.removeListener(updateCSP);
  if (updateIcon) {
    browser.browserAction.setIcon({path: "skin/icoff.png"});
  }
}

function restartScDoctor() {
  if (enabled) {
    disableScDoctor(false /*updateIcon*/);
    enableScDoctor(false /*updateIcon*/);
  }
}

function buttonListener(tab, OnClickData) {
  if (OnClickData.modifiers.includes("Ctrl")) {
    browser.runtime.openOptionsPage();
  } else {
    if (enabled) {
      browser.storage.local.set({"enabled": false});
    } else {
      browser.storage.local.set({"enabled": true});
    }
  }
}

function updateDomainList(domains) {
  domainPattern = [];
  domains.split(";").forEach(domain => {
    domainPattern.push("*://*." + domain.trim().replace(/^\*\.?/,"") + "/*");
  });
}

function storageListener(changes) {
  if (changes["enabled"]) {
    if (changes["enabled"].newValue) {
      enabled = true;
      enableScDoctor();
    } else {
      enabled = false;
      disableScDoctor();
    }
  } else if (changes["domainList"]) {
    updateDomainList(changes["domainList"].newValue || defaultDomains);
    if (limitToDomains) {
      restartScDoctor();
    }
  } else if (changes["limitToDomains"]) {
    limitToDomains = changes["limitToDomains"].newValue;
    restartScDoctor();
  }
}

browser.storage.onChanged.addListener(storageListener);
browser.browserAction.onClicked.addListener(buttonListener);

browser.storage.local.get(["enabled", "limitToDomains", "domainList", "defaultDomains"], res => {
  if (res.defaultDomains != defaultDomains) {
    browser.storage.local.set({"defaultDomains": defaultDomains});
  }
  if (res.domainList === undefined) {
    browser.storage.local.set({"domainList": defaultDomains});
  } else {
    updateDomainList(res.domainList);
  }
  if (res.limitToDomains === undefined) {
    browser.storage.local.set({"limitToDomains": true});
  } else {
    limitToDomains = res.limitToDomains;
  }
  if (res.enabled === undefined) {
    browser.storage.local.set({"enabled": true});
  } else if (res.enabled) {
    enabled = true;
    enableScDoctor();
  }
});
