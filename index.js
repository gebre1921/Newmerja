'use strict';

// ╔══════════════════════════════════════════════════════════════╗
// ║          Simple Marketplace Bot  v9.0  ✨                   ║
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
// SECURITY
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

const MAX_INPUT_LEN = 200;
function sanitize(input) {
    if (typeof input !== 'string') return '';
    return input.slice(0, MAX_INPUT_LEN)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/\$/g, '').replace(/\{|\}/g, '').trim();
}
function safePhone(p) {
    return sanitize(p).replace(/[^\d\s\+\-\(\)]/g, '').slice(0, 20);
}
function safePrice(text) {
    const price = parseFloat(String(text).replace(/,/g, '').replace(/[^\d.]/g, ''));
    if (isNaN(price) || price <= 0 || price > 10_000_000) return null;
    return price;
}
function isValidPhone(p) {
    return /^[\d\s\+\-\(\)]{7,20}$/.test(p);
}
function isValidObjectId(id) {
    return /^[a-f\d]{24}$/i.test(id);
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
    createdAt:   { type: Date, default: Date.now }
});
cementSchema.index({ type: 1, location: 1, status: 1 });

const steelSchema = new mongoose.Schema({
    userId:    { type: Number, required: true, index: true },
    type:      { type: String, default: '' },
    address:   { type: String, default: '' },
    phone:     { type: String, default: '' },
    price:     { type: Number, default: 0 },
    status:    { type: String, default: 'active', enum: ['active', 'off'] },
    createdAt: { type: Date, default: Date.now }
});
steelSchema.index({ type: 1, status: 1 });

const machinerySchema = new mongoose.Schema({
    userId:    { type: Number, required: true, index: true },
    type:      { type: String, default: '' },
    address:   { type: String, default: '' },
    phone:     { type: String, default: '' },
    price:     { type: Number, default: 0 },
    status:    { type: String, default: 'active', enum: ['active', 'off'] },
    createdAt: { type: Date, default: Date.now }
});
machinerySchema.index({ type: 1, status: 1 });

const truckSchema = new mongoose.Schema({
    userId:      { type: Number, required: true, index: true },
    type:        { type: String, default: '' },
    plate:       { type: String, default: '—' },
    route:       { type: String, default: '' },
    tripType:    { type: String, default: 'intercity', enum: ['local', 'intercity'] },
    phone:       { type: String, default: '' },
    status:      { type: String, default: 'active', enum: ['active', 'off'] },
    rentedCount: { type: Number, default: 0 },
    createdAt:   { type: Date, default: Date.now }
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
        await ctx.reply('⏳ ጥቂት ቆዩ፣ ዳግም ይሞክሩ።').catch(() => {});
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

const supportLine =
    `\n━━━━━━━━━━━━━━━━━\n` +
    `📞 *ለማዘዝ ወይም ለጥያቄ:*\n` +
    `👉 \`${SUPPORT_PHONE}\``;

// ──────────────────────────────────────────────────────────
// SMART SEARCH
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
    ['ባለ 8', 'ባለ8', '8mm', 'bale 8', '8'],
    ['ባለ 10', 'ባለ10', '10mm', 'bale 10', '10'],
    ['ባለ 12', 'ባለ12', '12mm', 'bale 12', '12'],
    ['ባለ 14', 'ባለ14', '14mm', 'bale 14'],
    ['ባለ 16', 'ባለ16', '16mm', 'bale 16'],
    ['ማሽነሪ', 'machinery', 'machine', 'mashineri'],
    ['ኤክስካቫተር', 'excavator', 'exkavator', 'digger'],
    ['ቡልዶዘር', 'bulldozer', 'buldozer'],
    ['ጂሬደር', 'grader', 'motor grader'],
    ['ክሬን', 'crane'],
    ['ሮለር', 'roller', 'compactor'],
    ['ሎደር', 'loader', 'wheel loader'],
    ['ኮንክሪት ሚክሰር', 'concrete mixer', 'mixer'],
    ['ጀነሬተር', 'generator', 'genset'],
    ['ፓምፕ', 'pump', 'water pump'],
    ['ፎርክሊፍት', 'forklift'],
    ['ቪብሬተር', 'vibrator'],
    ['ዌልደር', 'welder'],
    ['ኤር ኮምፕሬሰር', 'air compressor', 'compressor'],
    ['ሚኒ ኤክስካቫተር', 'mini excavator'],
    ['ሎ ቤድ', 'low bed', 'lowbed'],
    ['ሲኖትራክ', 'sinotruk', 'sino truck'],
    ['ፎው', 'faw'],
    ['ኢሱዙ', 'isuzu'],
    ['FSR', 'fsr', 'isuzu fsr'],
    ['ትራክ', 'truck', 'trak', 'lorry'],
    ['ተሳቢ', 'ተጎታች', 'trailer', 'semi trailer', 'treler'],
    ['ዳምፕ', 'dump truck', 'dumper', 'tipper'],
    ['ታንከር', 'tanker', 'water tanker'],
    ['ካርጎ', 'cargo truck', 'cargo', 'box truck'],
    ['ፍላትቤድ', 'flatbed', 'flat bed'],
    ['ሎ ቤድ ትራክ', 'low bed truck', 'low loader'],
    ['ሲሎ ትራክ', 'silo truck', 'bulk truck'],
    ['ኮንቴይነር', 'container truck', 'container'],
    ['ቴምፖ', 'tempo', 'mini truck', 'pickup'],
    ['አዲስ አበባ', 'addis ababa', 'addis', 'አ.አ', 'aa'],
    ['ሀዋሳ', 'hawasa', 'hawassa'],
    ['አዳማ', 'adama', 'nazret', 'ናዝሬት'],
    ['ባህርዳር', 'bahir dar', 'bahirdar'],
    ['ጎንደር', 'gondar', 'gonder'],
    ['መቀሌ', 'mekelle', 'mekele'],
    ['ጅማ', 'jimma', 'jima'],
    ['ድሬዳዋ', 'dire dawa', 'diredawa'],
    ['ደሴ', 'desse', 'dessie'],
    ['ሐረር', 'harar', 'harer'],
    ['ኮሚቦልቻ', 'kombolcha', 'kembolcha'],
    ['ወልዲያ', 'woldia', 'woldiya'],
    ['ሻሸመኔ', 'shashemene', 'shashamane'],
    ['ነቀምት', 'nekemte', 'nekemt'],
    ['ጂጂጋ', 'jijiga', 'jigjiga'],
    ['ሞያሌ', 'moyale'],
    ['ሞጆ', 'mojo'],
    ['ደብረ ብርሃን', 'debre birhan'],
    ['ደብረ ማርቆስ', 'debre markos'],
    ['ሁመራ', 'humera'],
    ['መተማ', 'metema'],
    ['ጋምቤላ', 'gambela'],
    ['አሶሳ', 'assosa'],
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
        for (const w of SYNONYM_GROUPS[SYNONYM_LOOKUP.get(s)]) alts.add(w.toLowerCase());
    }
    for (const [word, groupIdx] of SYNONYM_LOOKUP.entries()) {
        const maxDist = Math.max(1, Math.floor(word.length / 4));
        if (editDistance(s, word) <= maxDist) {
            for (const w of SYNONYM_GROUPS[groupIdx]) alts.add(w.toLowerCase());
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
        phone:       safePhone(phone || '')
    }).catch(() => {});
}

// ──────────────────────────────────────────────────────────
// DROPDOWN OPTION LISTS
// ──────────────────────────────────────────────────────────
const CEMENT_TYPES = ['ዳንጎቴ', 'ድሬ', 'ናሽናል', 'ሙገር', 'ደርባ', 'ሌላ'];
const STEEL_TYPES  = ['ባለ 8', 'ባለ 10', 'ባለ 12', 'ባለ 14', 'ባለ 16', 'ቆርቆሮ (ሌላ)'];
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
const TRUCK_ROUTES = [
    'አ.አ',     'ሀዋሳ',    'አዳማ',     'ባህርዳር',
    'ጎንደር',   'መቀሌ',    'ጅማ',      'ድሬዳዋ',
    'ደሴ',     'ሐረር',    'ኮሚቦልቻ',   'ወልዲያ',
    'ሻሸመኔ',  'ነቀምት',   'ጂጂጋ',     'ሞያሌ',
    'ሞጆ',     'ሁመራ',   'መተማ',     'ጭልጋ',
    'ሌላ'
];

// ──────────────────────────────────────────────────────────
// KEYBOARD HELPERS
// ──────────────────────────────────────────────────────────
function choiceKb(options, prefix, cols = 3) {
    const rows = [];
    for (let i = 0; i < options.length; i += cols)
        rows.push(options.slice(i, i + cols).map(o => Markup.button.callback(o, `${prefix}${o}`)));
    return Markup.inlineKeyboard(rows);
}
function askChoice(ctx, prompt, options, prefix, cols = 3) {
    return ctx.reply(prompt, { parse_mode: 'Markdown', ...choiceKb(options, prefix, cols) });
}

// ──────────────────────────────────────────────────────────
// CARD FORMATTERS
// ──────────────────────────────────────────────────────────
function statusBadge(s) { return s === 'active' ? '🟢 አለ' : '🔴 የለም'; }
function truckBadge(s)  { return s === 'active' ? '🟢 ዝግጁ' : '🔴 ስራ ላይ'; }

function cementCard(it, adminView = false) {
    return (
        `🧱 *${esc(it.type)}*\n` +
        `📍 ${esc(it.location)}\n` +
        `📞 \`${esc(it.phone)}\`\n` +
        `💰 *${fmt(it.price)} ብር/ኩንታል*\n` +
        `${adminView ? (it.status==='active'?'✅ አለ':'❌ የለም') : statusBadge(it.status)}`
    );
}
function steelCard(it, adminView = false) {
    return (
        `🟥 *${esc(it.type)}*\n` +
        `📍 ${esc(it.address)}\n` +
        `📞 \`${esc(it.phone)}\`\n` +
        `💰 *${fmt(it.price)} ብር*\n` +
        `${adminView ? (it.status==='active'?'✅ አለ':'❌ የለም') : statusBadge(it.status)}`
    );
}
function macCard(it, adminView = false) {
    return (
        `🔹 *${esc(it.type)}*\n` +
        `📍 ${esc(it.address)}\n` +
        `📞 \`${esc(it.phone)}\`\n` +
        `💰 *${fmt(it.price)} ብር*\n` +
        `${adminView ? (it.status==='active'?'✅ አለ':'❌ የለም') : statusBadge(it.status)}`
    );
}
function truckCard(it, adminView = false) {
    return (
        `🚚 *${esc(it.type)}*\n` +
        `${it.tripType === 'local' ? '🏙️ ከተማ' : '🛣️ መስመር'}: ${esc(it.route)}\n` +
        `📞 \`${esc(it.phone)}\`\n` +
        `${adminView ? (it.status==='active'?'✅ ዝግጁ':'🔴 ስራ ላይ') : truckBadge(it.status)}`
    );
}

// ── Buyer cards (no phone) ────────────────────────────────
function cementCardBuyer(it) {
    return `🧱 *${esc(it.type)}*  📍 ${esc(it.location)}\n💰 *${fmt(it.price)} ብር/ኩንታል*  ${statusBadge(it.status)}`;
}
function steelCardBuyer(it) {
    return `🟥 *${esc(it.type)}*  📍 ${esc(it.address)}\n💰 *${fmt(it.price)} ብር*  ${statusBadge(it.status)}`;
}
function macCardBuyer(it) {
    return `🔹 *${esc(it.type)}*  📍 ${esc(it.address)}\n💰 *${fmt(it.price)} ብር*  ${statusBadge(it.status)}`;
}
function truckCardBuyer(it) {
    return `🚚 *${esc(it.type)}*\n${it.tripType === 'local' ? '🏙️ ከተማ' : '🛣️ መስመር'}: ${esc(it.route)}  ${truckBadge(it.status)}`;
}

// ──────────────────────────────────────────────────────────
// PER-ITEM KEYBOARDS
// ──────────────────────────────────────────────────────────
const cementItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ',       `cem_on_${id}`),
     Markup.button.callback('❌ የለም',      `cem_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር', `cem_price_${id}`),
     Markup.button.callback('➕ ሌላ ጨምር', 'cem_add')]
]);
const steelItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ',       `stl_on_${id}`),
     Markup.button.callback('❌ የለም',      `stl_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር', `stl_price_${id}`),
     Markup.button.callback('➕ ሌላ ጨምር', 'stl_add')]
]);
const macItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ',       `mac_on_${id}`),
     Markup.button.callback('❌ የለም',      `mac_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር', `mac_price_${id}`),
     Markup.button.callback('➕ ሌላ ጨምር', 'mac_add')]
]);
const truckItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅ ዝግጁ',     `trk_on_${id}`),
     Markup.button.callback('🔴 ስራ ላይ',  `trk_off_${id}`)],
    [Markup.button.callback('🗺️ መስመር ቀይር',`trk_route_${id}`),
     Markup.button.callback('➕ ሌላ ጨምር', 'trk_add')]
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

// ──────────────────────────────────────────────────────────
// ERROR HELPERS
// ──────────────────────────────────────────────────────────
function errPrice(ctx, ex = '650') {
    return ctx.reply(`⚠️ ቁጥር ብቻ ያስገቡ!\nምሳሌ: _${ex}_`, { parse_mode: 'Markdown' });
}
function errPhone(ctx) {
    return ctx.reply(`⚠️ ስልክ ቁጥር ትክክል አይደለም!\nምሳሌ: _0911234567_`, { parse_mode: 'Markdown' });
}

// ──────────────────────────────────────────────────────────
// START
// ──────────────────────────────────────────────────────────
bot.start(ctx => {
    ctx.session = {};
    const name = esc(sanitize(ctx.from.first_name || 'ወዳጄ'));
    ctx.reply(
        `👋 *ሰላም ${name}!*\n\n🧱 ሲሚንቶ · 🟥 ብረት · 🔹 ማሽነሪ · 🚚 ትራክ\n\n👇 ምን ይፈልጋሉ?`,
        { parse_mode: 'Markdown', ...mainKb }
    );
});

bot.command('help', ctx => showHelp(ctx));
bot.hears('❓ እርዳታ', ctx => showHelp(ctx));
function showHelp(ctx) {
    ctx.session = {};
    ctx.reply(
        `❓ *እርዳታ*\n\n` +
        `*ለፈላጊዎች 👇*\n` +
        `▸ ሲሚንቶ / ብረት / ማሽነሪ / ትራክ ለማግኘት — ቀኝ ያሉትን ይምረጡ\n\n` +
        `*ለሻጮች/አከራዮች 👇*\n` +
        `▸ ሸቀጥ ወይም ማሽነሪ ለማስተዋወቅ — ግራ ያሉትን ይምረጡ\n\n` +
        `📋 ምዝገባ ለማየት — "📋 የእኔ ምዝገባዎች"\n\n` +
        `📞 ለጥያቄ: \`${SUPPORT_PHONE}\``,
        { parse_mode: 'Markdown', ...mainKb }
    );
}

// ──────────────────────────────────────────────────────────
// MY LISTINGS
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
    if (total === 0)
        return ctx.reply(`📋 ምንም ምዝገባ የለም።\n\n👇 ለማስመዝገብ ይምረጡ`, { parse_mode: 'Markdown', ...mainKb });

    const activeCount = [...cements, ...steels, ...machs, ...trucks].filter(i => i.status === 'active').length;
    await ctx.reply(
        `📋 *የእኔ ምዝገባዎች* — ጠቅላላ: *${total}*  🟢 *${activeCount}*  🔴 *${total - activeCount}*`,
        { parse_mode: 'Markdown' }
    );
    for (const it of cements) await ctx.reply(cementCard(it), { parse_mode: 'Markdown', ...cementItemKb(it._id) });
    for (const it of steels)  await ctx.reply(steelCard(it),  { parse_mode: 'Markdown', ...steelItemKb(it._id) });
    for (const it of machs)   await ctx.reply(macCard(it),    { parse_mode: 'Markdown', ...macItemKb(it._id) });
    for (const it of trucks)  await ctx.reply(truckCard(it),  { parse_mode: 'Markdown', ...truckItemKb(it._id) });
}

// ──────────────────────────────────────────────────────────
// TOGGLE / UPDATE HELPERS
// ──────────────────────────────────────────────────────────
async function toggleItem(ctx, Model, id, newStatus, cardFn, kb) {
    if (!isValidObjectId(id)) return ctx.answerCbQuery('❗ Invalid ID');
    let doc = await Model.findOneAndUpdate({ _id: id, userId: ctx.from.id }, { status: newStatus }, { new: true });
    if (!doc && isAdmin(ctx))
        doc = await Model.findByIdAndUpdate(id, { status: newStatus }, { new: true });
    if (!doc) return ctx.answerCbQuery('❗ ፈቃድ የለዎትም');
    const label = newStatus === 'active' ? '✅ "አለ" ተቀይሯል!' : '🔴 "የለም" ተቀይሯል!';
    ctx.editMessageText(cardFn(doc.toObject()), { parse_mode: 'Markdown', ...kb(doc._id) })
       .catch(() => ctx.reply(cardFn(doc.toObject()), { parse_mode: 'Markdown', ...kb(doc._id) }));
    ctx.answerCbQuery(label);
}

// ── Cement toggles ────────────────────────────────────────
bot.action(/^cem_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, CementSeller, ctx.match[1], 'active', cementCard, cementItemKb));
bot.action(/^cem_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, CementSeller, ctx.match[1], 'off',    cementCard, cementItemKb));
bot.action(/^cem_price_([a-f\d]{24})$/i, ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.action = 'UPD_CEM_PRICE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply(`💰 አዲሱን ዋጋ ያስገቡ (ብር/ኩንታል)\nምሳሌ: _650_`, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('cem_add', ctx => {
    ctx.session.action = 'REG_CEMENT_1'; ctx.session.cementData = {};
    askChoice(ctx, `🧱 *ሲሚንቶ ምዝገባ*\nአይነት ይምረጡ 👇`, CEMENT_TYPES, 'CTYPE_', 3);
    ctx.answerCbQuery();
});

// ── Steel toggles ─────────────────────────────────────────
bot.action(/^stl_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, SteelSeller, ctx.match[1], 'active', steelCard, steelItemKb));
bot.action(/^stl_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, SteelSeller, ctx.match[1], 'off',    steelCard, steelItemKb));
bot.action(/^stl_price_([a-f\d]{24})$/i, ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.action = 'UPD_STL_PRICE'; ctx.session.targetItemId = ctx.match[1];
    ctx.reply(`💰 አዲሱን ዋጋ ያስገቡ (ብር)\nምሳሌ: _5000_`, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('stl_add', ctx => {
    ctx.session.action = 'REG_STEEL_1'; ctx.session.steelData = {};
    askChoice(ctx, `🟥 *ብረት ምዝገባ*\nዲያሜትር ይምረጡ 👇`, STEEL_TYPES, 'STYPE_', 3);
    ctx.answerCbQuery();
});

// ── Machinery toggles ─────────────────────────────────────
bot.action(/^mac_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, MachineryLeasor, ctx.match[1], 'active', macCard, macItemKb));
bot.action(/^mac_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, MachineryLeasor, ctx.match[1], 'off',    macCard, macItemKb));
bot.action(/^mac_price_([a-f\d]{24})$/i, ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.action = 'UPD_MAC_PRICE'; ctx.session.targetItemId = ctx.match[1];
    ctx.reply(`💰 አዲሱን ኪራይ ያስገቡ (ብር)\nምሳሌ: _15000_`, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('mac_add', ctx => {
    ctx.session.action = 'REG_MACHINERY_1'; ctx.session.machineryData = {};
    askChoice(ctx, `🔹 *ማሽነሪ ምዝገባ*\nአይነት ይምረጡ 👇`, MACHINERY_TYPES, 'MTYPE_', 2);
    ctx.answerCbQuery();
});

// ── Truck toggles ─────────────────────────────────────────
bot.action(/^trk_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, TruckLeasor, ctx.match[1], 'active', truckCard, truckItemKb));
bot.action(/^trk_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, TruckLeasor, ctx.match[1], 'off',    truckCard, truckItemKb));
bot.action(/^trk_route_([a-f\d]{24})$/i, async ctx => {
    if (!isValidObjectId(ctx.match[1])) return ctx.answerCbQuery('❗');
    ctx.session.action = 'UPD_TRK_ROUTE';
    ctx.session.targetItemId = ctx.match[1];
    await ctx.reply(`🗺️ *የጉዞ አይነት ይምረጡ:*`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🏙️ ከተማ ውስጥ',   `UPD_TRIP_LOCAL_${ctx.match[1]}`)],
            [Markup.button.callback('🛣️ ከተማ ወደ ከተማ', `UPD_TRIP_INTERCITY_${ctx.match[1]}`)]
        ])
    });
    ctx.answerCbQuery();
});
bot.action(/^UPD_TRIP_LOCAL_([a-f\d]{24})$/i, async ctx => {
    const id = ctx.match[1];
    await TruckLeasor.findByIdAndUpdate(id, { tripType: 'local' });
    ctx.session.action = 'UPD_TRK_ROUTE_TEXT';
    ctx.session.targetItemId = id;
    ctx.session.truckTripType = 'local';
    await ctx.reply(`📍 ትራኩ ያለበት ከተማ ያስገቡ\nምሳሌ: _አዲስ አበባ_`, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action(/^UPD_TRIP_INTERCITY_([a-f\d]{24})$/i, async ctx => {
    const id = ctx.match[1];
    await TruckLeasor.findByIdAndUpdate(id, { tripType: 'intercity' });
    ctx.session.action = 'UPD_TRK_ROUTE_TEXT';
    ctx.session.targetItemId = id;
    ctx.session.truckTripType = 'intercity';
    await ctx.reply(`🛣️ አዲሱን መስመር ያስገቡ\nምሳሌ: _ከ አዲስ አበባ ወደ ሀዋሳ_`, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('trk_add', ctx => {
    ctx.session.action = 'REG_TRUCK_1'; ctx.session.truckData = {};
    askChoice(ctx, `🚚 *ትራክ ምዝገባ*\nአይነት ይምረጡ 👇`, TRUCK_TYPES, 'TKTYPE_', 3);
    ctx.answerCbQuery();
});

// ──────────────────────────────────────────────────────────
// DROPDOWN CALLBACKS — Registration
// ──────────────────────────────────────────────────────────

// ── Cement type ───────────────────────────────────────────
bot.action(/^CTYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.cementData = ctx.session.cementData || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_CEMENT_1_TEXT';
        await ctx.reply(`🧱 አይነት ያስገቡ:\nምሳሌ: _ፍቅር ሲሚንቶ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.cementData.type = val;
        ctx.session.action = 'REG_CEMENT_2';
        await askChoice(ctx, `✅ *${val}*\n📍 ቦታ ይምረጡ 👇`, LOCATIONS, 'SLOC_', 4);
    }
    ctx.answerCbQuery();
});

// ── Cement location ───────────────────────────────────────
bot.action(/^SLOC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.cementData = ctx.session.cementData || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_CEMENT_2_TEXT';
        await ctx.reply(`📍 ቦታ ያስገቡ:\nምሳሌ: _ካዛንቺስ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.cementData.location = val;
        ctx.session.action = 'REG_CEMENT_3';
        await ctx.reply(`✅ *${val}*\n📞 ስልክ ቁጥር ያስገቡ:`, { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── Steel type ────────────────────────────────────────────
bot.action(/^STYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ቆርቆሮ (ሌላ)' || val === 'ሌላ') {
        ctx.session.action = 'REG_STEEL_1_TEXT';
        await ctx.reply(`🟥 አይነት ያስገቡ:\nምሳሌ: _ባለ 20_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.steelData = { type: val };
        ctx.session.action = 'REG_STEEL_2';
        await ctx.reply(`✅ *${val}*\n📍 አድራሻ ያስገቡ:`, { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── Machinery type ────────────────────────────────────────
bot.action(/^MTYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_MACHINERY_1_TEXT';
        await ctx.reply(`🔹 አይነት ያስገቡ:\nምሳሌ: _ስካፎልዲንግ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.machineryData = { type: val };
        ctx.session.action = 'REG_MACHINERY_2';
        await ctx.reply(`✅ *${val}*\n📍 አድራሻ ያስገቡ:`, { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ── Truck type ────────────────────────────────────────────
bot.action(/^TKTYPE_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.truckData = ctx.session.truckData || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_TRUCK_1_TEXT';
        await ctx.reply(`🚚 አይነት ያስገቡ:\nምሳሌ: _ኢቬኮ_`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.truckData.type = val;
        ctx.session.action = 'REG_TRUCK_TRIP';
        await ctx.reply(`✅ *${val}*\n🗺️ የጉዞ አይነት ይምረጡ:`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🏙️ ከተማ ውስጥ',   'REG_TRIP_LOCAL')],
                [Markup.button.callback('🛣️ ከተማ ወደ ከተማ', 'REG_TRIP_INTERCITY')]
            ])
        });
    }
    ctx.answerCbQuery();
});

// ── Truck trip types ──────────────────────────────────────
bot.action('REG_TRIP_LOCAL', async ctx => {
    ctx.session.truckData = ctx.session.truckData || {};
    ctx.session.truckData.tripType = 'local';
    ctx.session.action = 'REG_TRUCK_CITY';
    await askChoice(ctx, `📍 ከተማ ይምረጡ 👇`, LOCATIONS, 'TRKLOC_', 4);
    ctx.answerCbQuery();
});
bot.action('REG_TRIP_INTERCITY', async ctx => {
    ctx.session.truckData = ctx.session.truckData || {};
    ctx.session.truckData.tripType = 'intercity';
    ctx.session.action = 'REG_TRUCK_FROM';
    await askChoice(ctx, `🛣️ *ከየት?* 👇`, TRUCK_ROUTES, 'TRKFROM_', 4);
    ctx.answerCbQuery();
});
bot.action(/^TRKLOC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.truckData = ctx.session.truckData || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_TRUCK_CITY_TEXT';
        await ctx.reply(`📍 ከተማ ያስገቡ:`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.truckData.route = val;
        ctx.session.action = 'REG_TRUCK_PHONE';
        await ctx.reply(`✅ *${val}*\n📞 ስልክ ቁጥር ያስገቡ:`, { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});
bot.action(/^TRKFROM_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.truckData = ctx.session.truckData || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_TRUCK_FROM_TEXT';
        await ctx.reply(`🛣️ መነሻ ቦታ ያስገቡ:`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.truckData.routeFrom = val;
        ctx.session.action = 'REG_TRUCK_TO';
        await askChoice(ctx, `✅ ከ *${val}*\n🛣️ *ወዴት?* 👇`, TRUCK_ROUTES, 'TRKTO_', 4);
    }
    ctx.answerCbQuery();
});
bot.action(/^TRKTO_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.truckData = ctx.session.truckData || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_TRUCK_TO_TEXT';
        await ctx.reply(`🛣️ መድረሻ ቦታ ያስገቡ:`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.truckData.route = `ከ ${ctx.session.truckData.routeFrom || ''} ወደ ${val}`;
        ctx.session.action = 'REG_TRUCK_PHONE';
        await ctx.reply(`✅ *ከ ${ctx.session.truckData.routeFrom || ''} ወደ ${val}*\n📞 ስልክ ቁጥር ያስገቡ:`, { parse_mode: 'Markdown' });
    }
    ctx.answerCbQuery();
});

// ──────────────────────────────────────────────────────────
// DROPDOWN CALLBACKS — Buyer Search
// ──────────────────────────────────────────────────────────

// ── Buy Cement ────────────────────────────────────────────
bot.action(/^BCEM_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'BUY_CEMENT_1_TEXT';
        await ctx.reply(`🧱 ምን አይነት ሲሚንቶ ይፈልጋሉ?`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.buyCement = { type: val };
        ctx.session.action = 'BUY_CEMENT_LOC';
        await askChoice(ctx, `✅ *${val}*\n📍 ቦታ ይምረጡ 👇`, LOCATIONS, 'BCEMLOC_', 4);
    }
    ctx.answerCbQuery();
});
bot.action(/^BCEMLOC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.buyCement = ctx.session.buyCement || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'BUY_CEMENT_LOC_TEXT';
        await ctx.reply(`📍 ቦታ ያስገቡ:`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.buyCement.location = val;
        await doCementSearch(ctx);
    }
    ctx.answerCbQuery();
});

// ── Buy Steel ─────────────────────────────────────────────
bot.action(/^BSTL_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ቆርቆሮ (ሌላ)' || val === 'ሌላ') {
        ctx.session.action = 'BUY_STEEL_TEXT';
        await ctx.reply(`🟥 ምን አይነት ብረት ይፈልጋሉ?`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.buySteel = { type: val };
        await doSteelSearch(ctx);
    }
    ctx.answerCbQuery();
});

// ── Rent Machinery ────────────────────────────────────────
bot.action(/^BMAC_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_MAC_TEXT';
        await ctx.reply(`🔹 ምን አይነት ማሽነሪ ይፈልጋሉ?`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentMachinery = { type: val };
        await doMacSearch(ctx);
    }
    ctx.answerCbQuery();
});

// ── Rent Truck ────────────────────────────────────────────
bot.action(/^BTRK_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_TRUCK_TEXT';
        await ctx.reply(`🚚 ምን አይነት ትራክ ይፈልጋሉ?`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentTruck.type = val;
        ctx.session.action = 'RENT_TRUCK_TRIP';
        await ctx.reply(`✅ *${val}*\n🗺️ የጉዞ አይነት ይምረጡ:`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🏙️ ከተማ ውስጥ',   'RENT_TRIP_LOCAL')],
                [Markup.button.callback('🛣️ ከተማ ወደ ከተማ', 'RENT_TRIP_INTERCITY')]
            ])
        });
    }
    ctx.answerCbQuery();
});
bot.action('RENT_TRIP_LOCAL', async ctx => {
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    ctx.session.rentTruck.tripType = 'local';
    ctx.session.action = 'RENT_TRUCK_CITY';
    await askChoice(ctx, `📍 ከተማ ይምረጡ 👇`, LOCATIONS, 'BTRKCITY_', 4);
    ctx.answerCbQuery();
});
bot.action('RENT_TRIP_INTERCITY', async ctx => {
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    ctx.session.rentTruck.tripType = 'intercity';
    ctx.session.action = 'RENT_TRUCK_FROM';
    await askChoice(ctx, `🛣️ *ከየት?* 👇`, TRUCK_ROUTES, 'BTRKFROM_', 4);
    ctx.answerCbQuery();
});
bot.action(/^BTRKCITY_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_TRUCK_CITY_TEXT';
        await ctx.reply(`📍 ከተማ ያስገቡ:`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentTruck.route = val;
        await doTruckSearch(ctx);
    }
    ctx.answerCbQuery();
});
bot.action(/^BTRKFROM_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_TRUCK_FROM_TEXT';
        await ctx.reply(`🛣️ መነሻ ቦታ ያስገቡ:`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentTruck.routeFrom = val;
        ctx.session.action = 'RENT_TRUCK_TO';
        await askChoice(ctx, `✅ ከ *${val}*\n🛣️ *ወዴት?* 👇`, TRUCK_ROUTES, 'BTRKTO_', 4);
    }
    ctx.answerCbQuery();
});
bot.action(/^BTRKTO_(.+)$/, async ctx => {
    const val = sanitize(ctx.match[1]);
    ctx.session.rentTruck = ctx.session.rentTruck || {};
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_TRUCK_TO_TEXT';
        await ctx.reply(`🛣️ መድረሻ ቦታ ያስገቡ:`, { parse_mode: 'Markdown' });
    } else {
        ctx.session.rentTruck.route = `ከ ${ctx.session.rentTruck.routeFrom || ''} ወደ ${val}`;
        await doTruckSearch(ctx);
    }
    ctx.answerCbQuery();
});

// ──────────────────────────────────────────────────────────
// SEARCH FUNCTIONS (called after all inputs collected)
// ──────────────────────────────────────────────────────────
async function doCementSearch(ctx) {
    const { type, location } = ctx.session.buyCement || {};
    logSearch(ctx, '🧱 ሲሚንቶ ፈላጊ', `${type} | ${location}`, '');
    const results = await CementSeller.find({ type: searchRx(type), location: searchRx(location), status: 'active' })
        .sort({ price: 1 }).limit(5).lean();
    if (results.length) {
        await ctx.reply(`✅ *${results.length} ሻጭ ተገኝቷል!* (ዋጋ ከርካሽ ወደ ውድ)`, { parse_mode: 'Markdown' });
        for (const r of results) await ctx.reply(cementCardBuyer(r), { parse_mode: 'Markdown' });
    } else {
        await ctx.reply(`😔 *${esc(type)}* — ${esc(location)}\nለጊዜው ሻጭ አልተገኘም። 🔔`, { parse_mode: 'Markdown' });
    }
    await ctx.reply(supportLine, { parse_mode: 'Markdown' });
    ctx.session.action = null; ctx.session.buyCement = {};
}

async function doSteelSearch(ctx) {
    const type = ctx.session.buySteel?.type || '';
    logSearch(ctx, '🟥 ብረት ፈላጊ', type, '');
    const results = await SteelSeller.find({ type: searchRx(type), status: 'active' })
        .sort({ price: 1 }).limit(5).lean();
    if (results.length) {
        await ctx.reply(`✅ *${results.length} ሻጭ ተገኝቷል!* (ዋጋ ከርካሽ ወደ ውድ)`, { parse_mode: 'Markdown' });
        for (const r of results) await ctx.reply(steelCardBuyer(r), { parse_mode: 'Markdown' });
    } else {
        await ctx.reply(`😔 *${esc(type)}* — ለጊዜው ሻጭ አልተገኘም። 🔔`, { parse_mode: 'Markdown' });
    }
    await ctx.reply(supportLine, { parse_mode: 'Markdown' });
    ctx.session.action = null; ctx.session.buySteel = {};
}

async function doMacSearch(ctx) {
    const type = ctx.session.rentMachinery?.type || '';
    logSearch(ctx, '🔹 ማሽነሪ ፈላጊ', type, '');
    const results = await MachineryLeasor.find({ type: searchRx(type), status: 'active' })
        .sort({ price: 1 }).limit(5).lean();
    if (results.length) {
        await ctx.reply(`✅ *${results.length} ማሽነሪ ተገኝቷል!*`, { parse_mode: 'Markdown' });
        for (const r of results) await ctx.reply(macCardBuyer(r), { parse_mode: 'Markdown' });
    } else {
        await ctx.reply(`😔 *${esc(type)}* — ለጊዜው አልተገኘም። 🔔`, { parse_mode: 'Markdown' });
    }
    await ctx.reply(supportLine, { parse_mode: 'Markdown' });
    ctx.session.action = null; ctx.session.rentMachinery = {};
}

async function doTruckSearch(ctx) {
    const { type, tripType, route, routeFrom } = ctx.session.rentTruck || {};
    logSearch(ctx, '🚚 ትራክ ፈላጊ', `${type} | ${route}`, '');
    let found = null;
    if (tripType === 'local') {
        found = await TruckLeasor.findOne({ tripType: 'local', route: searchRx(route || ''), status: 'active' }).sort({ rentedCount: 1 });
        if (!found) found = await TruckLeasor.findOne({ route: searchRx(route || ''), status: 'active' }).sort({ rentedCount: 1 });
    } else {
        const fromStr = routeFrom || '';
        const toStr   = (route || '').replace(/^ከ .+ ወደ (.+)$/i, '$1').trim();
        const fromRx  = fromStr ? searchRx(fromStr) : null;
        const toRx    = toStr   ? searchRx(toStr)   : null;
        if (fromRx && toRx)
            found = await TruckLeasor.findOne({ tripType: 'intercity', $and: [{ route: fromRx }, { route: toRx }], status: 'active' }).sort({ rentedCount: 1 });
        if (!found && (fromRx || toRx))
            found = await TruckLeasor.findOne({ route: fromRx || toRx, status: 'active' }).sort({ rentedCount: 1 });
    }
    if (found) {
        await ctx.reply(`✅ *ትራክ ተገኝቷል!*`, { parse_mode: 'Markdown' });
        await ctx.reply(truckCardBuyer(found.toObject()), { parse_mode: 'Markdown' });
        TruckLeasor.findByIdAndUpdate(found._id, { $inc: { rentedCount: 1 } }).catch(() => {});
    } else {
        await ctx.reply(`😔 *${esc(type)}* — ለጊዜው ዝግጁ ትራክ አልተገኘም። 🔔`, { parse_mode: 'Markdown' });
    }
    await ctx.reply(supportLine, { parse_mode: 'Markdown' });
    ctx.session.action = null; ctx.session.rentTruck = {};
}

// ──────────────────────────────────────────────────────────
// SELLER/LESSOR DASHBOARD
// ──────────────────────────────────────────────────────────
async function openDashboard(ctx, Model, cardFn, kb, startAction, sessionKey, askFn) {
    ctx.session.action = null;
    const items = await Model.find({ userId: ctx.from.id }).sort({ createdAt: -1 }).lean();
    if (!items.length) {
        ctx.session.action   = startAction;
        ctx.session[sessionKey] = {};
        return askFn(ctx);
    }
    const active = items.filter(i => i.status === 'active').length;
    await ctx.reply(
        `👤 *ምዝገባዎች* — ጠቅላላ: *${items.length}*  🟢 *${active}*  🔴 *${items.length - active}*`,
        { parse_mode: 'Markdown' }
    );
    for (const it of items)
        await ctx.reply(cardFn(it), { parse_mode: 'Markdown', ...kb(it._id) });
}

bot.hears('🧱 ሲሚንቶ ለመሸጥ', ctx => openDashboard(
    ctx, CementSeller, cementCard, cementItemKb, 'REG_CEMENT_1', 'cementData',
    c => askChoice(c, `🧱 *ሲሚንቶ ምዝገባ*\nአይነት ይምረጡ 👇`, CEMENT_TYPES, 'CTYPE_', 3)
));
bot.hears('🟥 ብረት ለመሸጥ', ctx => openDashboard(
    ctx, SteelSeller, steelCard, steelItemKb, 'REG_STEEL_1', 'steelData',
    c => askChoice(c, `🟥 *ብረት ምዝገባ*\nዲያሜትር ይምረጡ 👇`, STEEL_TYPES, 'STYPE_', 3)
));
bot.hears('🔹 ማሽነሪ ለማከራየት', ctx => openDashboard(
    ctx, MachineryLeasor, macCard, macItemKb, 'REG_MACHINERY_1', 'machineryData',
    c => askChoice(c, `🔹 *ማሽነሪ ምዝገባ*\nአይነት ይምረጡ 👇`, MACHINERY_TYPES, 'MTYPE_', 2)
));
bot.hears('🚚 መኪና ለማከራየት', ctx => openDashboard(
    ctx, TruckLeasor, truckCard, truckItemKb, 'REG_TRUCK_1', 'truckData',
    c => askChoice(c, `🚚 *ትራክ ምዝገባ*\nአይነት ይምረጡ 👇`, TRUCK_TYPES, 'TKTYPE_', 3)
));

// ──────────────────────────────────────────────────────────
// BUYER/RENTER FLOWS
// ──────────────────────────────────────────────────────────
bot.hears('🧱 ሲሚንቶ ለመግዛት', ctx => {
    ctx.session.action = 'BUY_CEMENT_1'; ctx.session.buyCement = {};
    askChoice(ctx, `🔍 *ሲሚንቶ ፍለጋ*\nአይነት ይምረጡ 👇`, CEMENT_TYPES, 'BCEM_', 3);
});
bot.hears('🟥 ብረት ለመግዛት', ctx => {
    ctx.session.action = 'BUY_STEEL_1'; ctx.session.buySteel = {};
    askChoice(ctx, `🔍 *ብረት ፍለጋ*\nዲያሜትር ይምረጡ 👇`, STEEL_TYPES, 'BSTL_', 3);
});
bot.hears('🔹 ማሽነሪ ለመከራየት', ctx => {
    ctx.session.action = 'RENT_MAC_1'; ctx.session.rentMachinery = {};
    askChoice(ctx, `🔍 *ማሽነሪ ፍለጋ*\nአይነት ይምረጡ 👇`, MACHINERY_TYPES, 'BMAC_', 2);
});
bot.hears('🚚 መኪና ለመከራየት', ctx => {
    ctx.session.action = 'RENT_TRUCK_1'; ctx.session.rentTruck = {};
    askChoice(ctx, `🔍 *ትራክ ፍለጋ*\nአይነት ይምረጡ 👇`, TRUCK_TYPES, 'BTRK_', 3);
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

    try {
        // ══════════════════════════════════════════════════
        // CEMENT REGISTRATION (type → location → phone → price)
        // ══════════════════════════════════════════════════
        if (action === 'REG_CEMENT_1_TEXT') {
            ctx.session.cementData = { type: text };
            ctx.session.action = 'REG_CEMENT_2';
            return askChoice(ctx, `✅ *${text}*\n📍 ቦታ ይምረጡ 👇`, LOCATIONS, 'SLOC_', 4);
        }
        if (action === 'REG_CEMENT_2_TEXT') {
            ctx.session.cementData.location = text;
            ctx.session.action = 'REG_CEMENT_3';
            return ctx.reply(`✅ *${text}*\n📞 ስልክ ቁጥር ያስገቡ:`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_CEMENT_3') {
            const phone = safePhone(text);
            if (!isValidPhone(phone)) return errPhone(ctx);
            ctx.session.cementData.phone = phone;
            ctx.session.action = 'REG_CEMENT_4';
            return ctx.reply(`✅ *${phone}*\n💰 ዋጋ/ኩንታል ያስገቡ:\nምሳሌ: _650_`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_CEMENT_4') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '650');
            const d = ctx.session.cementData;
            const doc = await CementSeller.create({ ...d, companyName: d.type, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.cementData = {};
            await ctx.reply(`🎉 *ምዝገባ ተሳክቷል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(cementCard(doc.toObject()), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
        }

        // ══ UPDATE CEMENT PRICE ════════════════════════════
        if (action === 'UPD_CEM_PRICE') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '650');
            const doc = await CementSeller.findByIdAndUpdate(ctx.session.targetItemId, { price }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ ምዝገባው አልተገኘም።');
            await ctx.reply(`✅ ዋጋ → *${fmt(price)} ብር/ኩንታል*`, { parse_mode: 'Markdown' });
            return ctx.reply(cementCard(doc.toObject()), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // BUY CEMENT (text fallbacks)
        // ══════════════════════════════════════════════════
        if (action === 'BUY_CEMENT_1_TEXT') {
            ctx.session.buyCement = { type: text };
            ctx.session.action = 'BUY_CEMENT_LOC';
            return askChoice(ctx, `✅ *${text}*\n📍 ቦታ ይምረጡ 👇`, LOCATIONS, 'BCEMLOC_', 4);
        }
        if (action === 'BUY_CEMENT_LOC_TEXT') {
            ctx.session.buyCement = ctx.session.buyCement || {};
            ctx.session.buyCement.location = text;
            return doCementSearch(ctx);
        }

        // ══════════════════════════════════════════════════
        // STEEL REGISTRATION
        // ══════════════════════════════════════════════════
        if (action === 'REG_STEEL_1_TEXT') {
            ctx.session.steelData = { type: text };
            ctx.session.action = 'REG_STEEL_2';
            return ctx.reply(`✅ *${text}*\n📍 አድራሻ ያስገቡ:`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_2') {
            ctx.session.steelData.address = text;
            ctx.session.action = 'REG_STEEL_3';
            return ctx.reply(`✅ *${text}*\n📞 ስልክ ቁጥር ያስገቡ:`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_3') {
            const phone = safePhone(text);
            if (!isValidPhone(phone)) return errPhone(ctx);
            ctx.session.steelData.phone = phone;
            ctx.session.action = 'REG_STEEL_4';
            return ctx.reply(`✅ *${phone}*\n💰 ዋጋ ያስገቡ:\nምሳሌ: _5000_`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_4') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '5000');
            const doc = await SteelSeller.create({ ...ctx.session.steelData, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.steelData = {};
            await ctx.reply(`🎉 *ምዝገባ ተሳክቷል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(steelCard(doc.toObject()), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
        }

        // ══ UPDATE STEEL PRICE ════════════════════════════
        if (action === 'UPD_STL_PRICE') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '5000');
            const doc = await SteelSeller.findByIdAndUpdate(ctx.session.targetItemId, { price }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ ምዝገባው አልተገኘም።');
            await ctx.reply(`✅ ዋጋ → *${fmt(price)} ብር*`, { parse_mode: 'Markdown' });
            return ctx.reply(steelCard(doc.toObject()), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
        }

        // ══ BUY STEEL text fallback ════════════════════════
        if (action === 'BUY_STEEL_TEXT') {
            ctx.session.buySteel = { type: text };
            return doSteelSearch(ctx);
        }

        // ══════════════════════════════════════════════════
        // MACHINERY REGISTRATION
        // ══════════════════════════════════════════════════
        if (action === 'REG_MACHINERY_1_TEXT') {
            ctx.session.machineryData = { type: text };
            ctx.session.action = 'REG_MACHINERY_2';
            return ctx.reply(`✅ *${text}*\n📍 አድራሻ ያስገቡ:`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_2') {
            ctx.session.machineryData.address = text;
            ctx.session.action = 'REG_MACHINERY_3';
            return ctx.reply(`✅ *${text}*\n📞 ስልክ ቁጥር ያስገቡ:`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_3') {
            const phone = safePhone(text);
            if (!isValidPhone(phone)) return errPhone(ctx);
            ctx.session.machineryData.phone = phone;
            ctx.session.action = 'REG_MACHINERY_4';
            return ctx.reply(`✅ *${phone}*\n💰 ኪራይ ያስገቡ:\nምሳሌ: _15000_`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_4') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '15000');
            const doc = await MachineryLeasor.create({ ...ctx.session.machineryData, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.machineryData = {};
            await ctx.reply(`🎉 *ምዝገባ ተሳክቷል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(macCard(doc.toObject()), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
        }

        // ══ UPDATE MACHINERY PRICE ════════════════════════
        if (action === 'UPD_MAC_PRICE') {
            const price = safePrice(text);
            if (!price) return errPrice(ctx, '15000');
            const doc = await MachineryLeasor.findByIdAndUpdate(ctx.session.targetItemId, { price }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ ምዝገባው አልተገኘም።');
            await ctx.reply(`✅ ዋጋ → *${fmt(price)} ብር*`, { parse_mode: 'Markdown' });
            return ctx.reply(macCard(doc.toObject()), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
        }

        // ══ RENT MACHINERY text fallback ═══════════════════
        if (action === 'RENT_MAC_TEXT') {
            ctx.session.rentMachinery = { type: text };
            return doMacSearch(ctx);
        }

        // ══════════════════════════════════════════════════
        // TRUCK REGISTRATION
        // ══════════════════════════════════════════════════
        if (action === 'REG_TRUCK_1_TEXT') {
            ctx.session.truckData = ctx.session.truckData || {};
            ctx.session.truckData.type = text;
            ctx.session.action = 'REG_TRUCK_TRIP';
            return ctx.reply(`✅ *${text}*\n🗺️ የጉዞ አይነት ይምረጡ:`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🏙️ ከተማ ውስጥ',   'REG_TRIP_LOCAL')],
                    [Markup.button.callback('🛣️ ከተማ ወደ ከተማ', 'REG_TRIP_INTERCITY')]
                ])
            });
        }
        if (action === 'REG_TRUCK_CITY_TEXT') {
            ctx.session.truckData = ctx.session.truckData || {};
            ctx.session.truckData.route = text;
            ctx.session.action = 'REG_TRUCK_PHONE';
            return ctx.reply(`✅ *${text}*\n📞 ስልክ ቁጥር ያስገቡ:`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_TRUCK_FROM_TEXT') {
            ctx.session.truckData = ctx.session.truckData || {};
            ctx.session.truckData.routeFrom = text;
            ctx.session.action = 'REG_TRUCK_TO';
            return askChoice(ctx, `✅ ከ *${text}*\n🛣️ *ወዴት?* 👇`, TRUCK_ROUTES, 'TRKTO_', 4);
        }
        if (action === 'REG_TRUCK_TO_TEXT') {
            ctx.session.truckData = ctx.session.truckData || {};
            ctx.session.truckData.route = `ከ ${ctx.session.truckData.routeFrom || ''} ወደ ${text}`;
            ctx.session.action = 'REG_TRUCK_PHONE';
            return ctx.reply(`✅ *${ctx.session.truckData.route}*\n📞 ስልክ ቁጥር ያስገቡ:`, { parse_mode: 'Markdown' });
        }
        if (action === 'REG_TRUCK_PHONE') {
            const phone = safePhone(text);
            if (!isValidPhone(phone)) return errPhone(ctx);
            ctx.session.truckData.phone = phone;
            ctx.session.truckData.plate = ctx.session.truckData.plate || '—';
            const doc = await TruckLeasor.create({ ...ctx.session.truckData, userId: uid, status: 'active' });
            ctx.session.action = null; ctx.session.truckData = {};
            await ctx.reply(`🎉 *ምዝገባ ተሳክቷል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(truckCard(doc.toObject()), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
        }

        // ══ UPDATE TRUCK ROUTE ════════════════════════════
        if (action === 'UPD_TRK_ROUTE_TEXT') {
            const doc = await TruckLeasor.findByIdAndUpdate(ctx.session.targetItemId, { route: text }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ ምዝገባው አልተገኘም።');
            await ctx.reply(`✅ መስመር → *${esc(text)}*`, { parse_mode: 'Markdown' });
            return ctx.reply(truckCard(doc.toObject()), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
        }

        // ══ RENT TRUCK text fallbacks ══════════════════════
        if (action === 'RENT_TRUCK_TEXT') {
            ctx.session.rentTruck = ctx.session.rentTruck || {};
            ctx.session.rentTruck.type = text;
            ctx.session.action = 'RENT_TRUCK_TRIP';
            return ctx.reply(`✅ *${text}*\n🗺️ የጉዞ አይነት ይምረጡ:`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🏙️ ከተማ ውስጥ',   'RENT_TRIP_LOCAL')],
                    [Markup.button.callback('🛣️ ከተማ ወደ ከተማ', 'RENT_TRIP_INTERCITY')]
                ])
            });
        }
        if (action === 'RENT_TRUCK_CITY_TEXT') {
            ctx.session.rentTruck = ctx.session.rentTruck || {};
            ctx.session.rentTruck.route = text;
            return doTruckSearch(ctx);
        }
        if (action === 'RENT_TRUCK_FROM_TEXT') {
            ctx.session.rentTruck = ctx.session.rentTruck || {};
            ctx.session.rentTruck.routeFrom = text;
            ctx.session.action = 'RENT_TRUCK_TO';
            return askChoice(ctx, `✅ ከ *${text}*\n🛣️ *ወዴት?* 👇`, TRUCK_ROUTES, 'BTRKTO_', 4);
        }
        if (action === 'RENT_TRUCK_TO_TEXT') {
            ctx.session.rentTruck = ctx.session.rentTruck || {};
            ctx.session.rentTruck.route = `ከ ${ctx.session.rentTruck.routeFrom || ''} ወደ ${text}`;
            return doTruckSearch(ctx);
        }

    } catch (err) {
        console.error('Handler error:', err);
        ctx.reply(`⚠️ ስህተት አጋጥሟል። ዳግም ይሞክሩ።`, { ...mainKb }).catch(() => {});
    }
});

// ──────────────────────────────────────────────────────────
// ADMIN PANEL
// ──────────────────────────────────────────────────────────
bot.command('admin_panel', async ctx => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም!');
    ctx.reply(`🔧 *አድሚን ፓናል*`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🧱 ሲሚንቶ',  'rep_cem'),
             Markup.button.callback('🚚 ትራክ',   'rep_trk')],
            [Markup.button.callback('🟥 ብረት',   'rep_stl'),
             Markup.button.callback('🔹 ማሽነሪ',  'rep_mac')],
            [Markup.button.callback('📊 ፍለጋ ሪፖርት', 'rep_searches')],
            [Markup.button.callback('🗑️ ማጥፊያ',   'admin_del')]
        ])
    });
});

const adminDelKb = (prefix, id) => Markup.inlineKeyboard([
    [Markup.button.callback('🗑️ አጥፋ', `adel_do_${prefix}_${id}`)]
]);

async function adminReport(ctx, Model, title, cardFn, prefix) {
    await ctx.answerCbQuery?.();
    if (!isAdmin(ctx)) return ctx.reply('⛔');
    const items = await Model.find({}).sort({ status: -1, createdAt: -1 }).lean();
    if (!items.length) return ctx.reply(`📭 ${title} — ምዝገባ የለም።`);
    const active = items.filter(i => i.status === 'active').length;
    await ctx.reply(
        `📋 *${title}*  ጠቅ: *${items.length}*  ✅ *${active}*  ❌ *${items.length - active}*`,
        { parse_mode: 'Markdown' }
    );
    for (const it of items)
        await ctx.reply(cardFn(it, true), { parse_mode: 'Markdown', ...adminDelKb(prefix, it._id) });
}

bot.action('rep_cem', ctx => adminReport(ctx, CementSeller,    '🧱 ሲሚንቶ',  cementCard, 'cem'));
bot.action('rep_trk', ctx => adminReport(ctx, TruckLeasor,     '🚚 ትራክ',   truckCard,  'trk'));
bot.action('rep_stl', ctx => adminReport(ctx, SteelSeller,     '🟥 ብረት',   steelCard,  'stl'));
bot.action('rep_mac', ctx => adminReport(ctx, MachineryLeasor, '🔹 ማሽነሪ',  macCard,    'mac'));

bot.action('rep_searches', async ctx => {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx)) return ctx.reply('⛔');
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    todayStart.setHours(todayStart.getHours() - 3);
    const logs = await SearchLog.find({ createdAt: { $gte: todayStart } })
        .sort({ createdAt: -1 }).limit(200).lean();
    if (!logs.length) return ctx.reply('📭 ዛሬ ምንም ፍለጋ አልተገኘም።');
    const groups = {};
    for (const l of logs) (groups[l.category] = groups[l.category] || []).push(l);
    const lines = [`📊 *ፍለጋ ሪፖርት* — ዛሬ`, `━━━━━━━━━━━━━━━`];
    for (const [cat, entries] of Object.entries(groups))
        lines.push(`${cat} — *${entries.length}*`);
    lines.push(`━━━━━━━━━━━━━━━`);
    lines.push(`ጠቅ: *${logs.length}*`);
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    for (const [cat, entries] of Object.entries(groups)) {
        await ctx.reply(`*${cat}* — *${entries.length}*`, { parse_mode: 'Markdown' });
        for (const e of entries)
            await ctx.reply(
                `▸ *${esc(e.searchedFor)}*  🕐 ${ethTimestamp(e.createdAt)}\n` +
                (e.username && e.username !== 'N/A' ? `👤 @${esc(e.username)}` : ''),
                { parse_mode: 'Markdown' }
            );
    }
});

bot.action('admin_del', ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
    ctx.reply('🗑️ ዘርፍ ይምረጡ:', {
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
    ctx.reply(`🗑️ *${title}* — ይምረጡ:`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(items.map(it => [
            Markup.button.callback(`🗑️ ${labelFn(it)}`, `adel_do_${prefix}_${it._id}`)
        ]))
    });
}

bot.action('adel_cem', ctx => delMenu(ctx, CementSeller,    it => `${it.type} (${it.phone})`,  'cem', 'ሲሚንቶ'));
bot.action('adel_trk', ctx => delMenu(ctx, TruckLeasor,     it => `${it.type} (${it.phone})`,  'trk', 'ትራክ'));
bot.action('adel_stl', ctx => delMenu(ctx, SteelSeller,     it => `${it.type} (${it.phone})`,  'stl', 'ብረት'));
bot.action('adel_mac', ctx => delMenu(ctx, MachineryLeasor, it => `${it.type} (${it.phone})`,  'mac', 'ማሽነሪ'));

bot.action(/^adel_do_(cem|trk|stl|mac)_([a-f\d]{24})$/i, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
    const [, p, id] = ctx.match;
    if (!isValidObjectId(id)) return ctx.answerCbQuery('❗ Invalid ID');
    await MMAP[p].findByIdAndDelete(id);
    ctx.reply('✅ ምዝገባው ተሰርዟል።');
    ctx.answerCbQuery('🗑️ ተሰርዟል');
});

// ──────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLERS
// ──────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
    console.error(`Bot error [${ctx?.updateType}]:`, err);
    ctx?.reply?.('⚠️ ያልተጠበቀ ስህተት። እንደገና ይሞክሩ።').catch(() => {});
});
process.on('uncaughtException',  e => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', e => console.error('REJECTION:', e));

// ──────────────────────────────────────────────────────────
// HTTP SERVER + KEEP-ALIVE
// ──────────────────────────────────────────────────────────
http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Marketplace Bot v9.0 — OK');
}).listen(PORT, '0.0.0.0', () => console.log(`🌐 HTTP :${PORT}`));

if (RENDER_URL) {
    const base = RENDER_URL.startsWith('http') ? RENDER_URL : `https://${RENDER_URL}`;
    setInterval(() => {
        http.get(base, r => console.log(`⏱️ ping → ${r.statusCode}`))
            .on('error', e => console.warn('ping err:', e.message));
    }, 14 * 60 * 1000);
    console.log(`🔄 Keep-alive → ${base}`);
}

// ──────────────────────────────────────────────────────────
// LAUNCH
// ──────────────────────────────────────────────────────────
bot.launch({
    allowedUpdates: ['message', 'callback_query'],
    dropPendingUpdates: true
})
.then(() => console.log('🤖 Bot v9.0 launched!'))
.catch(err => { console.error('Launch failed:', err); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
