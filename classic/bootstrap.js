var Cc = Components.classes, Ci = Components.interfaces, Cu = Components.utils;
Cu.import("resource://gre/modules/Services.jsm");

var branch = "extensions.scriptlet-doctor.";
var enabled, unhideToolbar, clearReportOnly, limitToDomains, domRegex = null, gWindowListener = null;

function listTest(host) {
  if (domRegex === null) {
    try {
      var domainList = Services.prefs.getBranch(branch).getComplexValue("domainList", Ci.nsISupportsString).data;
      domRegex = new RegExp("^([^.]+\\.)*(" + domainList.replace(/(\*\.?|\s+\.?|^\.)/g,"").replace(/;\.?/g,"|").replace(/\./g,"\\.") + ")\\.?$");
    } catch (e) {
      return false;
    }
  }
  return domRegex.test(host);
}

var httpResponseObserver = {
  observe: function (subject, topic, data) {
    if ((topic == "http-on-examine-response" || topic == "http-on-examine-cached-response") && subject instanceof Ci.nsIHttpChannel) {
      if (limitToDomains && !listTest(subject.URI.host)) {
        return;
      }
      try {
        var csp = subject.getResponseHeader("Content-Security-Policy");
        csp = csp.replace(/script-src.+?(;|$)/, m => {
            m = m.replace(/ '(none|unsafe-hashes|strict-dynamic|nonce-.+?|sha[0-9]+-.+?=)'/g, "");
            m = m.replace(/script-src(?!.+?'unsafe-inline')/, "script-src 'unsafe-inline'");
            return m;
        });
        subject.setResponseHeader("Content-Security-Policy", csp, false);
      } catch (e) {}
      if (clearReportOnly) {
        subject.setResponseHeader("Content-Security-Policy-Report-Only", "", false);
      }
    }
  },
  register: function ()
  {
    Services.obs.addObserver(this, "http-on-examine-response", false);
    Services.obs.addObserver(this, "http-on-examine-cached-response", false);
  },
  unregister: function ()
  {
    Services.obs.removeObserver(this, "http-on-examine-response");
    Services.obs.removeObserver(this, "http-on-examine-cached-response");
  }
};

function $(node, childId) {
  if (node.getElementById) {
    return node.getElementById(childId);
  } else {
    return node.querySelector("#" + childId);
  }
}

function bImg (b, img) {
  b.style.listStyleImage = 'url("chrome://scriptlet-doctor/skin/' + img + '.png")';
}

var button = {
  meta : {
    id : "scriptlet-doctor-button",
    label : "Scriptlet Doctor",
    tooltiptext : "Scriptlet Doctor",
    class : "toolbarbutton-1 chromeclass-toolbar-additional"
  },
  install : function (w) {
    var doc = w.document;
    var b = doc.createElement("toolbarbutton");
    for (var a in this.meta) {
      b.setAttribute(a, this.meta[a]);
    }

    var toolbox = $(doc, "navigator-toolbox");
    toolbox.palette.appendChild(b);

    var {toolbarId, nextItemId} = this.getPrefs(),
      toolbar = toolbarId && $(doc, toolbarId);
    if (toolbar) {
      // Handle special items with dynamic ids
      var match = /^(separator|spacer|spring)\[(\d+)\]$/.exec(nextItemId);
      if (match !== null) {
        var dynItems = toolbar.querySelectorAll("toolbar" + match[1]);
        if (match[2] < dynItems.length) {
          nextItemId = dynItems[match[2]].id;
        }
      }
      var nextItem = nextItemId && $(doc, nextItemId);
      if (nextItem && nextItem.parentNode && nextItem.parentNode.id == toolbarId) {
        toolbar.insertItem(this.meta.id, nextItem);
      } else {
        var ids = (toolbar.getAttribute("currentset") || "").split(",");
        nextItem = null;
        for (var i = ids.indexOf(this.meta.id) + 1; i > 0 && i < ids.length; i++) {
          nextItem = $(doc, ids[i])
          if (nextItem) {
            break;
          }
        }
        toolbar.insertItem(this.meta.id, nextItem);
      }
      if (unhideToolbar && toolbar.getAttribute("collapsed") == "true") {
        w.setToolbarVisibility(toolbar, true);
      }
    }
    return b;
  },
  afterCustomize : function (e) {
    var toolbox = e.target,
      b = $(toolbox.parentNode, button.meta.id),
      toolbarId, nextItem, nextItemId;
    if (b) {
      var parent = b.parentNode;
      nextItem = b.nextSibling;
      if (parent && parent.localName == "toolbar") {
        toolbarId = parent.id;
        nextItemId = nextItem && nextItem.id;
      }
    }
    // Handle special items with dynamic ids
    var match = /^(separator|spacer|spring)\d+$/.exec(nextItemId);
    if (match !== null) {
      var dynItems = nextItem.parentNode.querySelectorAll("toolbar" + match[1]);
      for (var i = 0; i < dynItems.length; i++) {
        if (dynItems[i].id == nextItemId) {
          nextItemId = match[1] + "[" + i + "]";
          break;
        }
      }
    }
    button.setPrefs(toolbarId, nextItemId);
  },
  getPrefs : function () {
    var p = Services.prefs.getBranch(branch);
    return {
      toolbarId : p.getCharPref("bar"),
      nextItemId : p.getCharPref("before")
    };
  },
  setPrefs : function (toolbarId, nextItemId) {
    var p = Services.prefs.getBranch(branch);
    p.setCharPref("bar", toolbarId || "");
    p.setCharPref("before", nextItemId || "");
  }
};

var scrdIn = function (w) {
  var b = button.install(w);

  var windowPrefsWatcher = {
    observe: function (subject, topic, data) {
      if (topic == "nsPref:changed" && data == "enabled") {
        if (Services.prefs.getBranch(branch).getBoolPref("enabled")) {
          bImg(b, "icon");
        } else {
          bImg(b, "icoff");
        }
      }
    },
    register: function () {
      var prefsService = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);
      this.prefBranch = prefsService.getBranch(branch);
      this.prefBranch.addObserver("", this, false);
    },
    unregister: function () {
      this.prefBranch.removeObserver("", this);
    }
  }

  return {
    init : function () {
      windowPrefsWatcher.register();
      w.addEventListener("aftercustomization", button.afterCustomize, false);
      b.addEventListener("command", this.run, false);
      bImg(b, enabled ? "icon" : "icoff");
    },
    done : function () {
      windowPrefsWatcher.unregister();
      w.removeEventListener("aftercustomization", button.afterCustomize, false);
      b.removeEventListener("command", this.run, false);
      b.parentNode.removeChild(b);
      b = null;
    },
    run : function (e) {
      if (e.ctrlKey || e.metaKey) {
        var mrw = Services.wm.getMostRecentWindow("navigator:browser");
        mrw.BrowserOpenAddonsMgr("addons://detail/scriptlet-doctor@Off.JustOff/preferences");
      } else {
        Services.prefs.getBranch(branch).setBoolPref("enabled", !enabled);
      }
    }
  };
};

var globalPrefsWatcher = {
  observe: function (subject, topic, data) {
    if (topic != "nsPref:changed") return;
    switch (data) {
      case "enabled":
      if (Services.prefs.getBranch(branch).getBoolPref("enabled")) {
        httpResponseObserver.register();
        enabled = true;
      } else {
        httpResponseObserver.unregister();
        enabled = false;
      }
      break;
      case "clearReportOnly":
        clearReportOnly = Services.prefs.getBranch(branch).getBoolPref("clearReportOnly");
      break;
      case "limitToDomains":
        limitToDomains = Services.prefs.getBranch(branch).getBoolPref("limitToDomains");
      break;
      case "domainList":
        var domainList = Services.prefs.getBranch(branch).getComplexValue("domainList", Ci.nsISupportsString).data;
        if (domainList == "") {
          Services.prefs.getBranch(branch).clearUserPref("domainList");
        }
        domRegex = null;
      break;
      case "unhideToolbar":
        unhideToolbar = Services.prefs.getBranch(branch).getBoolPref("unhideToolbar");
      break;
    }
  },
  register: function () {
    var prefsService = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);
    this.prefBranch = prefsService.getBranch(branch);
    this.prefBranch.addObserver("", this, false);
  },
  unregister: function () {
    this.prefBranch.removeObserver("", this);
  }
}

function BrowserWindowObserver(handlers) {
  this.handlers = handlers;
}

BrowserWindowObserver.prototype = {
  observe: function (aSubject, aTopic, aData) {
    if (aTopic == "domwindowopened") {
      aSubject.QueryInterface(Ci.nsIDOMWindow).addEventListener("load", this, false);
    } else if (aTopic == "domwindowclosed") {
      if (aSubject.document.documentElement.getAttribute("windowtype") == "navigator:browser") {
        this.handlers.onShutdown(aSubject);
      }
    }
  },
  handleEvent: function (aEvent) {
    let aWindow = aEvent.currentTarget;
    aWindow.removeEventListener(aEvent.type, this, false);

    if (aWindow.document.documentElement.getAttribute("windowtype") == "navigator:browser") {
      this.handlers.onStartup(aWindow);
    }
  }
};

function browserWindowStartup (aWindow) {
  aWindow.scriptletDoctor = scrdIn(aWindow);
  aWindow.scriptletDoctor.init()
}

function browserWindowShutdown (aWindow) {
  aWindow.scriptletDoctor.done();
  delete aWindow.scriptletDoctor;
}

function startup(data, reason) {
  Cu.import("chrome://scriptlet-doctor/content/prefloader.js");
  PrefLoader.loadDefaultPrefs(data.installPath, "scriptlet-doctor.js");

  var p = Services.prefs.getBranch(branch);
  clearReportOnly = p.getBoolPref("clearReportOnly");
  limitToDomains = p.getBoolPref("limitToDomains");
  listTest();
  enabled = p.getBoolPref("enabled");
  if (enabled) {
    httpResponseObserver.register();
  }
  globalPrefsWatcher.register();
  unhideToolbar = p.getBoolPref("unhideToolbar");

  var ww = Cc["@mozilla.org/embedcomp/window-watcher;1"].getService(Ci.nsIWindowWatcher);
  gWindowListener = new BrowserWindowObserver({
    onStartup: browserWindowStartup,
    onShutdown: browserWindowShutdown
  });
  ww.registerNotification(gWindowListener);

  var wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
  var winenu = wm.getEnumerator("navigator:browser");
  while (winenu.hasMoreElements()) {
    browserWindowStartup(winenu.getNext());
  }
}

function shutdown(data, reason) {
  if (reason == APP_SHUTDOWN) return;

  var ww = Cc["@mozilla.org/embedcomp/window-watcher;1"].getService(Ci.nsIWindowWatcher);
  ww.unregisterNotification(gWindowListener);
  gWindowListener = null;

  var wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
  var winenu = wm.getEnumerator("navigator:browser");
  while (winenu.hasMoreElements()) {
    browserWindowShutdown(winenu.getNext());
  }

  globalPrefsWatcher.unregister();
  if (enabled) {
    httpResponseObserver.unregister();
  }

  Cu.unload("chrome://scriptlet-doctor/content/prefloader.js");
}

function install(data, reason) {}
function uninstall(data, reason) {}
