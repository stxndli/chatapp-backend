const jwt = require("jsonwebtoken");
require("dotenv").config()
const verifyToken = (req, res, next) => {
  const token = req.cookies.token || req.body.token || req.query.token || req.headers["x-access-token"]
  if (!token) {
    return res.status(403).json({ message: "An access token is required" })
  }
  try {
    const decoded = jwt.verify(token, process.env.TOKEN_KEY)
    req.user = decoded
  } catch (err) {
    return res.status(401).json({ message: "Invalid session" })
  }
  return next()
};

module.exports = verifyToken
