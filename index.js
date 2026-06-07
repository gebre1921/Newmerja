'use strict';

const { Telegraf, Markup } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose');

// ============================================================
// CONFIG
// ============================================================
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim().replace(/['"]/g, '');
const MONGO_URI  = process.env.MONGO_URI  || '';
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '0960336138';
const ADMIN_IDS = (process.env.ADMIN_IDS || '7423347375')
    .split(',').map(id => Number(id.trim()));
const PORT = Number(process.env.PORT) || 10000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || '';   // ለ keep-alive ping

if (!BOT_TOKEN || !MONGO_URI) {
    console.error('❌ BOT_TOKEN ወይም MONGO_URI አልተገኘም!');
    process.exit(1);
}

// ============================================================
// MONGOOSE SCHEMAS
// ============================================================
const cementSchema = new mongoose.Schema({
    userId:      { type: Number, required: true },
    type:        String,
    location:    String,
    companyName: String,
    phone:       String,
    price:       Number,          // ዋጋ per ኩንታል
    status:      { type: String, default: 'active' },
    createdAt:   { type: Date, default: Date.now }
});

const steelSchema = new mongoose.Schema({
    userId:    { type: Number, required: true },
    type:      String,
    address:   String,
    phone:     String,
    price:     String,
    status:    { type: String, default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

const machinerySchema = new mongoose.Schema({
    userId:    { type: Number, required: true },
    type:      String,
    address:   String,
    phone:     String,
    price:     String,
    status:    { type: String, default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

const truckSchema = new mongoose.Schema({
    userId:      { type: Number, required: true },
    type:        String,
    plate:       String,
    route:       String,
    phone:       String,
    status:      { type: String, default: 'active' },
    rentedCount: { type: Number, default: 0 },
    createdAt:   { type: Date, default: Date.now }
});

const searchLogSchema = new mongoose.Schema({
    userId:     Number,
    username:   String,
    category:   String,
    searchedFor:String,
    phone:      String,
    createdAt:  { type: Date, default: Date.now }
});

const activeLogSchema = new mongoose.Schema({
    userId:    Number,
    name:      String,
    category:  String,
    detail:    String,
    dateStr:   String,
    createdAt: { type: Date, default: Date.now }
});

const sessionSchema = new mongoose.Schema({
    key:  { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
});

// ---- ለ userId ብዙ ምዝገባ እንዲቻል unique index ተወግዷል ----
const CementSeller   = mongoose.model('CementSeller',   cementSchema);
const SteelSeller    = mongoose.model('SteelSeller',    steelSchema);
const MachineryLeasor= mongoose.model('MachineryLeasor',machinerySchema);
const TruckLeasor    = mongoose.model('TruckLeasor',    truckSchema);
const SearchLog      = mongoose.model('SearchLog',      searchLogSchema);
const ActiveLog      = mongoose.model('ActiveLog',      activeLogSchema);
const BotSession     = mongoose.model('BotSession',     sessionSchema);

// ============================================================
// MONGODB — CONNECTION WITH AUTO-RECONNECT
// ============================================================
const MONGO_OPTS = {
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45000,
    heartbeatFrequencyMS: 10000,
    retryWrites: true
};

async function connectMongo() {
    try {
        await mongoose.connect(MONGO_URI, MONGO_OPTS);
        console.log('✅ MongoDB Connected');
        await Promise.all([
            TruckLeasor.collection.createIndex({ userId: 1, status: 1 }),
            TruckLeasor.collection.createIndex({ type: 1, route: 1, status: 1 }),
            CementSeller.collection.createIndex({ userId: 1, status: 1 }),
            CementSeller.collection.createIndex({ type: 1, location: 1, status: 1 }),
            SteelSeller.collection.createIndex({ userId: 1, status: 1 }),
            SteelSeller.collection.createIndex({ type: 1, status: 1 }),
            MachineryLeasor.collection.createIndex({ userId: 1, status: 1 }),
            MachineryLeasor.collection.createIndex({ type: 1, status: 1 }),
            BotSession.collection.createIndex({ key: 1 }, { unique: true }),
        ]);
        console.log('✅ Indexes Ready');
    } catch (err) {
        console.error('❌ MongoDB connection failed:', err.message);
        setTimeout(connectMongo, 5000);
    }
}

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB Disconnected — retrying...');
    setTimeout(connectMongo, 3000);
});
mongoose.connection.on('error', err => console.error('Mongo Error:', err));

connectMongo();

// ============================================================
// BOT
// ============================================================
const bot = new Telegraf(BOT_TOKEN, {
    handlerTimeout: 90_000,
    telegram: { webhookReply: false }
});

// ---- In-Memory Session Cache (LRU-like, max 5000 entries) ----
const SESSION_MAX = 5000;
const sessionCache = new Map();

function lruSet(key, value) {
    if (sessionCache.size >= SESSION_MAX && !sessionCache.has(key)) {
        const oldest = sessionCache.keys().next().value;
        sessionCache.delete(oldest);
    }
    sessionCache.set(key, value);
}

bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const sessionKey = String(ctx.from.id);
    if (!sessionCache.has(sessionKey)) {
        const doc = await BotSession.findOne({ key: sessionKey }).lean().catch(() => null);
        lruSet(sessionKey, doc?.data || {});
    }
    ctx.session = sessionCache.get(sessionKey);
    await next();
    lruSet(sessionKey, ctx.session);
    BotSession.updateOne(
        { key: sessionKey },
        { $set: { data: ctx.session } },
        { upsert: true }
    ).catch(() => {});
});

// ============================================================
// HELPERS
// ============================================================
function getTodayStr() {
    const d = new Date();
    d.setHours(d.getHours() + 3);
    return d.toISOString().split('T')[0];
}

function searchRx(input) {
    if (!input) return new RegExp('', 'i');
    const clean = input.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return /[a-zA-Z]/.test(clean)
        ? new RegExp(clean.split('').join('.*'), 'i')
        : new RegExp(clean, 'i');
}

function isAdmin(ctx) {
    return ADMIN_IDS.includes(ctx.from?.id);
}

async function logSearch(ctx, category, searchedFor, phone) {
    await SearchLog.create({
        userId: ctx.from.id,
        username: ctx.from.username || 'N/A',
        category, searchedFor, phone
    }).catch(() => {});
}

// ============================================================
// KEYBOARDS
// ============================================================
const mainKeyboard = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ',    '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት',   '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ',     '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

// ---- Inline keyboards for sellers ----
const cementSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('🟢 አለ (ዝግጁ)', 'cement_active'),
     Markup.button.callback('🔴 የለም',       'cement_off')],
    [Markup.button.callback('💰 ዋጋ ቀይር',   'cement_update_price'),
     Markup.button.callback('➕ ሌላ ጨምር',   'cement_add_more')]
]);

const steelSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('🟢 አለ (ዝግጁ)', 'steel_active'),
     Markup.button.callback('🔴 የለም',       'steel_off')],
    [Markup.button.callback('💰 ዋጋ ቀይር',   'steel_update_price'),
     Markup.button.callback('➕ ሌላ ጨምር',   'steel_add_more')]
]);

const machineryLeasorInline = Markup.inlineKeyboard([
    [Markup.button.callback('🟢 አለ (ዝግጁ)', 'machinery_active'),
     Markup.button.callback('🔴 የለም',       'machinery_off')],
    [Markup.button.callback('💰 ዋጋ ቀይር',   'machinery_update_price'),
     Markup.button.callback('➕ ሌላ ጨምር',   'machinery_add_more')]
]);

// ============================================================
// LISTING DISPLAY HELPERS
// ============================================================
function formatCementList(items) {
    return items.map((item, i) =>
        `${i + 1}. 🏭 ${item.companyName}\n` +
        `   🧱 አይነት: ${item.type}\n` +
        `   📍 ቦታ: ${item.location}\n` +
        `   📞 ስልክ: ${item.phone}\n` +
        `   💰 ዋጋ: ${item.price?.toLocaleString() || '—'} ብር / ኩንታል\n` +
        `   🔵 ሁኔታ: ${item.status === 'active' ? '✅ አለ' : '❌ የለም'}`
    ).join('\n────────────\n');
}

function formatTruckList(items) {
    return items.map((item, i) =>
        `${i + 1}. 🚚 ${item.type} | ታርጋ: ${item.plate}\n` +
        `   🛣️ መስመር: ${item.route}\n` +
        `   📞 ስልክ: ${item.phone}\n` +
        `   🔵 ሁኔታ: ${item.status === 'active' ? '✅ ዝግጁ' : '⏳ ስራ ላይ'}`
    ).join('\n────────────\n');
}

function buildMyItemsInline(items, prefix) {
    const buttons = [];
    items.forEach(it => {
        const label = prefix === 'cem'
            ? `${it.companyName || it.type} | ${it.location}`
            : prefix === 'trk'
            ? `ታርጋ: ${it.plate} (${it.type})`
            : prefix === 'stl'
            ? `${it.type} | ${it.address}`
            : `${it.type} | ${it.address}`;

        buttons.push([
            Markup.button.callback(`📋 ${label}`, `view_${prefix}_${it._id}`)
        ]);
        if (prefix === 'trk') {
            buttons.push([
                Markup.button.callback('✅ ዝግጁ',       `tr_act_${it._id}`),
                Markup.button.callback('⏳ ስራ ላይ',     `tr_off_${it._id}`),
                Markup.button.callback('🗺️ መስመር ቀይር', `tr_route_${it._id}`)
            ]);
        }
    });
    const addLabel = prefix === 'cem' ? '➕ ሲሚንቶ ጨምር'
                   : prefix === 'trk' ? '➕ መኪና ጨምር'
                   : prefix === 'stl' ? '➕ ብረት ጨምር'
                   :                    '➕ ማሽነሪ ጨምር';
    const addAction = prefix === 'cem' ? 'cement_add_more'
                    : prefix === 'trk' ? 'truck_new_reg'
                    : prefix === 'stl' ? 'steel_add_more'
                    :                    'machinery_add_more';
    buttons.push([Markup.button.callback(addLabel, addAction)]);
    return Markup.inlineKeyboard(buttons);
}

// ============================================================
// START
// ============================================================
bot.start(ctx => {
    ctx.session = {};
    ctx.reply(
        `🌟 እንኳን ወደ Simple ቦት በሰላም መጡ!\n\n` +
        `ሲሚንቶ፣ ብረት፣ ማሽነሪ ወይም ትራክ ለመሸጥ/ለመግዛት/ለማከራየት/ለመከራየት ከታቹ ካሉት ይምረጡ 👇`,
        mainKeyboard
    );
});

// ============================================================
// ADMIN PANEL
// ============================================================
bot.command('admin_panel', async ctx => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም!');
    const menu = Markup.inlineKeyboard([
        [Markup.button.callback('🧱 ሲሚንቶ ሪፖርት',   'rep_cement'),
         Markup.button.callback('🚚 መኪና ሪፖርት',    'rep_truck')],
        [Markup.button.callback('🟥 ብረት ሪፖርት',    'rep_steel'),
         Markup.button.callback('🔹 ማሽነሪ ሪፖርት',  'rep_machinery')],
        [Markup.button.callback('📊 የፍለጋ ሪፖርት',  'rep_searches'),
         Markup.button.callback('👥 ዛሬ Active',    'rep_actives')],
        [Markup.button.callback('🗑️ ማጥፊያ ፓናል',  'admin_delete_menu')]
    ]);
    ctx.reply('🔧 *አድሚን ፓናል*\nእባክዎ ዘርፍ ይምረጡ፦', { parse_mode: 'Markdown', ...menu });
});

// ---- Admin reports ----
async function sendReport(ctx, Model, title, format) {
    const items = await Model.find({}).lean();
    if (!items.length) return ctx.reply(`${title}: ምንም መረጃ የለም።`);
    const chunks = [];
    let chunk = `📋 *${title}*\n\n`;
    items.forEach((item, idx) => {
        const line = format(item, idx) + '\n────────────\n';
        if (chunk.length + line.length > 3800) { chunks.push(chunk); chunk = ''; }
        chunk += line;
    });
    if (chunk) chunks.push(chunk);
    for (const c of chunks) await ctx.reply(c, { parse_mode: 'Markdown' });
    ctx.answerCbQuery?.();
}

bot.action('rep_cement', ctx => sendReport(ctx, CementSeller, 'የሲሚንቶ ሻጮች',
    (it, i) => `${i+1}. ${it.companyName} | ${it.type} | ${it.location}\n   💰 ${it.price?.toLocaleString()} ብር/ኩንታል | ${it.phone} | ${it.status === 'active' ? '✅' : '❌'}`
));
bot.action('rep_truck', ctx => sendReport(ctx, TruckLeasor, 'የመኪና አከራዮች',
    (it, i) => `${i+1}. ${it.type} | ታርጋ: ${it.plate}\n   🛣️ ${it.route} | ${it.phone} | ${it.status === 'active' ? '✅' : '⏳'}`
));
bot.action('rep_steel', ctx => sendReport(ctx, SteelSeller, 'የብረት ሻጮች',
    (it, i) => `${i+1}. ${it.type} | ${it.address} | ${it.phone} | 💰${it.price} | ${it.status === 'active' ? '✅' : '❌'}`
));
bot.action('rep_machinery', ctx => sendReport(ctx, MachineryLeasor, 'የማሽነሪ አከራዮች',
    (it, i) => `${i+1}. ${it.type} | ${it.address} | ${it.phone} | 💰${it.price} | ${it.status === 'active' ? '✅' : '❌'}`
));

bot.action('rep_searches', async ctx => {
    const logs = await SearchLog.find({}).sort({ createdAt: -1 }).limit(50).lean();
    if (!logs.length) return ctx.reply('ምንም የፍለጋ ታሪክ የለም።');
    let msg = '📊 *የፍለጋ ሪፖርት (ቅርብ 50)*\n\n';
    logs.forEach((l, i) => { msg += `${i+1}. [${l.category}] ${l.searchedFor} | 📞${l.phone}\n`; });
    ctx.reply(msg, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

bot.action('rep_actives', async ctx => {
    const today = getTodayStr();
    const logs  = await ActiveLog.find({ dateStr: today }).sort({ createdAt: -1 }).lean();
    if (!logs.length) return ctx.reply('ዛሬ Active ተጠቃሚዎች የሉም።');
    let msg = `👥 *ዛሬ (${today}) Active ተጠቃሚዎች*\n\n`;
    logs.forEach((l, i) => { msg += `${i+1}. ${l.name} — ${l.category}\n`; });
    ctx.reply(msg, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ---- Admin Delete ----
bot.action('admin_delete_menu', ctx => {
    ctx.reply('ማጥፋት የሚፈልጉትን ዘርፍ ይምረጡ፦', Markup.inlineKeyboard([
        [Markup.button.callback('🧱 ሲሚንቶ', 'adm_del_cement'),
         Markup.button.callback('🚚 መኪና',  'adm_del_truck')],
        [Markup.button.callback('🟥 ብረት',  'adm_del_steel'),
         Markup.button.callback('🔹 ማሽነሪ','adm_del_machinery')]
    ]));
    ctx.answerCbQuery();
});

async function buildDeleteMenu(ctx, Model, labelFn, prefix, title) {
    const items = await Model.find({}).lean();
    if (!items.length) return ctx.reply('የሚጠፋ መረጃ የለም።');
    ctx.reply(`${title} — የሚያጠፉትን ይምረጡ፦`,
        Markup.inlineKeyboard(items.map(it => [
            Markup.button.callback(labelFn(it), `adm_do_del_${prefix}_${it._id}`)
        ]))
    );
    ctx.answerCbQuery();
}

bot.action('adm_del_cement',   ctx => buildDeleteMenu(ctx, CementSeller,    it => `${it.companyName}(${it.phone})`, 'cem', '🧱 ሲሚንቶ'));
bot.action('adm_del_truck',    ctx => buildDeleteMenu(ctx, TruckLeasor,     it => `${it.plate}(${it.phone})`,       'trk', '🚚 መኪና'));
bot.action('adm_del_steel',    ctx => buildDeleteMenu(ctx, SteelSeller,     it => `${it.type}(${it.phone})`,        'stl', '🟥 ብረት'));
bot.action('adm_del_machinery',ctx => buildDeleteMenu(ctx, MachineryLeasor, it => `${it.type}(${it.phone})`,        'mac', '🔹 ማሽነሪ'));

const MODEL_MAP = { cem: CementSeller, trk: TruckLeasor, stl: SteelSeller, mac: MachineryLeasor };
bot.action(/^adm_do_del_(cem|trk|stl|mac)_([a-f\d]+)$/i, async ctx => {
    const [, prefix, id] = ctx.match;
    await MODEL_MAP[prefix].findByIdAndDelete(id);
    ctx.reply('🗑️ መረጃው ከዳታቤዝ ተሰርዟል።');
    ctx.answerCbQuery();
});

// ============================================================
// MENU LISTENERS — ሲሚንቶ ለመሸጥ
// ============================================================
bot.hears('🧱 ሲሚንቶ ለመሸጥ', async ctx => {
    ctx.session.action = null;
    const items = await CementSeller.find({ userId: ctx.from.id }).lean();
    if (items.length) {
        const msg = `👋 ${ctx.from.first_name || 'ተጠቃሚ'}!\n\n📋 *የተመዘገቡ ሲሚንቶዎችዎ:*\n\n${formatCementList(items)}\n\nምን ማድረግ ይፈልጋሉ?`;
        ctx.reply(msg, { parse_mode: 'Markdown', ...buildMyItemsInline(items, 'cem') });
    } else {
        ctx.session.action = 'REG_CEMENT_1';
        ctx.session.cementData = {};
        ctx.reply('1️⃣ ለመመዝገብ የሲሚንቶ አይነት ያስገቡ (ለምሳሌ፦ ዳንጎቴ):');
    }
});

// ============================================================
// MENU LISTENERS — ሲሚንቶ ለመግዛት
// ============================================================
bot.hears('🧱 ሲሚንቶ ለመግዛት', ctx => {
    ctx.session.action = 'BUY_CEMENT_1';
    ctx.session.buyCement = {};
    ctx.reply('1️⃣ ምን አይነት ሲሚንቶ ነው የሚፈልጉት? (ለምሳሌ: ዳንጎቴ)');
});

// ============================================================
// MENU LISTENERS — መኪና ለማከራየት
// ============================================================
bot.hears('🚚 መኪና ለማከራየት', async ctx => {
    ctx.session.action = null;
    const trucks = await TruckLeasor.find({ userId: ctx.from.id }).lean();
    if (trucks.length) {
        ctx.reply(
            `🚚 *የእርስዎ መኪናዎች*\n\n${formatTruckList(trucks)}\n\nሁኔታ ለመቀየር ወይም ሌላ ለመጨምር ይምረጡ:`,
            { parse_mode: 'Markdown', ...buildMyItemsInline(trucks, 'trk') }
        );
    } else {
        ctx.session.action = 'REG_TRUCK_1';
        ctx.session.truckData = {};
        ctx.reply('1️⃣ የመኪናውን አይነት ያስገቡ (ለምሳሌ: ሲኖትራክ):');
    }
});

// ============================================================
// MENU LISTENERS — መኪና ለመከራየት
// ============================================================
bot.hears('🚚 መኪና ለመከራየት', ctx => {
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.session.rentTruck = {};
    ctx.reply('1️⃣ ምን አይነት መኪና ይፈልጋሉ? (ለምሳሌ: ሲኖትራክ)');
});

// ============================================================
// MENU LISTENERS — ብረት ለመሸጥ
// ============================================================
bot.hears('🟥 ብረት ለመሸጥ', async ctx => {
    ctx.session.action = null;
    const items = await SteelSeller.find({ userId: ctx.from.id }).lean();
    if (items.length) {
        const list = items.map((it, i) =>
            `${i+1}. 🟥 ${it.type}\n   📍 ${it.address} | 📞 ${it.phone}\n   💰 ${it.price} ብር | ${it.status === 'active' ? '✅ አለ' : '❌ የለም'}`
        ).join('\n────────────\n');
        ctx.reply(`📋 *የተመዘገቡ ብረቶችዎ:*\n\n${list}\n\nምን ማድረግ ይፈልጋሉ?`,
            { parse_mode: 'Markdown', ...buildMyItemsInline(items, 'stl') });
    } else {
        ctx.session.action = 'REG_STEEL_1';
        ctx.session.steelData = {};
        ctx.reply('1️⃣ ለመመዝገብ የብረት አይነት ያስገቡ (ለምሳሌ: ባለ 10 ቆርቆሮ):');
    }
});

// ============================================================
// MENU LISTENERS — ብረት ለመግዛት
// ============================================================
bot.hears('🟥 ብረት ለመግዛት', ctx => {
    ctx.session.action = 'BUY_STEEL_1';
    ctx.session.buySteel = {};
    ctx.reply('1️⃣ ምን አይነት ብረት ይፈልጋሉ?');
});

// ============================================================
// MENU LISTENERS — ማሽነሪ ለማከራየት
// ============================================================
bot.hears('🔹 ማሽነሪ ለማከራየት', async ctx => {
    ctx.session.action = null;
    const items = await MachineryLeasor.find({ userId: ctx.from.id }).lean();
    if (items.length) {
        const list = items.map((it, i) =>
            `${i+1}. 🔹 ${it.type}\n   📍 ${it.address} | 📞 ${it.phone}\n   💰 ${it.price} ብር | ${it.status === 'active' ? '✅ አለ' : '❌ የለም'}`
        ).join('\n────────────\n');
        ctx.reply(`📋 *የተመዘገቡ ማሽነሪዎችዎ:*\n\n${list}\n\nምን ማድረግ ይፈልጋሉ?`,
            { parse_mode: 'Markdown', ...buildMyItemsInline(items, 'mac') });
    } else {
        ctx.session.action = 'REG_MACHINERY_1';
        ctx.session.machineryData = {};
        ctx.reply('1️⃣ ለመመዝገብ የማሽነሪ አይነት ያስገቡ (ለምሳሌ: ኤክስካቫተር):');
    }
});

// ============================================================
// MENU LISTENERS — ማሽነሪ ለመከራየት
// ============================================================
bot.hears('🔹 ማሽነሪ ለመከራየት', ctx => {
    ctx.session.action = 'RENT_MACHINERY_1';
    ctx.session.rentMachinery = {};
    ctx.reply('1️⃣ የሚፈልጉት የማሽነሪ አይነት ያስገቡ:');
});

// ============================================================
// INLINE ACTIONS — ሌላ ጨምር (Add More)
// ============================================================
bot.action('cement_add_more', ctx => {
    ctx.session.action = 'REG_CEMENT_1';
    ctx.session.cementData = {};
    ctx.reply('1️⃣ አዲሱ ሲሚንቶ አይነት ያስገቡ (ለምሳሌ: ዳንጎቴ):');
    ctx.answerCbQuery();
});
bot.action('steel_add_more', ctx => {
    ctx.session.action = 'REG_STEEL_1';
    ctx.session.steelData = {};
    ctx.reply('1️⃣ አዲሱ ብረት አይነት ያስገቡ:');
    ctx.answerCbQuery();
});
bot.action('machinery_add_more', ctx => {
    ctx.session.action = 'REG_MACHINERY_1';
    ctx.session.machineryData = {};
    ctx.reply('1️⃣ አዲሱ ማሽነሪ አይነት ያስገቡ:');
    ctx.answerCbQuery();
});
bot.action('truck_new_reg', ctx => {
    ctx.session.action = 'REG_TRUCK_1';
    ctx.session.truckData = {};
    ctx.reply('1️⃣ አዲሱ መኪና አይነት ያስገቡ:');
    ctx.answerCbQuery();
});

// ============================================================
// INLINE ACTIONS — ሁኔታ ቀይር
// ============================================================
async function toggleStatus(ctx, Model, filter, newStatus, msg) {
    await Model.findOneAndUpdate(filter, { status: newStatus });
    ctx.reply(msg);
    ctx.answerCbQuery();
}

bot.action('cement_active',  ctx => toggleStatus(ctx, CementSeller,    { userId: ctx.from.id }, 'active', '🟢 ሲሚንቶ "አለ (ዝግጁ)" ተቀይሯል።'));
bot.action('cement_off',     ctx => toggleStatus(ctx, CementSeller,    { userId: ctx.from.id }, 'off',    '🔴 ሲሚንቶ "የለም" ተቀይሯል።'));
bot.action('steel_active',   ctx => toggleStatus(ctx, SteelSeller,     { userId: ctx.from.id }, 'active', '🟢 ብረት "አለ (ዝግጁ)" ተቀይሯል።'));
bot.action('steel_off',      ctx => toggleStatus(ctx, SteelSeller,     { userId: ctx.from.id }, 'off',    '🔴 ብረት "የለም" ተቀይሯል።'));
bot.action('machinery_active',ctx => toggleStatus(ctx, MachineryLeasor,{ userId: ctx.from.id }, 'active', '🟢 ማሽነሪ "አለ (ዝግጁ)" ተቀይሯል።'));
bot.action('machinery_off',   ctx => toggleStatus(ctx, MachineryLeasor,{ userId: ctx.from.id }, 'off',    '🔴 ማሽነሪ "የለም" ተቀይሯል።'));

bot.action(/^tr_act_([a-f\d]+)$/i, async ctx => {
    await TruckLeasor.findByIdAndUpdate(ctx.match[1], { status: 'active' });
    ctx.reply('✅ መኪናዎ "ዝግጁ" ተቀይሯል።'); ctx.answerCbQuery();
});
bot.action(/^tr_off_([a-f\d]+)$/i, async ctx => {
    await TruckLeasor.findByIdAndUpdate(ctx.match[1], { status: 'off' });
    ctx.reply('⏳ መኪናዎ "ስራ ላይ" ተቀይሯል።'); ctx.answerCbQuery();
});
bot.action(/^tr_route_([a-f\d]+)$/i, ctx => {
    ctx.session.action = 'UPDATE_TRUCK_ROUTE';
    ctx.session.targetTruckId = ctx.match[1];
    ctx.reply('🗺️ አዲሱን የጉዞ መስመር ያስገቡ (ለምሳሌ: ከአዲስ አበባ ወደ ሀዋሳ):');
    ctx.answerCbQuery();
});

// ---- ዋጋ ቀይር buttons ----
bot.action('cement_update_price',   ctx => { ctx.session.action = 'UPDATE_CEMENT_PRICE';   ctx.reply('💰 አዲሱን የሲሚንቶ ዋጋ per ኩንታል ያስገቡ (በብር):'); ctx.answerCbQuery(); });
bot.action('steel_update_price',    ctx => { ctx.session.action = 'UPDATE_STEEL_PRICE';    ctx.reply('💰 አዲሱን የብረት ዋጋ ያስገቡ (በብር):');            ctx.answerCbQuery(); });
bot.action('machinery_update_price',ctx => { ctx.session.action = 'UPDATE_MACHINERY_PRICE';ctx.reply('💰 አዲሱን የማሽነሪ ኪራይ ዋጋ ያስገቡ (በብር):');     ctx.answerCbQuery(); });

// ============================================================
// TEXT HANDLER — State Machine
// ============================================================
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return next();
    const action = ctx.session?.action;
    if (!action) return;

    const userId = ctx.from.id;

    try {
        // ─── CEMENT REGISTRATION ───────────────────────────────
        if (action === 'REG_CEMENT_1') {
            ctx.session.cementData = { type: text };
            ctx.session.action = 'REG_CEMENT_2';
            return ctx.reply('2️⃣ ያለበት ቦታ ያስገቡ (ከተማ / ወረዳ):');
        }
        if (action === 'REG_CEMENT_2') {
            ctx.session.cementData.location = text;
            ctx.session.action = 'REG_CEMENT_3';
            return ctx.reply('3️⃣ የድርጅቱ ስም ያስገቡ:');
        }
        if (action === 'REG_CEMENT_3') {
            ctx.session.cementData.companyName = text;
            ctx.session.action = 'REG_CEMENT_4';
            return ctx.reply('4️⃣ ስልክ ቁጥር ያስገቡ:');
        }
        if (action === 'REG_CEMENT_4') {
            ctx.session.cementData.phone = text;
            ctx.session.action = 'REG_CEMENT_5';
            return ctx.reply('5️⃣ የሲሚንቶ መሸጫ ዋጋ per ኩንታል ያስገቡ (ቁጥር ብቻ፣ ለምሳሌ: 650):');
        }
        if (action === 'REG_CEMENT_5') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ (ለምሳሌ: 650):');
            const data = { ...ctx.session.cementData, userId, price, status: 'active' };
            await CementSeller.create(data);
            ctx.session.action = null;
            ctx.session.cementData = {};
            return ctx.reply(
                `🎉 *ሲሚንቶ ምዝገባ ተሳክቷል!*\n\n` +
                `🧱 አይነት: ${data.type}\n📍 ቦታ: ${data.location}\n🏭 ድርጅት: ${data.companyName}\n📞 ስልክ: ${data.phone}\n💰 ዋጋ: ${price.toLocaleString()} ብር/ኩንታል`,
                { parse_mode: 'Markdown', ...cementSellerInline }
            );
        }
        if (action === 'UPDATE_CEMENT_PRICE') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            await CementSeller.findOneAndUpdate({ userId }, { price });
            ctx.session.action = null;
            return ctx.reply(`✅ ዋጋ ወደ *${price.toLocaleString()} ብር/ኩንታል* ተሻሽሏል!`, { parse_mode: 'Markdown' });
        }

        // ─── BUY CEMENT ─────────────────────────────────────────
        if (action === 'BUY_CEMENT_1') {
            ctx.session.buyCement = { type: text };
            ctx.session.action = 'BUY_CEMENT_2';
            return ctx.reply('2️⃣ ሲሚንቶ ለመግዛት የሚፈልጉበት ቦታ ያስገቡ:');
        }
        if (action === 'BUY_CEMENT_2') {
            ctx.session.buyCement.location = text;
            ctx.session.action = 'BUY_CEMENT_3';
            return ctx.reply('3️⃣ የስልክ ቁጥርዎን ያስገቡ:');
        }
        if (action === 'BUY_CEMENT_3') {
            ctx.session.buyCement.phone = text;
            const { type, location } = ctx.session.buyCement;
            await logSearch(ctx, 'ሲሚንቶ ፈላጊ', `አይነት: ${type} | ቦታ: ${location}`, text);

            const results = await CementSeller.find({
                type: searchRx(type),
                location: searchRx(location),
                status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (results.length) {
                let msg = `🎉 *${results.length} ሻጭ ተገኝቷል!*\n\n`;
                results.forEach((r, i) => {
                    msg += `${i+1}. 🏭 ${r.companyName}\n   🧱 ${r.type} | 📍 ${r.location}\n   💰 *${r.price?.toLocaleString()} ብር/ኩንታል*\n   📞 ${r.phone}\n────────────\n`;
                });
                msg += `\nለማዘዝ በ ${SUPPORT_PHONE} ይደውሉ።`;
                ctx.reply(msg, { parse_mode: 'Markdown' });
            } else {
                ctx.reply(
                    `😔 ይቅርታ! የፈለጉት ሲሚንቶ ለጊዜው አይገኝም።\n\nሲኖር እናሳውቀዎታለን።\nለተጨማሪ: 📞 ${SUPPORT_PHONE}`
                );
            }
            ctx.session.action = null;
            ctx.session.buyCement = {};
            return;
        }

        // ─── TRUCK REGISTRATION ──────────────────────────────────
        if (action === 'REG_TRUCK_1') {
            ctx.session.truckData = { type: text };
            ctx.session.action = 'REG_TRUCK_2';
            return ctx.reply('2️⃣ የተሽከርካሪውን ታርጋ ቁጥር ያስገቡ:');
        }
        if (action === 'REG_TRUCK_2') {
            ctx.session.truckData.plate = text.toUpperCase();
            ctx.session.action = 'REG_TRUCK_3';
            return ctx.reply('3️⃣ የጉዞ መስመር ያስገቡ (ለምሳሌ: ከአዲስ አበባ ወደ ሀዋሳ):');
        }
        if (action === 'REG_TRUCK_3') {
            ctx.session.truckData.route = text;
            ctx.session.action = 'REG_TRUCK_4';
            return ctx.reply('4️⃣ ስልክ ቁጥር ያስገቡ:');
        }
        if (action === 'REG_TRUCK_4') {
            ctx.session.truckData.phone = text;
            const data = { ...ctx.session.truckData, userId, status: 'active' };
            await TruckLeasor.create(data);
            ctx.session.action = null;
            ctx.session.truckData = {};
            return ctx.reply(
                `🎉 *መኪና ምዝገባ ተሳክቷል!*\n\n🚚 ${data.type} | ታርጋ: ${data.plate}\n🛣️ ${data.route}\n📞 ${data.phone}`,
                { parse_mode: 'Markdown' }
            );
        }
        if (action === 'UPDATE_TRUCK_ROUTE') {
            await TruckLeasor.findByIdAndUpdate(ctx.session.targetTruckId, { route: text });
            ctx.session.action = null;
            ctx.session.targetTruckId = null;
            return ctx.reply(`✅ የጉዞ መስመር ወደ "*${text}*" ተሻሽሏል!`, { parse_mode: 'Markdown' });
        }

        // ─── RENT TRUCK ──────────────────────────────────────────
        if (action === 'RENT_TRUCK_1') {
            ctx.session.rentTruck = { type: text };
            ctx.session.action = 'RENT_TRUCK_2';
            return ctx.reply('2️⃣ ጉዞ ከየት ወደ የት ነው?');
        }
        if (action === 'RENT_TRUCK_2') {
            ctx.session.rentTruck.route = text;
            ctx.session.action = 'RENT_TRUCK_3';
            return ctx.reply('3️⃣ ስልክ ቁጥርዎን ያስገቡ:');
        }
        if (action === 'RENT_TRUCK_3') {
            ctx.session.rentTruck.phone = text;
            const { type, route } = ctx.session.rentTruck;
            await logSearch(ctx, 'መኪና ፈላጊ', `አይነት: ${type} | መስመር: ${route}`, text);

            const found = await TruckLeasor.findOne({
                type: searchRx(type),
                route: searchRx(route),
                status: 'active'
            }).sort({ rentedCount: 1 });

            if (found) {
                ctx.reply(
                    `✅ *መኪና ተገኝቷል!*\n\n🚚 ${found.type}\n🚗 ታርጋ: ${found.plate}\n🛣️ ${found.route}\n\n📞 ${SUPPORT_PHONE} ይደውሉ`,
                    { parse_mode: 'Markdown' }
                );
                TruckLeasor.findByIdAndUpdate(found._id, { $inc: { rentedCount: 1 } }).catch(() => {});
            } else {
                ctx.reply(`😔 ይቅርታ! የጠየቁት መኪና ለጊዜው አይገኝም።\n\n📞 ${SUPPORT_PHONE}`);
            }
            ctx.session.action = null;
            ctx.session.rentTruck = {};
            return;
        }

        // ─── STEEL REGISTRATION ──────────────────────────────────
        if (action === 'REG_STEEL_1') {
            ctx.session.steelData = { type: text };
            ctx.session.action = 'REG_STEEL_2';
            return ctx.reply('2️⃣ አድራሻ ያስገቡ:');
        }
        if (action === 'REG_STEEL_2') {
            ctx.session.steelData.address = text;
            ctx.session.action = 'REG_STEEL_3';
            return ctx.reply('3️⃣ ስልክ ቁጥር ያስገቡ:');
        }
        if (action === 'REG_STEEL_3') {
            ctx.session.steelData.phone = text;
            ctx.session.action = 'REG_STEEL_4';
            return ctx.reply('4️⃣ የብረት መሸጫ ዋጋ ያስገቡ (በብር):');
        }
        if (action === 'REG_STEEL_4') {
            ctx.session.steelData.price = text;
            const data = { ...ctx.session.steelData, userId, status: 'active' };
            await SteelSeller.create(data);
            ctx.session.action = null;
            ctx.session.steelData = {};
            return ctx.reply(`🎉 *ብረት ምዝገባ ተሳክቷል!*\n\n🟥 ${data.type} | 📍 ${data.address}\n📞 ${data.phone} | 💰 ${data.price} ብር`,
                { parse_mode: 'Markdown', ...steelSellerInline });
        }
        if (action === 'UPDATE_STEEL_PRICE') {
            await SteelSeller.findOneAndUpdate({ userId }, { price: text });
            ctx.session.action = null;
            return ctx.reply(`✅ ዋጋ ወደ *${text} ብር* ተሻሽሏል!`, { parse_mode: 'Markdown' });
        }

        // ─── BUY STEEL ───────────────────────────────────────────
        if (action === 'BUY_STEEL_1') {
            ctx.session.buySteel = { type: text };
            ctx.session.action = 'BUY_STEEL_2';
            return ctx.reply('2️⃣ ብረት ለመግዛት የሚፈልጉበት ቦታ ያስገቡ:');
        }
        if (action === 'BUY_STEEL_2') {
            ctx.session.buySteel.location = text;
            ctx.session.action = 'BUY_STEEL_3';
            return ctx.reply('3️⃣ ስልክ ቁጥርዎን ያስገቡ:');
        }
        if (action === 'BUY_STEEL_3') {
            ctx.session.buySteel.phone = text;
            const { type } = ctx.session.buySteel;
            await logSearch(ctx, 'ብረት ፈላጊ', `አይነት: ${type}`, text);

            const results = await SteelSeller.find({ type: searchRx(type), status: 'active' }).limit(5).lean();
            if (results.length) {
                let msg = `🎉 *${results.length} ሻጭ ተገኝቷል!*\n\n`;
                results.forEach((r, i) => {
                    msg += `${i+1}. 🟥 ${r.type}\n   📍 ${r.address} | 📞 ${r.phone}\n   💰 ${r.price} ብር\n────────────\n`;
                });
                msg += `\n📞 ${SUPPORT_PHONE}`;
                ctx.reply(msg, { parse_mode: 'Markdown' });
            } else {
                ctx.reply(`😔 ይቅርታ! የጠየቁት ብረት ለዛሬ የለም።\n\n📞 ${SUPPORT_PHONE}`);
            }
            ctx.session.action = null;
            ctx.session.buySteel = {};
            return;
        }

        // ─── MACHINERY REGISTRATION ──────────────────────────────
        if (action === 'REG_MACHINERY_1') {
            ctx.session.machineryData = { type: text };
            ctx.session.action = 'REG_MACHINERY_2';
            return ctx.reply('2️⃣ አድራሻ ያስገቡ:');
        }
        if (action === 'REG_MACHINERY_2') {
            ctx.session.machineryData.address = text;
            ctx.session.action = 'REG_MACHINERY_3';
            return ctx.reply('3️⃣ ስልክ ቁጥር ያስገቡ:');
        }
        if (action === 'REG_MACHINERY_3') {
            ctx.session.machineryData.phone = text;
            ctx.session.action = 'REG_MACHINERY_4';
            return ctx.reply('4️⃣ የማሽነሪ ኪራይ ዋጋ ያስገቡ (በብር):');
        }
        if (action === 'REG_MACHINERY_4') {
            ctx.session.machineryData.price = text;
            const data = { ...ctx.session.machineryData, userId, status: 'active' };
            await MachineryLeasor.create(data);
            ctx.session.action = null;
            ctx.session.machineryData = {};
            return ctx.reply(`🎉 *ማሽነሪ ምዝገባ ተሳክቷል!*\n\n🔹 ${data.type} | 📍 ${data.address}\n📞 ${data.phone} | 💰 ${data.price} ብር`,
                { parse_mode: 'Markdown', ...machineryLeasorInline });
        }
        if (action === 'UPDATE_MACHINERY_PRICE') {
            await MachineryLeasor.findOneAndUpdate({ userId }, { price: text });
            ctx.session.action = null;
            return ctx.reply(`✅ ዋጋ ወደ *${text} ብር* ተሻሽሏል!`, { parse_mode: 'Markdown' });
        }

        // ─── RENT MACHINERY ──────────────────────────────────────
        if (action === 'RENT_MACHINERY_1') {
            ctx.session.rentMachinery = { type: text };
            ctx.session.action = 'RENT_MACHINERY_2';
            return ctx.reply('2️⃣ ማሽነሪ የሚፈልጉበት ቦታ ያስገቡ:');
        }
        if (action === 'RENT_MACHINERY_2') {
            ctx.session.rentMachinery.location = text;
            ctx.session.action = 'RENT_MACHINERY_3';
            return ctx.reply('3️⃣ ስልክ ቁጥርዎን ያስገቡ:');
        }
        if (action === 'RENT_MACHINERY_3') {
            ctx.session.rentMachinery.phone = text;
            const { type } = ctx.session.rentMachinery;
            await logSearch(ctx, 'ማሽነሪ ፈላጊ', `አይነት: ${type}`, text);

            const results = await MachineryLeasor.find({ type: searchRx(type), status: 'active' }).limit(5).lean();
            if (results.length) {
                let msg = `🎉 *${results.length} ማሽነሪ ተገኝቷል!*\n\n`;
                results.forEach((r, i) => {
                    msg += `${i+1}. 🔹 ${r.type}\n   📍 ${r.address} | 📞 ${r.phone}\n   💰 ${r.price} ብር\n────────────\n`;
                });
                msg += `\n📞 ${SUPPORT_PHONE}`;
                ctx.reply(msg, { parse_mode: 'Markdown' });
            } else {
                ctx.reply(`😔 ይቅርታ! የጠየቁት ማሽነሪ ለዛሬ የለም።\n\n📞 ${SUPPORT_PHONE}`);
            }
            ctx.session.action = null;
            ctx.session.rentMachinery = {};
            return;
        }

    } catch (err) {
        console.error('Handler Error:', err);
        ctx.reply('⚠️ ስህተት አጋጥሟል። እባክዎ እንደገና ይሞክሩ።');
    }
});

// ============================================================
// GLOBAL ERROR HANDLING
// ============================================================
bot.catch((err, ctx) => {
    console.error(`Bot Error for ${ctx?.updateType}:`, err);
    ctx?.reply?.('⚠️ ያልተጠበቀ ስህተት አጋጥሟል።').catch(() => {});
});

process.on('uncaughtException',  err => console.error('UNCAUGHT EXCEPTION:',  err));
process.on('unhandledRejection', err => console.error('UNHANDLED REJECTION:', err));

// ============================================================
// HTTP SERVER  (Render keeps the dyno alive)
// ============================================================
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('✅ Bot is running — Simple Marketplace Bot');
});
server.listen(PORT, '0.0.0.0', () => console.log(`🌐 HTTP server on port ${PORT}`));

// ============================================================
// KEEP-ALIVE — Render ሃያ ደቂቃ ካለ እንቅስቃሴ ካሳለፈ ያጠፋዋል
// ይህ ping ቦቱን 24/7 ያስቀምጣል
// ============================================================
if (RENDER_URL) {
    const pingUrl = new URL('/ping', RENDER_URL.startsWith('http') ? RENDER_URL : `https://${RENDER_URL}`);
    setInterval(() => {
        http.get(pingUrl.toString(), res => {
            console.log(`⏱️  Keep-alive ping → ${res.statusCode}`);
        }).on('error', err => console.warn('Keep-alive error:', err.message));
    }, 14 * 60 * 1000); // ፲፬ ደቂቃ ወደ ወደ
    console.log(`🔄 Keep-alive enabled → ${pingUrl}`);
} else {
    console.warn('⚠️  RENDER_EXTERNAL_URL not set — keep-alive disabled');
}

// ============================================================
// BOT LAUNCH
// ============================================================
bot.launch({
    allowedUpdates: ['message', 'callback_query'],
    dropPendingUpdates: true
}).then(() => console.log('🤖 Bot launched!'))
  .catch(err => {
      console.error('Launch failed:', err);
      process.exit(1);
  });

// Graceful stop
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
