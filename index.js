'use strict';

// ╔══════════════════════════════════════════════════════════════╗
// ║          Simple Marketplace Bot  v8.0  ✨                   ║
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
    viewCount:   { type: Number, default: 0 },
    createdAt:   { type: Date,   default: Date.now }
});
cementSchema.index({ type: 1, location: 1, status: 1 });

const steelSchema = new mongoose.Schema({
    userId:    { type: Number, required: true, index: true },
    type:      { type: String, default: '' },
    address:   { type: String, default: '' },
    phone:     { type: String, default: '' },
    price:     { type: Number, default: 0 },
    priceUnit: { type: String, default: 'ብር/ኪሎ' },
    status:    { type: String, default: 'active', enum: ['active', 'off'] },
    viewCount: { type: Number, default: 0 },
    createdAt: { type: Date,   default: Date.now }
});
steelSchema.index({ type: 1, status: 1 });

const machinerySchema = new mongoose.Schema({
    userId:    { type: Number, required: true, index: true },
    type:      { type: String, default: '' },
    address:   { type: String, default: '' },
    phone:     { type: String, default: '' },
    price:     { type: Number, default: 0 },
    rentUnit:  { type: String, default: 'በቀን', enum: ['በቀን', 'በወር'] },
    status:    { type: String, default: 'active', enum: ['active', 'off'] },
    viewCount: { type: Number, default: 0 },
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
    viewCount:   { type: Number, default: 0 },
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
            maxPoolSize: 100, minPoolSize: 10,
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
    handlerTimeout: 120_000,
    telegram: { webhookReply: false }
});

// Prevent crash on unhandled promise rejections
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
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
    if (rateLimit(uid, 60)) {
        ctx.answerCbQuery?.('⚠️ በጣም ብዙ ጥያቄ! ጥቂት ቆዩ።').catch(() => {});
        ctx.reply('⚠️ በጣም ብዙ ጥያቄ ልከዋል። ጥቂት ቆዩ።').catch(() => {});
        return;
    }
    const k = String(uid);
    if (!sessionCache.has(k)) {
        const doc = await BotSession.findOne({ key: k }).lean().catch(() => null);
        lruSet(k, doc?.data ?? {});
    }
    ctx.session = sessionCache.get(k);
    try { await next(); } catch (err) {
        console.error('Handler error:', err.message);
        ctx.reply('⚠️ ስህተት ተፈጥሯል። እባክዎ ዳግም ይሞክሩ።').catch(() => {});
    }
    lruSet(k, ctx.session);
    // fire-and-forget — don't block response for DB write
    BotSession.updateOne({ key: k }, { $set: { data: ctx.session } }, { upsert: true }).catch(() => {});
});

// ──────────────────────────────────────────────────────────
// UTILITIES
// ──────────────────────────────────────────────────────────
const isAdmin = ctx => ADMIN_IDS.includes(ctx.from?.id);
const fmt     = n   => Number(n).toLocaleString('en');
function esc(s) { return String(s || '').replace(/([*_`[\]])/g, '\\$1'); }

function toEthiopian(gDate) {
    const JDN = date => {
        const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate();
        return Math.floor((1461*(y+4800+Math.floor((m-14)/12)))/4)
             + Math.floor((367*(m-2-12*Math.floor((m-14)/12)))/12)
             - Math.floor((3*Math.floor((y+4900+Math.floor((m-14)/12))/100))/4)
             + d - 32075;
    };
    const jdn = JDN(gDate);
    const r   = jdn - 1723856;
    const n   = r % 1461;
    const y   = Math.floor(r/1461)*4 + Math.floor(n/365) - (n===1460?1:0);
    const rem = (n%365) + (n===1460?1:0);
    const m   = Math.floor(rem/30) + 1;
    const d   = rem%30 + 1;
    return { y, m: Math.min(m,13), d: Math.min(d,30) };
}
const ETH_MONTHS = ['መስከረም','ጥቅምት','ህዳር','ታህሳስ','ጥር','የካቲት','መጋቢት','ሚያዚያ','ግንቦት','ሰኔ','ሐምሌ','ነሐሴ','ጳጉሜ'];

function ethTimestamp(date) {
    const d   = new Date(date);
    const eat = new Date(d.getTime() + 3*60*60*1000);
    const pad = n => String(n).padStart(2,'0');
    const eth = toEthiopian(eat);
    const mon = ETH_MONTHS[(eth.m-1)] || `${eth.m}`;
    return `${eth.d} ${mon} ${eth.y} | ${pad(eat.getUTCHours())}:${pad(eat.getUTCMinutes())}`;
}

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
    ['መርካቶ', 'merkato', 'markato', 'merkato addis'],
    ['ቦሌ', 'bole', 'bole addis'],
    ['ፒያሳ', 'piassa', 'piyasa', 'piaza'],
    ['ሜክሲኮ', 'mexico', 'mexiko', 'meksiko'],
    ['ካዛንቺስ', 'kazanchis', 'kazanches', 'kazanchis addis'],
    ['ላፍቶ', 'lafto', 'laft'],
    ['ኮልፌ', 'kolfe', 'kolfee', 'kolfe keraniyo'],
    ['አቃቂ', 'aqaqi', 'akaki', 'akaky'],
    ['ቂርቆስ', 'kirkos', 'qirqos'],
    ['ልዳታ', 'lideta', 'lideta sub city'],
    ['ጉለሌ', 'gulele', 'gullele'],
    ['ንፋስ ስልክ', 'nifas silk', 'nifas silk lafto'],
    ['አዲስ ከተማ', 'addis ketema', 'addis ketma'],
    ['የካ', 'yeka', 'yeka sub city'],
    ['ቦሌ ቡልቡሎ', 'bole bulbulo', 'bulbulo'],
    ['ሳሪስ', 'saris', 'sarris'],
    ['ጀሞ', 'jemo', 'jemo 1', 'jemo 2'],
    ['ሃያ ሁለት', 'haya hulet', '22', 'hayahulet'],
    ['ስድስት ኪሎ', 'sidist kilo', '6 kilo', 'sidist'],
    ['አራት ኪሎ', 'arat kilo', '4 kilo'],
    ['ፒያሳ ሰሚት', 'summit', 'semit'],
    ['ሰሚት', 'summit bole', 'semit bole'],
    ['ገርጂ', 'gerji', 'gerge'],
    ['ጎፋ', 'gofa', 'gofa sefer'],
    ['ወረዳ 23', 'wereda 23', 'w23'],
    ['ቦሌ ሚካኤል', 'bole michael', 'bole mikael'],
    ['አዘዞ', 'azezo', 'azazo'],
    ['በከተማ ውስጥ', 'አዲስ አበባ ከተማ ውስጥ', 'in city', 'local', 'city', 'addis local', 'local delivery'],
];

const SYNONYM_LOOKUP = new Map();
for (let i = 0; i < SYNONYM_GROUPS.length; i++)
    for (const w of SYNONYM_GROUPS[i])
        SYNONYM_LOOKUP.set(w.toLowerCase(), i);

function editDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => {
        const row = new Array(n + 1).fill(0);
        row[0] = i;
        return row;
    });
    for (let j = 0; j <= n; j++) dp[0][j] = j;
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
    const patterns = alts.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
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
const CEMENT_TYPES = ['ዳንጎቴ', 'ናሽናል', 'ሙገር', 'ደርባ', 'ሀበሻ', 'መሰቦ', 'ኢስት ካፒታል', 'ሌላ'];
const STEEL_TYPES  = ['ባለ 8', 'ባለ 10', 'ባለ 12', 'ባለ 14', 'ባለ 16', 'ቆርቆሮ (ሌላ)'];
const MACHINERY_TYPES = ['ኤክስካቫተር', 'ቡልዶዘር', 'ጂሬደር', 'ሮለር', 'ሎደር', 'ክሬን', 'ሌላ'];
const TRUCK_TYPES  = ['ሲኖትራክ', 'FSR Isuzu', 'ተሳቢ', 'ሌላ'];
const TRUCK_TRIP_MODE = ['🏙️ አዲስ አበባ ከተማ ውስጥ', '🛣️ ከአንድ ከተማ ወደ ሌላ ከተማ'];

const AA_NEIGHBORHOODS = [
    'መርካቶ', 'ቦሌ', 'ፒያሳ', 'ሜክሲኮ', 'ካዛንቺስ',
    'ላፍቶ', 'ኮልፌ', 'አቃቂ', 'ቂርቆስ', 'ጉለሌ',
    'ሳሪስ', 'ጀሞ', 'ገርጂ', 'ጎፋ', 'ሰሜት',
    'ቦሌ ሚካኤል', 'ስድስት ኪሎ', 'አራት ኪሎ', 'ሌላ ሰፈር'
];

const TRUCK_ROUTES_FROM = [
    'አ.አ', 'ሀዋሳ', 'አዳማ', 'ባህርዳር', 'ጎንደር',
    'መቀሌ', 'ጅማ', 'ድሬዳዋ', 'ደሴ', 'ሌላ'
];

const TRUCK_ROUTES_TO = [
    'አ.አ', 'ሀዋሳ', 'አዳማ', 'ባህርዳር', 'ጎንደር',
    'መቀሌ', 'ጅማ', 'ድሬዳዋ', 'ደሴ', 'ሌላ'
];

const LOCATIONS = [
    'አዲስ አበባ', 'ሀዋሳ', 'አዳማ',  'ባህርዳር', 'ጎንደር',
    'መቀሌ',    'ጅማ',  'ድሬዳዋ', 'ደሴ',    'ሐረር',
    'ወልዲያ',   'ኮሚቦልቻ','ሻሸመኔ', 'ሞጆ',   'ሌላ'
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
    rows.push([Markup.button.callback('⬅️ Back', backAction)]);
    return Markup.inlineKeyboard(rows);
}

const cancelKb = Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Back', 'go_home')]
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
    const unit = it.priceUnit || 'ብር/ኪሎ';
    return (
        `🟥 *${esc(it.type)}*\n` +
        `▸ 📍 አድራሻ ፦ ${esc(it.address)}\n` +
        `▸ 💰 ዋጋ    ፦ *${fmt(it.price)} ${unit}*\n` +
        `▸ ${statusBadge(it.status)}`
    );
}
function macCardBuyer(it) {
    const unit = it.rentUnit || 'በቀን';
    return (
        `🔹 *${esc(it.type)}*\n` +
        `▸ 📍 አድራሻ ፦ ${esc(it.address)}\n` +
        `▸ 💰 ኪራይ  ፦ *${fmt(it.price)} ብር ${unit}*\n` +
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
    const unit = it.priceUnit || 'ብር/ኪሎ';
    return (
        `🟥 *${esc(it.type)}*\n` +
        `▸ 📍 አድራሻ ፦ ${esc(it.address)}\n` +
        `▸ 📞 ስልክ  ፦ \`${esc(it.phone)}\`\n` +
        `▸ 💰 ዋጋ   ፦ *${fmt(it.price)} ${unit}*\n` +
        `▸ ሁኔታ    ፦ ${badge}`
    );
}
function macCard(it, adminView = false) {
    const badge = adminView
        ? (it.status === 'active' ? '✅ ዝግጁ ነው' : '❌ አይከራይም')
        : statusBadge(it.status);
    const unit = it.rentUnit || 'በቀን';
    return (
        `🔹 *${esc(it.type)}*\n` +
        `▸ 📍 አድራሻ ፦ ${esc(it.address)}\n` +
        `▸ 📞 ስልክ  ፦ \`${esc(it.phone)}\`\n` +
        `▸ 💰 ኪራይ  ፦ *${fmt(it.price)} ብር ${unit}*\n` +
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
const cementItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ክምችት አለ',      `cem_on_${id}`),
     Markup.button.callback('🔴 ክምችት የለም',     `cem_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',       `cem_price_${id}`),
     Markup.button.callback('➕ ሌላ ሲሚንቶ ጨምር', 'cem_add')]
]);
const steelItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ክምችት አለ',     `stl_on_${id}`),
     Markup.button.callback('🔴 ክምችት የለም',    `stl_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',      `stl_price_${id}`),
     Markup.button.callback('➕ ሌላ ብረት ጨምር', 'stl_add')]
]);
const macItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ዝግጁ ነው — ይከራያል',  `mac_on_${id}`),
     Markup.button.callback('🔴 ስራ ላይ — አይከራይም',  `mac_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',            `mac_price_${id}`),
     Markup.button.callback('➕ ሌላ ማሽነሪ ጨምር',     'mac_add')]
]);
const truckItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ዝግጁ — ይከራያል',      `trk_on_${id}`),
     Markup.button.callback('🔴 ስራ ላይ — አይከራይም',  `trk_off_${id}`)],
    [Markup.button.callback('🗺️ መስመር ቀይር',         `trk_route_${id}`),
     Markup.button.callback('➕ ሌላ መኪና ጨምር',       'trk_add')]
]);

// ──────────────────────────────────────────────────────────
// MAIN KEYBOARD
// ──────────────────────────────────────────────────────────
const mainKb = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ',    '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት',   '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ',     '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት'],
    ['📞 አግኙን']
]).resize();

// ──────────────────────────────────────────────────────────
// WELCOME TEXT
// ──────────────────────────────────────────────────────────
const welcomeText = (name) =>
    `👋 *ሰላም ${esc(name)}!*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🏗️ *መረጃ የንግድ ማዕከል*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `✅ *ሲሚንቶ* — ለመሸጥ ወይም ለመግዛት\n` +
    `✅ *ብረት* — ለመሸጥ ወይም ለመግዛት\n` +
    `✅ *ማሽነሪ* — ለማከራየት ወይም ለመከራየት\n` +
    `✅ *የጭነት መኪና* — ለማከራየት ወይም ለመከራየት\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `❓ *ምን ይፈልጋሉ?*\n` +
    `_ከዚህ ታች ካሉት ቁልፎች የሚፈልጉትን ይምረጡ_ 👇`;

// ──────────────────────────────────────────────────────────
// UTILITIES — deletePrev / sendStep / askChoice
// ──────────────────────────────────────────────────────────
async function deletePrev(ctx) {
    const msgId = ctx.session?.lastMsgId;
    if (msgId) {
        await ctx.telegram.deleteMessage(ctx.chat.id, msgId).catch(() => {});
        ctx.session.lastMsgId = null;
    }
}

async function sendStep(ctx, text, extra = {}) {
    await deletePrev(ctx);
    const options = { parse_mode: 'Markdown', ...cancelKb, ...extra };
    const sent = await ctx.reply(text, options);
    ctx.session.lastMsgId = sent.message_id;
    return sent;
}

async function askChoice(ctx, prompt, options, prefix, cols = 3, backAction = 'go_home') {
    await deletePrev(ctx);
    const sent = await ctx.reply(prompt, {
        parse_mode: 'Markdown',
        ...choiceKbWithBack(options, prefix, cols, backAction)
    });
    ctx.session.lastMsgId = sent.message_id;
    return sent;
}

function isValidObjectId(id) {
    const s = Array.isArray(id) ? id[1] : id;
    return /^[a-f\d]{24}$/i.test(s);
}

function getObjId(match) {
    return Array.isArray(match) ? match[1] : match;
}

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
    ctx.answerCbQuery().catch(() => {});
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
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🧱 ሲሚንቶ', 'rep_cem'),
                 Markup.button.callback('🚚 ትራክ',  'rep_trk')],
                [Markup.button.callback('🟥 ብረት',  'rep_stl'),
                 Markup.button.callback('🔹 ማሽነሪ', 'rep_mac')],
                [Markup.button.callback('📊 ፍለጋ ሪፖርት (ዛሬ)', 'rep_searches')],
                [Markup.button.callback('👁️ ሲሚንቶ — ተፈላጊ', 'rep_cem_views'),
                 Markup.button.callback('👁️ ብረት — ተፈላጊ',  'rep_stl_views')],
                [Markup.button.callback('👁️ ማሽነሪ — ተፈላጊ', 'rep_mac_views'),
                 Markup.button.callback('👁️ ትራክ — ተፈላጊ',  'rep_trk_views')],
                [Markup.button.callback('🗑️ ማጥፊያ', 'admin_del')]
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
        await ctx.reply(cardFn(it, true), {
            parse_mode: 'Markdown',
            ...adminDelKb(prefix, it._id)
        });
}

bot.action('rep_cem', ctx => adminReport(ctx, CementSeller,    '🧱 ሲሚንቶ ሻጮች',  cementCard, 'cem'));
bot.action('rep_trk', ctx => adminReport(ctx, TruckLeasor,     '🚚 ትራክ አከራዮች', truckCard,  'trk'));
bot.action('rep_stl', ctx => adminReport(ctx, SteelSeller,     '🟥 ብረት ሻጮች',   steelCard,  'stl'));
bot.action('rep_mac', ctx => adminReport(ctx, MachineryLeasor, '🔹 ማሽነሪ',       macCard,    'mac'));

// ──────────────────────────────────────────────────────────
// VIEW COUNT REPORTS — ሁሉም ዕቃዎች (recent-first by viewCount)
// ──────────────────────────────────────────────────────────
async function viewCountReport(ctx, Model, title, cardFn) {
    await ctx.answerCbQuery().catch(() => {});
    if (!isAdmin(ctx)) return ctx.reply('⛔');
    const items = await Model.find({ viewCount: { $gt: 0 } })
        .sort({ viewCount: -1, createdAt: -1 })
        .lean();
    if (!items.length)
        return ctx.reply(`📭 *${title}*\n\nገና ምንም ደምበኛ አልፈለገም።`, { parse_mode: 'Markdown' });

    const total = items.reduce((s, i) => s + (i.viewCount || 0), 0);
    await ctx.reply(
        `👁️ *${title}*\n` +
        `ጠቅላላ ፍለጋ: *${total}* | ዕቃዎች: *${items.length}*\n` +
        `_ከብዙ ተፈላጊ ወደ ትንሽ ተፈላጊ ተሰልፎ ነው_`,
        { parse_mode: 'Markdown' }
    );
    for (const it of items) {
        const views  = it.viewCount   || 0;
        const rented = it.rentedCount != null ? `\n▸ 🔑 ተከራይቷል ፦ *${it.rentedCount} ጊዜ*` : '';
        const card   = cardFn(it, true);
        await ctx.reply(
            `${card}\n▸ 👁️ ተፈልጎ ታይቷል ፦ *${views} ጊዜ*${rented}`,
            { parse_mode: 'Markdown' }
        );
    }
}

bot.action('rep_cem_views', ctx => viewCountReport(ctx, CementSeller,    '🧱 ሲሚንቶ — በደምበኛ የተፈለጉ',  cementCard));
bot.action('rep_stl_views', ctx => viewCountReport(ctx, SteelSeller,     '🟥 ብረት — በደምበኛ የተፈለጉ',   steelCard));
bot.action('rep_mac_views', ctx => viewCountReport(ctx, MachineryLeasor, '🔹 ማሽነሪ — በደምበኛ የተፈለጉ',  macCard));
bot.action('rep_trk_views', ctx => viewCountReport(ctx, TruckLeasor,     '🚚 ትራክ — በደምበኛ የተፈለጉ',   truckCard));

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

    if (!logs.length) return ctx.reply('📭 ዛሬ ምንም ፍለጋ አልተገኘም።');

    const CAT_EMOJI = {
        '🧱 ሲሚንቶ ፈላጊ': '🧱',
        '🟥 ብረት ፈላጊ':   '🟥',
        '🔹 ማሽነሪ ፈላጊ':  '🔹',
        '🚚 ትራክ ፈላጊ':   '🚚',
    };

    // Summary header
    const groups = {};
    for (const l of logs) (groups[l.category] = groups[l.category] || []).push(l);
    const lines = [
        `📊 *የዛሬ ፍለጋ ሪፖርት* 📅 ${ethTimestamp(new Date())}`,
        `━━━━━━━━━━━━━━━━━━━━━`
    ];
    for (const [cat, entries] of Object.entries(groups))
        lines.push(`${CAT_EMOJI[cat] || '🔍'} ${cat.replace(/^[^ ]+ /,'')} — *${entries.length} ፍለጋ*`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`🔢 ጠቅላላ ዛሬ: *${logs.length}*`);
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });

    // All searches flat, sorted recent-first (already sorted by query)
    for (const e of logs) {
        const emoji = CAT_EMOJI[e.category] || '🔍';
        const who   = e.username && e.username !== 'N/A' ? `👤 @${esc(e.username)}` : '';
        const ts    = ethTimestamp(e.createdAt);
        await ctx.reply(
            `${emoji} *${esc(e.category)}*\n` +
            `🔎 ${esc(e.searchedFor)}\n` +
            `📞 \`${esc(e.phone)}\`${who ? `  ${who}` : ''}\n` +
            `🕐 ${ts}`,
            { parse_mode: 'Markdown' }
        );
    }
});

bot.action('admin_del', async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
    await ctx.reply('🗑️ *ማጥፊያ* — ዘርፍ ይምረጡ:', {
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
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(() => {});
    ctx.answerCbQuery('🗑️ ተሰርዟል').catch(() => {});
    const [, p, id] = ctx.match;
    if (!isValidObjectId(id)) return;
    await MMAP[p].findByIdAndDelete(id);
    ctx.reply('✅ ምዝገባው ተሰርዟል።').catch(() => {});
});

// ──────────────────────────────────────────────────────────
// PER-ITEM TOGGLE / PRICE / ROUTE ACTIONS
// ──────────────────────────────────────────────────────────
async function toggleItem(ctx, Model, matchArr, newStatus, cardFn, kb) {
    const id = getObjId(matchArr);
    if (!isValidObjectId(id)) { ctx.answerCbQuery('❗ Invalid ID').catch(() => {}); return; }
    const isTruck = Model === TruckLeasor;
    const activeLabel = isTruck ? '✅ ዝግጁ ነው — ሊከራይ ይችላል!' : '✅ ወደ "አለ" ተቀይሯል!';
    const offLabel    = isTruck ? '🔴 ስራ ላይ ነው — አይከራይም!'  : '🔴 ወደ "የለም" ተቀይሯል!';

    // Answer immediately — don't wait for DB
    const label = newStatus === 'active' ? activeLabel : offLabel;
    ctx.answerCbQuery(label).catch(() => {});

    let doc = await Model.findOneAndUpdate(
        { _id: id, userId: ctx.from.id },
        { status: newStatus },
        { new: true }
    );

    if (!doc && isAdmin(ctx)) {
        doc = await Model.findByIdAndUpdate(id, { status: newStatus }, { new: true });
    }
    if (!doc) { ctx.reply('❗ ፈቃድ የለዎትም').catch(() => {}); return; }

    ctx.editMessageText(cardFn(doc.toObject(), isAdmin(ctx)), {
        parse_mode: 'Markdown', ...kb(doc._id)
    }).catch(() => {});
}

bot.action(/^cem_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, CementSeller,    ctx.match, 'active', cementCard, cementItemKb));
bot.action(/^cem_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, CementSeller,    ctx.match, 'off',    cementCard, cementItemKb));
bot.action(/^stl_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, SteelSeller,     ctx.match, 'active', steelCard,  steelItemKb));
bot.action(/^stl_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, SteelSeller,     ctx.match, 'off',    steelCard,  steelItemKb));
bot.action(/^mac_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, MachineryLeasor, ctx.match, 'active', macCard,    macItemKb));
bot.action(/^mac_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, MachineryLeasor, ctx.match, 'off',    macCard,    macItemKb));
bot.action(/^trk_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx, TruckLeasor,     ctx.match, 'active', truckCard,  truckItemKb));
bot.action(/^trk_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx, TruckLeasor,     ctx.match, 'off',    truckCard,  truckItemKb));

bot.action(/^cem_price_([a-f\d]{24})$/i, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const id = getObjId(ctx.match);
    if (!isValidObjectId(id)) return;
    ctx.session.action = 'UPD_CEM_PRICE'; ctx.session.targetItemId = id;
    await sendStep(ctx, '💰 *አዲሱን ዋጋ ያስገቡ:*\nበኩንታል ቁጥር ብቻ — ለምሳሌ: 1200 ወይም 1500');
});
bot.action('cem_add', async ctx => {
    ctx.answerCbQuery().catch(() => {});
    ctx.session.action = 'REG_CEMENT_1'; ctx.session.cementData = {};
    await askChoice(ctx, '🧱 `[1/5]` *የሲሚንቶ አይነት ይምረጡ:*', CEMENT_TYPES, 'CTYPE_', 4);
});

bot.action(/^stl_price_([a-f\d]{24})$/i, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const id = getObjId(ctx.match);
    if (!isValidObjectId(id)) return;
    ctx.session.action = 'UPD_STL_PRICE'; ctx.session.targetItemId = id;
    await sendStep(ctx, '💰 *አዲሱን ዋጋ ፐር ኪሎ ያስገቡ:*\nቁጥር ብቻ ብር — ለምሳሌ: 55 ወይም 70');
});
bot.action('stl_add', async ctx => {
    ctx.answerCbQuery().catch(() => {});
    ctx.session.action = 'REG_STEEL_1'; ctx.session.steelData = {};
    await askChoice(ctx, '🟥 `[1/4]` *የብረት አይነት ይምረጡ:*', STEEL_TYPES, 'STYPE_', 3);
});

bot.action(/^mac_price_([a-f\d]{24})$/i, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const id = getObjId(ctx.match);
    if (!isValidObjectId(id)) return;
    ctx.session.action = 'UPD_MAC_PRICE'; ctx.session.targetItemId = id;
    await sendStep(ctx, '💰 *አዲሱን ኪራይ ያስገቡ:*\nቁጥር ብቻ ብር — ለምሳሌ: 15000');
});
bot.action('mac_add', async ctx => {
    ctx.answerCbQuery().catch(() => {});
    ctx.session.action = 'REG_MACHINERY_1'; ctx.session.machineryData = {};
    await askChoice(ctx, '🔹 `[1/4]` *የማሽነሪ አይነት ይምረጡ:*', MACHINERY_TYPES, 'MTYPE_', 2);
    ctx.answerCbQuery();
});

bot.action('MACUNIT_day', async ctx => {
    ctx.answerCbQuery().catch(() => {});
    await deletePrev(ctx);
    ctx.session.machineryData.rentUnit = 'በቀን';
    ctx.session.action = 'REG_MACHINERY_4';
    const sent = await ctx.reply('`[5/5]` 💰 *ኪራይ ዋጋ በቀን ያስገቡ:*\nቁጥር ብቻ ብር — ለምሳሌ: 15000', { parse_mode: 'Markdown', ...cancelKb });
    ctx.session.lastMsgId = sent.message_id;
});

bot.action('MACUNIT_month', async ctx => {
    ctx.answerCbQuery().catch(() => {});
    await deletePrev(ctx);
    ctx.session.machineryData.rentUnit = 'በወር';
    ctx.session.action = 'REG_MACHINERY_4';
    const sent = await ctx.reply('`[5/5]` 💰 *ኪራይ ዋጋ በወር ያስገቡ:*\nቁጥር ብቻ ብር — ለምሳሌ: 350000', { parse_mode: 'Markdown', ...cancelKb });
    ctx.session.lastMsgId = sent.message_id;
});

bot.action(/^trk_route_([a-f\d]{24})$/i, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const id = getObjId(ctx.match);
    if (!isValidObjectId(id)) return;
    ctx.session.action = 'UPD_TRK_ROUTE'; ctx.session.targetItemId = id;
    await sendStep(ctx, '🗺️ *አዲሱን የጉዞ መስመር ያስገቡ:*\nለምሳሌ: ከ አ.አ ወደ ሀዋሳ ወይም በከተማ ውስጥ');
});
bot.action('trk_add', async ctx => {
    ctx.answerCbQuery().catch(() => {});
    ctx.session.action = 'REG_TRUCK_1'; ctx.session.truckData = {};
    await askChoice(ctx, '🚚 `[1/4]` *የመኪናውን አይነት ይምረጡ:*', TRUCK_TYPES, 'TKTYPE_', 2);
});

bot.action('REGTRKMODE_AA', async ctx => {
    ctx.answerCbQuery().catch(() => {});
    await deletePrev(ctx);
    ctx.session.truckData.route = 'አዲስ አበባ ከተማ ውስጥ';
    ctx.session.action = 'REG_TRUCK_4';
    const sent = await ctx.reply('`[4/4]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567', { parse_mode: 'Markdown', ...cancelKb });
    ctx.session.lastMsgId = sent.message_id;
});

bot.action('REGTRKMODE_CITY', async ctx => {
    ctx.answerCbQuery().catch(() => {});
    await deletePrev(ctx);
    ctx.session.action = 'REG_TRUCK_3';
    const sent = await ctx.reply('`[3/4]` 🛣️ *የጉዞ መስመር ያስገቡ:*\nለምሳሌ: ከ አ.አ ወደ ሀዋሳ', { parse_mode: 'Markdown', ...cancelKb });
    ctx.session.lastMsgId = sent.message_id;
});

// ──────────────────────────────────────────────────────────
// DROPDOWN CALLBACKS — SELLER REGISTRATION
// ──────────────────────────────────────────────────────────
bot.action(/^CTYPE_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_CEMENT_1_TEXT';
        await sendStep(ctx, '🧱 *የሲሚንቶ አይነት ጽፈው ያስገቡ:*\nለምሳሌ: ሙገር ወይም ደርባ');
    } else {
        ctx.session.cementData = { type: val };
        ctx.session.action = 'REG_CEMENT_2';
        await askChoice(ctx, '`[2/5]` 📍 *ሲሚንቶው የሚሸጥበት ቦታ ይምረጡ:*', LOCATIONS, 'SLOC_', 4);
    }
});

bot.action(/^SLOC_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_CEMENT_2_TEXT';
        await sendStep(ctx, '📍 *ቦታ ጽፈው ያስገቡ:*\nለምሳሌ: ደብረ ብርሃን ወይም ሞጆ');
    } else {
        ctx.session.cementData.location = val;
        ctx.session.action = 'REG_CEMENT_3';
        await sendStep(ctx, '`[3/5]` 🏭 *የድርጅቱን ስም ያስገቡ:*\nለምሳሌ: ሀበሻ ንግድ ቤት');
    }
});

bot.action(/^STYPE_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ቆርቆሮ (ሌላ)' || val === 'ሌላ') {
        ctx.session.action = 'REG_STEEL_1_TEXT';
        await sendStep(ctx, '🟥 *የብረት አይነት ጽፈው ያስገቡ:*\nለምሳሌ: ባለ 20 ወይም ቆርቆሮ');
    } else {
        ctx.session.steelData = { type: val };
        ctx.session.action = 'REG_STEEL_2';
        await sendStep(ctx, '`[2/4]` 📍 *አድራሻዎን ያስገቡ:*\nብረቱ የሚሸጥበት ቦታ — ለምሳሌ: ቦሌ፣ አዲስ አበባ');
    }
});

bot.action(/^MTYPE_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_MACHINERY_1_TEXT';
        await sendStep(ctx, '🔹 *የማሽነሪ አይነት ጽፈው ያስገቡ:*\nለምሳሌ: ኤክስካቫተር ወይም ሮለር');
    } else {
        ctx.session.machineryData = { type: val };
        ctx.session.action = 'REG_MACHINERY_2';
        await sendStep(ctx, '`[2/4]` 📍 *አድራሻዎን ያስገቡ:*\nማሽነሪው የሚኖርበት ቦታ — ለምሳሌ: አዳማ');
    }
});

bot.action(/^TKTYPE_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ሌላ') {
        ctx.session.action = 'REG_TRUCK_1_TEXT';
        await sendStep(ctx, '🚚 *የመኪናውን አይነት ጽፈው ያስገቡ:*\nለምሳሌ: ሲኖትራክ 10 ጭነት');
    } else {
        ctx.session.truckData = { type: val };
        ctx.session.action = 'REG_TRUCK_2';
        await sendStep(ctx, '`[2/4]` 🚗 *የመኪናው ታርጋ ቁጥር ያስገቡ:*\nለምሳሌ: AA-12345');
    }
});

// ──────────────────────────────────────────────────────────
// DROPDOWN CALLBACKS — BUYER/RENTER
// ──────────────────────────────────────────────────────────
bot.action(/^BCEM_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ሌላ') {
        ctx.session.action = 'BUY_CEMENT_1_TEXT';
        await sendStep(ctx, '🧱 *ምን አይነት ሲሚንቶ ይፈልጋሉ? ጽፈው ያስገቡ:*\nለምሳሌ: ሙገር ወይም ናሽናል');
    } else {
        ctx.session.buyCement = { type: val };
        ctx.session.action = 'BUY_CEMENT_2';
        await askChoice(ctx, '`[2/3]` 📍 *ሲሚንቶ ከየትኛው ከተማ ነው መግዛት የሚፈልጉት?*', LOCATIONS, 'BCEMLOC_', 4);
    }
});

bot.action(/^BCEMLOC_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ሌላ') {
        ctx.session.action = 'BUY_CEMENT_2_TEXT';
        await sendStep(ctx, '📍 *ሲሚንቶ ከየትኛው ከተማ ነው? ጽፈው ያስገቡ:*\nለምሳሌ: ደብረ ብርሃን ወይም ሞጆ');
    } else {
        ctx.session.buyCement.location = val;
        ctx.session.action = 'BUY_CEMENT_3';
        await sendStep(ctx, '`[3/3]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
    }
});

bot.action(/^BSTL_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ቆርቆሮ (ሌላ)' || val === 'ሌላ') {
        ctx.session.action = 'BUY_STEEL_1_TEXT';
        await sendStep(ctx, '🟥 *ምን አይነት ብረት ይፈልጋሉ? ጽፈው ያስገቡ:*\nለምሳሌ: ባለ 20 ወይም ቆርቆሮ');
    } else {
        ctx.session.buySteel = { type: val };
        ctx.session.action = 'BUY_STEEL_2';
        await sendStep(ctx, '`[2/3]` 📍 *ብረት ከየትኛው ቦታ ነው መግዛት የሚፈልጉት?*\nከተማ ወይም አካባቢ ይጻፉ — ለምሳሌ: አዲስ አበባ');
    }
});

bot.action(/^BMAC_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_MACHINERY_1_TEXT';
        await sendStep(ctx, '🔹 *ምን አይነት ማሽነሪ ይፈልጋሉ? ጽፈው ያስገቡ:*\nለምሳሌ: ኤክስካቫተር ወይም ቡልዶዘር');
    } else {
        ctx.session.rentMachinery = { type: val };
        ctx.session.action = 'RENT_MACHINERY_2';
        await sendStep(ctx, '`[2/3]` 📍 *ማሽነሪ ከየትኛው ቦታ ነው የሚፈልጉት?*\nከተማ ወይም አካባቢ ይጻፉ — ለምሳሌ: ባህርዳር');
    }
});

bot.action(/^BTRK_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_TRUCK_1_TEXT';
        await sendStep(ctx, '🚚 *ምን አይነት መኪና ይፈልጋሉ? ጽፈው ያስገቡ:*\nለምሳሌ: ሲኖትራክ ወይም ዳምፕ');
    } else {
        ctx.session.rentTruck = { type: val };
        ctx.session.action = 'RENT_TRUCK_TRIP_MODE';
        await askChoice(ctx, '`[2/5]` 🛣️ *የጉዞ ዓይነት ይምረጡ:*', TRUCK_TRIP_MODE, 'BTRKMODE_', 1, 'BACK_TRUCK_TYPE');
    }
});

bot.action(/^BTRKMODE_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === '🏙️ አዲስ አበባ ከተማ ውስጥ') {
        ctx.session.rentTruck.route = 'አዲስ አበባ ከተማ ውስጥ';
        ctx.session.action = 'RENT_TRUCK_3';
        await sendStep(ctx, '`[3/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
    } else {
        ctx.session.action = 'RENT_TRUCK_2';
        await askChoice(ctx, '`[3/5]` 🛣️ *ጉዞ ከየት ይጀምራሉ? (መነሻ ቦታ):*', TRUCK_ROUTES_FROM, 'BTRKLOC_', 4, 'BACK_TRIP_MODE');
    }
});

bot.action(/^BTRKAA_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ሌላ ሰፈር') {
        ctx.session.action = 'RENT_TRUCK_AA_TEXT';
        await sendStep(ctx, '🏙️ *የሰፈሩን ስም ጽፈው ያስገቡ:*\nለምሳሌ: ላፍቶ ወይም ኮልፌ');
    } else {
        ctx.session.rentTruck.route = `አዲስ አበባ — ${val}`;
        ctx.session.action = 'RENT_TRUCK_3';
        await sendStep(ctx, '`[4/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
    }
});

bot.action('BACK_TRIP_MODE', async ctx => {
    ctx.answerCbQuery().catch(() => {});
    await deletePrev(ctx);
    ctx.session.action = 'RENT_TRUCK_TRIP_MODE';
    await askChoice(ctx, '`[2/5]` 🛣️ *የጉዞ ዓይነት ይምረጡ:*', TRUCK_TRIP_MODE, 'BTRKMODE_', 1, 'BACK_TRUCK_TYPE');
});

bot.action('BACK_TRUCK_TYPE', async ctx => {
    ctx.answerCbQuery().catch(() => {});
    await deletePrev(ctx);
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.session.rentTruck = {};
    await askChoice(ctx, '`[1/5]` 🚚 *ምን አይነት መኪና ይፈልጋሉ?*', TRUCK_TYPES, 'BTRK_', 2, 'go_home');
});

bot.action(/^BTRKLOC_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const raw = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (ctx.session.action === 'RENT_TRUCK_2') {
        if (raw === 'ሌላ') {
            ctx.session.action = 'RENT_TRUCK_2_FROM_TEXT';
            await sendStep(ctx, '🛣️ *ከየት? (መነሻ ቦታ) ጽፈው ያስገቡ:*\nለምሳሌ: ባህርዳር ወይም ጎንደር');
        } else {
            ctx.session.rentTruck.routeFrom = raw;
            ctx.session.action = 'RENT_TRUCK_2_TO';
            await askChoice(ctx, '🛣️ *ወዴት ቦታ ይፈልጋሉ? (መድረሻ):*', TRUCK_ROUTES_TO, 'BTRKTO_', 4, 'BACK_TRIP_MODE');
        }
    }
});

bot.action(/^BTRKTO_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(() => {});
    const val = sanitize(ctx.match[1]);
    await deletePrev(ctx);
    if (val === 'ሌላ') {
        ctx.session.action = 'RENT_TRUCK_2_TO_TEXT';
        await sendStep(ctx, '🛣️ *ወዴት? (መድረሻ ቦታ) ጽፈው ያስገቡ:*\nለምሳሌ: አዲስ አበባ ወይም ሀዋሳ');
    } else {
        ctx.session.rentTruck.route = `ከ ${ctx.session.rentTruck.routeFrom || ''} ወደ ${val}`;
        ctx.session.action = 'RENT_TRUCK_3';
        await sendStep(ctx, '`[4/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
    }
});

// ──────────────────────────────────────────────────────────
// SELLER/LESSOR DASHBOARD
// ──────────────────────────────────────────────────────────
async function openDashboard(ctx, Model, cardFn, kb, emptyAction, emptySession, askChoiceFn) {
    ctx.session.action = null;
    const items = await Model.find({ userId: ctx.from.id }).sort({ createdAt: -1 }).lean();
    if (!items.length) {
        ctx.session.action        = emptyAction;
        ctx.session[emptySession] = {};
        return askChoiceFn(ctx);
    }
    await ctx.reply(
        `👤 *የእርስዎ ምዝገባዎች* — ጠቅላላ: *${items.length}*\n\nሁኔታ ለመቀየር ቁልፎቹን ይጠቀሙ`,
        { parse_mode: 'Markdown' }
    );
    for (const it of items)
        await ctx.reply(cardFn(it, false), { parse_mode: 'Markdown', ...kb(it._id) });
}

bot.hears('🧱 ሲሚንቶ ለመሸጥ', ctx => openDashboard(
    ctx, CementSeller, cementCard, cementItemKb, 'REG_CEMENT_1', 'cementData',
    c => askChoice(c, '🧱 `[1/5]` *የሲሚንቶ አይነት ይምረጡ:*', CEMENT_TYPES, 'CTYPE_', 4)
));
bot.hears('🟥 ብረት ለመሸጥ', ctx => openDashboard(
    ctx, SteelSeller, steelCard, steelItemKb, 'REG_STEEL_1', 'steelData',
    c => askChoice(c, '🟥 `[1/4]` *የብረት አይነት ይምረጡ:*', STEEL_TYPES, 'STYPE_', 3)
));
bot.hears('🔹 ማሽነሪ ለማከራየት', ctx => openDashboard(
    ctx, MachineryLeasor, macCard, macItemKb, 'REG_MACHINERY_1', 'machineryData',
    c => askChoice(c, '🔹 `[1/4]` *የማሽነሪ አይነት ይምረጡ:*', MACHINERY_TYPES, 'MTYPE_', 2)
));
bot.hears('🚚 መኪና ለማከራየት', ctx => openDashboard(
    ctx, TruckLeasor, truckCard, truckItemKb, 'REG_TRUCK_1', 'truckData',
    c => askChoice(c, '🚚 `[1/4]` *የመኪናውን አይነት ይምረጡ:*', TRUCK_TYPES, 'TKTYPE_', 2)
));

// ──────────────────────────────────────────────────────────
// BUYER/RENTER SEARCH FLOWS
// ──────────────────────────────────────────────────────────
bot.hears('🧱 ሲሚንቶ ለመግዛት', ctx => {
    ctx.session.action = 'BUY_CEMENT_1'; ctx.session.buyCement = {};
    askChoice(ctx, '🧱 `[1/3]` *ምን አይነት ሲሚንቶ ይፈልጋሉ?*', CEMENT_TYPES, 'BCEM_', 4);
});
bot.hears('🟥 ብረት ለመግዛት', ctx => {
    ctx.session.action = 'BUY_STEEL_1'; ctx.session.buySteel = {};
    askChoice(ctx, '🟥 `[1/3]` *ምን አይነት ብረት ይፈልጋሉ?*', STEEL_TYPES, 'BSTL_', 3);
});
bot.hears('🔹 ማሽነሪ ለመከራየት', ctx => {
    ctx.session.action = 'RENT_MACHINERY_1'; ctx.session.rentMachinery = {};
    askChoice(ctx, '🔹 `[1/3]` *ምን አይነት ማሽነሪ ይፈልጋሉ?*', MACHINERY_TYPES, 'BMAC_', 2);
});
bot.hears('🚚 መኪና ለመከራየት', async ctx => {
    ctx.session.action = 'RENT_TRUCK_1'; ctx.session.rentTruck = {};
    await askChoice(ctx, '`[1/5]` 🚚 *ምን አይነት መኪና ይፈልጋሉ?*', TRUCK_TYPES, 'BTRK_', 2, 'go_home');
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

    const supportLine =
        `\n📞 *ለተጨማሪ መረጃ ይደዉሉ:*\n` +
        `👉 \`${SUPPORT_PHONE}\``;

    const sellerSupportLine =
        `\n📞 *ለተጨማሪ መረጃ ወይም ድጋፍ:*\n` +
        `👉 \`${SUPPORT_PHONE}\``;

    async function tryFuzzyHint(input, results) {
        if (results.length > 0) return false;
        const closest = findClosestSynonym(input);
        if (closest && closest[0].toLowerCase() !== input.trim().toLowerCase()) {
            await ctx.reply(
                `🤔 *"${esc(input)}"* — ይህን ለማለት ፈልገህ ነው?\n\n` +
                `👉 *"${esc(closest[0])}"*\n\n` +
                `ትክክለኛ ፍለጋ ካልሆነ፣ ቀጥሎ ያለውን ዕቃ ተጠቀሙ።`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[
                        Markup.button.callback(`✅ አዎ — "${closest[0]}" ፈልግ`, `fuzzy_hint_yes`),
                        Markup.button.callback('❌ አይደለም', 'fuzzy_no')
                    ]])
                }
            );
            return true;
        }
        return false;
    }

    try {
        // ══ UPDATE PRICE / ROUTE ══════════════════════════
        if (action === 'UPD_CEM_PRICE') {
            const price = safePrice(text);
            if (!price) return sendStep(ctx, '⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 650 ወይም 1200');
            const id = ctx.session.targetItemId;
            const doc = await CementSeller.findOneAndUpdate(
                { _id: id, userId: uid }, { price }, { new: true }
            ) || (isAdmin(ctx) ? await CementSeller.findByIdAndUpdate(id, { price }, { new: true }) : null);
            if (!doc) return ctx.reply('❗ ፈቃድ የለዎትም ወይም ዕቃው አልተገኘም።');
            ctx.session.action = null;
            await ctx.reply(cementCard(doc.toObject()), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
            return ctx.reply('✅ ዋጋ ተቀይሯል!' + sellerSupportLine, { parse_mode: 'Markdown', ...mainKb });
        }

        if (action === 'UPD_STL_PRICE') {
            const price = safePrice(text);
            if (!price) return sendStep(ctx, '⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 5000');
            const id = ctx.session.targetItemId;
            const doc = await SteelSeller.findOneAndUpdate(
                { _id: id, userId: uid }, { price }, { new: true }
            ) || (isAdmin(ctx) ? await SteelSeller.findByIdAndUpdate(id, { price }, { new: true }) : null);
            if (!doc) return ctx.reply('❗ ፈቃድ የለዎትም ወይም ዕቃው አልተገኘም።');
            ctx.session.action = null;
            await ctx.reply(steelCard(doc.toObject()), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
            return ctx.reply('✅ ዋጋ ተቀይሯል!' + sellerSupportLine, { parse_mode: 'Markdown', ...mainKb });
        }

        if (action === 'UPD_MAC_PRICE') {
            const price = safePrice(text);
            if (!price) return sendStep(ctx, '⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 15000');
            const id = ctx.session.targetItemId;
            const doc = await MachineryLeasor.findOneAndUpdate(
                { _id: id, userId: uid }, { price }, { new: true }
            ) || (isAdmin(ctx) ? await MachineryLeasor.findByIdAndUpdate(id, { price }, { new: true }) : null);
            if (!doc) return ctx.reply('❗ ፈቃድ የለዎትም ወይም ዕቃው አልተገኘም።');
            ctx.session.action = null;
            await ctx.reply(macCard(doc.toObject()), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
            return ctx.reply('✅ ዋጋ ተቀይሯል!' + sellerSupportLine, { parse_mode: 'Markdown', ...mainKb });
        }

        if (action === 'UPD_TRK_ROUTE') {
            const id = ctx.session.targetItemId;
            const doc = await TruckLeasor.findOneAndUpdate(
                { _id: id, userId: uid }, { route: text }, { new: true }
            ) || (isAdmin(ctx) ? await TruckLeasor.findByIdAndUpdate(id, { route: text }, { new: true }) : null);
            if (!doc) return ctx.reply('❗ ፈቃድ የለዎትም ወይም ዕቃው አልተገኘም።');
            ctx.session.action = null;
            await ctx.reply(truckCard(doc.toObject()), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
            return ctx.reply('✅ መስመር ተቀይሯል!' + sellerSupportLine, { parse_mode: 'Markdown', ...mainKb });
        }

        // ══ CEMENT REGISTRATION ════════════════════════════
        if (action === 'REG_CEMENT_1' || action === 'REG_CEMENT_1_TEXT') {
            ctx.session.cementData = { type: text };
            ctx.session.action = 'REG_CEMENT_2';
            return askChoice(ctx, '`[2/5]` 📍 *ሲሚንቶው የሚሸጥበት ቦታ ይምረጡ:*', LOCATIONS, 'SLOC_', 4);
        }
        if (action === 'REG_CEMENT_2' || action === 'REG_CEMENT_2_TEXT') {
            ctx.session.cementData.location = text;
            ctx.session.action = 'REG_CEMENT_3';
            return sendStep(ctx, '`[3/5]` 🏭 *የድርጅቱን ስም ያስገቡ:*\nለምሳሌ: ሀበሻ ንግድ ቤት');
        }
        if (action === 'REG_CEMENT_3') {
            ctx.session.cementData.companyName = text;
            ctx.session.action = 'REG_CEMENT_4';
            return sendStep(ctx, '`[4/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
        }
        if (action === 'REG_CEMENT_4') {
            ctx.session.cementData.phone = safePhone(text);
            ctx.session.action = 'REG_CEMENT_5';
            return sendStep(ctx, '`[5/5]` 💰 *ዋጋ በኩንታል ያስገቡ:*\nቁጥር ብቻ ይጻፉ — ለምሳሌ: 1200 ወይም 1500');
        }
        if (action === 'REG_CEMENT_5') {
            const price = safePrice(text);
            if (!price) return sendStep(ctx, '⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 650 ወይም 1200');
            const doc = await CementSeller.create({ ...ctx.session.cementData, userId: uid, price, status: 'active' });
            ctx.session.action = null;
            await ctx.reply(cementCard(doc.toObject()), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
            return ctx.reply('✅ *ምዝገባ ተጠናቋል!*' + sellerSupportLine, { parse_mode: 'Markdown', ...mainKb });
        }

        // ══ STEEL REGISTRATION ════════════════════════════
        if (action === 'REG_STEEL_1' || action === 'REG_STEEL_1_TEXT') {
            ctx.session.steelData = { type: text };
            ctx.session.action = 'REG_STEEL_2';
            return sendStep(ctx, '`[2/4]` 📍 *አድራሻዎን ያስገቡ:*\nብረቱ የሚሸጥበት ቦታ — ለምሳሌ: ቦሌ፣ አዲስ አበባ');
        }
        if (action === 'REG_STEEL_2') {
            ctx.session.steelData.address = text;
            ctx.session.action = 'REG_STEEL_3';
            return sendStep(ctx, '`[3/4]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
        }
        if (action === 'REG_STEEL_3') {
            ctx.session.steelData.phone = safePhone(text);
            ctx.session.action = 'REG_STEEL_4';
            return sendStep(ctx, '`[4/4]` 💰 *ዋጋ ፐር ኪሎ ግራም ያስገቡ:*\nቁጥር ብቻ ብር — ለምሳሌ: 55 ወይም 70');
        }
        if (action === 'REG_STEEL_4') {
            const price = safePrice(text);
            if (!price) return sendStep(ctx, '⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 55 ወይም 70');
            const doc = await SteelSeller.create({ ...ctx.session.steelData, userId: uid, price, priceUnit: 'ብር/ኪሎ', status: 'active' });
            ctx.session.action = null;
            await ctx.reply(steelCard(doc.toObject()), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
            return ctx.reply('✅ *ምዝገባ ተጠናቋል!*' + sellerSupportLine, { parse_mode: 'Markdown', ...mainKb });
        }

        // ══ MACHINERY REGISTRATION ════════════════════════
        if (action === 'REG_MACHINERY_1' || action === 'REG_MACHINERY_1_TEXT') {
            ctx.session.machineryData = { type: text };
            ctx.session.action = 'REG_MACHINERY_2';
            return sendStep(ctx, '`[2/4]` 📍 *አድራሻዎን ያስገቡ:*\nማሽነሪው የሚኖርበት ቦታ — ለምሳሌ: አዳማ');
        }
        if (action === 'REG_MACHINERY_2') {
            ctx.session.machineryData.address = text;
            ctx.session.action = 'REG_MACHINERY_3';
            return sendStep(ctx, '`[3/4]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
        }
        if (action === 'REG_MACHINERY_3') {
            ctx.session.machineryData.phone = safePhone(text);
            ctx.session.action = 'REG_MACHINERY_UNIT';
            await deletePrev(ctx);
            const sent = await ctx.reply(
                '`[4/5]` 📅 *ኪራይ ዓይነት ይምረጡ:*',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('📅 በቀን', 'MACUNIT_day'),
                         Markup.button.callback('🗓️ በወር', 'MACUNIT_month')]
                    ])
                }
            );
            ctx.session.lastMsgId = sent.message_id;
            return;
        }
        if (action === 'REG_MACHINERY_4') {
            const price = safePrice(text);
            if (!price) return sendStep(ctx, '⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 15000');
            const unit = ctx.session.machineryData.rentUnit || 'በቀን';
            const doc = await MachineryLeasor.create({ ...ctx.session.machineryData, userId: uid, price, rentUnit: unit, status: 'active' });
            ctx.session.action = null;
            await ctx.reply(macCard(doc.toObject()), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
            return ctx.reply('✅ *ምዝገባ ተጠናቋል!*' + sellerSupportLine, { parse_mode: 'Markdown', ...mainKb });
        }

        // ══ TRUCK REGISTRATION ════════════════════════════
        if (action === 'REG_TRUCK_1' || action === 'REG_TRUCK_1_TEXT') {
            ctx.session.truckData = { type: text };
            ctx.session.action = 'REG_TRUCK_2';
            return sendStep(ctx, '`[2/4]` 🚗 *የመኪናው ታርጋ ቁጥር ያስገቡ:*\nለምሳሌ: AA-12345');
        }
        if (action === 'REG_TRUCK_2') {
            ctx.session.truckData.plate = text;
            ctx.session.action = 'REG_TRUCK_ROUTE_MODE';
            await deletePrev(ctx);
            const sent = await ctx.reply(
                '`[3/4]` 🛣️ *የጉዞ ዓይነት ይምረጡ:*',
                {
                    parse_mode: 'Markdown',
                    ...require('telegraf').Markup.inlineKeyboard([
                        [require('telegraf').Markup.button.callback('🏙️ አዲስ አበባ ከተማ ውስጥ', 'REGTRKMODE_AA')],
                        [require('telegraf').Markup.button.callback('🛣️ ከአንድ ከተማ ወደ ሌላ ከተማ', 'REGTRKMODE_CITY')]
                    ])
                }
            );
            ctx.session.lastMsgId = sent.message_id;
            return;
        }
        if (action === 'REG_TRUCK_3') {
            ctx.session.truckData.route = text;
            ctx.session.action = 'REG_TRUCK_4';
            return sendStep(ctx, '`[4/4]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
        }
        if (action === 'REG_TRUCK_4') {
            ctx.session.truckData.phone = safePhone(text);
            const doc = await TruckLeasor.create({ ...ctx.session.truckData, userId: uid, status: 'active', rentedCount: 0 });
            ctx.session.action = null;
            await ctx.reply(truckCard(doc.toObject()), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
            return ctx.reply('✅ *ምዝገባ ተጠናቋል!*' + sellerSupportLine, { parse_mode: 'Markdown', ...mainKb });
        }

        // ══ BUY CEMENT ════════════════════════════════════
        if (action === 'BUY_CEMENT_1' || action === 'BUY_CEMENT_1_TEXT') {
            ctx.session.buyCement = { type: text };
            ctx.session.action = 'BUY_CEMENT_2';
            return askChoice(ctx, '`[2/3]` 📍 *ሲሚንቶ ከየትኛው ከተማ ነው?*', LOCATIONS, 'BCEMLOC_', 4);
        }
        if (action === 'BUY_CEMENT_2' || action === 'BUY_CEMENT_2_TEXT') {
            ctx.session.buyCement.location = text;
            ctx.session.action = 'BUY_CEMENT_3';
            return sendStep(ctx, '`[3/3]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
        }
        if (action === 'BUY_CEMENT_3') {
            const phone = safePhone(text);
            const { type, location } = ctx.session.buyCement;
            const typeRx = searchRx(type);
            const locRx  = searchRx(location);

            let results = await CementSeller.find({
                type: typeRx, location: locRx, status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (!results.length)
                results = await CementSeller.find({ type: typeRx, status: 'active' }).sort({ price: 1 }).limit(5).lean();

            logSearch(ctx, '🧱 ሲሚንቶ ፈላጊ', `${type} — ${location}`, phone);
            ctx.session.action = null;

            const hinted = await tryFuzzyHint(`${type} ${location}`, results);
            if (!hinted && !results.length) {
                return ctx.reply(
                    `😔 *ይቅርታ!*\n\n*${esc(type)}* ሲሚንቶ *${esc(location)}* ቦታ ላይ አልተገኘም።\n\n` +
                    `📞 ለእርዳታ: \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown', ...mainKb }
                );
            }
            if (results.length) {
                await ctx.reply(
                    `✅ *${results.length} ሲሚንቶ ሻጭ ተገኘ!*\n\n` +
                    `📞 ስልክዎ: \`${phone}\``,
                    { parse_mode: 'Markdown' }
                );
                for (const it of results) {
                    await ctx.reply(cementCardBuyer(it), { parse_mode: 'Markdown' });
                    CementSeller.findByIdAndUpdate(it._id, { $inc: { viewCount: 1 } }).catch(() => {});
                }
                await ctx.reply(supportLine, { parse_mode: 'Markdown', ...mainKb });
            }
            return;
        }

        // ══ BUY STEEL ═════════════════════════════════════
        if (action === 'BUY_STEEL_1' || action === 'BUY_STEEL_1_TEXT') {
            ctx.session.buySteel = { type: text };
            ctx.session.action = 'BUY_STEEL_2';
            return sendStep(ctx, '`[2/3]` 📍 *ብረት ከየትኛው ቦታ ነው?*\nከተማ ወይም አካባቢ ይጻፉ');
        }
        if (action === 'BUY_STEEL_2') {
            ctx.session.buySteel.location = text;
            ctx.session.action = 'BUY_STEEL_3';
            return sendStep(ctx, '`[3/3]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
        }
        if (action === 'BUY_STEEL_3') {
            const phone = safePhone(text);
            const { type, location } = ctx.session.buySteel;
            const typeRx = searchRx(type);
            const locRx  = searchRx(location);

            let results = await SteelSeller.find({
                type: typeRx, address: locRx, status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (!results.length)
                results = await SteelSeller.find({ type: typeRx, status: 'active' }).sort({ price: 1 }).limit(5).lean();

            logSearch(ctx, '🟥 ብረት ፈላጊ', `${type} — ${location}`, phone);
            ctx.session.action = null;

            const hinted = await tryFuzzyHint(`${type} ${location}`, results);
            if (!hinted && !results.length) {
                return ctx.reply(
                    `😔 *ይቅርታ!*\n\n*${esc(type)}* ብረት *${esc(location)}* ቦታ ላይ አልተገኘም።\n\n` +
                    `📞 ለእርዳታ: \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown', ...mainKb }
                );
            }
            if (results.length) {
                await ctx.reply(
                    `✅ *${results.length} ብረት ሻጭ ተገኘ!*\n\n` +
                    `📞 ስልክዎ: \`${phone}\``,
                    { parse_mode: 'Markdown' }
                );
                for (const it of results) {
                    await ctx.reply(steelCardBuyer(it), { parse_mode: 'Markdown' });
                    SteelSeller.findByIdAndUpdate(it._id, { $inc: { viewCount: 1 } }).catch(() => {});
                }
                await ctx.reply(supportLine, { parse_mode: 'Markdown', ...mainKb });
            }
            return;
        }

        // ══ RENT MACHINERY ════════════════════════════════
        if (action === 'RENT_MACHINERY_1' || action === 'RENT_MACHINERY_1_TEXT') {
            ctx.session.rentMachinery = { type: text };
            ctx.session.action = 'RENT_MACHINERY_2';
            return sendStep(ctx, '`[2/3]` 📍 *ማሽነሪ ከየትኛው ቦታ ነው?*\nከተማ ወይም አካባቢ ይጻፉ');
        }
        if (action === 'RENT_MACHINERY_2') {
            ctx.session.rentMachinery.location = text;
            ctx.session.action = 'RENT_MACHINERY_3';
            return sendStep(ctx, '`[3/3]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
        }
        if (action === 'RENT_MACHINERY_3') {
            const phone = safePhone(text);
            const { type, location } = ctx.session.rentMachinery;
            const typeRx = searchRx(type);
            const locRx  = searchRx(location);

            let results = await MachineryLeasor.find({
                type: typeRx, address: locRx, status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (!results.length)
                results = await MachineryLeasor.find({ type: typeRx, status: 'active' }).sort({ price: 1 }).limit(5).lean();

            logSearch(ctx, '🔹 ማሽነሪ ፈላጊ', `${type} — ${location}`, phone);
            ctx.session.action = null;

            const hinted = await tryFuzzyHint(`${type} ${location}`, results);
            if (!hinted && !results.length) {
                return ctx.reply(
                    `😔 *ይቅርታ!*\n\n*${esc(type)}* ማሽነሪ *${esc(location)}* ቦታ ላይ አልተገኘም።\n\n` +
                    `📞 ለእርዳታ: \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown', ...mainKb }
                );
            }
            if (results.length) {
                await ctx.reply(
                    `✅ *${results.length} ማሽነሪ ተገኘ!*\n\n` +
                    `📞 ስልክዎ: \`${phone}\``,
                    { parse_mode: 'Markdown' }
                );
                for (const it of results) {
                    await ctx.reply(macCardBuyer(it), { parse_mode: 'Markdown' });
                    MachineryLeasor.findByIdAndUpdate(it._id, { $inc: { viewCount: 1 } }).catch(() => {});
                }
                await ctx.reply(supportLine, { parse_mode: 'Markdown', ...mainKb });
            }
            return;
        }

        // ══ RENT TRUCK ════════════════════════════════════
        if (action === 'RENT_TRUCK_1' || action === 'RENT_TRUCK_1_TEXT') {
            ctx.session.rentTruck = { type: text };
            ctx.session.action = 'RENT_TRUCK_TRIP_MODE';
            return askChoice(ctx, '`[2/5]` 🛣️ *የጉዞ ዓይነት ይምረጡ:*', TRUCK_TRIP_MODE, 'BTRKMODE_', 1, 'BACK_TRUCK_TYPE');
        }

        if (action === 'RENT_TRUCK_AA_TEXT') {
            ctx.session.rentTruck.route = `አዲስ አበባ — ${text}`;
            ctx.session.action = 'RENT_TRUCK_3';
            return sendStep(ctx, '`[4/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
        }

        if (action === 'RENT_TRUCK_2_FROM_TEXT') {
            ctx.session.rentTruck.routeFrom = text;
            ctx.session.action = 'RENT_TRUCK_2_TO';
            return askChoice(ctx, '🛣️ *ወዴት ቦታ ይፈልጋሉ? (መድረሻ):*', TRUCK_ROUTES_TO, 'BTRKTO_', 4, 'BACK_TRIP_MODE');
        }

        if (action === 'RENT_TRUCK_2_TO_TEXT') {
            ctx.session.rentTruck.route = `ከ ${ctx.session.rentTruck.routeFrom || ''} ወደ ${text}`;
            ctx.session.action = 'RENT_TRUCK_3';
            return sendStep(ctx, '`[4/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*\nለምሳሌ: 0911234567');
        }

        if (action === 'RENT_TRUCK_3') {
            ctx.session.rentTruck.phone = safePhone(text);
            ctx.session.action = 'RENT_TRUCK_4';
            return sendStep(ctx, '`[5/5]` 📦 *ምን ዓይነት ጭነት ነው?*\nለምሳሌ: ሲሚንቶ፣ ብረት፣ ጥቅል ዕቃ ወይም ሌላ');
        }

        if (action === 'RENT_TRUCK_4') {
            const cargo = text;
            const phone = ctx.session.rentTruck.phone;
            const { type, route } = ctx.session.rentTruck;

            const results = await findTruck(type, route);

            logSearch(ctx, '🚚 ትራክ ፈላጊ', `${type} — ${route} — ${cargo}`, phone);
            ctx.session.action = null;

            const hinted = await tryFuzzyHint(`${type} ${route}`, results);
            if (!hinted && !results.length) {
                return ctx.reply(
                    `😔 *ይቅርታ!*\n\n*${esc(type)}* — *${esc(route)}* — *${esc(cargo)}*\n\nምንም መኪና አልተገኘም።\n\n` +
                    `📞 ለእርዳታ: \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown', ...mainKb }
                );
            }
            if (results.length) {
                await ctx.reply(
                    `✅ *${results.length} መኪናው ዝግጁ ነው!*\n\n` +
                    `📞 ስልክዎ: \`${phone}\``,
                    { parse_mode: 'Markdown' }
                );
                for (const it of results)
                    await ctx.reply(truckCardBuyer(it), { parse_mode: 'Markdown' });
                await ctx.reply(supportLine, { parse_mode: 'Markdown', ...mainKb });

                // Increment rentedCount and viewCount
                for (const it of results)
                    TruckLeasor.findByIdAndUpdate(it._id, { $inc: { rentedCount: 1, viewCount: 1 } }).catch(() => {});
            }
            return;
        }

    } catch (err) {
        console.error('State machine error:', err);
        await ctx.reply('⚠️ ስህተት ተፈጥሯል። እባክዎ ዳግም ይሞክሩ።', mainKb);
    }
});

// Fuzzy hint callbacks
bot.action('fuzzy_hint_yes', async ctx => { ctx.answerCbQuery().catch(() => {}); });
bot.action('fuzzy_no',       async ctx => { ctx.answerCbQuery('እሺ!').catch(() => {}); });

// ──────────────────────────────────────────────────────────
// HTTP KEEP-ALIVE SERVER (for Render)
// ──────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
});
server.listen(PORT, () => console.log(`🌐 HTTP server on port ${PORT}`));

// Self-ping to avoid Render free-tier spin-down — every 25 seconds for 24/7 reliability
if (RENDER_URL) {
    setInterval(() => {
        http.get(RENDER_URL).on('error', () => {});
    }, 25 * 1000);
}

// ──────────────────────────────────────────────────────────
// LAUNCH
// ──────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────
// LAUNCH
// ──────────────────────────────────────────────────────────
async function launch() {
    if (RENDER_URL) {
        const webhookPath = `/webhook/${crypto.randomBytes(12).toString('hex')}`;
        const webhookUrl  = `${RENDER_URL}${webhookPath}`;
        server.on('request', (req, res) => {
            if (req.method === 'POST' && req.url === webhookPath) {
                let body = '';
                req.on('data', d => body += d);
                req.on('end', () => {
                    try { bot.handleUpdate(JSON.parse(body), res); } catch { res.end(); }
                });
            }
        });
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`🔗 Webhook set: ${webhookUrl}`);
    } else {
        await bot.telegram.deleteWebhook();
        bot.launch({ allowedUpdates: ['message', 'callback_query'] });
        console.log('🤖 Bot launched (long-polling)');
    }
}

launch().catch(err => {
    console.error('❌ Bot launch failed:', err);
    process.exit(1);
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
