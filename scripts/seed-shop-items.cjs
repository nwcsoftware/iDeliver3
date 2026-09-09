#!/usr/bin/env node
/* Fill a supplier's shop with demonstration stock.
 *
 *   node scripts/seed-shop-items.cjs --dry-run     see what it would create
 *   node scripts/seed-shop-items.cjs               create it
 *   node scripts/seed-shop-items.cjs --count 40    fewer than the default 100
 *   node scripts/seed-shop-items.cjs --undo        remove what it created
 *
 * Test data, not real stock. It exists so the customer app can be looked at
 * with a shop that has enough in it to behave like a shop — scrolling, category
 * filtering, and above all the gallery load with a realistic number of pictures
 * in it, which is what fix143 was about.
 *
 * Every row is marked in `description` with SEED_TAG, so --undo can find its own
 * work and nothing else. Items typed by hand are never touched.
 *
 * The pictures are generated here rather than downloaded: a placeholder service
 * would put someone else's URLs in the rows, which is exactly the dependency
 * this shop should not have. scripts/lib/png.cjs draws them and they go into
 * the shop-media bucket like any other item photograph — so this also exercises
 * the path fix143 introduced, at a hundred times the scale of a hand test.
 *
 * Requires supabase-fix143.sql (for the bucket).
 */

const fs = require('fs')
const path = require('path')
const { encodePNG } = require('./lib/png.cjs')

const ROOT = path.resolve(__dirname, '..')
const env = {}
for (const f of ['.env', '.env.local']) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}
const URL_BASE = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!URL_BASE || !KEY) { console.error('Supabase URL / anon key not found in .env'); process.exit(1) }

const BUCKET = 'shop-media'
const SEED_TAG = '[demo stock]'
const H = { apikey: KEY, authorization: 'Bearer ' + KEY }

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const DRY   = process.argv.includes('--dry-run')
const UNDO  = process.argv.includes('--undo')
const COUNT = Math.max(1, Math.min(500, Number(arg('--count', 100)) || 100))
// Which shop to fill. By username is the way a person thinks about it —
// "Supplier01's shop" — so that is what the flag takes; without it the seeder
// falls back to whichever shop already has the most stock in it.
const USER = arg('--user', null)
// Overrides the list chosen from the shop's business type.
const LIST = arg('--catalogue', null)

async function rest(pathname, opts = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${pathname}`, {
    ...opts, headers: { ...H, 'content-type': 'application/json', ...(opts.headers || {}) },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

/* ── the stock ──────────────────────────────────────────────────────────────
   One list per kind of shop. Each line is [name, category, low price, high
   price, unit], and the price is picked somewhere in that band so the grid
   does not read as a spreadsheet of round numbers.

   Which list is used follows the shop's OWN `shop_type` (see CATALOGUE_FOR):
   the contact already says what it sells, so the seeder should not have to be
   told again. `--catalogue <name>` overrides it. */
const SUPERMARKET = [
  // Bakery & Sweets
  ['Arabic Flat Bread', 'Bakery & Sweets', 0.75, 1.5, 'bundle of 5'],
  ['Kaak Bread Rings', 'Bakery & Sweets', 1, 2.5, 'pack of 4'],
  ['Croissant, Butter', 'Bakery & Sweets', 1.25, 2.5, 'each'],
  ['Zaatar Manakish', 'Bakery & Sweets', 1, 2, 'each'],
  ['Cheese Manakish', 'Bakery & Sweets', 1.5, 3, 'each'],
  ['Baklava Assortment', 'Bakery & Sweets', 8, 18, '500 g box'],
  ['Maamoul with Dates', 'Bakery & Sweets', 6, 12, '400 g'],
  ['Sponge Cake', 'Bakery & Sweets', 4, 9, 'whole'],
  ['Chocolate Éclair', 'Bakery & Sweets', 1.5, 3, 'each'],
  ['Sesame Barazek', 'Bakery & Sweets', 5, 10, '300 g'],

  // Fruits & Vegetables
  ['Tomatoes, Local', 'Fruits & Vegetables', 1, 2.5, 'kg'],
  ['Cucumbers, Baby', 'Fruits & Vegetables', 1, 2.5, 'kg'],
  ['Potatoes', 'Fruits & Vegetables', 0.8, 2, 'kg'],
  ['Yellow Onions', 'Fruits & Vegetables', 0.7, 1.8, 'kg'],
  ['Lemons', 'Fruits & Vegetables', 1.2, 3, 'kg'],
  ['Bananas', 'Fruits & Vegetables', 1.5, 3, 'kg'],
  ['Apples, Red', 'Fruits & Vegetables', 2, 4, 'kg'],
  ['Oranges, Juicing', 'Fruits & Vegetables', 1, 2.5, 'kg'],
  ['Parsley, Bunch', 'Fruits & Vegetables', 0.4, 1, 'bunch'],
  ['Fresh Mint', 'Fruits & Vegetables', 0.4, 1, 'bunch'],
  ['Romaine Lettuce', 'Fruits & Vegetables', 0.8, 2, 'head'],
  ['Aubergines', 'Fruits & Vegetables', 1, 2.5, 'kg'],
  ['Green Capsicum', 'Fruits & Vegetables', 1.5, 3, 'kg'],
  ['Garlic', 'Fruits & Vegetables', 2, 5, 'kg'],
  ['Avocado', 'Fruits & Vegetables', 2.5, 5, 'each'],

  // Dairy & Eggs
  ['Full Fat Milk', 'Dairy & Eggs', 1.2, 2.5, '1 L'],
  ['Laban Yoghurt', 'Dairy & Eggs', 1.5, 3, '1 kg'],
  ['Labneh, Strained', 'Dairy & Eggs', 2.5, 5, '500 g'],
  ['Halloumi Cheese', 'Dairy & Eggs', 4, 9, '250 g'],
  ['Akkawi Cheese', 'Dairy & Eggs', 3.5, 8, '400 g'],
  ['Kashkaval Slices', 'Dairy & Eggs', 4, 8, '200 g'],
  ['Free Range Eggs', 'Dairy & Eggs', 2.5, 5, 'dozen'],
  ['Salted Butter', 'Dairy & Eggs', 3, 6, '250 g'],
  ['Cooking Cream', 'Dairy & Eggs', 1.5, 3, '200 ml'],
  ['Greek Yoghurt', 'Dairy & Eggs', 2, 4, '500 g'],

  // Meat & Poultry
  ['Chicken Breast', 'Meat & Poultry', 5, 9, 'kg'],
  ['Whole Chicken', 'Meat & Poultry', 4, 8, 'each'],
  ['Beef Mince', 'Meat & Poultry', 8, 14, 'kg'],
  ['Lamb Chops', 'Meat & Poultry', 14, 24, 'kg'],
  ['Beef Sirloin', 'Meat & Poultry', 15, 26, 'kg'],
  ['Chicken Wings', 'Meat & Poultry', 3.5, 7, 'kg'],
  ['Turkey Slices', 'Meat & Poultry', 4, 8, '200 g'],
  ['Beef Sausages', 'Meat & Poultry', 5, 10, '500 g'],

  // Fish & Seafood
  ['Sea Bass, Whole', 'Fish & Seafood', 12, 22, 'kg'],
  ['Prawns, Large', 'Fish & Seafood', 14, 26, 'kg'],
  ['Salmon Fillet', 'Fish & Seafood', 16, 28, 'kg'],
  ['Sardines, Fresh', 'Fish & Seafood', 5, 10, 'kg'],
  ['Calamari Rings', 'Fish & Seafood', 9, 16, '500 g'],

  // Grocery & Supermarket
  ['Olive Oil, Extra Virgin', 'Grocery & Supermarket', 12, 25, '1 L'],
  ['Sunflower Oil', 'Grocery & Supermarket', 3, 7, '1.5 L'],
  ['Basmati Rice', 'Grocery & Supermarket', 4, 9, '2 kg'],
  ['Bulgur Wheat, Coarse', 'Grocery & Supermarket', 2, 5, '1 kg'],
  ['Red Lentils', 'Grocery & Supermarket', 2, 5, '1 kg'],
  ['Chickpeas, Dried', 'Grocery & Supermarket', 1.5, 4, '1 kg'],
  ['Tahini, Pure Sesame', 'Grocery & Supermarket', 5, 10, '500 g'],
  ['Pomegranate Molasses', 'Grocery & Supermarket', 3, 7, '500 ml'],
  ['Table Salt', 'Grocery & Supermarket', 0.5, 1.5, '1 kg'],
  ['White Sugar', 'Grocery & Supermarket', 1.5, 3.5, '1 kg'],
  ['Spaghetti', 'Grocery & Supermarket', 1, 2.5, '500 g'],
  ['Tomato Paste', 'Grocery & Supermarket', 1, 2.5, '400 g'],
  ['Zaatar Blend', 'Grocery & Supermarket', 3, 7, '400 g'],
  ['Seven Spice Mix', 'Grocery & Supermarket', 2, 5, '100 g'],
  ['Honey, Wildflower', 'Grocery & Supermarket', 8, 18, '500 g'],
  ['Strawberry Jam', 'Grocery & Supermarket', 2.5, 5, '400 g'],
  ['Corn Flakes', 'Grocery & Supermarket', 3, 6, '500 g'],
  ['Tuna in Oil', 'Grocery & Supermarket', 1.5, 3.5, '160 g'],

  // Coffee & Tea
  ['Lebanese Coffee, Ground', 'Coffee & Tea', 5, 11, '450 g'],
  ['Espresso Beans', 'Coffee & Tea', 9, 18, '1 kg'],
  ['Instant Coffee', 'Coffee & Tea', 5, 11, '200 g'],
  ['Ceylon Tea Bags', 'Coffee & Tea', 2.5, 6, '100 bags'],
  ['Green Tea', 'Coffee & Tea', 3, 7, '50 bags'],
  ['Chamomile Infusion', 'Coffee & Tea', 2.5, 6, '25 bags'],

  // Water & Soft Drinks
  ['Mineral Water', 'Water & Soft Drinks', 0.4, 1.2, '1.5 L'],
  ['Mineral Water, Pack', 'Water & Soft Drinks', 2.5, 5, '6 × 1.5 L'],
  ['Cola', 'Water & Soft Drinks', 0.6, 1.5, '330 ml'],
  ['Orange Juice', 'Water & Soft Drinks', 1.5, 3.5, '1 L'],
  ['Sparkling Water', 'Water & Soft Drinks', 0.7, 1.8, '750 ml'],
  ['Lemon Iced Tea', 'Water & Soft Drinks', 0.8, 2, '500 ml'],
  ['Energy Drink', 'Water & Soft Drinks', 1.5, 3, '250 ml'],

  // Snacks & Confectionery
  ['Salted Potato Crisps', 'Snacks & Confectionery', 0.8, 2, '150 g'],
  ['Mixed Nuts, Roasted', 'Snacks & Confectionery', 6, 13, '500 g'],
  ['Pistachios, Salted', 'Snacks & Confectionery', 9, 18, '500 g'],
  ['Milk Chocolate Bar', 'Snacks & Confectionery', 1, 2.5, '100 g'],
  ['Dark Chocolate 70%', 'Snacks & Confectionery', 2, 4.5, '100 g'],
  ['Biscuits, Digestive', 'Snacks & Confectionery', 1.5, 3.5, '400 g'],
  ['Wafer Fingers', 'Snacks & Confectionery', 1, 2.5, '200 g'],
  ['Dried Apricots', 'Snacks & Confectionery', 4, 9, '400 g'],

  // Frozen Foods
  ['Frozen Peas', 'Frozen Foods', 1.5, 3.5, '450 g'],
  ['Frozen Mixed Vegetables', 'Frozen Foods', 2, 4.5, '750 g'],
  ['Frozen Chips', 'Frozen Foods', 2.5, 5, '1 kg'],
  ['Vanilla Ice Cream', 'Frozen Foods', 3.5, 8, '1 L'],
  ['Frozen Pizza, Margherita', 'Frozen Foods', 3.5, 7, 'each'],

  // Household & Cleaning
  ['Dish Washing Liquid', 'Household & Cleaning', 1.5, 4, '750 ml'],
  ['Laundry Detergent', 'Household & Cleaning', 6, 14, '3 kg'],
  ['Floor Cleaner', 'Household & Cleaning', 2, 5, '1 L'],
  ['Bleach', 'Household & Cleaning', 1, 3, '1 L'],
  ['Kitchen Towels', 'Household & Cleaning', 2, 5, '2 rolls'],
  ['Bin Bags', 'Household & Cleaning', 1.5, 4, '30 bags'],
  ['Aluminium Foil', 'Household & Cleaning', 2, 4.5, '30 m'],

  // Beauty & Personal Care
  ['Shampoo, Everyday', 'Beauty & Personal Care', 3, 8, '400 ml'],
  ['Bar Soap, Olive Oil', 'Beauty & Personal Care', 1, 3, '150 g'],
  ['Toothpaste', 'Beauty & Personal Care', 1.5, 4, '100 ml'],
  ['Shaving Foam', 'Beauty & Personal Care', 2.5, 6, '200 ml'],
  ['Hand Cream', 'Beauty & Personal Care', 2, 5, '75 ml'],

  // Baby & Kids
  ['Nappies, Midi', 'Baby & Kids', 9, 18, 'pack of 40'],
  ['Baby Wipes', 'Baby & Kids', 1.5, 4, '72 wipes'],
  ['Infant Formula', 'Baby & Kids', 12, 25, '400 g'],

  // Pet Supplies
  ['Dry Dog Food', 'Pet Supplies', 8, 18, '3 kg'],
  ['Cat Litter', 'Pet Supplies', 5, 11, '5 L'],
  ['Cat Food, Tinned', 'Pet Supplies', 0.8, 2, '400 g'],
]

/* An electronics shop's shelves. Same shape as the grocery list above:
   [name, category, low price, high price, unit]. */
const ELECTRONICS = [
  // Mobile Phones & Accessories
  ['Smartphone 128 GB, Midnight', 'Mobile Phones & Accessories', 260, 480, 'each'],
  ['Smartphone 256 GB, Graphite', 'Mobile Phones & Accessories', 420, 720, 'each'],
  ['Budget Smartphone 64 GB', 'Mobile Phones & Accessories', 95, 180, 'each'],
  ['Silicone Phone Case', 'Mobile Phones & Accessories', 4, 12, 'each'],
  ['Tempered Glass Screen Protector', 'Mobile Phones & Accessories', 2.5, 8, 'pack of 2'],
  ['USB-C Fast Charger 30 W', 'Mobile Phones & Accessories', 9, 22, 'each'],
  ['USB-C to Lightning Cable, 1 m', 'Mobile Phones & Accessories', 6, 16, 'each'],
  ['Braided USB-C Cable, 2 m', 'Mobile Phones & Accessories', 5, 14, 'each'],
  ['Power Bank 10 000 mAh', 'Mobile Phones & Accessories', 14, 32, 'each'],
  ['Power Bank 20 000 mAh, PD', 'Mobile Phones & Accessories', 24, 55, 'each'],
  ['Magnetic Car Phone Mount', 'Mobile Phones & Accessories', 6, 18, 'each'],
  ['Wireless Charging Pad 15 W', 'Mobile Phones & Accessories', 11, 28, 'each'],
  ['Selfie Stick Tripod', 'Mobile Phones & Accessories', 8, 22, 'each'],
  ['Phone Ring Holder', 'Mobile Phones & Accessories', 2, 6, 'each'],
  ['Dual SIM Feature Phone', 'Mobile Phones & Accessories', 22, 45, 'each'],
  ['Memory Card 128 GB microSD', 'Mobile Phones & Accessories', 10, 26, 'each'],
  ['Phone Sanitiser & Charger', 'Mobile Phones & Accessories', 18, 40, 'each'],

  // Computers & Accessories
  ['Laptop 15.6", Core i5, 16 GB', 'Computers & Accessories', 520, 880, 'each'],
  ['Laptop 14", Core i7, 16 GB', 'Computers & Accessories', 720, 1250, 'each'],
  ['Chromebook 11.6"', 'Computers & Accessories', 180, 320, 'each'],
  ['Desktop Tower, Ryzen 5', 'Computers & Accessories', 430, 760, 'each'],
  ['Monitor 24" IPS 75 Hz', 'Computers & Accessories', 110, 210, 'each'],
  ['Monitor 27" QHD 165 Hz', 'Computers & Accessories', 210, 400, 'each'],
  ['Wireless Mouse, Silent', 'Computers & Accessories', 8, 24, 'each'],
  ['Mechanical Keyboard, RGB', 'Computers & Accessories', 38, 95, 'each'],
  ['Wireless Keyboard & Mouse Set', 'Computers & Accessories', 20, 48, 'set'],
  ['Laptop Stand, Aluminium', 'Computers & Accessories', 16, 38, 'each'],
  ['USB-C Hub, 7-in-1', 'Computers & Accessories', 22, 52, 'each'],
  ['External SSD 1 TB', 'Computers & Accessories', 58, 120, 'each'],
  ['External HDD 2 TB', 'Computers & Accessories', 48, 95, 'each'],
  ['USB Flash Drive 64 GB', 'Computers & Accessories', 6, 16, 'each'],
  ['Webcam 1080p', 'Computers & Accessories', 18, 45, 'each'],
  ['Laptop Backpack 15.6"', 'Computers & Accessories', 18, 45, 'each'],
  ['Cooling Pad for Laptop', 'Computers & Accessories', 14, 34, 'each'],
  ['Wi-Fi 6 Router, Dual Band', 'Computers & Accessories', 45, 110, 'each'],
  ['Wi-Fi Range Extender', 'Computers & Accessories', 18, 42, 'each'],
  ['Network Switch, 8 Port', 'Computers & Accessories', 20, 48, 'each'],
  ['Ethernet Cable Cat6, 5 m', 'Computers & Accessories', 4, 12, 'each'],
  ['Printer, Colour Inkjet', 'Computers & Accessories', 75, 165, 'each'],
  ['Laser Printer, Mono', 'Computers & Accessories', 120, 260, 'each'],
  ['Printer Ink Cartridge Set', 'Computers & Accessories', 22, 55, 'set'],
  ['UPS 650 VA', 'Computers & Accessories', 48, 110, 'each'],
  ['Surge Protector, 6 Socket', 'Computers & Accessories', 9, 26, 'each'],

  // Gaming
  ['Games Console, 1 TB', 'Gaming', 380, 620, 'each'],
  ['Handheld Games Console', 'Gaming', 220, 380, 'each'],
  ['Wireless Controller', 'Gaming', 42, 85, 'each'],
  ['Gaming Headset, 7.1', 'Gaming', 32, 90, 'each'],
  ['Gaming Mouse, 16 000 DPI', 'Gaming', 24, 65, 'each'],
  ['Gaming Mouse Pad, XL', 'Gaming', 9, 26, 'each'],
  ['Gaming Chair, Ergonomic', 'Gaming', 130, 290, 'each'],
  ['Racing Wheel & Pedals', 'Gaming', 140, 320, 'set'],
  ['VR Headset', 'Gaming', 280, 520, 'each'],
  ['Capture Card, 4K Passthrough', 'Gaming', 75, 180, 'each'],
  ['Console Charging Dock', 'Gaming', 14, 38, 'each'],
  ['Streaming Microphone, USB', 'Gaming', 45, 130, 'each'],

  // Electronics — audio, vision, cameras
  ['Bluetooth Earbuds, ANC', 'Electronics', 28, 95, 'pair'],
  ['Over-Ear Headphones, Wireless', 'Electronics', 45, 160, 'each'],
  ['Wired Earphones, In-Ear', 'Electronics', 6, 18, 'pair'],
  ['Bluetooth Speaker, Portable', 'Electronics', 22, 70, 'each'],
  ['Bluetooth Speaker, Waterproof', 'Electronics', 35, 95, 'each'],
  ['Soundbar 2.1 with Subwoofer', 'Electronics', 90, 240, 'each'],
  ['Smart TV 43" 4K', 'Electronics', 240, 430, 'each'],
  ['Smart TV 55" 4K HDR', 'Electronics', 360, 680, 'each'],
  ['Smart TV 65" QLED', 'Electronics', 620, 1150, 'each'],
  ['TV Wall Mount, Tilting', 'Electronics', 14, 40, 'each'],
  ['Streaming Stick 4K', 'Electronics', 32, 70, 'each'],
  ['Projector, 1080p LED', 'Electronics', 120, 320, 'each'],
  ['Projector Screen, 100"', 'Electronics', 40, 110, 'each'],
  ['Action Camera 4K', 'Electronics', 85, 220, 'each'],
  ['Mirrorless Camera, 24 MP', 'Electronics', 480, 900, 'each'],
  ['Camera Tripod, Aluminium', 'Electronics', 20, 60, 'each'],
  ['Drone with 4K Camera', 'Electronics', 260, 560, 'each'],
  ['Smart Watch, AMOLED', 'Electronics', 55, 180, 'each'],
  ['Fitness Band', 'Electronics', 22, 60, 'each'],
  ['Digital Photo Frame 10"', 'Electronics', 45, 110, 'each'],
  ['E-Reader 6"', 'Electronics', 95, 190, 'each'],
  ['Tablet 10", 64 GB', 'Electronics', 130, 280, 'each'],
  ['Tablet 11", 128 GB', 'Electronics', 240, 470, 'each'],
  ['Stylus Pen, Active', 'Electronics', 22, 60, 'each'],
  ['Smart Doorbell, Wi-Fi', 'Electronics', 55, 140, 'each'],
  ['Indoor Security Camera', 'Electronics', 25, 70, 'each'],
  ['Outdoor Security Camera, 2K', 'Electronics', 45, 120, 'each'],
  ['Smart Plug, Wi-Fi', 'Electronics', 8, 22, 'each'],
  ['Smart LED Bulb, Colour', 'Electronics', 7, 20, 'each'],
  ['LED Strip Light, 5 m', 'Electronics', 12, 32, 'each'],
  ['Rechargeable Batteries AA', 'Electronics', 9, 24, 'pack of 4'],
  ['Battery Charger, Universal', 'Electronics', 12, 30, 'each'],
  ['Digital Multimeter', 'Electronics', 15, 45, 'each'],
  ['Soldering Iron Kit', 'Electronics', 18, 48, 'kit'],
  ['Extension Reel, 10 m', 'Electronics', 14, 38, 'each'],
  ['Solar Power Bank 26 800 mAh', 'Electronics', 35, 85, 'each'],
  ['Portable Power Station 300 W', 'Electronics', 190, 420, 'each'],

  // Home & Kitchen — small appliances
  ['Microwave Oven 20 L', 'Home & Kitchen', 75, 160, 'each'],
  ['Air Fryer 5.5 L', 'Home & Kitchen', 60, 150, 'each'],
  ['Electric Kettle 1.7 L', 'Home & Kitchen', 16, 45, 'each'],
  ['Espresso Machine, Pump', 'Home & Kitchen', 110, 290, 'each'],
  ['Blender 1000 W', 'Home & Kitchen', 30, 85, 'each'],
  ['Food Processor', 'Home & Kitchen', 55, 140, 'each'],
  ['Stand Mixer 5 L', 'Home & Kitchen', 120, 300, 'each'],
  ['Toaster, 2 Slice', 'Home & Kitchen', 18, 48, 'each'],
  ['Vacuum Cleaner, Cordless', 'Home & Kitchen', 95, 260, 'each'],
  ['Robot Vacuum', 'Home & Kitchen', 160, 380, 'each'],
  ['Steam Iron', 'Home & Kitchen', 20, 55, 'each'],
  ['Hair Dryer 2200 W', 'Home & Kitchen', 18, 55, 'each'],
  ['Electric Shaver', 'Home & Kitchen', 35, 110, 'each'],
  ['Air Purifier, HEPA', 'Home & Kitchen', 85, 220, 'each'],
  ['Tower Fan, Remote', 'Home & Kitchen', 45, 120, 'each'],
  ['Dehumidifier 12 L', 'Home & Kitchen', 110, 250, 'each'],
  ['Electric Water Heater 30 L', 'Home & Kitchen', 90, 200, 'each'],
]

const CATALOGUES = { supermarket: SUPERMARKET, electronics: ELECTRONICS }

/* A shop's business type (contacts.shop_type, from DEFAULT_BUSINESS_TYPES) to
   the list it should be stocked from. Anything unlisted falls back to the
   grocery shelves, which suit the widest range of shops. */
const CATALOGUE_FOR = (shopType) => {
  const t = String(shopType || '').toLowerCase()
  if (/electronic|mobile|computer|gaming/.test(t)) return 'electronics'
  return 'supermarket'
}

/* A colour per category, so the generated pictures group the way the shelves
   do — the produce is green, the fish is blue, the bakery is warm. */
const HUES = {
  'Bakery & Sweets':        [[214, 150, 74], [150, 92, 44]],
  'Fruits & Vegetables':    [[112, 176, 84], [46, 110, 64]],
  'Dairy & Eggs':           [[236, 226, 198], [186, 166, 118]],
  'Meat & Poultry':         [[198, 96, 92], [128, 48, 54]],
  'Fish & Seafood':         [[104, 168, 196], [40, 92, 132]],
  'Grocery & Supermarket':  [[196, 168, 116], [120, 96, 64]],
  'Coffee & Tea':           [[152, 112, 78], [78, 54, 40]],
  'Water & Soft Drinks':    [[110, 178, 208], [44, 106, 148]],
  'Snacks & Confectionery': [[214, 136, 88], [136, 70, 52]],
  'Frozen Foods':           [[150, 190, 214], [72, 116, 156]],
  'Household & Cleaning':   [[122, 168, 190], [58, 96, 124]],
  'Beauty & Personal Care': [[204, 148, 176], [128, 76, 116]],
  'Baby & Kids':            [[224, 176, 136], [164, 112, 96]],
  'Pet Supplies':           [[168, 156, 124], [98, 88, 66]],
  // electronics
  'Electronics':                  [[104, 132, 190], [46, 62, 116]],
  'Mobile Phones & Accessories':  [[126, 166, 198], [54, 84, 128]],
  'Computers & Accessories':      [[132, 140, 158], [62, 68, 88]],
  'Gaming':                       [[158, 116, 196], [82, 48, 124]],
  'Home & Kitchen':               [[176, 150, 138], [104, 82, 76]],
}
const DEFAULT_HUE = [[150, 150, 160], [80, 80, 96]]

/* A picture for one item.
 *
 * Not a photograph and not pretending to be: a diagonal wash in the category's
 * colours, a soft disc where the goods would be, and a band across the foot
 * where a label would sit. What it has to do is fill a card, differ from its
 * neighbours, and weigh what a real photograph weighs after resizing — so the
 * gallery being measured is loading something honest. */
function drawItem(name, category, variant = 0) {
  const W = 640, H = 640
  const [c1, c2] = HUES[category] || DEFAULT_HUE
  const buf = Buffer.alloc(W * H * 3)

  // A per-item seed, so the same item always draws the same picture.
  let seed = variant * 7919
  for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) >>> 0
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }

  const angle = rnd() * Math.PI
  const dx = Math.cos(angle), dy = Math.sin(angle)
  const cx = 0.5 + (rnd() - 0.5) * 0.18
  const cy = 0.46 + (rnd() - 0.5) * 0.12
  const radius = 0.21 + rnd() * 0.08
  // Lightened towards white but keeping most of the category's colour: at a
  // heavier wash every disc came out the same near-white and the grid stopped
  // telling one shelf from another.
  const tint = [c1[0] * 0.62 + 86, c1[1] * 0.62 + 86, c1[2] * 0.62 + 86]

  for (let y = 0; y < H; y++) {
    const v = y / H
    for (let x = 0; x < W; x++) {
      const u = x / W
      // the wash
      const t = Math.min(1, Math.max(0, (u * dx + v * dy) * 0.9 + 0.1))
      let r = c1[0] + (c2[0] - c1[0]) * t
      let g = c1[1] + (c2[1] - c1[1]) * t
      let b = c1[2] + (c2[2] - c1[2]) * t

      // the disc, feathered so it reads as a lit object rather than a sticker
      const d = Math.hypot(u - cx, v - cy)
      if (d < radius + 0.03) {
        // A tight feather: enough that the edge is not stepped, not so much
        // that the shape dissolves into the wash behind it.
        const k = Math.min(1, Math.max(0, (radius + 0.03 - d) / 0.05)) * 0.92
        const lit = Math.max(0, 1 - Math.hypot(u - cx + 0.07, v - cy + 0.08) / (radius * 1.6))
        r += (tint[0] + lit * 54 - r) * k
        g += (tint[1] + lit * 54 - g) * k
        b += (tint[2] + lit * 54 - b) * k
      }

      // the label band
      if (v > 0.80 && v < 0.925) {
        const k = v < 0.815 || v > 0.91 ? 0.35 : 0.72
        r += (250 - r) * k; g += (250 - g) * k; b += (250 - b) * k
      }

      const o = (y * W + x) * 3
      buf[o] = r < 0 ? 0 : r > 255 ? 255 : r
      buf[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g
      buf[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b
    }
  }
  return encodePNG(W, H, buf)
}

async function upload(bytes, name) {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 8)
  const objectPath = `items/seed-${stamp}-${rand}.png`
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: { ...H, 'content-type': 'image/png', 'cache-control': 'max-age=31536000', 'x-upsert': 'false' },
    body: bytes,
  })
  if (!r.ok) {
    const t = await r.text()
    if (/bucket not found|nosuchbucket/i.test(t)) throw new Error('The shop-media bucket is missing — run supabase-fix143.sql first.')
    throw new Error(`upload of "${name}" failed ${r.status}: ${t.slice(0, 160)}`)
  }
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${objectPath}`
}

/* Run `jobs` a few at a time. One at a time is needlessly slow for a hundred
   uploads; all hundred at once is a good way to be rate limited. */
async function pool(jobs, size, onDone) {
  const out = new Array(jobs.length)
  let next = 0, done = 0
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++
      out[i] = await jobs[i]()
      done += 1
      if (onDone) onDone(done, jobs.length)
    }
  }))
  return out
}

;(async () => {
  const existing = await rest('shop_inventory?select=owner_contact_id,company_id,description')

  let ownerId = null
  if (USER) {
    const [account] = await rest(`user_accounts?select=contact_id,company_id,username,role&username=eq.${encodeURIComponent(USER)}`)
    if (!account) throw new Error(`No user account called "${USER}".`)
    if (!account.contact_id) throw new Error(`"${USER}" is not linked to a contact, so it has no shop.`)
    ownerId = account.contact_id
  } else {
    // Nobody named: the shop with the most stock in it is the one being worked on.
    if (existing.length === 0) throw new Error('No shop items at all — name a shop with --user.')
    const counts = {}
    for (const r of existing) counts[r.owner_contact_id] = (counts[r.owner_contact_id] || 0) + 1
    ownerId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
  }

  const companyId = existing.find(r => r.owner_contact_id === ownerId)?.company_id
    ?? (await rest(`contacts?select=company_id&id=eq.${ownerId}`))[0]?.company_id
    ?? null
  const [owner] = await rest(`contacts?select=id,first_name,last_name,company_name,shop_type&id=eq.${ownerId}`)
  const who = owner.company_name || `${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim()

  const listName = LIST || CATALOGUE_FOR(owner.shop_type)
  const CATALOGUE = CATALOGUES[listName]
  if (!CATALOGUE) throw new Error(`No catalogue called "${listName}". Try: ${Object.keys(CATALOGUES).join(', ')}`)

  console.log(`Shop: ${who}  (${owner.shop_type || 'shop'})`)
  console.log(`Owner contact: ${ownerId}`)
  console.log(`Stocking from the ${listName} catalogue — ${CATALOGUE.length} distinct lines.`)

  if (UNDO) {
    const mine = await rest(`shop_inventory?select=id,name&owner_contact_id=eq.${ownerId}&description=like.*${encodeURIComponent(SEED_TAG)}*`)
    console.log(`\n${mine.length} seeded item(s) to remove.`)
    if (DRY) { console.log('Dry run — nothing removed.'); return }
    for (const row of mine) await rest(`shop_inventory?id=eq.${row.id}`, { method: 'DELETE' })
    console.log(`Removed ${mine.length}. Hand-made items untouched.`)
    return
  }

  const already = existing.filter(r => r.owner_contact_id === ownerId && String(r.description || '').includes(SEED_TAG)).length
  if (already > 0) console.log(`\n${already} seeded item(s) already there — run with --undo first to replace them.`)

  // Cycle the catalogue if more items are asked for than it lists, numbering the
  // repeats so no two rows share a name.
  const picks = []
  for (let i = 0; i < COUNT; i++) {
    const [name, category, lo, hi, unit] = CATALOGUE[i % CATALOGUE.length]
    const round = Math.floor(i / CATALOGUE.length)
    picks.push({ name: round ? `${name} (${round + 1})` : name, category, lo, hi, unit, i })
  }

  console.log(`\n${DRY ? 'Would create' : 'Creating'} ${picks.length} item(s) across ${new Set(picks.map(p => p.category)).size} categories.`)
  if (DRY) {
    for (const p of picks.slice(0, 12)) console.log(`  ${p.name.padEnd(32)} ${p.category}`)
    console.log(`  … and ${picks.length - 12} more`)
    const sample = drawItem(picks[0].name, picks[0].category)
    console.log(`\nA generated picture is ${(sample.length / 1024).toFixed(0)} KB (640×640 PNG).`)
    console.log('Run again without --dry-run to create them.')
    return
  }

  // Draw and upload the pictures first: an item is only worth inserting once it
  // has something to show, and a failed upload should not leave a bald row.
  process.stdout.write('Drawing and uploading pictures  ')
  const jobs = picks.map(p => async () => {
    let seed = 0
    for (let k = 0; k < p.name.length; k++) seed = (seed * 31 + p.name.charCodeAt(k)) >>> 0
    const second = seed % 10 < 3          // about a third get a second photograph
    const urls = [await upload(drawItem(p.name, p.category, 0), p.name)]
    if (second) urls.push(await upload(drawItem(p.name, p.category, 1), p.name))
    return urls
  })
  const shots = await pool(jobs, 6, (done, total) => {
    if (done % 10 === 0 || done === total) process.stdout.write(`${done}/${total} `)
  })
  console.log('')

  const rows = picks.map((p, n) => {
    let seed = p.i * 2654435761
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const price = Math.round((p.lo + (p.hi - p.lo) * rnd()) * 100) / 100
    // Between 5 and 20 pieces, and a different number on each line: a shelf
    // where every item reads "12 in stock" is obviously a fixture, and the
    // stock badge in the customer app is one of the things being demonstrated.
    const stock = 5 + Math.floor(rnd() * 16)
    return {
      owner_contact_id: ownerId,
      company_id: companyId,
      name: p.name,
      description: `${p.unit}. ${SEED_TAG}`,
      price,
      currency: 'USD',
      images: shots[n],
      image_url: shots[n][0],
      stock_qty: stock,
      category: p.category,
      categories: [p.category],
      is_displayed: true,
      is_active: true,
      is_made_to_order: false,
      options: [],
      combos: [],
      colors: [],
      sizes: [],
    }
  })

  // In batches: one request per row is a hundred round trips, and one request
  // with a hundred rows is a payload PostgREST would rather not be handed.
  let made = 0
  for (let i = 0; i < rows.length; i += 20) {
    const slice = rows.slice(i, i + 20)
    await rest('shop_inventory', { method: 'POST', body: JSON.stringify(slice), headers: { prefer: 'return=minimal' } })
    made += slice.length
    process.stdout.write(`\rInserting  ${made}/${rows.length}`)
  }
  console.log('')

  const totalShots = shots.reduce((a, s) => a + s.length, 0)
  console.log(`\nDone. ${made} items, ${totalShots} pictures in the ${BUCKET} bucket.`)
  console.log(`Remove them again with:  node scripts/seed-shop-items.cjs --undo`)
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1) })
