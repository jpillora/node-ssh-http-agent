const http = require("http");
const https = require("https");
const {Client} = require("ssh2");

class SSHConnectionManager {
  constructor(via) {
    this.via = via;
    this.cache = {};
    this.connecting = {};
    this.channelCount = 0;
    this.debug = false;
  }

  bind(httpAgent) {
    this.httpAgent = httpAgent;
    this.wrapTLS = httpAgent.protocol === "https:";
    this.origCreateConnection = this.httpAgent.createConnection.bind(httpAgent);
    this.httpAgent.createConnection = this.createConnection.bind(this);
  }

  createConnection(opts, callback) {
    //use httpOptions.via
    let via = opts.via || {};
    //fallback to sshAgent options
    for (let k in this.via) {
      if (!via[k]) {
        via[k] = this.via[k];
      }
    }
    //fallback to normal agent
    if (!via.host) {
      return this.origCreateConnection(opts, callback);
    }
    //create ssh socket
    let {host, port} = opts;
    this.createSSHChannel(via, {host, port}).then(
      socket => {
        if (this.wrapTLS) {
          //do tls handshake...
          socket = this.origCreateConnection(
            Object.assign({socket: socket}, opts)
          );
        }
        //ready to speak http
        callback(null, socket);
      },
      err => callback(err)
    );
  }

  async createSSHChannel(via, to) {
    let key = `${via.username || "anon"}@${via.host}:${via.port || 22}`;
    //connect and cache ssh connections
    let client = this.cache[key];
    // currently connecting?
    if (this.connecting[key]) {
      await this.connecting[key];
      client = this.cache[key];
    }
    // not connecting and no client
    if (!client) {
      //create a promise to catch duplicate connection requests
      let connected;
      this.connecting[key] = new Promise(r => (connected = r));
      //do ssh handshake
      client = await this.sshConnect(via);
      //remove from cache asap
      let clientend = client.end;
      client.end = () => {
        delete this.cache[key];
        clientend.call(client);
      };
      client.on("close", () => {
        delete this.cache[key];
      });
      //connected!
      client.channelsOpen = 0;
      delete this.connecting[key];
      this.cache[key] = client;
      connected();
    }
    //forward!
    let stream = await this.sshFoward(client, to);
    return stream;
  }

  sshConnect(via) {
    return new Promise((resolve, reject) => {
      var c = new Client();
      c.on("ready", () => resolve(c));
      c.on("error", err => reject(err));
      c.connect(via);
    });
  }

  sshFoward(client, to) {
    //channel debugging
    let id = ++this.channelCount;
    const debug = () => {
      if (this.debug) {
        let prefix = "[ssh-agent] ch#" + id + ":";
        console.log.apply(console, [prefix].concat(Array.from(arguments)));
      }
    };
    //count open channels
    client.channelsOpen++;
    const done = function() {
      client.channelsOpen--;
      debug("done (open " + client.channelsOpen + ")");
      if (client.channelsOpen === 0) {
        client.end();
      }
    };
    return new Promise((resolve, reject) => {
      debug("forward", to);
      client.forwardOut("127.0.0.1", 0, to.host, to.port, (err, stream) => {
        if (err) {
          done();
          return reject(err);
        }
        const w = stream.write;
        stream.write = function(buff, callback) {
          debug("write", buff.length);
          w.call(stream, buff, function() {
            debug("wrote");
            callback();
          });
        };
        const r = stream.read;
        stream.read = function(n) {
          debug("read", n || "");
          return r.call(stream, n);
        };
        stream.allowHalfOpen = false;
        stream.setKeepAlive = () => {
          debug("TODO: keepalive");
        };
        stream.setNoDelay = () => {
          debug("TODO: set no delay");
        };
        stream.setTimeout = () => {
          debug("TODO: set timeout");
        };
        stream.ref = () => {
          debug("TODO: ref");
        };
        stream.unref = () => {
          debug("TODO: unref");
        };
        stream.destroySoon = () => {
          debug("destroy soon");
          stream.end();
        };
        stream.destroy = () => {
          debug("destroy");
          stream.end();
        };
        const e = stream.end;
        stream.end = function() {
          debug("end");
          e.call(stream);
        };
        stream.on("readable", () => {
          debug("readable");
        });
        stream.on("pipe", () => {
          debug("pipe");
        });
        stream.on("unpipe", () => {
          debug("unpipe");
        });
        stream.on("finish", () => {
          debug("finish");
        });
        //handle stream closes, close client on last stream
        debug("open");
        stream.on("close", () => {
          debug("close");
          done();
        });
        //pass back to http
        resolve(stream);
      });
    });
  }
}

function sshAgent(agent, via) {
  let s = new SSHConnectionManager(via);
  s.bind(agent);
  return agent;
}

sshAgent.http = function(via) {
  return sshAgent(new http.Agent(), via);
};

sshAgent.https = function(via) {
  return sshAgent(new https.Agent(), via);
};

module.exports = sshAgent;
