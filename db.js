const fs = require("fs");
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
  createUser({ email, password_hash }) {
    const data = readData();
    const user = {
      id: data.nextId++,
      email,
      password_hash,
      paystack_customer_code: null,
      paystack_subscription_code: null,
      subscription_status: "none",
      free_reviews_used: 0,
    };
    data.users.push(user);
    writeData(data);
    return user;
  },
  updateUserById(id, updates) {
    const data = readData();
    const user = data.users.find((u) => u.id === id);
    if (user) Object.assign(user, updates);
    writeData(data);
    return user;
  },
};

module.exports = db;
