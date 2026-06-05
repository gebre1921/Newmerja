const { Telegraf, Markup } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose');

const bot = new Telegraf(process.env.BOT_TOKEN);
mongoose.connect(process.env.MONGO_URI);

const TruckLeasor = mongoose.model('TruckLeasor', { 
    userId: Number, 
    type: String, 
    plate: String, 
    route: String, 
    status: String 
});

const userState = {};

// --- 1. መኪና ለማከራየት በተን (User Panel) ---
bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    const trucks = await TruckLeasor.find({ userId: ctx.from.id });
    
    if (trucks.length === 0) {
        userState[ctx.from.id] = { action: 'REG_TRUCK_1' };
        return ctx.reply('ለመመዝገብ የመኪናውን አይነት ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
    }

    let msg = "የያዟቸው መኪናዎች:\n";
    const buttons = trucks.map(t => [
        Markup.button.callback(`${t.plate} - ${t.status === 'active' ? '✅ አለ' : '❌ የለም'}`, `manage_${t._id}`)
    ]);
    buttons.push([Markup.button.callback('➕ ሌላ መኪና ጨምር', 'add_new_truck')]);
    
    ctx.reply(msg, Markup.inlineKeyboard(buttons));
});

// --- 2. መኪና ማስተዳደሪያ (አለ/የለም/መስመር ቀይር) ---
bot.action(/manage_(.+)/, async (ctx) => {
    const id = ctx.match;
    const truck = await TruckLeasor.findById(id);
    
    const inline = Markup.inlineKeyboard([
        [Markup.button.callback(truck.status === 'active' ? '❌ የለም በል' : '✅ አለ በል', `toggle_${id}`)],
        [Markup.button.callback('🔄 የጉዞ መስመር ቀይር', `change_route_${id}`)]
    ]);
    ctx.reply(`ታርጋ: ${truck.plate}\nመስመር: ${truck.route}\nምን ማድረግ ይፈልጋሉ?`, inline);
});

bot.action(/toggle_(.+)/, async (ctx) => {
    const id = ctx.match;
    const t = await TruckLeasor.findById(id);
    const newStatus = t.status === 'active' ? 'off' : 'active';
    await TruckLeasor.findByIdAndUpdate(id, { status: newStatus });
    ctx.answerCbQuery(`ሁኔታው ወደ ${newStatus} ተቀይሯል`);
    ctx.editMessageText(`መኪናው አሁን ${newStatus} ሆኗል።`);
});

// --- 3. የአድሚን ፓናል (Admin Panel) ---
bot.command('admin_panel', async (ctx) => {
    const ADMIN_ID = 7423347375;
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("ፈቃድ የለዎትም!");

    const trucks = await TruckLeasor.find({});
    if (trucks.length === 0) return ctx.reply("በዳታቤዝ ውስጥ ምንም መኪና የለም።");

    const buttons = trucks.map(t => [
        Markup.button.callback(`❌ ሰርዝ: ${t.plate}`, `admin_del_${t._id}`)
    ]);
    ctx.reply("ከዳታቤዝ ለማጥፋት የሚፈልጉትን ይምረጡ:", Markup.inlineKeyboard(buttons));
});

bot.action(/admin_del_(.+)/, async (ctx) => {
    await TruckLeasor.findByIdAndDelete(ctx.match);
    ctx.answerCbQuery("ተሰርዟል!");
    ctx.editMessageText("መኪናው ከዳታቤዝ ተሰርዟል።");
});

// --- 4. መኪና መመዝገቢያ ሎጂክ ---
bot.on('text', async (ctx) => {
    const state = userState[ctx.from.id];
    if (!state) return;

    if (state.action === 'REG_TRUCK_1') {
        state.type = ctx.message.text;
        state.action = 'REG_TRUCK_2';
        ctx.reply('ታርጋ ቁጥር ያስገቡ፡');
    } else if (state.action === 'REG_TRUCK_2') {
        state.plate = ctx.message.text;
        state.action = 'REG_TRUCK_3';
        ctx.reply('የጉዞ መስመር ያስገቡ፡');
    } else if (state.action === 'REG_TRUCK_3') {
        await TruckLeasor.create({ 
            userId: ctx.from.id, type: state.type, plate: state.plate, route: ctx.message.text, status: 'active' 
        });
        userState[ctx.from.id] = { action: null };
        ctx.reply('መኪናው በተሳካ ሁኔታ ተመዝግቧል!');
    }
});

bot.launch();
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Bot is Live!')).listen(PORT);
