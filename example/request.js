const sshAgent = require("../");
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
