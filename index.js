'use strict';

// ╔══════════════════════════════════════════════════════════════╗
// ║          Simple Marketplace Bot  v6.0  ✨                   ║
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
const rateLimitMap = new Map(); // userId → { count, resetAt }

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

// Clean rate limit map every 5 minutes
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
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // control chars
        .replace(/\$/g, '')      // MongoDB operator injection
        .replace(/\{|\}/g, '')   // JSON injection
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

// Search logs — TTL index auto-deletes after 24 hours
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
// BOT + SESSION (LRU in-memory cache)
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

    // ── Security: block bots
    if (ctx.from.is_bot) return;

    // ── Security: rate limit
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

// Ethiopian time (UTC+3) formatted timestamp
function ethTimestamp(date) {
    const d = new Date(date);
    // Add 3 hours for EAT
    const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${eat.getDate()}/${eat.getMonth()+1} ${pad(eat.getHours())}:${pad(eat.getMinutes())}`;
}

// ──────────────────────────────────────────────────────────
// SMART SEARCH — bilingual + fuzzy + typo-tolerant
// ──────────────────────────────────────────────────────────
const SYNONYM_GROUPS = [
    // ── ሲሚንቶ brands ──────────────────────────────────────────
    ['ዳንጎቴ', 'dangote', 'dangoto', 'dangte'],
    ['ድሬ', 'dire', 'diredawa', 'ድሬዳዋ'],
    ['ናሽናል', 'national', 'nashenal'],
    ['ሙገር', 'mugher', 'muger'],
    ['ደርባ', 'derba'],
    ['ሲሚንቶ', 'cement', 'cemento', 'siminto'],

    // ── ብረት / Steel ──────────────────────────────────────────
    ['ብረት', 'steel', 'iron', 'bireet'],
    ['ቆርቆሮ', 'rod', 'bar', 'rebar'],
    ['ባለ 8', 'ባለ8', '8mm', '8 mm', 'bale 8', '8'],
    ['ባለ 10', 'ባለ10', '10mm', '10 mm', 'bale 10', '10'],
    ['ባለ 12', 'ባለ12', '12mm', '12 mm', 'bale 12', '12'],
    ['ባለ 14', 'ባለ14', '14mm', '14 mm', 'bale 14'],
    ['ባለ 16', 'ባለ16', '16mm', '16 mm', 'bale 16'],

    // ── ማሽነሪ ──────────────────────────────────────────────────
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

    // ── ትራክ / Truck types ─────────────────────────────────────
    ['ሲኖትራክ', 'sinotruk', 'sino truck', 'sino'],
    ['ፎው', 'faw', 'faaw'],
    ['ኢሱዙ', 'isuzu'],
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

    // ── ቦታዎች / Locations ──────────────────────────────────────
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
    const patterns = alts.map(a => {
        const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return /[a-zA-Z]/.test(a) ? escaped.split('').join('.*') : escaped;
    });
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
const STEEL_TYPES  = ['ባለ 8', 'ባለ 10', 'ባለ 12', 'ባለ 14', 'ባለ 16', 'ቆርቆሮ (ሌላ)'];
const MACHINERY_TYPES = [
    'ኤክስካቫተር', 'ቡልዶዘር', 'ጂሬደር', 'ሮለር', 'ሎደር',
    'ክሬን', 'ኮንክሪት ሚክሰር', 'ፎርክሊፍት', 'ጀነሬተር', 'ፓምፕ', 'ሌላ'
];
const TRUCK_TYPES = [
    'ሲኖትራክ', 'ፎው', 'ኢሱዙ', 'ተሳቢ', 'ዳምፕ',
    'ታንከር', 'ቴምፖ', 'ፍላትቤድ', 'ፍሪጎ', 'ሲሎ', 'ኮንቴይነር', 'ሌላ'
];
const LOCATIONS = [
    'አዲስ አበባ', 'ሀዋሳ', 'አዳማ', 'ባህርዳር', 'ጎንደር',
    'መቀሌ', 'ጅማ', 'ድሬዳዋ', 'ደሴ', 'ሐረር', 'ሌላ'
];
const TRUCK_ROUTES_FROM = ['አ.አ', 'ሀዋሳ', 'አዳማ', 'ባህርዳር', 'ጎንደር', 'ጅማ', 'ድሬዳዋ', 'ሌላ'];
const TRUCK_ROUTES_TO   = ['ሀዋሳ', 'አዳማ', 'ባህርዳር', 'ጎንደር', 'ጅማ', 'ድሬዳዋ', 'አ.አ', 'ሌላ'];

// Build inline keyboard rows (max 3 per row)
function choiceKb(options, prefix, cols = 3) {
    const rows = [];
    for (let i = 0; i < options.length; i += cols) {
        rows.push(options.slice(i, i + cols).map(o =>
            Markup.button.callback(o, `${prefix}${o}`)
        ));
    }
    return Markup.inlineKeyboard(rows);
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

// Buyer-facing (no phone)
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

// Owner/Admin cards (with phone)
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
        `▸ 🛣️ መስመር ፦ ${esc(it.route)}\n` +
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
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

// ──────────────────────────────────────────────────────────
// HELPER — send choice buttons or fall back to text prompt
// ──────────────────────────────────────────────────────────
function askChoice(ctx, prompt, options, prefix, cols = 3) {
    return ctx.reply(prompt, { parse_mode: 'Markdown', ...choiceKb(options, prefix, cols) });
}

// ──────────────────────────────────────────────────────────
// SECURITY — validate ObjectId to prevent injection
// ──────────────────────────────────────────────────────────
function isValidObjectId(id) {
    return /^[a-f\d]{24}$/i.test(id);
}

// ──────────────────────────────────────────────────────────
// START
// ──────────────────────────────────────────────────────────
bot.start(ctx => {
    ctx.session = {};
    const name = sanitize(ctx.from.first_name || 'ጎብኚ');
    ctx.reply(
        `👋 *ሰላም ${esc(name)}!*\n\n` +
        `🏗️ *Simple Marketplace* — ሲሚንቶ፣ ብረት፣ ማሽነሪ፣ ትራክ\n\n` +
        `👇 ከታቹ ይምረጡ:`,
        { parse_mode: 'Markdown', ...mainKb }
    );
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

// ─── Search logs — TODAY ONLY ─────────────────────────────
bot.action('rep_searches', async ctx => {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx)) return ctx.reply('⛔');

    // Start of today in EAT (UTC+3)
    const now = new Date();
    const todayStartUTC = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0, 0, 0, 0
    ));
    // Subtract 3 hours to get EAT midnight in UTC
    todayStartUTC.setHours(todayStartUTC.getHours() - 3);

    const logs = await SearchLog.find({ createdAt: { $gte: todayStartUTC } })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();

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

    // Summary header
    const lines = [`📊 *የዛሬ ፍለጋ ሪፖርት* 📅 ${ethTimestamp(new Date())}`, `━━━━━━━━━━━━━━━━━━━━━`];
    for (const [cat, entries] of Object.entries(groups))
        lines.push(`${CAT_EMOJI[cat] || '🔍'} ${cat.replace(/^[^ ]+ /, '')} — *${entries.length} ፍለጋ*`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`🔢 ጠቅላላ ዛሬ: *${logs.length}*`);
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });

    // Per-category details — most recent first
    for (const [cat, entries] of Object.entries(groups)) {
        const emoji = CAT_EMOJI[cat] || '🔍';
        await ctx.reply(
            `${emoji}${emoji}${emoji} *${cat}* ${emoji}${emoji}${emoji}\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `📈 *${entries.length}* ፍለጋ`,
            { parse_mode: 'Markdown' }
        );
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

// ─── Admin delete ─────────────────────────────────────────
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
// PER-ITEM ACTIONS — STATUS TOGGLE & PRICE/ROUTE UPDATE
// ──────────────────────────────────────────────────────────
async function toggleItem(ctx, Model, id, newStatus, cardFn, kb) {
    if (!isValidObjectId(id)) { ctx.answerCbQuery('❗ Invalid ID'); return; }
    const doc = await Model.findOneAndUpdate(
        { _id: id, userId: ctx.from.id },  // owner-only update
        { status: newStatus },
        { new: true }
    );
    if (!doc) {
        // Try admin toggle
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

// ─── CEMENT ────────────────────────────────────────────────
bot.action(/^cem_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, CementSeller, ctx.match[1], 'active', cementCard, cementItemKb));
bot.action(/^cem_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, CementSeller, ctx.match[1], 'off',    cementCard, cementItemKb));

bot.action(/^cem_price_([a-f\d]{24})$/i, ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.action = 'UPD_CEM_PRICE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.session.targetOwner  = ctx.from.id;
    ctx.reply('💰 አዲሱን ዋጋ ያስገቡ _(per ኩንታል, ቁጥር ብቻ)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('cem_add', ctx => {
    ctx.session.action = 'REG_CEMENT_1';
    ctx.session.cementData = {};
    askChoice(ctx, '🧱 *አዲስ ሲሚንቶ ምዝገባ*\n\n`[1/5]` የሲሚንቶ አይነት ይምረጡ:', CEMENT_TYPES, 'CTYPE_', 3);
    ctx.answerCbQuery();
});

// ─── STEEL ─────────────────────────────────────────────────
bot.action(/^stl_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, SteelSeller, ctx.match[1], 'active', steelCard, steelItemKb));
bot.action(/^stl_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, SteelSeller, ctx.match[1], 'off',    steelCard, steelItemKb));

bot.action(/^stl_price_([a-f\d]{24})$/i, ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.action = 'UPD_STL_PRICE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply('💰 አዲሱን ዋጋ ያስገቡ _(ቁጥር ብቻ, ብር)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('stl_add', ctx => {
    ctx.session.action = 'REG_STEEL_1';
    ctx.session.steelData = {};
    askChoice(ctx, '🟥 *አዲስ ብረት ምዝገባ*\n\n`[1/4]` የብረት አይነት ይምረጡ:', STEEL_TYPES, 'STYPE_', 3);
    ctx.answerCbQuery();
});

// ─── MACHINERY ─────────────────────────────────────────────
bot.action(/^mac_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, MachineryLeasor, ctx.match[1], 'active', macCard, macItemKb));
bot.action(/^mac_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, MachineryLeasor, ctx.match[1], 'off',    macCard, macItemKb));

bot.action(/^mac_price_([a-f\d]{24})$/i, ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.action = 'UPD_MAC_PRICE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply('💰 አዲሱን ኪራይ ያስገቡ _(ቁጥር ብቻ, ብር)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('mac_add', ctx => {
    ctx.session.action = 'REG_MACHINERY_1';
    ctx.session.machineryData = {};
    askChoice(ctx, '🔹 *አዲስ ማሽነሪ ምዝገባ*\n\n`[1/4]` የማሽነሪ አይነት ይምረጡ:', MACHINERY_TYPES, 'MTYPE_', 2);
    ctx.answerCbQuery();
});

// ─── TRUCK ─────────────────────────────────────────────────
bot.action(/^trk_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, TruckLeasor, ctx.match[1], 'active', truckCard, truckItemKb));
bot.action(/^trk_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, TruckLeasor, ctx.match[1], 'off',    truckCard, truckItemKb));

bot.action(/^trk_route_([a-f\d]{24})$/i, ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.action = 'UPD_TRK_ROUTE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply('🗺️ አዲሱን የጉዞ መስመር ያስገቡ _(ለምሳሌ: ከ አ.አ ወደ ሀዋሳ)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('trk_add', ctx => {
    ctx.session.action = 'REG_TRUCK_1';
    ctx.session.truckData = {};
    askChoice(ctx, '🚚 *አዲስ ትራክ ምዝገባ*\n\n`[1/4]` የመኪናውን አይነት ይምረጡ:', TRUCK_TYPES, 'TKTYPE_', 3);
    ctx.answerCbQuery();
});

// ──────────────────────────────────────────────────────────
// DROPDOWN CALLBACK HANDLERS
// All prefixed: CTYPE_ SLOC_ STYPE_ MTYPE_ MLOC_ TKTYPE_ TKFROM_ TKTO_
//               BCEM_ BCEMLOC_ BSTL_ BMAC_ BTRK_ BTRKLOC_
// ──────────────────────────────────────────────────────────

// ── Cement Registration choices ───────────────────────────
bot.action(/^CTYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_CEMENT_1_TEXT';
        await ctx.reply('🧱 የሲሚንቶ አይነት ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
    } else {
        ctx.session.cementData = { type: val };
        ctx.session.action = 'REG_CEMENT_2';
        await askChoice(ctx, '`[2/5]` 📍 ቦታ ይምረጡ:', LOCATIONS, 'SLOC_', 3);
    }
    ctx.answerCbQuery();
});

bot.action(/^SLOC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_CEMENT_2_TEXT';
        await ctx.reply('📍 ቦታ ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
    } else {
        ctx.session.cementData.location = val;
        ctx.session.action = 'REG_CEMENT_3';
        await ctx.reply('`[3/5]` 🏭 የድርጅቱ ስም ያስገቡ:', { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── Steel Registration choices ────────────────────────────
bot.action(/^STYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ቆርቆሮ (ሌላ)' || val === 'ሌላ') {
        ctx.session.action = 'REG_STEEL_1_TEXT';
        await ctx.reply('🟥 የብረት አይነት ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
    } else {
        ctx.session.steelData = { type: val };
        ctx.session.action = 'REG_STEEL_2';
        await ctx.reply('`[2/4]` 📍 አድራሻ ያስገቡ:', { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── Machinery Registration choices ───────────────────────
bot.action(/^MTYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_MACHINERY_1_TEXT';
        await ctx.reply('🔹 የማሽነሪ አይነት ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
    } else {
        ctx.session.machineryData = { type: val };
        ctx.session.action = 'REG_MACHINERY_2';
        await ctx.reply('`[2/4]` 📍 አድራሻ ያስገቡ:', { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── Truck Registration choices ────────────────────────────
bot.action(/^TKTYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_TRUCK_1_TEXT';
        await ctx.reply('🚚 የመኪናውን አይነት ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
    } else {
        ctx.session.truckData = { type: val };
        ctx.session.action = 'REG_TRUCK_2';
        await ctx.reply('`[2/4]` 🚗 ታርጋ ቁጥር ያስገቡ:', { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── BUY CEMENT choices ────────────────────────────────────
bot.action(/^BCEM_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'BUY_CEMENT_1_TEXT';
        await ctx.reply('🧱 ምን አይነት ሲሚንቶ ይፈልጋሉ? ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
    } else {
        ctx.session.buyCement = { type: val };
        ctx.session.action = 'BUY_CEMENT_2';
        await askChoice(ctx, '`[2/3]` 📍 ሲሚንቶ የሚፈልጉበት ቦታ ይምረጡ:', LOCATIONS, 'BCEMLOC_', 3);
    }
    ctx.answerCbQuery();
});

bot.action(/^BCEMLOC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'BUY_CEMENT_2_TEXT';
        await ctx.reply('📍 ቦታ ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
    } else {
        ctx.session.buyCement.location = val;
        ctx.session.action = 'BUY_CEMENT_3';
        await ctx.reply('`[3/3]` 📞 ስልክ ቁጥርዎን ያስገቡ:', { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── BUY STEEL choices ─────────────────────────────────────
bot.action(/^BSTL_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ቆርቆሮ (ሌላ)' || val === 'ሌላ') {
        ctx.session.action = 'BUY_STEEL_1_TEXT';
        await ctx.reply('🟥 ምን አይነት ብረት ይፈልጋሉ? ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
    } else {
        ctx.session.buySteel = { type: val };
        ctx.session.action = 'BUY_STEEL_2';
        await ctx.reply('`[2/3]` 📍 ብረት የሚፈልጉበት ቦታ:', { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── RENT MACHINERY choices ────────────────────────────────
bot.action(/^BMAC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_MACHINERY_1_TEXT';
        await ctx.reply('🔹 ምን አይነት ማሽነሪ ይፈልጋሉ? ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentMachinery = { type: val };
        ctx.session.action = 'RENT_MACHINERY_2';
        await ctx.reply('`[2/3]` 📍 ማሽነሪ የሚፈልጉበት ቦታ:', { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── RENT TRUCK choices ────────────────────────────────────
bot.action(/^BTRK_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_TRUCK_1_TEXT';
        await ctx.reply('🚚 ምን አይነት መኪና ይፈልጋሉ? ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentTruck = { type: val };
        ctx.session.action = 'RENT_TRUCK_2';
        await askChoice(ctx, '`[2/3]` 🛣️ ከየት? (ጉዞ መነሻ):', TRUCK_ROUTES_FROM, 'BTRKLOC_', 4);
    }
    ctx.answerCbQuery();
});

bot.action(/^BTRKLOC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    const action = ctx.session.action;
    if (action === 'RENT_TRUCK_2') {
        if (val === 'ሌላ') {
            ctx.session.action = 'RENT_TRUCK_2_FROM_TEXT';
            await ctx.reply('🛣️ ከየት? (መነሻ ቦታ) ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
        } else {
            ctx.session.rentTruck.routeFrom = val;
            ctx.session.action = 'RENT_TRUCK_2_TO';
            await askChoice(ctx, '🛣️ ወዴት? (መድረሻ):', TRUCK_ROUTES_TO, 'BTRKTO_', 4);
        }
    }
    ctx.answerCbQuery();
});

bot.action(/^BTRKTO_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_TRUCK_2_TO_TEXT';
        await ctx.reply('🛣️ ወዴት? (መድረሻ ቦታ) ጽፈው ያስገቡ:', { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentTruck.route = `ከ ${ctx.session.rentTruck.routeFrom || ''} ወደ ${val}`;
        ctx.session.action = 'RENT_TRUCK_3';
        await ctx.reply('`[3/3]` 📞 ስልክ ቁጥርዎን ያስገቡ:', { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ──────────────────────────────────────────────────────────
// SELLER/LESSOR DASHBOARD
// ──────────────────────────────────────────────────────────
async function openDashboard(ctx, Model, cardFn, kb, emptyAction, emptySession, emptyMsg, askChoiceFn) {
    ctx.session.action = null;
    const items = await Model.find({ userId: ctx.from.id }).sort({ createdAt: -1 }).lean();
    if (!items.length) {
        ctx.session.action        = emptyAction;
        ctx.session[emptySession] = {};
        return askChoiceFn(ctx);
    }
    await ctx.reply(
        `👤 *የእርስዎ ምዝገባዎች* — ጠቅላላ: *${items.length}*\n\nሁኔታ ለመቀየር ✅/❌ ይጠቀሙ 👇`,
        { parse_mode: 'Markdown' }
    );
    for (const it of items)
        await ctx.reply(cardFn(it, false), { parse_mode: 'Markdown', ...kb(it._id) });
}

bot.hears('🧱 ሲሚንቶ ለመሸጥ', ctx => openDashboard(
    ctx, CementSeller, cementCard, cementItemKb, 'REG_CEMENT_1', 'cementData', 'ሲሚንቶ ምዝገባ',
    c => askChoice(c, '🧱 *ሲሚንቶ ምዝገባ*\n\n`[1/5]` የሲሚንቶ አይነት ይምረጡ:', CEMENT_TYPES, 'CTYPE_', 3)
));
bot.hears('🟥 ብረት ለመሸጥ', ctx => openDashboard(
    ctx, SteelSeller, steelCard, steelItemKb, 'REG_STEEL_1', 'steelData', 'ብረት ምዝገባ',
    c => askChoice(c, '🟥 *ብረት ምዝገባ*\n\n`[1/4]` የብረት አይነት ይምረጡ:', STEEL_TYPES, 'STYPE_', 3)
));
bot.hears('🔹 ማሽነሪ ለማከራየት', ctx => openDashboard(
    ctx, MachineryLeasor, macCard, macItemKb, 'REG_MACHINERY_1', 'machineryData', 'ማሽነሪ ምዝገባ',
    c => askChoice(c, '🔹 *ማሽነሪ ምዝገባ*\n\n`[1/4]` የማሽነሪ አይነት ይምረጡ:', MACHINERY_TYPES, 'MTYPE_', 2)
));
bot.hears('🚚 መኪና ለማከራየት', ctx => openDashboard(
    ctx, TruckLeasor, truckCard, truckItemKb, 'REG_TRUCK_1', 'truckData', 'ትራክ ምዝገባ',
    c => askChoice(c, '🚚 *ትራክ ምዝገባ*\n\n`[1/4]` የመኪናውን አይነት ይምረጡ:', TRUCK_TYPES, 'TKTYPE_', 3)
));

// ──────────────────────────────────────────────────────────
// BUYER/RENTER SEARCH FLOWS — start with dropdown
// ──────────────────────────────────────────────────────────
bot.hears('🧱 ሲሚንቶ ለመግዛት', ctx => {
    ctx.session.action = 'BUY_CEMENT_1'; ctx.session.buyCement = {};
    askChoice(ctx, '🔍 *ሲሚንቶ ፍለጋ*\n\n`[1/3]` ምን አይነት ሲሚንቶ ይፈልጋሉ?', CEMENT_TYPES, 'BCEM_', 3);
});
bot.hears('🟥 ብረት ለመግዛት', ctx => {
    ctx.session.action = 'BUY_STEEL_1'; ctx.session.buySteel = {};
    askChoice(ctx, '🔍 *ብረት ፍለጋ*\n\n`[1/3]` ምን አይነት ብረት ይፈልጋሉ?', STEEL_TYPES, 'BSTL_', 3);
});
bot.hears('🔹 ማሽነሪ ለመከራየት', ctx => {
    ctx.session.action = 'RENT_MACHINERY_1'; ctx.session.rentMachinery = {};
    askChoice(ctx, '🔍 *ማሽነሪ ፍለጋ*\n\n`[1/3]` ምን አይነት ማሽነሪ ይፈልጋሉ?', MACHINERY_TYPES, 'BMAC_', 2);
});
bot.hears('🚚 መኪና ለመከራየት', ctx => {
    ctx.session.action = 'RENT_TRUCK_1'; ctx.session.rentTruck = {};
    askChoice(ctx, '🔍 *ትራክ ፍለጋ*\n\n`[1/3]` ምን አይነት መኪና ይፈልጋሉ?', TRUCK_TYPES, 'BTRK_', 3);
});

// ──────────────────────────────────────────────────────────
// TEXT STATE MACHINE
// ──────────────────────────────────────────────────────────
bot.on('text', async (ctx, next) => {
    const rawText = ctx.message.text.trim();
    if (rawText.startsWith('/')) return next();
    const text   = sanitize(rawText);
    const action = ctx.session?.action;
    if (!action) return;
    const uid = ctx.from.id;

    const step  = (cur, total, label) => `\`[${cur}/${total}]\` ${label}`;
    const supportLine =
        `\n📞 *ለማዘዝ ወይም ለተጨማሪ ድጋፍ:*\n` +
        `👉 \`${SUPPORT_PHONE}\``;

    try {

        // ══ CEMENT REGISTRATION — text fallbacks ══════════
        if (action === 'REG_CEMENT_1' || action === 'REG_CEMENT_1_TEXT') {
            ctx.session.cementData = { type: text };
            ctx.session.action = 'REG_CEMENT_2';
            return askChoice(ctx, step(2, 5, '📍 ያለበት ቦታ ይምረጡ:'), LOCATIONS, 'SLOC_', 3);
        }
        if (action === 'REG_CEMENT_2' || action === 'REG_CEMENT_2_TEXT') {
            ctx.session.cementData.location = text;
            ctx.session.action = 'REG_CEMENT_3';
            return ctx.reply(step(3, 5, '🏭 የድርጅቱ ስም ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_CEMENT_3') {
            ctx.session.cementData.companyName = text;
            ctx.session.action = 'REG_CEMENT_4';
            return ctx.reply(step(4, 5, '📞 ስልክ ቁጥር ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_CEMENT_4') {
            ctx.session.cementData.phone = safePhone(text);
            ctx.session.action = 'REG_CEMENT_5';
            return ctx.reply(step(5, 5, '💰 ዋጋ per ኩንታል _(ቁጥር ብቻ — ለምሳሌ: 650)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_CEMENT_5') {
            const price = safePrice(text);
            if (!price) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ (1 - 10,000,000):');
            const doc = await CementSeller.create({ ...ctx.session.cementData, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.cementData = {};
            await ctx.reply(`🎉 *ምዝገባ ተሳክቷል!*\n\nሲሚንቶዎ ለገዥዎች ይታያል። ሁኔታ ለመቀየር 👇`, { parse_mode: 'Markdown' });
            return ctx.reply(cementCard(doc.toObject(), false), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
        }

        // ══ UPDATE CEMENT PRICE ════════════════════════════
        if (action === 'UPD_CEM_PRICE') {
            const price = safePrice(text);
            if (!price) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await CementSeller.findOneAndUpdate(
                { _id: ctx.session.targetItemId },
                { price }, { new: true }
            );
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ አልተገኘም።');
            await ctx.reply(`✅ ዋጋ → *${fmt(price)} ብር/ኩንታል*`, { parse_mode: 'Markdown' });
            return ctx.reply(cementCard(doc.toObject(), false), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
        }

        // ══ BUY CEMENT — text fallbacks ═══════════════════
        if (action === 'BUY_CEMENT_1' || action === 'BUY_CEMENT_1_TEXT') {
            ctx.session.buyCement = { type: text };
            ctx.session.action = 'BUY_CEMENT_2';
            return askChoice(ctx, step(2, 3, '📍 ሲሚንቶ የሚፈልጉበት ቦታ ይምረጡ:'), LOCATIONS, 'BCEMLOC_', 3);
        }
        if (action === 'BUY_CEMENT_2' || action === 'BUY_CEMENT_2_TEXT') {
            ctx.session.buyCement.location = text;
            ctx.session.action = 'BUY_CEMENT_3';
            return ctx.reply(step(3, 3, '📞 ስልክ ቁጥርዎን ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'BUY_CEMENT_3') {
            const { type, location } = ctx.session.buyCement;
            logSearch(ctx, '🧱 ሲሚንቶ ፈላጊ', `${type} | ${location}`, text);
            const results = await CementSeller.find({
                type: searchRx(type), location: searchRx(location), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (results.length) {
                await ctx.reply(`✅ *${results.length} ሻጭ ተገኝቷል!* 👇`, { parse_mode: 'Markdown' });
                for (const r of results)
                    await ctx.reply(cementCardBuyer(r), { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(`😔 *"${esc(type)}"* — *${esc(location)}*\n\nለጊዜው አልተገኘም። ሲኖር እናሳውቀዎታለን! 🔔`, { parse_mode: 'Markdown' });
            }
            await ctx.reply(supportLine, { parse_mode: 'Markdown' });
            ctx.session.action = null; ctx.session.buyCement = {};
            return;
        }

        // ══ TRUCK REGISTRATION — text fallbacks ═══════════
        if (action === 'REG_TRUCK_1' || action === 'REG_TRUCK_1_TEXT') {
            ctx.session.truckData = { type: text };
            ctx.session.action = 'REG_TRUCK_2';
            return ctx.reply(step(2, 4, '🚗 ታርጋ ቁጥር ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_TRUCK_2') {
            ctx.session.truckData.plate = text.toUpperCase().slice(0, 15);
            ctx.session.action = 'REG_TRUCK_3';
            return ctx.reply(step(3, 4, '🛣️ የጉዞ መስመር ያስገቡ _(ለምሳሌ: ከ አ.አ ወደ ሀዋሳ)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_TRUCK_3') {
            ctx.session.truckData.route = text;
            ctx.session.action = 'REG_TRUCK_4';
            return ctx.reply(step(4, 4, '📞 ስልክ ቁጥር ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_TRUCK_4') {
            ctx.session.truckData.phone = safePhone(text);
            const doc = await TruckLeasor.create({ ...ctx.session.truckData, userId: uid, status: 'active' });
            ctx.session.action = null; ctx.session.truckData = {};
            await ctx.reply(`🎉 *ምዝገባ ተሳክቷል!*\n\nትራኩ ለፈላጊዎች ይታያል። 👇`, { parse_mode: 'Markdown' });
            return ctx.reply(truckCard(doc.toObject(), false), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
        }

        // ══ UPDATE TRUCK ROUTE ════════════════════════════
        if (action === 'UPD_TRK_ROUTE') {
            const doc = await TruckLeasor.findByIdAndUpdate(ctx.session.targetItemId, { route: text }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ አልተገኘም።');
            await ctx.reply(`✅ መስመር → *"${esc(text)}"*`, { parse_mode: 'Markdown' });
            return ctx.reply(truckCard(doc.toObject(), false), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
        }

        // ══ RENT TRUCK — text fallbacks & route assembly ══
        if (action === 'RENT_TRUCK_1' || action === 'RENT_TRUCK_1_TEXT') {
            ctx.session.rentTruck = { type: text };
            ctx.session.action = 'RENT_TRUCK_2';
            return askChoice(ctx, step(2, 3, '🛣️ ከየት? (ጉዞ መነሻ):'), TRUCK_ROUTES_FROM, 'BTRKLOC_', 4);
        }
        if (action === 'RENT_TRUCK_2' || action === 'RENT_TRUCK_2_FROM_TEXT') {
            ctx.session.rentTruck.routeFrom = text;
            ctx.session.action = 'RENT_TRUCK_2_TO';
            return askChoice(ctx, '🛣️ ወዴት? (መድረሻ):', TRUCK_ROUTES_TO, 'BTRKTO_', 4);
        }
        if (action === 'RENT_TRUCK_2_TO' || action === 'RENT_TRUCK_2_TO_TEXT') {
            ctx.session.rentTruck.route = `ከ ${ctx.session.rentTruck.routeFrom || ''} ወደ ${text}`;
            ctx.session.action = 'RENT_TRUCK_3';
            return ctx.reply(step(3, 3, '📞 ስልክ ቁጥርዎን ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'RENT_TRUCK_3') {
            const { type, route } = ctx.session.rentTruck;
            logSearch(ctx, '🚚 ትራክ ፈላጊ', `${type} | ${route}`, text);
            const found = await TruckLeasor.findOne({
                type: searchRx(type), route: searchRx(route), status: 'active'
            }).sort({ rentedCount: 1 });

            if (found) {
                await ctx.reply(`✅ *ትራክ ተገኝቷል!* 👇`, { parse_mode: 'Markdown' });
                await ctx.reply(truckCardBuyer(found.toObject()), { parse_mode: 'Markdown' });
                TruckLeasor.findByIdAndUpdate(found._id, { $inc: { rentedCount: 1 } }).catch(() => {});
            } else {
                await ctx.reply(`😔 *"${esc(type)}"* — *${esc(route)}*\n\nለጊዜው ዝግጁ ትራክ አልተገኘም። ሲኖር እናሳውቀዎታለን! 🔔`, { parse_mode: 'Markdown' });
            }
            await ctx.reply(supportLine, { parse_mode: 'Markdown' });
            ctx.session.action = null; ctx.session.rentTruck = {};
            return;
        }

        // ══ STEEL REGISTRATION — text fallbacks ═══════════
        if (action === 'REG_STEEL_1' || action === 'REG_STEEL_1_TEXT') {
            ctx.session.steelData = { type: text };
            ctx.session.action = 'REG_STEEL_2';
            return ctx.reply(step(2, 4, '📍 አድራሻ ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_2') {
            ctx.session.steelData.address = text;
            ctx.session.action = 'REG_STEEL_3';
            return ctx.reply(step(3, 4, '📞 ስልክ ቁጥር ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_3') {
            ctx.session.steelData.phone = safePhone(text);
            ctx.session.action = 'REG_STEEL_4';
            return ctx.reply(step(4, 4, '💰 ዋጋ _(ቁጥር ብቻ, ብር)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_4') {
            const price = safePrice(text);
            if (!price) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await SteelSeller.create({ ...ctx.session.steelData, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.steelData = {};
            await ctx.reply(`🎉 *ምዝገባ ተሳክቷል!*\n\nብረቱ ለፈላጊዎች ይታያል። 👇`, { parse_mode: 'Markdown' });
            return ctx.reply(steelCard(doc.toObject(), false), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
        }

        // ══ UPDATE STEEL PRICE ════════════════════════════
        if (action === 'UPD_STL_PRICE') {
            const price = safePrice(text);
            if (!price) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await SteelSeller.findByIdAndUpdate(ctx.session.targetItemId, { price }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ አልተገኘም።');
            await ctx.reply(`✅ ዋጋ → *${fmt(price)} ብር*`, { parse_mode: 'Markdown' });
            return ctx.reply(steelCard(doc.toObject(), false), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
        }

        // ══ BUY STEEL — text fallbacks ════════════════════
        if (action === 'BUY_STEEL_1' || action === 'BUY_STEEL_1_TEXT') {
            ctx.session.buySteel = { type: text };
            ctx.session.action = 'BUY_STEEL_2';
            return ctx.reply(step(2, 3, '📍 ብረት የሚፈልጉበት ቦታ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'BUY_STEEL_2') {
            ctx.session.buySteel.location = text;
            ctx.session.action = 'BUY_STEEL_3';
            return ctx.reply(step(3, 3, '📞 ስልክ ቁጥርዎን ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'BUY_STEEL_3') {
            logSearch(ctx, '🟥 ብረት ፈላጊ', ctx.session.buySteel.type, text);
            const results = await SteelSeller.find({
                type: searchRx(ctx.session.buySteel.type), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (results.length) {
                await ctx.reply(`✅ *${results.length} ሻጭ ተገኝቷል!* 👇`, { parse_mode: 'Markdown' });
                for (const r of results)
                    await ctx.reply(steelCardBuyer(r), { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(`😔 *"${esc(ctx.session.buySteel.type)}"* ለጊዜው አልተገኘም። ሲኖር እናሳውቀዎታለን! 🔔`, { parse_mode: 'Markdown' });
            }
            await ctx.reply(supportLine, { parse_mode: 'Markdown' });
            ctx.session.action = null; ctx.session.buySteel = {};
            return;
        }

        // ══ MACHINERY REGISTRATION — text fallbacks ═══════
        if (action === 'REG_MACHINERY_1' || action === 'REG_MACHINERY_1_TEXT') {
            ctx.session.machineryData = { type: text };
            ctx.session.action = 'REG_MACHINERY_2';
            return ctx.reply(step(2, 4, '📍 አድራሻ ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_2') {
            ctx.session.machineryData.address = text;
            ctx.session.action = 'REG_MACHINERY_3';
            return ctx.reply(step(3, 4, '📞 ስልክ ቁጥር ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_3') {
            ctx.session.machineryData.phone = safePhone(text);
            ctx.session.action = 'REG_MACHINERY_4';
            return ctx.reply(step(4, 4, '💰 ኪራይ ዋጋ _(ቁጥር ብቻ, ብር)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_4') {
            const price = safePrice(text);
            if (!price) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await MachineryLeasor.create({ ...ctx.session.machineryData, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.machineryData = {};
            await ctx.reply(`🎉 *ምዝገባ ተሳክቷል!*\n\nማሽነሪዎ ለፈላጊዎች ይታያል። 👇`, { parse_mode: 'Markdown' });
            return ctx.reply(macCard(doc.toObject(), false), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
        }

        // ══ UPDATE MACHINERY PRICE ════════════════════════
        if (action === 'UPD_MAC_PRICE') {
            const price = safePrice(text);
            if (!price) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await MachineryLeasor.findByIdAndUpdate(ctx.session.targetItemId, { price }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ አልተገኘም።');
            await ctx.reply(`✅ ዋጋ → *${fmt(price)} ብር*`, { parse_mode: 'Markdown' });
            return ctx.reply(macCard(doc.toObject(), false), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
        }

        // ══ RENT MACHINERY — text fallbacks ═══════════════
        if (action === 'RENT_MACHINERY_1' || action === 'RENT_MACHINERY_1_TEXT') {
            ctx.session.rentMachinery = { type: text };
            ctx.session.action = 'RENT_MACHINERY_2';
            return ctx.reply(step(2, 3, '📍 ማሽነሪ የሚፈልጉበት ቦታ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'RENT_MACHINERY_2') {
            ctx.session.rentMachinery.location = text;
            ctx.session.action = 'RENT_MACHINERY_3';
            return ctx.reply(step(3, 3, '📞 ስልክ ቁጥርዎን ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'RENT_MACHINERY_3') {
            logSearch(ctx, '🔹 ማሽነሪ ፈላጊ', ctx.session.rentMachinery.type, text);
            const results = await MachineryLeasor.find({
                type: searchRx(ctx.session.rentMachinery.type), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (results.length) {
                await ctx.reply(`✅ *${results.length} ማሽነሪ ተገኝቷል!* 👇`, { parse_mode: 'Markdown' });
                for (const r of results)
                    await ctx.reply(macCardBuyer(r), { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(`😔 *"${esc(ctx.session.rentMachinery.type)}"* ለጊዜው አልተገኘም። ሲኖር እናሳውቀዎታለን! 🔔`, { parse_mode: 'Markdown' });
            }
            await ctx.reply(supportLine, { parse_mode: 'Markdown' });
            ctx.session.action = null; ctx.session.rentMachinery = {};
            return;
        }

    } catch (err) {
        console.error('Handler error:', err);
        ctx.reply('⚠️ ስህተት አጋጥሟል። እንደገና ይሞክሩ።').catch(() => {});
    }
});

// ──────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLERS
// ──────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
    console.error(`Bot error [${ctx?.updateType}]:`, err);
    ctx?.reply?.('⚠️ ያልተጠበቀ ስህተት አጋጥሟል።').catch(() => {});
});
process.on('uncaughtException',  e => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', e => console.error('REJECTION:', e));

// ──────────────────────────────────────────────────────────
// HTTP SERVER + KEEP-ALIVE
// ──────────────────────────────────────────────────────────
http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Simple Marketplace Bot v6.0 — OK');
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
.then(() => console.log('🤖 Bot v6.0 launched!'))
.catch(err => { console.error('Launch failed:', err); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
