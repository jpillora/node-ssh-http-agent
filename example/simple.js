const http = require("http");

http.get(
  {
    agent: require("../").http({
      host: "1.2.3.4",
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
