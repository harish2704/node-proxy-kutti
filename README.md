# Proxy-kutti
Simple and transparent caching forward proxy server written in Nodejs.

## Features
* It has only one dependency ( `node-forge` )
    - it is used for creating self-signed certificates dynamically for MITM https proxy server.
* By default configuration, it will indefinitely cache all http requests irrespective of their cache headers.
* All cached data is transparently saved to a cache directory with simple file structure.
    - Contents are saved as it & headers are saved as a json file. It can be viewed/edited later
* If Root CA certificates are provided, then MITM HTTPS proxy server will get enabled and HTTPS Traffic also will get cached.
* We can specify URL rewrite rules to avoid caching of same data from different mirror sites.
    - This feature will help to work with default configuration of YUM/DNF utilities which will be using different mirrors in each time.


## Installation

`npm i proxy-kutti`

## Configuration

* proxy-kutti will listen on `127.0.0.1:8080` by default ( without any configuration )
* All the configuration variables can be permanently stored in configuration file
* We can even specify different configuration file using `PROXY_KUTTI_CONFIG` environment variable.
* All the values specified in configuration file can be overridden by setting corresponding `PROXY_KUTTI_<config key>` environment variable.
* Multiple `url_rewrites` rules can be specified by providing space separated list of rewrite rules.
* `url_rewrite` rule, follows format used by `s` subcommand of `sed` command.
    The first and last charecter of the rewrite rule should be same and the same charecter is used as separator.
* To install root CA in a CentOS-7 system, do the following
    - `root@host# cp <rootCA.*> /etc/pki/ca-trust/source/anchors/`
    - `root@host# update-ca-trust`


## Example Usage

`env PROXY_KUTTI_host=0.0.0.0 npx proxy-kutti`

**shell Output**
```
Proxy-kutti is running...

Using env variables
  PROXY_KUTTI_CONFIG=/home/user/.config/proxy-kutti/config.js

Current Configuration ( edit /home/user/.config/proxy-kutti/config.(json|js)  or set env variable PROXY_KUTTI_<config-key>=<value> to change )
  "port": 8080,
  "host": "0.0.0.0",
  "cache_dir": "/home/user/.cache/proxy-kutti",
  "root_ca_key": "/home/user/.config/proxy-kutti/rootCA.key",
  "root_ca_cert": "/home/user/.config/proxy-kutti/rootCA.pem",
  "url_rewrites": "#http://(.*)/7.7.1908/#http://mirrors.centos/7.7.1908/# #http[s]://(.*)epel/7/x86_64/#http://mirror.epel/7/x86_64/#"


Run the following command shell to start using this proxy
  export http_proxy=http://0.0.0.0:8080
  export https_proxy=http://0.0.0.0:8080

  
2020-03-22T20:21:33.624Z Miss GET https://example.com/making-request-for-first-time => /home/user/.cache/proxy-kutti/https/example.com/GET/making-request-for-first-time.data
2020-03-22T20:21:55.839Z Miss GET https://github.com/ => /home/user/.cache/proxy-kutti/https/github.com/GET/#index.data
2020-03-22T20:26:31.251Z Miss GET https://github.com/harish2704/node-proxy-kutti/archive/master.zip => /home/user/.cache/proxy-kutti/https/github.com/GET/harish2704/node-proxy-kutti/archive/master.zip.data
2020-03-22T20:27:23.087Z Miss GET https://example.com/again-making-those-requests => /home/user/.cache/proxy-kutti/https/example.com/GET/again-making-those-requests.data
2020-03-22T20:27:35.043Z Hit! GET https://github.com/ => /home/user/.cache/proxy-kutti/https/github.com/GET/#index.data
2020-03-22T20:27:38.237Z Hit! GET https://github.com/harish2704/node-proxy-kutti/archive/master.zip => /home/user/.cache/proxy-kutti/https/github.com/GET/harish2704/node-proxy-kutti/archive/master.zip.data

```

## Configuring MITM proxy for HTTPS traffic.

To cache HTTPS traffic , a root CA certificate has to provided to proxy server.
Then the same root CA has to be installed as a trusted CA on all the client systems.
Otherwise "invalid issuer" error will raise during any https request.

openssl command line can be used to generated Root CA certificate.
For details please use / refer the gist [ generate-certificate-openssl.sh ](https://gist.github.com/harish2704/6cc7185c2fe36ec9cb4e912c4e74f781)

Root CA certificates has to be placed in the location pointed by `root_ca_cert` & `root_ca_key` configuration values.


## Example structure of cache directory

```
.
└── https
    ├── example.com
    │   └── GET
    │       ├── again-making-those-requests.data
    │       ├── again-making-those-requests.data.meta
    │       ├── making-request-for-first-time.data
    │       └── making-request-for-first-time.data.meta
    └── github.com
        └── GET
            ├── harish2704
            │   └── node-proxy-kutti
            │       └── archive
            │           ├── master.zip.data
            │           └── master.zip.data.meta
            ├── #index.data
            └── #index.data.meta
```


