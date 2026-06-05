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

// --- 📊 የዳታቤዝ ሰንጠረዦች መዋቅር (Database Models) ---
const CementSeller = mongoose.model('CementSeller', { userId: Number, type: String, location: String, companyName: String, phone: String, price: Number, status: String });

const TruckLeasor = mongoose.model('TruckLeasor', { 
    userId: Number, 
    type: String, 
    plate: String, 
    route: String, 
    phone: String, 
    status: String,
    rentedCount: { type: Number, default: 0 } 
});

const SteelSeller = mongoose.model('SteelSeller', { userId: Number, type: String, address: String, phone: String, price: String, status: String });
const MachineryLeasor = mongoose.model('MachineryLeasor', { userId: Number, type: String, address: String, phone: String, price: String, status: String });

const bot = new Telegraf(BOT_TOKEN);

// 🛑 ከስህተት የጸዳ የሴሽን ማኔጀር (In-Memory Session Setup)
const userSessions = {};
function getSession(userId) {
    if (!userSessions[userId]) {
        userSessions[userId] = { action: null, cementData: {}, truckData: {}, steelData: {}, machineryData: {}, buyCement: {}, rentTruck: {}, buySteel: {}, rentMachinery: {} };
    }
    return userSessions[userId];
}

// --- ⌨️ ዋና ሜኑ ---
const mainKeyboard = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

bot.start((ctx) => {
    const session = getSession(ctx.from.id);
    session.action = null;
    ctx.reply('እንኳን ወደ Simple ቦት በሰላም መጡ! እባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ።', mainKeyboard);
});

// --- 🎛️ የውስጥ በተኖች (Inline Keyboards) ---
const cementSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'cement_active'), Markup.button.callback('❌ የለም', 'cement_off')],
    [Markup.button.callback('➕ አዲስ ለመመዝገብ', 'cement_re_reg'), Markup.button.callback('💰 ዋጋ ለማሻሻል', 'cement_update_price')]
]);

// 🚚 ለውጥ፦ "መኪናዬን ሙሉ በሙሉ ሰርዝ" የሚለው በተን ሙሉ በሙሉ እዚህ ተወግዷል!
const truckLeasorInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'truck_active'), Markup.button.callback('❌ የለም', 'truck_off')],
    [Markup.button.callback('🔄 የጉዞ መስመር ለመቀየር', 'truck_change_route')]
]);

const steelSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'steel_active'), Markup.button.callback('❌ የለም', 'steel_off')],
    [Markup.button.callback('💰 ዋጋ ለማሻሻል', 'steel_update_price')]
]);

const machineryLeasorInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'machinery_active'), Markup.button.callback('❌ የለም', 'machinery_off')]
]);

// --- 🧱 ሲሚንቶ ክፍል ---
bot.hears('🧱 ሲሚንቶ ለመሸጥ', async (ctx) => {
    const session = getSession(ctx.from.id);
    const existing = await CementSeller.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`አንተ ቀድሞውኑ የተመዘገብክ ቋሚ ደንበኛ ነህ። የአሁኑ ሁኔታህ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nምን ማድረግ ትፈልጋለህ?`, cementSellerInline);
    } else {
        session.action = 'REG_CEMENT_1';
        ctx.reply('የሲሚንቶ አይነት ያስገቡ፡');
    }
});

bot.hears('🧱 ሲሚንቶ ለመግዛት', (ctx) => {
    const session = getSession(ctx.from.id);
    session.action = 'BUY_CEMENT_1';
    ctx.reply('1. ምን አይነት ሲሚንቶ ነው የሚፈልጉት?');
});

// --- 🚚 መኪና ክፍል ---
bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    const session = getSession(ctx.from.id);
    const existing = await TruckLeasor.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገበ መኪና አለዎት። መስመር፡ ${existing.route}\nምን ማድረግ ትፈልጋለህ?`, truckLeasorInline);
    } else {
        session.action = 'REG_TRUCK_1';
        ctx.reply('ምን አይነት መኪና እንደሆነ ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
    }
});

bot.hears('🚚 መኪና ለመከራየት', (ctx) => {
    const session = getSession(ctx.from.id);
    session.action = 'RENT_TRUCK_1';
    ctx.reply('1. ምን አይነት መኪና ይፈልጋሉ?');
});

// --- 🟥 ብረት ክፍል ---
bot.hears('🟥 ብረት ለመሸጥ', async (ctx) => {
    const session = getSession(ctx.from.id);
    const existing = await SteelSeller.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገቡ የብረት ሻጭ ነዎት። ሁኔታ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}`, steelSellerInline);
    } else {
        session.action = 'REG_STEEL_1';
        ctx.reply('1. የብረት አይነቶችን ያስገቡ፡');
    }
});

bot.hears('🟥 ብረት ለመግዛት', (ctx) => {
    const session = getSession(ctx.from.id);
    session.action = 'BUY_STEEL_1';
    ctx.reply('1. ምን አይነት ብረት ይፈልጋሉ?');
});

// --- 🔹 ማሽነሪ ክፍል ---
bot.hears('🔹 ማሽነሪ ለማከራየት', async (ctx) => {
    const session = getSession(ctx.from.id);
    const existing = await MachineryLeasor.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገበ ማሽነሪ አለዎት። ሁኔታ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}`, machineryLeasorInline);
    } else {
        session.action = 'REG_MACHINERY_1';
        ctx.reply('1. የማሽነሪው አይነት ያስገቡ፡');
    }
});

bot.hears('🔹 ማሽነሪ ለመከራየት', (ctx) => {
    const session = getSession(ctx.from.id);
    session.action = 'RENT_MACHINERY_1';
    ctx.reply('1. የሚፈልጉት የማሽነሪ አይነት ያስገቡ፡');
});

// --- 💬 የፅሁፍ መልዕክቶች ማቀናበሪያ (Text Handler) ---
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const session = getSession(userId);
    const action = session.action;
    const text = ctx.message.text;

    if (!action) return;

    // ሲሚንቶ ሂደት
    if (action === 'REG_CEMENT_1') {
        session.cementData = { type: text };
        session.action = 'REG_CEMENT_2';
        ctx.reply('2. ያለበት ቦታ ያስገቡ፡');
    } else if (action === 'REG_CEMENT_2') {
        session.cementData.location = text;
        session.action = 'REG_CEMENT_3';
        ctx.reply('3. የድርጅቱ ስም ያስገቡ፡');
    } else if (action === 'REG_CEMENT_3') {
        session.cementData.companyName = text;
        session.action = 'REG_CEMENT_4';
        ctx.reply('4. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'REG_CEMENT_4') {
        session.cementData.phone = text;
        session.cementData.userId = userId;
        session.cementData.price = 1300; 
        session.cementData.status = 'active';
        
        await CementSeller.findOneAndUpdate({ userId }, session.cementData, { upsert: true });
        session.action = null;
        ctx.reply('መረጃዎ በትክክል ተመዝግቧል! አሁን እርስዎ ቋሚ ደንበኛ ሆነዋል።', cementSellerInline);
    }
    else if (action === 'UPDATE_CEMENT_PRICE') {
        await CementSeller.findOneAndUpdate({ userId }, { price: Number(text) });
        ctx.reply(`የሲሚንቶ ዋጋ ወደ ${text} ብር በተሳካ ሁኔታ ተሻሽሏል!`);
        session.action = null;
    }
    else if (action === 'BUY_CEMENT_1') {
        session.buyCement = { type: text };
        session.action = 'BUY_CEMENT_2';
        ctx.reply('2. አድራሻ ያስገቡ፡');
    } else if (action === 'BUY_CEMENT_2') {
        session.buyCement.address = text;
        session.action = 'BUY_CEMENT_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'BUY_CEMENT_3') {
        const available = await CementSeller.findOne({ type: new RegExp(session.buyCement.type, 'i'), status: 'active' });
        if (available) {
            ctx.reply(`የጠየቁት የሲሚንቶ አይነት እኛ ጋር ይገኛል\nየአሁን ዋጋ፡ ${available.price} ብር\nበ 0960336138 ደውለው ማዘዝ ይችላሉ`);
        } else {
            ctx.reply('ይቅርታ የጠየቁት የሲሚንቶ አይነት ለዛሬ የለም ሲኖር እናሳውቀዎታለን');
        }
        session.action = null;
    }

    // መኪና ሂደት
    else if (action === 'REG_TRUCK_1') {
        session.truckData = { type: text };
        session.action = 'REG_TRUCK_2';
        ctx.reply('የመኪናው ታርጋ ያስገቡ፡');
    } else if (action === 'REG_TRUCK_2') {
        session.truckData.plate = text;
        session.action = 'REG_TRUCK_3';
        ctx.reply('የጉዞ መስመር ያስገቡ (ምሳሌ፡ ሀዋሳ አዳማ)፡');
    } else if (action === 'REG_TRUCK_3') {
        session.truckData.route = text;
        session.action = 'REG_TRUCK_4';
        ctx.reply('ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'REG_TRUCK_4') {
        session.truckData.phone = text;
        session.truckData.userId = userId;
        session.truckData.status = 'active';
        session.truckData.rentedCount = 0; 
        await TruckLeasor.findOneAndUpdate({ userId }, session.truckData, { upsert: true });
        session.action = null;
        ctx.reply('መረጃዎ በትክክል ደርሶናል ፈላጊ ሲኖር እንደውልለዎታለን', truckLeasorInline);
    }
    else if (action === 'CHANGE_TRUCK_ROUTE') {
        await TruckLeasor.findOneAndUpdate({ userId }, { route: text });
        ctx.reply(`የጉዞ መስመርዎ ወደ "${text}" ተቀይሯል!`);
        session.action = null;
    }
    else if (action === 'RENT_TRUCK_1') {
        session.rentTruck = { type: text };
        session.action = 'RENT_TRUCK_2';
        ctx.reply('2. የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከአዲስ አበባ ጎንደር)፡');
    } else if (action === 'RENT_TRUCK_2') {
        session.rentTruck.route = text;
        session.action = 'RENT_TRUCK_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'RENT_TRUCK_3') {
        const cleanRoute = session.rentTruck.route.toLowerCase();
        let searchRegex;
        
        if (cleanRoute.includes("gondar") || cleanRoute.includes("ጎንደር")) {
            searchRegex = new RegExp("(gondar|ጎንደር)", "i");
        } else {
            searchRegex = new RegExp(session.rentTruck.route, "i");
        }

        const foundTruck = await TruckLeasor.findOne({ 
            type: new RegExp(session.rentTruck.type, 'i'),
            route: searchRegex, 
            status: 'active' 
        }).sort({ rentedCount: 1 });

        if (foundTruck) {
            ctx.reply(`የሚፈልጉት መኪና ይገኛል!\nየመኪናው አይነት፡ ${foundTruck.type}\nታርጋ ቁጥር፡ ${foundTruck.plate}\nለማዘዝ በ 0960336138 ይደውሉልን`);
            await TruckLeasor.findByIdAndUpdate(foundTruck._id, { $inc: { rentedCount: 1 } });
        } else {
            ctx.reply('በዚህ የጉዞ መስመር የሚጓዝ መኪና መረጃ እስካሁን አልደረሰንም መረጃው እንደደረሰን እንደውላለን');
        }
        session.action = null;
    }

    // ብረት ሂደት
    else if (action === 'REG_STEEL_1') {
        session.steelData = { type: text };
        session.action = 'REG_STEEL_2';
        ctx.reply('2. ያሉበት አድራሻ ያስገቡ፡');
    } else if (action === 'REG_STEEL_2') {
        session.steelData.address = text;
        session.action = 'REG_STEEL_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'REG_STEEL_3') {
        session.steelData.phone = text;
        session.steelData.action = 'REG_STEEL_4';
        ctx.reply('4. ዋጋ ያስገቡ፡');
    } else if (action === 'REG_STEEL_4') {
        session.steelData.price = text;
        session.steelData.userId = userId;
        session.steelData.status = 'active';
        await SteelSeller.findOneAndUpdate({ userId }, session.steelData, { upsert: true });
        session.action = null;
        ctx.reply('የብረት መረጃዎ በተሳካ ሁኔታ ተመዝግቧል!', steelSellerInline);
    }
    else if (action === 'UPDATE_STEEL_PRICE') {
        await SteelSeller.findOneAndUpdate({ userId }, { price: text });
        ctx.reply(`የብረት ዋጋዎ ወደ ${text} ብር ተሻሽሏል!`);
        session.action = null;
    }
    else if (action === 'BUY_STEEL_1') {
        session.buySteel = { type: text };
        session.action = 'BUY_STEEL_2';
        ctx.reply('2. ያሉበት ቦታ(አድራሻ) ያስገቡ፡');
    } else if (action === 'BUY_STEEL_2') {
        session.buySteel.address = text;
        session.action = 'BUY_STEEL_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'BUY_STEEL_3') {
        const available = await SteelSeller.findOne({ type: new RegExp(session.buySteel.type, 'i'), status: 'active' });
        if (available) {
            ctx.reply('የጠየቁት የብረት አይነቶች እኛ ጋር ይገኛሉ ለማዘዝ በ 0960336138 ይደውሉልን');
        } else {
            ctx.reply('ይቅርታ የጠየቁት የብረት አይነት እኛ ጋር ለጊዜው የለም');
        }
        session.action = null;
    }

    // ማሽነሪ ሂደት
    else if (action === 'REG_MACHINERY_1') {
        session.machineryData = { type: text };
        session.action = 'REG_MACHINERY_2';
        ctx.reply('2. የሚገኝበት አድራሻ ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_2') {
        session.machineryData.address = text;
        session.action = 'REG_MACHINERY_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_3') {
        session.machineryData.phone = text;
        session.machineryData.action = 'REG_MACHINERY_4';
        ctx.reply('4. የማሽነሪው የኪራይ ዋጋ ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_4') {
        session.machineryData.price = text;
        session.machineryData.userId = userId;
        session.machineryData.status = 'active';
        await MachineryLeasor.findOneAndUpdate({ userId }, session.machineryData, { upsert: true });
        session.action = null;
        ctx.reply('ማሽነሪዎ በትክክል ተመዝግቧል!', machineryLeasorInline);
    }
    else if (action === 'RENT_MACHINERY_1') {
        session.rentMachinery = { type: text };
        session.action = 'RENT_MACHINERY_2';
        ctx.reply('2. ያሉበት አድራሻ ያስገቡ፡');
    } else if (action === 'RENT_MACHINERY_2') {
        session.rentMachinery.address = text;
        session.rentMachinery.userId = userId;
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'RENT_MACHINERY_3') {
        const available = await MachineryLeasor.findOne({ type: new RegExp(session.rentMachinery.type, 'i'), status: 'active' });
        if (available) {
            ctx.reply('የጠየቁት የማሽነሪ አይነት እኛ ጋር ይገኛል ማሽነሪውን ለመከራየት በ0960336138 ይደውሉልን');
        } else {
            ctx.reply('ይቅርታ የጠየቁት የማሽነሪ አይነት እኛ ጋር አይገኝም');
        }
        session.action = null;
    }
});

// --- 🔘 የውስጥ በተኖች አሠራር (Inline Callback Actions) ---
bot.action('cement_active', async (ctx) => {
    await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    ctx.reply('ሁኔታዎ ወደ [አለ] ተቀይሯል።');
    ctx.answerCbQuery();
});
bot.action('cement_off', async (ctx) => {
    await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' });
    ctx.reply('ሁኔታዎ ወደ [የለም] ተቀይሯል።');
    ctx.answerCbQuery();
});
bot.action('cement_re_reg', (ctx) => {
    const session = getSession(ctx.from.id);
    session.action = 'REG_CEMENT_1';
    ctx.reply('የሲሚንቶ አይነት ያስገቡ፡');
    ctx.answerCbQuery();
});
bot.action('cement_update_price', (ctx) => {
    const session = getSession(ctx.from.id);
    session.action = 'UPDATE_CEMENT_PRICE';
    ctx.reply('አዲሱን የአንድ ኩንታል ዋጋ ያስገቡ፡');
    ctx.answerCbQuery();
});

bot.action('truck_active', async (ctx) => {
    await TruckLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    ctx.reply('መኪናዎ ዝግጁ (Active) ተደርጓል።');
    ctx.answerCbQuery();
});
bot.action('truck_off', async (ctx) => {
    await TruckLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' });
    ctx.reply('መኪናዎ ከእይታ ውጪ [የለም] ተደርጓል።');
    ctx.answerCbQuery();
});
bot.action('truck_change_route', (ctx) => {
    const session = getSession(ctx.from.id);
    session.action = 'CHANGE_TRUCK_ROUTE';
    ctx.reply('አዲሱን የጉዞ መስመር ያስገቡ፡');
    ctx.answerCbQuery();
});

bot.action('steel_active', async (ctx) => {
    await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    ctx.reply('የብረት ምርትዎ ዝግጁ ተደርጓል።');
    ctx.answerCbQuery();
});
bot.action('steel_off', async (ctx) => {
    await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' });
    ctx.reply('የብረት ምርትዎ [የለም] ተደርጓል።');
    ctx.answerCbQuery();
});
bot.action('steel_update_price', (ctx) => {
    const session = getSession(ctx.from.id);
    session.action = 'UPDATE_STEEL_PRICE';
    ctx.reply('አዲሱን የብረት ዋጋ ያስገቡ፡');
    ctx.answerCbQuery();
});

bot.action('machinery_active', async (ctx) => {
    await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    ctx.reply('ማሽነሪዎ ዝግጁ ተደርጓል።');
    ctx.answerCbQuery();
});
bot.action('machinery_off', async (ctx) => {
    await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' });
    ctx.reply('ማሽነሪዎ [የለም] ተደርጓል።');
    ctx.answerCbQuery();
});

// --- 👑 የአድሚን መቆጣጠሪያ ፓናል ---
bot.command('admin_panel', async (ctx) => {
    const adminId = 7423347375; 
    const currentUserId = ctx.from.id;

    if (currentUserId !== adminId) { 
        return ctx.reply(`⛔ ይቅርታ፣ ይህንን የአድሚን ትዕዛዝ ለመጠቀም ፈቃድ የለዎትም!\nየእርስዎ ID: ${currentUserId}`);
    }

    try {
        const trucks = await TruckLeasor.find({});
        if (trucks.length === 0) {
            return ctx.reply('👑 አድሚን፡ በዳታቤዝ ውስጥ የተመዘገበ ምንም መኪና የለም።');
        }

        const buttons = trucks.map(truck => {
            return [
                Markup.button.callback(`🚚 ${truck.plate || 'ታርጋ የሌለው'} (${truck.type || 'ያልታወቀ'})`, 'none'),
                Markup.button.callback('❌ ሰርዝ', `admin_del_${truck._id}`)
            ];
        });

        await ctx.reply('👑 የአድሚን ፓናል፤ ማጥፋት የሚፈልጉትን መኪና ❌ ይንኩ፡', Markup.inlineKeyboard(buttons));
    } catch (error) {
        ctx.reply("❌ ዳታቤዝ ላይ ስህተት አጋጥሟል።");
    }
});

bot.action(/^admin_del_(.+)$/, async (ctx) => {
    const adminId = 7423347375; 
    if (ctx.from.id !== adminId) { 
        return ctx.answerCbQuery('ፈቃድ የለዎትም!', { show_alert: true });
    }

    try {
        const truckId = ctx.match;
        const deleted = await TruckLeasor.findByIdAndDelete(truckId);

        if (deleted) {
            ctx.answerCbQuery(`ታርጋ ${deleted.plate} ተሰርዟል!`);
            const remainingTrucks = await TruckLeasor.find({});
            if (remainingTrucks.length === 0) {
                return ctx.editMessageText('👑 አድሚን፡ ሁሉም መኪናዎች ጠፍተዋል።');
            }
            const nextButtons = remainingTrucks.map(t => [
                Markup.button.callback(`🚚 ${t.plate} (${t.type})`, 'none'),
                Markup.button.callback('❌ ሰርዝ', `admin_del_${t._id}`)
            ]);
            ctx.editMessageText('👑 መኪናው ጠፍቷል። የቀሩት ዝርዝር፡', Markup.inlineKeyboard(nextButtons));
        } else {
            ctx.answerCbQuery('ይህ መኪና ቀድሞ ጠፍቷል!', { show_alert: true });
        }
    } catch (error) {
        ctx.answerCbQuery('ስረዛው አልተሳካም!', { show_alert: true });
    }
});

bot.action('none', (ctx) => ctx.answerCbQuery());

// --- 🌐 Render የዌብ ሰርቨር ፖርት ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is Running!');
}).listen(PORT);

bot.launch().then(() => console.log('Bot is alive on Render!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
