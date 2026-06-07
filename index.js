'use strict';

// ╔══════════════════════════════════════════════════════════════╗
// ║          Simple Marketplace Bot  v8.0  ✨                   ║
// ║      ሲሚንቶ  ·  ብረት  ·  ማሽነሪ  ·  ትራክ                        ║
// ╚══════════════════════════════════════════════════════════════╝

const { Telegraf, Markup } = require('telegraf');
const http     = require('http');
const mongoose = require('mongoose');

// ──────────────────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────────────────
const BOT_TOKEN     = (process.env.BOT_TOKEN     || '').trim().replace(/['"]/g, '');
const MONGO_URI     =  process.env.MONGO_URI     || '';
const SUPPORT_PHONE =  process.env.SUPPORT_PHONE || '0960336138';
const ADMIN_IDS     = (process.env.ADMIN_IDS     || '7423347375')
                        .split(',').map(s => Number(s.trim()));
const PORT          = Number(process.env.PORT)   || 10000;
const RENDER_URL    =  process.env.RENDER_EXTERNAL_URL || '';

if (!BOT_TOKEN || !MONGO_URI) {
    console.error('❌  BOT_TOKEN ወይም MONGO_URI አልተገኘም!');
    process.exit(1);
}

// ──────────────────────────────────────────────────────────
// SECURITY — Rate limiter
// ──────────────────────────────────────────────────────────
const rateLimitMap = new Map();

function rateLimit(userId, maxPerMinute = 30) {
    const now = Date.now();
    let entry = rateLimitMap.get(userId);
    if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + 60_000 };
        rateLimitMap.set(userId, entry);
    }
    entry.count++;
    return entry.count > maxPerMinute;
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateLimitMap.entries())
        if (now > v.resetAt) rateLimitMap.delete(k);
}, 5 * 60 * 1000);

// ──────────────────────────────────────────────────────────
// SECURITY — Input sanitizer
// ──────────────────────────────────────────────────────────
const MAX_INPUT_LEN = 200;

function sanitize(input) {
    if (typeof input !== 'string') return '';
    return input
        .slice(0, MAX_INPUT_LEN)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/\$/g, '')
        .replace(/\{|\}/g, '')
        .trim();
}

function safePhone(p) {
    return sanitize(p).replace(/[^\d\s\+\-\(\)]/g, '').slice(0, 20);
}

function safePrice(text) {
    const price = parseFloat(String(text).replace(/,/g, '').replace(/[^\d.]/g, ''));
    if (isNaN(price) || price <= 0 || price > 10_000_000) return null;
    return price;
}

// ──────────────────────────────────────────────────────────
// SCHEMAS
// ──────────────────────────────────────────────────────────
const cementSchema = new mongoose.Schema({
    userId:      { type: Number, required: true, index: true },
    type:        { type: String, default: '' },
    location:    { type: String, default: '' },
    companyName: { type: String, default: '' },
    phone:       { type: String, default: '' },
    price:       { type: Number, default: 0 },
    status:      { type: String, default: 'active', enum: ['active', 'off'] },
    createdAt:   { type: Date,   default: Date.now }
});
cementSchema.index({ type: 1, location: 1, status: 1 });

const steelSchema = new mongoose.Schema({
    userId:    { type: Number, required: true, index: true },
    type:      { type: String, default: '' },
    address:   { type: String, default: '' },
    phone:     { type: String, default: '' },
    price:     { type: Number, default: 0 },
    status:    { type: String, default: 'active', enum: ['active', 'off'] },
    createdAt: { type: Date,   default: Date.now }
});
steelSchema.index({ type: 1, status: 1 });

const machinerySchema = new mongoose.Schema({
    userId:    { type: Number, required: true, index: true },
    type:      { type: String, default: '' },
    address:   { type: String, default: '' },
    phone:     { type: String, default: '' },
    price:     { type: Number, default: 0 },
    status:    { type: String, default: 'active', enum: ['active', 'off'] },
    createdAt: { type: Date,   default: Date.now }
});
machinerySchema.index({ type: 1, status: 1 });

const truckSchema = new mongoose.Schema({
    userId:      { type: Number, required: true, index: true },
    type:        { type: String, default: '' },
    plate:       { type: String, default: '' },
    route:       { type: String, default: '' },
    tripType:    { type: String, default: 'intercity', enum: ['local', 'intercity'] },
    phone:       { type: String, default: '' },
    status:      { type: String, default: 'active', enum: ['active', 'off'] },
    rentedCount: { type: Number, default: 0 },
    createdAt:   { type: Date,   default: Date.now }
});
truckSchema.index({ tripType: 1, route: 1, status: 1 });

const searchLogSchema = new mongoose.Schema({
    userId:      Number,
    username:    String,
    category:    String,
    searchedFor: String,
    phone:       String,
    createdAt:   { type: Date, default: Date.now, index: { expireAfterSeconds: 86400 } }
});

const sessionSchema = new mongoose.Schema({
    key:  { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
});

const CementSeller    = mongoose.model('CementSeller',    cementSchema);
const SteelSeller     = mongoose.model('SteelSeller',     steelSchema);
const MachineryLeasor = mongoose.model('MachineryLeasor', machinerySchema);
const TruckLeasor     = mongoose.model('TruckLeasor',     truckSchema);
const SearchLog       = mongoose.model('SearchLog',       searchLogSchema);
const BotSession      = mongoose.model('BotSession',      sessionSchema);

// ──────────────────────────────────────────────────────────
// MONGODB
// ──────────────────────────────────────────────────────────
async function connectMongo() {
    try {
        await mongoose.connect(MONGO_URI, {
            maxPoolSize: 50, minPoolSize: 5,
            serverSelectionTimeoutMS: 8000,
            socketTimeoutMS: 45000,
            heartbeatFrequencyMS: 10000,
            retryWrites: true
        });
        console.log('✅  MongoDB Connected');
    } catch (err) {
        console.error('❌  MongoDB failed:', err.message);
        setTimeout(connectMongo, 5000);
    }
}
mongoose.connection.on('disconnected', () => setTimeout(connectMongo, 3000));
mongoose.connection.on('error', err => console.error('Mongo:', err));
connectMongo();

// ──────────────────────────────────────────────────────────
// BOT + SESSION
// ──────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN, {
    handlerTimeout: 90_000,
    telegram: { webhookReply: false }
});

const sessionCache = new Map();
function lruSet(k, v) {
    if (sessionCache.size >= 5000 && !sessionCache.has(k))
        sessionCache.delete(sessionCache.keys().next().value);
    sessionCache.set(k, v);
}
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const uid = ctx.from.id;
    if (ctx.from.is_bot) return;
    if (rateLimit(uid, 40)) {
        await ctx.reply('⏳ ጥቂት ቆዩ፣ ከዚያ እንደገና ይሞክሩ።').catch(() => {});
        return;
    }
    const k = String(uid);
    if (!sessionCache.has(k)) {
        const doc = await BotSession.findOne({ key: k }).lean().catch(() => null);
        lruSet(k, doc?.data ?? {});
    }
    ctx.session = sessionCache.get(k);
    await next();
    lruSet(k, ctx.session);
    BotSession.updateOne({ key: k }, { $set: { data: ctx.session } }, { upsert: true }).catch(() => {});
});

// ──────────────────────────────────────────────────────────
// UTILITIES
// ──────────────────────────────────────────────────────────
const isAdmin = ctx => ADMIN_IDS.includes(ctx.from?.id);
const fmt     = n   => Number(n).toLocaleString('en');
function esc(s) { return String(s || '').replace(/([*_`[\]])/g, '\\$1'); }

function ethTimestamp(date) {
    const d = new Date(date);
    const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${eat.getDate()}/${eat.getMonth()+1} ${pad(eat.getHours())}:${pad(eat.getMinutes())}`;
}

// ── Support line shown after every search ────────────────
const supportLine =
    `\n━━━━━━━━━━━━━━━━━\n` +
    `📞 *ለማዘዝ ወይም ለጥያቄ ይደውሉ:*\n` +
    `👉 \`${SUPPORT_PHONE}\``;

// ──────────────────────────────────────────────────────────
// SMART SEARCH — bilingual + fuzzy + typo-tolerant
// ──────────────────────────────────────────────────────────
const SYNONYM_GROUPS = [
    ['ዳንጎቴ', 'dangote', 'dangoto', 'dangte'],
    ['ድሬ', 'dire', 'diredawa', 'ድሬዳዋ'],
    ['ናሽናል', 'national', 'nashenal'],
    ['ሙገር', 'mugher', 'muger'],
    ['ደርባ', 'derba'],
    ['ሲሚንቶ', 'cement', 'cemento', 'siminto'],
    ['ብረት', 'steel', 'iron', 'bireet'],
    ['ቆርቆሮ', 'rod', 'bar', 'rebar'],
    ['ባለ 8', 'ባለ8', '8mm', '8 mm', 'bale 8', '8'],
    ['ባለ 10', 'ባለ10', '10mm', '10 mm', 'bale 10', '10'],
    ['ባለ 12', 'ባለ12', '12mm', '12 mm', 'bale 12', '12'],
    ['ባለ 14', 'ባለ14', '14mm', '14 mm', 'bale 14'],
    ['ባለ 16', 'ባለ16', '16mm', '16 mm', 'bale 16'],
    ['ማሽነሪ', 'machinery', 'machine', 'mashineri'],
    ['ኤክስካቫተር', 'excavator', 'exkavator', 'excavater', 'digger'],
    ['ቡልዶዘር', 'bulldozer', 'buldozer', 'bull dozer'],
    ['ጂሬደር', 'grader', 'motor grader', 'moto grader', 'ሞጦ ጂሬደር'],
    ['ክሬን', 'crane'],
    ['ሮለር', 'roller', 'compactor', 'ኮምፓክተር', 'compacter'],
    ['ሎደር', 'loader', 'front loader', 'wheel loader'],
    ['ኮንክሪት ሚክሰር', 'concrete mixer', 'mixer', 'ሚክሰር', 'cement mixer'],
    ['ጀነሬተር', 'generator', 'genset', 'gen'],
    ['ፓምፕ', 'pump', 'water pump'],
    ['ስካፎልዲንግ', 'scaffolding', 'scaffold'],
    ['ፎርክሊፍት', 'forklift', 'fork lift'],
    ['ሞተር ጂሬደር', 'motor grader', 'grader'],
    ['ቪብሬተር', 'vibrator', 'concrete vibrator'],
    ['ዌልደር', 'welder', 'welding machine'],
    ['ኤር ኮምፕሬሰር', 'air compressor', 'compressor', 'ኮምፕሬሰር'],
    ['ሚኒ ኤክስካቫተር', 'mini excavator', 'small excavator'],
    ['ሎ ቤድ', 'low bed', 'lowbed', 'lowloader'],
    ['ሲኖትራክ', 'sinotruk', 'sino truck', 'sino'],
    ['ፎው', 'faw', 'faaw'],
    ['ኢሱዙ', 'isuzu'],
    ['FSR', 'fsr', 'isuzu fsr', 'ኤፍኤስአር'],
    ['ትራክ', 'truck', 'trak', 'lorry'],
    ['ተሳቢ', 'ተጎታች', 'trailer', 'semi trailer', 'semi-trailer',
     'trailor', 'treler', 'traylor', 'ሴሚ ትሬለር', 'ትሬለር', 'tirelar'],
    ['ዳምፕ', 'dump truck', 'dumper', 'tipper', 'ዳምፐር', 'dump'],
    ['ታንከር', 'tanker', 'water tanker', 'fuel tanker', 'ነዳጅ ታንከር'],
    ['ካርጎ', 'cargo truck', 'cargo', 'box truck', 'closed truck', 'ዝግ ትራክ'],
    ['ፍላትቤድ', 'flatbed', 'flat bed', 'flat truck'],
    ['ሎ ቤድ ትራክ', 'low bed truck', 'lowbed truck', 'low loader', 'lowloader'],
    ['ሲሎ ትራክ', 'silo truck', 'silo', 'bulk truck', 'ሲሎ'],
    ['ኮንቴይነር', 'container truck', 'container', 'konteiner'],
    ['ቴምፖ', 'tempo', 'mini truck', 'pickup', 'ፒክአፕ', 'pick up'],
    ['አዲስ አበባ', 'addis ababa', 'addis', 'አ.አ', 'aa', 'a.a'],
    ['ሀዋሳ', 'hawasa', 'hawassa', 'awasa'],
    ['አዳማ', 'adama', 'nazret', 'ናዝሬት'],
    ['ባህርዳር', 'bahir dar', 'bahirdar', 'bahrdar'],
    ['ጎንደር', 'gondar', 'gonder'],
    ['መቀሌ', 'mekelle', 'mekele', 'tigray'],
    ['ጅማ', 'jimma', 'jima'],
    ['ድሬዳዋ', 'dire dawa', 'diredawa', 'dire'],
    ['ደሴ', 'desse', 'dessie'],
    ['ሐረር', 'harar', 'harer'],
    ['አሶሳ', 'assosa', 'asosa'],
    ['መተማ', 'metema', 'metama'],
    ['ሁመራ', 'humera', 'humera town', 'humra'],
    ['ወልዲያ', 'woldia', 'woldiya', 'waldiya'],
    ['ሸዋ ሮቢት', 'shewa robit', 'shewarobit', 'shoa robit'],
    ['ሞጆ', 'mojo', 'mogio'],
    ['ቡሬ', 'bure', 'buri'],
    ['አሸንጌ', 'ashenge', 'ashengi', 'ሀይቅ'],
    ['ሻምቡ', 'shambu', 'shmbu'],
    ['ቆቦ', 'kobo', 'qobo'],
    ['ሰሜን ሸዋ', 'north shewa', 'n. shewa', 'fitche', 'ፊቼ'],
    ['ወልቃይት', 'welkait', 'wolkait', 'welkite'],
    ['ሽሬ', 'shire', 'shre', 'endo selassie', 'እንዳ ስላሴ'],
    ['አክሱም', 'axum', 'aksum'],
    ['አዲ ግራት', 'adigrat', 'adi grat'],
    ['አምቦ', 'ambo', 'ambu'],
    ['ሻሸመኔ', 'shashemene', 'shashamane', 'shashemane'],
    ['ዝዋይ', 'ziway', 'zeway', 'batu'],
    ['ነቀምት', 'nekemte', 'nekemt', 'naqamte'],
    ['ጂጂጋ', 'jijiga', 'jigjiga'],
    ['ሞያሌ', 'moyale', 'moyale border'],
    ['ኮሚቦልቻ', 'kombolcha', 'kembolcha'],
    ['ጋምቤላ', 'gambela', 'gambella'],
    ['ደብረ ብርሃን', 'debre birhan', 'debrebirhan'],
    ['ደብረ ማርቆስ', 'debre markos', 'debremarkos'],
    ['ሆሳዕና', 'hossana', 'hosana'],
    ['ጊምቢ', 'gimbi', 'gimby'],
];

const SYNONYM_LOOKUP = new Map();
for (let i = 0; i < SYNONYM_GROUPS.length; i++)
    for (const w of SYNONYM_GROUPS[i])
        SYNONYM_LOOKUP.set(w.toLowerCase(), i);

function editDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1]
                ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
}

function buildAlternatives(raw) {
    const s = raw.trim().toLowerCase();
    const alts = new Set([s]);
    if (SYNONYM_LOOKUP.has(s)) {
        for (const w of SYNONYM_GROUPS[SYNONYM_LOOKUP.get(s)])
            alts.add(w.toLowerCase());
    }
    for (const [word, groupIdx] of SYNONYM_LOOKUP.entries()) {
        const maxDist = Math.max(1, Math.floor(word.length / 4));
        if (editDistance(s, word) <= maxDist) {
            for (const w of SYNONYM_GROUPS[groupIdx])
                alts.add(w.toLowerCase());
        }
    }
    return [...alts];
}

function searchRx(s) {
    if (!s) return new RegExp('', 'i');
    const alts = buildAlternatives(s);
    const patterns = alts.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(patterns.join('|'), 'i');
}

function logSearch(ctx, category, searchedFor, phone) {
    SearchLog.create({
        userId:      ctx.from.id,
        username:    sanitize(ctx.from.username || 'N/A'),
        category,
        searchedFor: sanitize(searchedFor),
        phone:       safePhone(phone)
    }).catch(() => {});
}

// ──────────────────────────────────────────────────────────
// DROPDOWN OPTION LISTS
// ──────────────────────────────────────────────────────────
const CEMENT_TYPES = ['ዳንጎቴ', 'ድሬ', 'ናሽናል', 'ሙገር', 'ደርባ', 'ሌላ'];

const STEEL_TYPES = ['ባለ 8', 'ባለ 10', 'ባለ 12', 'ባለ 14', 'ባለ 16', 'ቆርቆሮ (ሌላ)'];

const MACHINERY_TYPES = [
    'ኤክስካቫተር', 'ሚኒ ኤክስካቫተር', 'ቡልዶዘር', 'ጂሬደር', 'ሮለር',
    'ሎደር', 'ክሬን', 'ሎ ቤድ', 'ኮንክሪት ሚክሰር', 'ፎርክሊፍት',
    'ጀነሬተር', 'ፓምፕ', 'ቪብሬተር', 'ዌልደር', 'ኤር ኮምፕሬሰር', 'ሌላ'
];

const TRUCK_TYPES = [
    'ሲኖትራክ', 'ፎው',      'ኢሱዙ',
    'FSR',     'ዳምፕ',    'ተሳቢ',
    'ታንከር',   'ካርጎ',    'ፍላትቤድ',
    'ሲሎ ትራክ','ኮንቴይነር', 'ሎ ቤድ ትራክ',
    'ቴምፖ',    'ሌላ'
];

const LOCATIONS = [
    'አዲስ አበባ', 'ሀዋሳ',     'አዳማ',     'ባህርዳር',
    'ጎንደር',    'መቀሌ',     'ጅማ',      'ድሬዳዋ',
    'ደሴ',      'ሐረር',     'ኮሚቦልቻ',   'ወልዲያ',
    'ሻሸመኔ',   'ነቀምት',    'ጂጂጋ',     'ሞያሌ',
    'ሞጆ',      'ደብረ ብርሃን','ደብረ ማርቆስ','ጋምቤላ',
    'አሶሳ',     'ሁመራ',    'መተማ',     'ጭልጋ',
    'ሌላ'
];

const TRUCK_ROUTES_FROM = [
    'አ.አ',     'ሀዋሳ',    'አዳማ',     'ባህርዳር',
    'ጎንደር',   'መቀሌ',    'ጅማ',      'ድሬዳዋ',
    'ደሴ',     'ሐረር',    'ኮሚቦልቻ',   'ወልዲያ',
    'ሻሸመኔ',  'ነቀምት',   'ጂጂጋ',     'ሞያሌ',
    'ሞጆ',     'ሁመራ',   'መተማ',     'ጭልጋ',
    'ሌላ'
];

const TRUCK_ROUTES_TO = [...TRUCK_ROUTES_FROM];

// ── Inline keyboard builder ───────────────────────────────
function choiceKb(options, prefix, cols = 3) {
    const rows = [];
    for (let i = 0; i < options.length; i += cols) {
        rows.push(options.slice(i, i + cols).map(o =>
            Markup.button.callback(o, `${prefix}${o}`)
        ));
    }
    return Markup.inlineKeyboard(rows);
}

function isValidObjectId(id) {
    return /^[a-f\d]{24}$/i.test(id);
}

// ──────────────────────────────────────────────────────────
// CARD FORMATTERS
// ──────────────────────────────────────────────────────────
function statusBadge(status) {
    return status === 'active' ? '🟢 አለ' : '🔴 የለም';
}
function truckStatusBadge(status) {
    return status === 'active' ? '🟢 ዝግጁ' : '🔴 ስራ ላይ';
}

function cementCardBuyer(it) {
    return (
        `🧱 *${esc(it.companyName || it.type)}*\n` +
        `▸ አይነት ፦ ${esc(it.type)}\n` +
        `▸ 📍 ቦታ  ፦ ${esc(it.location)}\n` +
        `▸ 💰 ዋጋ  ፦ *${fmt(it.price)} ብር/ኩንታል*\n` +
        `▸ ${statusBadge(it.status)}`
    );
}
function steelCardBuyer(it) {
    return (
        `🟥 *${esc(it.type)}*\n` +
        `▸ 📍 አድራሻ ፦ ${esc(it.address)}\n` +
        `▸ 💰 ዋጋ    ፦ *${fmt(it.price)} ብር*\n` +
        `▸ ${statusBadge(it.status)}`
    );
}
function macCardBuyer(it) {
    return (
        `🔹 *${esc(it.type)}*\n` +
        `▸ 📍 አድራሻ ፦ ${esc(it.address)}\n` +
        `▸ 💰 ኪራይ  ፦ *${fmt(it.price)} ብር*\n` +
        `▸ ${statusBadge(it.status)}`
    );
}
function truckCardBuyer(it) {
    return (
        `🚚 *${esc(it.type)}*\n` +
        `▸ ${it.tripType === 'local' ? '🏙️ ከተማ ውስጥ' : '🛣️ መስመር    '}፦ ${esc(it.route)}\n` +
        `▸ ${truckStatusBadge(it.status)}`
    );
}

function cementCard(it, adminView = false) {
    const badge = adminView
        ? (it.status === 'active' ? '✅ አለ — ዝግጁ' : '❌ የለም')
        : statusBadge(it.status);
    return (
        `🧱 *${esc(it.companyName || it.type)}*\n` +
        `▸ አይነት  ፦ ${esc(it.type)}\n` +
        `▸ 📍 ቦታ  ፦ ${esc(it.location)}\n` +
        `▸ 📞 ስልክ ፦ \`${esc(it.phone)}\`\n` +
        `▸ 💰 ዋጋ  ፦ *${fmt(it.price)} ብር/ኩንታል*\n` +
        `▸ ሁኔታ   ፦ ${badge}`
    );
}
function steelCard(it, adminView = false) {
    const badge = adminView
        ? (it.status === 'active' ? '✅ አለ' : '❌ የለም')
        : statusBadge(it.status);
    return (
        `🟥 *${esc(it.type)}*\n` +
        `▸ 📍 አድራሻ ፦ ${esc(it.address)}\n` +
        `▸ 📞 ስልክ  ፦ \`${esc(it.phone)}\`\n` +
        `▸ 💰 ዋጋ   ፦ *${fmt(it.price)} ብር*\n` +
        `▸ ሁኔታ    ፦ ${badge}`
    );
}
function macCard(it, adminView = false) {
    const badge = adminView
        ? (it.status === 'active' ? '✅ አለ' : '❌ የለም')
        : statusBadge(it.status);
    return (
        `🔹 *${esc(it.type)}*\n` +
        `▸ 📍 አድራሻ ፦ ${esc(it.address)}\n` +
        `▸ 📞 ስልክ  ፦ \`${esc(it.phone)}\`\n` +
        `▸ 💰 ኪራይ  ፦ *${fmt(it.price)} ብር*\n` +
        `▸ ሁኔታ    ፦ ${badge}`
    );
}
function truckCard(it, adminView = false) {
    const badge = adminView
        ? (it.status === 'active' ? '✅ ዝግጁ' : '🔴 ስራ ላይ')
        : truckStatusBadge(it.status);
    return (
        `🚚 *${esc(it.type)}*\n` +
        `▸ 🚗 ታርጋ  ፦ ${esc(it.plate)}\n` +
        `▸ ${it.tripType === 'local' ? '🏙️ ከተማ ውስጥ' : '🛣️ መስመር    '}፦ ${esc(it.route)}\n` +
        `▸ 📞 ስልክ  ፦ \`${esc(it.phone)}\`\n` +
        `▸ ሁኔታ    ፦ ${badge}`
    );
}

// ──────────────────────────────────────────────────────────
// PER-ITEM KEYBOARDS
// ──────────────────────────────────────────────────────────
const cementItemKb  = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ',        `cem_on_${id}`),
     Markup.button.callback('❌ የለም',       `cem_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',  `cem_price_${id}`),
     Markup.button.callback('➕ ሌላ ጨምር',  'cem_add')]
]);
const steelItemKb   = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ',        `stl_on_${id}`),
     Markup.button.callback('❌ የለም',       `stl_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',  `stl_price_${id}`),
     Markup.button.callback('➕ ሌላ ጨምር',  'stl_add')]
]);
const macItemKb     = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ',        `mac_on_${id}`),
     Markup.button.callback('❌ የለም',       `mac_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',  `mac_price_${id}`),
     Markup.button.callback('➕ ሌላ ጨምር',  'mac_add')]
]);
const truckItemKb   = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅ ዝግጁ',      `trk_on_${id}`),
     Markup.button.callback('🔴 ስራ ላይ',   `trk_off_${id}`)],
    [Markup.button.callback('🗺️ መስመር ቀይር', `trk_route_${id}`),
     Markup.button.callback('➕ ሌላ ጨምር',  'trk_add')]
]);

// ──────────────────────────────────────────────────────────
// MAIN KEYBOARD
// ──────────────────────────────────────────────────────────
const mainKb = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ',    '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት',   '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ',     '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት'],
    ['📋 የእኔ ምዝገባዎች',   '❓ እርዳታ']
]).resize();

function askChoice(ctx, prompt, options, prefix, cols = 3) {
    return ctx.reply(prompt, { parse_mode: 'Markdown', ...choiceKb(options, prefix, cols) });
}

// ──────────────────────────────────────────────────────────
// ★ START — ቀለልና ቀጥተኛ ★
// ──────────────────────────────────────────────────────────
bot.start(ctx => {
    ctx.session = {};
    const name = sanitize(ctx.from.first_name || 'ወዳጄ');
    ctx.reply(
        `👋 *ሰላም ${esc(name)}!*\n\n` +
        `🧱 ሲሚንቶ · 🟥 ብረት · 🔹 ማሽነሪ · 🚚 ትራክ\n\n` +
        `👇 *ምን ይፈልጋሉ?*`,
        { parse_mode: 'Markdown', ...mainKb }
    );
});

// ──────────────────────────────────────────────────────────
// ★ NEW: /help Command ★
// ──────────────────────────────────────────────────────────
bot.command('help', ctx => {
    ctx.session = {};
    ctx.reply(
        `❓ *እርዳታ*\n\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `*🛒 ለፈላጊዎች (Buyers/Renters):*\n` +
        `▸ "🧱 ሲሚንቶ ለመግዛት" — ሲሚንቶ ፈልጉ\n` +
        `▸ "🟥 ብረት ለመግዛት" — ብረት ፈልጉ\n` +
        `▸ "🔹 ማሽነሪ ለመከራየት" — ማሽነሪ ፈልጉ\n` +
        `▸ "🚚 መኪና ለመከራየት" — ትራክ ፈልጉ\n\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `*📦 ለሻጮች/አከራዮች (Sellers/Leasors):*\n` +
        `▸ "🧱 ሲሚንቶ ለመሸጥ" — ሲሚንቶ ምዝገባ\n` +
        `▸ "🟥 ብረት ለመሸጥ" — ብረት ምዝገባ\n` +
        `▸ "🔹 ማሽነሪ ለማከራየት" — ማሽነሪ ምዝገባ\n` +
        `▸ "🚚 መኪና ለማከራየት" — ትራክ ምዝገባ\n\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `*📋 ምዝገባዎን ለማየት:*\n` +
        `▸ "📋 የእኔ ምዝገባዎች" ይጫኑ\n\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `📞 *ለጥያቄ:* \`${SUPPORT_PHONE}\``,
        { parse_mode: 'Markdown', ...mainKb }
    );
});

bot.hears('❓ እርዳታ', ctx => {
    ctx.session = {};
    ctx.reply(
        `❓ *እርዳታ*\n\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `*🛒 ለፈላጊዎች:*\n` +
        `▸ ሲሚንቶ፣ ብረት፣ ማሽነሪ፣ ወይም ትራክ ለማግኘት\n` +
        `   በቀኝ ያለውን ይምረጡ\n\n` +
        `*📦 ለሻጮች/አከራዮች:*\n` +
        `▸ ሸቀጥዎን ወይም ማሽነሪዎን ለማስተዋወቅ\n` +
        `   በግራ ያለውን ይምረጡ\n\n` +
        `📋 *ምዝገባዎን ለማስተዳደር:*\n` +
        `▸ "📋 የእኔ ምዝገባዎች" ይጫኑ\n\n` +
        `📞 *ለጥያቄ:* \`${SUPPORT_PHONE}\``,
        { parse_mode: 'Markdown', ...mainKb }
    );
});

// ──────────────────────────────────────────────────────────
// ★ NEW: "📋 የእኔ ምዝገባዎች" — My Listings ★
// ──────────────────────────────────────────────────────────
bot.command('mylistings', ctx => showMyListings(ctx));
bot.hears('📋 የእኔ ምዝገባዎች', ctx => showMyListings(ctx));

async function showMyListings(ctx) {
    const uid = ctx.from.id;
    const [cements, steels, machs, trucks] = await Promise.all([
        CementSeller.find({ userId: uid }).lean(),
        SteelSeller.find({ userId: uid }).lean(),
        MachineryLeasor.find({ userId: uid }).lean(),
        TruckLeasor.find({ userId: uid }).lean(),
    ]);

    const total = cements.length + steels.length + machs.length + trucks.length;

    if (total === 0) {
        return ctx.reply(
            `📋 *የእኔ ምዝገባዎች*\n\n` +
            `😔 ምንም ምዝገባ አልተገኘም።\n\n` +
            `👉 ለማስመዝገብ ከዚህ ታቹ ይምረጡ 👇`,
            { parse_mode: 'Markdown', ...mainKb }
        );
    }

    const activeCount = [
        ...cements, ...steels, ...machs, ...trucks
    ].filter(i => i.status === 'active').length;

    await ctx.reply(
        `📋 *የእኔ ምዝገባዎች*\n\n` +
        `ጠቅላላ: *${total}*  🟢 ዝግጁ: *${activeCount}*  🔴 ያልዘጋ: *${total - activeCount}*\n\n` +
        `👇 ሁኔታ ለመቀየር ከታቹ ያለውን ቁልፍ ይጠቀሙ:`,
        { parse_mode: 'Markdown' }
    );

    for (const it of cements)
        await ctx.reply(cementCard(it, false), { parse_mode: 'Markdown', ...cementItemKb(it._id) });
    for (const it of steels)
        await ctx.reply(steelCard(it, false),  { parse_mode: 'Markdown', ...steelItemKb(it._id) });
    for (const it of machs)
        await ctx.reply(macCard(it, false),    { parse_mode: 'Markdown', ...macItemKb(it._id) });
    for (const it of trucks)
        await ctx.reply(truckCard(it, false),  { parse_mode: 'Markdown', ...truckItemKb(it._id) });
}

// ──────────────────────────────────────────────────────────
// ADMIN PANEL
// ──────────────────────────────────────────────────────────
bot.command('admin_panel', async ctx => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም!');
    ctx.reply(
        `🔧 *አድሚን ፓናል* — ዘርፍ ይምረጡ:`,
        { parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🧱 ሲሚንቶ',  'rep_cem'),
             Markup.button.callback('🚚 ትራክ',   'rep_trk')],
            [Markup.button.callback('🟥 ብረት',   'rep_stl'),
             Markup.button.callback('🔹 ማሽነሪ',  'rep_mac')],
            [Markup.button.callback('📊 ፍለጋ ሪፖርት (ዛሬ)', 'rep_searches')],
            [Markup.button.callback('🗑️ ማጥፊያ',   'admin_del')]
          ])
        }
    );
});

const adminDelKb = (prefix, id) => Markup.inlineKeyboard([
    [Markup.button.callback('🗑️ ምዝገባ አጥፋ', `adel_do_${prefix}_${id}`)]
]);

async function adminReport(ctx, Model, title, cardFn, prefix) {
    await ctx.answerCbQuery?.();
    if (!isAdmin(ctx)) return ctx.reply('⛔');
    const items = await Model.find({}).sort({ status: -1, createdAt: -1 }).lean();
    if (!items.length)
        return ctx.reply(`📭 *${title}*\n\nምንም ምዝገባ አልተገኘም።`, { parse_mode: 'Markdown' });

    const activeCount = items.filter(i => i.status === 'active').length;
    await ctx.reply(
        `📋 *${title}*\n` +
        `ጠቅላላ: *${items.length}*  ✅ አለ: *${activeCount}*  ❌ የለም: *${items.length - activeCount}*`,
        { parse_mode: 'Markdown' }
    );
    for (const it of items)
        await ctx.reply(cardFn(it, true), { parse_mode: 'Markdown', ...adminDelKb(prefix, it._id) });
}

bot.action('rep_cem', ctx => adminReport(ctx, CementSeller,    '🧱 ሲሚንቶ ሻጮች',  cementCard, 'cem'));
bot.action('rep_trk', ctx => adminReport(ctx, TruckLeasor,     '🚚 ትራክ አከራዮች', truckCard,  'trk'));
bot.action('rep_stl', ctx => adminReport(ctx, SteelSeller,     '🟥 ብረት ሻጮች',   steelCard,  'stl'));
bot.action('rep_mac', ctx => adminReport(ctx, MachineryLeasor, '🔹 ማሽነሪ',       macCard,    'mac'));

bot.action('rep_searches', async ctx => {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx)) return ctx.reply('⛔');

    const now = new Date();
    const todayStartUTC = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0
    ));
    todayStartUTC.setHours(todayStartUTC.getHours() - 3);

    const logs = await SearchLog.find({ createdAt: { $gte: todayStartUTC } })
        .sort({ createdAt: -1 }).limit(200).lean();

    if (!logs.length)
        return ctx.reply('📭 ዛሬ ምንም ፍለጋ አልተገኘም።');

    const CAT_EMOJI = {
        '🧱 ሲሚንቶ ፈላጊ': '🧱',
        '🟥 ብረት ፈላጊ':   '🟥',
        '🔹 ማሽነሪ ፈላጊ':  '🔹',
        '🚚 ትራክ ፈላጊ':   '🚚',
    };

    const groups = {};
    for (const l of logs) (groups[l.category] = groups[l.category] || []).push(l);

    const lines = [`📊 *የዛሬ ፍለጋ ሪፖርት* 📅 ${ethTimestamp(new Date())}`, `━━━━━━━━━━━━━━━━━━━━━`];
    for (const [cat, entries] of Object.entries(groups))
        lines.push(`${CAT_EMOJI[cat] || '🔍'} ${cat.replace(/^[^ ]+ /, '')} — *${entries.length} ፍለጋ*`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`🔢 ጠቅላላ ዛሬ: *${logs.length}*`);
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });

    for (const [cat, entries] of Object.entries(groups)) {
        const emoji = CAT_EMOJI[cat] || '🔍';
        await ctx.reply(`${emoji} *${cat}* — *${entries.length}* ፍለጋ`, { parse_mode: 'Markdown' });
        for (const e of entries) {
            const ts  = ethTimestamp(e.createdAt);
            const who = e.username && e.username !== 'N/A' ? `@${esc(e.username)}` : '—';
            await ctx.reply(
                `${emoji} *${esc(e.searchedFor)}*\n` +
                `📞 \`${esc(e.phone)}\`  👤 ${who}\n` +
                `🕐 ${ts}`,
                { parse_mode: 'Markdown' }
            );
        }
    }
});

bot.action('admin_del', ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
    ctx.reply('🗑️ *ማጥፊያ* — ዘርፍ ይምረጡ:', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🧱 ሲሚንቶ', 'adel_cem'),
             Markup.button.callback('🚚 ትራክ',  'adel_trk')],
            [Markup.button.callback('🟥 ብረት',  'adel_stl'),
             Markup.button.callback('🔹 ማሽነሪ', 'adel_mac')]
        ])
    });
    ctx.answerCbQuery();
});

const MMAP = { cem: CementSeller, trk: TruckLeasor, stl: SteelSeller, mac: MachineryLeasor };

async function delMenu(ctx, Model, labelFn, prefix, title) {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.answerCbQuery();
    const items = await Model.find({}).lean();
    if (!items.length) return ctx.reply('📭 የሚጠፋ ምዝገባ የለም።');
    ctx.reply(`🗑️ *${title}* — የሚያጠፉትን ይምረጡ:`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(items.map(it => [
            Markup.button.callback(`🗑️ ${labelFn(it)}`, `adel_do_${prefix}_${it._id}`)
        ]))
    });
}

bot.action('adel_cem', ctx => delMenu(ctx, CementSeller,    it => `${it.companyName} (${it.phone})`, 'cem', 'ሲሚንቶ'));
bot.action('adel_trk', ctx => delMenu(ctx, TruckLeasor,     it => `${it.plate} (${it.phone})`,       'trk', 'ትራክ'));
bot.action('adel_stl', ctx => delMenu(ctx, SteelSeller,     it => `${it.type} (${it.phone})`,        'stl', 'ብረት'));
bot.action('adel_mac', ctx => delMenu(ctx, MachineryLeasor, it => `${it.type} (${it.phone})`,        'mac', 'ማሽነሪ'));

bot.action(/^adel_do_(cem|trk|stl|mac)_([a-f\d]{24})$/i, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
    const [, p, id] = ctx.match;
    if (!isValidObjectId(id)) return ctx.answerCbQuery('❗ Invalid ID');
    await MMAP[p].findByIdAndDelete(id);
    ctx.reply('✅ ምዝገባው ተሰርዟል።');
    ctx.answerCbQuery('🗑️ ተሰርዟል');
});

// ──────────────────────────────────────────────────────────
// PER-ITEM ACTIONS (toggle status, update price/route)
// ──────────────────────────────────────────────────────────
async function toggleItem(ctx, Model, id, newStatus, cardFn, kb) {
    if (!isValidObjectId(id)) { ctx.answerCbQuery('❗ Invalid ID'); return; }
    const doc = await Model.findOneAndUpdate(
        { _id: id, userId: ctx.from.id },
        { status: newStatus },
        { new: true }
    );
    if (!doc) {
        const adminDoc = isAdmin(ctx)
            ? await Model.findByIdAndUpdate(id, { status: newStatus }, { new: true })
            : null;
        if (!adminDoc) { ctx.answerCbQuery('❗ ፈቃድ የለዎትም'); return; }
        const label = newStatus === 'active' ? '✅ ወደ "አለ" ተቀይሯል!' : '🔴 ወደ "የለም" ተቀይሯል!';
        ctx.editMessageText(cardFn(adminDoc.toObject(), true), { parse_mode: 'Markdown', ...kb(adminDoc._id) })
           .catch(() => ctx.reply(cardFn(adminDoc.toObject(), true), { parse_mode: 'Markdown', ...kb(adminDoc._id) }));
        return ctx.answerCbQuery(label);
    }
    const label = newStatus === 'active' ? '✅ ወደ "አለ" ተቀይሯል!' : '🔴 ወደ "የለም" ተቀይሯል!';
    ctx.editMessageText(cardFn(doc.toObject(), false), { parse_mode: 'Markdown', ...kb(doc._id) })
       .catch(() => ctx.reply(cardFn(doc.toObject(), false), { parse_mode: 'Markdown', ...kb(doc._id) }));
    ctx.answerCbQuery(label);
}

bot.action(/^cem_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, CementSeller, ctx.match[1], 'active', cementCard, cementItemKb));
bot.action(/^cem_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, CementSeller, ctx.match[1], 'off',    cementCard, cementItemKb));
bot.action(/^cem_price_([a-f\d]{24})$/i, ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.action = 'UPD_CEM_PRICE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply(`💰 *አዲሱን ዋጋ ያስገቡ* (ብር/ኩንታል)\n\nምሳሌ: _650_`, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('cem_add', ctx => {
    ctx.session.action = 'REG_CEMENT_1'; ctx.session.cementData = {};
    askChoice(ctx, `🧱 *ሲሚንቶ ምዝገባ — 1/4*\n\nየሲሚንቶ *አይነት* ይምረጡ 👇`, CEMENT_TYPES, 'CTYPE_', 3);
    ctx.answerCbQuery();
});

bot.action(/^stl_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, SteelSeller, ctx.match[1], 'active', steelCard, steelItemKb));
bot.action(/^stl_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, SteelSeller, ctx.match[1], 'off',    steelCard, steelItemKb));
bot.action(/^stl_price_([a-f\d]{24})$/i, ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.action = 'UPD_STL_PRICE'; ctx.session.targetItemId = ctx.match[1];
    ctx.reply(`💰 *አዲሱን ዋጋ ያስገቡ* (ብር)\n\nምሳሌ: _5000_`, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('stl_add', ctx => {
    ctx.session.action = 'REG_STEEL_1'; ctx.session.steelData = {};
    askChoice(ctx, `🟥 *ብረት ምዝገባ — 1/4*\n\nየብረት *ዲያሜትር* ይምረጡ 👇`, STEEL_TYPES, 'STYPE_', 3);
    ctx.answerCbQuery();
});

bot.action(/^mac_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, MachineryLeasor, ctx.match[1], 'active', macCard, macItemKb));
bot.action(/^mac_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, MachineryLeasor, ctx.match[1], 'off',    macCard, macItemKb));
bot.action(/^mac_price_([a-f\d]{24})$/i, ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.action = 'UPD_MAC_PRICE'; ctx.session.targetItemId = ctx.match[1];
    ctx.reply(`💰 *አዲሱን ኪራይ ያስገቡ* (ብር)\n\nምሳሌ: _15000_`, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('mac_add', ctx => {
    ctx.session.action = 'REG_MACHINERY_1'; ctx.session.machineryData = {};
    askChoice(ctx, `🔹 *ማሽነሪ ምዝገባ — 1/4*\n\nየማሽነሪ *አይነት* ይምረጡ 👇`, MACHINERY_TYPES, 'MTYPE_', 2);
    ctx.answerCbQuery();
});

bot.action(/^trk_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, TruckLeasor, ctx.match[1], 'active', truckCard, truckItemKb));
bot.action(/^trk_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, TruckLeasor, ctx.match[1], 'off',    truckCard, truckItemKb));
bot.action(/^trk_route_([a-f\d]{24})$/i, async ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.targetItemId = ctx.match[1];
    await ctx.reply('🗺️ *የጉዞ አይነት ይምረጡ:*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🏙️ በከተማ ውስጥ',   `UPD_TRIP_LOCAL_${ctx.match[1]}`)],
            [Markup.button.callback('🛣️ ከተማ ወደ ከተማ', `UPD_TRIP_INTERCITY_${ctx.match[1]}`)]
        ])
    });
    ctx.answerCbQuery();
});

bot.action(/^UPD_TRIP_LOCAL_([a-f\d]{24})$/i, async ctx => {
    const id = ctx.match[1];
    await TruckLeasor.findByIdAndUpdate(id, { tripType: 'local' });
    ctx.session.action = 'UPD_TRK_ROUTE';
    ctx.session.targetItemId = id;
    await ctx.reply(`📍 *ትራኩ ያለበት ከተማ ያስገቡ*\n\nምሳሌ: _አዲስ አበባ_`, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

bot.action(/^UPD_TRIP_INTERCITY_([a-f\d]{24})$/i, async ctx => {
    const id = ctx.match[1];
    await TruckLeasor.findByIdAndUpdate(id, { tripType: 'intercity' });
    ctx.session.action = 'UPD_TRK_ROUTE';
    ctx.session.targetItemId = id;
    await ctx.reply(`🛣️ *አዲሱን መስመር ያስገቡ*\n\nምሳሌ: _ከ አዲስ አበባ ወደ ሀዋሳ_`, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

bot.action('trk_add', ctx => {
    ctx.session.action = 'REG_TRUCK_1';
    ctx.session.truckData = {};
    askChoice(ctx, `🚚 *ትራክ ምዝገባ — 1/4*\n\nየመኪናው *አይነት* ይምረጡ 👇`, TRUCK_TYPES, 'TKTYPE_', 3);
    ctx.answerCbQuery();
});

// ──────────────────────────────────────────────────────────
// DROPDOWN CALLBACK HANDLERS
// ──────────────────────────────────────────────────────────

// ── Cement type selection ─────────────────────────────────
bot.action(/^CTYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.cementData = ctx.session.cementData || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_CEMENT_1_TEXT';
        await ctx.reply(`🧱 *የሲሚንቶ አይነት ያስገቡ*\n\nምሳሌ: _ፍቅር ሲሚንቶ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.cementData.type = val;
        ctx.session.action = 'REG_CEMENT_2';
        await askChoice(ctx, `✅ አይነት: *${val}*\n\n📍 *2/4* — ሲሚንቶው ያለበት *ቦታ* ይምረጡ 👇`, LOCATIONS, 'SLOC_', 4);
    }
    ctx.answerCbQuery();
});

// ── Location selection (cement registration) ─────────────
bot.action(/^SLOC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.cementData = ctx.session.cementData || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_CEMENT_2_TEXT';
        await ctx.reply(`📍 *ቦታ ያስገቡ*\n\nምሳሌ: _ካዛንቺስ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.cementData.location = val;
        ctx.session.action = 'REG_CEMENT_3';
        await ctx.reply(`✅ ቦታ: *${val}*\n\n📞 *3/4* — *ስልክ ቁጥር* ያስገቡ\n\nምሳሌ: _0911234567_`, { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── Steel type ────────────────────────────────────────────
bot.action(/^STYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ቆርቆሮ (ሌላ)' || val === 'ሌላ') {
        ctx.session.action = 'REG_STEEL_1_TEXT';
        await ctx.reply(`🟥 *የብረት አይነት ያስገቡ*\n\nምሳሌ: _ባለ 20_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.steelData = { type: val };
        ctx.session.action = 'REG_STEEL_2';
        await ctx.reply(`✅ አይነት: *${val}*\n\n📍 *2/4* — *አድራሻ* ያስገቡ\n\nምሳሌ: _ሜርካቶ, አዲስ አበባ_`, { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── Machinery type ────────────────────────────────────────
bot.action(/^MTYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_MACHINERY_1_TEXT';
        await ctx.reply(`🔹 *የማሽነሪ አይነት ያስገቡ*\n\nምሳሌ: _ስካፎልዲንግ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.machineryData = { type: val };
        ctx.session.action = 'REG_MACHINERY_2';
        await ctx.reply(`✅ አይነት: *${val}*\n\n📍 *2/4* — *አድራሻ* ያስገቡ\n\nምሳሌ: _ቦሌ, አዲስ አበባ_`, { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── Truck type ────────────────────────────────────────────
bot.action(/^TKTYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.truckData = ctx.session.truckData || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_TRUCK_1_TEXT';
        await ctx.reply(`🚚 *የመኪናው አይነት ያስገቡ*\n\nምሳሌ: _ኢቬኮ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.truckData.type = val;
        ctx.session.action = 'REG_TRUCK_TRIP_TYPE';
        await ctx.reply(
            `✅ አይነት: *${val}*\n\n🗺️ *2/4* — *የጉዞ አይነት* ይምረጡ:`,
            { parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🏙️ በከተማ ውስጥ',   'REG_TRIP_LOCAL')],
                [Markup.button.callback('🛣️ ከተማ ወደ ከተማ', 'REG_TRIP_INTERCITY')]
              ])
            }
        );
    }
    ctx.answerCbQuery();
});

// ── Buy Cement dropdowns ──────────────────────────────────
bot.action(/^BCEM_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'BUY_CEMENT_1_TEXT';
        await ctx.reply(`🧱 *ምን አይነት ሲሚንቶ ይፈልጋሉ?*\n\nምሳሌ: _ፍቅር ሲሚንቶ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.buyCement = { type: val };
        ctx.session.action = 'BUY_CEMENT_2';
        await askChoice(ctx, `✅ *${val}* ሲሚንቶ\n\n📍 *2/3* — ሲሚንቶው የሚፈልጉበት *ቦታ* ይምረጡ 👇`, LOCATIONS, 'BCEMLOC_', 4);
    }
    ctx.answerCbQuery();
});

bot.action(/^BCEMLOC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.buyCement = ctx.session.buyCement || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'BUY_CEMENT_2_TEXT';
        await ctx.reply(`📍 *ቦታ ያስገቡ*\n\nምሳሌ: _ጎፋ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.buyCement.location = val;
        ctx.session.action = 'BUY_CEMENT_3';
        await ctx.reply(
            `✅ ቦታ: *${val}*\n\n📞 *3/3* — *ስልክ ቁጥርዎን* ያስገቡ\n\n` +
            `_(ስልኩ ለሻጩ አይሰጥም — ለፍለጋ ሪፖርት ብቻ)_`,
            { parse_mode: 'Markdown' }
        );
    }
    ctx.answerCbQuery();
});

// ── Buy Steel dropdowns ───────────────────────────────────
bot.action(/^BSTL_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ቆርቆሮ (ሌላ)' || val === 'ሌላ') {
        ctx.session.action = 'BUY_STEEL_1_TEXT';
        await ctx.reply(`🟥 *ምን አይነት ብረት ይፈልጋሉ?*\n\nምሳሌ: _ባለ 20_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.buySteel = { type: val };
        ctx.session.action = 'BUY_STEEL_2';
        await ctx.reply(
            `✅ *${val}* ብረት\n\n📞 *2/3* — *ስልክ ቁጥርዎን* ያስገቡ\n\n` +
            `_(ስልኩ ለሻጩ አይሰጥም — ለፍለጋ ሪፖርት ብቻ)_`,
            { parse_mode: 'Markdown' }
        );
    }
    ctx.answerCbQuery();
});

// ── Rent Machinery dropdowns ──────────────────────────────
bot.action(/^BMAC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_MACHINERY_1_TEXT';
        await ctx.reply(`🔹 *ምን አይነት ማሽነሪ ይፈልጋሉ?*\n\nምሳሌ: _ቪብሬተር_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentMachinery = { type: val };
        ctx.session.action = 'RENT_MACHINERY_2';
        await ctx.reply(
            `✅ *${val}*\n\n📞 *2/3* — *ስልክ ቁጥርዎን* ያስገቡ\n\n` +
            `_(ስልኩ ለሻጩ አይሰጥም — ለፍለጋ ሪፖርት ብቻ)_`,
            { parse_mode: 'Markdown' }
        );
    }
    ctx.answerCbQuery();
});

// ── Rent Truck dropdowns ──────────────────────────────────
bot.action(/^BTRK_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_TRUCK_1_TEXT';
        await ctx.reply(`🚚 *ምን አይነት ትራክ ይፈልጋሉ?*\n\nምሳሌ: _ኢቬኮ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentTruck.type = val;
        ctx.session.action = 'RENT_TRUCK_TRIP_TYPE';
        await ctx.reply(
            `✅ *${val}*\n\n🗺️ *2/3* — *የጉዞ አይነት* ይምረጡ:`,
            { parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🏙️ በከተማ ውስጥ',   'RENT_TRIP_LOCAL')],
                [Markup.button.callback('🛣️ ከተማ ወደ ከተማ', 'RENT_TRIP_INTERCITY')]
              ])
            }
        );
    }
    ctx.answerCbQuery();
});

bot.action('RENT_TRIP_LOCAL', async ctx => {
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    ctx.session.rentTruck.tripType = 'local';
    ctx.session.action = 'RENT_TRUCK_CITY';
    await askChoice(ctx, `📍 *3/3* — ትራኩ የሚፈልጉበት *ከተማ* ይምረጡ 👇`, LOCATIONS, 'BTRKCITY_', 4);
    ctx.answerCbQuery();
});

bot.action('RENT_TRIP_INTERCITY', async ctx => {
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    ctx.session.rentTruck.tripType = 'intercity';
    ctx.session.action = 'RENT_TRUCK_2';
    await askChoice(ctx, `🛣️ *3/3 (ሀ)* — *ከየት* ይሄዳሉ? 👇`, TRUCK_ROUTES_FROM, 'BTRKLOC_', 4);
    ctx.answerCbQuery();
});

bot.action(/^BTRKCITY_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_TRUCK_CITY_TEXT';
        await ctx.reply(`📍 *ከተማ ያስገቡ*\n\nምሳሌ: _ለቡ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentTruck.route = val;
        ctx.session.action = 'RENT_TRUCK_3';
        await ctx.reply(
            `✅ ከተማ: *${val}*\n\n📞 *ስልክ ቁጥርዎን* ያስገቡ\n\n_(ለፍለጋ ሪፖርት ብቻ)_`,
            { parse_mode: 'Markdown' }
        );
    }
    ctx.answerCbQuery();
});

bot.action(/^BTRKLOC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    if (ctx.session.action === 'RENT_TRUCK_2') {
        if (val === 'ሌላ') {
            ctx.session.action = 'RENT_TRUCK_2_FROM_TEXT';
            await ctx.reply(`🛣️ *የጉዞ መነሻ ቦታ ያስገቡ*\n\nምሳሌ: _ወሊሶ_`, { parse_mode: 'Markdown' });
        } else {
            ctx.session.rentTruck.routeFrom = val;
            ctx.session.action = 'RENT_TRUCK_2_TO';
            await askChoice(ctx, `✅ መነሻ: *${val}*\n\n🛣️ *3/3 (ለ)* — *ወዴት* ይሄዳሉ? 👇`, TRUCK_ROUTES_TO, 'BTRKTO_', 4);
        }
    }
    ctx.answerCbQuery();
});

bot.action(/^BTRKTO_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_TRUCK_2_TO_TEXT';
        await ctx.reply(`🛣️ *የጉዞ መድረሻ ቦታ ያስገቡ*\n\nምሳሌ: _ሀሮ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentTruck.route = `ከ ${ctx.session.rentTruck.routeFrom || ''} ወደ ${val}`;
        ctx.session.action = 'RENT_TRUCK_3';
        await ctx.reply(
            `✅ መስመር: *ከ ${ctx.session.rentTruck.routeFrom || ''} ወደ ${val}*\n\n📞 *ስልክ ቁጥርዎን* ያስገቡ\n\n_(ለፍለጋ ሪፖርት ብቻ)_`,
            { parse_mode: 'Markdown' }
        );
    }
    ctx.answerCbQuery();
});

// ── Truck registration trip type ──────────────────────────
bot.action('REG_TRIP_LOCAL', async ctx => {
    ctx.session.truckData = ctx.session.truckData || {};
    ctx.session.truckData.tripType = 'local';
    ctx.session.action = 'REG_TRUCK_CITY';
    await askChoice(ctx, `📍 *3/4* — ትራኩ ያለበት *ከተማ* ይምረጡ 👇`, LOCATIONS, 'TRKLOC_', 4);
    ctx.answerCbQuery();
});

bot.action('REG_TRIP_INTERCITY', async ctx => {
    ctx.session.truckData = ctx.session.truckData || {};
    ctx.session.truckData.tripType = 'intercity';
    ctx.session.action = 'REG_TRUCK_3';
    await ctx.reply(`🛣️ *3/4* — *የጉዞ መስመር* ያስገቡ\n\nምሳሌ: _ከ አዲስ አበባ ወደ ሀዋሳ_`, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

bot.action(/^TRKLOC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.truckData = ctx.session.truckData || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_TRUCK_CITY_TEXT';
        await ctx.reply(`📍 *ከተማ ያስገቡ*\n\nምሳሌ: _ለቡ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.truckData.route    = val;
        ctx.session.truckData.tripType = 'local';
        ctx.session.action = 'REG_TRUCK_4';
        await ctx.reply(`✅ ከተማ: *${val}*\n\n📞 *4/4* — *ስልክ ቁጥር* ያስገቡ\n\nምሳሌ: _0911234567_`, { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ──────────────────────────────────────────────────────────
// SELLER/LESSOR DASHBOARD (open or start registration)
// ──────────────────────────────────────────────────────────
async function openDashboard(ctx, Model, cardFn, kb, emptyAction, emptySession, askChoiceFn) {
    ctx.session.action = null;
    const items = await Model.find({ userId: ctx.from.id }).sort({ createdAt: -1 }).lean();
    if (!items.length) {
        ctx.session.action        = emptyAction;
        ctx.session[emptySession] = {};
        return askChoiceFn(ctx);
    }
    const active = items.filter(i => i.status === 'active').length;
    await ctx.reply(
        `👤 *የእርስዎ ምዝገባዎች*\n\n` +
        `ጠቅላላ: *${items.length}*  🟢 ዝግጁ: *${active}*  🔴 ያልዘጋ: *${items.length - active}*\n\n` +
        `✅ = ሲሸጡ/ሲኖር ይጫኑ  ❌ = ሲያልቅ ይጫኑ`,
        { parse_mode: 'Markdown' }
    );
    for (const it of items)
        await ctx.reply(cardFn(it, false), { parse_mode: 'Markdown', ...kb(it._id) });
}

bot.hears('🧱 ሲሚንቶ ለመሸጥ', ctx => openDashboard(
    ctx, CementSeller, cementCard, cementItemKb, 'REG_CEMENT_1', 'cementData',
    c => askChoice(c, `🧱 *ሲሚንቶ ምዝገባ — 1/4*\n\nየሲሚንቶ *አይነት* ይምረጡ 👇`, CEMENT_TYPES, 'CTYPE_', 3)
));
bot.hears('🟥 ብረት ለመሸጥ', ctx => openDashboard(
    ctx, SteelSeller, steelCard, steelItemKb, 'REG_STEEL_1', 'steelData',
    c => askChoice(c, `🟥 *ብረት ምዝገባ — 1/4*\n\nየብረት *ዲያሜትር* ይምረጡ 👇`, STEEL_TYPES, 'STYPE_', 3)
));
bot.hears('🔹 ማሽነሪ ለማከራየት', ctx => openDashboard(
    ctx, MachineryLeasor, macCard, macItemKb, 'REG_MACHINERY_1', 'machineryData',
    c => askChoice(c, `🔹 *ማሽነሪ ምዝገባ — 1/4*\n\nየማሽነሪ *አይነት* ይምረጡ 👇`, MACHINERY_TYPES, 'MTYPE_', 2)
));
bot.hears('🚚 መኪና ለማከራየት', ctx => openDashboard(
    ctx, TruckLeasor, truckCard, truckItemKb, 'REG_TRUCK_1', 'truckData',
    c => askChoice(c, `🚚 *ትራክ ምዝገባ — 1/4*\n\nየመኪናው *አይነት* ይምረጡ 👇`, TRUCK_TYPES, 'TKTYPE_', 3)
));

// ──────────────────────────────────────────────────────────
// BUYER/RENTER SEARCH FLOWS
// ──────────────────────────────────────────────────────────
bot.hears('🧱 ሲሚንቶ ለመግዛት', ctx => {
    ctx.session.action = 'BUY_CEMENT_1'; ctx.session.buyCement = {};
    askChoice(ctx, `🔍 *ሲሚንቶ ፍለጋ — 1/3*\n\nምን አይነት ሲሚንቶ ይፈልጋሉ? 👇`, CEMENT_TYPES, 'BCEM_', 3);
});
bot.hears('🟥 ብረት ለመግዛት', ctx => {
    ctx.session.action = 'BUY_STEEL_1'; ctx.session.buySteel = {};
    askChoice(ctx, `🔍 *ብረት ፍለጋ — 1/3*\n\nምን አይነት ብረት ይፈልጋሉ? 👇`, STEEL_TYPES, 'BSTL_', 3);
});
bot.hears('🔹 ማሽነሪ ለመከራየት', ctx => {
    ctx.session.action = 'RENT_MACHINERY_1'; ctx.session.rentMachinery = {};
    askChoice(ctx, `🔍 *ማሽነሪ ፍለጋ — 1/3*\n\nምን አይነት ማሽነሪ ይፈልጋሉ? 👇`, MACHINERY_TYPES, 'BMAC_', 2);
});
bot.hears('🚚 መኪና ለመከራየት', ctx => {
    ctx.session.action = 'RENT_TRUCK_1'; ctx.session.rentTruck = {};
    askChoice(ctx, `🔍 *ትራክ ፍለጋ — 1/3*\n\nምን አይነት ትራክ ይፈልጋሉ? 👇`, TRUCK_TYPES, 'BTRK_', 3);
});

// ──────────────────────────────────────────────────────────
// TEXT STATE MACHINE
// ──────────────────────────────────────────────────────────

// ── Error helpers — ሙቀት ያለው ፣ ግልጽ ─────────────────────
function errPrice(ctx, example = '650') {
    return ctx.reply(
        `⚠️ *ቁጥር ብቻ ያስገቡ!*\n\n` +
        `ምሳሌ: _${example}_\n` +
        `(ፊደል፣ ኮማ ወይም ምልክት አያስፈልግም)`,
        { parse_mode: 'Markdown' }
    );
}
function errPhone(ctx) {
    return ctx.reply(
        `⚠️ *ስልክ ቁጥር ትክክል አይደለም!*\n\n` +
        `ምሳሌ: _0911234567_ ወይም _+251911234567_`,
        { parse_mode: 'Markdown' }
    );
}
function isValidPhone(p) {
    return /^[\d\s\+\-\(\)]{7,20}$/.test(p);
}

bot.on('text', async (ctx, next) => {
    const rawText = ctx.message.text.trim();
    if (rawText.startsWith('/')) return next();
    const text   = sanitize(rawText);
    const action = ctx.session?.action;
    if (!action) return;
    const uid = ctx.from.id;

    try {
        // ══════════════════════════════════════════════════
        // CEMENT REGISTRATION (4 steps: type→location→phone→price)
        // ══════════════════════════════════════════════════
        if (action === 'REG_CEMENT_1' || action === 'REG_CEMENT_1_TEXT') {
            ctx.session.cementData = { type: text };
            ctx.session.action = 'REG_CEMENT_2';
            return askChoice(ctx,
                `✅ አይነት: *${text}*\n\n📍 *2/4* — ሲሚንቶው ያለበት *ቦታ* ይምረጡ 👇`,
                LOCATIONS, 'SLOC_', 4);
        }
        if (action === 'REG_CEMENT_2' || action === 'REG_CEMENT_2_TEXT') {
            ctx.session.cementData.location = text;
            ctx.session.action = 'REG_CEMENT_3';
            return ctx.reply(
                `✅ ቦታ: *${text}*\n\n📞 *3/4* — *ስልክ ቁጥር* ያስገቡ\n\nምሳሌ: _0911234567_`,
                { parse_mode: 'Markdown' }
            );
        }
        // ★ Step 3: Phone (was step 4) — company name removed ★
        if (action === 'REG_CEMENT_3') {
            const phone = safePhone(text);
            if (!isValidPhone(phone)) return errPhone(ctx);
            ctx.session.cementData.phone = phone;
            ctx.session.cementData.companyName = ctx.session.cementData.companyName || ctx.session.cementData.type;
            ctx.session.action = 'REG_CEMENT_4';
            return ctx.reply(
                `✅ ስልክ: *${phone}*\n\n💰 *4/4* — *ዋጋ* per ኩንታል ያስገቡ\n\nምሳሌ: _650_\n_(ቁጥር ብቻ)_`,
                { parse_mode: 'Markdown' }
            );
        }
        if (action === 'REG_CEMENT_4') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '650');
            const doc = await CementSeller.create({ ...ctx.session.cementData, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.cementData = {};
            await ctx.reply(
                `🎉 *ምዝገባ ተሳክቷል!*\n\nሲሚንቶዎ ለገዥዎች ይታያል። 👇`,
                { parse_mode: 'Markdown' }
            );
            return ctx.reply(cementCard(doc.toObject(), false), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
        }

        // ══ UPDATE CEMENT PRICE ════════════════════════════
        if (action === 'UPD_CEM_PRICE') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '650');
            const doc = await CementSeller.findByIdAndUpdate(ctx.session.targetItemId, { price }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ ምዝገባው አልተገኘም። ዳግም ይሞክሩ።');
            await ctx.reply(`✅ ዋጋ ወደ *${fmt(price)} ብር/ኩንታል* ተቀይሯል!`, { parse_mode: 'Markdown' });
            return ctx.reply(cementCard(doc.toObject(), false), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // BUY CEMENT (3 steps: type→location→phone)
        // ══════════════════════════════════════════════════
        if (action === 'BUY_CEMENT_1' || action === 'BUY_CEMENT_1_TEXT') {
            ctx.session.buyCement = { type: text };
            ctx.session.action = 'BUY_CEMENT_2';
            return askChoice(ctx,
                `✅ *${text}* ሲሚንቶ\n\n📍 *2/3* — ሲሚንቶው የሚፈልጉበት *ቦታ* ይምረጡ 👇`,
                LOCATIONS, 'BCEMLOC_', 4);
        }
        if (action === 'BUY_CEMENT_2' || action === 'BUY_CEMENT_2_TEXT') {
            ctx.session.buyCement.location = text;
            ctx.session.action = 'BUY_CEMENT_3';
            return ctx.reply(
                `✅ ቦታ: *${text}*\n\n📞 *3/3* — *ስልክ ቁጥርዎን* ያስገቡ\n\n_(ለፍለጋ ሪፖርት ብቻ — ለሻጩ አይሰጥም)_`,
                { parse_mode: 'Markdown' }
            );
        }
        if (action === 'BUY_CEMENT_3') {
            const { type, location } = ctx.session.buyCement;
            logSearch(ctx, '🧱 ሲሚንቶ ፈላጊ', `${type} | ${location}`, text);
            const results = await CementSeller.find({
                type: searchRx(type), location: searchRx(location), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (results.length) {
                await ctx.reply(`✅ *${results.length} ሻጭ ተገኝቷል!*\n\nዋጋ ከርካሽ ወደ ውድ 👇`, { parse_mode: 'Markdown' });
                for (const r of results) await ctx.reply(cementCardBuyer(r), { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(
                    `😔 *"${esc(type)}"* ሲሚንቶ — *${esc(location)}*\n\n` +
                    `ለጊዜው ሻጭ አልተገኘም። ሲኖር እናሳውቀዎታለን! 🔔`,
                    { parse_mode: 'Markdown' }
                );
            }
            await ctx.reply(supportLine, { parse_mode: 'Markdown' });
            ctx.session.action = null; ctx.session.buyCement = {};
            return;
        }

        // ══════════════════════════════════════════════════
        // TRUCK REGISTRATION (4 steps: type→tripType→route→phone)
        // ══════════════════════════════════════════════════
        if (action === 'REG_TRUCK_1' || action === 'REG_TRUCK_1_TEXT') {
            ctx.session.truckData = ctx.session.truckData || {};
            ctx.session.truckData.type = text;
            ctx.session.action = 'REG_TRUCK_TRIP_TYPE';
            return ctx.reply(
                `✅ አይነት: *${text}*\n\n🗺️ *2/4* — *የጉዞ አይነት* ይምረጡ:`,
                { parse_mode: 'Markdown',
                  ...Markup.inlineKeyboard([
                    [Markup.button.callback('🏙️ በከተማ ውስጥ',   'REG_TRIP_LOCAL')],
                    [Markup.button.callback('🛣️ ከተማ ወደ ከተማ', 'REG_TRIP_INTERCITY')]
                  ])
                }
            );
        }
        if (action === 'REG_TRUCK_CITY_TEXT') {
            ctx.session.truckData = ctx.session.truckData || {};
            ctx.session.truckData.route    = text;
            ctx.session.truckData.tripType = 'local';
            ctx.session.action = 'REG_TRUCK_4';
            return ctx.reply(`✅ ከተማ: *${text}*\n\n📞 *4/4* — *ስልክ ቁጥር* ያስገቡ\n\nምሳሌ: _0911234567_`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_TRUCK_3') {
            ctx.session.truckData = ctx.session.truckData || {};
            ctx.session.truckData.route = text;
            ctx.session.action = 'REG_TRUCK_4';
            return ctx.reply(`✅ መስመር: *${text}*\n\n📞 *4/4* — *ስልክ ቁጥር* ያስገቡ\n\nምሳሌ: _0911234567_`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_TRUCK_4') {
            ctx.session.truckData = ctx.session.truckData || {};
            const phone = safePhone(text);
            if (!isValidPhone(phone)) return errPhone(ctx);
            ctx.session.truckData.phone = phone;
            // plate default if not provided (was removed from flow)
            ctx.session.truckData.plate = ctx.session.truckData.plate || '—';
            const doc = await TruckLeasor.create({ ...ctx.session.truckData, userId: uid, status: 'active' });
            ctx.session.action = null; ctx.session.truckData = {};
            await ctx.reply(`🎉 *ምዝገባ ተሳክቷል!*\n\nትራኩ ለፈላጊዎች ይታያል። 👇`, { parse_mode: 'Markdown' });
            return ctx.reply(truckCard(doc.toObject(), false), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
        }

        // ══ UPDATE TRUCK ROUTE ════════════════════════════
        if (action === 'UPD_TRK_ROUTE') {
            const doc = await TruckLeasor.findByIdAndUpdate(ctx.session.targetItemId, { route: text }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ ምዝገባው አልተገኘም። ዳግም ይሞክሩ።');
            await ctx.reply(`✅ መስመር ወደ *"${esc(text)}"* ተቀይሯል!`, { parse_mode: 'Markdown' });
            return ctx.reply(truckCard(doc.toObject(), false), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // RENT TRUCK (3 steps: type→tripType+route→phone)
        // ══════════════════════════════════════════════════
        if (action === 'RENT_TRUCK_1' || action === 'RENT_TRUCK_1_TEXT') {
            ctx.session.rentTruck = ctx.session.rentTruck || {};
            ctx.session.rentTruck.type = text;
            ctx.session.action = 'RENT_TRUCK_TRIP_TYPE';
            return ctx.reply(
                `✅ *${text}*\n\n🗺️ *2/3* — *የጉዞ አይነት* ይምረጡ:`,
                { parse_mode: 'Markdown',
                  ...Markup.inlineKeyboard([
                    [Markup.button.callback('🏙️ በከተማ ውስጥ',   'RENT_TRIP_LOCAL')],
                    [Markup.button.callback('🛣️ ከተማ ወደ ከተማ', 'RENT_TRIP_INTERCITY')]
                  ])
                }
            );
        }
        if (action === 'RENT_TRUCK_CITY_TEXT') {
            ctx.session.rentTruck = ctx.session.rentTruck || {};
            ctx.session.rentTruck.route = text;
            ctx.session.action = 'RENT_TRUCK_3';
            return ctx.reply(`✅ ከተማ: *${text}*\n\n📞 *3/3* — *ስልክ ቁጥርዎን* ያስገቡ\n\n_(ለፍለጋ ሪፖርት ብቻ)_`, { parse_mode: 'Markdown' });
        }
        if (action === 'RENT_TRUCK_2' || action === 'RENT_TRUCK_2_FROM_TEXT') {
            ctx.session.rentTruck = ctx.session.rentTruck || {};
            ctx.session.rentTruck.routeFrom = text;
            ctx.session.action = 'RENT_TRUCK_2_TO';
            return askChoice(ctx, `✅ መነሻ: *${text}*\n\n🛣️ *ወዴት* ይሄዳሉ? 👇`, TRUCK_ROUTES_TO, 'BTRKTO_', 4);
        }
        if (action === 'RENT_TRUCK_2_TO' || action === 'RENT_TRUCK_2_TO_TEXT') {
            ctx.session.rentTruck = ctx.session.rentTruck || {};
            ctx.session.rentTruck.route = `ከ ${ctx.session.rentTruck.routeFrom || ''} ወደ ${text}`;
            ctx.session.action = 'RENT_TRUCK_3';
            return ctx.reply(
                `✅ መስመር: *ከ ${ctx.session.rentTruck.routeFrom || ''} ወደ ${text}*\n\n📞 *3/3* — *ስልክ ቁጥርዎን* ያስገቡ\n\n_(ለፍለጋ ሪፖርት ብቻ)_`,
                { parse_mode: 'Markdown' }
            );
        }
        if (action === 'RENT_TRUCK_3') {
            ctx.session.rentTruck = ctx.session.rentTruck || {};
            const { type, route, tripType, routeFrom } = ctx.session.rentTruck;
            logSearch(ctx, '🚚 ትራክ ፈላጊ', `${type} | ${tripType === 'local' ? '🏙️ ' : '🛣️ '}${route}`, text);

            let found = null;

            if (tripType === 'local') {
                found = await TruckLeasor.findOne({ tripType: 'local', route: searchRx(route), status: 'active' }).sort({ rentedCount: 1 });
                if (!found) found = await TruckLeasor.findOne({ route: searchRx(route), status: 'active' }).sort({ rentedCount: 1 });
            } else {
                const fromStr = routeFrom || route?.replace(/^ከ (.+) ወደ .+$/i, '$1').trim() || '';
                const toStr   = route?.replace(/^ከ .+ ወደ (.+)$/i, '$1').trim() || route || '';
                const fromRx  = fromStr ? searchRx(fromStr) : null;
                const toRx    = toStr   ? searchRx(toStr)   : null;

                if (fromRx && toRx) {
                    found = await TruckLeasor.findOne({ tripType: 'intercity', $and: [{ route: fromRx }, { route: toRx }], status: 'active' }).sort({ rentedCount: 1 });
                }
                if (!found && (fromRx || toRx)) {
                    found = await TruckLeasor.findOne({ tripType: 'intercity', route: fromRx || toRx, status: 'active' }).sort({ rentedCount: 1 });
                }
                if (!found && fromRx && toRx) {
                    found = await TruckLeasor.findOne({ $and: [{ route: fromRx }, { route: toRx }], status: 'active' }).sort({ rentedCount: 1 });
                }
                if (!found && (fromRx || toRx)) {
                    found = await TruckLeasor.findOne({ route: fromRx || toRx, status: 'active' }).sort({ rentedCount: 1 });
                }
            }

            if (found) {
                await ctx.reply(`✅ *ትራክ ተገኝቷል!* 👇`, { parse_mode: 'Markdown' });
                await ctx.reply(truckCardBuyer(found.toObject()), { parse_mode: 'Markdown' });
                TruckLeasor.findByIdAndUpdate(found._id, { $inc: { rentedCount: 1 } }).catch(() => {});
            } else {
                await ctx.reply(
                    `😔 *"${esc(type)}"* — ለጊዜው ዝግጁ ትራክ አልተገኘም።\n\nሲኖር እናሳውቀዎታለን! 🔔`,
                    { parse_mode: 'Markdown' }
                );
            }
            await ctx.reply(supportLine, { parse_mode: 'Markdown' });
            ctx.session.action = null; ctx.session.rentTruck = {};
            return;
        }

        // ══════════════════════════════════════════════════
        // STEEL REGISTRATION (4 steps)
        // ══════════════════════════════════════════════════
        if (action === 'REG_STEEL_1' || action === 'REG_STEEL_1_TEXT') {
            ctx.session.steelData = { type: text };
            ctx.session.action = 'REG_STEEL_2';
            return ctx.reply(`✅ አይነት: *${text}*\n\n📍 *2/4* — *አድራሻ* ያስገቡ\n\nምሳሌ: _ሜርካቶ, አዲስ አበባ_`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_2') {
            ctx.session.steelData.address = text;
            ctx.session.action = 'REG_STEEL_3';
            return ctx.reply(`✅ አድራሻ: *${text}*\n\n📞 *3/4* — *ስልክ ቁጥር* ያስገቡ\n\nምሳሌ: _0911234567_`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_3') {
            const phone = safePhone(text);
            if (!isValidPhone(phone)) return errPhone(ctx);
            ctx.session.steelData.phone = phone;
            ctx.session.action = 'REG_STEEL_4';
            return ctx.reply(`✅ ስልክ: *${phone}*\n\n💰 *4/4* — *ዋጋ* ያስገቡ\n\nምሳሌ: _5000_\n_(ቁጥር ብቻ)_`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_4') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '5000');
            const doc = await SteelSeller.create({ ...ctx.session.steelData, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.steelData = {};
            await ctx.reply(`🎉 *ምዝገባ ተሳክቷል!*\n\nብረቱ ለፈላጊዎች ይታያል። 👇`, { parse_mode: 'Markdown' });
            return ctx.reply(steelCard(doc.toObject(), false), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
        }

        // ══ UPDATE STEEL PRICE ════════════════════════════
        if (action === 'UPD_STL_PRICE') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '5000');
            const doc = await SteelSeller.findByIdAndUpdate(ctx.session.targetItemId, { price }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ ምዝገባው አልተገኘም። ዳግም ይሞክሩ።');
            await ctx.reply(`✅ ዋጋ ወደ *${fmt(price)} ብር* ተቀይሯል!`, { parse_mode: 'Markdown' });
            return ctx.reply(steelCard(doc.toObject(), false), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // BUY STEEL (3 steps: type→phone→search)
        // ══════════════════════════════════════════════════
        if (action === 'BUY_STEEL_1' || action === 'BUY_STEEL_1_TEXT') {
            ctx.session.buySteel = { type: text };
            ctx.session.action = 'BUY_STEEL_2';
            return ctx.reply(
                `✅ *${text}* ብረት\n\n📞 *2/3* — *ስልክ ቁጥርዎን* ያስገቡ\n\n_(ለፍለጋ ሪፖርት ብቻ — ለሻጩ አይሰጥም)_`,
                { parse_mode: 'Markdown' }
            );
        }
        if (action === 'BUY_STEEL_2') {
            logSearch(ctx, '🟥 ብረት ፈላጊ', ctx.session.buySteel.type, text);
            const results = await SteelSeller.find({
                type: searchRx(ctx.session.buySteel.type), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (results.length) {
                await ctx.reply(`✅ *${results.length} ሻጭ ተገኝቷል!*\n\nዋጋ ከርካሽ ወደ ውድ 👇`, { parse_mode: 'Markdown' });
                for (const r of results) await ctx.reply(steelCardBuyer(r), { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(
                    `😔 *"${esc(ctx.session.buySteel.type)}"*\n\nለጊዜው ሻጭ አልተገኘም። ሲኖር እናሳውቀዎታለን! 🔔`,
                    { parse_mode: 'Markdown' }
                );
            }
            await ctx.reply(supportLine, { parse_mode: 'Markdown' });
            ctx.session.action = null; ctx.session.buySteel = {};
            return;
        }

        // ══════════════════════════════════════════════════
        // MACHINERY REGISTRATION (4 steps)
        // ══════════════════════════════════════════════════
        if (action === 'REG_MACHINERY_1' || action === 'REG_MACHINERY_1_TEXT') {
            ctx.session.machineryData = { type: text };
            ctx.session.action = 'REG_MACHINERY_2';
            return ctx.reply(`✅ አይነት: *${text}*\n\n📍 *2/4* — *አድራሻ* ያስገቡ\n\nምሳሌ: _ቦሌ, አዲስ አበባ_`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_2') {
            ctx.session.machineryData.address = text;
            ctx.session.action = 'REG_MACHINERY_3';
            return ctx.reply(`✅ አድራሻ: *${text}*\n\n📞 *3/4* — *ስልክ ቁጥር* ያስገቡ\n\nምሳሌ: _0911234567_`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_3') {
            const phone = safePhone(text);
            if (!isValidPhone(phone)) return errPhone(ctx);
            ctx.session.machineryData.phone = phone;
            ctx.session.action = 'REG_MACHINERY_4';
            return ctx.reply(`✅ ስልክ: *${phone}*\n\n💰 *4/4* — *ኪራይ ዋጋ* ያስገቡ\n\nምሳሌ: _15000_\n_(ቁጥር ብቻ)_`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_4') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '15000');
            const doc = await MachineryLeasor.create({ ...ctx.session.machineryData, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.machineryData = {};
            await ctx.reply(`🎉 *ምዝገባ ተሳክቷል!*\n\nማሽነሪዎ ለፈላጊዎች ይታያል። 👇`, { parse_mode: 'Markdown' });
            return ctx.reply(macCard(doc.toObject(), false), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
        }

        // ══ UPDATE MACHINERY PRICE ════════════════════════
        if (action === 'UPD_MAC_PRICE') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '15000');
            const doc = await MachineryLeasor.findByIdAndUpdate(ctx.session.targetItemId, { price }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ ምዝገባው አልተገኘም። ዳግም ይሞክሩ።');
            await ctx.reply(`✅ ዋጋ ወደ *${fmt(price)} ብር* ተቀይሯል!`, { parse_mode: 'Markdown' });
            return ctx.reply(macCard(doc.toObject(), false), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // RENT MACHINERY (3 steps: type→phone→search)
        // ══════════════════════════════════════════════════
        if (action === 'RENT_MACHINERY_1' || action === 'RENT_MACHINERY_1_TEXT') {
            ctx.session.rentMachinery = { type: text };
            ctx.session.action = 'RENT_MACHINERY_2';
            return ctx.reply(
                `✅ *${text}*\n\n📞 *2/3* — *ስልክ ቁጥርዎን* ያስገቡ\n\n_(ለፍለጋ ሪፖርት ብቻ — ለሻጩ አይሰጥም)_`,
                { parse_mode: 'Markdown' }
            );
        }
        if (action === 'RENT_MACHINERY_2') {
            logSearch(ctx, '🔹 ማሽነሪ ፈላጊ', ctx.session.rentMachinery.type, text);
            const results = await MachineryLeasor.find({
                type: searchRx(ctx.session.rentMachinery.type), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (results.length) {
                await ctx.reply(`✅ *${results.length} ማሽነሪ ተገኝቷል!*\n\nዋጋ ከርካሽ ወደ ውድ 👇`, { parse_mode: 'Markdown' });
                for (const r of results) await ctx.reply(macCardBuyer(r), { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(
                    `😔 *"${esc(ctx.session.rentMachinery.type)}"*\n\nለጊዜው አልተገኘም። ሲኖር እናሳውቀዎታለን! 🔔`,
                    { parse_mode: 'Markdown' }
                );
            }
            await ctx.reply(supportLine, { parse_mode: 'Markdown' });
            ctx.session.action = null; ctx.session.rentMachinery = {};
            return;
        }

    } catch (err) {
        console.error('Handler error:', err);
        ctx.reply(
            `⚠️ ስህተት አጋጥሟል። ዳግም ለመሞከር 👇`,
            { parse_mode: 'Markdown', ...mainKb }
        ).catch(() => {});
    }
});

// ──────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLERS
// ──────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
    console.error(`Bot error [${ctx?.updateType}]:`, err);
    ctx?.reply?.('⚠️ ያልተጠበቀ ስህተት አጋጥሟል። እንደገና ይሞክሩ።').catch(() => {});
});
process.on('uncaughtException',  e => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', e => console.error('REJECTION:', e));

// ──────────────────────────────────────────────────────────
// HTTP SERVER + KEEP-ALIVE
// ──────────────────────────────────────────────────────────
http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Simple Marketplace Bot v8.0 — OK');
}).listen(PORT, '0.0.0.0', () => console.log(`🌐 HTTP :${PORT}`));

if (RENDER_URL) {
    const base = RENDER_URL.startsWith('http') ? RENDER_URL : `https://${RENDER_URL}`;
    setInterval(() => {
        http.get(base, r => console.log(`⏱️  ping → ${r.statusCode}`))
            .on('error', e => console.warn('ping err:', e.message));
    }, 14 * 60 * 1000);
    console.log(`🔄 Keep-alive → ${base}`);
} else {
    console.warn('⚠️  RENDER_EXTERNAL_URL not set — keep-alive disabled');
}

// ──────────────────────────────────────────────────────────
// LAUNCH
// ──────────────────────────────────────────────────────────
bot.launch({
    allowedUpdates: ['message', 'callback_query'],
    dropPendingUpdates: true
})
.then(() => console.log('🤖 Bot v8.0 launched!'))
.catch(err => { console.error('Launch failed:', err); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
