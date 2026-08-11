// Imports the real Ukhaa Khudag electrical network hierarchy (from
// UHG_Tree_Diagram_Expanded.pdf) as `asset` rows, and links the meters that
// already carry a matching real `facility` value (customer_meter.facility,
// from the original Цэций хороолол import) to the correct node in this
// tree -- so the existing Мод tree view shows the real substation/feeder
// names instead of the placeholder "Тодорхойгүй" bucket for those meters.
//
// Station-tier nodes reuse the existing asset_type 'SUBSTATION' (so the
// recursive substation lookup below and the current Мод/Холбох-цэг tree
// views work unchanged). Every group/feeder/transformer row underneath is
// asset_type 'NETWORK_ELEMENT' (a new type, generic across depths -- the
// tree structure itself encodes group-vs-leaf, no separate type needed).
//
// A handful of real facility values on existing meters (ХТП-4, "10кВ Кемп
// гаргалгаа") have no matching row in the source PDF; they're added as
// clearly-labelled leaves alongside their siblings (ХТП-1/ХТП-2) since the
// meters that reference them are real, even though this specific PDF
// revision doesn't detail them.
//
// Usage: node scripts/import-network-tree.js [--commit]
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '..', 'smartmeter.db');

function leaf(name, opts = {}) {
  return { name, kind: 'leaf', ...opts };
}
function group(name, children) {
  return { name, kind: 'group', children };
}
function station(name, children, opts = {}) {
  return { name, kind: 'station', children, ...opts };
}

const TREE = station('220/110/35/10 кВ ТТ ДС', [
  group('10 кВ гаргалгаанууд', [
    leaf('SG Coal', { code: 'T-181', cable: 'T-181', transformer: 'АТП', capacity: '400 кВА' }),
    leaf('Баруун наран кемп', { code: 'T-181-2', cable: 'T-181', transformer: 'АТП-2', capacity: '630 кВА' }),
    leaf('Баруун наран кемп (2)', { code: 'T-68', cable: 'T-68', transformer: 'АТП-2', capacity: '630 кВА' }),
    leaf('Урд пост №91', { code: 'T-32', cable: 'T-32', transformer: 'АТП-1', capacity: '50 кВА' }),
    leaf('Баруун наран харуулын байр', { code: 'T-227', cable: 'T-227', transformer: 'АТП-3', capacity: '50 кВА' }),
    leaf('Баруун наран уурхай', { code: 'T-237', cable: 'T-237', transformer: 'АТП-4', capacity: '630 кВА' }),
  ]),
  station('110/35/10 кВ Ухаа Худаг ДС', [
    group('10 кВ Секц-1/Секц-2 (Т-1,Т-2 — 25 МВА)', [
      leaf('Баруун наран'), leaf('Баяжуулах-3'), leaf('Ус хангамж-А'), leaf('ROM-3'),
      leaf('Обоолго'), leaf('Халаалтын зуух'), leaf('Баяжуулах-1'), leaf('Оролт 1'),
      leaf('XT-1'), leaf('СХС'), leaf('СХВТ'), leaf('XT-2'), leaf('Оролт 2'),
      leaf('Ус хангамж-Б'), leaf('Хаягдлын ус цуулах'), leaf('Баяжуулах-2'),
      leaf('Бэлтгэл'), leaf('Түүхий нүүрс'), leaf('Эрдэсийн усан сан'),
    ]),
    group('35/0.4 кВ Баяжуулах-1', [
      leaf('ТП401', { code: 'ТП401', cable: 'HXLPSWA-3*240', transformer: 'ТП401', capacity: '3 МВА' }),
      leaf('ТП402', { code: 'ТП402', cable: 'HXLPSWA-3*240', transformer: 'ТП402', capacity: '3 МВА' }),
      leaf('ТП404', { code: 'ТП404', cable: 'HXLPSWA-3*240', transformer: 'ТП404', capacity: '1 МВА' }),
      leaf('НБУ-2 (Бэлтгэл тэжээл)', { cable: 'HXLPSWA-3*240', transformer: 'ХБ' }),
    ]),
    group('35/0.4 кВ Баяжуулах-2', [
      leaf('ТП424', { code: 'ТП424', cable: 'HXLPSWA-3*240', transformer: 'ТП424', capacity: '1 МВА' }),
      leaf('ТП422', { code: 'ТП422', cable: 'HXLPSWA-3*240', transformer: 'ТП422', capacity: '3 МВА' }),
      leaf('ТП421', { code: 'ТП421', cable: 'HXLPSWA-3*240', transformer: 'ТП421', capacity: '3 МВА' }),
      leaf('НБУ-1 (Бэлтгэл тэжээл)', { cable: 'HXLPSWA-3*240', transformer: 'ХБ' }),
    ]),
    group('35/0.4 кВ Баяжуулах-3', [
      leaf('ТП444', { code: 'ТП444', transformer: 'ТП444', capacity: '1 МВА' }),
      leaf('ТП442', { code: 'ТП442', transformer: 'ТП442', capacity: '3 МВА' }),
      leaf('ТП441', { code: 'ТП441', transformer: 'ТП441', capacity: '3 МВА' }),
      leaf('ROM-III (Бэлтгэл)', { transformer: 'ROM-III' }),
    ]),
    group('35/0.4 кВ ROM-3', [
      leaf('ROM-3 ТП', { code: 'H003', transformer: 'H003', capacity: '2 МВА' }),
      leaf('НБУ-3 (Бэлтгэл тэжээл)', { transformer: 'ХБ' }),
    ]),
    group('35/0.4 кВ Халаалтын зуух', [
      leaf('ТП903', { code: 'ТП903', cable: 'HXLPSWA-3*240', transformer: 'ТП903', capacity: '0.5 МВА' }),
    ]),
    group('35/0.4 кВ Обоолго', [
      leaf('ТП801', { code: 'ТП801', cable: 'HXLPSWA-3*240', transformer: 'ТП801', capacity: '3 МВА' }),
    ]),
    group('35/0.4 кВ Түүхий хэсэн-I/II', [
      leaf('ТП101', { code: 'ТП101', cable: 'HXLPSWA-3*240', transformer: 'ТП101', capacity: 'баталгаажуулах' }),
    ]),
    group('10 кВ бусбар-2 (Юбон/Дизель/Урхай)', [
      leaf('Юбоны 12-р үрдэн', { transformer: 'ХБ-15' }),
      leaf('Дизель станц-2'), leaf('Урхай'), leaf('Кемп'), leaf('Ширүүлэх'),
      leaf('Холбооны шудам', { transformer: 'ХБ-1А' }),
    ]),
    group('10 кВ-ын ХБ-1 / Дизель станц-1', [
      leaf('ДГ-1', { transformer: 'Дизель генератор', capacity: '2 МВт' }),
      leaf('ДГ-2', { transformer: 'Дизель генератор', capacity: '2 МВт' }),
      leaf('ДГ-3', { transformer: 'Дизель генератор', capacity: '2 МВт' }),
    ]),
    group('Ухаа Худагийн цахилгаан станц', [
      leaf('ХТ-1', { transformer: 'XT-1' }),
      leaf('ТГ-1 / Т-1', { transformer: 'ТГ-1/Т-1', capacity: '6 МВт / 1.6 МВА' }),
      leaf('ТГ-2 / Т-2', { transformer: 'ТГ-2/Т-2', capacity: '6 МВт / 1.6 МВА' }),
      leaf('Т-0 + ДГ', { transformer: 'Т-0+ДГ', capacity: '1.6 МВА + 1.2 МВт' }),
      leaf('ТГ-3 / Т-3', { transformer: 'ТГ-3/Т-3', capacity: '6 МВт / 1.6 МВА' }),
      leaf('Т-4', { transformer: 'Т-4', capacity: '0.8 МВА' }),
      leaf('ХТ-3', { transformer: 'XT-3' }),
      leaf('Холбооны 12-р шудам', { cable: 'HXLPPVC-3x(1x400)', transformer: 'ХБ' }),
    ]),
    group('10 кВ бусбар (К- зангилаа бүлэг)', [
      leaf('Төв лаборатори', { code: 'КТПН-09', cable: 'AC-70/10', transformer: 'КТПН-09', capacity: '400 кВА' }),
      leaf('Химийн бодисын агуулах', { code: 'КТПН-07', cable: 'AC-70/10', transformer: 'КТПН-07', capacity: '250 кВА' }),
      leaf('Мадаа уулын усан сан', { code: 'КТПН-10', cable: 'AC-70/10', transformer: 'КТПН-10', capacity: '25 кВА' }),
      leaf('RR кемп', { code: 'КТПН-11', cable: 'AC-70/10', transformer: 'КТПН-11', capacity: '400 кВА' }),
      leaf('Тэв пост №1', { code: 'КТПН-12', transformer: 'КТПН-12', capacity: '100 кВА' }),
      leaf('Цомхоз-1', { code: 'КТПН-03', transformer: 'КТПН-03', capacity: '25 кВА' }),
      leaf('Хөхөд констракшн', { code: 'КТПН-44', transformer: 'КТПН-44', capacity: '63 кВА' }),
      leaf('Паблик', { code: 'КТПН-08', transformer: 'КТПН-08', capacity: '250 кВА' }),
      leaf('Шинэ цэврэм / Боомт', { code: 'КТПН-40', transformer: 'КТПН-40', capacity: '250 кВА' }),
      leaf('Балласт', { capacity: '250 кВА' }),
      leaf('Хилл партс', { capacity: '400 кВА' }),
      leaf('Ундэн уул', { capacity: '250 кВА' }),
      leaf('Ургахочин', { code: 'КТПН-13', transformer: 'КТПН-13', capacity: '160 кВА' }),
      leaf('Тум арвайжих', { code: 'КТПН-37', transformer: 'КТПН-37', capacity: '160 кВА' }),
      leaf('Цамхаг-2', { code: 'КТПН-05', transformer: 'КТПН-05', capacity: '25 кВА' }),
      leaf('Толгойт Бластинг', { capacity: '630 кВА' }),
      leaf('Хаягдалын усцуулах', { code: 'КТПН-06', transformer: 'КТПН-06', capacity: '250 кВА' }),
      leaf('Гальан насос станц', { code: 'КТПН-04', transformer: 'КТПН-04', capacity: '1000 кВА' }),
      leaf('Бетон зуурмаг', { code: 'КТПН-45', transformer: 'КТПН-45', capacity: '250 кВА' }),
      leaf('Сайкрит стар', { capacity: '250 кВА' }),
      leaf('Петровис агуулах', { capacity: '250 кВА' }),
      leaf('МТ ШТ станц', { capacity: '160 кВА' }),
      leaf('ДГ-2 (нөөц)', { capacity: '0.16 МВт' }),
      leaf('Хишиг Овл', { capacity: '63 кВА · шинэ хэрэглэгч' }),
      leaf('ER кемп-1', { code: 'КТПН-14', transformer: 'КТПН-14', capacity: '630 кВА' }),
      leaf('ER кемп-2', { code: 'КТПН-15', transformer: 'КТПН-15', capacity: '630 кВА' }),
    ]),
    group('10 кВ-ын ХБ-2', [
      leaf('Цэвэрлэх байгууламж', { code: 'КТПН-01', transformer: 'КТПН-01', capacity: '63 кВА' }),
      leaf('Уурхайн засварын төв I/II', { code: 'КТПН-02', transformer: 'КТПН-02', capacity: '2500 кВА' }),
      leaf('Симулятор (Оролт)', { code: 'КТПН-36', transformer: 'КТПН-36', capacity: '30 кВА' }),
    ]),
    group('10 кВ бусбар (Т- зангилаа бүлэг)', [
      leaf('Мижигдорж', { capacity: '30 кВА' }),
      leaf('Говийн шареал тэмээ', { capacity: '160 кВА' }),
      leaf('Тэс Петролиум', { capacity: '100 кВА' }),
      leaf('Ар Ар Консалтинг', { capacity: '100 кВА' }),
      leaf('Буянтогтох', { capacity: '30 кВА' }),
      leaf('Түмэн төмөрт', { capacity: '160 кВА' }),
      leaf('Тронсдэв', { code: 'КТПН-47', transformer: 'КТПН-47', capacity: '400 кВА' }),
      leaf('Тос цанцах теч', { capacity: '100 кВА' }),
      leaf('ER ШТС', { code: 'КТПН-42', transformer: 'КТПН-42', capacity: '160 кВА' }),
      leaf('Терминал', { code: 'КТПН-38', transformer: 'КТПН-38', capacity: '160 кВА' }),
      leaf('НАБТ', { code: 'КТПН-35', transformer: 'КТПН-35', capacity: '160 кВА' }),
      leaf('Цэнзэлэгч телефонж', { capacity: '1000 кВА' }),
    ]),
    group('КТПГ-58 (Өрөвх-2)', [
      leaf('Өрөвх-2 (Т-1)', { code: 'КТПГ-58/Т-1', cable: 'АБЛӨ-3*70', transformer: 'КТПГ-58/Т-1', capacity: '630 кВА' }),
      leaf('Өрөвх-2 (Т-2)', { code: 'КТПГ-58/Т-2', cable: 'АБЛӨ-3*70', transformer: 'КТПГ-58/Т-2', capacity: '630 кВА' }),
    ]),
    group('10 кВ бусбар (Худгаз бүлэг)', [
      leaf('Худгаз-9', { code: 'КТПН-65', transformer: 'КТПН-65', capacity: '63 кВА' }),
      leaf('Худгаз-11', { code: 'КТПН-66', transformer: 'КТПН-66', capacity: '63 кВА' }),
      leaf('Худгаз-13', { code: 'КТПН-67', transformer: 'КТПН-67', capacity: '63 кВА' }),
    ]),
  ], { facilityAliases: ['Ухаа Худаг дэд станц'] }),
  station('35/10 кВ Ус хангамж ДС', [
    group('Т-1, Т-2 трансформатор', [
      leaf('Т-1, Т-2 (1 МВА тус бүр)', { cable: 'LGJ-70/10 (8 км) x2', transformer: 'Т-1,Т-2', capacity: '1 МВА' }),
    ]),
    group('35/10 кВ гаргалгаанууд', [
      leaf('Өрөвх-4', { code: 'КТПН-54', transformer: 'КТПН-54', capacity: '63 кВА' }),
      leaf('Өрөвх-1', { code: 'КТПН-17', transformer: 'КТПН-17', capacity: '630 кВА' }),
      leaf('Худгийн С'), leaf('Худгийн В'), leaf('Худгийн А'),
      leaf('Өрөвх-1 (2)', { code: 'КТПН-18', transformer: 'КТПН-18', capacity: '400 кВА' }),
      leaf('Өрөвх-4 (2)', { code: 'КТПН-53', transformer: 'КТПН-53', capacity: '630 кВА' }),
    ]),
    group('10 кВ гаргалгаанууд (YJLV-10kV 3*120)', [
      leaf('Цамхаг-3', { code: 'КТПН-39', transformer: 'КТПН-39', capacity: '25 кВА' }),
      leaf('Худгаз-1', { code: 'КТПН-27', transformer: 'КТПН-27', capacity: '40 кВА' }),
      leaf('Худгаз-3', { code: 'КТПН-28', transformer: 'КТПН-28', capacity: '63 кВА' }),
      leaf('Худгаз-6', { code: 'КТПН-26', transformer: 'КТПН-26', capacity: '40 кВА' }),
      leaf('Худгаз-4', { code: 'КТПН-23', transformer: 'КТПН-23', capacity: '100 кВА' }),
      leaf('Оюн зурвас', { code: 'КТПН-16', transformer: 'КТПН-16', capacity: '25 кВА' }),
      leaf('Оюн зурвас-2', { code: 'КТПН-41', transformer: 'КТПН-41', capacity: '63 кВА' }),
      leaf('Худгаз-5', { code: 'КТПН-30', transformer: 'КТПН-30', capacity: '25 кВА' }),
      leaf('Худгаз-7', { code: 'КТПН-19', transformer: 'КТПН-19', capacity: '63 кВА' }),
      leaf('Худгаз-9 (2)', { code: 'КТПН-20', transformer: 'КТПН-20', capacity: '100 кВА' }),
    ]),
  ]),
  station('35/10 кВ Хотхон ДС', [
    group('Т-1, Т-2 трансформатор', [
      leaf('Т-1, Т-2 (4 МВА тус бүр)', { cable: 'LGJ-95/10 (6.25 км)', transformer: 'Т-1,Т-2', capacity: '4 МВА' }),
    ]),
    group('10 кВ гаргалгаанууд', [
      leaf('Оролт 1'), leaf('XT-1'), leaf('Цэвэр хороолол-1'), leaf('Бэлтгэл'),
      leaf('Цэвэр зуух'), leaf('Бэлтгэл (2)'), leaf('Бэлтгэл (3)'), leaf('СХС'), leaf('СХВТ'), leaf('Нисэх'),
      leaf('Ажилчдын хороолол-1', {
        code: 'ХТП-1', transformer: 'ХТП-1/КТПН-32', capacity: '2x800 кВА / 250 кВА',
        facilityAliases: ['ХТП-1'],
      }),
      leaf('Ажилчдын хороолол-2', {
        code: 'ХТП-2', transformer: 'ХТП-2', capacity: '2x800 кВА',
        facilityAliases: ['ХТП-2'],
      }),
      leaf('Цэвэр хороолол-2'), leaf('ER кемп'), leaf('XT-2'),
      // Not in this PDF revision, but real meters carry these facility
      // values -- added alongside their ХТП-1/ХТП-2 siblings rather than
      // left in the "Тодорхойгүй" bucket.
      leaf('ХТП-4 (эх сурвалжид дэлгэрэнгүй үзүүлээгүй)', { code: 'ХТП-4', facilityAliases: ['ХТП-4'] }),
      leaf('10кВ Кемп гаргалгаа', { facilityAliases: ['10кВ Кемп гаргалгаа'] }),
    ]),
    group('10 кВ бусбар (Худгаз бүлэг)', [
      leaf('Худгаз-14', { code: 'КТПН-59', transformer: 'КТПН-59', capacity: '63 кВА' }),
      leaf('Худгаз-7 (2)', { code: 'КТПН-60', transformer: 'КТПН-60', capacity: '63 кВА' }),
      leaf('Худгаз-5 (2)', { code: 'КТПН-61', transformer: 'КТПН-61', capacity: '63 кВА' }),
      leaf('Худгаз-12', { code: 'КТПН-62', transformer: 'КТПН-62', capacity: '63 кВА' }),
      leaf('Худгаз-4 (2)', { code: 'КТПН-63', transformer: 'КТПН-63', capacity: '63 кВА' }),
      leaf('Худгаз-10', { code: 'КТПН-64', transformer: 'КТПН-64', capacity: '63 кВА' }),
      leaf('Худгаз-15', { code: 'КТПН-68', transformer: 'КТПН-68', capacity: '63 кВА' }),
    ]),
  ], { facilityAliases: ['Хотхон дэд станц'] }),
  station('35/10 кВ Наймдай-2 ДС', [
    group('Т-1, Т-2 трансформатор', [
      leaf('Т-1, Т-2 (1 МВА тус бүр)', { cable: 'LGJ-70/10', transformer: 'Т-1,Т-2', capacity: '1 МВА' }),
    ]),
    group('10 кВ гаргалгаанууд', [
      leaf('Оролт-1'), leaf('Ажилчин байр'), leaf('Өрөвх-2 (Т-1)'), leaf('Усны шугам-А'),
      leaf('СХВТ'), leaf('СХС'), leaf('Усны шугам-Б'), leaf('Өрөвх-2 (Т-2)'), leaf('Бэлтгэл'), leaf('Оролт-2'),
      leaf('Худгаз-14 (2)', { code: 'КТПН-57', transformer: 'КТПН-57', capacity: '100 кВА' }),
    ]),
  ]),
  station('35/10 кВ Наймдай-3 ДС', [
    group('Т-1, Т-2 трансформатор', [
      leaf('Т-1, Т-2 (1 МВА тус бүр)', { transformer: 'Т-1,Т-2', capacity: '1 МВА' }),
    ]),
    group('10 кВ гаргалгаанууд', [
      leaf('Оролт 1 (ДХТ-1)'), leaf('Ажилчин байр (XT-2)'), leaf('Өрөвх-3'), leaf('Бэлтгэл (XT-1)'),
      leaf('СХС'), leaf('СХВТ'), leaf('Өрөвх-4'), leaf('Оролт 2 (ДХТ-2)'),
    ]),
    group('10 кВ бусбар (Худгаз бүлэг, YJLV22-10kV)', [
      leaf('Худгаз-2', { code: 'КТПН-25', transformer: 'КТПН-25', capacity: '100 кВА' }),
      leaf('Худгаз-12 (2)', { code: 'КТПН-24', transformer: 'КТПН-24', capacity: '63 кВА' }),
      leaf('Худгаз-11', { code: 'КТПН-21', transformer: 'КТПН-21', capacity: '100 кВА' }),
      leaf('Худгаз-10 (2)', { code: 'КТПН-22', transformer: 'КТПН-22', capacity: '100 кВА' }),
      leaf('Өрөвх-3 (2)', { code: 'КТПН-55', transformer: 'КТПН-55', capacity: '630 кВА' }),
      leaf('Өрөвх-3 (3)', { code: 'КТПН-56', transformer: 'КТПН-56', capacity: '630 кВА' }),
    ]),
  ]),
]);

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
  const db = new sqlite3.Database(DB_PATH);

  const columns = await dbAll(db, 'PRAGMA table_info(asset)');
  if (!columns.some((c) => c.name === 'metadata')) {
    if (commit) await dbRun(db, 'ALTER TABLE asset ADD COLUMN metadata TEXT');
  }

  await dbRun(db, 'INSERT OR IGNORE INTO asset_type (code, name) VALUES (?, ?)', ['NETWORK_ELEMENT', 'Сүлжээний элемент']).catch(() => {});
  const substationTypeRow = await dbGet(db, "SELECT id FROM asset_type WHERE code = 'SUBSTATION'");
  const elementTypeRow = commit
    ? await dbGet(db, "SELECT id FROM asset_type WHERE code = 'NETWORK_ELEMENT'")
    : { id: -1 };

  const orgRow =
    (await dbGet(db, "SELECT id FROM organization WHERE name = 'М СИ ЭС ИНТЕРНЭЙШНЛ'")) ||
    (await dbGet(db, 'SELECT id FROM organization ORDER BY id LIMIT 1'));
  const orgId = orgRow.id;

  const facilityMatches = []; // { facility, assetId (filled after insert) }
  let counts = { station: 0, group: 0, leaf: 0 };

  async function insertNode(node, parentId) {
    counts[node.kind] += 1;
    if (!commit) {
      (node.children || []).forEach((c) => insertNode(c, null));
      return null;
    }

    const typeId = node.kind === 'station' ? substationTypeRow.id : elementTypeRow.id;
    const metadata = JSON.stringify({
      cable: node.cable || null,
      transformer: node.transformer || null,
      capacity: node.capacity || null,
    });
    const inserted = await dbRun(
      db,
      'INSERT INTO asset (organization_id, asset_type_id, parent_asset_id, code, name, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [orgId, typeId, parentId, node.code || node.name, node.name, 'active', metadata]
    );
    const assetId = inserted.lastID;

    if (node.facilityAliases) {
      for (const facility of node.facilityAliases) {
        facilityMatches.push({ facility, assetId, name: node.name });
      }
    }

    for (const child of node.children || []) {
      await insertNode(child, assetId);
    }
    return assetId;
  }

  await insertNode(TREE, null);

  console.log(`Tree nodes: ${counts.station} stations, ${counts.group} groups, ${counts.leaf} leaves.`);
  console.log(`Facility-matched nodes: ${facilityMatches.map((f) => f.facility).join(', ')}`);

  if (!commit) {
    console.log('\nDry run only -- rerun with --commit to insert and link meters.');
    db.close();
    return;
  }

  // Link every meter whose real facility matches one of these nodes: point
  // its active meter_dcu/meter_connection rows at the matched asset (a
  // data-quality correction, not a real-world reassignment event, so this
  // updates the existing active rows in place rather than historizing).
  let linkedMeters = 0;
  for (const { facility, assetId, name } of facilityMatches) {
    // A connection_point row is needed for meter_connection's FK-ish target.
    const existingCp = await dbGet(db, 'SELECT asset_id FROM connection_point WHERE asset_id = ?', [assetId]);
    if (!existingCp) {
      await dbRun(db, 'INSERT INTO connection_point (asset_id, cabinet_code) VALUES (?, ?)', [assetId, name]);
    }

    const meterIds = await dbAll(
      db,
      `SELECT m.id FROM meter m
       JOIN customer_meter cm ON cm.meter_id = m.id AND cm.linked_to IS NULL
       WHERE cm.facility = ?`,
      [facility]
    );

    for (const { id: meterId } of meterIds) {
      await dbRun(db, 'UPDATE meter SET parent_asset_id = ? WHERE id = ?', [assetId, meterId]);

      const existingDcu = await dbGet(db, 'SELECT id FROM meter_dcu WHERE meter_id = ? AND connected_to IS NULL', [meterId]);
      if (existingDcu) {
        await dbRun(db, 'UPDATE meter_dcu SET dcu_id = ? WHERE id = ?', [assetId, existingDcu.id]);
      } else {
        await dbRun(db, 'INSERT INTO meter_dcu (meter_id, dcu_id, connected_to) VALUES (?, ?, NULL)', [meterId, assetId]);
      }

      const existingConn = await dbGet(db, 'SELECT id FROM meter_connection WHERE meter_id = ? AND connected_to IS NULL', [meterId]);
      if (existingConn) {
        await dbRun(db, 'UPDATE meter_connection SET connection_point_id = ? WHERE id = ?', [assetId, existingConn.id]);
      } else {
        await dbRun(db, 'INSERT INTO meter_connection (meter_id, connection_point_id, connected_to) VALUES (?, ?, NULL)', [meterId, assetId]);
      }

      linkedMeters += 1;
    }
    console.log(`  ${facility} -> "${name}": ${meterIds.length} meters linked`);
  }

  console.log(`\nInserted network tree and linked ${linkedMeters} meters.`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
