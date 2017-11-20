const http = require("http");

http.get(
  {
    agent: require("../").http([
      {
        host: "outer.host.com",
        username: "root",
        password: "supersecret"
      },
      {
        host: "inner.host.com",
        username: "root",
        password: "supersecret"
      }
    ]),
    host: "echo.jpillora.com",
    path: "/foo/bar"
  },
  res => {
    res.pipe(process.stdout);
  }
);
