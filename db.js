const fs = require("fs");
const path = require("path");
require("dotenv").config();

const DB_FILE = process.env.DB_PATH || "./redline.json";

function readData() {
  if (!fs.existsSync(DB_FILE)) return { users: [], nextId: 1 };
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeData(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const db = {
  findUserByEmail(email) {
    return readData().users.find((u) => u.email === email) || null;
  },
  findUserById(id) {
    return readData().users.find((u) => u.id === id) || null;
  },
  findUserByStripeCustomer(customerId) {
    return readData().users.find((u) => u.stripe_customer_id === customerId) || null;
  },
  createUser({ email, password_hash, stripe_customer_id }) {
    const data = readData();
    const user = {
      id: data.nextId++,
      email,
      password_hash,
      stripe_customer_id: stripe_customer_id || null,
      stripe_subscription_id: null,
      subscription_status: "none",
    };
    data.users.push(user);
    writeData(data);
    return user;
  },
  updateUserByCustomer(customerId, updates) {
    const data = readData();
    const user = data.users.find((u) => u.stripe_customer_id === customerId);
    if (user) Object.assign(user, updates);
    writeData(data);
    return user;
  },
};

module.exports = db;
