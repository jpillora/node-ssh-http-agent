const net = require("net");
const http = require("http");
const https = require("https");
const {Client} = require("ssh2");

//implements "private" properties
const debug = Symbol();
const cachedClient = Symbol();

class SSHConnectionManager {
  constructor(vias, enableDebug) {
    this.vias = Array.isArray(vias) ? vias : [vias];
    this.vias.forEach(v => {
      if (!v.host) throw `"host" required`;
    });
    this.socks = {};
    this.channelCount = 0;
    if (enableDebug) {
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
    this.httpAgent = httpAgent;
    this.wrapTLS = httpAgent.protocol === "https:";
    this.origCreateConnection = this.httpAgent.createConnection.bind(httpAgent);
    this.httpAgent.createConnection = this.createConnection.bind(this);
  }

  createConnection(opts, callback) {
    this[debug]("create connection");
    this.createConnectionAsync(opts).then(
      sock => callback(null, sock),
      err => callback(err)
    );
  }

  async createConnectionAsync(httpOpts) {
    //create ssh pipeline to host/port
    let socket, client;
    for (let i = 0; i < this.vias.length; i++) {
      let via = this.vias[i];
      let {host, port = 22} = via;
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
    //final hop should always be forwared
    socket = await this.sshFoward(client, httpOpts.host, httpOpts.port);
    //optional tls handshake via https agent...
    if (this.wrapTLS) {
      socket = this.origCreateConnection(Object.assign({socket}, opts));
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
    }
    //connect and cache ssh connections
    client = sock[cachedClient];
    if (!client) {
      //create a promise to catch duplicate connection requests
      let done;
      sock[cachedClient] = new Promise(r => (done = r));
      //do connect!
      sock[debug]("connecting...");
      client = await new Promise((resolve, reject) => {
        var c = new Client();
        c.on("ready", () => resolve(c));
        c.on("error", err => reject(err));
        c.connect(Object.assign({sock}, opts));
      });
      client[debug] = sock[debug].inherit(`@${opts.username || "anon"}`);
      client[debug]("connected");
      let clientend = client.end;
      client.end = () => {
        delete sock[cachedClient]; //remove from cache asap
        clientend.call(client);
      };
      client.on("close", () => {
        delete sock[cachedClient];
        client[debug]("disconnected");
      });
      client.channelsOpen = 0;
      sock[cachedClient] = client;
      done();
    }
    return client;
  }

  //local tcp dial
  tcpConnect(host, port) {
    return new Promise((resolve, reject) => {
      let sock = net.createConnection(port, host);
      sock[debug] = this[debug].inherit(`[${host}:${port}]`);
      sock.once("connect", () => {
        resolve(sock);
      });
      sock.once("error", err => {
        reject(err);
      });
    });
  }

  //remote tcp dial
  sshFoward(client, host, port) {
    //channel debugging
    let id = ++this.channelCount;
    const sdebug = client[debug].inherit(`ch#${id}`);
    //count open channels, close on end last
    client.channelsOpen++;
    sdebug(`start (open ${client.channelsOpen})`);
    const done = function() {
      client.channelsOpen--;
      sdebug(`end (open ${client.channelsOpen})`);
      if (client.channelsOpen === 0) {
        client.end();
      }
    };
    //manual-async
    return new Promise((resolve, reject) => {
      sdebug("forward", host, port);
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
        //pass back to http
        stream[debug] = sdebug.inherit(`[${host}:${port}]`);
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
