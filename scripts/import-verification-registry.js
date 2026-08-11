// Parses data/verification-registry-raw.txt (a certification/verification
// registry export: Код Төрөл Марк Дугаар Ампер Хүчдэл "Стандарт хэмжилзүйн
// төв" Баталгаажуулсан Баталгаажуулалт-дуусах Шалтгаан), dedupes by meter
// number (Дугаар) -- both within the file and against meters already in
// the DB -- and inserts the net-new meters into the normalized schema.
//
// Usage:
//   node scripts/import-verification-registry.js            (dry run, no writes)
//   node scripts/import-verification-registry.js --commit    (actually inserts)
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const RAW_PATH = path.join(__dirname, '..', 'data', 'verification-registry-raw.txt');
const DB_PATH = path.join(__dirname, '..', 'smartmeter.db');
const ANCHOR = 'Стандарт хэмжилзүйн төв';
const TYPES = ['Электрон-Механик', 'Электрон', 'Ухаалаг', 'Механик'];

const LEFT_RE = new RegExp(
  '^(\\S+)\\s+(' + TYPES.join('|') + ')\\s+(.+?)\\s+(\\S+)\\s+(\\d+(?:-\\d+)?)\\s*[AА]\\s+(\\d+)$'
);
const RIGHT_RE = /^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/;

function parseLine(line, lineNo) {
  const idx = line.indexOf(ANCHOR);
  if (idx === -1) return { error: `no "${ANCHOR}" anchor`, lineNo, line };

  const left = line.slice(0, idx).trim();
  const right = line.slice(idx + ANCHOR.length).trim();

  const leftMatch = left.match(LEFT_RE);
  if (!leftMatch) return { error: 'left part did not parse', lineNo, line };

  const rightMatch = right.match(RIGHT_RE);
  if (!rightMatch) return { error: 'right part did not parse', lineNo, line };

  const [, rawCode, type, brand, meterNumber, amperage, voltage] = leftMatch;
  const [, verifiedFrom, verifiedTo, reason] = rightMatch;

  return {
    customerCode: rawCode === '—' ? null : rawCode,
    type,
    brand: brand.trim(),
    meterNumber: meterNumber.trim(),
    amperage,
    voltage,
    verifiedFrom,
    verifiedTo,
    reason: reason.trim(),
  };
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function cb(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function main() {
  const commit = process.argv.includes('--commit');

  const rawText = fs.readFileSync(RAW_PATH, 'utf8');
  const rawLines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  const parsed = [];
  const failures = [];
  rawLines.forEach((line, i) => {
    const result = parseLine(line, i + 1);
    if (result.error) failures.push(result);
    else parsed.push(result);
  });

  console.log(`Parsed ${parsed.length} / ${rawLines.length} lines (${failures.length} failed to parse).`);
  if (failures.length > 0) {
    console.log('First parse failures:');
    failures.slice(0, 10).forEach((f) => console.log(`  line ${f.lineNo}: ${f.error} -- "${f.line}"`));
  }

  const db = new sqlite3.Database(DB_PATH);

  const existingRows = await dbAll(db, 'SELECT DISTINCT meter_id FROM meter');
  const existingMeterIds = new Set(existingRows.map((r) => r.meter_id));
  console.log(`Existing distinct meter_id values already in DB: ${existingMeterIds.size}`);

  const seenInFile = new Set();
  const netNew = [];
  let internalDupes = 0;
  let alreadyInDb = 0;

  for (const rec of parsed) {
    if (seenInFile.has(rec.meterNumber)) {
      internalDupes += 1;
      continue;
    }
    seenInFile.add(rec.meterNumber);
    if (existingMeterIds.has(rec.meterNumber)) {
      alreadyInDb += 1;
      continue;
    }
    netNew.push(rec);
  }

  console.log(`Internal duplicates (same Дугаар seen twice in the file): ${internalDupes}`);
  console.log(`Already present in DB (matched existing meter_id): ${alreadyInDb}`);
  console.log(`Net-new meters to insert: ${netNew.length}`);
  console.log('Sample of net-new records:');
  netNew.slice(0, 5).forEach((r) => console.log('  ', JSON.stringify(r)));

  if (!commit) {
    console.log('\nDry run only -- rerun with --commit to actually insert.');
    db.close();
    return;
  }

  // Additive, safe: meter has no amperage/voltage columns yet.
  const columns = await dbAll(db, 'PRAGMA table_info(meter)');
  if (!columns.some((c) => c.name === 'amperage')) {
    await dbRun(db, 'ALTER TABLE meter ADD COLUMN amperage TEXT');
  }
  if (!columns.some((c) => c.name === 'voltage')) {
    await dbRun(db, 'ALTER TABLE meter ADD COLUMN voltage TEXT');
  }

  const meterTypeCatalog = await dbAll(db, 'SELECT id, brand FROM meter_types');
  const meterTypeIdByBrand = new Map();
  meterTypeCatalog.forEach((mt) => {
    if (mt.brand) meterTypeIdByBrand.set(mt.brand.trim().toLowerCase(), mt.id);
  });

  const orgRow =
    (await dbGet(db, "SELECT id FROM organization WHERE name = 'М СИ ЭС ИНТЕРНЭЙШНЛ'")) ||
    (await dbGet(db, 'SELECT id FROM organization ORDER BY id LIMIT 1'));
  const orgId = orgRow.id;

  const FALLBACK_SUBSTATION = 'Тодорхойгүй дэд станц';
  const FALLBACK_DCU = 'Тодорхойгүй DCU';

  let assetTypeRows = await dbAll(db, 'SELECT id, code FROM asset_type');
  const assetTypeId = {};
  assetTypeRows.forEach((r) => (assetTypeId[r.code] = r.id));

  let subAsset = await dbGet(
    db,
    'SELECT id FROM asset WHERE asset_type_id = ? AND code = ? AND parent_asset_id IS NULL',
    [assetTypeId.SUBSTATION, FALLBACK_SUBSTATION]
  );
  let subAssetId;
  if (subAsset) {
    subAssetId = subAsset.id;
  } else {
    const inserted = await dbRun(
      db,
      'INSERT INTO asset (organization_id, asset_type_id, parent_asset_id, code, name, status) VALUES (?, ?, NULL, ?, ?, ?)',
      [orgId, assetTypeId.SUBSTATION, FALLBACK_SUBSTATION, FALLBACK_SUBSTATION, 'active']
    );
    subAssetId = inserted.lastID;
  }

  let dcuAsset = await dbGet(
    db,
    'SELECT id FROM asset WHERE asset_type_id = ? AND code = ? AND parent_asset_id = ?',
    [assetTypeId.DCU, FALLBACK_DCU, subAssetId]
  );
  let dcuAssetId;
  if (dcuAsset) {
    dcuAssetId = dcuAsset.id;
  } else {
    const inserted = await dbRun(
      db,
      'INSERT INTO asset (organization_id, asset_type_id, parent_asset_id, code, name, status) VALUES (?, ?, ?, ?, ?, ?)',
      [orgId, assetTypeId.DCU, subAssetId, FALLBACK_DCU, FALLBACK_DCU, 'active']
    );
    dcuAssetId = inserted.lastID;
    await dbRun(db, 'INSERT INTO dcu (asset_id, communication_tech) VALUES (?, ?)', [dcuAssetId, null]);
  }

  let cp = await dbGet(
    db,
    'SELECT id FROM asset WHERE asset_type_id = ? AND parent_asset_id = ?',
    [assetTypeId.CONNECTION_POINT, dcuAssetId]
  );
  let connectionPointAssetId;
  if (cp) {
    connectionPointAssetId = cp.id;
  } else {
    const inserted = await dbRun(
      db,
      'INSERT INTO asset (organization_id, asset_type_id, parent_asset_id, code, name, status) VALUES (?, ?, ?, ?, ?, ?)',
      [orgId, assetTypeId.CONNECTION_POINT, dcuAssetId, 'Тодорхойгүй хайрцаг', 'Тодорхойгүй хайрцаг', 'active']
    );
    connectionPointAssetId = inserted.lastID;
    await dbRun(db, 'INSERT INTO connection_point (asset_id) VALUES (?)', [connectionPointAssetId]);
  }

  const customerIdByCode = new Map();
  const missingBrands = new Set();
  let inserted = 0;

  try {
    await dbRun(db, 'BEGIN TRANSACTION');

    for (const rec of netNew) {
      let custId = null;
      if (rec.customerCode) {
        custId = customerIdByCode.get(rec.customerCode);
        if (custId === undefined) {
          const existingCustomer = await dbGet(db, 'SELECT id FROM customer WHERE customer_code = ?', [rec.customerCode]);
          if (existingCustomer) {
            custId = existingCustomer.id;
          } else {
            const insertedCust = await dbRun(db, 'INSERT INTO customer (customer_code, name) VALUES (?, ?)', [rec.customerCode, 'Тодорхойгүй']);
            custId = insertedCust.lastID;
          }
          customerIdByCode.set(rec.customerCode, custId);
        }
      }

      const meterTypeId = meterTypeIdByBrand.get(rec.brand.toLowerCase()) || null;
      if (!meterTypeId) missingBrands.add(rec.brand);

      const isDecommissioned = rec.reason === 'Актлагдсан' || rec.reason === 'Хураагдсан';
      const status = isDecommissioned ? 'disconnected' : 'connected';
      const meterStatus = isDecommissioned ? 'Fault' : 'Active';
      const alarm = isDecommissioned ? rec.reason : '-';

      const meterInserted = await dbRun(
        db,
        `INSERT INTO meter (meter_id, meter_type_id, organization_id, parent_asset_id, status, meter_status, alarm, energy_consumption, installation_type, verified_from, verified_to, amperage, voltage)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [rec.meterNumber, meterTypeId, orgId, dcuAssetId, status, meterStatus, alarm, rec.reason, rec.verifiedFrom, rec.verifiedTo, rec.amperage, rec.voltage]
      );
      const meterRowId = meterInserted.lastID;

      await dbRun(
        db,
        'INSERT INTO meter_connection (meter_id, connection_point_id, connected_from, connected_to) VALUES (?, ?, ?, NULL)',
        [meterRowId, connectionPointAssetId, rec.verifiedFrom]
      );
      await dbRun(
        db,
        'INSERT INTO meter_dcu (meter_id, dcu_id, connected_from, connected_to) VALUES (?, ?, ?, NULL)',
        [meterRowId, dcuAssetId, rec.verifiedFrom]
      );
      if (custId) {
        await dbRun(
          db,
          'INSERT INTO customer_meter (customer_id, meter_id, linked_from, linked_to) VALUES (?, ?, ?, NULL)',
          [custId, meterRowId, rec.verifiedFrom]
        );
      }
      if (isDecommissioned) {
        await dbRun(
          db,
          'INSERT INTO meter_event (meter_id, event_type, event_at, description) VALUES (?, ?, ?, ?)',
          [meterRowId, 'STATUS', rec.verifiedFrom, rec.reason]
        );
      }

      inserted += 1;
    }

    await dbRun(db, 'COMMIT');
    console.log(`\nInserted ${inserted} net-new meters.`);
    if (missingBrands.size > 0) {
      console.log(`Brands not found in meter_types catalog (meter_type_id left NULL for these, ${missingBrands.size} distinct):`);
      console.log('  ' + [...missingBrands].join(', '));
    }
  } catch (err) {
    await dbRun(db, 'ROLLBACK').catch(() => {});
    console.error('Import failed, rolled back:', err.message);
    throw err;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
