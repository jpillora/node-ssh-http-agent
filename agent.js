const net = require("net");
const http = require("http");
const https = require("https");
const { Client } = require("ssh2");

//implements "private" properties
const debug = Symbol();
const cachedClient = Symbol();

class SSHConnectionManager {
  constructor(vias, opts) {
    this.vias = Array.isArray(vias) ? vias : [vias];
    this.vias.forEach(v => {
      if (!v || !v.host) throw `"host" required`;
    });
    this.socks = {};
    this.channelCount = 0;
    //init opts
    if (typeof opts === "boolean") {
      opts = { debug: opts };
    } else if (!opts) {
      opts = {};
    }
    //default opts
    if (opts.debug !== true) {
      opts.debug = false;
    }
    if (typeof opts.disconnectDelay !== "number") {
      opts.disconnectDelay = 0; //disconnect asap after last conn
    }
    let timeout = 5000;
    if (typeof opts.timeout === "number") {
      timeout = opts.timeout;
      delete opts.timeout;
      opts.readyTimeout = timeout; //also set ssh readytimeout
    }
    this.timeout = timeout;
    this.opts = opts;
    //prepare logger
    if (opts.debug) {
      this[debug] = function() {
        let prefix = "[ssh-agent]";
        console.log.apply(console, [prefix].concat(Array.from(arguments)));
      };
      const inherit = function(prefix) {
        let parent = this;
        let child = parent.bind(this, prefix);
        child.inherit = inherit.bind(child);
        return child;
      };
      this[debug].inherit = inherit.bind(this[debug]);
      this[debug]("debug enabled");
    } else {
      this[debug] = () => {}; //noop
      this[debug].inherit = () => this[debug]; //noop
    }
  }

  bind(httpAgent) {
    if (this.vias.length === 0) {
      this[debug]("no ssh configs provided");
      return;
    }
    this.httpAgent = httpAgent;
    this.wrapTLS = httpAgent.protocol === "https:";
    this.origCreateConnection = this.httpAgent.createConnection.bind(httpAgent);
    this.httpAgent.createConnection = this.createConnection.bind(this);
  }

  createConnection(httpOpts, callback) {
    this[debug]("create connection");
    this.createConnectionAsync(httpOpts)
      .then(sock => callback(null, sock))
      .catch(err => callback(err));
  }

  async createConnectionAsync(httpOpts) {
    //create ssh pipeline to host/port
    let socket, client;
    for (let i = 0; i < this.vias.length; i++) {
      let via = this.vias[i];
      let { host, port = 22 } = via;
      socket = await this.dedupSock(host, port, async () => {
        return i === 0
          ? //initialise sock with tcp
            await this.tcpConnect(host, port)
          : //otherwise, forward using current ssh client
            await this.sshFoward(client, host, port);
      });
      //handshake ssh over current sock
      client = await this.sshConnect(socket, via);
    }
    //final hop should always be forwarded
    socket = await this.sshFoward(client, httpOpts.host, httpOpts.port);
    //optional tls handshake via https agent...
    if (this.wrapTLS) {
      socket = this.origCreateConnection(Object.assign({ socket }, httpOpts));
    }
    return socket;
  }

  async dedupSock(host, port, create) {
    let key = `${host}:${port}`;
    let sock = this.socks[key];
    //connect in progress...
    if (sock instanceof Promise) {
      this[debug](`tcp connect already in progress`);
      await sock;
      sock = this.socks[key];
    }
    //no connected yet
    if (!sock) {
      let done;
      this.socks[key] = new Promise(r => (done = r));
      sock = await create();
      sock[debug]("connected");
      let sockend = sock.end;
      sock.end = () => {
        delete this.socks[key]; //remove from cache asap
        sockend.call(sock);
      };
      sock.on("close", () => {
        delete this.socks[key];
        sock[debug]("disconnected");
      });
      //connected
      this.socks[key] = sock;
      done();
    }
    return sock;
  }

  async sshConnect(sock, opts) {
    sock[debug](`ssh connect`);
    // currently connecting?
    let client = sock[cachedClient];
    if (client instanceof Promise) {
      sock[debug](`ssh connect already in progress`);
      await client;
      client = sock[cachedClient];
    }
    //connect and cache ssh connections
    if (!client) {
      //create a promise to catch duplicate connection requests
      let done;
      sock[cachedClient] = new Promise(r => (done = r));
      //do connect!
      sock[debug]("ssh handshaking...");
      client = await new Promise((resolve, reject) => {
        var c = new Client();
        c.on("ready", () => resolve(c));
        c.on("error", err => reject(err));
        c.connect(Object.assign({ sock }, opts));
      });
      client[debug] = sock[debug].inherit(`@${opts.username || "anon"}`);
      client[debug]("ssh handshook, connected");
      let clientend = client.end;
      client.end = () => {
        delete sock[cachedClient]; //remove from cache asap
        clientend.call(client);
      };
      client.on("close", () => {
        delete sock[cachedClient];
        client[debug]("ssh disconnected");
      });
      client.channelsOpen = 0;
      sock[cachedClient] = client;
      done();
    }
    return client;
  }

  //local tcp dial (manual-async)
  tcpConnect(host, port) {
    return new Promise((resolve, reject) => {
      let sock = net.createConnection(port, host);
      sock[debug] = this[debug].inherit(`[${host}:${port}]`);
      const fail = err => {
        if (fail.ed) return;
        sock[debug](err);
        fail.ed = true;
        reject(err);
      };
      sock.setTimeout(this.timeout, () => {
        fail(new Error("TCP Timed out"));
      });
      sock.once("error", err => {
        fail(err);
      });
      sock.once("close", () => {
        fail("closed");
      });
      sock.once("connect", () => {
        sock[debug]("connected");
        resolve(sock);
      });
    });
  }

  //remote tcp dial (manual-async)
  sshFoward(client, host, port) {
    return new Promise((resolve, reject) => {
      //channel debugging
      let id = ++this.channelCount;
      const sdebug = client[debug].inherit(`ch#${id}[${host}:${port}]`);
      //count open channels, close on end last
      client.channelsOpen++;
      sdebug(`forward (open ${client.channelsOpen})`);
      const done = () => {
        client.channelsOpen--;
        sdebug(`unforward (open ${client.channelsOpen})`);
        if (client.channelsOpen === 0) {
          setTimeout(autoDisconnect, this.opts.disconnectDelay);
        }
      };
      const autoDisconnect = () => {
        if (client.channelsOpen === 0) {
          sdebug(`close ssh, no more forwards open`);
          client.end();
        }
      };
      client.forwardOut("127.0.0.1", 0, host, port, (err, stream) => {
        if (err) {
          done();
          return reject(err);
        }
        stream.allowHalfOpen = false;
        stream.setKeepAlive = () => {
          sdebug("TODO: keepalive");
        };
        stream.setNoDelay = () => {
          sdebug("TODO: set no delay");
        };
        stream.setTimeout = () => {
          sdebug("TODO: set timeout");
        };
        stream.ref = () => {
          sdebug("TODO: ref");
        };
        stream.unref = () => {
          sdebug("TODO: unref");
        };
        stream.destroySoon = () => {
          sdebug("destroy soon");
          stream.end();
        };
        stream.destroy = () => {
          sdebug("destroy");
          stream.end();
        };
        stream.on("readable", () => {
          sdebug("readable");
        });
        stream.on("pipe", () => {
          sdebug("pipe");
        });
        stream.on("unpipe", () => {
          sdebug("unpipe");
        });
        stream.on("finish", () => {
          sdebug("finish");
        });
        //handle stream closes, close client on last stream
        sdebug("open");
        stream.on("close", () => {
          sdebug("close");
          done();
        });
        //stream ready
        stream[debug] = sdebug;
        resolve(stream);
      });
    });
  }
}

function sshAgent(agent, via, debug) {
  let s = new SSHConnectionManager(via, debug);
  s.bind(agent);
  return agent;
}

sshAgent.http = function(via, debug) {
  return sshAgent(new http.Agent(), via, debug);
};

sshAgent.https = function(via) {
  return sshAgent(new https.Agent(), via, debug);
};

module.exports = sshAgent;
