const sshAgent = require("../");
const http = require("http");

http.get(
  {
    host: "echo.jpillora.com",
    path: "/foo/bar",
    agent: sshAgent.http({
      host: "1.2.3.4",
      username: "root",
      password: "supersecret"
    })
  },
  res => {
    console.log(res.headers);
  }
);
