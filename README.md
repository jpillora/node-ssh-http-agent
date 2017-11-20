## `ssh-http-agent`

An HTTP Agent for tunneling through SSH

### Install

```
npm install --save ssh-http-agent
```

### Features

* Simple
* Single ssh client can make multiple requests

### Usage

Simple tunnel via `1.2.3.4`:

```js
const sshAgent = require("ssh-http-agent");
const http = require("http");

http.get(
  {
    agent: sshAgent.http({
      host: "1.2.3.4",
      port: 22,
      username: "root",
      password: "supersecret"
    }),
    host: "echo.jpillora.com",
    path: "/foo/bar"
  },
  res => {
    console.log(res.headers);
  }
);
```

Nested tunnels:

```js
const sshAgent = require("ssh-http-agent");
const http = require("http");

http.get(
  {
    agent: sshAgent.http([
      {
        host: "first.hop.com",
        username: "root",
        password: "supersecret"
      },
      {
        host: "second.hop.com",
        username: "root",
        password: "supersecret"
      }
    ]),
    host: "third.hop.com",
    path: "/foo/bar"
  },
  res => {
    console.log(res.headers);
  }
);
```

With `request`:

```js
const sshAgent = require("ssh-http-agent");
const request = require("request");

request.get(
  "http://echo.jpillora.com/foo/bar",
  {
    agent: sshAgent.http({
      host: "1.2.3.4",
      username: "root",
      password: "supersecret"
    })
  },
  (err, res, body) => {
    console.log(err || body);
  }
);
```

### API

Create an agent with:

* `sshAgent(httpAgent, sshConfig, debug)`
* `sshAgent.http(sshConfig, debug)`
* `sshAgent.https(sshConfig, debug)`

Where:

* `httpAgent` is an instance of [`http.Agent`](https://nodejs.org/api/http.html#http_class_http_agent) or [`https.Agent`](https://nodejs.org/api/https.html#https_class_https_agent)
* `sshConfig` is one or many `ssh2` client configuration objects(https://github.com/mscdex/ssh2#client-methods)
* `debug` is a `boolean` which enabled debug printing

### Notes

* Requires Node 8+

#### MIT License

Copyright © 2017 Jaime Pillora &lt;dev@jpillora.com&gt;

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.