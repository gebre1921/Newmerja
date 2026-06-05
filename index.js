const { Telegraf, Markup } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose');

const bot = new Telegraf(process.env.BOT_TOKEN);
mongoose.connect(process.env.MONGO_URI);

const TruckLeasor = mongoose.model('TruckLeasor', { userId: Number, type: String, plate: String, route: String, status: String });

// የሂደት መቆጣጠሪያ
const userState = {};

const mainKeyboard = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

// 1. የቦት መጀመሪያ
bot.start((ctx) => {
    userState[ctx.from.id] = { action: null };
    ctx.reply('እንኳን በደህና መጡ! ምን ይፈልጋሉ?', mainKeyboard);
});

// 2. የአድሚን ፓናል (በጣም አስፈላጊው ክፍል)
bot.command('admin_panel', async (ctx) => {
    // ማህደረ ትውስታን እናጸዳለን (ዋጋ ያስገቡ የሚለውን ስህተት ለመፍታት)
    userState[ctx.from.id] = { action: null }; 

    const ADMIN_ID = 7423347375;
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("ፈቃድ የለዎትም!");

    const trucks = await TruckLeasor.find({});
    if (trucks.length === 0) return ctx.reply("በዳታቤዝ ውስጥ ምንም መኪና የለም።");

    const buttons = trucks.map(t => [
        Markup.button.callback(`🚚 ${t.plate}`, `admin_del_${t._id}`)
    ]);
    ctx.reply("ማጥፋት የሚፈልጉትን መኪና ይንኩ:", Markup.inlineKeyboard(buttons));
});

// 3. የስረዛ ተግባር
bot.action(/admin_del_(.+)/, async (ctx) => {
    const id = ctx.match;
    await TruckLeasor.findByIdAndDelete(id);
    ctx.answerCbQuery("ተሰርዟል!");
    ctx.editMessageText("መኪናው ከዳታቤዝ ተወግዷል።");
});

// 4. ሌሎች ሂደቶች (መኪና ለመከራየት)
bot.hears('🚚 መኪና ለመከራየት', (ctx) => {
    userState[ctx.from.id] = { action: 'RENT_TRUCK_1' };
    ctx.reply('ምን አይነት መኪና ይፈልጋሉ?');
});

// 5. የጽሁፍ ማቀናበሪያ
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];

    // የአድሚን ትዕዛዝ ካልሆነ ብቻ የሚሰራ
    if (!state || !state.action) return;

    if (state.action === 'RENT_TRUCK_1') {
        ctx.reply('የጉዞ መስመር ያስገቡ፡');
        state.action = 'RENT_TRUCK_2';
        state.truckType = ctx.message.text;
    } else if (state.action === 'RENT_TRUCK_2') {
        ctx.reply('ስልክ ቁጥር ያስገቡ፡');
        state.action = 'RENT_TRUCK_3';
        state.route = ctx.message.text;
    }
});

bot.launch();
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Bot is Live!')).listen(PORT);
