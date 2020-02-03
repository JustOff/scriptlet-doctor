var Cc = Components.classes, Ci = Components.interfaces, Cu = Components.utils;
Cu.import("resource://gre/modules/Services.jsm");

var branch = "extensions.scriptlet-doctor.";
var enabled, unhideToolbar, clearReportOnly, limitToDomains, domRegex = null, gWindowListener = null;
var styleSheetService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
var styleSheetURI = Services.io.newURI("chrome://scriptlet-doctor/skin/scriptlet-doctor.css", null, null);

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

function updateCSP (csp) {
  return csp.replace(/script-src.+?(;|$)/, m => {
    m = m.replace(/ '(none|unsafe-hashes|strict-dynamic|nonce-.+?|sha[0-9]+-.+?=)'/g, "");
    m = m.replace(/script-src(?!.+?'unsafe-inline')/, "script-src 'unsafe-inline'");
    return m;
  });
}

var httpResponseObserver = {
  observe: function (subject, topic, data) {
    if ((topic == "http-on-examine-response" || topic == "http-on-examine-cached-response") && subject instanceof Ci.nsIHttpChannel) {
      try {
        var ctype = subject.getResponseHeader("Content-Type");
        if (ctype.toLowerCase().indexOf("text/html") == -1) {
          return;
        }
      } catch (e) {}
      if (limitToDomains && !listTest(subject.URI.host)) {
        return;
      }
      try {
        var csp = subject.getResponseHeader("Content-Security-Policy");
        subject.setResponseHeader("Content-Security-Policy", updateCSP(csp), false);
      } catch (e) {}
      if (clearReportOnly) {
        subject.setResponseHeader("Content-Security-Policy-Report-Only", "", false);
      }
      subject.QueryInterface(Ci.nsITraceableChannel);
      var newListener = new TracingListener();
      newListener.originalListener = subject.setNewListener(newListener);
    }
  },
  QueryInterface: function (aIID) {
    if (aIID.equals(Ci.nsIObserver) || aIID.equals(Ci.nsISupports)) {
      return this;
    } else {
      throw Cr.NS_NOINTERFACE;
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

function CCIN (cName, ifaceName) {
  return Cc[cName].createInstance(Ci[ifaceName]);
}

function TracingListener () {
  this.receivedData = [];
}

TracingListener.prototype = {
  onDataAvailable: function (request, context, inputStream, offset, count) {
    var binaryInputStream = CCIN("@mozilla.org/binaryinputstream;1", "nsIBinaryInputStream");
    binaryInputStream.setInputStream(inputStream);
    var data = binaryInputStream.readBytes(count);
    this.receivedData.push(data);
  },
  onStartRequest: function (request, context) {
    try {
      this.originalListener.onStartRequest(request, context);
    } catch (err) {
      request.cancel(err.result);
    }
  },
  onStopRequest: function (request, context, statusCode) {
    var data = this.receivedData.join("");
    try {
      data = data.replace(/<meta\s+http-equiv(?:\s+)?=(?:\s+)?"Content-Security-Policy"\s+content(?:\s+)?=(?:\s+)?"(.+?)"(?:\s+)?>/gi,
        (m, csp) => {
          return "<meta http-equiv=\"Content-Security-Policy\" content=\"" + updateCSP(csp) + "\">";
        });
    } catch (e) {}
    var storageStream = CCIN("@mozilla.org/storagestream;1", "nsIStorageStream");
    storageStream.init(8192, data.length, null);
    var os = storageStream.getOutputStream(0);
    if (data.length > 0) {
      os.write(data, data.length);
    }
    os.close();
    try {
      this.originalListener.onDataAvailable(request, context, storageStream.newInputStream(0), 0, data.length);
    } catch (e) {}
    try {
      this.originalListener.onStopRequest(request, context, statusCode);
    } catch (e) {}
  },
  QueryInterface: function (aIID) {
    if (aIID.equals(Ci.nsIStreamListener) || aIID.equals(Ci.nsISupports)) {
      return this;
    } else {
      throw Cr.NS_NOINTERFACE;
    }
  }
}

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
      if (nextItem && nextItem.parentNode && nextItem.parentNode.id.replace("-customization-target", "") == toolbarId) {
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
        try { w.setToolbarVisibility(toolbar, true); } catch(e) {}
      }
    }
    return b;
  },
  onCustomize : function (e) {
    try {
      var ucs = Services.prefs.getCharPref("browser.uiCustomization.state");
      if ((/\"nav\-bar\"\:\[.*?\"scriptlet\-doctor\-button\".*?\]/).test(ucs)) {
        Services.prefs.getBranch(branch).setCharPref("bar", "nav-bar");
      } else {
        button.setPrefs(null, null);
      }
    } catch(e) {}
  },
  afterCustomize : function (e) {
    var toolbox = e.target,
      b = $(toolbox.parentNode, button.meta.id),
      toolbarId, nextItem, nextItemId;
    if (b) {
      var parent = b.parentNode;
      nextItem = b.nextSibling;
      if (parent && (parent.localName == "toolbar" || parent.classList.contains("customization-target"))) {
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
    p.setCharPref("bar", toolbarId == "nav-bar-customization-target" ? "nav-bar" : toolbarId || "");
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
      w.addEventListener("customizationchange", button.onCustomize, false);
      w.addEventListener("aftercustomization", button.afterCustomize, false);
      b.addEventListener("command", this.run, false);
      bImg(b, enabled ? "icon" : "icoff");
    },
    done : function () {
      windowPrefsWatcher.unregister();
      w.removeEventListener("customizationchange", button.onCustomize, false);
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

  if (!styleSheetService.sheetRegistered(styleSheetURI, styleSheetService.USER_SHEET)) {
    styleSheetService.loadAndRegisterSheet(styleSheetURI, styleSheetService.USER_SHEET);
  }

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

  if (styleSheetService.sheetRegistered(styleSheetURI, styleSheetService.USER_SHEET)) {
    styleSheetService.unregisterSheet(styleSheetURI, styleSheetService.USER_SHEET);
  }

  Cu.unload("chrome://scriptlet-doctor/content/prefloader.js");
}

function install(data, reason) {}
function uninstall(data, reason) {}
