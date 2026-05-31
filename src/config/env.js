// Loads environment variables from .env exactly once.
// Required before any module that reads process.env at load time.
require('dotenv').config();

module.exports = {};
