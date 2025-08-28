require('dotenv').config()

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || "supersecretkey",
  REQUIRE_AUTH: process.env.REQUIRE_AUTH === "true"
}
