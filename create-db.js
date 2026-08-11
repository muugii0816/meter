const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'smartmeter.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open SQLite database:', err.message);
    process.exit(1);
  }

  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      )`,
      (createErr) => {
        if (createErr) {
          console.error('Failed to create users table:', createErr.message);
          process.exit(1);
        }

        const users = [
          ['admin', '99996060'],
          ['user1', 'password1'],
          ['user2', 'password2'],
        ];

        const insert = db.prepare('INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)');
        users.forEach(([username, password]) => {
          insert.run(username, password, (err) => {
            if (err) {
              console.error(`Failed to insert user ${username}:`, err.message);
            }
          });
        });
        insert.finalize((finalizeErr) => {
          if (finalizeErr) {
            console.error('Failed to finalize user insert:', finalizeErr.message);
            process.exit(1);
          }
          console.log('SQLite users database created and seeded at', dbPath);
          db.close();
        });
      }
    );
  });
});
