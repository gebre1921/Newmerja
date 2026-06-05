const { Telegraf, Markup } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose');

// --- 🛠️ የቶክን እና ዳታቤዝ ማዋቀር ---
const BOT_TOKEN = process.env.BOT_TOKEN ? process.env.BOT_TOKEN.trim().replace(/['"]/g, '') : undefined;
const MONGO_URI = process.env.MONGO_URI;

if (!BOT_TOKEN || !MONGO_URI) {
    console.error("ስህተት: BOT_TOKEN ወይም MONGO_URI በ Environment Variables ላይ አልተገኘም!");
    process.exit(1);
}

// --- 🗄️ ከማንጎ ዲቢ (MongoDB) ጋር ማገናኛ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ ዳታቤዝ ተገናኝቷል!"))
    .catch(err => console.error("❌ የዳታቤዝ ግንኙነት ስህተት:", err));

// --- 📊 የዳታቤዝ ሞዴሎች መፍጠሪያ (ክሪቲካል) ---
const cementSchema = new mongoose.Schema({ userId: Number, type: String, location: String, companyName: String, phone: String, price: Number, status: String });
const steelSchema = new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String });
const machinerySchema = new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String });
const truckSchema = new mongoose.Schema({ userId: Number, type: String, plate: String, route: String, phone: String, status: String, rentedCount: { type: Number, default: 0 } });
const sessionSchema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, data: { type: Object, default: {} } });

const CementSeller = mongoose.models.CementSeller || mongoose.model('CementSeller', cementSchema);
const SteelSeller = mongoose.models.SteelSeller || mongoose.model('SteelSeller', steelSchema);
const MachineryLeasor = mongoose.models.MachineryLeasor || mongoose.model('MachineryLeasor', machinerySchema);
const TruckLeasor = mongoose.models.TruckLeasor || mongoose.model('TruckLeasor', truckSchema);
const BotSession = mongoose.models.BotSession || mongoose.model('BotSession', sessionSchema);

const bot = new Telegraf(BOT_TOKEN);

// --- 🔄 የሴሽን Middleware (ክሪቲካል ለስህተት ማረም) ---
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const sessionKey = `${ctx.from.id}:${ctx.from.id}`;
    let sessionDoc = await BotSession.findOne({ key: sessionKey });
    if (!sessionDoc) sessionDoc = await BotSession.create({ key: sessionKey, data: {} });
    ctx.session = sessionDoc.data || {};
    await next();
    await BotSession.updateOne({ key: sessionKey }, { $set: { data: ctx.session } });
});

// --- ⌨️ ዋና ሜኑ ---
const mainKeyboard = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

bot.start((ctx) => {
    ctx.session = {}; 
    ctx.reply('እንኳን ወደ Simple ቦት በሰላም መጡ! እባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ።', mainKeyboard);
});

// --- 👑 የአድሚን ፓናል ---
bot.command('admin_panel', async (ctx) => {
    if (ctx.from.id !== 7423347375) return ctx.reply('ፈቃድ የለዎትም!');
    
    ctx.session = ctx.session || {};
    ctx.session.action = null;
    
    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('🧱 ሲሚንቶ አጥፋ', 'adm_manage_cement')],
        [Markup.button.callback('🚚 መኪና አጥፋ', 'adm_manage_truck')],
        [Markup.button.callback('🟥 ብረት አጥፋ', 'adm_manage_steel')]
    ]);
    ctx.reply('👑 እንኳን ወደ አድሚን ማጥፊያ ፓናል በሰላም መጡ። ማስተዳደር የሚፈልጉትን ዘርፍ ይምረጡ፦', adminMenu);
});

// --- 🧱 ሲሚንቶ ክፍል ---
const cementSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'cement_active'), Markup.button.callback('❌ የለም', 'cement_off')],
    [Markup.button.callback('➕ አዲስ ለመመዝገብ', 'cement_re_reg'), Markup.button.callback('💰 ዋጋ ለማሻሻል', 'cement_update_price')]
]);

bot.hears('🧱 ሲሚንቶ ለመሸጥ', async (ctx) => {
    ctx.session.action = null; 
    const existing = await CementSeller.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`አንተ ቀድሞውኑ የተመዘገብክ ቋሚ ደንበኛ ነህ። ሁኔታህ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}`, cementSellerInline);
    } else {
        ctx.session.action = 'REG_CEMENT_1';
        ctx.reply('የሲሚንቶ አይነት ያስገቡ፡');
    }
});

bot.hears('🧱 ሲሚንቶ ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_CEMENT_1';
    ctx.reply('1. ምን አይነት ሲሚንቶ ነው የሚፈልጉት?');
});

// --- 🚚 መኪና ክፍል ---
bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    ctx.session.action = null;
    const myTrucks = await TruckLeasor.find({ userId: ctx.from.id });
    if (myTrucks.length > 0) {
        let buttons = [];
        myTrucks.forEach(t => {
            const currentStatus = t.status === 'active' ? '🟢 ዝግጁ' : '🔴 ስራ ላይ';
            buttons.push([Markup.button.callback(`🇪🇹 ታርጋ፦ ${t.plate} | ${t.type} [${currentStatus}]`, 'none')]);
            buttons.push([Markup.button.callback('✅ ዝግጁ አድርግ', `tr_act_${t._id}`), Markup.button.callback('❌ ስራ ላይ አድርግ', `tr_off_${t._id}`)]);
            buttons.push([Markup.button.callback('📍 የጉዞ መስመር ለመቀየር', `tr_route_${t._id}`)]);
            buttons.push([Markup.button.callback('━━━━━━━━━━━━━━━━━━━━', 'none')]);
        });
        buttons.push([Markup.button.callback('➕ አዲስ መኪና ለመመዝገብ', 'truck_new_reg')]);
        ctx.reply('📋 የእርስዎ የተመዘገቡ መኪናዎች አስተዳደሪያ ፓናል፦', Markup.inlineKeyboard(buttons));
    } else {
        ctx.session.action = 'REG_TRUCK_1';
        ctx.session.truckData = {};
        ctx.reply('ለመመዝገብ የመኪናውን አይነት ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
    }
});

bot.hears('🚚 መኪና ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.reply('1. ምን አይነት መኪና ይፈልጋሉ?');
});

// --- 🟥 ብረት ክፍል ---
const steelSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'steel_active'), Markup.button.callback('❌ የለም', 'steel_off')],
    [Markup.button.callback('💰 ዋጋ ለማሻሻል', 'steel_update_price')]
]);

bot.hears('🟥 ብረት ለመሸጥ', async (ctx) => {
    ctx.session.action = null;
    const existing = await SteelSeller.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገቡ የብረት ሻጭ ነዎት። ሁኔታ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}`, steelSellerInline);
    } else {
        ctx.session.action = 'REG_STEEL_1';
        ctx.reply('1. የብረት አይነቶችን ያስገቡ፡');
    }
});

bot.hears('🟥 ብረት ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_STEEL_1';
    ctx.reply('1. ምን አይነት ብረት ይፈልጋሉ?');
});

// --- 🔹 ማሽነሪ ክፍል ---
const machineryLeasorInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'machinery_active'), Markup.button.callback('❌ የለም', 'machinery_off')]
]);

bot.hears('🔹 ማሽነሪ ለማከራየት', async (ctx) => {
    ctx.session.action = null;
    const existing = await MachineryLeasor.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገበ ማሽነሪ አለዎት። ሁኔታ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}`, machineryLeasorInline);
    } else {
        ctx.session.action = 'REG_MACHINERY_1';
        ctx.reply('1. የማሽነሪው አይነት ያስገቡ፡');
    }
});

bot.hears('🔹 ማሽነሪ ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_MACHINERY_1';
    ctx.reply('1. የሚፈልጉት የማሽነሪ አይነት ያስገቡ፡');
});

function createSearchRegex(input) {
    if (!input) return new RegExp('', 'i');
    let clean = input.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(clean.split('').map(char => `${char}*`).join('.*'), 'i');
}

// --- 💬 የፅሁፍ መልዕክቶች ማቀናበሪያ ---
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return next();
    const action = ctx.session.action;
    const userId = ctx.from.id;
    if (!action) return;

    // (እዚህ የሲሚንቶ፣ መኪና፣ ብረት እና ማሽነሪ የምዝገባ logic ቀጥሏል)
    // ለጊዜው አጭር ስሪቱን አስገብቻለሁ፣ ከዚህ በፊት የነበሩትን logice እንዳሉ አስቀምጥ
    if (action === 'REG_CEMENT_1') {
        ctx.session.cementData = { type: text };
        ctx.session.action = 'REG_CEMENT_2';
        ctx.reply('2. ያለበት ቦታ ያስገቡ፡');
    }
    // ... የተቀሩት logic-ዎች ከዚህ በፊት በላኩልህ መሰረት ይከተላሉ
    // ...
});

// --- 🔘 የውስጥ በተኖች አሠራር ---
bot.action('adm_manage_cement', async (ctx) => {
    const sellers = await CementSeller.find({});
    if (sellers.length === 0) return ctx.reply('🧱 ምንም የተመዘገበ የለም።');
    const buttons = sellers.map(s => [Markup.button.callback(`🧱 ${s.companyName || 'ሲሚንቶ'}`, 'none'), Markup.button.callback('❌ ሰርዝ', `del_cem_${s._id}`)]);
    ctx.reply('ለማጥፋት ❌ ሰርዝ የሚለውን ይጫኑ፦', Markup.inlineKeyboard(buttons));
    ctx.answerCbQuery();
});

// (የቀሩት bot.action-ዎች ሁሉ እዚህ መጨረሻ ላይ ይለጠፋሉ)

// --- 🌐 የዌብ ሰርቨር ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Bot is Running!'); }).listen(PORT);

bot.launch().then(() => console.log('✅ ቦቱ በተሳካ ሁኔታ ተነስቷል!'));
