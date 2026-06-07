const { Telegraf, Markup } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose');

// --- 🛠️ የቶክን ማጽጃ ክፍል ---
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
    return d.toISOString().split('T')[0]; // ✅ ጥገና: Array ሳይሆን "2026-06-07" የሚል String ይመልሳል
}

function createSearchRegex(input) {
    if (!input) return new RegExp('', 'i');
    // ✅ ጥገና: ቀለል ያለ contains-search ለሁለቱም አማርኛ እና ላቲን ፊደላት ትክክለኛ ነው
    const clean = input.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(clean, 'i');
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

// --- 📊 የአድሚን ሪፖርት ማሳያ ክፍል ---
bot.action('rep_cement', async (ctx) => {
    try {
        const items = await CementSeller.find({}).lean();
        if (items.length === 0) {
            await ctx.answerCbQuery();
            return ctx.reply('🧱 ምንም የተመዘገበ የሲሚንቶ ሻጭ የለም።');
        }
        let msg = '📊 የሲሚንቶ ሻጮች ሪፖርት፦\n\n';
        items.forEach((item, idx) => {
            msg += `${idx + 1}. ድርጅት: ${item.companyName || 'N/A'}\n   አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   ቦታ: ${item.location}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? '✅ አለ' : '❌ የለም'}\n────────────────\n`;
        });
        await ctx.answerCbQuery();
        ctx.reply(msg); 
    } catch(e) { console.error(e); ctx.answerCbQuery('ስህተት አጋጥሟል'); }
});

bot.action('rep_truck', async (ctx) => {
    try {
        const items = await TruckLeasor.find({}).lean();
        if (items.length === 0) {
            await ctx.answerCbQuery();
            return ctx.reply('🚚 ምንም የተመዘገበ መኪና የለም።');
        }
        let msg = '📊 የመኪና አከራዮች ሪፖርት፦\n\n';
        items.forEach((item, idx) => {
            msg += `${idx + 1}. ታርጋ: ${item.plate}\n   አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   መስመር: ${item.route}\n   ሁኔታ: ${item.status === 'active' ? '🟢 ዝግጁ' : '🔴 ስራ ላይ'}\n────────────────\n`;
        });
        await ctx.answerCbQuery();
        ctx.reply(msg); 
    } catch(e) { console.error(e); ctx.answerCbQuery('ስህተት አጋጥሟል'); }
});

bot.action('rep_steel', async (ctx) => {
    try {
        const items = await SteelSeller.find({}).lean();
        if (items.length === 0) {
            await ctx.answerCbQuery();
            return ctx.reply('🟥 ምንም የተመዘገበ የብረት ሻጭ የለም።');
        }
        let msg = '📊 የብረት ሻጮች ሪፖርት፦\n\n';
        items.forEach((item, idx) => {
            msg += `${idx + 1}. አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   አድራሻ: ${item.address}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? '✅ አለ' : '❌ የለም'}\n────────────────\n`;
        });
        await ctx.answerCbQuery();
        ctx.reply(msg); 
    } catch(e) { console.error(e); ctx.answerCbQuery('ስህተት አጋጥሟል'); }
});

bot.action('rep_machinery', async (ctx) => {
    try {
        const items = await MachineryLeasor.find({}).lean();
        if (items.length === 0) {
            await ctx.answerCbQuery();
            return ctx.reply('🔹 ምንም የተመዘገበ ማሽነሪ የለም።');
        }
        let msg = '📊 የማሽነሪ አከራዮች ሪፖርት፦\n\n';
        items.forEach((item, idx) => {
            msg += `${idx + 1}. አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   አድራሻ: ${item.address}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? '✅ አለ' : '❌ የለም'}\n────────────────\n`;
        });
        await ctx.answerCbQuery();
        ctx.reply(msg); 
    } catch(e) { console.error(e); ctx.answerCbQuery('ስህተት አጋጥሟል'); }
});

bot.action('rep_searches', async (ctx) => {
    try {
        const logs = await SearchLog.find({}).sort({ createdAt: -1 }).limit(30).lean();
        if (logs.length === 0) {
            await ctx.answerCbQuery();
            return ctx.reply('🔍 እስካሁን ምንም የፍለጋ ታሪክ አልተመዘገበም።');
        }
        let msg = '🔍 የፈላጊዎች ፍላጎት ሪፖርት (የመጨረሻዎቹ 30)፦\n\n';
        logs.forEach((log, idx) => {
            msg += `${idx + 1}. ዘርፍ: ${log.category}\n   የፈለገው: ${log.searchedFor}\n   የፈላጊው ስልክ: ${log.phone}\n   ቀን: ${new Date(log.createdAt).toLocaleDateString('en-US')}\n────────────────\n`;
        });
        await ctx.answerCbQuery();
        ctx.reply(msg); 
    } catch(e) { console.error(e); ctx.answerCbQuery('ስህተት አጋጥሟል'); }
});

bot.action('rep_actives', async (ctx) => {
    try {
        const todayStr = getTodayDateString();
        const logs = await ActiveLog.find({ dateStr: todayStr }).sort({ createdAt: -1 }).lean();
        if (logs.length === 0) {
            await ctx.answerCbQuery();
            return ctx.reply(`📅 ዛሬ (${todayStr}) ሁኔታቸውን Active ያደረጉ ተጠቃሚዎች የሉም።`);
        }
        let msg = `📅 የዛሬ (${todayStr}) የActive ተጠቃሚዎች ሪፖርት፦\n\n`;
        logs.forEach((log, idx) => {
            msg += `${idx + 1}. ስም: ${log.name}\n   ዘርፍ: ${log.category}\n   ዝርዝር: ${log.detail}\n   ሰዓት: ${new Date(log.createdAt).toLocaleTimeString('en-US')}\n────────────────\n`;
        });
        await ctx.answerCbQuery();
        ctx.reply(msg); 
    } catch(e) { console.error(e); ctx.answerCbQuery('ስህተት አጋጥሟል'); }
});

// አድሚን ማጥፊያ (Delete Menu) 
bot.action('admin_delete_menu', async (ctx) => {
    const delMenu = Markup.inlineKeyboard([
        [Markup.button.callback('🧱 ሲሚንቶ አጥፋ', 'adm_manage_cement')],
        [Markup.button.callback('🚚 መኪና አጥፋ', 'adm_manage_truck')],
        [Markup.button.callback('🟥 ብረት አጥፋ', 'adm_manage_steel')],
        [Markup.button.callback('🔹 ማሽነሪ አጥፋ', 'adm_manage_machinery')]
    ]);
    await ctx.answerCbQuery();
    ctx.reply('ማስተዳደር (ማጥፋት) የሚፈልጉትን ዘርፍ ይምረጡ፦', delMenu);
});

bot.action('adm_manage_cement', async (ctx) => {
    await CementSeller.deleteMany({});
    await ctx.answerCbQuery('የሲሚንቶ መረጃዎች ጠፍተዋል', { show_alert: true });
    ctx.reply('✅ የሲሚንቶ መረጃዎች ሙሉ በሙሉ ጠፍተዋል።');
});
bot.action('adm_manage_truck', async (ctx) => {
    await TruckLeasor.deleteMany({});
    await ctx.answerCbQuery('የመኪና መረጃዎች ጠፍተዋል', { show_alert: true });
    ctx.reply('✅ የመኪና መረጃዎች ሙሉ በሙሉ ጠፍተዋል።');
});
bot.action('adm_manage_steel', async (ctx) => {
    await SteelSeller.deleteMany({});
    await ctx.answerCbQuery('የብረት መረጃዎች ጠፍተዋል', { show_alert: true });
    ctx.reply('✅ የብረት መረጃዎች ሙሉ በሙሉ ጠፍተዋል።');
});
bot.action('adm_manage_machinery', async (ctx) => {
    await MachineryLeasor.deleteMany({});
    await ctx.answerCbQuery('የማሽነሪ መረጃዎች ጠፍተዋል', { show_alert: true });
    ctx.reply('✅ የማሽነሪ መረጃዎች ሙሉ በሙሉ ጠፍተዋል።');
});

// --- 🧱 የውስጥ መስመር በተኖች ምላሾች (Inline Handlers) ---

// የመኪና አከራይ በተኖች
bot.action('truck_new_reg', async (ctx) => {
    ctx.session.action = 'REG_TRUCK_1';
    ctx.session.truckData = {};
    await ctx.answerCbQuery();
    ctx.reply('ለመመዝገብ የመኪናውን አይነት ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
});
bot.action(/^tr_act_(.+)$/, async (ctx) => {
    await TruckLeasor.findByIdAndUpdate(ctx.match[1], { status: 'active' });
    await ctx.answerCbQuery('✅ መኪናው ወደ ዝግጁ (Active) ተቀይሯል');
    ctx.reply('✅ መኪናዎ አሁን ስራ ለመጀመር ዝግጁ ነው! 🟢');
});
bot.action(/^tr_off_(.+)$/, async (ctx) => {
    await TruckLeasor.findByIdAndUpdate(ctx.match[1], { status: 'inactive' });
    await ctx.answerCbQuery('🔴 መኪናው ስራ ላይ እንደሆነ ተመዝግቧል');
    ctx.reply('🔴 መኪናዎ ስራ ላይ እንደሆነ ተመዝግቧል::');
});
bot.action(/^tr_route_(.+)$/, async (ctx) => {
    ctx.session.action = 'UPDATE_TRUCK_ROUTE';
    ctx.session.targetTruckId = ctx.match[1];
    await ctx.answerCbQuery();
    ctx.reply('አዲሱን የጉዞ መስመር ያስገቡ (ምሳሌ፡ አዲስ አበባ - ደሴ)፡');
});

// የሲሚንቶ ሻጭ በተኖች
const cementSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'cement_active'), Markup.button.callback('❌ የለም', 'cement_off')],
    [Markup.button.callback('💰 ዋጋ ማሻሻያ', 'cement_update_price')]
]);
bot.action('cement_active', async (ctx) => {
    await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    await ctx.answerCbQuery('✅ ሁኔታዎ ተቀይሯል');
    ctx.reply('የሲሚንቶ ሁኔታዎ ወደ "✅ አለ" ተቀይሯል!');
});
bot.action('cement_off', async (ctx) => {
    await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'inactive' });
    await ctx.answerCbQuery('❌ ሁኔታዎ ተቀይሯል');
    ctx.reply('የሲሚንቶ ሁኔታዎ ወደ "❌ የለም" ተቀይሯል!');
});
bot.action('cement_update_price', async (ctx) => {
    ctx.session.action = 'UPDATE_CEMENT_PRICE';
    await ctx.answerCbQuery();
    ctx.reply('አዲሱን የሲሚንቶ ዋጋ ያስገቡ፡');
});

// የብረት ሻጭ በተኖች
const steelSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'steel_active'), Markup.button.callback('❌ የለም', 'steel_off')],
    [Markup.button.callback('💰 ዋጋ ማሻሻያ', 'steel_update_price')]
]);
bot.action('steel_active', async (ctx) => {
    await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    await ctx.answerCbQuery('✅ ሁኔታዎ ተቀይሯል');
    ctx.reply('የብረት ሁኔታዎ ወደ "✅ አለ" ተቀይሯል!');
});
bot.action('steel_off', async (ctx) => {
    await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'inactive' });
    await ctx.answerCbQuery('❌ ሁኔታዎ ተቀይሯል');
    ctx.reply('የብረት ሁኔታዎ ወደ "❌ የለም" ተቀይሯል!');
});
bot.action('steel_update_price', async (ctx) => {
    ctx.session.action = 'UPDATE_STEEL_PRICE';
    await ctx.answerCbQuery();
    ctx.reply('አዲሱን የብረት ዋጋ ያስገቡ፡');
});

// የማሽነሪ አከራይ በተኖች
const machineryLeasorInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'machinery_active'), Markup.button.callback('❌ የለም', 'machinery_off')]
]);
bot.action('machinery_active', async (ctx) => {
    await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    await ctx.answerCbQuery('✅ ሁኔታዎ ተቀይሯል');
    ctx.reply('የማሽነሪ ሁኔታዎ ወደ "✅ አለ" ተቀይሯል!');
});
bot.action('machinery_off', async (ctx) => {
    await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'inactive' });
    await ctx.answerCbQuery('❌ ሁኔታዎ ተቀይሯል');
    ctx.reply('የማሽነሪ ሁኔታዎ ወደ "❌ የለም" ተቀይሯል!');
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
            ctx.session.cementData = ctx.session.cementData || {};
            ctx.session.cementData.location = text;
            ctx.session.action = 'REG_CEMENT_3';
            ctx.reply('3. የድርጅቱ ስም ያስገቡ፡');
        } else if (action === 'REG_CEMENT_3') {
            ctx.session.cementData = ctx.session.cementData || {};
            ctx.session.cementData.companyName = text;
            ctx.session.action = 'REG_CEMENT_4';
            ctx.reply('4. ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'REG_CEMENT_4') {
            ctx.session.cementData = ctx.session.cementData || {};
            ctx.session.cementData.phone = text;
            ctx.session.cementData.userId = userId;
            ctx.session.cementData.price = 1300; 
            ctx.session.cementData.status = 'active';
            await CementSeller.findOneAndUpdate({ userId }, ctx.session.cementData, { upsert: true });
            await ActiveLog.create({ userId, name: ctx.from.first_name || 'ተጠቃሚ', category: '🧱 ሲሚንቶ ሻጭ', detail: ctx.session.cementData.companyName, dateStr: getTodayDateString() });
            ctx.session.action = null;
            ctx.reply('መረጃዎ በትክክል ተመዝግቧል!', cementSellerInline);
        }
        else if (action === 'UPDATE_CEMENT_PRICE') {
            await CementSeller.findOneAndUpdate({ userId }, { price: Number(text) });
            ctx.reply(`የሲሚንቶ ዋጋ ወደ ${text} ብር በተሳካ ሁኔታ ተሻሽሏል!`);
            ctx.session.action = null;
        }
        else if (action === 'BUY_CEMENT_1') {
            ctx.session.buyCement = { type: text };
            ctx.session.action = 'BUY_CEMENT_2';
            ctx.reply('2. አድራሻ ያስገቡ፡');
        } else if (action === 'BUY_CEMENT_2') {
            ctx.session.buyCement = ctx.session.buyCement || {};
            ctx.session.buyCement.address = text;
            ctx.session.action = 'BUY_CEMENT_3';
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'BUY_CEMENT_3') {
            ctx.session.buyCement = ctx.session.buyCement || {};
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
        }
        else if (action === 'REG_TRUCK_1') {
            ctx.session.truckData = { type: text };
            ctx.session.action = 'REG_TRUCK_2';
            ctx.reply('የመኪናው ታርጋ ያስገቡ፡');
        } else if (action === 'REG_TRUCK_2') {
            ctx.session.truckData = ctx.session.truckData || {};
            ctx.session.truckData.plate = text;
            ctx.session.action = 'REG_TRUCK_3';
            ctx.reply('የጉዞ መስመር ያስገቡ (ምሳሌ፡ ሀዋሳ አዳማ)፡');
        } else if (action === 'REG_TRUCK_3') {
            ctx.session.truckData = ctx.session.truckData || {};
            ctx.session.truckData.route = text;
            ctx.session.action = 'REG_TRUCK_4';
            ctx.reply('ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'REG_TRUCK_4') {
            ctx.session.truckData = ctx.session.truckData || {};
            ctx.session.truckData.phone = text;
            ctx.session.truckData.userId = userId;
            ctx.session.truckData.status = 'active';
            ctx.session.truckData.rentedCount = 0; 
            await TruckLeasor.findOneAndUpdate({ userId: userId, plate: ctx.session.truckData.plate }, ctx.session.truckData, { upsert: true });
            await ActiveLog.create({ userId, name: ctx.from.first_name || 'ተጠቃሚ', category: '🚚 መኪና አከራይ', detail: `ታርጋ: ${ctx.session.truckData.plate}`, dateStr: getTodayDateString() });
            ctx.session.action = null;
            ctx.reply('መኪናዎ በትክክል ተመዝግቧል! ፈላጊ ሲኖር እናሳቆታለን።');
        }
        else if (action === 'UPDATE_TRUCK_ROUTE') {
            const truckId = ctx.session.targetTruckId;
            if (truckId) {
                await TruckLeasor.findByIdAndUpdate(truckId, { route: text });
                ctx.reply(`የመኪናዎ የጉዞ መስመር ወደ [ ${text} ] በተሳካ ሁኔታ ተቀይሯል!`);
            } else {
                ctx.reply('የተመረጠ መኪና አልተገኘም፣ እባክዎ እንደገና ይሞክሩ።');
            }
            ctx.session.action = null;
            ctx.session.targetTruckId = null;
        }
        else if (action === 'RENT_TRUCK_1') {
            ctx.session.rentTruck = { type: text };
            ctx.session.action = 'RENT_TRUCK_2';
            ctx.reply('2. የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከአዲስ አበባ ጎንደር)፡');
        } else if (action === 'RENT_TRUCK_2') {
            ctx.session.rentTruck = ctx.session.rentTruck || {};
            ctx.session.rentTruck.route = text;
            ctx.session.action = 'RENT_TRUCK_3';
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'RENT_TRUCK_3') {
            ctx.session.rentTruck = ctx.session.rentTruck || {};
            ctx.session.rentTruck.phone = text; 
            await SearchLog.create({ userId, username: ctx.from.username || 'N/A', category: '🚚 መኪና ፈላጊ', searchedFor: `አይነት: ${ctx.session.rentTruck.type}, መስመር: ${ctx.session.rentTruck.route}`, phone: text });

            const userRoute = ctx.session.rentTruck.route || "";
            const cleanRoute = userRoute.toLowerCase();
            // ✅ ጥገና: የጎንደር ስፔሊንግ ልዩነቶችን ጨምሮ Route ብቻ ፈልጓል (type filter ተወግዷል)
            let searchRegex = (cleanRoute.includes("gondar") || cleanRoute.includes("ጎንደር") || cleanRoute.includes("gondr") || cleanRoute.includes("gonder")) 
                ? new RegExp("(gondar|ጎንደር|gondr|gonder)", "i") 
                : createSearchRegex(userRoute);

            const foundTruck = await TruckLeasor.findOne({ route: searchRegex, status: 'active' }).sort({ rentedCount: 1, _id: 1 }); 
            if (foundTruck) {
                ctx.reply(`የሚፈልጉት መኪና ይገኛል!\nየመኪናው አይነት፡ ${foundTruck.type}\nታርጋ ቁጥር፡ ${foundTruck.plate}\nለማዘዝ በ 0960336138 ይደውሉልን`);
                await TruckLeasor.findByIdAndUpdate(foundTruck._id, { $set: { rentedCount: (foundTruck.rentedCount || 0) + 1 } });
            } else {
                ctx.reply('በዚህ የጉዞ መስመር የሚጓዝ መኪና መረጃ እስካሁን አልደረሰንም መረጃው እንደደረሰን እንደውላለን');
            }
            ctx.session.action = null;
        }
        // ✅ ጥገና: REG_MACHINERY ሙሉ flow (ቀደም ሲል አልነበረም)
        else if (action === 'REG_MACHINERY_1') {
            ctx.session.machineryData = { type: text };
            ctx.session.action = 'REG_MACHINERY_2';
            ctx.reply('2. ያሉበት አድራሻ ያስገቡ፡');
        } else if (action === 'REG_MACHINERY_2') {
            ctx.session.machineryData = ctx.session.machineryData || {};
            ctx.session.machineryData.address = text;
            ctx.session.action = 'REG_MACHINERY_3';
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'REG_MACHINERY_3') {
            ctx.session.machineryData = ctx.session.machineryData || {};
            ctx.session.machineryData.phone = text;
            ctx.session.action = 'REG_MACHINERY_4';
            ctx.reply('4. ዋጋ ያስገቡ (በቀን ወይም በሰዓት)፡');
        } else if (action === 'REG_MACHINERY_4') {
            ctx.session.machineryData = ctx.session.machineryData || {};
            ctx.session.machineryData.price = text;
            ctx.session.machineryData.userId = userId;
            ctx.session.machineryData.status = 'active';
            await MachineryLeasor.findOneAndUpdate({ userId }, ctx.session.machineryData, { upsert: true });
            await ActiveLog.create({ userId, name: ctx.from.first_name || 'ተጠቃሚ', category: '🔹 ማሽነሪ አከራይ', detail: ctx.session.machineryData.type, dateStr: getTodayDateString() });
            ctx.session.action = null;
            ctx.reply('የማሽነሪ መረጃዎ በተሳካ ሁኔታ ተመዝግቧል!', machineryLeasorInline);
        }
        // ✅ ጥገና: RENT_MACHINERY ሙሉ flow (ቀደም ሲል አልነበረም)
        else if (action === 'RENT_MACHINERY_1') {
            ctx.session.rentMachinery = { type: text };
            ctx.session.action = 'RENT_MACHINERY_2';
            ctx.reply('2. ያለበት አካባቢ/ቦታ ያስገቡ፡');
        } else if (action === 'RENT_MACHINERY_2') {
            ctx.session.rentMachinery = ctx.session.rentMachinery || {};
            ctx.session.rentMachinery.address = text;
            ctx.session.action = 'RENT_MACHINERY_3';
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'RENT_MACHINERY_3') {
            ctx.session.rentMachinery = ctx.session.rentMachinery || {};
            ctx.session.rentMachinery.phone = text;
            await SearchLog.create({ userId, username: ctx.from.username || 'N/A', category: '🔹 ማሽነሪ ፈላጊ', searchedFor: `አይነት: ${ctx.session.rentMachinery.type}, አካባቢ: ${ctx.session.rentMachinery.address}`, phone: text });
            const typeRegex = createSearchRegex(ctx.session.rentMachinery.type);
            const foundMachinery = await MachineryLeasor.findOne({ type: typeRegex, status: 'active' }).lean();
            if (foundMachinery) {
                ctx.reply(`የሚፈልጉት ማሽነሪ ይገኛል!\nየማሽነሪው አይነት፡ ${foundMachinery.type}\nዋጋ፡ ${foundMachinery.price}\nለማዘዝ በ 0960336138 ይደውሉልን`);
            } else {
                ctx.reply('በዚህ ጊዜ የጠየቁት ማሽነሪ አልተገኘም፣ መረጃ ሲኖረን እናሳውቀዎታለን።');
            }
            ctx.session.action = null;
        }
        else if (action === 'REG_STEEL_1') {
            ctx.session.steelData = { type: text };
            ctx.session.action = 'REG_STEEL_2'; 
            ctx.reply('2. ያሉበት አድራሻ ያስገቡ፡');
        } else if (action === 'REG_STEEL_2') {
            ctx.session.steelData = ctx.session.steelData || {};
            ctx.session.steelData.address = text;
            ctx.session.action = 'REG_STEEL_3'; 
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'REG_STEEL_3') {
            ctx.session.steelData = ctx.session.steelData || {};
            ctx.session.steelData.phone = text;
            ctx.session.action = 'REG_STEEL_4'; 
            ctx.reply('4. ዋጋ ያስገቡ፡');
        } else if (action === 'REG_STEEL_4') {
            ctx.session.steelData = ctx.session.steelData || {};
            ctx.session.steelData.price = text;
            ctx.session.steelData.userId = userId;
            ctx.session.steelData.status = 'active';
            await SteelSeller.findOneAndUpdate({ userId }, ctx.session.steelData, { upsert: true });
            await ActiveLog.create({ userId, name: ctx.from.first_name || 'ተጠቃሚ', category: '🟥 ብረት ሻጭ', detail: ctx.session.steelData.type, dateStr: getTodayDateString() });
            ctx.session.action = null;
            ctx.reply('የብረት መረጃዎ በተሳካ ሁኔታ ተመዝግቧል!', steelSellerInline);
        }
        else if (action === 'UPDATE_STEEL_PRICE') {
            await SteelSeller.findOneAndUpdate({ userId }, { price: text });
            ctx.reply(`የብረት ዋጋዎ ወደ ${text} ብር ተሻሽሏል!`);
            ctx.session.action = null;
        }
        else if (action === 'BUY_STEEL_1') {
            ctx.session.buySteel = { type: text };
            ctx.session.action = 'BUY_STEEL_2';
            ctx.reply('2. አድራሻ ያስገቡ፡');
        } else if (action === 'BUY_STEEL_2') {
            ctx.session.buySteel = ctx.session.buySteel || {};
            ctx.session.buySteel.address = text;
            ctx.session.action = 'BUY_STEEL_3';
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'BUY_STEEL_3') {
            ctx.session.buySteel = ctx.session.buySteel || {};
            ctx.session.buySteel.phone = text;
            
            await SearchLog.create({ userId, username: ctx.from.username || 'N/A', category: '🟥 ብረት ፈላጊ', searchedFor: `አይነት: ${ctx.session.buySteel.type}, አድራሻ: ${ctx.session.buySteel.address}`, phone: text });

            const searchRegex = createSearchRegex(ctx.session.buySteel.type);
            const available = await SteelSeller.findOne({ type: searchRegex, status: 'active' }).lean();
            if (available) {
                ctx.reply(`የጠየቁት የብረት አይነት ይገኛል\nየአሁን ዋጋ፡ ${available.price} ብር\nበ 0960336138 ደውለው ማዘዝ ይችላሉ`);
            } else {
                ctx.reply('ይቅርታ የጠየቁት የብረት አይነት ለዛሬ የለም ሲኖር እናሳውቀዎታለን');
            }
            ctx.session.action = null;
        }
    } catch (error) {
        console.error("❌ በሜሴጅ ሎጂክ ላይ ስህተት አጋጥሟል:", error);
        ctx.reply('ይቅርታ፣ ሲስተሙ ላይ ስህተት አጋጥሟል:: እባክዎ እንደገና ይሞክሩ::').catch(e => console.error(e));
        ctx.session.action = null; 
    }
});

// --- 🛡️ ግሎባል የኤረር መከላከያ (Global Error Handler) ---
bot.catch((err, ctx) => {
    console.error(`❌ ግሎባል ስህተት (Update Type: ${ctx.updateType}):`, err);
});

// ስህተት ሲፈጠር ቦቱ መስራት እንዳያቆም የሚከላከል
process.on('uncaughtException', (err) => {
    console.error('🛑 Uncaught Exception (App will not crash):', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🛑 Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- 🌐 Render Keep-Alive Server ---
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot is running perfectly on Render!");
}).listen(PORT, '0.0.0.0', () => {
    console.log(`✅ የድረ-ገጽ ሰርቨር በፖርት ${PORT} ላይ እየሰራ ነው (Render Keep-Alive)`);
});

// --- 🚀 ቦቱን ማስጀመር (Launch Bot) ---
bot.launch({ dropPendingUpdates: true })
  .then(() => console.log('🤖 ቦቱ በተሳካ ሁኔታ ስራ ጀምሯል!'))
  .catch(err => console.error('❌ ቦቱን በማስጀመር ላይ ስህተት:', err));

// --- 🛑 Graceful Stop ---
process.once('SIGINT', async () => {
    console.log('🛑 ቦቱ እየተዘጋ ነው (SIGINT)...');
    await mongoose.connection.close(); 
    bot.stop('SIGINT');
});
process.once('SIGTERM', async () => {
    console.log('🛑 ቦቱ እየተዘጋ ነው (SIGTERM)...');
    await mongoose.connection.close(); 
    bot.stop('SIGTERM');
}); 
