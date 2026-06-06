const { Telegraf, Markup } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose');

// --- 🛠️ የኮንፊግሬሽን ክፍል ---
const rawToken = process.env.BOT_TOKEN;
const BOT_TOKEN = rawToken ? rawToken.trim().replace(/['"]/g, '') : undefined;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || "0960336138";

if (!BOT_TOKEN || !MONGO_URI) {
    console.error("ስህተት: BOT_TOKEN ወይም MONGO_URI አልተገኘም!");
    process.exit(1);
}

// --- 📊 የዳታቤዝ ሰንጠረዦች መዋቅር (Schemas) ---
const CementSeller = mongoose.model('CementSeller', new mongoose.Schema({ userId: Number, type: String, location: String, companyName: String, phone: String, price: Number, status: String }));
const SteelSeller = mongoose.model('SteelSeller', new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String }));
const MachineryLeasor = mongoose.model('MachineryLeasor', new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String }));

const TruckLeasor = mongoose.model('TruckLeasor', new mongoose.Schema({ 
    userId: Number, 
    type: String, 
    plate: String, 
    route: String, 
    phone: String, 
    status: String,
    rentedCount: { type: Number, default: 0 } 
}));

const SearchLog = mongoose.model('SearchLog', new mongoose.Schema({
    userId: Number,
    username: String,
    category: String, 
    searchedFor: String, 
    phone: String,
    createdAt: { type: Date, default: Date.now }
}));

const ActiveLog = mongoose.model('ActiveLog', new mongoose.Schema({
    userId: Number,
    name: String,
    category: String, 
    detail: String, 
    dateStr: String, 
    createdAt: { type: Date, default: Date.now }
}));

const BotSession = mongoose.model('BotSession', new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    data: { type: Object, default: {} }
}));

// --- 🗄️ Optimized MongoDB Connection ---
mongoose.connect(MONGO_URI, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
})
.then(async () => {
    console.log("✅ MongoDB Connected");
    await TruckLeasor.collection.createIndex({ type: 1, route: 1, status: 1 });
    await CementSeller.collection.createIndex({ type: 1, status: 1 });
    await SteelSeller.collection.createIndex({ type: 1, status: 1 });
    await MachineryLeasor.collection.createIndex({ type: 1, status: 1 });
    console.log("✅ Indexes Ready");
})
.catch(err => console.error(err));

// --- 🤖 Bot Initialization ---
const bot = new Telegraf(BOT_TOKEN);

// --- 🚀 Session Middleware ---
const sessionCache = new Map();
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const sessionKey = String(ctx.from.id);
    try {
        if (sessionCache.has(sessionKey)) {
            ctx.session = sessionCache.get(sessionKey);
        } else {
            const sessionDoc = await BotSession.findOne({ key: sessionKey }).lean();
            ctx.session = sessionDoc?.data || {};
            sessionCache.set(sessionKey, ctx.session);
        }
        await next();
        sessionCache.set(sessionKey, ctx.session);
        BotSession.updateOne({ key: sessionKey }, { $set: { data: ctx.session } }, { upsert: true }).catch(console.error);
    } catch (err) {
        ctx.session = {};
        await next();
    }
});

// --- 🛠️ Helper Functions ---
function getTodayDateString() {
    const d = new Date();
    d.setHours(d.getHours() + 3); 
    return d.toISOString().split('T');
}

function createSearchRegex(input) {
    if (!input) return new RegExp('', 'i');
    let clean = input.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (/[a-zA-Z]/.test(clean)) {
        const fuzzyPattern = clean.split('').map(char => `${char}*`).join('.*');
        return new RegExp(fuzzyPattern, 'i');
    } else {
        return new RegExp(clean, 'i');
    }
}

// --- ⌨️ ዋና ሜኑ ---
const mainKeyboard = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

bot.start((ctx) => {
    ctx.session = {}; 
    ctx.reply('እንኳን ወደ Simple ቦት በሰላም መጡ!', mainKeyboard);
});

// --- 👑 የአድሚን ፓናል ---
bot.command('admin_panel', async (ctx) => {
    if (ctx.from.id !== 7423347375) return ctx.reply('ፈቃድ የለዎትም!');
    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('🧱 ሲሚንቶ ሪፖርት', 'rep_cement'), Markup.button.callback('🚚 መኪና ሪፖርት', 'rep_truck')],
        [Markup.button.callback('🟥 ብረት ሪፖርት', 'rep_steel'), Markup.button.callback('🔹 ማሽነሪ ሪፖርት', 'rep_machinery')],
        [Markup.button.callback('❌ ማጥፊያ ፓናል', 'admin_delete_menu')]
    ]);
    ctx.reply('👑 እንኳን ወደ አድሚን ፓናል በሰላም መጡ።', adminMenu);
});

// --- 🗑️ የአድሚን ማጥፊያ ተግባራት (Fixes) ---
bot.action('admin_delete_menu', (ctx) => {
    const delMenu = Markup.inlineKeyboard([
        [Markup.button.callback('🗑️ ሲሚንቶ አጥፋ', 'adm_manage_cement')],
        [Markup.button.callback('🗑️ መኪና አጥፋ', 'adm_manage_truck')],
        [Markup.button.callback('🗑️ ብረት አጥፋ', 'adm_manage_steel')],
        [Markup.button.callback('🗑️ ማሽነሪ አጥፋ', 'adm_manage_machinery')]
    ]);
    ctx.reply('ማጥፋት የሚፈልጉትን ይምረጡ:', delMenu);
    ctx.answerCbQuery();
});

bot.action('adm_manage_cement', async (ctx) => { await CementSeller.deleteMany({}); ctx.reply('✅ ሲሚንቶ ተሰርዟል'); ctx.answerCbQuery(); });
bot.action('adm_manage_truck', async (ctx) => { await TruckLeasor.deleteMany({}); ctx.reply('✅ መኪናዎች ተሰርዘዋል'); ctx.answerCbQuery(); });
bot.action('adm_manage_steel', async (ctx) => { await SteelSeller.deleteMany({}); ctx.reply('✅ ብረት ተሰርዟል'); ctx.answerCbQuery(); });
bot.action('adm_manage_machinery', async (ctx) => { await MachineryLeasor.deleteMany({}); ctx.reply('✅ ማሽነሪ ተሰርዟል'); ctx.answerCbQuery(); });

// --- 🚚 የመኪና በተን ማስተካከያ (Fixes) ---
bot.action(/tr_act_(.+)/, async (ctx) => {
    await TruckLeasor.findByIdAndUpdate(ctx.match, { status: 'active' });
    ctx.answerCbQuery('✅ ዝግጁ ሆኗል');
});
bot.action(/tr_off_(.+)/, async (ctx) => {
    await TruckLeasor.findByIdAndUpdate(ctx.match, { status: 'inactive' });
    ctx.answerCbQuery('🔴 ስራ ላይ ሆኗል');
});
bot.action(/tr_route_(.+)/, async (ctx) => {
    ctx.session.action = 'UPDATE_TRUCK_ROUTE';
    ctx.session.truckIdToUpdate = ctx.match;
    ctx.reply('እባክዎ አዲሱን መስመር ያስገቡ፦');
    ctx.answerCbQuery();
});

// --- 💬 የፅሁፍ መልዕክቶች ማቀናበሪያ ---
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return next();
    const action = ctx.session.action;
    const userId = ctx.from.id;
    if (!action) return;

    try {
        // --- 🚚 ROUTE UPDATE FIX ---
        if (action === 'UPDATE_TRUCK_ROUTE') {
            await TruckLeasor.findByIdAndUpdate(ctx.session.truckIdToUpdate, { route: text });
            ctx.reply('✅ የመኪናው መስመር ተቀይሯል!');
            ctx.session.action = null;
        }
        // ... (ሌሎች action-ዎች እንዳሉ ይቆያሉ)
        else if (action === 'REG_CEMENT_4') {
             ctx.session.cementData.phone = text;
             ctx.session.cementData.userId = userId;
             ctx.session.cementData.price = 1300; 
             ctx.session.cementData.status = 'active';
             await CementSeller.findOneAndUpdate({ userId }, ctx.session.cementData, { upsert: true });
             ctx.session.action = null;
             ctx.reply('መረጃዎ ተመዝግቧል!');
        }
        // (ቀሪው የድሮው ኮድዎ እዚህ ይቀጥላል...)
    } catch (error) { console.error(error); }
});

// --- 🌐 Server ---
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => res.end("Bot is running!")).listen(PORT, '0.0.0.0');
bot.launch().then(() => console.log('🤖 ቦቱ ስራ ጀምሯል!'));
