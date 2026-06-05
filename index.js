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
    .then(() => console.log("ማንጎ ዲቢ ዳታቤዝ በተሳካ ሁኔታ ተገናኝቷል!"))
    .catch(err => console.error("የዳታቤዝ ግንኙነት ስህተት:", err));

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

const BotSession = mongoose.model('BotSession', new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    data: { type: Object, default: {} }
}));

const bot = new Telegraf(BOT_TOKEN);

// 🔄 የሴሽን መደባлеቅን የሚፈታው Custom MongoDB Session Middleware
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    
    const sessionKey = `${ctx.from.id}:${ctx.from.id}`;
    let sessionDoc = await BotSession.findOne({ key: sessionKey });
    if (!sessionDoc) {
        sessionDoc = await BotSession.create({ key: sessionKey, data: {} });
    }
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

// ========================================================
// 👑 🔥 የአድሚን መቆጣጠሪያ ፓናል (Admin Panel) ክፍል 🔥 👑
// ========================================================
bot.command('admin_panel', async (ctx) => {
    if (ctx.from.id !== 7423347375) {
        return ctx.reply('ይቅርታ፣ ይህንን የአድሚን ትዕዛዝ ለመጠቀም ፈቃድ የለዎትም!');
    }
    ctx.session = ctx.session || {};
    ctx.session.action = null;
    
    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('📊 ሲሚንቶ ሪፖርት', 'rep_cement'), Markup.button.callback('📊 መኪና ሪፖርት', 'rep_truck')],
        [Markup.button.callback('📊 ብረት ሪፖርት', 'rep_steel'), Markup.button.callback('📊 ማሽነሪ ሪፖርት', 'rep_machinery')],
        [Markup.button.callback('❌ ማጥፊያ ፓናል', 'admin_delete_menu')]
    ]);
    ctx.reply('👑 እንኳን ወደ አድሚን ፓናል በሰላም መጡ። ማየት ወይንም ማጥፋት የሚፈልጉትን ይምረጡ፦', adminMenu);
});

// --- 📊 የአድሚን ሪፖርት ማሳያ ክፍል ---
bot.action('rep_cement', async (ctx) => {
    const items = await CementSeller.find({});
    if (items.length === 0) return ctx.reply('🧱 ምንም የተመዘገበ የሲሚንቶ ሻጭ የለም።');
    let msg = '📊 የሲሚንቶ ሻጮች ሪፖርት፦\n\n';
    items.forEach((item, idx) => {
        msg += `${idx + 1}. ድርጅት: ${item.companyName || 'N/A'}\n   አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   ቦታ: ${item.location}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? '✅ አለ' : '❌ የለም'}\n────────────────\n`;
    });
    ctx.reply(msg); ctx.answerCbQuery();
});

bot.action('rep_truck', async (ctx) => {
    const items = await TruckLeasor.find({});
    if (items.length === 0) return ctx.reply('🚚 ምንም የተመዘገበ መኪና የለም።');
    let msg = '📊 የመኪና አከራዮች ሪፖርት፦\n\n';
    items.forEach((item, idx) => {
        msg += `${idx + 1}. ታርጋ: ${item.plate}\n   አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   መስመር: ${item.route}\n   ሁኔታ: ${item.status === 'active' ? '🟢 ዝግጁ' : '🔴 ስራ ላይ'}\n────────────────\n`;
    });
    ctx.reply(msg); ctx.answerCbQuery();
});

bot.action('rep_steel', async (ctx) => {
    const items = await SteelSeller.find({});
    if (items.length === 0) return ctx.reply('🟥 ምንም የተመዘገበ የብረት ሻጭ የለም።');
    let msg = '📊 የብረት ሻጮች ሪፖርት፦\n\n';
    items.forEach((item, idx) => {
        msg += `${idx + 1}. አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   አድራሻ: ${item.address}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? '✅ አለ' : '❌ የለም'}\n────────────────\n`;
    });
    ctx.reply(msg); ctx.answerCbQuery();
});

bot.action('rep_machinery', async (ctx) => {
    const items = await MachineryLeasor.find({});
    if (items.length === 0) return ctx.reply('🔹 ምንም የተመዘገበ ማሽነሪ የለም።');
    let msg = '📊 የማሽነሪ አከራዮች ሪፖርት፦\n\n';
    items.forEach((item, idx) => {
        msg += `${idx + 1}. አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   አድራሻ: ${item.address}\n   ዋጋ: ${item.price}\n   ሁኔታ: ${item.status === 'active' ? '✅ አለ' : '❌ የለም'}\n────────────────\n`;
    });
    ctx.reply(msg); ctx.answerCbQuery();
});

bot.action('admin_delete_menu', (ctx) => {
    const delMenu = Markup.inlineKeyboard([
        [Markup.button.callback('🧱 ሲሚንቶ አጥፋ', 'adm_manage_cement')],
        [Markup.button.callback('🚚 መኪና አጥፋ', 'adm_manage_truck')],
        [Markup.button.callback('🟥 ብረት አጥፋ', 'adm_manage_steel')],
        [Markup.button.callback('🔹 ማሽነሪ አጥፋ', 'adm_manage_machinery')]
    ]);
    ctx.reply('ማስተዳደር (ማጥፋት) የሚፈልጉትን ዘርፍ ይምረጡ፦', delMenu);
    ctx.answerCbQuery();
});

// --- 🧱 የተዋሃዱ የቁልፍ ሰሌዳ በተኖች ---
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

// --- 🧱 ሲሚንቶ ክፍል ---
bot.hears('🧱 ሲሚንቶ ለመሸጥ', async (ctx) => {
    ctx.session.action = null; 
    const existing = await CementSeller.findOne({ userId: ctx.from.id });
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

// --- 🚚 መኪና ለማከራየት (የታረመና ፅዱ አቀማመጥ) ---
bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    ctx.session.action = null;
    const myTrucks = await TruckLeasor.find({ userId: ctx.from.id });
    const name = ctx.from.first_name || 'ተጠቃሚ';
    
    if (myTrucks.length > 0) {
        let buttons = [];
        myTrucks.forEach(t => {
            // 🛑 ማሻሻያ፡ ከተርጋው ጎን የነበሩት [🔴 ስራ ላይ] ወይም [🟢 ዝግጁ] የሚሉ ፅሁፎች ሙሉ በሙሉ ጠፍተዋል
            buttons.push([Markup.button.callback(`🇪🇹 ታርጋ፡ ${t.plate} (${t.type})`, 'none')]);
            
            // ከታች ያሉት መደበኛ መቆጣጠሪያ በተኖች ግን በስራቸው ይቆያሉ
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

// --- 🟥 ብረት ክፍል ---
bot.hears('🟥 ብረት ለመሸጥ', async (ctx) => {
    ctx.session.action = null;
    const existing = await SteelSeller.findOne({ userId: ctx.from.id });
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

// --- 🔹 ማሽነሪ ክፍል ---
bot.hears('🔹 ማሽነሪ ለማከራየት', async (ctx) => {
    ctx.session.action = null;
    const existing = await MachineryLeasor.findOne({ userId: ctx.from.id });
    const name = ctx.from.first_name || 'ተጠቃሚ';
    
    if (existing) {
        ctx.reply(`እንኳን ደህና መጡ ${name}!\n\nየአሁኑ ሁኔታዎ፦ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nእባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ፦`, machineryLeasorInline);
    } else {
        ctx.session.action = 'REG_MACHINERY_1';
        ctx.reply(`እንኳን ደህና መጡ! ለመጠቀም እባክዎ መጀመሪያ ይመዝገቡ።\n\n1. የማሽነሪው አይነት ያስገቡ፡`);
    }
});

bot.hears('🔹 ማሽነሪ ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_MACHINERY_1';
    ctx.reply('1. የሚፈልጉት የማሽነሪ አይነት ያስገቡ፡');
});

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

// --- 💬 የፅሁፍ መልዕክቶች ማቀናበሪያ (Text Handler) ---
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return next();

    const action = ctx.session.action;
    const userId = ctx.from.id;
    if (!action) return;

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
        ctx.session.action = null;
        ctx.reply('መረጃዎ በትክክል ተመዝግቧል! አሁን እርስዎ በተሳካ ሁኔታ ተመዝግበዋል።', cementSellerInline);
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
        const searchRegex = createSearchRegex(ctx.session.buyCement.type);
        const available = await CementSeller.findOne({ type: searchRegex, status: 'active' });
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
        const userRoute = ctx.session.rentTruck.route || "";
        const cleanRoute = userRoute.toLowerCase();
        let searchRegex = (cleanRoute.includes("gondar") || cleanRoute.includes("ጎንደር") || cleanRoute.includes("gondr") || cleanRoute.includes("gonder")) ? new RegExp("(gondar|ጎንደር|gondr|gonder)", "i") : createSearchRegex(userRoute);
        const typeRegex = createSearchRegex(ctx.session.rentTruck.type);

        const foundTruck = await TruckLeasor.findOne({ type: typeRegex, route: searchRegex, status: 'active' }).sort({ rentedCount: 1, _id: 1 }); 
        if (foundTruck) {
            ctx.reply(`የሚፈልጉት መኪና ይገኛል!\nየመኪናው አይነት፡ ${foundTruck.type}\nታርጋ ቁጥር፡ ${foundTruck.plate}\nለማዘዝ በ 0960336138 ይደውሉልን`);
            await TruckLeasor.findByIdAndUpdate(foundTruck._id, { $set: { rentedCount: (foundTruck.rentedCount || 0) + 1 } });
        } else {
            ctx.reply('በዚህ የጉዞ መስመር የሚጓዝ መኪና መረጃ እስካሁን አልደረሰንም መረጃው እንደደረሰን እንደውላለን');
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
        ctx.reply('2. ያሉበት ቦታ(አድራሻ) ያስገቡ፡');
    } else if (action === 'BUY_STEEL_2') {
        ctx.session.buySteel = ctx.session.buySteel || {};
        ctx.session.buySteel.address = text;
        ctx.session.action = 'BUY_STEEL_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'BUY_STEEL_3') {
        ctx.session.buySteel = ctx.session.buySteel || {};
        ctx.session.buySteel.phone = text;
        const searchRegex = createSearchRegex(ctx.session.buySteel.type);
        const available = await SteelSeller.findOne({ type: searchRegex, status: 'active' });
        if (available) {
            ctx.reply('የጠየቁት የብረት አይነቶች እኛ ጋር ይገኛሉ ለማዘዝ በ 0960336138 ይደውሉልን');
        } else {
            ctx.reply('ይቅርታ የጠየቁት የብረት አይነት እኛ ጋር ለጊዜው የለም');
        }
        ctx.session.action = null;
    }
    else if (action === 'REG_MACHINERY_1') {
        ctx.session.machineryData = { type: text };
        ctx.session.action = 'REG_MACHINERY_2'; 
        ctx.reply('2. የሚገኝበት አድራሻ ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_2') {
        ctx.session.machineryData = ctx.session.machineryData || {};
        ctx.session.machineryData.address = text;
        ctx.session.action = 'REG_MACHINERY_3'; 
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_3') {
        ctx.session.machineryData = ctx.session.machineryData || {};
        ctx.session.machineryData.phone = text;
        ctx.session.machineryData.userId = userId;
        ctx.session.action = 'REG_MACHINERY_4'; 
        ctx.reply('4. የማሽነሪው የኪራይ ዋጋ ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_4') {
        ctx.session.machineryData = ctx.session.machineryData || {};
        ctx.session.machineryData.price = text;
        ctx.session.machineryData.status = 'active';
        await MachineryLeasor.findOneAndUpdate({ userId }, ctx.session.machineryData, { upsert: true });
        ctx.session.action = null;
        ctx.reply('ማሽነሪዎ በትክክል ተመዝግቧል!', machineryLeasorInline);
    }
    else if (action === 'RENT_MACHINERY_1') {
        ctx.session.rentMachinery = { type: text };
        ctx.session.action = 'RENT_MACHINERY_2';
        ctx.reply('2. ያሉበት አድራሻ ያስገቡ፡');
    } else if (action === 'RENT_MACHINERY_2') {
        ctx.session.rentMachinery = ctx.session.rentMachinery || {};
        ctx.session.rentMachinery.address = text;
        ctx.session.action = 'RENT_MACHINERY_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'RENT_MACHINERY_3') {
        ctx.session.rentMachinery = ctx.session.rentMachinery || {};
        ctx.session.rentMachinery.phone = text; 
        const searchRegex = createSearchRegex(ctx.session.rentMachinery.type);
        const available = await MachineryLeasor.findOne({ type: searchRegex, status: 'active' });
        if (available) {
            ctx.reply('የጠየቁት የማሽነሪ አይነት እኛ ጋር ይገኛል ማሽነሪውን ለመከራየት በ0960336138 ይደውሉልን');
        } else {
            ctx.reply('ይቅርታ የጠየቁት የማሽነሪ አይነት እኛ ጋር አይገኝም');
        }
        ctx.session.action = null;
    }
});

// --- 🔘 የውስጥ በተኖች አሠራር ---
bot.action('cement_active', async (ctx) => { await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' }); ctx.reply('ሁኔታዎ ወደ [✅ አለ] ተቀይሯል።'); ctx.answerCbQuery(); });
bot.action('cement_off', async (ctx) => { await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' }); ctx.reply('ሁኔታዎ ወደ [❌ የለም] ተቀይሯል።'); ctx.answerCbQuery(); });
bot.action('cement_update_price', (ctx) => { ctx.session.action = 'UPDATE_CEMENT_PRICE'; ctx.reply('አዲሱን የአንድ ኩንታል ዋጋ ያስገቡ፡'); ctx.answerCbQuery(); });
bot.action('truck_new_reg', (ctx) => { ctx.session.action = 'REG_TRUCK_1'; ctx.session.truckData = {}; ctx.reply('ለመመዝገብ የመኪናውን አይነት ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡'); ctx.answerCbQuery(); });

bot.action(/^tr_act_(.+)$/, async (ctx) => { await TruckLeasor.findByIdAndUpdate(ctx.match, { status: 'active' }); ctx.reply('የመኪናው ሁኔታ ወደ [🟢 ዝግጁ] ተቀይሯል።'); ctx.answerCbQuery(); });
bot.action(/^tr_off_(.+)$/, async (ctx) => { await TruckLeasor.findByIdAndUpdate(ctx.match, { status: 'off' }); ctx.reply('የመኪናው ሁኔታ ወደ [🔴 ስራ ላይ] ተቀይሯል።'); ctx.answerCbQuery(); });
bot.action(/^tr_route_(.+)$/, (ctx) => { ctx.session.action = 'UPDATE_TRUCK_ROUTE'; ctx.session.targetTruckId = ctx.match; ctx.reply('እባክዎ አዲሱን የመኪናውን የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከአዲስ አበባ ናዝሬት)፦'); ctx.answerCbQuery(); });

bot.action('steel_active', async (ctx) => { await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' }); ctx.reply('የብረት ምርትዎ ዝግጁ ተደርጓል።'); ctx.answerCbQuery(); });
bot.action('steel_off', async (ctx) => { await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' }); ctx.reply('የብረት ምርትዎ [የለም] ተደርጓል።'); ctx.answerCbQuery(); });
bot.action('steel_update_price', (ctx) => { ctx.session.action = 'UPDATE_STEEL_PRICE'; ctx.reply('አዲሱን የብረት ዋጋ ያስገቡ፡'); ctx.answerCbQuery(); });

bot.action('machinery_active', async (ctx) => { await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' }); ctx.reply('ማሽነሪዎ ዝግጁ ተደርጓል።'); ctx.answerCbQuery(); });
bot.action('machinery_off', async (ctx) => { await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' }); ctx.reply('ማሽነሪዎ [የለም] ተደርጓል።'); ctx.answerCbQuery(); });

// --- ❌ አድሚን ማስተዳደሪያ ማጥፊያዎች ---
bot.action('adm_manage_cement', async (ctx) => {
    const sellers = await CementSeller.find({}); if (sellers.length === 0) return ctx.reply('🧱 ምንም የለም።');
    const buttons = sellers.map(s => [Markup.button.callback(`🧱 ${s.companyName || 'ሲሚንቶ'}`, 'none'), Markup.button.callback('❌ ሰርዝ', `del_cem_${s._id}`)]);
    ctx.reply('ለማጥፋት ❌ ሰርዝ ይጫኑ፦', Markup.inlineKeyboard(buttons)); ctx.answerCbQuery();
});
bot.action('adm_manage_truck', async (ctx) => {
    const trucks = await TruckLeasor.find({}); if (trucks.length === 0) return ctx.reply('🚚 ምንም የለም።');
    const buttons = trucks.map(t => [Markup.button.callback(`🚚 ታርጋ፦ ${t.plate}`, 'none'), Markup.button.callback('❌ ሰርዝ', `del_trk_${t._id}`)]);
    ctx.reply('ለማጥፋት ❌ ሰርዝ ይጫኑ፦', Markup.inlineKeyboard(buttons)); ctx.answerCbQuery();
});
bot.action('adm_manage_steel', async (ctx) => {
    const steels = await SteelSeller.find({}); if (steels.length === 0) return ctx.reply('🟥 ምንም የለም።');
    const buttons = steels.map(s => [Markup.button.callback(`🟥 አይነት፦ ${s.type}`, 'none'), Markup.button.callback('❌ ሰርዝ', `del_stl_${s._id}`)]);
    ctx.reply('ለማጥፋት ❌ ሰርዝ ይጫኑ፦', Markup.inlineKeyboard(buttons)); ctx.answerCbQuery();
});
bot.action('adm_manage_machinery', async (ctx) => {
    const machinery = await MachineryLeasor.find({}); if (machinery.length === 0) return ctx.reply('🔹 ምንም የለም።');
    const buttons = machinery.map(m => [Markup.button.callback(`🔹 አይነት፦ ${m.type}`, 'none'), Markup.button.callback('❌ ሰርዝ', `del_mac_${m._id}`)]);
    ctx.reply('ለማጥፋት ❌ ሰርዝ ይጫኑ፦', Markup.inlineKeyboard(buttons)); ctx.answerCbQuery();
});

bot.action(/^del_cem_(.+)$/, async (ctx) => { try { await CementSeller.findByIdAndDelete(ctx.match); ctx.reply('🧱 ተሰርዟል!'); } catch(e) {} ctx.answerCbQuery(); });
bot.action(/^del_trk_(.+)$/, async (ctx) => { try { await TruckLeasor.findByIdAndDelete(ctx.match); ctx.reply('🚚 ተሰርዟል!'); } catch(e) {} ctx.answerCbQuery(); });
bot.action(/^del_stl_(.+)$/, async (ctx) => { try { await SteelSeller.findByIdAndDelete(ctx.match); ctx.reply('🟥 ተሰርዟል!'); } catch(e) {} ctx.answerCbQuery(); });
bot.action(/^del_mac_(.+)$/, async (ctx) => { try { await MachineryLeasor.findByIdAndDelete(ctx.match); ctx.reply('🔹 ተሰርዟል!'); } catch(e) {} ctx.answerCbQuery(); });
bot.action('none', (ctx) => ctx.answerCbQuery());

// --- 🌐 Render ፖርት ማስከፈቻ የዌብ ሰርቨር ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is Running!');
}).listen(PORT);

bot.telegram.deleteWebhook({ drop_pending_updates: true })
    .then(() => bot.launch())
    .then(() => console.log('ቦቱ ያለ ምንም ግጭት በተሳካ ሁኔታ ተነስቷል!'))
    .catch((err) => console.error('የመነሳት ስህተት ያጋጥማል:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
