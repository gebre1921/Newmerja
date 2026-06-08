'use strict';

// ╔══════════════════════════════════════════════════════════════╗
// ║          Simple Marketplace Bot  v6.4  ✨                   ║
// ║      ሲሚንቶ  ·  ብረት  ·  ማሽነሪ  ·  ትራክ                        ║
// ╚══════════════════════════════════════════════════════════════╝

const { Telegraf, Markup } = require('telegraf');
const http     = require('http');
const mongoose = require('mongoose');
const crypto   = require('crypto');

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
    phone:       { type: String, default: '' },
    status:      { type: String, default: 'active', enum: ['active', 'off'] },
    rentedCount: { type: Number, default: 0 },
    createdAt:   { type: Date,   default: Date.now }
});
truckSchema.index({ type: 1, route: 1, status: 1 });

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
        await ctx.reply('⚠️ በጣም ብዙ ጥያቄ ልከዋል። ጥቂት ቆዩ።').catch(() => {});
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

// ──────────────────────────────────────────────────────────
// SMART SEARCH — bilingual + fuzzy + typo-tolerant
// ──────────────────────────────────────────────────────────
const SYNONYM_GROUPS = [
    // ── ሲሚንቶ brands
    ['ዳንጎቴ', 'dangote', 'dangoto', 'dangte'],
    ['ድሬ', 'dire', 'diredawa', 'ድሬዳዋ'],
    ['ናሽናል', 'national', 'nashenal'],
    ['ሙገር', 'mugher', 'muger'],
    ['ደርባ', 'derba'],
    ['ሲሚንቶ', 'cement', 'cemento', 'siminto'],

    // ── ብረት / Steel
    ['ብረት', 'steel', 'iron', 'bireet'],
    ['ቆርቆሮ', 'rod', 'bar', 'rebar'],
    ['ባለ 8', 'ባለ8', '8mm', '8 mm', 'bale 8', '8'],
    ['ባለ 10', 'ባለ10', '10mm', '10 mm', 'bale 10', '10'],
    ['ባለ 12', 'ባለ12', '12mm', '12 mm', 'bale 12', '12'],
    ['ባለ 14', 'ባለ14', '14mm', '14 mm', 'bale 14'],
    ['ባለ 16', 'ባለ16', '16mm', '16 mm', 'bale 16'],

    // ── ማሽነሪ
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

    // ── ትራክ / Truck types
    ['ሲኖትራክ', 'sinotruk', 'sino truck', 'sino', 'sinotruck', 'sino-truck'],
    ['ፎው', 'faw', 'faaw'],
    ['ኢሱዙ', 'isuzu', 'fsr', 'fsr isuzu'],
    ['ትራክ', 'truck', 'trak', 'lorry'],
    ['ተሳቢ', 'ተጎታች', 'trailer', 'semi trailer', 'semi-trailer',
     'trailor', 'treler', 'traylor', 'ሴሚ ትሬለር', 'ትሬለር', 'tirelar'],
    ['ቴምፖ', 'tempo', 'mini truck', 'pickup', 'ፒክአፕ', 'pick up'],
    ['ታንከር', 'tanker', 'water tanker', 'fuel tanker', 'ነዳጅ ታንከር'],
    ['ዳምፕ', 'dump truck', 'dumper', 'tipper', 'ዳምፐር', 'dump'],
    ['ፍላትቤድ', 'flatbed', 'flat bed', 'flat truck'],
    ['ክሬን ትራክ', 'crane truck', 'boom truck'],
    ['ፍሪጎ', 'frigo', 'refrigerated truck', 'cold truck', 'ቀዝቃዛ'],
    ['ሲሎ ትራክ', 'silo truck', 'silo', 'bulk truck', 'ሲሎ'],
    ['ኮንቴይነር', 'container truck', 'container', 'konteiner'],
    ['ሎ ቤድ ትራክ', 'low bed truck', 'lowbed truck', 'low loader', 'lowloader'],
    ['ካምፓክተር', 'compactor truck', 'garbage truck', 'refuse truck'],
    ['ካርጎ', 'cargo truck', 'cargo', 'box truck', 'closed truck', 'ዝግ ትራክ'],
    ['ቫኩም ታንከር', 'vacuum tanker', 'vacuum truck', 'ቆሻሻ ታንከር'],
    ['ካብ ትራክ', 'cab truck', 'tractor head', 'tractor unit', 'ትራክተር ሄድ'],
    ['ፒክ አፕ ካርጎ', 'pickup cargo', 'light truck'],
    ['ከብት መጫኛ', 'livestock truck', 'cattle truck', 'animal truck'],

    // ── ቦታዎች / Locations
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
    ['ወልኔት', 'welenet', 'welenta', 'ወለንጤ'],
    ['ዱቤ', 'dube', 'dubi'],
    ['ሀሮ ሳቢ', 'haro sabi', 'haro'],
    ['ሰቆጣ', 'sekota', 'seqota'],
    ['ላሊበላ', 'lalibela', 'lalibelaa'],
    ['ደብረ ብርሃን', 'debre birhan', 'debrebirhan', 'debirebirhan'],
    ['ደብረ ማርቆስ', 'debre markos', 'debremarkos'],
    ['ደብረ ታቦር', 'debre tabor', 'debretabor'],
    ['ቡታጅራ', 'butajira', 'butajera'],
    ['ሆሳዕና', 'hossana', 'hosana', 'hosanna'],
    ['ወጋ', 'wega', 'waga'],
    ['ጋምቤላ', 'gambela', 'gambella'],
    ['ነቀምት', 'nekemte', 'nekemt', 'naqamte'],
    ['ጊምቢ', 'gimbi', 'gimby'],
    ['ደምቢ ዶሎ', 'dembi dollo', 'dembidollo'],
    ['ይርጋ ጨፌ', 'yirgacheffe', 'yirga cheffe'],
    ['ሞያሌ', 'moyale', 'moyale border'],
    ['ቦረና', 'borena', 'borana'],
    ['ጂጂጋ', 'jijiga', 'jigjiga'],
    ['ሀረጌ', 'hararge', 'harar region'],
    ['ሱማሌ ክልል', 'somali region', 'ogaden'],
    ['ሸካ', 'sheka', 'masha', 'ማሻ'],
    ['ቤንሻንጉል', 'benshangul', 'benishangul', 'kamashi'],
    ['ኮሚቦልቻ', 'kombolcha', 'kembolcha'],
    ['ደሳ', 'desa', 'dessa'],
    ['ዓዋሽ', 'awash', 'awash arba'],
    ['ሚሌ', 'mile', 'mille'],
    ['ሰሜን ወሎ', 'north welo', 'n. welo'],

    // ── መስመሮች / Routes
    ['በከተማ ውስጥ', 'አዲስ አበባ ከተማ ውስጥ', 'in city', 'local', 'city', 'addis local', 'local delivery'],
];

const SYNONYM_LOOKUP = new Map();
for (let i = 0; i < SYNONYM_GROUPS.length; i++)
    for (const w of SYNONYM_GROUPS[i])
        SYNONYM_LOOKUP.set(w.toLowerCase(), i);

function editDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1]
                ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
}

function findClosestSynonym(raw) {
    const s = raw.trim().toLowerCase();
    let best = null, bestDist = Infinity;
    for (const word of SYNONYM_LOOKUP.keys()) {
        const maxDist = Math.max(1, Math.floor(word.length / 3));
        const d = editDistance(s, word);
        if (d <= maxDist && d < bestDist) {
            bestDist = d;
            best = word;
        }
    }
    if (!best) return null;
    const groupIdx = SYNONYM_LOOKUP.get(best);
    return SYNONYM_GROUPS[groupIdx];
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
    const patterns = alts.map(a => {
        return a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    return new RegExp(patterns.join('|'), 'i');
}

async function findTruck(type, route) {
    const typeRx  = searchRx(type);
    const routeRx = searchRx(route);

    let results = await TruckLeasor.find({
        type: typeRx, route: routeRx, status: 'active'
    }).sort({ rentedCount: 1 }).limit(5).lean();

    if (results.length) return results;

    results = await TruckLeasor.find({
        type: typeRx, status: 'active'
    }).sort({ rentedCount: 1 }).limit(5).lean();

    if (results.length) return results;

    results = await TruckLeasor.find({
        route: routeRx, status: 'active'
    }).sort({ rentedCount: 1 }).limit(5).lean();

    return results;
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
    'ኤክስካቫተር', 'ቡልዶዘር', 'ጂሬደር',
    'ሮለር', 'ሎደር', 'ክሬን', 'ሌላ'
];

const TRUCK_TYPES = [
    'ሲኖትራክ', 'FSR Isuzu', 'ተሳቢ', 'ሌላ'
];

// ተስተካክሏል: የጉዞ ዓይነቶች ግልጽ በሆነ አማርኛ ተተክተዋል
const TRUCK_TRIP_MODE = ['🏙️ አዲስ አበባ ከተማ ውስጥ', '🛣️ ከአንድ ከተማ ወደ ሌላ ከተማ'];

const TRUCK_ROUTES_FROM = [
    'አ.አ', 'ሀዋሳ', 'አዳማ', 'ባህርዳር', 'ጎንደር',
    'መቀሌ', 'ጅማ',  'ድሬዳዋ', 'ደሴ',   'ሌላ'
];

const TRUCK_ROUTES_TO = [
    'አ.አ', 'ሀዋሳ', 'አዳማ', 'ባህርዳር', 'ጎንደር',
    'መቀሌ', 'ጅማ',  'ድሬዳዋ', 'ደሴ',   'ሌላ'
];

const LOCATIONS = [
    'አዲስ አበባ', 'ሀዋሳ',  'አዳማ',   'ባህርዳር', 'ጎንደር',
    'መቀሌ',     'ጅማ',   'ድሬዳዋ',  'ደሴ',    'ሐረር',
    'ወልዲያ',    'ኮሚቦልቻ','ሻሸመኔ',  'ሞጆ',    'ሌላ'
];

// ──────────────────────────────────────────────────────────
// INLINE KEYBOARD BUILDERS
// ──────────────────────────────────────────────────────────
function choiceKbWithBack(options, prefix, cols = 3, backAction = 'go_home') {
    const rows = [];
    for (let i = 0; i < options.length; i += cols) {
        rows.push(options.slice(i, i + cols).map(o =>
            Markup.button.callback(o, `${prefix}${o}`)
        ));
    }
    // ተስተካክሏል: እያንዳንዱ ምርጫ ወደ ኋላ የሚመልስ በተን አለው
    rows.push([Markup.button.callback('⬅️ ወደ ኋላ', backAction)]);
    return Markup.inlineKeyboard(rows);
}

// ለጽሁፍ መመዝገቢያ ቦታዎች ሁሉ የምንጠቀመው ማቋረጫ / ወደ ኋላ መመለሻ
const cancelKb = Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ ወደ ኋላ', 'go_home')]
]);

const contactUsKb = Markup.inlineKeyboard([
    [Markup.button.callback('🏠 ወደ ዋና ማውጫ ተመለስ', 'go_home')]
]);

// ──────────────────────────────────────────────────────────
// STATUS BADGES
// ──────────────────────────────────────────────────────────
function statusBadge(status) {
    return status === 'active'
        ? '🟢 ክምችት አለ — ይሸጣል'
        : '🔴 ክምችት የለም — አይሸጥም';
}

function truckStatusBadge(status) {
    return status === 'active'
        ? '🟢 ዝግጁ ነው — ሊከራይ ይችላል'
        : '🔴 ስራ ላይ ነው — አይከራይም ❌';
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
        `▸ 🛣️ መስመር ፦ ${esc(it.route)}\n` +
        `▸ ${truckStatusBadge(it.status)}`
    );
}

function cementCard(it, adminView = false) {
    const badge = adminView
        ? (it.status === 'active' ? '✅ ክምችት አለ' : '❌ ክምችት የለም')
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
        ? (it.status === 'active' ? '✅ ክምችት አለ' : '❌ ክምችት የለም')
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
        ? (it.status === 'active' ? '✅ ዝግጁ ነው' : '❌ አይከራይም')
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
        ? (it.status === 'active' ? '✅ ዝግጁ ነው — ሊከራይ ይችላል' : '🔴 ስራ ላይ ነው — አይከራይም ❌')
        : truckStatusBadge(it.status);
    return (
        `🚚 *${esc(it.type)}*\n` +
        `▸ 🚗 ታርጋ  ፦ ${esc(it.plate)}\n` +
        `▸ 🛣️ መስመር ፦ ${esc(it.route)}\n` +
        `▸ 📞 ስልክ  ፦ \`${esc(it.phone)}\`\n` +
        `▸ ሁኔታ    ፦ ${badge}`
    );
}

// ──────────────────────────────────────────────────────────
// PER-ITEM KEYBOARDS
// ──────────────────────────────────────────────────────────
const cementItemKb  = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ክምችት አለ',      `cem_on_${id}`),
     Markup.button.callback('🔴 ክምችት የለም',     `cem_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',       `cem_price_${id}`),
     Markup.button.callback('➕ ሌላ ሲሚንቶ ጨምር', 'cem_add')]
]);
const steelItemKb   = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ክምችት አለ',     `stl_on_${id}`),
     Markup.button.callback('🔴 ክምችት የለም',    `stl_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',      `stl_price_${id}`),
     Markup.button.callback('➕ ሌላ ብረት ጨምር', 'stl_add')]
]);
const macItemKb     = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ዝግጁ ነው — ይከራያል',   `mac_on_${id}`),
     Markup.button.callback('🔴 ስራ ላይ — አይከራይም',   `mac_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',             `mac_price_${id}`),
     Markup.button.callback('➕ ሌላ ማሽነሪ ጨምር',      'mac_add')]
]);
const truckItemKb   = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ዝግጁ — ይከራያል', `trk_on_${id}`),
     Markup.button.callback('🔴 ስራ ላይ — አይከራይም', `trk_off_${id}`)],
    [Markup.button.callback('🗺️ መስመር ቀይር',  `trk_route_${id}`),
     Markup.button.callback('➕ ሌላ መኪና ጨምር', 'trk_add')]
]);

// ──────────────────────────────────────────────────────────
// MAIN KEYBOARD & HELPER FUNCTIONS
// ──────────────────────────────────────────────────────────
const mainKb = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ',    '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት',   '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ',     '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት'],
    ['📞 አግኙን']
]).resize();

async function deletePrev(ctx) {
    const msgId = ctx.session?.lastMsgId;
    if (msgId) {
        await ctx.telegram.deleteMessage(ctx.chat.id, msgId).catch(() => {});
        ctx.session.lastMsgId = null;
    }
}

// ተስተካክሏል: ማንኛውም text prompt 'ወደ ኋላ' በተን እንዲኖረው ያደርጋል
async function sendStep(ctx, text, extra = {}) {
    await deletePrev(ctx);
    const options = { parse_mode: 'Markdown', ...cancelKb, ...extra };
    const sent = await ctx.reply(text, options);
    ctx.session.lastMsgId = sent.message_id;
    return sent;
}

// ተስተካክሏል: ሁሉም ምርጫዎች Back በተን በ default ይጠቀማሉ
async function askChoice(ctx, prompt, options, prefix, cols = 3, backAction = 'go_home') {
    await deletePrev(ctx);
    const sent = await ctx.reply(prompt, { parse_mode: 'Markdown', ...choiceKbWithBack(options, prefix, cols, backAction) });
    ctx.session.lastMsgId = sent.message_id;
    return sent;
}

function isValidObjectId(id) {
    return /^[a-f\d]{24}$/i.test(id);
}

// ፕሮፌሽናል የመግቢያ ጽሁፍ
const welcomeText = (name) => 
    `👋 *ሰላም ${esc(name)}!*\n\n` +
    `✨ *እንኳን ወደ መረጃ Bot በደህና መጡ!* ✨\n\n` +
    `🏗️ ሲሚንቶ፣ ብረት፣ ማሽነሪ እና መኪና በተመጣጣኝ ዋጋ ለመገበያየት እና ለመከራየት የቀረበ ዘመናዊ መድረክ።\n\n` +
    `❓ *ምን ይፈልጋሉ?*\n_ከእርስዎ የሚጠበቀው ከታች ካሉት ቁልፎች የሚፈልጉትን መጫን ብቻ ነው_`;

// ──────────────────────────────────────────────────────────
// START
// ──────────────────────────────────────────────────────────
bot.start(ctx => {
    ctx.session = {};
    const name = sanitize(ctx.from.first_name || 'ጎብኚ');
    ctx.reply(welcomeText(name), { parse_mode: 'Markdown', ...mainKb });
});

bot.hears('📞 አግኙን', async ctx => {
    ctx.session.action = null;
    await ctx.reply(
        `📞 *አግኙን*\n\n` +
        `ለማዘዝ፣ ለጥያቄ ወይም ለድጋፍ ከዚህ ጋር ያነጋግሩን:\n\n` +
        `📱 *${SUPPORT_PHONE}*\n\n` +
        `_🕐 የስራ ሰዓት፦ ሁሌም ክፍት ነን!_`,
        { parse_mode: 'Markdown', ...contactUsKb }
    );
});

bot.action('go_home', async ctx => {
    await ctx.answerCbQuery();
    ctx.session.action = null;
    const name = sanitize(ctx.from.first_name || 'ጎብኚ');
    await ctx.reply(welcomeText(name), { parse_mode: 'Markdown', ...mainKb });
});

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
        `ጠቅላላ: *${items.length}* ✅ አለ: *${activeCount}* ❌ የለም: *${items.length - activeCount}*`,
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
        .sort({ createdAt
