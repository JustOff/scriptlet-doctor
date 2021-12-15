/*******************************************************************************

    Scriptlet Doctor - Allow inline scripts regardless of site policy
    Copyright (C) 2020 JustOff

    filterDocument() is based on traffic.js module from uBlock Origin
    https://github.com/gorhill/uBlock/blob/master/src/js/traffic.js
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/JustOff/scriptlet-doctor
*/

var defaultDomains = "yandex.by;yandex.kz;yandex.ru;yandex.ua;yandex.uz;yandex.net;yandex.com;yastatic.net;auto.ru;ukr.net";
var enabled = false, limitToDomains, domainPattern, bug1635781;

function updateCSP(csp) {
  return csp.replace(/script-src.+?(;|$)/, m => {
    m = m.replace(/ '(none|unsafe-hashes|strict-dynamic|nonce-.+?|sha[0-9]+-.+?=)'/g, "");
    m = m.replace(/script-src(?!.+?'unsafe-inline')/, "script-src 'unsafe-inline'");
    return m;
  });
}

const filterDocument = (function() {
  const filterers = new Map();
  let domParser, xmlSerializer, utf8TextDecoder, textDecoder, textEncoder;

  const headerIndexFromName = function(headerName, headers) {
    let i = headers.length;
    while ( i-- ) {
      if ( headers[i].name.toLowerCase() === headerName ) {
        return i;
      }
    }
    return -1;
  };

  const headerValueFromName = function(headerName, headers) {
    const i = headerIndexFromName(headerName, headers);
    return i !== -1 ? headers[i].value : '';
  };

  const textDecode = function(encoding, buffer) {
    if (
      textDecoder !== undefined &&
      textDecoder.encoding !== encoding
    ) {
      textDecoder = undefined;
    }
    if ( textDecoder === undefined ) {
      textDecoder = new TextDecoder(encoding);
    }
    return textDecoder.decode(buffer);
  };

  const reContentTypeDocument = /^(?:text\/html|application\/xhtml\+xml)/i;
  const reContentTypeCharset = /charset=['"]?([^'" ]+)/i;

  const mimeFromContentType = function(contentType) {
    const match = reContentTypeDocument.exec(contentType);
    if ( match !== null ) {
      return match[0].toLowerCase();
    }
  };

  const charsetFromContentType = function(contentType) {
    const match = reContentTypeCharset.exec(contentType);
    if ( match !== null ) {
      return match[1].toLowerCase();
    }
  };

  const charsetFromDoc = function(doc) {
    let meta = doc.querySelector('meta[charset]');
    if ( meta !== null ) {
      return meta.getAttribute('charset').toLowerCase();
    }
    meta = doc.querySelector(
      'meta[http-equiv="content-type" i][content]'
    );
    if ( meta !== null ) {
      return charsetFromContentType(meta.getAttribute('content'));
    }
  };

  const streamClose = function(filterer, buffer) {
    if ( buffer !== undefined ) {
      filterer.stream.write(buffer);
    } else if ( filterer.buffer !== undefined ) {
      filterer.stream.write(filterer.buffer);
    }
    filterer.stream.close();
  };

  const onStreamData = function(ev) {
    const filterer = filterers.get(this);
    if ( filterer === undefined ) {
      this.write(ev.data);
      this.disconnect();
      return;
    }
    if (
      this.status !== 'transferringdata' &&
      this.status !== 'finishedtransferringdata'
    ) {
      filterers.delete(this);
      this.disconnect();
      return;
    }
    if ( filterer.buffer === null ) {
      filterer.buffer = new Uint8Array(ev.data);
      return;
    }
    const buffer = new Uint8Array(
      filterer.buffer.byteLength +
      ev.data.byteLength
    );
    buffer.set(filterer.buffer);
    buffer.set(new Uint8Array(ev.data), filterer.buffer.byteLength);
    filterer.buffer = buffer;
  };

  const onStreamStop = function() {
    const filterer = filterers.get(this);
    filterers.delete(this);
    if ( filterer === undefined || filterer.buffer === null ) {
      this.close();
      return;
    }
    if ( this.status !== 'finishedtransferringdata' ) { return; }

    if ( domParser === undefined ) {
      domParser = new DOMParser();
      xmlSerializer = new XMLSerializer();
    }
    if ( textEncoder === undefined ) {
      textEncoder = new TextEncoder();
    }

    let doc;

    // If stream encoding is still unknnown, try to extract from document.
    let charsetFound = filterer.charset,
      charsetUsed = charsetFound;
    if ( charsetFound === undefined ) {
      if ( utf8TextDecoder === undefined ) {
        utf8TextDecoder = new TextDecoder();
      }
      doc = domParser.parseFromString(
        utf8TextDecoder.decode(filterer.buffer.slice(0, 1024)),
        filterer.mime
      );
      charsetFound = charsetFromDoc(doc);
      charsetUsed = textEncode.normalizeCharset(charsetFound);
      if ( charsetUsed === undefined ) {
        return streamClose(filterer);
      }
    }

    doc = domParser.parseFromString(
      textDecode(charsetUsed, filterer.buffer),
      filterer.mime
    );

    // https://github.com/gorhill/uBlock/issues/3507
    //   In case of no explicit charset found, try to find one again, but
    //   this time with the whole document parsed.
    if ( charsetFound === undefined ) {
      charsetFound = textEncode.normalizeCharset(charsetFromDoc(doc));
      if ( charsetFound !== charsetUsed ) {
        if ( charsetFound === undefined ) {
          return streamClose(filterer);
        }
        charsetUsed = charsetFound;
        doc = domParser.parseFromString(
          textDecode(charsetFound, filterer.buffer),
          filterer.mime
        );
      }
    }

    let csp = doc.querySelector(
      'meta[http-equiv="Content-Security-Policy" i][content]'
    );
    if ( csp && csp.content ) {
      csp.content = updateCSP(csp.content.replace(/&#x27;/g, "'"));
    } else if ( filterer.csp !== undefined ) {
        let heads = doc.getElementsByTagName('head');
        if ( heads && heads[0] ) {
          let meta = doc.createElement('meta');
          meta.httpEquiv = "Content-Security-Policy";
          meta.content = updateCSP(filterer.csp.replace(/&#x27;/g, "'"));
          heads[0].appendChild(meta);
        }
    } else {
      return streamClose(filterer);
    }

    // https://stackoverflow.com/questions/6088972/get-doctype-of-an-html-as-string-with-javascript/10162353#10162353
    const doctypeStr = doc.doctype instanceof Object ?
        xmlSerializer.serializeToString(doc.doctype) + '\n' :
        '';

    // https://github.com/gorhill/uBlock/issues/3391
    let encodedStream = textEncoder.encode(
      doctypeStr +
      doc.documentElement.outerHTML
    );
    if ( charsetUsed !== 'utf-8' ) {
      encodedStream = textEncode.encode(
        charsetUsed,
        encodedStream
      );
    }

    streamClose(filterer, encodedStream);
  };

  const onStreamError = function() {
    filterers.delete(this);
  };

  return function(details, csp) {
    // https://github.com/gorhill/uBlock/issues/3478
    const statusCode = details.statusCode || 0;
    if ( statusCode !== 0 && (statusCode < 200 || statusCode >= 300) ) {
      return;
    }

    const request = {
      stream: undefined,
      buffer: null,
      mime: 'text/html',
      charset: undefined,
      csp: undefined
    };

    const headers = details.responseHeaders;
    const contentType = headerValueFromName('content-type', headers);
    if ( contentType !== '' ) {
      request.mime = mimeFromContentType(contentType);
      if ( request.mime === undefined ) { return; }
      let charset = charsetFromContentType(contentType);
      if ( charset !== undefined ) {
        charset = textEncode.normalizeCharset(charset);
        if ( charset === undefined ) { return; }
        request.charset = charset;
      }
    }
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1426789
    if ( headerValueFromName('content-disposition', headers) ) { return; }

    if ( csp !== undefined ) {
      request.csp = csp;
    }

    const stream = request.stream =
      browser.webRequest.filterResponseData(details.requestId);
    stream.ondata = onStreamData;
    stream.onstop = onStreamStop;
    stream.onerror = onStreamError;
    filterers.set(stream, request);

    return true;
  };
})();

function updateResponse(details) {
  var csp = undefined;
  for (var i = 0; i < details.responseHeaders.length; ++i) {
    if (details.responseHeaders[i].name.toLowerCase() == "content-security-policy") {
      if (bug1635781) {
        csp = details.responseHeaders[i].value;
        details.responseHeaders.splice(i, 1);
      } else {
        details.responseHeaders[i].value = updateCSP(details.responseHeaders[i].value);
      }
      break;
    }
  }
  filterDocument(details, csp);
  return {responseHeaders: details.responseHeaders};
}

function enableScDoctor(updateIcon = true) {
  var matchPattern;
  if (limitToDomains) {
    matchPattern = domainPattern;
  } else {
    matchPattern = ["*://*/*"];
  }
  browser.webRequest.onHeadersReceived.addListener(
    updateResponse,
    {urls : matchPattern, types: ["main_frame", "sub_frame", "xmlhttprequest"]},
    ["blocking", "responseHeaders"]
  );
  if (updateIcon) {
    browser.browserAction.setIcon({path: "skin/icon.png"});
  }
}

function disableScDoctor(updateIcon = true) {
  browser.webRequest.onHeadersReceived.removeListener(updateResponse);
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

browser.runtime.getBrowserInfo().then(info => {
  bug1635781 = isSemVer(info.version, ">= 77.0a1", "< 78.1");
});

browser.storage.onChanged.addListener(storageListener);
browser.browserAction.onClicked.addListener(buttonListener);

browser.storage.local.get(["enabled", "limitToDomains", "domainList", "defaultDomains"], res => {
  if (res.defaultDomains != defaultDomains) {
    browser.storage.local.set({"defaultDomains": defaultDomains});
  }
  if (res.domainList === undefined ||
      (res.domainList == res.defaultDomains && res.defaultDomains != defaultDomains)) {
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
