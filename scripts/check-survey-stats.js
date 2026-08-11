const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', 'smartmeter.db'));

function all(sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function main() {
  const total = await all(`SELECT COUNT(*) AS c FROM meter`);
  console.log('1. Нийт тоолуур:', total[0].c);

  const remoteReady = await all(`
    SELECT COUNT(*) AS c FROM meter m
    JOIN meter_types mt ON mt.id = m.meter_type_id
    WHERE mt.data_transmission IS NOT NULL AND TRIM(mt.data_transmission) != ''
  `);
  console.log('2. Алсын уншилтад бэлэн (dataTransmission set):', remoteReady[0].c);

  const smartControllable = await all(`
    SELECT COUNT(*) AS c FROM meter m
    JOIN meter_types mt ON mt.id = m.meter_type_id
    WHERE (mt.meter_type LIKE '%Ухаалаг%' OR mt.meter_type LIKE '%Smart%')
      AND mt.data_transmission IS NOT NULL AND TRIM(mt.data_transmission) != ''
  `);
  console.log('3. Алсын удирдлагатай (smart + dataTransmission):', smartControllable[0].c);

  const realInfra = await all(`
    SELECT COUNT(*) AS c FROM meter m
    JOIN meter_dcu md ON md.meter_id = m.id AND md.connected_to IS NULL
    JOIN asset a ON a.id = md.dcu_id
    WHERE a.code != 'Тодорхойгүй DCU'
  `);
  console.log('4. HES-д холбох боломжтой (real named DCU/network node):', realInfra[0].c);

  const realInfraConnected = await all(`
    SELECT COUNT(*) AS c FROM meter m
    JOIN meter_dcu md ON md.meter_id = m.id AND md.connected_to IS NULL
    JOIN asset a ON a.id = md.dcu_id
    WHERE a.code != 'Тодорхойгүй DCU' AND m.status = 'connected'
  `);
  console.log('5. HES-д холбогдсон (real DCU + status=connected):', realInfraConnected[0].c);

  const needsEquipment = await all(`
    SELECT COUNT(*) AS c FROM meter m
    JOIN meter_dcu md ON md.meter_id = m.id AND md.connected_to IS NULL
    JOIN asset a ON a.id = md.dcu_id
    WHERE a.code = 'Тодорхойгүй DCU'
  `);
  console.log('6. Нэмэлт төхөөрөмж шаардлагатай (placeholder/unknown DCU):', needsEquipment[0].c);
}

main().then(() => db.close()).catch((err) => { console.error(err); db.close(); });
