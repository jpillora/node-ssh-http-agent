const sshAgent = require("../");

//reuse agent across multiple requests
let agent = sshAgent.http({
  host: "1.2.3.4",
  username: "root",
  privateKey: require("fs").readFileSync("/root/.ssh/id_rsa")
  // passphrase: "<optional passphrase for privateKey>"
});

//============================

function readAll(res) {
  return new Promise((resolve, reject) => {
    let buff = new Buffer([]);
    res.on("data", b => {
      buff = Buffer.concat([buff, b]);
    });
    res.on("error", err => reject(err));
    res.on("end", () => resolve(buff.toString()));
  });
}

//============================

const http = require("http");

let req1 = http.get(
  {
    host: "echo.jpillora.com",
    path: "/req1/foo/bar",
    agent: agent
  },
  async res => {
    console.log(await readAll(res));
  }
);
req1.on("error", err => console.log(err));
req1.end();

let req2 = http.get(
  {
    host: "echo.jpillora.com",
    path: "/req2/ping/pong",
    agent: agent
  },
  async res => {
    console.log(await readAll(res));
  }
);
req2.on("error", err => console.log(err));
req2.end();
