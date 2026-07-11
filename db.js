const Database = require("better-sqlite3");
require("dotenv").config();

const db = new Database(process.env.DB_PATH || "./redline.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    subscription_status TEXT DEFAULT 'none',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

module.exports = db;
