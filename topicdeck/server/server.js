'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var express = _interopDefault(require('express'));
var fs$1 = _interopDefault(require('fs'));
var url = require('url');
var feed2json = _interopDefault(require('feed2json'));
var compression = _interopDefault(require('compression'));

/**!
 *
 * Copyright 2016 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

function unescape(code) {
  return code.replace(/\\('|\\)/g, "$1").replace(/[\r\t\n]/g, " ");
}
const templateSettings = {
      evaluate: /\{\{(([^\}]+|\\.)+)\}\}/g,
      interpolate: /\{\{=\s*([^\}]+)\}\}/g,
      stream: /\{\{~\s*([^\}]+)\}\}/g,
      conditional: /\{\{\?(\?)?\s*([^\}]*)?\}\}/g,
      node: typeof(process) === 'object',
      varname: "it"
    };

const compile = function(tmpl, c, def) {
    c = Object.assign({}, templateSettings, c);
    var helpers = 
      "var P=Promise.resolve.bind(Promise);" +
      "function* f(p,a,b){yield p.then(v=>(a=v?a:b)&&'');yield* (a||(_=>[]))();};";
    var streamToGenerator;
    var streamNodeGenerator;
    var streamWGGenerator;
    
    streamNodeGenerator = 
`var sNode=rN=>{
var d=!1,l,b=[];
rN.then(rN=>{
rN.on('end',_=>{d=!0;l&&l()});
rN.on('data',c=>(l&&(v=>{var t=l;l=null;t(v)})||(d=>b.push(d)))(c));
});
return i={next:_=>({done:b.length===0&&d,value:P(b.shift()||new Promise(rN=>l=rN))}),[Symbol.iterator]:_=>i};};`;
    
   streamWGGenerator = 
`var sWhatWg=rW=>{
rW=rW.then(l=>l.getReader());
var d=!1;
return i={next:_=>({done:d,value:rW.then(rW=>rW.read()).then(v=>{d=v.done; return P(v.value)})}),[Symbol.iterator]:_=>i};
};`;
    
    streamToGenerator = `var s = function(x) { return x.then(stream => (stream.constructor.name === 'StreamReader') ? sNode : sWhatWg )};`;

    tmpl = helpers + streamToGenerator + streamWGGenerator + streamNodeGenerator + 
        "var g=function*(){yield P('"
        + tmpl
            .replace(/'|\\/g, "\\$&")
            .replace(c.interpolate, function(_, code) {
              return "');yield P(" + unescape(code) + ");yield P('";
            })
            .replace(c.conditional, function(_, els, code) {
              if (code && !els) { // {{?<something>}} === if
                return "');yield* f(P(" + unescape(code) + "),function*(){yield P('"
              } else if (!code && els) { // {{??}} === else
                return "')},function*(){yield P('";
              } else { // {{?}} === "endif"
                return "')});yield P('";
              }
            })
            .replace(c.stream, function(_, code) {
              return "');yield* sWhatWg(P(" + unescape(code) + "));yield P('";
            })
            .replace(c.evaluate, function(_, code) {
              return "');" + unescape(code) + ";yield P('";
            })
            .replace(/\n/g, "\\n")
            .replace(/\t/g, '\\t')
            .replace(/\r/g, "\\r")
         + "');}();";

    if(c.node) {
      tmpl +=
`var r = new R({read:function f() {
var d=g.next();
if(d.done) return r.push(null);
P(d.value).then(v=>{if(v)return r.push(Buffer.from(v));else f()});
}});
return r;
`;
    } else {
      tmpl +=
`var e=new TextEncoder();
return new ReadableStream({
pull: c=>{
var v=g.next();
if(v.done)return c.close();
v.value.then(d=>{
if(typeof(d)=="string")d=e.encode(d);
d&&c.enqueue(d);
});
return v.value;
}});`;
    }

    try {
      if (c.noEval) return tmpl;
      if (c.node) {
        const f = new Function(c.varname, 'R', tmpl); 
        return it => f(it, require('stream').Readable);
      } 
      return new Function(c.varname, tmpl);
    } catch (e) {
      console.log("Could not create a template function: " + tmpl);
      throw e;
    }
  };

/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs');
const TextDecoder = require('text-encoding').TextDecoder;
const DOMParser = require('xmldom-alpha').DOMParser;
const ReadableStream = require('./private/streams/readable-stream.js').ReadableStream;
const WritableStream = require('./private/streams/writable-stream.js').WritableStream;
const {FromWhatWGReadableStream} = require('fromwhatwgreadablestream');
const fetch = require('node-fetch');
const URL = require('whatwg-url').URL;
const stringToStream = require('string-to-stream');
const Request = fetch.Request;
const Response = fetch.Response;

/*
  This file is basically me futzing about with Streams between Node and WhatWG
*/
function streamToString(stream) {
  const reader = stream.getReader();
  let buffer = new Uint8Array();
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve=res;
    reject=rej;
  });

  function pull() {
    return reader.read().then(({value, done}) => {
      if (done) {
        const decoder = new TextDecoder();
        return resolve(decoder.decode(buffer));
      }

      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;

      return pull();
    }, e => reject(e));
  }

  pull();

  return promise;
}

const sendStream = (stream, last, res) => {
  if (stream == null || typeof(stream) === 'string') {
    if (last) {
      res.end();
    }
    return Promise.resolve();
  }

  stream.on('data', (data) => {
    res.write(data);
  });

  return new Promise((resolve, reject)=> {
    stream.on('end', () => {
      if (last) {
        res.end();
      }
      resolve();
    });

    stream.on('error', () => {
      res.end();
      reject();
    });
  });
};

const nodeReadStreamToWhatWGReadableStream = (stream) => {
  return new ReadableStream({
    start(controller) {
      stream.on('data', data => {
        controller.enqueue(data);
      });
      stream.on('error', error => {
        console.log(error);
        controller.abort(error);
      });
      stream.on('end', () => {
        controller.close();
      });
    }
  });
};

const loadTemplate = (path) => {
  return Promise.resolve(nodeReadStreamToWhatWGReadableStream(fs.createReadStream(path)));
};

const loadData = (path) => {
  return Promise.resolve(new Response(fs.createReadStream(path)));
};

function compileTemplate(path) {
  return loadTemplate(path)
      .then(stream => streamToString(stream))
      .then(template => {
        const f = compile(template, {node: true, evaluate: /\$\$(([^\$]+|\\.)+)\$\$/g});
        return (data) => nodeReadStreamToWhatWGReadableStream(f(data));
      });
}

const responseToExpressStream = (expressResponse, fetchResponseStream) => {
  const stream = new FromWhatWGReadableStream({}, fetchResponseStream);
  stream.pipe(expressResponse, {end: true});
};

// Need a better interface to a memory store.
// The server can host multiple origins cache.
const cacheStorage = {};

const caches = new (function() {
  this.open = (cacheName) => {
    return Promise.resolve({
      'match': this.match,
      'put': () => null
    });
  };

  this.has = (cacheName) => {
    return Promise.resolve(true);
  };

  this.match = (request, options) => {
    const url = parseUrl(request);
    
    if (url in cacheStorage) {
      const cachedResponse = cacheStorage[url];
      const cachedResponseStream = stringToStream(cachedResponse);
      return Promise.resolve(new Response(cachedResponseStream, {status: '200', contentType: 'text/xml'}));
    } else {
      return Promise.resolve(undefined);
    }
  };
});

const parseUrl = request => {
  return getProxyUrl(request);
};

const getProxyUrl = request => {
  let url;
  if (request.searchParams) {
    url = request.searchParams.get('url');
  } else {
    url = new URL(request.url).searchParams.get('url');
  }
  return url;
};

const getProxyHeaders = request => {
  return {
    'X-Forwarded-For': request.ips
  };
};

const paths = {
  assetPath: 'public/assets/',
  dataPath: 'configs/'
};

/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

let templates = {};

function getCompiledTemplate(template) {
  if(template in templates) return Promise.resolve(templates[template]);
  return compileTemplate$1(template).then(templateFunction => templates[template] = templateFunction);
}

function generateCSPPolicy(nonce) {
  return `default-src 'self'; script-src 'self' https://www.googletagmanager.com https://www.google-analytics.com 'nonce-script-${nonce.analytics}' 'unsafe-eval'; connect-src 'self'; img-src 'self' data: https://www.google-analytics.com; style-src 'self' 'nonce-style-${nonce.style}' 'nonce-style-${nonce.inlinedcss}';`; 
}
function generateIncrementalNonce(source) {
  let val = 0;
  let max = Math.pow(10, 3); // Date + pow 3 gets us close to max number;

  const generate = () => {
    let now = max * +new Date();
    if(val >= max) val = 0;
    else val++;
    return (source !== undefined ? source : '') + (now + val).toString();
  };

  return generate;
}
var ConcatStream = function() {
  let readableController;
  this.readable = new ReadableStream$1({
    start(controller) {
      readableController = controller;
    },
    abort(reason) {
      this.writable.abort(reason);
    }
  });
  this.writable = new WritableStream$1({
    write(chunks) {
      readableController.enqueue(chunks);
    },
    close() {
      readableController.close();
    },
    abort(reason) {
      readableController.error(new Error(reason));
    }
  });
};
const compileTemplate$1 = compileTemplate;
const loadData$1 = loadData;
const CommonDOMParser = DOMParser;
const ReadableStream$1 = ReadableStream;
const WritableStream$1 = WritableStream;
const fetch$1 =  fetch;
const Request$1 = Request;
const Response$1 = Response;
const caches$1 = caches;
const cacheStorage$1 = cacheStorage;
const parseUrl$1 = parseUrl;
const getProxyUrl$1 = getProxyUrl;
const getProxyHeaders$1 = getProxyHeaders;
const paths$1 = paths;

/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const findNode = (tagName, nodes) => {
  let node;
  for (let i = 0; i < nodes.length; i++) {
    node = nodes[i];
    if (node.tagName == tagName) {
      return node;
    }
  }

  return undefined;
};

const findNodes = (tagName, nodes) => {
  const foundNodes = [];
  let node;
  for (let i = 0; i < nodes.length; i++) {
    node = nodes[i];
    if (node.tagName == tagName) {
      foundNodes.push(node);
    }
  }

  return foundNodes;
};

const hardSanitize = (str, limit) => {
  limit = limit || 100;
  let strip = false;
  const output = [];

  for (let c of str) {
    if (output.length > limit) break;
    if (c == '<') {
      strip = true;
      continue;
    }
    if (c == '>' && strip == true) {
      strip = false;
      continue;
    }
    if (c == '\n' || c == '\r') {
      continue;
    }
    if (strip) continue;

    output.push(c);
  }
  return output.join('');
};

const findElementText = (tagName, item) => {
  const elements = findNodes(tagName, item.childNodes);
  if (elements && elements.length > 0) {
    return elements[0].textContent;
  }

  return '';
};

const findElementAttribute = (tagName, attribute, item) => {
  const elements = findNodes(tagName, item.childNodes);
  if (elements && elements.length > 0) {
    const attr = elements[0].attributes.getNamedItem(attribute);
    return (attr !== undefined) ? attr.value : '';
  }

  return '';
};

const attributeEquals = (attribute, value) => {
  return (element) => {
    const attr = element.attributes.getNamedItem(attribute);
    return (attr && attr.value === value);
  };
};

const convertFeedItemsToJSON = (feedText) => {
  if (feedText === undefined) return [];

  const parser = new CommonDOMParser();
  const feed = parser.parseFromString(feedText, 'application/xml');
  const documentElement = feed.documentElement;
  const defaults = {};

  if (documentElement === null) {
    return [];
  }

  if (documentElement.nodeName === 'rss') {
    const channel = findNode('channel', documentElement.childNodes);
    const title = findElementText('title', channel);
    const link = findElementText('link', channel);
    const items = findNodes('item', channel.childNodes);

    defaults.title = title;
    defaults.link = link;

    return items.map(item => convertRSSItemToJSON(item, defaults));
  } else if (documentElement.nodeName === 'feed') {
    const entrys = findNodes('entry', documentElement.childNodes);
    const title = findElementText('title', documentElement);
    const link = '';

    const linkElement = findNodes('link', documentElement)
        .filter(attributeEquals('rel', 'self'))[0];

    defaults.title = title;
    defaults.link = link;

    return entrys.map(entry => convertAtomItemToJSON(entry, defaults));
  } else {
    return [];
  }
};

const convertAtomItemToJSON = (item, defaults) => {
  const title = findElementText('title', item);
  const description = findElementText('summary', item);
  const guid = findElementText('id', item);
  const pubDate = findElementText('updated', item);
  const author = findElementText('author', item) || findElementText('dc:creator', item) || defaults.title;
  const link = findElementAttribute('link', 'href', item);

  return {'title': hardSanitize(title, 400), 'guid': guid, 'description': hardSanitize(description, 100), 'pubDate': pubDate, 'author': author, 'link': link};
};

const convertRSSItemToJSON = (item, defaults) => {
  const title = findElementText('title', item);
  const description = findElementText('description', item);
  const guid = findElementText('guid', item);
  const pubDate = findElementText('pubDate', item) || findElementText('a10:updated', item);
  const author = findElementText('author', item) || findElementText('dc:creator', item) || defaults.title;
  const link = findElementText('link', item);
  const contentEncoded = findElementText('content:encoded', item);
 
  return {'title': hardSanitize(title, 400), 'guid': guid, 'description': hardSanitize(description, 100), 'content:encoded': hardSanitize(contentEncoded, 100), 'pubDate': pubDate, 'author': author, 'link': link};
};

const root = (nonce, paths, templates) => {
  const config = loadData$1(`${paths.dataPath}config.json`).then(r => r.json());

  const concatStream = new ConcatStream;

  const jsonFeedData = fetchCachedFeedData(config, templates.item, templates.column);

  const streams = {
    styles: templates.columnsStyle.then(render => config.then(c => render({config: c, nonce: nonce}))),
    data: templates.columns.then(render => jsonFeedData.then(columns => render({columns: columns}))),
    itemTemplate: templates.item.then(render => render({options: {includeAuthor: false, new: true}, item: {}}))
  };

  const headStream = templates.head.then(render => render({config: config, streams: streams, nonce: nonce}));

  headStream.then(stream => stream.pipeTo(concatStream.writable));

  return Promise.resolve(new Response$1(concatStream.readable, {status: '200'}));
};

// Helpers
const fetchCachedFeedData = (config, itemTemplate, columnTemplate) => {
  // Return a promise that resolves to a map of column id => cached data.
  const resolveCache = (cache, url) => (cache) ? cache.match(new Request$1(url)).then(response => (response) ? response.text() : undefined) : Promise.resolve();
  const templateOptions = {
    includeAuthor: false
  };

  const mapColumnsToCache = (cache, config) => {
    return config.columns.map(column => {
      return {
        config: column,
        data: resolveCache(cache, `${config.origin}/proxy?url=${encodeURIComponent(column.feedUrl)}`).then(items => convertFeedItemsToJSON(items))
      };
    });
  };

  const renderItems = (items) => {
    return itemTemplate.then(render => render({templateOptions: templateOptions, items: items}));
  };

  return caches$1.open('data')
      .then(cache => config.then(configData => mapColumnsToCache(cache, configData)))
      .then(columns => {
        return columns.map(column => {
          return column.data.then(data => {
            return {
              config: column.config,
              items: renderItems(data)
            };
          });
        });
      })
      .then(columns => columns.map(column => {
        return columnTemplate.then(render => column.then(c => {
          const result = render({column: c});
          return result;
        }
        ));
      }));
};

const handler = root;

const proxyHandler = (request, paths) => {
  const config = loadData$1(`${paths.dataPath}config.json`).then(r => r.json());

  /*
    Go out to the networks.
  */
  const url = parseUrl$1(request); // The URL we want to fetch.

  return config.then(c => {
    if (c.columns.map(col => col.feedUrl).indexOf(url) < 0 && url.endsWith('/all.rss') == false) {
      // The proxyRequest to proxy is not in the list of configured urls
      return new Response$1('Proxy feed not configured', {status: '401'});
    }
    // Always hit the network, and update the cache so offline (and the streming) renders are ok.
    return caches$1.match(request).then((response) => {
      const proxyUrl = getProxyUrl$1(request);
      return response;
      return fetch$1(proxyUrl, getProxyHeaders$1(request)).then(fetchResponse => {
        if (fetchResponse.ok) {
          // Update the cache, but return the network response
          return caches$1.open('data')
              .then(cache => (cache) ? cache.put(request, fetchResponse.clone()) : undefined)
              .then(_ => fetchResponse);
        }
      });
    }).catch(error => {
      console.log('Proxy Fetch Error', error);
      throw error;
    });
  });
};

const handler$1 = proxyHandler;

const all = (nonce, paths, templates) => {
  const config = loadData$1(`${paths.dataPath}config.json`).then(r => r.json());
  const concatStream = new ConcatStream;
  const jsonFeedData = fetchCachedFeedData$1(config, templates.item);

  const streams = {
    styles: templates.allStyle.then(render => config.then(c => render({config: c, nonce: nonce}))),
    data: templates.column.then(render => config.then(c => jsonFeedData.then(items => render({column: {config: {feedUrl: c.feedUrl, name: c.content.allTitle}, items: items}})))),
    itemTemplate: templates.item.then(render => render({options: {includeAuthor: true, new: true}, item: {}}))
  };

  const headStream = templates.head.then(render => render({config: config, streams: streams, nonce: nonce}));

  headStream.then(stream => stream.pipeTo(concatStream.writable));

  return Promise.resolve(new Response$1(concatStream.readable, {status: '200'}));
};

// Helpers.
// Todo. We will want to do a server side render...
const fetchCachedFeedData$1 = (config, itemTemplate) => {
  // Return a promise that resolves to a map of column id => cached data.
  const resolveCachedUrl = (cache, url) => (cache) ? cache.match(new Request$1(url)).then(response => (response) ? response.text() : undefined) : Promise.resolve();
  const templateOptions = {
    includeAuthor: true
  };

  return caches$1.open('data')
      .then(cache => config.then(c => resolveCachedUrl(cache, `${c.origin}/proxy?url=${encodeURIComponent(c.feedUrl)}`)))
      .then(feed => { const items = convertFeedItemsToJSON(feed); return items; } )
      .then(items => itemTemplate.then(render => render({options: templateOptions, items: items})));
};

const handler$2 = all;

const manifest = (paths, templates) => {
  const config = loadData$1(`${paths.dataPath}config.json`).then(r => r.json());
  const concatStream = new ConcatStream;
  const manifestStream = templates.manifest.then(render => render({config: config}));

  manifestStream.then(stream => stream.pipeTo(concatStream.writable));

  return Promise.resolve(new Response$1(concatStream.readable, {status: '200'}));
};

const handler$3 = manifest;

/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const preload = '</scripts/client.js>; rel=preload; as=script';
const generator = generateIncrementalNonce('server');
const RSSCombiner = require('rss-combiner-ns');
const path = require('path');

// A global server feedcache so we are not overloading remote servers
class FeedFetcher {
  constructor(fetchInterval, configPath) {
    this.feedConfigs = this.loadConfigs(configPath);
    this.knownHosts = new Set();
    this.latestFeeds = {};

    this.fetchFeeds();
    setInterval(this.fetchFeeds, fetchInterval);
  }

  get hosts() {
    return this.knownHosts;
  }

  get configs() {
    return this.feedConfigs;
  }

  get feeds() {
    return this.latestFeeds;
  }

  loadConfigs(basePath) {
    // Dynamically import the config objects
    const configs = fs$1.readdirSync(basePath)
        .filter(fileName => fileName.endsWith('.json') && fileName.startsWith('.') == false)
        .map(fileName => [fileName.replace(/\.config\.json$/, ''), require(path.join(basePath, fileName))]);

    return new Map(configs);
  }

  fetchFeeds() {
    const feeds = this.feedConfigs;
    const feedList = Array.from(feeds.values());
    feedList.filter(config => 'redirect' in config === false).forEach(config => {
      const hostname = new url.URL(config.origin).hostname;
      console.log(`${hostname} Checking Feeds`, Date.now());
      this.knownHosts.add(hostname);

      const feedConfig = {
        title: config.title,
        size: 100,
        feeds: config.columns.map(column => column.feedUrl),
        generator: config.origin,
        site_url: config.origin,
        softFail: true,
        custom_namespaces: {
          'content': 'http://purl.org/rss/1.0/modules/content/',
          'dc': 'http://purl.org/dc/elements/1.1/',
          'a10': 'http://www.w3.org/2005/Atom',
          'feedburner': 'http://rssnamespace.org/feedburner/ext/1.0'
        },
        pubDate: new Date(),
        successfulFetchCallback: (streamInfo) => {
          console.log(`Fetched feed: ${streamInfo.url}`);
          if ((streamInfo.url in cacheStorage$1) == false) {
            cacheStorage$1[streamInfo.url] = streamInfo.stream;
          }
        }
      };

      feedConfig.pubDate = new Date();

      RSSCombiner(feedConfig)
          .then(combinedFeed => {
            console.log(`${hostname} Feed Ready`, Date.now());
            const feedXml = combinedFeed.xml();
            
            cacheStorage$1[config.feedUrl] = feedXml;
            this.latestFeeds[hostname] = feedXml;
          });
    });
  }
}


class Server {
  constructor(configPath, feedFetcher) {
    this.configPath = configPath;
    this.feeds = feedFetcher;
    this.assetPathBase = configPath.assetPathBase;
    this.overridePathBase = configPath.overridePathBase || this.assetPathBase;
    this.assetPath = `${configPath.assetPathBase}/${paths$1.assetPath}`;
    this.dataPath = `${configPath.dataPath}/`;
  }

  _resolveAssets(filePath, {defaultBase, overridePathBase}) {
    const overridePath = path.join(overridePathBase, paths$1.assetPath, filePath);
    const defaultPath = path.join(defaultBase, paths$1.assetPath, filePath);
    return fs$1.existsSync(overridePath) ? overridePath : defaultPath;
  }

  getHostName(req) {
    let hostname = req.hostname;
    if (this.feeds.hosts.has(hostname) == false) {
      hostname = '127.0.0.1';
    }

    return hostname.replace(/\//g, '');
  }

  start(port) {
    const assetPaths = {overridePathBase: this.overridePathBase, defaultBase: this.assetPathBase};
    const templates = {
      head: getCompiledTemplate(this._resolveAssets('templates/head.html', assetPaths)),
      allStyle: getCompiledTemplate(this._resolveAssets('templates/all-styles.html', assetPaths)),
      columnsStyle: getCompiledTemplate(this._resolveAssets('templates/columns-styles.html', assetPaths)),
      column: getCompiledTemplate(this._resolveAssets('templates/column.html', assetPaths)),
      columns: getCompiledTemplate(this._resolveAssets('templates/columns.html', assetPaths)),
      item: getCompiledTemplate(this._resolveAssets('templates/item.html', assetPaths)),
      manifest: getCompiledTemplate(`${this.assetPath}templates/manifest.json`)
    };

    const app = express();
    app.use(compression({
      filter: (req, res) => true
    }));

    app.set('trust proxy', true);

    app.all('*', (req, res, next) => {
      // protocol check, if http, redirect to https
      const forwarded = req.get('X-Forwarded-Proto');
      const hostname = req.hostname;
      const feed = this.feeds.configs.get(hostname);

      if (feed && 'redirect' in feed) {
        res.redirect(feed.redirect);
        return;
      }

      if (forwarded && forwarded.indexOf('https') == 0 || hostname === '127.0.0.1') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return next();
      } else {
        res.redirect('https://' + hostname + req.url);
        return;
      }
    });

    app.get('/', (req, res, next) => {
      const hostname = this.getHostName(req);

      const nonce = {
        analytics: generator(),
        inlinedcss: generator(),
        style: generator()
      };

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Security-Policy', generateCSPPolicy(nonce));
      res.setHeader('Link', preload);
      handler(nonce, {
        dataPath: `${this.dataPath}${hostname}.`,
        assetPath: paths$1.assetPath
      }, templates).then(response => {
        if (!!response == false) {
          console.error(req, hostname);
          return res.status(500).send(`Response undefined Error ${hostname}`);
        }
        responseToExpressStream(res, response.body);
      });
    });

    app.get('/all', (req, res, next) => {
      const hostname = this.getHostName(req);

      const nonce = {
        analytics: generator(),
        inlinedcss: generator(),
        style: generator()
      };

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Security-Policy', generateCSPPolicy(nonce));
      res.setHeader('Link', preload);

      handler$2(nonce, {
        dataPath: `${this.dataPath}${hostname}.`,
        assetPath: __dirname + paths$1.assetPath
      }, templates).then(response => {
        if (!!response == false) {
          console.error(req, hostname);
          return res.status(500).send(`Response undefined Error ${hostname}`);
        }
        responseToExpressStream(res, response.body);
      });
    });

    app.get('/manifest.json', (req, res, next) => {
      const hostname = this.getHostName(req);
      res.setHeader('Content-Type', 'application/manifest+json');

      handler$3({
        dataPath: `${this.dataPath}${hostname}.`,
        assetPath: paths$1.assetPath
      }, templates).then(response => {
        responseToExpressStream(res, response.body);
      });
    });

    app.get('/proxy', (req, res, next) => {
      const hostname = this.getHostName(req);
      const url$1 = new url.URL(`${req.protocol}://${hostname}${req.originalUrl}`);

      handler$1(url$1, {
        dataPath: `${this.dataPath}${hostname}.`,
        assetPath: paths$1.assetPath
      }, templates).then(response => {
        if (!!response == false) {
          return res.status(500).send(`Response undefined Error ${hostname}`);
        }

        if (typeof(response.body) === 'string') {
          res.status(response.status).send(response.body);
        } else {
          sendStream(response.body, true, res);
        }
      });
    });

    /*
      Server specific routes
    */

    app.get('/all.rss', (req, res, next) => {
      const hostname = this.getHostName(req);
      res.setHeader('Content-Type', 'text/xml');
      res.send(this.feeds.feeds[hostname]);
    });

    app.get('/all.json', (req, res, next) => {
      const hostname = this.getHostName(req);
      const feed = this.feeds.feeds[hostname];
      res.setHeader('Content-Type', 'application/json');

      feed2json.fromString(feed, hostname + 'all.rss', {}, function(err, json) {
        res.send(json);
      });
    });

    app.get('/data/config.json', (req, res, next) => {
      const hostname = this.getHostName(req);
      res.setHeader('Content-Type', 'application/json');
      res.sendFile(`${this.dataPath}/${hostname}.config.json`);
    });

    /*
      Start the app.
    */
    if (fs$1.existsSync(`${this.overridePathBase}/public`)) {
      app.use(express.static(`${this.overridePathBase}/public`));
    }
    app.use(express.static(`${this.assetPathBase}/public`));
    app.listen(port);
  }
}

if (typeof process === 'object') {
  process.on('unhandledRejection', (error, promise) => {
    console.error('== Node detected an unhandled rejection! ==');
    console.error(error.stack);
  });
}

module.exports = {
  Server: Server,
  FeedFetcher: FeedFetcher
};
