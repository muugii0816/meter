const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, '..', 'smartmeter.db'));

db.all(
  `SELECT a.code, a.metadata, at.code as type_code, COUNT(md.meter_id) as meterCount
   FROM asset a
   JOIN meter_dcu md ON md.dcu_id = a.id AND md.connected_to IS NULL
   LEFT JOIN asset_type at ON at.id = a.asset_type_id
   GROUP BY a.id ORDER BY meterCount DESC LIMIT 20`,
  (err, rows) => {
    if (err) throw err;
    rows.forEach((r) => console.log(r.meterCount, '\t', r.type_code, '\t', r.code, '\t', r.metadata));

    db.all(`SELECT COUNT(DISTINCT dcu_id) as c FROM meter_dcu WHERE connected_to IS NULL`, (e2, r2) => {
      console.log('\nDistinct DCU assets in use:', r2[0].c);
      db.close();
    });
  }
);
