// One-off test: send a real meter photo from MeterSpec/pictures to a local
// Ollama vision model and print what it extracts, so we can judge quality
// against the Claude-based extraction before deciding whether to wire this
// into server.js for real.
//
// Usage: node scripts/test-ollama-vision.js [fileName] [modelName]

const fs = require('fs');
const path = require('path');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const picturesDir = path.join(__dirname, '..', 'MeterSpec', 'pictures');

const PROMPT = `Энэ бол тоолуурын бодит гэрэл зураг (тоолуур дээрх шошго/nameplate байж болно).
Зурган дээр бодитоор тод харагдаж буй техникийн үзүүлэлтүүдийг гарга.
Зөвхөн зурган дээр бодитоор бичигдсэн, тод унших боломжтой мэдээллийг гарга;
тодорхойгүй эсвэл уншигдахгүй байгаа талбарыг null болго.

Дараах JSON бүтцээр ЗӨВХӨН JSON хариулт өг (өөр текст бүү нэм):
{
  "brand": string | null,
  "model": string | null,
  "manufacturer": string | null,
  "type": string | null,
  "phase": string | null,
  "meterType": string | null,
  "standard": string | null,
  "dataTransmission": string | null
}`;

async function main() {
  const fileArg = process.argv[2];
  const modelArg = process.argv[3] || 'qwen2.5vl:7b';

  const files = fs.readdirSync(picturesDir).filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f));
  if (files.length === 0) {
    console.error('MeterSpec/pictures фолдерт зураг олдсонгүй.');
    process.exit(1);
  }

  const fileName = fileArg || files[0];
  const filePath = path.join(picturesDir, fileName);
  if (!fs.existsSync(filePath)) {
    console.error(`Файл олдсонгүй: ${filePath}`);
    console.error(`Байгаа файлууд: ${files.join(', ')}`);
    process.exit(1);
  }

  const imageBase64 = fs.readFileSync(filePath).toString('base64');

  console.log(`Файл: ${fileName}`);
  console.log(`Загвар: ${modelArg}`);
  console.log('Ollama-д хүсэлт илгээж байна...\n');

  const started = Date.now();
  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelArg,
      messages: [
        {
          role: 'user',
          content: PROMPT,
          images: [imageBase64],
        },
      ],
      format: 'json',
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Ollama алдаа: ${response.status} ${text}`);
    process.exit(1);
  }

  const data = await response.json();
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`Хугацаа: ${elapsed}s\n`);
  console.log('--- Түүхий хариу (message.content) ---');
  console.log(data.message?.content);

  try {
    const parsed = JSON.parse(data.message.content);
    console.log('\n--- Задалсан талбарууд ---');
    console.log(JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log('\n(JSON.parse амжилтгүй боллоо:', e.message, ')');
  }
}

main().catch((err) => {
  console.error('Алдаа:', err);
  process.exit(1);
});
