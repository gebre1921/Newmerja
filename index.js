const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');

// --- 🌐 የ Express ሰርቨር ማዘጋጃ ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('ቦቱ በጥሩ ሁኔታ እየሰራ ነው!');
});

// --- 🛠️ የቶክን ማጽጃ ---
const rawToken = process.env.BOT_TOKEN;
const BOT_TOKEN = rawToken ? rawToken.trim().replace(/['"]/g, '') : undefined;
const MONGO_URI = process.env.MONGO_URI;

if (!BOT_TOKEN || !MONGO_URI) {
    console.error("ስህተት: BOT_TOKEN ወይም MONGO_URI በ Render Environment Variables ላይ አልተገኘም!");
    process.exit(1);
}

// --- 🗄️ ከማንጎ ዲቢ (MongoDB) ጋር ማገናኛ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ ማንጎ ዲቢ ዳታቤዝ በተሳካ ሁኔታ ተገናኝቷል!"))
    .catch(err => console.error("❌ የዳታቤዝ ግንኙነት ስህተት:", err));

// --- 📊 የዳታቤዝ ሰንጠረዦች መዋቅር (Schemas) ---
const cementSchema = new mongoose.Schema({ userId: Number, type: String, location: String, companyName: String, phone: String, price: Number, status: String });
cementSchema.index({ type: 1, status: 1 });
const CementSeller = mongoose.model('CementSeller', cementSchema);

const steelSchema = new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String });
steelSchema.index({ type: 1, status: 1 });
const SteelSeller = mongoose.model('SteelSeller', steelSchema);

const machinerySchema = new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String });
const MachineryLeasor = mongoose.model('MachineryLeasor', machinerySchema);

const truckSchema = new mongoose.Schema({ 
    userId: Number, 
    type: String, 
    plate: String, 
    route: String, 
    phone: String, 
    status: String,
    rentedCount: { type: Number, default: 0 } 
});
truckSchema.index({ type: 1, route: 1, status: 1 });
const TruckLeasor = mongoose.model('TruckLeasor', truckSchema);

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

const bot = new Telegraf(BOT_TOKEN);

// --- Session Middleware ---
bot.use(async (ctx, next) => {
    try {
        if (!ctx.from) return next();
        const sessionKey = `${ctx.from.id}:${ctx.from.id}`;
        let sessionDoc = await BotSession.findOne({ key: sessionKey });
        if (!sessionDoc) {
            sessionDoc = await BotSession.create({ key: sessionKey, data: {} });
        }
        ctx.session = sessionDoc.data || {};
        await next();
        await BotSession.updateOne({ key: sessionKey }, { $set: { data: ctx.session } });
    } catch (err) {
        console.error("Session Error:", err);
    }
});

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
    ctx.reply('እንኳን ወደ Simple ቦት በሰላም መጡ! እባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ።', mainKeyboard);
});

// --- 👑 የአድሚን መቆጣጠሪያ ፓናል ---
bot.command('admin_panel', async (ctx) => {
    if (ctx.from.id !== 7423347375) {
        return ctx.reply('ይቅርታ፣ ይህንን የአድሚን ትዕዛዝ ለመጠቀም ፈቃድ የለዎትም!');
    }
    ctx.session = ctx.session || {};
    ctx.session.action = null;
    
    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('📊 ሲሚንቶ ሪፖርት', 'rep_cement'), Markup.button.callback('📊 መኪና ሪፖርት', 'rep_truck')],
        [Markup.button.callback('📊 ብረት ሪፖርት', 'rep_steel'), Markup.button.callback('📊 ማሽነሪ ሪፖርት', 'rep_machinery')],
        [Markup.button.callback('🔍 የፈላጊዎች ፍላጎት ሪፖርት', 'rep_searches')],
        [Markup.button.callback('📅 የዛሬ Active ተጠቃሚዎች', 'rep_actives')],
        [Markup.button.callback('❌ ማጥፊያ ፓናል', 'admin_delete_menu')]
    ]);
    ctx.reply('👑 እንኳን ወደ አድሚን ፓናል በሰላም መጡ። ማየት ወይንም ማጥፋት የሚፈልጉትን ይምረጡ፦', adminMenu);
});

// --- 📊 የአድሚን ሪፖርት ማሳያ ---
bot.action(/rep_.+/, async (ctx) => {
    await ctx.answerCbQuery();
    try {
        const action = ctx.callbackQuery.data;
        if (action === 'rep_cement') {
            const items = await CementSeller.find({}).lean();
            if (items.length === 0) return ctx.reply('🧱 ምንም የተመዘገበ የሲሚንቶ ሻጭ የለም።');
            let msg = '📊 የሲሚንቶ ሻጮች ሪፖርት፦\n\n';
            items.forEach((item, idx) => { msg += `${idx + 1}. ድርጅት: ${item.companyName || 'N/A'}\n   አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   ቦታ: ${item.location}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? '✅ አለ' : '❌ የለም'}\n────────────────\n`; });
            ctx.reply(msg);
        } else if (action === 'rep_truck') {
            const items = await TruckLeasor.find({}).lean();
            if (items.length === 0) return ctx.reply('🚚 ምንም የተመዘገበ መኪና የለም።');
            let msg = '📊 የመኪና አከራዮች ሪፖርት፦\n\n';
            items.forEach((item, idx) => { msg += `${idx + 1}. ታርጋ: ${item.plate}\n   አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   መስመር: ${item.route}\n   ሁኔታ: ${item.status === 'active' ? '🟢 ዝግጁ' : '🔴 ስራ ላይ'}\n────────────────\n`; });
            ctx.reply(msg);
        } else if (action === 'rep_steel') {
            const items = await SteelSeller.find({}).lean();
            if (items.length === 0) return ctx.reply('🟥 ምንም የተመዘገበ የብረት ሻጭ የለም።');
            let msg = '📊 የብረት ሻጮች ሪፖርት፦\n\n';
            items.forEach((item, idx) => { msg += `${idx + 1}. አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   አድራሻ: ${item.address}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? '✅ አለ' : '❌ የለም'}\n────────────────\n`; });
            ctx.reply(msg);
        } else if (action === 'rep_machinery') {
            const items = await MachineryLeasor.find({}).lean();
            if (items.length === 0) return ctx.reply('🔹 ምንም የተመዘገበ ማሽነሪ የለም።');
            let msg = '📊 የማሽነሪ አከራዮች ሪፖርት፦\n\n';
            items.forEach((item, idx) => { msg += `${idx + 1}. አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   አድራሻ: ${item.address}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? '✅ አለ' : '❌ የለም'}\n────────────────\n`; });
            ctx.reply(msg);
        } else if (action === 'rep_searches') {
            const logs = await SearchLog.find({}).sort({ createdAt: -1 }).limit(30).lean();
            if (logs.length === 0) return ctx.reply('🔍 እስካሁን ምንም የፍለጋ ታሪክ አልተመዘገበም።');
            let msg = '🔍 የፈላጊዎች ፍላጎት ሪፖርት (የመጨረሻዎቹ 30)፦\n\n';
            logs.forEach((log, idx) => { msg += `${idx + 1}. ዘርፍ: ${log.category}\n   የፈለገው: ${log.searchedFor}\n   የፈላጊው ስልክ: ${log.phone}\n   ቀን: ${new Date(log.createdAt).toLocaleDateString('en-US')}\n────────────────\n`; });
            ctx.reply(msg);
        } else if (action === 'rep_actives') {
            const todayStr = getTodayDateString();
            const logs = await ActiveLog.find({ dateStr: todayStr }).sort({ createdAt: -1 }).lean();
            if (logs.length === 0) return ctx.reply(`📅 ዛሬ (${todayStr}) ሁኔታቸውን Active ያደረጉ ተጠቃሚዎች የሉም።`);
            let msg = `📅 የዛሬ (${todayStr}) የActive ተጠቃሚዎች ሪፖርት፦\n\n`;
            logs.forEach((log, idx) => { msg += `${idx + 1}. ስም: ${log.name}\n   ዘርፍ: ${log.category}\n   ዝርዝር: ${log.detail}\n   ሰዓት: ${new Date(log.createdAt).toLocaleTimeString('en-US')}\n────────────────\n`; });
            ctx.reply(msg);
        }
    } catch(e) { console.error(e); ctx.reply('ስህተት አጋጥሟል'); }
});

bot.action('admin_delete_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const delMenu = Markup.inlineKeyboard([
        [Markup.button.callback('🧱 ሲሚንቶ አጥፋ', 'adm_manage_cement')],
        [Markup.button.callback('🚚 መኪና አጥፋ', 'adm_manage_truck')],
        [Markup.button.callback('🟥 ብረት አጥፋ', 'adm_manage_steel')],
        [Markup.button.callback('🔹 ማሽነሪ አጥፋ', 'adm_manage_machinery')]
    ]);
    ctx.reply('ማስተዳደር (ማጥፋት) የሚፈልጉትን ዘርፍ ይምረጡ፦', delMenu);
});

// --- 🧱 በተኖች (Inline Buttons) ---
const cementSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'cement_active'), Markup.button.callback('❌ የለም', 'cement_off')],
    [Markup.button.callback('💰 ዋጋ ማሻሻያ', 'cement_update_price')]
]);

const steelSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'steel_active'), Markup.button.callback('❌ የለም', 'steel_off')],
    [Markup.button.callback('💰 ዋጋ ማሻሻያ', 'steel_update_price')]
]);

const machineryLeasorInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'machinery_active'), Markup.button.callback('❌ የለም', 'machinery_off')]
]);

// --- 🚚 የመኪና በተኖች Handler (FIXED) ---
bot.action(/tr_(act|off|route)_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data.split('_'); 
    const action = data; // FIXED: Corrected access to index 1
    const truckId = data; // FIXED: Corrected access to index 2

    if (action === 'act') {
        await TruckLeasor.findByIdAndUpdate(truckId, { status: 'active' });
        ctx.reply('✅ መኪናዎ አሁን "🟢 ዝግጁ" (Active) ሆኗል።');
    } else if (action === 'off') {
        await TruckLeasor.findByIdAndUpdate(truckId, { status: 'off' });
        ctx.reply('🔴 መኪናዎ አሁን "🔴 ስራ ላይ" ተደርጓል።');
    } else if (action === 'route') {
        ctx.session.action = 'UPDATE_TRUCK_ROUTE';
        ctx.session.targetTruckId = truckId;
        ctx.reply('አዲሱን የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከባህር ዳር አዲስ አበባ)፡');
    }
});

bot.action('truck_new_reg', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.action = 'REG_TRUCK_1';
    ctx.session.truckData = {};
    ctx.reply('ለመመዝገብ የመኪናውን አይነት ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
});

// --- Menu Listeners ---
bot.hears('🧱 ሲሚንቶ ለመሸጥ', async (ctx) => {
    ctx.session.action = null; 
    const existing = await CementSeller.findOne({ userId: ctx.from.id }).lean();
    const name = ctx.from.first_name || 'ተጠቃሚ';
    if (existing) {
        ctx.reply(`እንኳን ደህና መጡ ${name}!\n\nየአሁኑ ሁኔታዎ፦ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nእባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ፦`, cementSellerInline);
    } else {
        ctx.session.action = 'REG_CEMENT_1';
        ctx.reply(`እንኳን ደህና መጡ! ለመጠቀም እባክዎ መጀመሪያ ይመዝገቡ።\n\nየሲሚንቶ አይነት ያስገቡ፡`);
    }
});

bot.hears('🧱 ሲሚንቶ ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_CEMENT_1';
    ctx.reply('1. ምን አይነት ሲሚንቶ ነው የሚፈልጉት?');
});

bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    ctx.session.action = null;
    const myTrucks = await TruckLeasor.find({ userId: ctx.from.id }).lean();
    const name = ctx.from.first_name || 'ተጠቃሚ';
    if (myTrucks.length > 0) {
        let buttons = [];
        myTrucks.forEach(t => {
            buttons.push([Markup.button.callback(`🇪🇹 ታርጋ፡ ${t.plate} (${t.type})`, 'none')]);
            buttons.push([
                Markup.button.callback('🟢 ዝግጁ', `tr_act_${t._id}`),
                Markup.button.callback('🔴 ስራ ላይ', `tr_off_${t._id}`),
                Markup.button.callback('📍 መስመር ቀይር', `tr_route_${t._id}`)
            ]);
        });
        buttons.push([Markup.button.callback('➕ አዲስ መኪና ለመመዝገብ', 'truck_new_reg')]);
        ctx.reply(`እንኳን ደህና መጡ ${name}!\n\n📋 የእርስዎ መኪናዎች ማስተዳደሪያ ፓናል፦`, Markup.inlineKeyboard(buttons));
    } else {
        ctx.session.action = 'REG_TRUCK_1';
        ctx.session.truckData = {};
        ctx.reply(`እንኳን ደህና መጡ! ለመጠቀም እባክዎ መጀመሪያ ይመዝገቡ።\n\nለመመዝገብ የመኪናውን አይነት ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡`);
    }
});

bot.hears('🚚 መኪና ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.reply('1. ምን አይነት መኪና ይፈልጋሉ?');
});

bot.hears('🟥 ብረት ለመሸጥ', async (ctx) => {
    ctx.session.action = null;
    const existing = await SteelSeller.findOne({ userId: ctx.from.id }).lean();
    const name = ctx.from.first_name || 'ተጠቃሚ';
    if (existing) {
        ctx.reply(`እንኳን ደህና መጡ ${name}!\n\nየአሁኑ ሁኔታዎ፦ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nእባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ፦`, steelSellerInline);
    } else {
        ctx.session.action = 'REG_STEEL_1';
        ctx.reply(`እንኳን ደህና መጡ! ለመጠቀም እባክዎ መጀመሪያ ይመዝገቡ።\n\n1. የብረት አይነቶችን ያስገቡ፡`);
    }
});

bot.hears('🟥 ብረት ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_STEEL_1';
    ctx.reply('1. ምን አይነት ብረት ይፈልጋሉ?');
});

bot.hears('🔹 ማሽነሪ ለማከራየት', async (ctx) => {
    ctx.session.action = null;
    const existing = await MachineryLeasor.findOne({ userId: ctx.from.id }).lean();
    const name = ctx.from.first_name || 'ተጠቃሚ';
    if (existing) {
        ctx.reply(`እንኳን ደህና መጡ ${name}!\n\nየአሁኑ ሁኔታዎ፦ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nእባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ፦`, machineryLeasorInline);
    } else {
        ctx.session.action = 'REG_MACHINERY_1';
        ctx.reply(`እንኳን ደህና መጡ! ለመጠቀም እባክዎ መጀመሪያ ይመዝገቡ。\n\n1. የማሽነሪው አይነት ያስገቡ፡`);
    }
});

bot.hears('🔹 ማሽነሪ ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_MACHINERY_1';
    ctx.reply('1. የሚፈልጉት የማሽነሪ አይነት ያስገቡ፡');
});

// --- 💬 የፅሁፍ መልዕክቶች ማቀናበሪያ ---
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return next();
    
    const action = ctx.session.action;
    const userId = ctx.from.id;
    if (!action) return;

    try {
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
            await ActiveLog.create({ userId, name: ctx.from.first_name || 'ተጠቃሚ', category: '🧱 ሲሚንቶ ሻጭ', detail: ctx.session.cementData.companyName, dateStr: getTodayDateString() });
            ctx.session.action = null;
            ctx.reply('መረጃዎ በትክክል ተመዝግቧል!', cementSellerInline);
        } else if (action === 'UPDATE_CEMENT_PRICE') {
            await CementSeller.findOneAndUpdate({ userId }, { price: Number(text) });
            ctx.reply(`የሲሚንቶ ዋጋ ወደ ${text} ብር በተሳካ ሁኔታ ተሻሽሏል!`);
            ctx.session.action = null;
        } else if (action === 'BUY_CEMENT_1') {
            ctx.session.buyCement = { type: text };
            ctx.session.action = 'BUY_CEMENT_2';
            ctx.reply('2. አድራሻ ያስገቡ፡');
        } else if (action === 'BUY_CEMENT_2') {
            ctx.session.buyCement.address = text;
            ctx.session.action = 'BUY_CEMENT_3';
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'BUY_CEMENT_3') {
            ctx.session.buyCement.phone = text;
            await SearchLog.create({ userId, username: ctx.from.username || 'N/A', category: '🧱 ሲሚንቶ ፈላጊ', searchedFor: `አይነት: ${ctx.session.buyCement.type}, አድራሻ: ${ctx.session.buyCement.address}`, phone: text });
            const searchRegex = createSearchRegex(ctx.session.buyCement.type);
            const available = await CementSeller.findOne({ type: searchRegex, status: 'active' }).lean();
            if (available) {
                ctx.reply(`የጠየቁት የሲሚንቶ አይነት እኛ ጋር ይገኛል\nየአሁን ዋጋ፡ ${available.price} ብር\nበ 0960336138 ደውለው ማዘዝ ይችላሉ`);
            } else {
                ctx.reply('ይቅርታ የጠየቁት የሲሚንቶ አይነት ለዛሬ የለም ሲኖር እናሳውቀዎታለን');
            }
            ctx.session.action = null;
        } else if (action === 'REG_TRUCK_1') {
            ctx.session.truckData = { type: text };
            ctx.session.action = 'REG_TRUCK_2';
            ctx.reply('የመኪናው ታርጋ ያስገቡ፡');
        } else if (action === 'REG_TRUCK_2') {
            ctx.session.truckData.plate = text;
            ctx.session.action = 'REG_TRUCK_3';
            ctx.reply('የጉዞ መስመር ያስገቡ (ምሳሌ፡ ሀዋሳ አዳማ)፡');
        } else if (action === 'REG_TRUCK_3') {
            ctx.session.truckData.route = text;
            ctx.session.action = 'REG_TRUCK_4';
            ctx.reply('ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'REG_TRUCK_4') {
            ctx.session.truckData.phone = text;
            ctx.session.truckData.userId = userId;
            ctx.session.truckData.status = 'active';
            ctx.session.truckData.rentedCount = 0; 
            await TruckLeasor.findOneAndUpdate({ userId: userId, plate: ctx.session.truckData.plate }, ctx.session.truckData, { upsert: true });
            await ActiveLog.create({ userId, name: ctx.from.first_name || 'ተጠቃሚ', category: '🚚 መኪና አከራይ', detail: `ታርጋ: ${ctx.session.truckData.plate}`, dateStr: getTodayDateString() });
            ctx.session.action = null;
            ctx.reply('መኪናዎ በትክክል ተመዝግቧል! ፈላጊ ሲኖር እናሳውቆታለን።');
        } else if (action === 'UPDATE_TRUCK_ROUTE') {
            const truckId = ctx.session.targetTruckId;
            await TruckLeasor.findByIdAndUpdate(truckId, { route: text });
            ctx.reply(`የመኪናዎ የጉዞ መስመር ወደ [ ${text} ] በተሳካ ሁኔታ ተቀይሯል!`);
            ctx.session.action = null;
            ctx.session.targetTruckId = null;
        } else if (action === 'RENT_TRUCK_1') {
            ctx.session.rentTruck = { type: text };
            ctx.session.action = 'RENT_TRUCK_2';
            ctx.reply('2. የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከአዲስ አበባ ጎንደር)፡');
        } else if (action === 'RENT_TRUCK_2') {
            ctx.session.rentTruck.route = text;
            ctx.session.action = 'RENT_TRUCK_3';
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'RENT_TRUCK_3') {
            ctx.session.rentTruck.phone = text; 
            await SearchLog.create({ userId, username: ctx.from.username || 'N/A', category: '🚚 መኪና ፈላጊ', searchedFor: `አይነት: ${ctx.session.rentTruck.type}, መስመር: ${ctx.session.rentTruck.route}`, phone: text });
            const userRoute = ctx.session.rentTruck.route || "";
            const cleanRoute = userRoute.toLowerCase();
            let searchRegex = (cleanRoute.includes("gondar") || cleanRoute.includes("ጎንደር") || cleanRoute.includes("gondr") || cleanRoute.includes("gonder")) ? new RegExp("(gondar|ጎንደር|gondr|gonder)", "i") : createSearchRegex(userRoute);
            const typeRegex = createSearchRegex(ctx.session.rentTruck.type);
            const foundTruck = await TruckLeasor.findOne({ type: typeRegex, route: searchRegex, status: 'active' }).sort({ rentedCount: 1, _id: 1 }); 
            if (foundTruck) {
                ctx.reply(`የሚፈልጉት መኪና ይገኛል!\nየመኪናው አይነት፡ ${foundTruck.type}\nታርጋ ቁጥር፡ ${foundTruck.plate}\nለማዘዝ በ 0960336138 ደውለው ማዘዝ ይችላሉ`);
                await TruckLeasor.findByIdAndUpdate(foundTruck._id, { $set: { rentedCount: (foundTruck.rentedCount || 0) + 1 } });
            } else {
                ctx.reply('በዚህ የጉዞ መስመር የሚጓዝ መኪና መረጃ እስካሁን አልደረሰንም መረጃው እንደደረሰን እናሳውቃለን');
            }
            ctx.session.action = null;
        } else if (action === 'REG_STEEL_1') {
            ctx.session.steelData = { type: text };
            ctx.session.action = 'REG_STEEL_2'; 
            ctx.reply('2. ያሉበት አድራሻ ያስገቡ፡');
        } else if (action === 'REG_STEEL_2') {
            ctx.session.steelData.address = text;
            ctx.session.action = 'REG_STEEL_3';
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'REG_STEEL_3') {
            ctx.session.steelData.phone = text;
            ctx.session.steelData.userId = userId;
            ctx.session.steelData.status = 'active';
            await SteelSeller.findOneAndUpdate({ userId }, ctx.session.steelData, { upsert: true });
            await ActiveLog.create({ userId, name: ctx.from.first_name || 'ተጠቃሚ', category: '🟥 ብረት ሻጭ', detail: ctx.session.steelData.type, dateStr: getTodayDateString() });
            ctx.session.action = null;
            ctx.reply('የብረት መረጃዎ በትክክል ተመዝግቧል!', steelSellerInline);
        }
    } catch (error) {
        console.error("Text Handler Error:", error);
    }
});

// 🟢 ሰርቨሩን እና ቦቱን በተመሳሳይ ሰዓት ማስነሻ
app.listen(port, () => {
    console.log(`🌐 ዌብ ሰርቨሩ በፖርት ${port} ላይ እየሰራ ነው...`);
    bot.launch().then(() => console.log('🤖 የቴሌግራም ቦቱ በተሳካ ሁኔታ ስራ ጀምሯል!')).catch(err => console.error('❌ ቦቱን በማስነሳት ላይ ስህተት ተፈጥሯል:', err));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
