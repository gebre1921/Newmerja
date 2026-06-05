const { Telegraf, Markup, session } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose'); // ማነጎዲቢን ለማገናኘት

// --- 🛠️ የቶክን ማጽጃ ክፍል (Render ላይ የሚፈጠርን ስህተት ለመከላከል) ---
const rawToken = process.env.BOT_TOKEN;
const BOT_TOKEN = rawToken ? rawToken.trim().replace(/['"]/g, '') : undefined;
const MONGO_URI = process.env.MONGO_URI;

if (!BOT_TOKEN || !MONGO_URI) {
    console.error("ስህተት: BOT_TOKEN ወይም MONGO_URI በ Render Environment Variables ላይ አልተገኘም!");
    process.exit(1);
}

// ቶክኑ በትክክል መነቡን በሎግ ላይ ለማረጋገጥ
console.log(`-> ቶክኑ በተሳካ ሁኔታ ተነቧል! ርዝመት: ${BOT_TOKEN.length} ቁምፊዎች።`);

// --- 🗄️ ከማንጎ ዲቢ (MongoDB) ጋር ማገናኛ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("ማንጎ ዲቢ ዳታቤዝ በተሳካ ሁኔታ ተገናኝቷል!"))
    .catch(err => console.error("የዳታቤዝ ግንኙነት ስህተት:", err));

// --- 📊 የዳታቤዝ ሰንጠረዦች መዋቅር (Database Models) ---
const CementSeller = mongoose.model('CementSeller', { userId: Number, type: String, location: String, companyName: String, phone: String, price: Number, status: String });

// 🚚 መዋቅር፦ ለእያንዳንዱ መኪና 'rentedCount' (የተከራየበት ብዛት) አብሮ ይይዛል
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
bot.use(session());

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

// --- 🎛️ የውስጥ በተኖች (Inline Keyboards) ---
const cementSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'cement_active'), Markup.button.callback('❌ የለም', 'cement_off')],
    [Markup.button.callback('➕ አዲስ ለመመዝገብ', 'cement_re_reg'), Markup.button.callback('💰 ዋጋ ለማሻሻል', 'cement_update_price')]
]);

// 🚚 ማሻሻያ፦ የመኪና ባለቤቶች ራሳቸው እንዳይሰርዙ የነበረው 'መኪናዬን ሰርዝ' በተን ተወግዷል!
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
    const existing = await CementSeller.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`አንተ ቀድሞውኑ የተመዘገብክ ቋሚ ደንበኛ ነህ። የአሁኑ ሁኔታህ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nምን ማድረግ ትፈልጋለህ?`, cementSellerInline);
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
    const existing = await TruckLeasor.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገበ መኪና አለዎት። መስመር፡ ${existing.route}\nምን ማድረግ ትፈልጋለህ?`, truckLeasorInline);
    } else {
        ctx.session.action = 'REG_TRUCK_1';
        ctx.reply('ምን አይነት መኪና እንደሆነ ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
    }
});

bot.hears('🚚 መኪና ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.reply('1. ምን አይነት መኪና ይፈልጋሉ?');
});

// --- 🟥 ብረት ክፍል ---
bot.hears('🟥 ብረት ለመሸጥ', async (ctx) => {
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
bot.hears('🔹 ማሽነሪ ለማከራየት', async (ctx) => {
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

// --- 💬 የፅሁፍ መልዕክቶች ማቀናበሪያ (Text Handler) ---
bot.on('text', async (ctx) => {
    const action = ctx.session?.action;
    const text = ctx.message.text;
    const userId = ctx.from.id;

    if (!action) return;

    // ሲሚንቶ ሂደት
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
        ctx.reply('መረጃዎ በትክክል ተመዝግቧል! አሁን እርስዎ ቋሚ ደንበኛ ሆነዋል።', cementSellerInline);
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
        ctx.session.buyCement.address = text;
        ctx.session.action = 'BUY_CEMENT_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'BUY_CEMENT_3') {
        const available = await CementSeller.findOne({ type: new RegExp(ctx.session.buyCement.type, 'i'), status: 'active' });
        if (available) {
            ctx.reply(`የጠየቁት የሲሚንቶ አይነት እኛ ጋር ይገኛል\nየአሁን ዋጋ፡ ${available.price} ብር\nበ 0960336138 ደውለው ማዘዝ ይችላሉ`);
        } else {
            ctx.reply('ይቅርታ የጠየቁት የሲሚንቶ አይነት ለዛሬ የለም ሲኖር እናሳውቀዎታለን');
        }
        ctx.session.action = null;
    }

    // መኪና ሂደት
    else if (action === 'REG_TRUCK_1') {
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
        await TruckLeasor.findOneAndUpdate({ userId }, ctx.session.truckData, { upsert: true });
        ctx.session.action = null;
        ctx.reply('መረጃዎ በትክክል ደርሶናል ፈላጊ ሲኖር እንደውልለዎታለን', truckLeasorInline);
    }
    else if (action === 'CHANGE_TRUCK_ROUTE') {
        await TruckLeasor.findOneAndUpdate({ userId }, { route: text });
        ctx.reply(`የጉዞ መስመርዎ ወደ "${text}" ተቀይሯል!`);
        ctx.session.action = null;
    }
    else if (action === 'RENT_TRUCK_1') {
        ctx.session.rentTruck = { type: text };
        ctx.session.action = 'RENT_TRUCK_2';
        ctx.reply('2. የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከአዲስ አበባ ጎንደር ወይም Addis Ababa to Gondar)፡');
    } else if (action === 'RENT_TRUCK_2') {
        ctx.session.rentTruck.route = text;
        ctx.session.action = 'RENT_TRUCK_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'RENT_TRUCK_3') {
        const cleanRoute = ctx.session.rentTruck.route.toLowerCase();
        let searchRegex;
        
        if (cleanRoute.includes("gondar") || cleanRoute.includes("ጎንደር")) {
            searchRegex = new RegExp("(gondar|ጎንደር)", "i");
        } else {
            searchRegex = new RegExp(ctx.session.rentTruck.route, "i");
        }

        // ፍትሃዊ አሰራር፡ በትንሹ የተከራየውን መኪና ቅድሚያ ይሰጣል
        const foundTruck = await TruckLeasor.findOne({ 
            type: new RegExp(ctx.session.rentTruck.type, 'i'),
            route: searchRegex, 
            status: 'active' 
        }).sort({ rentedCount: 1 });

        if (foundTruck) {
            ctx.reply(`የሚፈልጉት መኪና ይገኛል!\nየመኪናው አይነት፡ ${foundTruck.type}\nታርጋ ቁጥር፡ ${foundTruck.plate}\nለማዘዝ በ 0960336138 ይደውሉልን`);
            await TruckLeasor.findByIdAndUpdate(foundTruck._id, { $inc: { rentedCount: 1 } });
        } else {
            ctx.reply('በዚህ የጉዞ መስመር የሚጓዝ መኪና መረጃ እስካሁን አልደረሰንም መረጃው እንደደረሰን እንደውላለን');
        }
        ctx.session.action = null;
    }

    // ብረት ሂደት
    else if (action === 'REG_STEEL_1') {
        ctx.session.steelData = { type: text };
        ctx.session.action = 'REG_STEEL_2';
        ctx.reply('2. ያሉበት አድራሻ ያስገቡ፡');
    } else if (action === 'REG_STEEL_2') {
        ctx.session.steelData.address = text;
        ctx.session.action = 'REG_STEEL_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'REG_STEEL_3') {
        ctx.session.steelData.phone = text;
        ctx.session.steelData.action = 'REG_STEEL_4';
        ctx.reply('4. ዋጋ ያስገቡ፡');
    } else if (action === 'REG_STEEL_4') {
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
        ctx.session.buySteel.address = text;
        ctx.session.action = 'BUY_STEEL_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'BUY_STEEL_3') {
        const available = await SteelSeller.findOne({ type: new RegExp(ctx.session.buySteel.type, 'i'), status: 'active' });
        if (available) {
            ctx.reply('የጠየቁት የብረት አይነቶች እኛ ጋር ይገኛሉ ለማዘዝ በ 0960336138 ይደውሉልን');
        } else {
            ctx.reply('ይቅርታ የጠየቁት የብረት አይነት እኛ ጋር ለጊዜው የለም');
        }
        ctx.session.action = null;
    }

    // ማሽነሪ ሂደት
    else if (action === 'REG_MACHINERY_1') {
        ctx.session.machineryData = { type: text };
        ctx.session.action = 'REG_MACHINERY_2';
        ctx.reply('2. የሚገኝበት አድራሻ ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_2') {
        ctx.session.machineryData.address = text;
        ctx.session.action = 'REG_MACHINERY_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_3') {
        ctx.session.machineryData.phone = text;
        ctx.session.machineryData.action = 'REG_MACHINERY_4';
        ctx.reply('4. የማሽነሪው የኪራይ ዋጋ ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_4') {
        ctx.session.machineryData.price = text;
        ctx.session.machineryData.userId = userId;
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
        ctx.session.rentMachinery.address = text;
        ctx.session.rentMachinery.userId = userId;
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'RENT_MACHINERY_3') {
        const available = await MachineryLeasor.findOne({ type: new RegExp(ctx.session.rentMachinery.type, 'i'), status: 'active' });
        if (available) {
            ctx.reply('የጠየቁት የማሽነሪ አይነት እኛ ጋር ይገኛል ማሽነሪውን ለመከራየት በ0960336138 ይደውሉልን');
        } else {
            ctx.reply('ይቅርታ የጠየቁት የማሽነሪ አይነት እኛ ጋር አይገኝም');
        }
        ctx.session.action = null;
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
    ctx.session.action = 'REG_CEMENT_1';
    ctx.reply('የሲሚንቶ አይነት ያስገቡ፡');
    ctx.answerCbQuery();
});
bot.action('cement_update_price', (ctx) => {
    ctx.session.action = 'UPDATE_CEMENT_PRICE';
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
    ctx.session.action = 'CHANGE_TRUCK_ROUTE';
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
    ctx.session.action = 'UPDATE_STEEL_PRICE';
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

// --- 👑 የላቀ የአድሚን መቆጣጠሪያ ፓናል (Admin Dashboard) ---

// 1. ሁሉንም መኪኖች በአዝራር መልክ የሚያመጣ የአድሚን ትዕዛዝ
bot.command('admin_panel', async (ctx) => {
    const adminId = 7423347375; // የእርስዎ የቴሌግራም ID
    const currentUserId = ctx.from.id;

    console.log(`-> የአድሚን ሙከራ ከ ID: ${currentUserId}`); // ለ Render ሎግ መቆጣጠሪያ እንዲረዳዎት

    // የአይዲ ማረጋገጫ ማጣሪያ
    if (currentUserId !== adminId) { 
        return ctx.reply(`⛔ ይቅርታ፣ ይህንን የአድሚን ትዕዛዝ ለመጠቀም ፈቃድ የለዎትም!\nየእርስዎ የአሁኑ ID: ${currentUserId}`);
    }

    try {
        const trucks = await TruckLeasor.find({});
        if (trucks.length === 0) {
            return ctx.reply('👑 אድሚን፡ በአሁኑ ሰዓት በዳታቤዝ ውስጥ የተመዘገበ ምንም መኪና የለም።');
        }

        const buttons = trucks.map(truck => {
            return [
                Markup.button.callback(`🚚 ${truck.plate || 'ታርጋ የሌለው'} (${truck.type || 'ያልታወቀ'})`, 'none'),
                Markup.button.callback('❌ ሰርዝ', `admin_del_${truck._id}`)
            ];
        });

        await ctx.reply('👑 እንኳን ወደ አድሚን ማጥፊያ ፓናል በሰላም መጡ። ማጥፋት የሚፈልጉትን መኪና ❌ የሚለውን ይንኩ፡', Markup.inlineKeyboard(buttons));
    } catch (error) {
        console.error("የአድሚን ፓናል ስህተት:", error);
        ctx.reply("❌ መረጃዎችን ከዳታቤዝ ላይ በማምጣት ሂደት ላይ ስህተት አጋጥሟል።");
    }
});

// 2. የ "❌ ሰርዝ" በተን ሲነካ በቀጥታ ከማንጎ ዲቢ የሚያጠፋ
bot.action(/^admin_del_(.+)$/, async (ctx) => {
    const adminId = 7423347375; // የእርስዎ የቴሌግራም ID
    if (ctx.from.id !== adminId) { 
        return ctx.answerCbQuery('ይህንን ተግባር ለመፈጸም ፈቃድ የለዎትም!', { show_alert: true });
    }

    try {
        const truckId = ctx.match;
        const deleted = await TruckLeasor.findByIdAndDelete(truckId);

        if (deleted) {
            ctx.answerCbQuery(`ታርጋ ${deleted.plate} ተሰርዟል!`, { show_alert: false });
            
            const remainingTrucks = await TruckLeasor.find({});
            if (remainingTrucks.length === 0) {
                return ctx.editMessageText('👑 አድሚን፡ ሁሉም መኪናዎች ከዳታቤዝ ላይ ተደምስሰዋል።');
            }

            const nextButtons = remainingTrucks.map(t => [
                Markup.button.callback(`🚚 ${t.plate} (${t.type})`, 'none'),
                Markup.button.callback('❌ ሰርዝ', `admin_del_${t._id}`)
            ]);

            ctx.editMessageText('👑 መኪናው በተሳካ ሁኔታ ተሰርዟል። የቀሩት ዝርዝር፡', Markup.inlineKeyboard(nextButtons));
        } else {
            ctx.answerCbQuery('ይህ መኪና ቀድሞ ጠፍቷል!', { show_alert: true });
        }
    } catch (error) {
        console.error("የስረዛ ስህተት:", error);
        ctx.answerCbQuery('ስረዛው አልተሳካም!', { show_alert: true });
    }
});

// አዶሚኑ ታርጋውን ሲነካ የሚዘጋ Callback
bot.action('none', (ctx) => ctx.answerCbQuery());

// --- 🌐 Render ፖርት ማስከፈቻ የዌብ ሰርቨር ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is Running with MongoDB connection!');
}).listen(PORT);

bot.launch().then(() => console.log('Simple Bot is alive on Render with Permanent DB!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
