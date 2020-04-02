#!/usr/bin/env node
/*
 * ഓം ബ്രഹ്മാർപ്പണം
 * proxy.js
 * Created: Sat Mar 21 2020 02:04:37 GMT+0530 (GMT+05:30)
 * Copyright 2020 Harish Karumuthil<harish2704@gmail.com>
 */

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const util = require('util');
const fsPromise = fs.promises;
const { dirname } = require('path');
const forge = require('node-forge');
const pki = forge.pki;
const tls = require('tls');
const generateKeyPair = util.promisify(require('crypto').generateKeyPair);
const net = require('net');
const os = require('os');
const { Readable } = require('stream')


const log = console.log.bind(console);
const httpsPort = os.tmpdir() + `/proxy-kutti-${Date.now()}.sock`
const configHome = os.homedir() + '/.config/proxy-kutti';
const configFile = process.env.PROXY_KUTTI_CONFIG || configHome + '/config';
const config = {
  port: 8080,
  host: '127.0.0.1',
  cache_dir: os.homedir() + '/.cache/proxy-kutti',
  root_ca_key: configHome + '/rootCA.key',
  root_ca_cert: configHome + '/rootCA.pem',
  url_rewrites: '#https?://(.*)/7.7.1908/#http://mirrors.centos/7.7.1908/# #https?://(.*)epel/7/x86_64/#http://mirror.epel/7/x86_64/#',
};

try {
  Object.assign(config, require(configFile));
} catch (e) {}
Object.keys(config).forEach(function(k) {
  config[k] = process.env['PROXY_KUTTI_' + k] || config[k];
});

const urlMappings = config.url_rewrites.split(' ').map(function(pattern) {
  debugger;
  if (pattern[0] === pattern.slice(-1)) {
    const [search, replace] = pattern.slice(1, -1).split(pattern[0]);
    return { search: new RegExp(search), replace };
  }
  throw new Error(`Invalid url_rewrite "${pattern}"`);
});


function mapUrl(origUrl) {
  let out = origUrl;

  let i = 0,
    l = urlMappings.length,
    mapping;
  while (i < l) {
    urlMap = urlMappings[i];
    out = out.replace(urlMap.search, urlMap.replace);
    i++;
  }
  return out;
}

const runnninRequests = {};
function untillRequestFinished( cachedFile ){
  return new Promise(res => runnninRequests[ cachedFile ].on('close', res ));
}
function startNewRequest( cachedFile ){
  const stream = fs.createWriteStream( cachedFile );
  runnninRequests[cachedFile] = stream;
  stream.on('close', () => delete runnninRequests[cachedFile] );
  return stream;
}

async function getContent(httpModule, origReq, origRes) {
  const origUrl = url.parse(origReq.url);
  const mappedUrlStr = mapUrl(origReq.url);
  const mappedUrl = url.parse(mappedUrlStr);
  const mappedPort = mappedUrl.port ? ':' + mappedUrl.port : '';
  const method = origReq.method;
  const proto = httpModule === http ? 'http':'https';
  let cachedFile = `${config.cache_dir}/${proto}/${mappedUrl.host}${mappedPort}/${method}${mappedUrl.path}`;
  if( mappedUrl.path.slice(-1) === '/' ){
    cachedFile += '#index.data';
  } else {
    cachedFile += '.data';
  }
  const cachedFileMeta = `${cachedFile}.meta`;
  let proxyRes;
  let isHit = false;


  if( cachedFile in runnninRequests ){
    await untillRequestFinished( cachedFile );
  }
  if (false !== (await fsPromise.access(cachedFileMeta).catch(() => false))) {
    proxyRes = method === 'HEAD' ? Readable.from('') : fs.createReadStream(cachedFile);
    Object.assign( proxyRes, JSON.parse(await fsPromise.readFile(cachedFileMeta)) );
    isHit = true;
  } else {
    proxyRes = await new Promise(res => {
      const proxyReq = httpModule.request(
        {
          host: origUrl.host,
          port: origUrl.port,
          path: origUrl.path,
          method,
          headers: origReq.headers,
        },
        res
      );
      origReq.pipe( proxyReq );
    });
    await fsPromise.mkdir(dirname(cachedFile), { recursive: true });
    /**
     *  write metadata only if the request completed successfully
     *  Otherwise, partial & invalid cached content will be served next time
     */
    origRes.on('finish', () =>  fsPromise.writeFile(cachedFileMeta, JSON.stringify({ headers: proxyRes.headers, statusCode: proxyRes.statusCode } )) )
    proxyRes.pipe( startNewRequest(cachedFile));
  }

  console.log(`${new Date().toISOString()} ${isHit ? 'Hit!' : 'Miss'} ${method} ${origReq.url} => ${cachedFile}`);

  origRes.writeHead(proxyRes.statusCode, proxyRes.headers);
  proxyRes.pipe(origRes);
  /**
   *  Don't let download to continue if client closes the connection before it is finished
   */
  origRes.on('close', () => proxyRes.destroy() )

  return proxyRes;
}


function createFakeCertificateByDomain(caKey, caCert, domain) {
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;

  cert.serialNumber = new Date().getTime() + '';
  cert.validity.notBefore = new Date();
  cert.validity.notBefore.setFullYear(
    cert.validity.notBefore.getFullYear() - 1
  );
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);
  var attrs = [
    {
      name: 'commonName',
      value: domain,
    },
    {
      name: 'organizationName',
      value: 'Proxy-kutti',
    },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(caCert.subject.attributes);

  cert.setExtensions([
    {
      name: 'subjectAltName',
      altNames: [
        {
          type: 2,
          value: domain,
        },
      ],
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
    },
  ]);
  cert.sign(caKey, forge.md.sha256.create());

  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
}


function initHttpsMitmProxy() {
  const caCertPath = config.root_ca_cert;
  const caKeyPath = config.root_ca_key;
  const caCertPem = fs.readFileSync(caCertPath);
  const caKeyPem = fs.readFileSync(caKeyPath);
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const caKey = forge.pki.decryptRsaPrivateKey(caKeyPem, 'secret');
  const fakeCertObj = createFakeCertificateByDomain(caKey, caCert, 'localhost');

  debugger;
  const https_opts = {
    key: fakeCertObj.key,
    cert: fakeCertObj.cert,
    SNICallback: (hostname, done) => {
      let certObj = createFakeCertificateByDomain(caKey, caCert, hostname);
      done(
        null,
        tls.createSecureContext({
          key: certObj.key,
          cert: certObj.cert,
        })
      );
    },
  };


  const httpsProxy = https.createServer(https_opts, (req, res) => {
    req.url = `https://${req.headers.host}${req.url}`;
    getContent(https, req, res);
  });

  httpsProxy.listen( httpsPort, '127.0.0.1');
}


function main() {
  const httpProxy = http.createServer(getContent.bind(null, http));

  const isHttpMitmEnabled =
    fs.existsSync(config.root_ca_cert) && fs.existsSync(config.root_ca_key);
  let httpsMsg = '';
  if (isHttpMitmEnabled === false) {
    httpsMsg = `https requests are not cached since it is not configured.
  Make sure that the files
    ${config.root_ca_cert}
    ${config.root_ca_key}
  exists and accessible to the process.
  Refer documentation more details.\n`;
  } else {
    initHttpsMitmProxy();
  }

  const util = require('util');
  httpProxy.on('connect', function(req, res) {
    res.write(
      'HTTP/1.0 200 Connection established\r\nProxy-agent: proxy-kutti\r\n\r\n'
    );
    const [host, port] = isHttpMitmEnabled
      ? ['127.0.0.1',  httpsPort]
      : req.url.split(':');
    var httpsProxyConnection = net.createConnection(port, host);
    res.on('close', () => res.unpipe( httpsProxyConnection ));
    res.on('error', () => res.unpipe( httpsProxyConnection ));
    res.pipe(httpsProxyConnection);
    httpsProxyConnection.pipe(res);
  });

  httpProxy.listen(config.port, config.host, function() {
    log(`Proxy-kutti is running...

Using env variables
  PROXY_KUTTI_CONFIG=${configFile}

Current Configuration ( edit ${configFile}.(json|js)  or set env variable PROXY_KUTTI_<config-key>=<value> to change )
${JSON.stringify(config, null, 2).slice(2, -2)}

${httpsMsg}
Run the following command shell to start using this proxy
  export http_proxy=http://${config.host}:${config.port}
  ${isHttpMitmEnabled? 'export https_proxy=http://'+config.host+':'+config.port: ''}

  `);
  });
}

if (require.main === module) {
  main();
  process.on('uncaughtException', function (err) {
    log(err);
  })
}
