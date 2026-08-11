require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const Anthropic = require('@anthropic-ai/sdk');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 8088;
const sqlitePath = path.join(__dirname, 'smartmeter.db');
const datasheetDir = path.join(__dirname, 'MeterSpec', 'datasheet');
const picturesDir = path.join(__dirname, 'MeterSpec', 'pictures');
fs.mkdirSync(picturesDir, { recursive: true });
const PICTURE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const PICTURE_MEDIA_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

let anthropicClient = null;
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key') {
    throw new Error('ANTHROPIC_API_KEY тохируулагдаагүй байна. .env файлд бодит түлхүүрээ оруулна уу.');
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

const DATASHEET_EXTRACT_TOOL = {
  name: 'extract_meter_model',
  description:
    'Extract meter model specification fields from a meter datasheet document, and identify which existing catalog entry this datasheet describes.',
  input_schema: {
    type: 'object',
    properties: {
      matchedId: {
        type: ['integer', 'null'],
        description: 'The id of the catalog entry (from the provided list) that this datasheet describes. Null if no confident match exists.',
      },
      brand: { type: ['string', 'null'] },
      model: { type: ['string', 'null'] },
      manufacturer: { type: ['string', 'null'] },
      type: { type: ['string', 'null'], description: 'e.g. "1 фаз электрон", "3 фаз Smart"' },
      phase: { type: ['string', 'null'], description: 'e.g. "1" or "3"' },
      meterType: { type: ['string', 'null'], description: 'e.g. "Ухаалаг тоолуур"' },
      standard: { type: ['string', 'null'], description: 'e.g. "IEC 62053-21"' },
      dataTransmission: { type: ['string', 'null'] },
    },
    required: ['matchedId'],
  },
};

async function extractMeterModelFromDatasheet(client, pdfBase64, catalog) {
  const catalogList = catalog
    .map((c) => `id=${c.id}: brand="${c.brand || ''}" model="${c.model || ''}" manufacturer="${c.manufacturer || ''}"`)
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    output_config: { effort: 'medium' },
    tools: [DATASHEET_EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: 'extract_meter_model' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          {
            type: 'text',
            text:
              'Энэ бол тоолуурын datasheet баримт бичиг юм. Доорх каталогийн жагсаалтаас энэ ' +
              'datasheet-д тохирох тоолуурын загварыг ол (matchedId), мөн баримт бичигт тодорхой ' +
              'дурдсан техникийн үзүүлэлтүүдийг гарга. Зөвхөн баримт бичигт бодитоор бичигдсэн ' +
              'мэдээллийг гарга; тодорхойгүй талбарыг null болго. Тохирох загвар олдохгүй бол ' +
              'matchedId-г null болго.\n\nКаталогийн жагсаалт:\n' +
              catalogList,
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  return toolUse ? toolUse.input : null;
}

async function extractMeterModelFromPhoto(client, imageBase64, mediaType, catalog) {
  const catalogList = catalog
    .map((c) => `id=${c.id}: brand="${c.brand || ''}" model="${c.model || ''}" manufacturer="${c.manufacturer || ''}"`)
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    output_config: { effort: 'medium' },
    tools: [DATASHEET_EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: 'extract_meter_model' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text:
              'Энэ бол тоолуурын бодит гэрэл зураг (тоолуур дээрх шошго/nameplate байж болно). Доорх ' +
              'каталогийн жагсаалтаас энэ зурган дээрх тоолуурт тохирох загварыг ол (matchedId), мөн ' +
              'зурган дээр бодитоор тод харагдаж буй техникийн үзүүлэлтүүдийг гарга. Зөвхөн зурган дээр ' +
              'бодитоор бичигдсэн, тод унших боломжтой мэдээллийг гарга; тодорхойгүй талбарыг null болго. ' +
              'Тохирох загвар олдохгүй бол matchedId-г null болго.\n\nКаталогийн жагсаалт:\n' +
              catalogList,
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  return toolUse ? toolUse.input : null;
}

const DATASHEET_FIELDS_TOOL = {
  name: 'extract_meter_model_fields',
  description: 'Extract meter model specification fields from a meter datasheet document.',
  input_schema: {
    type: 'object',
    properties: {
      brand: { type: ['string', 'null'] },
      model: { type: ['string', 'null'] },
      manufacturer: { type: ['string', 'null'] },
      type: { type: ['string', 'null'], description: 'e.g. "1 фаз электрон", "3 фаз Smart"' },
      phase: { type: ['string', 'null'], description: 'e.g. "1" or "3"' },
      meterType: { type: ['string', 'null'], description: 'e.g. "Ухаалаг тоолуур"' },
      standard: { type: ['string', 'null'], description: 'e.g. "IEC 62053-21"' },
      dataTransmission: { type: ['string', 'null'] },
    },
    required: [],
  },
};

async function extractMeterModelFieldsFromDatasheet(client, pdfBase64) {
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    output_config: { effort: 'medium' },
    tools: [DATASHEET_FIELDS_TOOL],
    tool_choice: { type: 'tool', name: 'extract_meter_model_fields' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          {
            type: 'text',
            text:
              'Энэ бол тоолуурын datasheet баримт бичиг юм. Баримт бичигт бодитоор дурдсан ' +
              'техникийн үзүүлэлтүүдийг гарга. Зөвхөн баримт бичигт бодитоор бичигдсэн мэдээллийг ' +
              'гарга; тодорхойгүй талбарыг null болго.',
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  return toolUse ? toolUse.input : null;
}

async function extractMeterModelFieldsFromPhoto(client, imageBase64, mediaType) {
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    output_config: { effort: 'medium' },
    tools: [DATASHEET_FIELDS_TOOL],
    tool_choice: { type: 'tool', name: 'extract_meter_model_fields' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text:
              'Энэ бол тоолуурын бодит гэрэл зураг (тоолуур дээрх шошго/nameplate байж болно). ' +
              'Зурган дээр бодитоор тод харагдаж буй техникийн үзүүлэлтүүдийг гарга. Зөвхөн зурган дээр ' +
              'бодитоор бичигдсэн, тод унших боломжтой мэдээллийг гарга; тодорхойгүй эсвэл ' +
              'уншигдахгүй байгаа талбарыг null болго.',
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  return toolUse ? toolUse.input : null;
}

// Offline photo extraction via a local Ollama vision model, used when the
// user picks the "Offline" engine — no data leaves the machine. Only photos
// are supported this way (Ollama's local vision models take raw images, not
// PDFs, so datasheet extraction stays cloud-only).
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'qwen2.5vl:7b';

async function callOllamaVision(imageBase64, promptText) {
  let response;
  try {
    response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_VISION_MODEL,
        messages: [{ role: 'user', content: promptText, images: [imageBase64] }],
        format: 'json',
        stream: false,
      }),
    });
  } catch (netErr) {
    throw new Error(`Ollama серверт холбогдож чадсангүй (${OLLAMA_HOST}). "ollama serve" ажиллаж байгаа эсэхийг шалгана уу.`);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`${OLLAMA_VISION_MODEL} загвар суулгаагүй байна. "ollama pull ${OLLAMA_VISION_MODEL}" ажиллуулна уу.`);
    }
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama алдаа (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.message?.content;
}

function parseOllamaJson(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

const OLLAMA_FIELDS_PROMPT = `Энэ бол тоолуурын бодит гэрэл зураг (тоолуур дээрх шошго/nameplate байж болно).
Зурган дээр бодитоор тод харагдаж буй техникийн үзүүлэлтүүдийг гарга. Зөвхөн зурган дээр
бодитоор бичигдсэн, тод унших боломжтой мэдээллийг гарга; тодорхойгүй эсвэл уншигдахгүй
байгаа талбарыг null болго.

Дараах JSON бүтцээр ЗӨВХӨН JSON хариулт өг (өөр текст бүү нэм):
{"brand": string|null, "model": string|null, "manufacturer": string|null, "type": string|null, "phase": string|null, "meterType": string|null, "standard": string|null, "dataTransmission": string|null}`;

async function extractMeterModelFieldsFromPhotoOllama(imageBase64) {
  const content = await callOllamaVision(imageBase64, OLLAMA_FIELDS_PROMPT);
  return parseOllamaJson(content);
}

async function extractMeterModelFromPhotoOllama(imageBase64, catalog) {
  const catalogList = catalog
    .map((c) => `id=${c.id}: brand="${c.brand || ''}" model="${c.model || ''}" manufacturer="${c.manufacturer || ''}"`)
    .join('\n');

  const prompt = `Энэ бол тоолуурын бодит гэрэл зураг (тоолуур дээрх шошго/nameplate байж болно). Доорх
каталогийн жагсаалтаас энэ зурган дээрх тоолуурт тохирох загварыг ол (matchedId), мөн зурган
дээр бодитоор тод харагдаж буй техникийн үзүүлэлтүүдийг гарга. Зөвхөн зурган дээр бодитоор
бичигдсэн, тод унших боломжтой мэдээллийг гарга; тодорхойгүй талбарыг null болго. Тохирох
загвар олдохгүй бол matchedId-г null болго.

Каталогийн жагсаалт:
${catalogList}

Дараах JSON бүтцээр ЗӨВХӨН JSON хариулт өг (өөр текст бүү нэм):
{"matchedId": number|null, "brand": string|null, "model": string|null, "manufacturer": string|null, "type": string|null, "phase": string|null, "meterType": string|null, "standard": string|null, "dataTransmission": string|null}`;

  const content = await callOllamaVision(imageBase64, prompt);
  return parseOllamaJson(content);
}

const dbClient = new sqlite3.Database(sqlitePath, (err) => {
  if (err) {
    console.error('Failed to open SQLite database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

app.use(
  helmet({
    // main.html ships its whole UI as one inline <script>/<style> block,
    // so the default strict CSP would break the app; keep the other
    // protections (X-Frame-Options, X-Content-Type-Options, HSTS, etc.).
    contentSecurityPolicy: false,
  })
);
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    store: new SQLiteStore({
      db: dbClient,
      table: 'sessions',
    }),
    secret: process.env.SESSION_SECRET || 'localsecret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      // For local development keep secure=false so cookie is set over HTTP.
      // In production, set NODE_ENV=production and ensure HTTPS is used.
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);
app.use(express.static(path.join(__dirname)));
app.use('/pictures', express.static(path.join(__dirname, 'MeterSpec', 'pictures')));

// Convert plain-text error responses to JSON for any client when status >= 400
app.use((req, res, next) => {
  const originalSend = res.send.bind(res);
  res.send = function (body) {
    if (this.statusCode >= 400 && typeof body === 'string') {
      this.type('application/json');
      return originalSend(JSON.stringify({ success: false, message: body }));
    }
    return originalSend(body);
  };
  next();
});

function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  console.log('Unauthenticated request:', req.method, req.path, 'cookies=', req.headers.cookie);
  return res.status(401).json({ success: false, message: 'Нэвтрээгүй байна.' });
}

// Promisified sqlite3 helpers. sqlite3's callback API doesn't compose well
// with the multi-step, dependent-lookup logic the normalization migration
// below needs (insert a parent row, read back its id, insert children...),
// so these give that migration (and it alone) a plain async/await shape.
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbClient.run(sql, params, function runCallback(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbClient.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbClient.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function hashSeed(str) {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// One-time migration: normalizes the flat `meters` table into
// organization/asset/connection_point/dcu/customer/meter/... tables
// matching the ER diagram the team supplied. Detected via the `meters_legacy`
// table (created only once the migration fully commits), so a failed/partial
// run safely retries on the next server start instead of silently skipping.
//
// Deliberate scope limits (matching the "real data, no fabricated levels"
// approach already used by the Мод tree / Тоолуур холбох цэг views):
// - the `asset` hierarchy is only ever 2 levels deep (SUBSTATION -> DCU),
//   built from the real `substation`/`dcu_id` columns; the ER diagram's
//   deeper feeder/transformer tiers aren't in the source data, so they
//   aren't invented as real rows.
// - each DCU gets exactly one `connection_point` child (its distribution
//   cabinet), with cabinet/breaker/cable codes generated once per DCU
//   (deterministic from dcu_id) and shared by every meter connected to it —
//   fixing an inconsistency in the old client-side-only version of these
//   codes, which generated a different code per meter even when meters
//   shared a cabinet.
// - `meter_reading` gets exactly one row per meter (from the existing
//   last_reading_at/energy_consumption), not a fabricated history.
// - `meter_event` gets one row per meter with a real alarm.
// - `remote_command` is created empty (new capability, no existing data).
async function migrateToNormalizedSchema() {
  const alreadyDone = await dbGet("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meters_legacy'");
  if (alreadyDone) return;

  console.log('Normalizing schema into organization/asset/connection_point/dcu/customer/meter tables...');

  await dbRun(`CREATE TABLE IF NOT EXISTS organization (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS asset_type (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS asset (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER REFERENCES organization(id),
    asset_type_id INTEGER NOT NULL REFERENCES asset_type(id),
    parent_asset_id INTEGER REFERENCES asset(id),
    code TEXT NOT NULL,
    name TEXT,
    status TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS connection_point (
    asset_id INTEGER PRIMARY KEY REFERENCES asset(id),
    cabinet_code TEXT,
    feeder_id TEXT,
    phase_line TEXT,
    breaker_code TEXT,
    cable_code TEXT,
    voltage_phase TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS dcu (
    asset_id INTEGER PRIMARY KEY REFERENCES asset(id),
    communication_tech TEXT,
    last_seen_at TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS customer (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_code TEXT UNIQUE,
    name TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS meter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id TEXT NOT NULL,
    serial_number TEXT,
    meter_name TEXT,
    meter_type_id INTEGER REFERENCES meter_types(id),
    organization_id INTEGER REFERENCES organization(id),
    parent_asset_id INTEGER REFERENCES asset(id),
    status TEXT,
    meter_status TEXT,
    alarm TEXT,
    energy_consumption REAL DEFAULT 0,
    installation_type TEXT,
    verified_from TEXT,
    verified_to TEXT,
    raw_status TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS measurement_type (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    unit TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS meter_connection (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id INTEGER NOT NULL REFERENCES meter(id),
    connection_point_id INTEGER NOT NULL REFERENCES connection_point(asset_id),
    connected_from TEXT,
    connected_to TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS meter_dcu (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id INTEGER NOT NULL REFERENCES meter(id),
    dcu_id INTEGER NOT NULL REFERENCES dcu(asset_id),
    connected_from TEXT,
    connected_to TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS customer_meter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customer(id),
    meter_id INTEGER NOT NULL REFERENCES meter(id),
    address TEXT,
    building TEXT,
    unit TEXT,
    facility TEXT,
    linked_from TEXT,
    linked_to TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS meter_reading (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id INTEGER NOT NULL REFERENCES meter(id),
    measurement_type_id INTEGER REFERENCES measurement_type(id),
    reading_at TEXT,
    value REAL
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS meter_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id INTEGER NOT NULL REFERENCES meter(id),
    event_type TEXT,
    event_at TEXT,
    description TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS remote_command (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id INTEGER NOT NULL REFERENCES meter(id),
    measurement_type_id INTEGER REFERENCES measurement_type(id),
    command_type TEXT,
    status TEXT,
    requested_at TEXT,
    completed_at TEXT
  )`);

  try {
    await dbRun('BEGIN TRANSACTION');

    const assetTypeNames = {
      SUBSTATION: 'Дэд станц',
      DCU: 'DCU / Трансформатор',
      CONNECTION_POINT: 'Холболтын цэг',
    };
    const assetTypeId = {};
    for (const code of Object.keys(assetTypeNames)) {
      await dbRun('INSERT OR IGNORE INTO asset_type (code, name) VALUES (?, ?)', [code, assetTypeNames[code]]);
      const row = await dbGet('SELECT id FROM asset_type WHERE code = ?', [code]);
      assetTypeId[code] = row.id;
    }

    const measurementTypes = [
      ['ACTIVE_ENERGY', 'Идэвхтэй энерги', 'kWh'],
      ['REACTIVE_ENERGY', 'Урвал энерги', 'kVARh'],
      ['VOLTAGE', 'Хүчдэл', 'V'],
      ['CURRENT', 'Гүйдэл', 'A'],
      ['ACTIVE_POWER', 'Идэвхтэй чадал', 'kW'],
      ['APPARENT_POWER', 'Бүрэн чадал', 'kVA'],
      ['POWER_FACTOR', 'Чадлын коэффициент', null],
      ['FREQUENCY', 'Давтамж', 'Hz'],
    ];
    for (const [code, name, unit] of measurementTypes) {
      await dbRun('INSERT OR IGNORE INTO measurement_type (code, name, unit) VALUES (?, ?, ?)', [code, name, unit]);
    }
    const activeEnergyType = await dbGet("SELECT id FROM measurement_type WHERE code = 'ACTIVE_ENERGY'");

    const legacyMeters = await dbAll('SELECT * FROM meters ORDER BY id');
    const meterTypeCatalog = await dbAll('SELECT id, brand FROM meter_types');
    const meterTypeIdByBrand = new Map();
    meterTypeCatalog.forEach((mt) => {
      if (mt.brand) meterTypeIdByBrand.set(mt.brand.trim().toLowerCase(), mt.id);
    });

    const orgIdByName = new Map();
    const substationAssetIdByName = new Map();
    const dcuInfoByKey = new Map(); // key: `${substation}|||${dcuCode}` -> { dcuAssetId, connectionPointAssetId }
    const customerIdByCode = new Map();

    let migratedCount = 0;
    for (const m of legacyMeters) {
      const orgName = m.company || 'Тодорхойгүй байгууллага';
      let orgId = orgIdByName.get(orgName);
      if (orgId === undefined) {
        await dbRun('INSERT OR IGNORE INTO organization (name) VALUES (?)', [orgName]);
        orgId = (await dbGet('SELECT id FROM organization WHERE name = ?', [orgName])).id;
        orgIdByName.set(orgName, orgId);
      }

      const subName = m.substation || 'Тодорхойгүй дэд станц';
      let subAssetId = substationAssetIdByName.get(subName);
      if (subAssetId === undefined) {
        const inserted = await dbRun(
          'INSERT INTO asset (organization_id, asset_type_id, parent_asset_id, code, name, status) VALUES (?, ?, NULL, ?, ?, ?)',
          [orgId, assetTypeId.SUBSTATION, subName, subName, 'active']
        );
        subAssetId = inserted.lastID;
        substationAssetIdByName.set(subName, subAssetId);
      }

      const dcuCode = m.dcu_id || 'Тодорхойгүй DCU';
      const dcuKey = `${subName}|||${dcuCode}`;
      let dcuInfo = dcuInfoByKey.get(dcuKey);
      if (!dcuInfo) {
        const dcuInserted = await dbRun(
          'INSERT INTO asset (organization_id, asset_type_id, parent_asset_id, code, name, status) VALUES (?, ?, ?, ?, ?, ?)',
          [orgId, assetTypeId.DCU, subAssetId, dcuCode, dcuCode, 'active']
        );
        const dcuAssetId = dcuInserted.lastID;
        await dbRun('INSERT INTO dcu (asset_id, communication_tech) VALUES (?, ?)', [dcuAssetId, 'PLC']);

        const seed = hashSeed(dcuKey);
        const cabinetCode = `K${1 + (seed % 6)}-${10 + (seed % 30)}`;
        const breakerCode = `QF-${1 + (seed % 40)}`;
        const cableCode = `CB-${cabinetCode}-${String(1 + (seed % 30)).padStart(3, '0')}`;

        const cpInserted = await dbRun(
          'INSERT INTO asset (organization_id, asset_type_id, parent_asset_id, code, name, status) VALUES (?, ?, ?, ?, ?, ?)',
          [orgId, assetTypeId.CONNECTION_POINT, dcuAssetId, cabinetCode, cabinetCode, 'active']
        );
        const connectionPointAssetId = cpInserted.lastID;
        await dbRun(
          'INSERT INTO connection_point (asset_id, cabinet_code, breaker_code, cable_code) VALUES (?, ?, ?, ?)',
          [connectionPointAssetId, cabinetCode, breakerCode, cableCode]
        );

        dcuInfo = { dcuAssetId, connectionPointAssetId };
        dcuInfoByKey.set(dcuKey, dcuInfo);
      }

      const custCode = m.customer_code || m.meter_id;
      let custId = customerIdByCode.get(custCode);
      if (custId === undefined) {
        await dbRun('INSERT OR IGNORE INTO customer (customer_code, name) VALUES (?, ?)', [custCode, m.customer_name || 'Тодорхойгүй']);
        custId = (await dbGet('SELECT id FROM customer WHERE customer_code = ?', [custCode])).id;
        customerIdByCode.set(custCode, custId);
      }

      const meterTypeId = meterTypeIdByBrand.get((m.brand || '').trim().toLowerCase()) || null;
      const meterInserted = await dbRun(
        `INSERT INTO meter (meter_id, serial_number, meter_name, meter_type_id, organization_id, parent_asset_id, status, meter_status, alarm, energy_consumption, installation_type, verified_from, verified_to, raw_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.meter_id, m.serial_number, m.meter_name, meterTypeId, orgId, dcuInfo.dcuAssetId,
          m.status, m.meter_status, m.alarm, m.energy_consumption, m.installation_type,
          m.verified_from, m.verified_to, m.raw_status,
        ]
      );
      const meterRowId = meterInserted.lastID;

      await dbRun(
        'INSERT INTO meter_connection (meter_id, connection_point_id, connected_from, connected_to) VALUES (?, ?, ?, NULL)',
        [meterRowId, dcuInfo.connectionPointAssetId, m.verified_from || null]
      );
      await dbRun(
        'INSERT INTO meter_dcu (meter_id, dcu_id, connected_from, connected_to) VALUES (?, ?, ?, NULL)',
        [meterRowId, dcuInfo.dcuAssetId, m.verified_from || null]
      );
      await dbRun(
        'INSERT INTO customer_meter (customer_id, meter_id, address, building, unit, facility, linked_from, linked_to) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
        [custId, meterRowId, m.address, m.building, m.unit, m.facility, m.verified_from || null]
      );

      if (m.last_reading_at) {
        await dbRun(
          'INSERT INTO meter_reading (meter_id, measurement_type_id, reading_at, value) VALUES (?, ?, ?, ?)',
          [meterRowId, activeEnergyType.id, m.last_reading_at, m.energy_consumption || 0]
        );
      }
      if (m.alarm && m.alarm !== '-') {
        await dbRun(
          'INSERT INTO meter_event (meter_id, event_type, event_at, description) VALUES (?, ?, ?, ?)',
          [meterRowId, 'ALARM', m.last_reading_at || null, m.alarm]
        );
      }

      migratedCount += 1;
    }

    await dbRun('ALTER TABLE meters RENAME TO meters_legacy');
    await dbRun('COMMIT');
    console.log(`Normalized ${migratedCount} meters into organization/asset/connection_point/dcu/customer/meter schema.`);
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    console.error('Normalization migration failed, rolled back:', err.message);
    throw err;
  }
}

async function initDatabase() {
  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);
  // Once the normalized schema migration has fully committed (meters_legacy
  // exists), the legacy flat `meters` table bootstrapping below is obsolete
  // and must be skipped -- otherwise every restart would recreate an empty
  // `meters` table, trip the address/serial_number migrations again, and
  // re-import the 766-row JSON seed into a table nothing reads from anymore.
  const legacyMigrationDone = await dbGet(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meters_legacy'"
  );

  if (!legacyMigrationDone) {
    await dbRun(`CREATE TABLE IF NOT EXISTS meters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    energy_consumption REAL NOT NULL
  )`);
  }
  await dbRun(`CREATE TABLE IF NOT EXISTS meter_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT,
    model TEXT,
    manufacturer TEXT,
    type TEXT,
    quantity INTEGER,
    phase TEXT,
    meter_type TEXT,
    standard TEXT,
    data_transmission TEXT
  )`);

  const userCount = await dbGet('SELECT COUNT(*) AS count FROM users');
  if (userCount.count === 0) {
    try {
      await dbRun('INSERT INTO users (username, password) VALUES (?, ?)', ['admin', 'admin']);
      console.log('Created default SQLite user: admin / admin');
    } catch (error) {
      console.error('Failed to create default user:', error.message);
    }
  }

  // One-time migration: widen `meters` with the real fields imported from
  // MCSI meters/meters.xlsx ("Цэций хороолол" sheet) and replace the
  // synthetic MTR-00x sample rows with the 766 real records. Detected via
  // the presence of the `address` column so it only runs once.
  if (!legacyMigrationDone) {
  try {
    const columns = await dbAll('PRAGMA table_info(meters)');
    if (!columns.some((c) => c.name === 'address')) {
      await dbRun('ALTER TABLE meters RENAME TO meters_old');
      // meter_id is intentionally not UNIQUE here: the source data has a
      // handful of duplicate meter numbers (data-entry issue upstream).
      await dbRun(`CREATE TABLE meters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meter_id TEXT NOT NULL,
        status TEXT NOT NULL,
        energy_consumption REAL NOT NULL DEFAULT 0,
        address TEXT,
        building TEXT,
        unit TEXT,
        customer_code TEXT,
        facility TEXT,
        verified_from TEXT,
        verified_to TEXT,
        brand TEXT,
        company TEXT,
        installation_type TEXT,
        raw_status TEXT
      )`);
      await dbRun('DROP TABLE meters_old');

      let records = [];
      try {
        const seedPath = path.join(__dirname, 'data', 'tsetsii-khoroolol-meters.json');
        records = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      } catch (readErr) {
        console.error('Failed to read meters seed file:', readErr.message);
      }

      if (records.length > 0) {
        await new Promise((resolve, reject) => {
          const insert = dbClient.prepare(
            `INSERT INTO meters (meter_id, status, energy_consumption, address, building, unit, customer_code, facility, verified_from, verified_to, brand, company, installation_type, raw_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          records.forEach((r) => {
            const status = (r.rawStatus || '').includes('холбоотой') ? 'connected' : 'disconnected';
            insert.run(
              r.meterId, status, 0, r.address, r.building, r.unit, r.customerCode, r.facility,
              r.verifiedFrom, r.verifiedTo, r.brand, r.company, r.installationType, r.rawStatus
            );
          });
          insert.finalize((err) => (err ? reject(err) : resolve()));
        });
        console.log(`Imported ${records.length} meters from Цэций хороолол (MCSI meters/meters.xlsx)`);
      }
    }
  } catch (err) {
    console.error('Meters address migration failed:', err.message);
  }

  // Second migration: the meters table has no serial number, meter name,
  // meter type, customer name, substation, DCU, last reading, meter status
  // or alarm columns yet. Add them and fill every existing row with
  // example values derived from the real fields we do have, so the list
  // view can show the full column set. Detected via `serial_number`.
  try {
    const columns = await dbAll('PRAGMA table_info(meters)');
    if (!columns.some((c) => c.name === 'serial_number')) {
      const newColumns = [
        ['serial_number', 'TEXT'],
        ['meter_name', 'TEXT'],
        ['meter_type', 'TEXT'],
        ['customer_name', 'TEXT'],
        ['substation', 'TEXT'],
        ['dcu_id', 'TEXT'],
        ['last_reading_at', 'TEXT'],
        ['meter_status', 'TEXT'],
        ['alarm', 'TEXT'],
      ];
      for (const [name, type] of newColumns) {
        await dbRun(`ALTER TABLE meters ADD COLUMN ${name} ${type}`);
      }

      const rows = await dbAll('SELECT id, status, facility, unit, building, brand FROM meters ORDER BY id');

      const dcuList = ['DCU-01', 'DCU-02', 'DCU-03', 'DCU-04', 'DCU-05', 'DCU-06', 'DCU-07', 'DCU-08', 'DCU-09', 'DCU-10'];
      const substations = ['КТПН-15', 'КТПН-33', 'КТПН-37', 'ХТП-1', 'ХТП-2'];
      const customerSeeds = ['Толгой', 'Бат', 'Дорж', 'Сараа', 'Оюун', 'Ганбат', 'Мөнх', 'Түвшин', 'Наран', 'Билгүүн'];
      const meterNameKinds = ['айлын тоолуур', 'лифтний тоолуур', 'нийтийн зарлагын тоолуур', 'насосны тоолуур', 'гэрлийн тоолуур'];

      await new Promise((resolve, reject) => {
        const update = dbClient.prepare(
          `UPDATE meters SET serial_number = ?, meter_name = ?, meter_type = ?, customer_name = ?, substation = ?,
           dcu_id = ?, last_reading_at = ?, meter_status = ?, alarm = ? WHERE id = ?`
        );

        rows.forEach((r, i) => {
          const isOnline = r.status === 'connected';
          const serialNumber = `DDSY23${String(i + 1).padStart(4, '0')}`;
          const customerName = customerSeeds[i % customerSeeds.length];
          const meterName = `${r.facility || r.building || 'Тоолуур'} ${meterNameKinds[i % meterNameKinds.length]}`;
          const meterType = r.brand || 'Тодорхойгүй';
          const substation = substations[i % substations.length];
          const dcuId = dcuList[i % dcuList.length];
          const meterStatus = isOnline ? 'Active' : 'Fault';
          const alarm = isOnline ? '-' : 'Offline';

          const date = new Date();
          let lastReadingAt;
          if (isOnline) {
            lastReadingAt = date.toTimeString().slice(0, 5);
          } else {
            date.setDate(date.getDate() - (1 + (i % 5)));
            lastReadingAt = date.toISOString().slice(0, 10);
          }

          update.run(serialNumber, meterName, meterType, customerName, substation, dcuId, lastReadingAt, meterStatus, alarm, r.id);
        });

        update.finalize((err) => (err ? reject(err) : resolve()));
      });
      console.log(`Filled ${rows.length} meters with example serial/name/DCU/substation/status/alarm fields`);
    }
  } catch (err) {
    console.error('Meters serial_number migration failed:', err.message);
  }
  }

  try {
    const row = await dbGet('SELECT COUNT(*) AS count FROM meter_types');
    if (row.count === 0) {
      // Imported from MCSI meters/meters.xlsx, sheet "Meters" (52 rows).
      const meterTypes = [
          ['C2000', 'Microstar C2000 smart meter', 'OEM (Хятад)', '1 фаз электрон', 934, '1', 'Ухаалаг тоолуур', 'IEC 62053-21, IEC 62052-11, EN 50470', '21'],
          ['DDS286', 'DDS286', 'OEM (Хятад)', '1 фаз электрон', 270, null, null, null, null],
          ['DDS26', 'DDS26', 'OEM (Хятад)', '1 фаз электрон', 89, null, null, null, null],
          ['DDSF36A', 'DDSF36A', 'OEM (Хятад)', '1 фаз prepaid', 12, null, null, null, null],
          ['DDS155', 'DDS155', 'OEM (Хятад)', '1 фаз электрон', 6, null, null, null, null],
          ['DDSY283SR', 'DDSY283SR', 'Holley', '1 фаз ухаалаг prepaid', 11, null, null, null, null],
          ['DDS226', 'DDS226', 'OEM (Хятад)', '1 фаз электрон', 7, null, null, null, null],
          ['LGG100', 'LGG100', 'OEM', '1 фаз', 4, null, null, null, null],
          ['CHS160', 'CHS160', 'CHINT / OEM', '1 фаз', 7, null, null, null, null],
          ['DDS 26', 'DDS26', 'OEM (Хятад)', '1 фаз электрон', 12, null, null, null, null],
          ['DDS285', 'DDS285', 'OEM', '1 фаз', 2, null, null, null, null],
          ['DDSD285 ', 'DDSD285', 'OEM', '1 фаз олон тарифтай', 7, null, null, null, null],
          ['DТSD22', 'DTSD22', 'OEM', '3 фаз', 14, null, null, null, null],
          ['A1140-RAL-S-4T', 'A1140-RAL-S-4T', 'Elster (одоогийн Honeywell)', '3 фаз AMR', 5, null, null, null, null],
          ['DTS27', 'DTS27', 'OEM', '3 фаз', 23, null, null, null, null],
          ['DTSD545S', 'DTSD545S', 'Holley', '3 фаз Smart Meter ', 22, null, null, null, null],
          ['DTS 27A', 'DTS27A', 'OEM', '3 фаз', 3, null, null, null, null],
          ['A1840-RАL-S-4T', 'A1840-RAL-S-4T', 'Elster', '3 фаз Smart', 1, null, null, null, null],
          ['DTSD111', 'DTSD111', 'OEM', '3 фаз', 8, null, null, null, null],
          ['хоосон', 'ЦЭ6803ВМ', 'Energomera', '3 фаз', 4, null, null, null, null],
          ['ЦЭ6803ВМ', null, null, null, 5, null, null, null, null],
          ['DTS122', 'DTS122', 'OEM', '3 фаз', 8, null, null, null, null],
          ['A1802RAL-P4G-DW-3', 'IES62053-21 DTS122', 'OEM', '3 фаз', 3, null, null, null, null],
          ['IES62053-21DTS122', 'A1802RAL-P4G-DW-3', 'Elster', '3 фаз Smart', 2, null, null, null, null],
          ['DDS122', 'DDS122', 'OEM', '1 фаз', 11, null, null, null, null],
          ['ЦЭ68038', 'ЦЭ68038', 'Energomera', '3 фаз', 1, null, null, null, null],
          ['A1140-10-RAL-BW-4T ', 'A1140-10-RAL-BW-4T', 'Elster', '3 фаз', 8, null, null, null, null],
          ['А1140RAL-SW-4T', 'A1140RAL-SW-4T', 'Elster', '3 фаз', 3, null, null, null, null],
          ['A1805RL-P4G-DW-3', 'A1805RL-P4G-DW-3', 'Elster', '3 фаз Smart', 11, null, null, null, null],
          ['P2000-D', 'P2000-D', 'OEM', '1 фаз', 8, null, null, null, null],
          ['А1140RAL-S-4T', null, null, null, 2, null, null, null, null],
          ['CHS 330', 'CHS330', 'CHINT / OEM', '3 фаз', 4, null, null, null, null],
          ['DDSF217', 'DDSF217', 'OEM', '1 фаз prepaid', 2, null, null, null, null],
          ['СЕ303', 'СЕ303', 'Energomera', '3 фаз', 8, null, null, null, null],
          ['P2000-T', 'P2000-T', 'OEM', '3 фаз', 21, null, null, null, null],
          ['DTS27A', null, null, null, 2, null, null, null, null],
          ['DDS22', 'DDS22', 'OEM', '1 фаз', 19, null, null, null, null],
          ['DTZY666-Z', 'DTZY666-Z', 'OEM (ихэвчлэн Kaifa/Linyang төрлийн)', '3 фаз Smart', 2, null, null, null, null],
          ['DDSF22 (60A)', 'DDSF22 (60A)', 'OEM', '1 фаз prepaid', 1, null, null, null, null],
          ['ITZ', 'ITZ', 'OEM', 'тодорхойгүй', 2, null, null, null, null],
          ['DTZY341', 'DTZY341', 'OEM', '3 фаз Smart', 2, null, null, null, null],
          ['DDS3', 'DDS3', 'OEM', '1 фаз', 16, null, null, null, null],
          ['IEC 62053-21', 'IEC 62053-21', 'Тоолуур биш', 'Стандарт', 1, null, null, null, null],
          ['DTS169', 'DTS169', 'OEM', '3 фаз', 3, null, null, null, null],
          ['DDSF22', 'DDSF22', 'OEM', '1 фаз prepaid', 1, null, null, null, null],
          ['DDSD545S', 'DDSD545S', 'Holley', '1 фаз Smart', 6, null, null, null, null],
          ['DDS28', 'DDS28', 'OEM', '1 фаз', 1, null, null, null, null],
          ['DDSF3666', 'DDSF3666', 'OEM', '1 фаз prepaid', 1, null, null, null, null],
          ['DDS-5558', 'DDS-5558', 'OEM', '1 фаз', 26, null, null, null, null],
          ['DTS541', 'DTS541', 'OEM', '3 фаз', 1, null, null, null, null],
          ['A1140-RAL-SW-4T', null, null, null, 2, null, null, null, null],
          ['DDS169', 'DDS169', 'OEM', '1 фаз', 1, null, null, null, null],
        ];
        await new Promise((resolve, reject) => {
          const insertType = dbClient.prepare(
            'INSERT INTO meter_types (brand, model, manufacturer, type, quantity, phase, meter_type, standard, data_transmission) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          );
          meterTypes.forEach((row) => insertType.run(...row));
          insertType.finalize((err) => (err ? reject(err) : resolve()));
        });
      console.log(`Imported ${meterTypes.length} meter types from MCSI meters/meters.xlsx`);
    }
  } catch (err) {
    console.error('meter_types seed failed:', err.message);
  }

  await migrateToNormalizedSchema();
}

// Reads from the normalized organization/asset/connection_point/dcu/
// customer/meter tables (see migrateToNormalizedSchema), joining the
// currently-active connection_point/dcu/customer link (connected_to/
// linked_to IS NULL) and the one seeded meter_reading row per meter.
// The response shape is kept identical to the pre-normalization flat-table
// version so the client (main.html) didn't need to change.
app.get('/api/meters', ensureAuthenticated, async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT
        m.meter_id AS meter_id,
        m.status AS status,
        m.energy_consumption AS energy_consumption,
        cm.address AS address,
        cm.building AS building,
        cm.unit AS unit,
        c.customer_code AS customer_code,
        cm.facility AS facility,
        m.verified_from AS verified_from,
        m.verified_to AS verified_to,
        mt.brand AS brand,
        org.name AS company,
        m.installation_type AS installation_type,
        m.raw_status AS raw_status,
        m.serial_number AS serial_number,
        m.meter_name AS meter_name,
        mt.brand AS meter_type,
        c.name AS customer_name,
        (
          -- Walk up from the meter's linked asset (inclusive of itself, since
          -- some meters link directly to a SUBSTATION-tier node, e.g. the
          -- real Ukhaa Khudag network tree) to the nearest SUBSTATION
          -- ancestor. Depth varies per meter (1 hop for the old flat
          -- DCU->substation placement, several hops for the real tree), so
          -- this replaces a fixed single-hop join.
          WITH RECURSIVE anc(id, parent_id, code, type_code, depth) AS (
            SELECT a.id, a.parent_asset_id, a.code,
                   (SELECT t.code FROM asset_type t WHERE t.id = a.asset_type_id), 0
            FROM asset a WHERE a.id = dcu_asset.id
            UNION ALL
            SELECT a.id, a.parent_asset_id, a.code,
                   (SELECT t.code FROM asset_type t WHERE t.id = a.asset_type_id), anc.depth + 1
            FROM asset a JOIN anc ON a.id = anc.parent_id
          )
          SELECT code FROM anc WHERE type_code = 'SUBSTATION' ORDER BY depth LIMIT 1
        ) AS substation,
        dcu_asset.code AS dcu_id,
        mr.reading_at AS last_reading_at,
        m.meter_status AS meter_status,
        m.alarm AS alarm
      FROM meter m
      LEFT JOIN meter_types mt ON mt.id = m.meter_type_id
      LEFT JOIN organization org ON org.id = m.organization_id
      LEFT JOIN customer_meter cm ON cm.meter_id = m.id AND cm.linked_to IS NULL
      LEFT JOIN customer c ON c.id = cm.customer_id
      LEFT JOIN meter_dcu md ON md.meter_id = m.id AND md.connected_to IS NULL
      LEFT JOIN asset dcu_asset ON dcu_asset.id = md.dcu_id
      LEFT JOIN meter_reading mr ON mr.meter_id = m.id
      ORDER BY m.id
    `);

    const totalMeters = rows.length;
    const connectedMeters = rows.filter((row) => row.status === 'connected').length;
    const disconnectedMeters = rows.filter((row) => row.status !== 'connected').length;
    const totalEnergy = rows.reduce((sum, row) => sum + Number(row.energy_consumption), 0);

    return res.json({
      totalMeters,
      connectedMeters,
      disconnectedMeters,
      totalEnergy,
      meters: rows.map((row) => ({
        meterId: row.meter_id,
        status: row.status,
        energy: Number(row.energy_consumption),
        address: row.address,
        building: row.building,
        unit: row.unit,
        customerCode: row.customer_code,
        facility: row.facility,
        verifiedFrom: row.verified_from,
        verifiedTo: row.verified_to,
        brand: row.brand,
        company: row.company,
        installationType: row.installation_type,
        rawStatus: row.raw_status,
        serialNumber: row.serial_number,
        meterName: row.meter_name,
        meterType: row.meter_type,
        customerName: row.customer_name,
        substation: row.substation,
        dcuId: row.dcu_id,
        lastReadingAt: row.last_reading_at,
        meterStatus: row.meter_status,
        alarm: row.alarm,
      })),
    });
  } catch (error) {
    console.error('Meter API failed:', error.message);
    return res.status(500).json({ success: false, message: 'Серверийн алдаа.' });
  }
});

// Aggregate readiness stats for the "Судалгааны үр дүн" (survey results)
// view, computed live from the normalized meter data rather than a fixed
// snapshot. Definitions:
//   - remoteReady: catalog entry has a recorded data-transmission channel
//     (MODBUS/DLMS/RF/etc.) -- the meter itself is physically capable of
//     remote reads.
//   - remoteControllable: remoteReady AND the catalog classifies it as a
//     "Ухаалаг" (smart) meter -- smart meters support remote connect/disconnect,
//     plain electronic meters don't.
//   - hesCapable / hesConnected: whether the meter's DCU link points at a
//     real, named network node (from the imported Ukhaa Khudag tree) rather
//     than the generic "Тодорхойгүй DCU" placeholder left by meters whose
//     original source records didn't specify a DCU -- that placeholder
//     bucket is exactly the "needs additional equipment / registration"
//     population.
app.get('/api/meter-survey', ensureAuthenticated, async (req, res) => {
  try {
    const [{ total }] = await dbAll(`SELECT COUNT(*) AS total FROM meter`);

    const [{ remoteReady }] = await dbAll(`
      SELECT COUNT(*) AS remoteReady FROM meter m
      JOIN meter_types mt ON mt.id = m.meter_type_id
      WHERE mt.data_transmission IS NOT NULL AND TRIM(mt.data_transmission) != ''
    `);

    const [{ remoteControllable }] = await dbAll(`
      SELECT COUNT(*) AS remoteControllable FROM meter m
      JOIN meter_types mt ON mt.id = m.meter_type_id
      WHERE (mt.meter_type LIKE '%Ухаалаг%' OR mt.meter_type LIKE '%Smart%')
        AND mt.data_transmission IS NOT NULL AND TRIM(mt.data_transmission) != ''
    `);

    const [{ hesCapable }] = await dbAll(`
      SELECT COUNT(*) AS hesCapable FROM meter m
      JOIN meter_dcu md ON md.meter_id = m.id AND md.connected_to IS NULL
      JOIN asset a ON a.id = md.dcu_id
      WHERE a.code != 'Тодорхойгүй DCU'
    `);

    const [{ hesConnected }] = await dbAll(`
      SELECT COUNT(*) AS hesConnected FROM meter m
      JOIN meter_dcu md ON md.meter_id = m.id AND md.connected_to IS NULL
      JOIN asset a ON a.id = md.dcu_id
      WHERE a.code != 'Тодорхойгүй DCU' AND m.status = 'connected'
    `);

    const needsEquipment = total - hesCapable;

    res.json({
      success: true,
      total,
      remoteReady,
      remoteControllable,
      hesCapable,
      hesConnected,
      needsEquipment,
    });
  } catch (error) {
    console.error('Meter survey API failed:', error.message);
    res.status(500).json({ success: false, message: 'Серверийн алдаа.' });
  }
});

// Real asset hierarchy (see migrateToNormalizedSchema / scripts/import-network-tree.js),
// pruned to only the branches that actually have meters attached anywhere
// beneath them -- so unused synthetic substations left over from earlier
// migrations, and structural nodes with no meters, don't clutter the
// connection-point tree diagram.
app.get('/api/network-tree', ensureAuthenticated, async (req, res) => {
  try {
    const assets = await dbAll(
      `SELECT a.id, a.parent_asset_id, a.code, a.name, a.metadata, t.code AS type_code
       FROM asset a LEFT JOIN asset_type t ON t.id = a.asset_type_id`
    );
    const meterCounts = await dbAll(
      `SELECT dcu_id AS asset_id, COUNT(*) AS c
       FROM meter_dcu WHERE connected_to IS NULL GROUP BY dcu_id`
    );
    const meterCountByAsset = new Map(meterCounts.map((r) => [r.asset_id, r.c]));

    const byId = new Map(assets.map((a) => [a.id, { ...a, children: [] }]));
    const roots = [];
    byId.forEach((node) => {
      if (node.parent_asset_id && byId.has(node.parent_asset_id)) {
        byId.get(node.parent_asset_id).children.push(node);
      } else {
        roots.push(node);
      }
    });

    function build(node) {
      const children = node.children.map(build).filter(Boolean);
      const directMeters = meterCountByAsset.get(node.id) || 0;
      const totalMeters = directMeters + children.reduce((sum, c) => sum + c.totalMeters, 0);
      if (totalMeters === 0) return null;

      let metadata = null;
      try {
        metadata = node.metadata ? JSON.parse(node.metadata) : null;
      } catch {
        metadata = null;
      }

      return {
        id: node.id,
        code: node.code,
        name: node.name,
        typeCode: node.type_code,
        metadata,
        directMeters,
        totalMeters,
        children,
      };
    }

    const tree = roots.map(build).filter(Boolean);
    res.json({ success: true, tree });
  } catch (error) {
    console.error('Network tree API failed:', error.message);
    res.status(500).json({ success: false, message: 'Серверийн алдаа.' });
  }
});

app.get('/api/network-tree/:assetId/meters', ensureAuthenticated, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT m.meter_id, m.status, mt.brand
       FROM meter m
       JOIN meter_dcu md ON md.meter_id = m.id AND md.connected_to IS NULL
       LEFT JOIN meter_types mt ON mt.id = m.meter_type_id
       WHERE md.dcu_id = ?
       ORDER BY m.meter_id`,
      [req.params.assetId]
    );
    res.json({
      success: true,
      meters: rows.map((r) => ({ meterId: r.meter_id, status: r.status, brand: r.brand })),
    });
  } catch (error) {
    console.error('Network tree meters API failed:', error.message);
    res.status(500).json({ success: false, message: 'Серверийн алдаа.' });
  }
});

function mapMeterType(row) {
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    manufacturer: row.manufacturer,
    type: row.type,
    quantity: row.quantity,
    phase: row.phase,
    meterType: row.meter_type,
    standard: row.standard,
    dataTransmission: row.data_transmission,
  };
}

app.get('/api/meter-types', ensureAuthenticated, (req, res) => {
  dbClient.all(
    'SELECT id, brand, model, manufacturer, type, quantity, phase, meter_type, standard, data_transmission FROM meter_types ORDER BY id',
    (err, rows) => {
      if (err) {
        console.error('Meter types query failed:', err.message);
        return res.status(500).json({ success: false, message: 'Серверийн алдаа.' });
      }
      res.json({ meterTypes: rows.map(mapMeterType) });
    }
  );
});

app.post('/api/meter-types', ensureAuthenticated, (req, res) => {
  const { brand, model, manufacturer, type, quantity, phase, meterType, standard, dataTransmission } = req.body;

  if (!brand || !String(brand).trim()) {
    return res.status(400).json({ success: false, message: 'Марк заавал бөглөнө үү.' });
  }

  dbClient.run(
    `INSERT INTO meter_types (brand, model, manufacturer, type, quantity, phase, meter_type, standard, data_transmission)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [brand, model || null, manufacturer || null, type || null, quantity ?? null, phase || null, meterType || null, standard || null, dataTransmission || null],
    function (err) {
      if (err) {
        console.error('Meter type insert failed:', err.message);
        return res.status(500).json({ success: false, message: 'Серверийн алдаа.' });
      }
      dbClient.get('SELECT id, brand, model, manufacturer, type, quantity, phase, meter_type, standard, data_transmission FROM meter_types WHERE id = ?', [this.lastID], (getErr, row) => {
        if (getErr) {
          console.error('Meter type fetch after insert failed:', getErr.message);
          return res.status(500).json({ success: false, message: 'Серверийн алдаа.' });
        }
        res.status(201).json({ success: true, meterType: mapMeterType(row) });
      });
    }
  );
});

app.put('/api/meter-types/:id', ensureAuthenticated, (req, res) => {
  const { id } = req.params;
  const { brand, model, manufacturer, type, quantity, phase, meterType, standard, dataTransmission } = req.body;

  if (!brand || !String(brand).trim()) {
    return res.status(400).json({ success: false, message: 'Марк заавал бөглөнө үү.' });
  }

  dbClient.run(
    `UPDATE meter_types SET brand = ?, model = ?, manufacturer = ?, type = ?, quantity = ?, phase = ?, meter_type = ?, standard = ?, data_transmission = ?
     WHERE id = ?`,
    [brand, model || null, manufacturer || null, type || null, quantity ?? null, phase || null, meterType || null, standard || null, dataTransmission || null, id],
    function (err) {
      if (err) {
        console.error('Meter type update failed:', err.message);
        return res.status(500).json({ success: false, message: 'Серверийн алдаа.' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Загвар олдсонгүй.' });
      }
      dbClient.get('SELECT id, brand, model, manufacturer, type, quantity, phase, meter_type, standard, data_transmission FROM meter_types WHERE id = ?', [id], (getErr, row) => {
        if (getErr) {
          console.error('Meter type fetch after update failed:', getErr.message);
          return res.status(500).json({ success: false, message: 'Серверийн алдаа.' });
        }
        res.json({ success: true, meterType: mapMeterType(row) });
      });
    }
  );
});

app.delete('/api/meter-types/:id', ensureAuthenticated, (req, res) => {
  const { id } = req.params;

  dbClient.run('DELETE FROM meter_types WHERE id = ?', [id], function (err) {
    if (err) {
      console.error('Meter type delete failed:', err.message);
      return res.status(500).json({ success: false, message: 'Серверийн алдаа.' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: 'Загвар олдсонгүй.' });
    }
    res.json({ success: true });
  });
});

// Caps the base64 payload accepted by the datasheet/photo extraction
// endpoints. The global express.json() limit (20mb) already bounds the
// request body, but a dedicated check here gives a clear error instead of
// a generic body-too-large failure, and keeps a single authenticated user
// from burning API spend on an oversized upload.
const MAX_EXTRACT_BASE64_LENGTH = 15 * 1024 * 1024;

app.post('/api/meter-types/extract-datasheet', ensureAuthenticated, async (req, res) => {
  const { fileName, fileData, engine } = req.body || {};

  if (engine === 'offline') {
    return res.status(400).json({
      success: false,
      message: 'PDF датшийт унших offline (Ollama) горимд дэмжигдэхгүй. Cloud (Claude) горимыг ашиглана уу.',
    });
  }

  let client;
  try {
    client = getAnthropicClient();
  } catch (keyErr) {
    return res.status(400).json({ success: false, message: keyErr.message });
  }

  if (!fileData || typeof fileData !== 'string') {
    return res.status(400).json({ success: false, message: 'Датшийт файл ирээгүй байна.' });
  }
  if (fileData.length > MAX_EXTRACT_BASE64_LENGTH) {
    return res.status(400).json({ success: false, message: 'Датшийт файлын хэмжээ хэтэрхий том байна.' });
  }

  try {
    const pdfBase64 = fileData.includes(',') ? fileData.split(',').pop() : fileData;
    const fields = await extractMeterModelFieldsFromDatasheet(client, pdfBase64);
    if (!fields) {
      return res.json({ success: false, message: 'Датшийтээс мэдээлэл гаргаж чадсангүй.' });
    }
    res.json({ success: true, fields });
  } catch (extractErr) {
    console.error(`Datasheet field extraction failed${fileName ? ` for ${fileName}` : ''}:`, extractErr.message);
    res.status(500).json({ success: false, message: `Датшийт уншихад алдаа гарлаа: ${extractErr.message}` });
  }
});

// Lists image files available in the server-side pictures/ folder, so the
// photo-load feature only ever reads files an operator has placed there
// (no arbitrary client upload, no path traversal surface).
app.get('/api/pictures', ensureAuthenticated, (req, res) => {
  let files;
  try {
    files = fs
      .readdirSync(picturesDir)
      .filter((f) => PICTURE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
  } catch (dirErr) {
    return res.status(500).json({ success: false, message: `pictures фолдер уншихад алдаа гарлаа: ${dirErr.message}` });
  }
  res.json({ success: true, files });
});

app.get('/pictures-folder', ensureAuthenticated, (req, res) => {
  let files;
  try {
    files = fs
      .readdirSync(picturesDir)
      .filter((f) => PICTURE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
  } catch (dirErr) {
    return res.status(500).send(`Failed to read pictures folder: ${dirErr.message}`);
  }

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const items = files
    .map(
      (file) => `
      <div class="picture-item">
        <a href="/MeterSpec/pictures/${encodeURIComponent(file)}" target="_blank">
          <img src="/MeterSpec/pictures/${encodeURIComponent(file)}" alt="${escapeHtml(file)}" />
        </a>
        <div class="picture-name">${escapeHtml(file)}</div>
        <button type="button" class="ai-read-button" data-file="${escapeHtml(file)}">AI-аар унших</button>
        <p class="picture-status" hidden></p>
      </div>`
    )
    .join('');

  res.send(`<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MeterSpec/pictures</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; padding: 24px; margin: 0; background: #f8fafc; color: #0f172a; }
    h1 { margin-top: 0; }
    .note { margin-bottom: 14px; color: #475569; }
    .engine-toggle { display: inline-flex; border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; margin-bottom: 20px; }
    .engine-toggle button { border: none; background: #fff; padding: 8px 16px; font-size: 0.85rem; cursor: pointer; color: #334155; }
    .engine-toggle button.active { background: #2563eb; color: #fff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px; }
    .picture-item { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06); padding-bottom: 10px; }
    .picture-item a { color: inherit; text-decoration: none; display: block; }
    .picture-item img { width: 100%; height: 160px; object-fit: cover; display: block; }
    .picture-name { padding: 10px 12px 4px; font-size: 0.85rem; line-height: 1.4; word-break: break-word; }
    .ai-read-button { margin: 4px 12px 0; padding: 6px 10px; font-size: 0.8rem; border-radius: 8px; border: 1px solid #2563eb; background: #eff6ff; color: #1d4ed8; cursor: pointer; }
    .ai-read-button:disabled { opacity: 0.6; cursor: default; }
    .picture-status { margin: 6px 12px 0; font-size: 0.78rem; color: #475569; }
    .picture-status.status-success { color: #065f46; }
    .picture-status.status-error { color: #b91c1c; }
    .empty { color: #64748b; font-size: 0.95rem; }
  </style>
</head>
<body>
  <h1>MeterSpec/pictures</h1>
  <p class="note">Тоолуурын загварт бөглөх зургаа сонгоод "AI-аар унших" дарна уу — үр дүнг үндсэн цонхонд автоматаар илгээнэ.</p>
  <div class="engine-toggle" id="engineToggle">
    <button type="button" data-engine="cloud" class="active">Cloud (Claude)</button>
    <button type="button" data-engine="offline">Offline (Ollama)</button>
  </div>
  ${items.length > 0 ? `<div class="grid">${items}</div>` : '<p class="empty">pictures фолдерт зураг олдсонгүй.</p>'}
  <script>
    let aiEngine = localStorage.getItem('meterModelAiEngine') === 'offline' ? 'offline' : 'cloud';

    const toggle = document.getElementById('engineToggle');
    function syncToggleUI() {
      toggle.querySelectorAll('button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.engine === aiEngine);
      });
    }
    syncToggleUI();
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-engine]');
      if (!btn) return;
      aiEngine = btn.dataset.engine;
      localStorage.setItem('meterModelAiEngine', aiEngine);
      syncToggleUI();
    });

    document.querySelectorAll('.ai-read-button').forEach((button) => {
      button.addEventListener('click', async () => {
        const fileName = button.dataset.file;
        const card = button.closest('.picture-item');
        const statusEl = card.querySelector('.picture-status');

        button.disabled = true;
        statusEl.hidden = false;
        statusEl.className = 'picture-status';
        statusEl.textContent = 'AI-аар уншиж байна...';

        try {
          const response = await fetch('/api/meter-types/extract-photo', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName, engine: aiEngine }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.message || 'Зураг уншихад алдаа гарлаа.');
          }

          statusEl.className = 'picture-status status-success';
          statusEl.textContent = 'Уншлаа. Үндсэн цонхонд илгээлээ.';

          if (window.opener) {
            window.opener.postMessage(
              { type: 'ai-meter-photo-extracted', fields: data.fields || {}, engine: data.engine || aiEngine, fileName },
              window.location.origin
            );
          } else {
            statusEl.textContent += ' (Анхаар: энэ таб-ыг үндсэн цонхноос нээгээгүй тул үр дүнг илгээх боломжгүй.)';
          }
        } catch (error) {
          statusEl.className = 'picture-status status-error';
          statusEl.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
    });
  </script>
</body>
</html>`);
});

app.post('/api/meter-types/extract-photo', ensureAuthenticated, async (req, res) => {
  const { fileName, fileData, mediaType, engine } = req.body || {};
  const useOffline = engine === 'offline';

  let client;
  if (!useOffline) {
    try {
      client = getAnthropicClient();
    } catch (keyErr) {
      return res.status(400).json({ success: false, message: keyErr.message });
    }
  }

  if (!fileName || typeof fileName !== 'string') {
    return res.status(400).json({ success: false, message: 'Зургийн файлын нэр ирээгүй байна.' });
  }

  const safeName = path.basename(fileName);
  const ext = path.extname(safeName).toLowerCase();
  if (safeName !== fileName || !PICTURE_EXTENSIONS.includes(ext)) {
    return res.status(400).json({ success: false, message: 'Зургийн файлын нэр буруу байна.' });
  }

  let imageBase64;
  let resolvedMediaType = mediaType;

  if (fileData && typeof fileData === 'string') {
    if (fileData.length > MAX_EXTRACT_BASE64_LENGTH) {
      return res.status(400).json({ success: false, message: 'Зураг файлын хэмжээ хэтэрхий том байна.' });
    }
    imageBase64 = fileData.includes(',') ? fileData.split(',').pop() : fileData;
    if (!resolvedMediaType) {
      resolvedMediaType = PICTURE_MEDIA_TYPES[ext] || 'image/jpeg';
    }
  } else {
    const filePath = path.join(picturesDir, safeName);
    if (!filePath.startsWith(picturesDir + path.sep) || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'pictures фолдерт тухайн зураг олдсонгүй.' });
    }

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_EXTRACT_BASE64_LENGTH) {
        return res.status(400).json({ success: false, message: 'Зураг файлын хэмжээ хэтэрхий том байна.' });
      }

      imageBase64 = fs.readFileSync(filePath).toString('base64');
      resolvedMediaType = PICTURE_MEDIA_TYPES[ext] || 'image/jpeg';
    } catch (err) {
      return res.status(500).json({ success: false, message: `pictures фолдероос зураг уншихад алдаа гарлаа: ${err.message}` });
    }
  }

  try {
    const fields = useOffline
      ? await extractMeterModelFieldsFromPhotoOllama(imageBase64)
      : await extractMeterModelFieldsFromPhoto(client, imageBase64, resolvedMediaType);
    if (!fields) {
      return res.json({ success: false, message: 'Зургаас мэдээлэл гаргаж чадсангүй.' });
    }
    res.json({ success: true, fields, engine: useOffline ? 'offline' : 'cloud' });
  } catch (extractErr) {
    console.error(`Photo field extraction failed for ${safeName}:`, extractErr.message);
    res.status(500).json({ success: false, message: `Зураг уншихад алдаа гарлаа: ${extractErr.message}` });
  }
});

app.post('/api/meter-types/refresh-from-datasheets', ensureAuthenticated, async (req, res) => {
  const { engine } = req.body || {};
  const useOffline = engine === 'offline';

  let client;
  if (!useOffline) {
    try {
      client = getAnthropicClient();
    } catch (keyErr) {
      return res.status(400).json({ success: false, message: keyErr.message });
    }
  }

  let datasheetFiles;
  try {
    datasheetFiles = fs.readdirSync(datasheetDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  } catch (dirErr) {
    return res.status(500).json({ success: false, message: `MeterSpec/datasheet фолдер уншихад алдаа гарлаа: ${dirErr.message}` });
  }

  let pictureFiles;
  try {
    pictureFiles = fs
      .readdirSync(picturesDir)
      .filter((f) => PICTURE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
  } catch (dirErr) {
    return res.status(500).json({ success: false, message: `pictures фолдер уншихад алдаа гарлаа: ${dirErr.message}` });
  }

  if (datasheetFiles.length === 0 && pictureFiles.length === 0) {
    return res.json({
      success: true,
      processed: 0,
      results: [],
      message: 'MeterSpec/datasheet болон pictures фолдерт файл олдсонгүй.',
    });
  }

  // Stream newline-delimited JSON progress events as each file finishes, so
  // the client can show a live progress bar instead of waiting on one big
  // response — a batch can take minutes, especially in offline (Ollama) mode.
  res.setHeader('Content-Type', 'application/x-ndjson');
  const total = datasheetFiles.length + pictureFiles.length;
  let current = 0;
  const sendEvent = (event) => res.write(`${JSON.stringify(event)}\n`);

  dbClient.all(
    'SELECT id, brand, model, manufacturer, type, quantity, phase, meter_type, standard, data_transmission FROM meter_types ORDER BY id',
    async (err, rows) => {
      if (err) {
        console.error('Meter types query failed:', err.message);
        sendEvent({ type: 'error', message: 'Серверийн алдаа.' });
        return res.end();
      }

      const catalog = rows.map(mapMeterType);
      const results = [];

      const applyExtraction = async (file, source, extracted) => {
        if (!extracted || extracted.matchedId == null) {
          results.push({ file, source, matched: false });
          return;
        }

        const existing = catalog.find((c) => c.id === extracted.matchedId);
        if (!existing) {
          results.push({ file, source, matched: false, reason: 'matchedId олдсонгүй' });
          return;
        }

        const merged = {
          brand: extracted.brand || existing.brand,
          model: extracted.model || existing.model,
          manufacturer: extracted.manufacturer || existing.manufacturer,
          type: extracted.type || existing.type,
          phase: extracted.phase || existing.phase,
          meterType: extracted.meterType || existing.meterType,
          standard: extracted.standard || existing.standard,
          dataTransmission: extracted.dataTransmission || existing.dataTransmission,
        };

        await new Promise((resolve, reject) => {
          dbClient.run(
            `UPDATE meter_types SET brand = ?, model = ?, manufacturer = ?, type = ?, phase = ?, meter_type = ?, standard = ?, data_transmission = ? WHERE id = ?`,
            [merged.brand, merged.model, merged.manufacturer, merged.type, merged.phase, merged.meterType, merged.standard, merged.dataTransmission, existing.id],
            (updateErr) => (updateErr ? reject(updateErr) : resolve())
          );
        });

        results.push({ file, source, matched: true, meterTypeId: existing.id, brand: merged.brand });
      };

      if (useOffline && datasheetFiles.length > 0) {
        // Offline engine can't read PDFs; skip them but say so in the results.
        for (const file of datasheetFiles) {
          results.push({ file, source: 'datasheet', matched: false, reason: 'PDF offline горимд дэмжигдэхгүй' });
          current += 1;
          sendEvent({ type: 'progress', current, total, file, source: 'datasheet' });
        }
      } else {
        for (const file of datasheetFiles) {
          try {
            const pdfBase64 = fs.readFileSync(path.join(datasheetDir, file)).toString('base64');
            const extracted = await extractMeterModelFromDatasheet(client, pdfBase64, catalog);
            await applyExtraction(file, 'datasheet', extracted);
          } catch (fileErr) {
            console.error(`Datasheet processing failed for ${file}:`, fileErr.message);
            results.push({ file, source: 'datasheet', matched: false, error: fileErr.message });
          }
          current += 1;
          sendEvent({ type: 'progress', current, total, file, source: 'datasheet' });
        }
      }

      for (const file of pictureFiles) {
        try {
          const imageBase64 = fs.readFileSync(path.join(picturesDir, file)).toString('base64');
          let extracted;
          if (useOffline) {
            extracted = await extractMeterModelFromPhotoOllama(imageBase64, catalog);
          } else {
            const ext = path.extname(file).toLowerCase();
            const mediaType = PICTURE_MEDIA_TYPES[ext] || 'image/jpeg';
            extracted = await extractMeterModelFromPhoto(client, imageBase64, mediaType, catalog);
          }
          await applyExtraction(file, 'photo', extracted);
        } catch (fileErr) {
          console.error(`Photo processing failed for ${file}:`, fileErr.message);
          results.push({ file, source: 'photo', matched: false, error: fileErr.message });
        }
        current += 1;
        sendEvent({ type: 'progress', current, total, file, source: 'photo' });
      }

      sendEvent({ type: 'done', success: true, processed: total, results, engine: useOffline ? 'offline' : 'cloud' });
      res.end();
    }
  );
});

app.get('/api/profile', ensureAuthenticated, (req, res) => {
  const { user } = req.session;
  console.log('Profile requested, session user=', user);
  res.json({ success: true, username: user.username || user.email, name: user.name, provider: user.provider });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Оролдлого хэт олон удаа амжилтгүй боллоо. Дараа дахин оролдоно уу.' },
});

app.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Бүх талбарыг бөглөнө үү.' });
  }

  // Special-case local admin credentials
  if (username === 'admin' && password === 'admin') {
    req.session.user = {
      provider: 'local',
      username: 'admin',
      name: 'Administrator',
    };

    // Ensure admin user exists in the underlying database for compatibility
    dbClient.run(
      'INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)',
      ['admin', 'admin'],
      (insertErr) => {
        if (insertErr) console.error('Failed to ensure admin user in sqlite:', insertErr.message);
      }
    );

    return req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Session save failed:', saveErr.message);
        return res.status(500).json({ success: false, message: 'Сесс хадгалах алдаа.' });
      }
      return res.json({ success: true, message: `Сайн байна уу, admin!` });
    });
  }

  dbClient.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
    if (err) {
      console.error('Login query failed:', err.message);
      return res.status(500).json({ success: false, message: 'Серверийн алдаа.' });
    }

    if (row) {
      req.session.user = {
        provider: 'local',
        username: row.username,
        name: row.username,
      };
      return req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Session save failed:', saveErr.message);
          return res.status(500).json({ success: false, message: 'Сесс хадгалах алдаа.' });
        }
        return res.json({ success: true, message: `Сайн байна уу, ${username}!` });
      });
    }

    return res.status(401).json({ success: false, message: 'Нэвтрэх нэр эсвэл нууц үг буруу байна.' });
  });
});

initDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error('Database initialization failed:', err.message);
    process.exit(1);
  });
