const { Telegraf, Markup } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose');

// --- Config ---
const rawToken = process.env.BOT_TOKEN;
const BOT_TOKEN = rawToken ? rawToken.trim().replace(/['"]/g, '') : undefined;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || "0960336138";

if (!BOT_TOKEN || !MONGO_URI) {
    console.error("ስህተት: BOT_TOKEN ወይም MONGO_URI በ Render Environment Variables ላይ አልተገኘም!");
    process.exit(1);
}

// --- Schemas ---
const CementSeller = mongoose.model('CementSeller', new mongoose.Schema({
    userId: Number, type: String, location: String,
    companyName: String, phone: String, price: Number, status: String
}));
const SteelSeller = mongoose.model('SteelSeller', new mongoose.Schema({
    userId: Number, type: String, address: String, phone: String, price: String, status: String
}));
const MachineryLeasor = mongoose.model('MachineryLeasor', new mongoose.Schema({
    userId: Number, type: String, address: String, phone: String, price: String, status: String
}));
const TruckLeasor = mongoose.model('TruckLeasor', new mongoose.Schema({
    userId: Number, type: String, plate: String, route: String,
    phone: String, status: String, rentedCount: { type: Number, default: 0 }
}));
const SearchLog = mongoose.model('SearchLog', new mongoose.Schema({
    userId: Number, username: String, category: String,
    searchedFor: String, phone: String, createdAt: { type: Date, default: Date.now }
}));
const ActiveLog = mongoose.model('ActiveLog', new mongoose.Schema({
    userId: Number, name: String, category: String,
    detail: String, dateStr: String, createdAt: { type: Date, default: Date.now }
}));
const BotSession = mongoose.model('BotSession', new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    data: { type: Object, default: {} }
}));

// --- MongoDB Connection ---
mongoose.connect(MONGO_URI, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
})
.then(async () => {
    console.log("MongoDB Connected");
    await TruckLeasor.collection.createIndex({ type: 1, route: 1, status: 1 });
    await CementSeller.collection.createIndex({ type: 1, location: 1, status: 1 });
    await SteelSeller.collection.createIndex({ type: 1, status: 1 });
    await MachineryLeasor.collection.createIndex({ type: 1, status: 1 });
    console.log("Indexes Ready");
})
.catch(err => console.error(err));

mongoose.connection.on("disconnected", () => console.log("MongoDB Disconnected"));
mongoose.connection.on("reconnected", () => console.log("MongoDB Reconnected"));
mongoose.connection.on("error", err => console.error("Mongo Error:", err));

// --- Bot ---
const bot = new Telegraf(BOT_TOKEN);

// --- Session Middleware ---
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
        BotSession.updateOne(
            { key: sessionKey },
            { $set: { data: ctx.session } },
            { upsert: true }
        ).catch(console.error);
    } catch (err) {
        console.error("Session Error:", err);
        ctx.session = {};
        await next();
    }
});

// --- Helpers ---
function getTodayDateString() {
    const d = new Date();
    d.setHours(d.getHours() + 3);
    return d.toISOString().split('T')[0];
}

function createSearchRegex(input) {
    if (!input) return new RegExp('', 'i');
    let clean = input.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (/[a-zA-Z]/.test(clean)) {
        const fuzzyPattern = clean.split('').map(char => `${char}*`).join('.*');
        return new RegExp(fuzzyPattern, 'i');
    }
    return new RegExp(clean, 'i');
}

// --- Main Keyboard ---
const mainKeyboard = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

// --- Inline Keyboards ---
const cementSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('አለ', 'cement_active'), Markup.button.callback('የለም', 'cement_off')],
    [Markup.button.callback('ዋጋ ማሻሻያ', 'cement_update_price')]
]);
const steelSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('አለ', 'steel_active'), Markup.button.callback('የለም', 'steel_off')],
    [Markup.button.callback('ዋጋ ማሻሻያ', 'steel_update_price')]
]);
const machineryLeasorInline = Markup.inlineKeyboard([
    [Markup.button.callback('አለ', 'machinery_active'), Markup.button.callback('የለም', 'machinery_off')]
]);

// --- Start ---
bot.start((ctx) => {
    ctx.session = {};
    ctx.reply('እንኳን ወደ Simple ቦት በሰላም መጡ! እባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ።', mainKeyboard);
});

// --- Admin Panel ---
bot.command('admin_panel', async (ctx) => {
    if (ctx.from.id !== 7423347375) return ctx.reply('ይቅርታ፣ ፈቃድ የለዎትም!');
    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('ሲሚንቶ ሪፖርት', 'rep_cement'), Markup.button.callback('መኪና ሪፖርት', 'rep_truck')],
        [Markup.button.callback('ብረት ሪፖርት', 'rep_steel'), Markup.button.callback('ማሽነሪ ሪፖርት', 'rep_machinery')],
        [Markup.button.callback('የፈላጊዎች ፍላጎት ሪፖርት', 'rep_searches')],
        [Markup.button.callback('የዛሬ Active ተጠቃሚዎች', 'rep_actives')],
        [Markup.button.callback('ማጥፊያ ፓናል', 'admin_delete_menu')]
    ]);
    ctx.reply('እንኳን ወደ አድሚን ፓናል በሰላም መጡ።', adminMenu);
});

// --- Admin Reports ---
bot.action('rep_cement', async (ctx) => {
    const items = await CementSeller.find({}).lean();
    if (items.length === 0) return ctx.reply('ምንም የተመዘገበ የሲሚንቶ ሻጭ የለም።');
    let msg = 'የሲሚንቶ ሻጮች ሪፖርት፦\n\n';
    items.forEach((item, idx) => {
        msg += `${idx + 1}. ድርጅት: ${item.companyName}\n   አይነት: ${item.type}\n   ቦታ: ${item.location}\n   ስልክ: ${item.phone}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? 'አለ' : 'የለም'}\n────────────────\n`;
    });
    ctx.reply(msg);
    ctx.answerCbQuery();
});

bot.action('rep_truck', async (ctx) => {
    const items = await TruckLeasor.find({}).lean();
    if (items.length === 0) return ctx.reply('ምንም የተመዘገበ መኪና የለም።');
    let msg = 'የመኪና አከራዮች ሪፖርት፦\n\n';
    items.forEach((item, idx) => {
        msg += `${idx + 1}. ታርጋ: ${item.plate}\n   አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   መስመር: ${item.route}\n   ሁኔታ: ${item.status === 'active' ? 'ዝግጁ' : 'ስራ ላይ'}\n────────────────\n`;
    });
    ctx.reply(msg);
    ctx.answerCbQuery();
});

bot.action('rep_steel', async (ctx) => {
    const items = await SteelSeller.find({}).lean();
    if (items.length === 0) return ctx.reply('ምንም የተመዘገበ የብረት ሻጭ የለም።');
    let msg = 'የብረት ሻጮች ሪፖርት፦\n\n';
    items.forEach((item, idx) => {
        msg += `${idx + 1}. አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   አድራሻ: ${item.address}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? 'አለ' : 'የለም'}\n────────────────\n`;
    });
    ctx.reply(msg);
    ctx.answerCbQuery();
});

bot.action('rep_machinery', async (ctx) => {
    const items = await MachineryLeasor.find({}).lean();
    if (items.length === 0) return ctx.reply('ምንም የተመዘገበ ማሽነሪ የለም።');
    let msg = 'የማሽነሪ አከራዮች ሪፖርት፦\n\n';
    items.forEach((item, idx) => {
        msg += `${idx + 1}. አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   አድራሻ: ${item.address}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? 'አለ' : 'የለም'}\n────────────────\n`;
    });
    ctx.reply(msg);
    ctx.answerCbQuery();
});

bot.action('rep_searches', async (ctx) => {
    const logs = await SearchLog.find({}).sort({ createdAt: -1 }).limit(30).lean();
    if (logs.length === 0) return ctx.reply('ምንም የፍለጋ ታሪክ የለም።');
    let msg = 'የፈላጊዎች ፍላጎት ሪፖርት፦\n\n';
    logs.forEach((log, idx) => {
        msg += `${idx + 1}. ዘርፍ: ${log.category}\n   የፈለገው: ${log.searchedFor}\n   የፈላጊው ስልክ: ${log.phone}\n────────────────\n`;
    });
    ctx.reply(msg);
    ctx.answerCbQuery();
});

bot.action('rep_actives', async (ctx) => {
    const todayStr = getTodayDateString();
    const logs = await ActiveLog.find({ dateStr: todayStr }).sort({ createdAt: -1 }).lean();
    if (logs.length === 0) return ctx.reply('ዛሬ Active ተጠቃሚዎች የሉም።');
    let msg = `የዛሬ (${todayStr}) Active ተጠቃሚዎች ሪፖርት፦\n\n`;
    logs.forEach((log, idx) => {
        msg += `${idx + 1}. ስም: ${log.name}\n   ዘርፍ: ${log.category}\n────────────────\n`;
    });
    ctx.reply(msg);
    ctx.answerCbQuery();
});

// --- Admin Delete Menu ---
bot.action('admin_delete_menu', (ctx) => {
    const delMenu = Markup.inlineKeyboard([
        [Markup.button.callback('ሲሚንቶ አጥፋ', 'adm_manage_cement')],
        [Markup.button.callback('መኪና አጥፋ', 'adm_manage_truck')],
        [Markup.button.callback('ብረት አጥፋ', 'adm_manage_steel')],
        [Markup.button.callback('ማሽነሪ አጥፋ', 'adm_manage_machinery')]
    ]);
    ctx.reply('ማጥፋት የሚፈልጉትን ዘርፍ ይምረጡ፦', delMenu);
    ctx.answerCbQuery();
});

bot.action('adm_manage_cement', async (ctx) => {
    const items = await CementSeller.find({}).lean();
    if (items.length === 0) return ctx.reply('የሚጠፋ መረጃ የለም።');
    let buttons = items.map(i => [Markup.button.callback(`${i.companyName} (${i.phone})`, `del_cem_${i._id}`)]);
    ctx.reply('የሚያጠፉትን የሲሚንቶ ሻጭ ይምረጡ፦', Markup.inlineKeyboard(buttons));
    ctx.answerCbQuery();
});

bot.action('adm_manage_truck', async (ctx) => {
    const items = await TruckLeasor.find({}).lean();
    if (items.length === 0) return ctx.reply('የሚጠፋ መኪና የለም።');
    let buttons = items.map(i => [Markup.button.callback(`ታርጋ: ${i.plate} (${i.phone})`, `del_trk_${i._id}`)]);
    ctx.reply('የሚያጠፉትን መኪና ይምረጡ፦', Markup.inlineKeyboard(buttons));
    ctx.answerCbQuery();
});

bot.action('adm_manage_steel', async (ctx) => {
    const items = await SteelSeller.find({}).lean();
    if (items.length === 0) return ctx.reply('የሚጠፋ የብረት ሻጭ የለም።');
    let buttons = items.map(i => [Markup.button.callback(`ብረት: ${i.type} (${i.phone})`, `del_stl_${i._id}`)]);
    ctx.reply('የሚያጠፉትን የብረት ሻጭ ይምረጡ፦', Markup.inlineKeyboard(buttons));
    ctx.answerCbQuery();
});

bot.action('adm_manage_machinery', async (ctx) => {
    const items = await MachineryLeasor.find({}).lean();
    if (items.length === 0) return ctx.reply('የሚጠፋ ማሽነሪ የለም።');
    let buttons = items.map(i => [Markup.button.callback(`ማሽነሪ: ${i.type} (${i.phone})`, `del_mac_${i._id}`)]);
    ctx.reply('የሚያጠፉትን ማሽነሪ ይምረጡ፦', Markup.inlineKeyboard(buttons));
    ctx.answerCbQuery();
});

// --- Delete Actions ---
bot.action(/^del_cem_([a-zA-Z0-9]+)$/, async (ctx) => {
    await CementSeller.findByIdAndDelete(ctx.match[1]);
    ctx.reply('መረጃው ከዳታቤዝ ተሰርዟል።');
    ctx.answerCbQuery();
});
bot.action(/^del_trk_([a-zA-Z0-9]+)$/, async (ctx) => {
    await TruckLeasor.findByIdAndDelete(ctx.match[1]);
    ctx.reply('የመኪናው መረጃ ከዳታቤዝ ተሰርዟል።');
    ctx.answerCbQuery();
});
bot.action(/^del_stl_([a-zA-Z0-9]+)$/, async (ctx) => {
    await SteelSeller.findByIdAndDelete(ctx.match[1]);
    ctx.reply('የብረት ሻጭ መረጃው ከዳታቤዝ ተሰርዟል።');
    ctx.answerCbQuery();
});
bot.action(/^del_mac_([a-zA-Z0-9]+)$/, async (ctx) => {
    await MachineryLeasor.findByIdAndDelete(ctx.match[1]);
    ctx.reply('የማሽነሪ አከራይ መረጃው ከዳታቤዝ ተሰርዟል።');
    ctx.answerCbQuery();
});

// --- Truck Seller Actions ---
bot.action(/^tr_act_([a-zA-Z0-9]+)$/, async (ctx) => {
    await TruckLeasor.findByIdAndUpdate(ctx.match[1], { status: 'active' });
    ctx.reply('የመኪናዎ ሁኔታ ወደ "ዝግጁ" ተቀይሯል። ደንበኞች ማግኘት ይችላሉ።');
    ctx.answerCbQuery();
});
bot.action(/^tr_off_([a-zA-Z0-9]+)$/, async (ctx) => {
    await TruckLeasor.findByIdAndUpdate(ctx.match[1], { status: 'off' });
    ctx.reply('መኪናዎ "ስራ ላይ" መሆኑ ተመዝግቧል። ደንበኞች ይህንን መኪና ለግዜው አያገኙትም።');
    ctx.answerCbQuery();
});
bot.action(/^tr_route_([a-zA-Z0-9]+)$/, (ctx) => {
    ctx.session.action = 'UPDATE_TRUCK_ROUTE';
    ctx.session.targetTruckId = ctx.match[1];
    ctx.reply('እባክዎ አዲሱን የጉዞ መስመር ያስገቡ (ለምሳሌ፦ ከአዲስ አበባ ወደ ሀዋሳ)፡');
    ctx.answerCbQuery();
});
bot.action('truck_new_reg', (ctx) => {
    ctx.session.action = 'REG_TRUCK_1';
    ctx.session.truckData = {};
    ctx.reply('ለመመዝገብ የመኪናውን አይነት ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
    ctx.answerCbQuery();
});

// --- Menu Listeners ---
bot.hears('🧱 ሲሚንቶ ለመሸጥ', async (ctx) => {
    ctx.session.action = null;
    const existing = await CementSeller.findOne({ userId: ctx.from.id }).lean();
    if (existing) {
        ctx.reply(
            `እንኳን ደህና መጡ ${ctx.from.first_name}!\n\nየአሁኑ ሁኔታዎ፦ ${existing.status === 'active' ? 'አለ' : 'የለም'}`,
            cementSellerInline
        );
    } else {
        ctx.session.action = 'REG_CEMENT_1';
        ctx.reply('እንኳን ደህና መጡ! ለመመዝገብ የሲሚንቶ አይነት ያስገቡ፡');
    }
});

// ============================================================
// ✅ ቁልፍ ማስተካከያ — "🧱 ሲሚንቶ ለመግዛት" ፍሰት (3 ደረጃ)
// ============================================================
bot.hears('🧱 ሲሚንቶ ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_CEMENT_1';
    ctx.session.buyCement = {};
    ctx.reply('1. ምን አይነት ሲሚንቶ ነው የሚፈልጉት? (ለምሳሌ፡ ዳንጎቴ)');
});

bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    ctx.session.action = null;
    const myTrucks = await TruckLeasor.find({ userId: ctx.from.id }).lean();
    if (myTrucks.length > 0) {
        let buttons = [];
        myTrucks.forEach(t => {
            buttons.push([Markup.button.callback(`ታርጋ: ${t.plate} (${t.type})`, 'none')]);
            buttons.push([
                Markup.button.callback('ዝግጁ', `tr_act_${t._id}`),
                Markup.button.callback('ስራ ላይ', `tr_off_${t._id}`),
                Markup.button.callback('መስመር ቀይር', `tr_route_${t._id}`)
            ]);
        });
        buttons.push([Markup.button.callback('አዲስ መኪና ለመመዝገብ', 'truck_new_reg')]);
        ctx.reply('የእርስዎ መኪናዎች ማስተዳደሪያ ፓናል፦', Markup.inlineKeyboard(buttons));
    } else {
        ctx.session.action = 'REG_TRUCK_1';
        ctx.session.truckData = {};
        ctx.reply('ለመመዝገብ የመኪናውን አይነት ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
    }
});

bot.hears('🚚 መኪና ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.session.rentTruck = {};
    ctx.reply('1. ምን አይነት መኪና ይፈልጋሉ? (ለምሳሌ፡ ሲኖትራክ)');
});

bot.hears('🟥 ብረት ለመሸጥ', async (ctx) => {
    ctx.session.action = null;
    const existing = await SteelSeller.findOne({ userId: ctx.from.id }).lean();
    if (existing) {
        ctx.reply(`የአሁኑ ሁኔታዎ፦ ${existing.status === 'active' ? 'አለ' : 'የለም'}`, steelSellerInline);
    } else {
        ctx.session.action = 'REG_STEEL_1';
        ctx.reply('1. የብረት አይነቶችን ያስገቡ፡');
    }
});

bot.hears('🟥 ብረት ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_STEEL_1';
    ctx.session.buySteel = {};
    ctx.reply('1. ምን አይነት ብረት ይፈልጋሉ?');
});

bot.hears('🔹 ማሽነሪ ለማከራየት', async (ctx) => {
    ctx.session.action = null;
    const existing = await MachineryLeasor.findOne({ userId: ctx.from.id }).lean();
    if (existing) {
        ctx.reply(`የአሁኑ ሁኔታዎ፦ ${existing.status === 'active' ? 'አለ' : 'የለም'}`, machineryLeasorInline);
    } else {
        ctx.session.action = 'REG_MACHINERY_1';
        ctx.reply('1. የማሽነሪው አይነት ያስገቡ፡');
    }
});

bot.hears('🔹 ማሽነሪ ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_MACHINERY_1';
    ctx.session.rentMachinery = {};
    ctx.reply('1. የሚፈልጉት የማሽነሪ አይነት ያስገቡ፡');
});

// --- Text Handler ---
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return next();
    const action = ctx.session.action;
    const userId = ctx.from.id;
    if (!action) return;

    try {

        // ==========================================
        // CEMENT REGISTRATION (ሸጭ)
        // ==========================================
        if (action === 'REG_CEMENT_1') {
            ctx.session.cementData = { type: text };
            ctx.session.action = 'REG_CEMENT_2';
            ctx.reply('2. ያለበት ቦታ ያስገቡ፡');

        } else if (action === 'REG_CEMENT_2') {
            ctx.session.cementData.location = text;
            ctx.session.action = 'REG_CEMENT_3';
            ctx.reply('3. የድርጅቱ ስም ያስገቡ፡');

        } else if (action === 'REG_CEMENT_3') {
            ctx.session.cementData.companyName = text;
            ctx.session.action = 'REG_CEMENT_4';
            ctx.reply('4. ስልክ ቁጥር ያስገቡ፡');

        } else if (action === 'REG_CEMENT_4') {
            ctx.session.cementData.phone = text;
            ctx.session.cementData.userId = userId;
            ctx.session.cementData.price = 1300;
            ctx.session.cementData.status = 'active';
            await CementSeller.findOneAndUpdate({ userId }, ctx.session.cementData, { upsert: true });
            ctx.session.action = null;
            ctx.reply('መረጃዎ በትክክል ተመዝግቧል!', cementSellerInline);

        } else if (action === 'UPDATE_CEMENT_PRICE') {
            await CementSeller.findOneAndUpdate({ userId }, { price: Number(text) });
            ctx.reply(`የሲሚንቶ ዋጋ ወደ ${text} ብር ተሻሽሏል!`);
            ctx.session.action = null;

        // ============================================================
        // ✅ ዋናው ማስተካከያ — BUY CEMENT ፍሰት (3 ደረጃ)
        // ============================================================

        // ደረጃ 1: ገዥው የሚፈልጉትን ሲሚንቶ አይነት ያስገቡ
        } else if (action === 'BUY_CEMENT_1') {
            ctx.session.buyCement = { type: text };
            ctx.session.action = 'BUY_CEMENT_2';
            ctx.reply('2. ሲሚንቶ ለመግዛት የሚፈልጉበት ቦታ ያስገቡ፡ (ለምሳሌ፡ አዲስ አበባ)');

        // ደረጃ 2: ገዥው ሲሚንቶ የሚፈልጉበትን ቦታ ያስገቡ
        } else if (action === 'BUY_CEMENT_2') {
            ctx.session.buyCement.location = text;
            ctx.session.action = 'BUY_CEMENT_3';
            ctx.reply('3. የስልክ ቁጥርዎን ያስገቡ፡');

        // ደረጃ 3: ስልክ ቁጥር ካስገቡ በኋላ ሲሚንቶ ፈልጎ ውጤት ያሳይ
        } else if (action === 'BUY_CEMENT_3') {
            ctx.session.buyCement.phone = text;

            // የፍለጋ ሎግ ወደ ዳታቤዝ ያስቀምጥ
            await SearchLog.create({
                userId,
                username: ctx.from.username || 'N/A',
                category: 'ሲሚንቶ ፈላጊ',
                searchedFor: `አይነት: ${ctx.session.buyCement.type} | ቦታ: ${ctx.session.buyCement.location}`,
                phone: text
            });

            // ከዳታቤዝ ውስጥ ተስማሚ ሲሚንቶ ፈልግ (አይነት + ቦታ + status)
            const available = await CementSeller.findOne({
                type: createSearchRegex(ctx.session.buyCement.type),
                location: createSearchRegex(ctx.session.buyCement.location),
                status: 'active'
            }).lean();

            if (available) {
                // ============================================================
                // ✅ ሲሚንቶ ካለ — ይህ መልዕክት ይላካል
                // ============================================================
                ctx.reply(
                    `የሚፈልጉት የሲሚንቶ አይነት እኛ ጋር ይገኛል!\n` +
                    `አይነት: ${available.type}\n` +
                    `ቦታ: ${available.location}\n` +
                    `ዋጋ: ${available.price} ብር\n\n` +
                    `በ ${SUPPORT_PHONE} ደውለው ይዘዙ።`
                );
            } else {
                // ============================================================
                // ✅ ሲሚንቶ ከሌለ — ይህ መልዕክት ይላካል
                // ============================================================
                ctx.reply(
                    `ይቅርታ! የፈለጉት የሲሚንቶ አይነት የለም።\n` +
                    `ሲኖር እናሳውቀዎታለን።\n\n` +
                    `ለተጨማሪ መረጃ በ ${SUPPORT_PHONE} ይደውሉ።`
                );
            }

            ctx.session.action = null;
            ctx.session.buyCement = {};

        // ==========================================
        // TRUCK REGISTRATION
        // ==========================================
        } else if (action === 'REG_TRUCK_1') {
            ctx.session.truckData = { type: text };
            ctx.session.action = 'REG_TRUCK_2';
            ctx.reply('2. የተሽከርካሪውን ታርጋ ቁጥር ያስገቡ፡');

        } else if (action === 'REG_TRUCK_2') {
            ctx.session.truckData.plate = text;
            ctx.session.action = 'REG_TRUCK_3';
            ctx.reply('3. የሚሰራበትን የጉዞ መስመር ያስገቡ (ለምሳሌ፦ ከአዲስ አበባ ወደ ሀዋሳ)፡');

        } else if (action === 'REG_TRUCK_3') {
            ctx.session.truckData.route = text;
            ctx.session.action = 'REG_TRUCK_4';
            ctx.reply('4. ስልክ ቁጥር ያስገቡ፡');

        } else if (action === 'REG_TRUCK_4') {
            ctx.session.truckData.phone = text;
            ctx.session.truckData.userId = userId;
            ctx.session.truckData.status = 'active';
            await TruckLeasor.findOneAndUpdate(
                { userId, plate: ctx.session.truckData.plate },
                ctx.session.truckData,
                { upsert: true }
            );
            ctx.session.action = null;
            ctx.reply('መኪናዎ በትክክል ተመዝግቧል!');

        } else if (action === 'UPDATE_TRUCK_ROUTE') {
            await TruckLeasor.findByIdAndUpdate(ctx.session.targetTruckId, { route: text });
            ctx.reply(`የመኪናዎ የጉዞ መስመር ወደ "${text}" በትክክል ተቀይሯል!`);
            ctx.session.action = null;
            ctx.session.targetTruckId = null;

        // ==========================================
        // RENT TRUCK ፍሰት (3 ደረጃ)
        // ==========================================
        } else if (action === 'RENT_TRUCK_1') {
            ctx.session.rentTruck = { type: text };
            ctx.session.action = 'RENT_TRUCK_2';
            ctx.reply('2. የጉዞ መስመሩ ከየት ወደ የት ነው? (ለምሳሌ፦ ከአዲስ አበባ ወደ ሀዋሳ)');

        } else if (action === 'RENT_TRUCK_2') {
            ctx.session.rentTruck.route = text;
            ctx.session.action = 'RENT_TRUCK_3';
            ctx.reply('3. የስልክ ቁጥርዎን ያስገቡ፡');

        } else if (action === 'RENT_TRUCK_3') {
            ctx.session.rentTruck.phone = text;

            await SearchLog.create({
                userId,
                username: ctx.from.username || 'N/A',
                category: 'መኪና ፈላጊ',
                searchedFor: `አይነት: ${ctx.session.rentTruck.type} | መስመር: ${ctx.session.rentTruck.route}`,
                phone: text
            });

            const foundTruck = await TruckLeasor.findOne({
                type: createSearchRegex(ctx.session.rentTruck.type),
                route: createSearchRegex(ctx.session.rentTruck.route),
                status: 'active'
            }).sort({ rentedCount: 1 });

            if (foundTruck) {
                ctx.reply(
                    `የፈለጉት መኪና ዝግጁ ነው!\n` +
                    `አይነት: ${foundTruck.type}\n` +
                    `ታርጋ ቁጥር: ${foundTruck.plate}\n\n` +
                    `በ ${SUPPORT_PHONE} ይደውሉልን`
                );
                await TruckLeasor.findByIdAndUpdate(foundTruck._id, { $inc: { rentedCount: 1 } });
            } else {
                ctx.reply(
                    `ይቅርታ! የጠየቁት መኪና ለጊዜው አይገኝም።\n` +
                    `ሲኖር እናሳውቀዎታለን።\n\n` +
                    `ለተጨማሪ መረጃ በ ${SUPPORT_PHONE} ይደውሉ።`
                );
            }

            ctx.session.action = null;
            ctx.session.rentTruck = {};

        // ==========================================
        // STEEL REGISTRATION
        // ==========================================
        } else if (action === 'REG_STEEL_1') {
            ctx.session.steelData = { type: text };
            ctx.session.action = 'REG_STEEL_2';
            ctx.reply('2. አድራሻ ያስገቡ፡');

        } else if (action === 'REG_STEEL_2') {
            ctx.session.steelData.address = text;
            ctx.session.action = 'REG_STEEL_3';
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');

        } else if (action === 'REG_STEEL_3') {
            ctx.session.steelData.phone = text;
            ctx.session.action = 'REG_STEEL_4';
            ctx.reply('4. ዋጋ ያስገቡ (በብር)፡');

        } else if (action === 'REG_STEEL_4') {
            ctx.session.steelData.price = text;
            ctx.session.steelData.userId = userId;
            ctx.session.steelData.status = 'active';
            await SteelSeller.findOneAndUpdate({ userId }, ctx.session.steelData, { upsert: true });
            ctx.session.action = null;
            ctx.reply('የብረት መረጃዎ ተመዝግቧል!', steelSellerInline);

        } else if (action === 'UPDATE_STEEL_PRICE') {
            await SteelSeller.findOneAndUpdate({ userId }, { price: text });
            ctx.reply(`የብረት ዋጋ ወደ ${text} ብር ተሻሽሏል!`);
            ctx.session.action = null;

        } else if (action === 'BUY_STEEL_1') {
            ctx.session.buySteel = { type: text };
            ctx.session.action = 'BUY_STEEL_2';
            ctx.reply('2. ብረት ለመግዛት የሚፈልጉበት ቦታ ያስገቡ፡');

        } else if (action === 'BUY_STEEL_2') {
            ctx.session.buySteel.location = text;
            ctx.session.action = 'BUY_STEEL_3';
            ctx.reply('3. የስልክ ቁጥርዎን ያስገቡ፡');

        } else if (action === 'BUY_STEEL_3') {
            ctx.session.buySteel.phone = text;
            await SearchLog.create({
                userId,
                username: ctx.from.username || 'N/A',
                category: 'ብረት ፈላጊ',
                searchedFor: `አይነት: ${ctx.session.buySteel.type}`,
                phone: text
            });
            const available = await SteelSeller.findOne({
                type: createSearchRegex(ctx.session.buySteel.type),
                status: 'active'
            }).lean();
            if (available) {
                ctx.reply(`የጠየቁት የብረት አይነት ይገኛል\nየአሁን ዋጋ፡ ${available.price} ብር\nበ ${SUPPORT_PHONE} ደውለው ማዘዝ ይችላሉ`);
            } else {
                ctx.reply(`ይቅርታ የጠየቁት የብረት አይነት ለዛሬ የለም።\nሲኖር እናሳውቀዎታለን።`);
            }
            ctx.session.action = null;
            ctx.session.buySteel = {};

        // ==========================================
        // MACHINERY REGISTRATION
        // ==========================================
        } else if (action === 'REG_MACHINERY_1') {
            ctx.session.machineryData = { type: text };
            ctx.session.action = 'REG_MACHINERY_2';
            ctx.reply('2. አድራሻ ያስገቡ፡');

        } else if (action === 'REG_MACHINERY_2') {
            ctx.session.machineryData.address = text;
            ctx.session.action = 'REG_MACHINERY_3';
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');

        } else if (action === 'REG_MACHINERY_3') {
            ctx.session.machineryData.phone = text;
            ctx.session.action = 'REG_MACHINERY_4';
            ctx.reply('4. ዋጋ ያስገቡ (በብር)፡');

        } else if (action === 'REG_MACHINERY_4') {
            ctx.session.machineryData.price = text;
            ctx.session.machineryData.userId = userId;
            ctx.session.machineryData.status = 'active';
            await MachineryLeasor.findOneAndUpdate({ userId }, ctx.session.machineryData, { upsert: true });
            ctx.session.action = null;
            ctx.reply('የማሽነሪ መረጃዎ ተመዝግቧል!', machineryLeasorInline);

        } else if (action === 'RENT_MACHINERY_1') {
            ctx.session.rentMachinery = { type: text };
            ctx.session.action = 'RENT_MACHINERY_2';
            ctx.reply('2. ማሽነሪ የሚፈልጉበት ቦታ ያስገቡ፡');

        } else if (action === 'RENT_MACHINERY_2') {
            ctx.session.rentMachinery.location = text;
            ctx.session.action = 'RENT_MACHINERY_3';
            ctx.reply('3. የስልክ ቁጥርዎን ያስገቡ፡');

        } else if (action === 'RENT_MACHINERY_3') {
            ctx.session.rentMachinery.phone = text;
            await SearchLog.create({
                userId,
                username: ctx.from.username || 'N/A',
                category: 'ማሽነሪ ፈላጊ',
                searchedFor: `አይነት: ${ctx.session.rentMachinery.type}`,
                phone: text
            });
            const available = await MachineryLeasor.findOne({
                type: createSearchRegex(ctx.session.rentMachinery.type),
                status: 'active'
            }).lean();
            if (available) {
                ctx.reply(`የጠየቁት ማሽነሪ ይገኛል\nዋጋ፡ ${available.price} ብር\nበ ${SUPPORT_PHONE} ደውለው ማዘዝ ይችላሉ`);
            } else {
                ctx.reply(`ይቅርታ የጠየቁት ማሽነሪ ለዛሬ የለም።\nሲኖር እናሳውቀዎታለን።`);
            }
            ctx.session.action = null;
            ctx.session.rentMachinery = {};
        }

    } catch (error) {
        console.error("Error:", error);
        ctx.reply('ስህተት አጋጥሟል። እባክዎ እንደገና ይሞክሩ።');
    }
});

// --- Status Actions ---
bot.action('cement_active', async (ctx) => {
    await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    ctx.reply('ሲሚንቶ "አለ" ተብሎ ተቀይሯል።');
    ctx.answerCbQuery();
});
bot.action('cement_off', async (ctx) => {
    await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' });
    ctx.reply('ሲሚንቶ "የለም" ተብሎ ተቀይሯል።');
    ctx.answerCbQuery();
});
bot.action('cement_update_price', (ctx) => {
    ctx.session.action = 'UPDATE_CEMENT_PRICE';
    ctx.reply('አዲሱን ዋጋ ያስገቡ (በብር)፡');
    ctx.answerCbQuery();
});
bot.action('steel_active', async (ctx) => {
    await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    ctx.reply('ብረት "አለ" ተብሎ ተቀይሯል።');
    ctx.answerCbQuery();
});
bot.action('steel_off', async (ctx) => {
    await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' });
    ctx.reply('ብረት "የለም" ተብሎ ተቀይሯል።');
    ctx.answerCbQuery();
});
bot.action('steel_update_price', (ctx) => {
    ctx.session.action = 'UPDATE_STEEL_PRICE';
    ctx.reply('አዲሱን ዋጋ ያስገቡ (በብር)፡');
    ctx.answerCbQuery();
});
bot.action('machinery_active', async (ctx) => {
    await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    ctx.reply('ማሽነሪ "አለ" ተብሎ ተቀይሯል።');
    ctx.answerCbQuery();
});
bot.action('machinery_off', async (ctx) => {
    await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' });
    ctx.reply('ማሽነሪ "የለም" ተብሎ ተቀይሯል።');
    ctx.answerCbQuery();
});

// --- Global Error Handling ---
process.on('uncaughtException', err => console.error('UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', err => console.error('UNHANDLED REJECTION:', err));

// --- Server & Launch ---
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => res.end("Bot is running!")).listen(PORT, '0.0.0.0');
bot.launch().then(() => console.log('ቦቱ ስራ ጀምሯል!'));
