window.onload = () => {
  browser.storage.local.get(["enabled", "limitToDomains", "domainList", "defaultDomains"], res => {
    var checkEnabled = true, defaultDomains = res.defaultDomains;
    var enabled = document.querySelector("#enabled");
    enabled.checked = res.enabled;
    enabled.onchange = () => {
      if (checkEnabled) {
        browser.storage.local.set({
          enabled: enabled.checked
        });
      }
    }
    var limitToDomains = document.querySelector("#limitToDomains");
    limitToDomains.checked = res.limitToDomains;
    limitToDomains.onchange = () => {
      browser.storage.local.set({
        limitToDomains: limitToDomains.checked
      });
    }
    var domainList = document.querySelector("#domainList");
    domainList.value = res.domainList;
    domainList.onkeyup = domainList.onchange = () => {
      if (domainList.value.trim() == "") {
        domainList.value = defaultDomains;
      }
      browser.storage.local.set({
        domainList: domainList.value.trim()
      });
    }
    function buttonListener(tab, OnClickData) {
      if (!OnClickData.modifiers.includes("Ctrl")) {
        browser.storage.local.get("enabled", res => {
          checkEnabled = false;
          enabled.checked = res.enabled;
          checkEnabled = true;
        });
      }
    }
    browser.browserAction.onClicked.addListener(buttonListener);
  });
}
