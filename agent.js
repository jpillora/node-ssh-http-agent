const http = require("http");
const https = require("https");
const {Client} = require("ssh2");

class SSHConnectionManager {
  constructor(via) {
    this.via = via;
    this.cache = {};
    this.connecting = {};
    this.connCount = 0;
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
      client.on("close", () => {
        delete this.cache[key];
      });
      //connected!
      client.connCount = 0;
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
    let id = ++this.connCount;
    return new Promise((resolve, reject) => {
      client.forwardOut("127.0.0.1", 0, to.host, to.port, (err, stream) => {
        if (err) {
          return reject(err);
        }
        stream.allowHalfOpen = false;
        stream.setKeepAlive = () => {
          console.log("ssh-agent: TODO: keepalive");
        };
        stream.setNoDelay = () => {
          console.log("ssh-agent: TODO: set no delay");
        };
        stream.setTimeout = () => {
          console.log("ssh-agent: TODO: set timeout");
        };
        stream.ref = () => {
          console.log("ssh-agent: TODO: ref");
        };
        stream.unref = () => {
          console.log("ssh-agent: TODO: unref");
        };
        stream.destroySoon = stream.destroy;
        //handle stream closes, close client on last stream
        client.connCount++;
        stream.on("close", () => {
          client.connCount--;
          if (client.connCount === 0) {
            //triggers removal from cache
            client.end();
          }
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
