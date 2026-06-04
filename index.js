const { Telegraf, Markup, session } = require('telegraf');

// ቦት ቶክን እዚህ ጋር ያስገቡ
const BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE'; 
const bot = new Telegraf(BOT_TOKEN);

// በጊዜያዊነት መረጃዎችን ለመያዝ የሚያገለግል የዳታቤዝ መዋቅር (In-memory Database)
// ማሳሰቢያ፡ ቦቱ ሪስታርት ሲያደርግ ይህ ዳታቤዝ ስለሚጠፋ ለቋሚ አገልግሎት ከMongoDB ወይም PostgreSQL ጋር ማገናኘት ይመከራል።
const db = {
    cementSellers: [],    // { userId, type, location, companyName, phone, price: 1300, status: 'active' }
    truckLeasors: [],     // { userId, type, plate, route, phone, status: 'active' }
    steelSellers: [],     // { userId, type, address, phone, price, status: 'active' }
    machineryLeasors: []  // { userId, type, address, phone, price, status: 'active' }
};

// የSession ሚድልዌር አጠቃቀም
bot.use(session());

// ዋናው ሜኑ በተኖች (በምስሉ ላይ እንዳለው)
const mainKeyboard = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

// ቦቱ ሲጀመር የሚመጣ መልዕክት
bot.start((ctx) => {
    ctx.session = {}; // ሴሽን ማጽጃ
    ctx.reply('እንኳን ወደ Simple ቦት በሰላም መጡ! እባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ።', mainKeyboard);
});

// --- ንዑስ በተኖች (Inline Keyboards) ---
const cementSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'cement_active'), Markup.button.callback('❌ የለም', 'cement_off')],
    [Markup.button.callback('➕ አዲስ ለመመዝገብ', 'cement_re_reg'), Markup.button.callback('💰 ዋጋ ለማሻሻል', 'cement_update_price')]
]);

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


// ==========================================
// 1. የሲሚንቶ ክፍል (CEMENT SECTION)
// ==========================================

// ሲሚንቶ ለመሸጥ
bot.hears('🧱 ሲሚንቶ ለመሸጥ', (ctx) => {
    const userId = ctx.from.id;
    const existing = db.cementSellers.find(s => s.userId === userId);
    
    if (existing) {
        ctx.reply(`አንተ ቀድሞውኑ የተመዘገብክ ቋሚ ደንበኛ ነህ። የአሁኑ ሁኔታህ፡ ${existing.status === 'active' ? '✅ አለ (Active)' : '❌ የለም (Off)'}\nምን ማድረግ ትፈልጋለህ?`, cementSellerInline);
    } else {
        ctx.session.action = 'REG_CEMENT_1';
        ctx.reply('የሲሚንቶ አይነት ያስገቡ፡');
    }
});

// ሲሚንቶ ለመግዛት
bot.hears('🧱 ሲሚንቶ ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_CEMENT_1';
    ctx.reply('1. ምን አይነት ሲሚንቶ ነው የሚፈልጉት?');
});


// ==========================================
// 2. የጭነት መኪና ክፍል (TRUCK SECTION)
// ==========================================

// መኪና ለማከራየት
bot.hears('🚚 መኪና ለማከራየት', (ctx) => {
    const userId = ctx.from.id;
    const existing = db.truckLeasors.find(t => t.userId === userId);
    
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገበ መኪና አለዎት። መስመር፡ ${existing.route} | ሁኔታ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nምን ማድረግ ትፈልጋለህ?`, truckLeasorInline);
    } else {
        ctx.session.action = 'REG_TRUCK_1';
        ctx.reply('ምን አይነት መኪና እንደሆነ ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
    }
});

// መኪና ለመከራየት
bot.hears('🚚 መኪና ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.reply('1. ምን አይነት መኪና ይፈልጋሉ?');
});


// ==========================================
// 3. የብረት ክፍል (STEEL SECTION)
// ==========================================

// ብረት ለመሸጥ
bot.hears('🟥 ብረት ለመሸጥ', (ctx) => {
    const userId = ctx.from.id;
    const existing = db.steelSellers.find(s => s.userId === userId);
    
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገቡ የብረት ሻጭ ነዎት። ሁኔታ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nምን ማድረግ ትፈልጋለህ?`, steelSellerInline);
    } else {
        ctx.session.action = 'REG_STEEL_1';
        ctx.reply('1. የብረት አይነቶችን ያስገቡ፡');
    }
});

// ብረት ለመግዛት
bot.hears('🟥 ብረት ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_STEEL_1';
    ctx.reply('1. ምን አይነት ብረት ይፈልጋሉ?');
});


// ==========================================
// 4. የማሽነሪ ክፍል (MACHINERY SECTION)
// ==========================================

// ማሽነሪ ለማከራየት
bot.hears('🔹 ማሽነሪ ለማከራየት', (ctx) => {
    const userId = ctx.from.id;
    const existing = db.machineryLeasors.find(m => m.userId === userId);
    
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገበ ማሽነሪ አለዎት። ሁኔታ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nአማራጭ ይምረጡ፡`, machineryLeasorInline);
    } else {
        ctx.session.action = 'REG_MACHINERY_1';
        ctx.reply('1. የማሽነሪው አይነት ያስገቡ፡');
    }
});

// ማሽነሪ ለመከራየት
bot.hears('🔹 ማሽነሪ ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_MACHINERY_1';
    ctx.reply('1. የሚፈልጉት የማሽነሪ አይነት ያስገቡ፡');
});


// ==========================================
// የፅሁፍ ምላሾችን መቆጣጠሪያ (TEXT MESSAGE HANDLER)
// ==========================================
bot.on('text', async (ctx) => {
    const action = ctx.session?.action;
    const text = ctx.message.text;
    const userId = ctx.from.id;

    if (!action) return;

    // --- ሲሚንቶ ምዝገባ ሂደት ---
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
        ctx.session.cementData.price = 1300; // ነባሪ ዋጋ
        ctx.session.cementData.status = 'active';
        
        // በዳታቤዝ ውስጥ መተካት ወይም መመዝገብ
        const idx = db.cementSellers.findIndex(s => s.userId === userId);
        if (idx > -1) db.cementSellers[idx] = ctx.session.cementData;
        else db.cementSellers.push(ctx.session.cementData);
        
        ctx.session.action = null;
        ctx.reply('መረጃዎ በትክክል ተመዝግቧል! አሁን እርስዎ ቋሚ ደንበኛ ሆነዋል።', cementSellerInline);
    }
    
    // --- ሲሚንቶ ዋጋ ማሻሻል ---
    else if (action === 'UPDATE_CEMENT_PRICE') {
        const seller = db.cementSellers.find(s => s.userId === userId);
        if (seller) {
            seller.price = text;
            ctx.reply(`የሲሚንቶ ዋጋ በተሳካ ሁኔታ ወደ ${text} ብር ተሻሽሏል!`);
        }
        ctx.session.action = null;
    }

    // --- ሲሚንቶ መግዛት ሂደት ---
    else if (action === 'BUY_CEMENT_1') {
        ctx.session.buyCement = { type: text };
        ctx.session.action = 'BUY_CEMENT_2';
        ctx.reply('2. አድራሻ ያስገቡ፡');
    } else if (action === 'BUY_CEMENT_2') {
        ctx.session.buyCement.address = text;
        ctx.session.action = 'BUY_CEMENT_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'BUY_CEMENT_3') {
        ctx.session.buyCement.phone = text;
        const requestedType = ctx.session.buyCement.type.toLowerCase();
        
        // በዳታቤዝ ውስጥ በቲፕ እና በ active ሁኔታ መፈለግ
        const available = db.cementSellers.find(s => s.type.toLowerCase().includes(requestedType) && s.status === 'active');
        
        if (available) {
            ctx.reply(`የጠየቁት የሲሚንቶ አይነት እኛ ጋር ይገኛል\nየአንድ ኩንታል ዋጋ ${available.price}\nበ 0960336138 ደውለው ማዘዝ ይችላሉ`);
        } else {
            ctx.reply('ይቅርታ የጠየቁት የሲሚንቶ አይነት ለዛሬ የለም ሲኖር እናሳውቀዎታለን');
        }
        ctx.session.action = null;
    }

    // --- መኪና ማከራየት ምዝገባ ሂደት ---
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
        
        db.truckLeasors.push(ctx.session.truckData);
        ctx.session.action = null;
        ctx.reply('መረጃዎ በትክክል ደርሶናል ፈላጊ ሲኖር እንደውልለዎታለን', truckLeasorInline);
    }
    
    // --- መኪና መስመር መቀየር ---
    else if (action === 'CHANGE_TRUCK_ROUTE') {
        const truck = db.truckLeasors.find(t => t.userId === userId);
        if (truck) {
            truck.route = text;
            ctx.reply(`የጉዞ መስመርዎ ወደ "${text}" በተሳካ ሁኔታ ተቀይሯል!`);
        }
        ctx.session.action = null;
    }

    // --- መኪና መከራየት ሂደት ---
    else if (action === 'RENT_TRUCK_1') {
        ctx.session.rentTruck = { type: text };
        ctx.session.action = 'RENT_TRUCK_2';
        ctx.reply('2. የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከአዲስ አበባ ጎንደር)፡');
    } else if (action === 'RENT_TRUCK_2') {
        ctx.session.rentTruck.route = text;
        ctx.session.action = 'RENT_TRUCK_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'RENT_TRUCK_3') {
        ctx.session.rentTruck.phone = text;
        const reqRoute = ctx.session.rentTruck.route.toLowerCase();
        
        // ተስማሚ መስመር እና active የሆኑ መኪናዎችን መፈለግ
        const foundTruck = db.truckLeasors.find(t => t.route.toLowerCase().includes(reqRoute) && t.status === 'active');
        
        if (foundTruck) {
            ctx.reply(`የሚፈልጉት መኪና ይገኛል!\nየመኪናው አይነት፡ ${foundTruck.type}\nታርጋ ቁጥር፡ ${foundTruck.plate}\nለማዘዝ በ 0960336138 በመላክ ይደውሉልን`);
        } else {
            ctx.reply('በዚህ የጉዞ መስመር የሚጓዝ መኪና መረጃ እስካሁን አልደረሰንም መረጃው እንደደረሰን እንደውላለን');
        }
        ctx.session.action = null;
    }

    // --- ብረት ምዝገባ ሂደት ---
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
        ctx.session.action = 'REG_STEEL_4';
        ctx.reply('4. ዋጋ ያስገቡ፡');
    } else if (action === 'REG_STEEL_4') {
        ctx.session.steelData.price = text;
        ctx.session.steelData.userId = userId;
        ctx.session.steelData.status = 'active';
        
        db.steelSellers.push(ctx.session.steelData);
        ctx.session.action = null;
        ctx.reply('የብረት መረጃዎ በተሳካ ሁኔታ ተመዝግቧል!', steelSellerInline);
    }
    
    // --- ብረት ዋጋ ማሻሻል ---
    else if (action === 'UPDATE_STEEL_PRICE') {
        const seller = db.steelSellers.find(s => s.userId === userId);
        if (seller) {
            seller.price = text;
            ctx.reply(`የብረት ዋጋዎ ወደ ${text} ብር ተሻሽሏል!`);
        }
        ctx.session.action = null;
    }

    // --- ብረት መግዛት ሂደት ---
    else if (action === 'BUY_STEEL_1') {
        ctx.session.buySteel = { type: text };
        ctx.session.action = 'BUY_STEEL_2';
        ctx.reply('2. ያሉበት ቦታ(አድራሻ) ያስገቡ፡');
    } else if (action === 'BUY_STEEL_2') {
        ctx.session.buySteel.address = text;
        ctx.session.action = 'BUY_STEEL_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'BUY_STEEL_3') {
        const reqSteel = ctx.session.buySteel.type.toLowerCase();
        const available = db.steelSellers.find(s => s.type.toLowerCase().includes(reqSteel) && s.status === 'active');
        
        if (available) {
            ctx.reply('ብረት ካለ የጠየቁት የብረት አይነቶች እኛ ጋር ይገኛሉ ለማዘዝ በ 0960336138 ይደውሉልን');
        } else {
            ctx.reply('ይቅርታ የጠየቁት የብረት አይነት እኛ ጋር የለም');
        }
        ctx.session.action = null;
    }

    // --- ማሽነሪ ምዝገባ ሂደት ---
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
        ctx.session.action = 'REG_MACHINERY_4';
        ctx.reply('4. የማሽነሪው የኪራይ ዋጋ ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_4') {
        ctx.session.machineryData.price = text;
        ctx.session.machineryData.userId = userId;
        ctx.session.machineryData.status = 'active';
        
        db.machineryLeasors.push(ctx.session.machineryData);
        ctx.session.action = null;
        ctx.reply('ማሽነሪዎ በትክክል ተመዝግቧል!', machineryLeasorInline);
    }

    // --- ማሽነሪ መከራየት ሂደት ---
    else if (action === 'RENT_MACHINERY_1') {
        ctx.session.rentMachinery = { type: text };
        ctx.session.action = 'RENT_MACHINERY_2';
        ctx.reply('2. ያሉበት አድራሻ ያስገቡ፡');
    } else if (action === 'RENT_MACHINERY_2') {
        ctx.session.rentMachinery.address = text;
        ctx.session.action = 'RENT_MACHINERY_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'RENT_MACHINERY_3') {
        const reqMachinery = ctx.session.rentMachinery.type.toLowerCase();
        const available = db.machineryLeasors.find(m => m.type.toLowerCase().includes(reqMachinery) && m.status === 'active');
        
        if (available) {
            ctx.reply('የጠየቁት የማሽነሪ አይነት እኛ ጋር ይገኛል ማሽነሪውን ለመከራየት በ0960336138 ይደውሉልን');
        } else {
            ctx.reply('ይቅርታ የጠየቁት የማሽነሪ አይነት እኛ ጋር አይገኝም');
        }
        ctx.session.action = null;
    }
});


// ==========================================
// የውስጥ በተኖች ምላሽ መቆጣጠሪያ (INLINE CALLBACK ACTIONS)
// ==========================================

// ሲሚንቶ በተኖች
bot.action('cement_active', (ctx) => {
    const seller = db.cementSellers.find(s => s.userId === ctx.from.id);
    if (seller) { seller.status = 'active'; ctx.reply('ሁኔታዎ ወደ [አለ] ተቀይሯል። ገዢዎች ማዘዝ ይችላሉ።'); }
    ctx.answerCbQuery();
});
bot.action('cement_off', (ctx) => {
    const seller = db.cementSellers.find(s => s.userId === ctx.from.id);
    if (seller) { seller.status = 'off'; ctx.reply('ሁኔታዎ ወደ [የለም] ተቀይሯል። ለገዢዎች ምላሽ አይሰጥም።'); }
    ctx.answerCbQuery();
});
bot.action('cement_re_reg', (ctx) => {
    ctx.session.action = 'REG_CEMENT_1';
    ctx.reply('የሲሚንቶ አይነት ያስገቡ፡');
    ctx.answerCbQuery();
});
bot.action('cement_update_price', (ctx) => {
    ctx.session.action = 'UPDATE_CEMENT_PRICE';
    ctx.reply('እባክዎ አዲሱን የአንድ ኩንታል ሲሚንቶ ዋጋ ያስገቡ፡');
    ctx.answerCbQuery();
});

// መኪና በተኖች
bot.action('truck_active', (ctx) => {
    const item = db.truckLeasors.find(t => t.userId === ctx.from.id);
    if (item) { item.status = 'active'; ctx.reply('መኪናዎ ዝግጁ (Active) ተደርጓል።'); }
    ctx.answerCbQuery();
});
bot.action('truck_off', (ctx) => {
    const item = db.truckLeasors.find(t => t.userId === ctx.from.id);
    if (item) { item.status = 'off'; ctx.reply('መኪናዎ ከእይታ ውጪ (Off) ተደርጓል።'); }
    ctx.answerCbQuery();
});
bot.action('truck_change_route', (ctx) => {
    ctx.session.action = 'CHANGE_TRUCK_ROUTE';
    ctx.reply('እባክዎ አዲሱን የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከአዲስ አበባ ናዝሬት)፡');
    ctx.answerCbQuery();
});

// ብረት በተኖች
bot.action('steel_active', (ctx) => {
    const item = db.steelSellers.find(s => s.userId === ctx.from.id);
    if (item) { item.status = 'active'; ctx.reply('የብረት ምርትዎ ዝግጁ (Active) ተደርጓል።'); }
    ctx.answerCbQuery();
});
bot.action('steel_off', (ctx) => {
    const item = db.steelSellers.find(s => s.userId === ctx.from.id);
    if (item) { item.status = 'off'; ctx.reply('የብረት ምርትዎ [የለም] ተደርጓል።'); }
    ctx.answerCbQuery();
});
bot.action('steel_update_price', (ctx) => {
    ctx.session.action = 'UPDATE_STEEL_PRICE';
    ctx.reply('እባክዎ አዲሱን የብረት ዋጋ ያስገቡ፡');
    ctx.answerCbQuery();
});

// ማሽነሪ በተኖች
bot.action('machinery_active', (ctx) => {
    const item = db.machineryLeasors.find(m => m.userId === ctx.from.id);
    if (item) { item.status = 'active'; ctx.reply('ማሽነሪዎ ዝግጁ (Active) ተደርጓል።'); }
    ctx.answerCbQuery();
});
bot.action('machinery_off', (ctx) => {
    const item = db.machineryLeasors.find(m => m.userId === ctx.from.id);
    if (item) { item.status = 'off'; ctx.reply('ማሽነሪዎ [የለም] ተደርጓል።'); }
    ctx.answerCbQuery();
});

// ቦቱን ማስነሳት
bot.launch().then(() => {
    console.log('Simple Bot በተሳካ ሁኔታ ስራ ጀምሯል!');
});

// ስራ ሲያቆም በስርአት መዝጊያ
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
