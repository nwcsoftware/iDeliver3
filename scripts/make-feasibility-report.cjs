/* Builds the delivery-business feasibility study from the operating database.

   Reads the extracts produced alongside it (summary.json / feasibility.json),
   draws its charts as inline SVG — no chart library, nothing fetched — and
   writes an A4 HTML document in the same house style as the agreements.

     node scripts/make-feasibility-report.cjs            → English
     node scripts/make-feasibility-report.cjs --lang=ar  → Arabic (RTL)
     node scripts/make-doc-pdf.cjs docs/<file>.html      → the PDF

   ONE script for both languages, and one set of figures behind them: a study
   that says something different in Arabic than in English is worse than having
   no Arabic at all. Only the words are translated — every number, chart and
   calculation is the same object rendered twice.

   Numerals stay Western (١٢٣ is not what a Lebanese invoice uses), and each
   Latin run inside Arabic text is isolated with <bdi> so the bidirectional
   algorithm cannot reorder "USD 5.36" into "5.36 USD".                       */

const fs = require('fs')
const path = require('path')

const LANG  = (process.argv.find(a => a.startsWith('--lang=')) || '').split('=')[1] || 'en'
const AR    = LANG === 'ar'
const STATS = process.argv.find(a => !a.startsWith('--') && a.includes('stats'))
            || path.join(process.env.LOCALAPPDATA, 'Temp', 'claude', 'stats')
const OUT   = path.join(__dirname, '..', 'docs',
  `iDeliver-III-Feasibility-Study-2026-08-23${AR ? '-AR' : ''}.html`)

const S = JSON.parse(fs.readFileSync(path.join(STATS, 'summary.json'), 'utf8'))
const F = JSON.parse(fs.readFileSync(path.join(STATS, 'feasibility.json'), 'utf8'))

/* ── formatting ─────────────────────────────────────────────────────────── */
const n0 = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const n2 = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Latin run inside Arabic text: isolated so bidi cannot reorder it.
const L  = s => (AR ? `<bdi class="en">${s}</bdi>` : String(s))
const usd = n => L(AR ? `${n2(n)} $` : `USD ${n2(n)}`)
const pct = n => L(`${n2(n)}%`)
const num = n => L(n0(n))
const dmy = iso => { const [y, m, d] = String(iso).split('-'); return L(`${d}/${m}/${y}`) }

/* ── the words ──────────────────────────────────────────────────────────────
   Kept as one table so a phrase cannot exist in one language and not the
   other. Anything with a {0} takes a figure at render time. */
const T = {
  brand:        ['3asari3 · iDeliver III', '3asari3 · iDeliver III'],
  title:        ['Delivery Business — Feasibility Study', 'دراسة جدوى أعمال التوصيل'],
  subtitle:     ['Trading from {0} to {1} · {2} days of operation',
                 'التشغيل من {0} إلى {1} · {2} يوماً من العمل'],
  readNote:     ['Every figure read directly from the operating database on {0}.',
                 'جميع الأرقام مقروءة مباشرةً من قاعدة بيانات التشغيل بتاريخ {0}.'],

  kOrders:      ['Orders delivered', 'الطلبات المُسلَّمة'],
  kOrdersSub:   ['of {0} raised · {1}', 'من أصل {0} طلب · {1}'],
  kRevenue:     ['Our revenue', 'إيراد الشركة'],
  kRevenueSub:  ['{0} per day', '{0} يومياً'],
  kPerOrder:    ['Revenue per order', 'الإيراد لكل طلب'],
  kPerOrderSub: ['{0} orders / month', '{0} طلب شهرياً'],
  kCash:        ['Cash collected', 'النقد المحصَّل'],
  kCashSub:     ['{0} of what was charged', '{0} مما تمّت فوترته'],

  finding:      ['The finding', 'الخلاصة'],
  verdict1:     ['<b>The operation is viable on its own revenue.</b> In {0} days it moved {1} orders — {2} a day — and kept <b>{3}</b> of the {4} it handled. That is <b>{5} a month</b>, or {6} annualised at the current run-rate, against a platform cost of USD 600 a year: the software is <b>{7}</b> of revenue.',
                 '<b>العملية قابلة للاستمرار من إيراداتها الذاتية.</b> خلال {0} يوماً نُفِّذ {1} طلباً — بمعدل {2} يومياً — واحتفظت الشركة بـ<b>{3}</b> من أصل {4} مرّت عبرها. أي <b>{5} شهرياً</b>، أو {6} سنوياً على وتيرة التشغيل الحالية، مقابل كلفة منصّة قدرها 600 دولار سنوياً: أي أن البرمجية تمثّل <b>{7}</b> من الإيراد.'],
  verdict2:     ['The business breaks even while the all-in cost of making a delivery stays under <b>{0}</b>. At {1} active drivers each completing about {2} deliveries a day, that is the number to manage.',
                 'يتحقّق التعادل ما دامت الكلفة الشاملة لتنفيذ التوصيلة دون <b>{0}</b>. ومع {1} سائقاً فعّالاً ينفّذ كل منهم نحو {2} توصيلة يومياً، فهذا هو الرقم الواجب ضبطه.'],

  ordersPerDay: ['Orders per day', 'الطلبات يومياً'],
  legOrders:    ['Orders raised', 'الطلبات المُسجَّلة'],
  legAvg:       ['7-day average', 'متوسط 7 أيام'],
  whereFrom:    ['Where the work comes from', 'مصدر الطلبات'],
  whereNote:    ['The call centre still raises {0} of all orders. The customer app and the partner portal together account for {1} — the growth room.',
                 'لا يزال مركز الاتصال يسجّل {0} من مجموع الطلبات، فيما يشكّل تطبيق الزبون وبوّابة الشركاء معاً {1} — وهي مساحة النمو المتاحة.'],
  monthOnMonth: ['Month on month', 'مقارنة شهرية'],
  thMonth:      ['Month', 'الشهر'],  thDays: ['Days', 'الأيام'],
  thOrders:     ['Orders', 'الطلبات'], thOrdersDay: ['Orders/day', 'طلبات/يوم'],
  thRevDay:     ['Revenue/day', 'إيراد/يوم'],
  monthNote:    ['August is running <b>{0}</b> ahead of July on orders per day and <b>{1}</b> ahead on revenue per day, on {2} days of trading.',
                 'يسجّل شهر آب تقدّماً بنسبة <b>{0}</b> على تموز في عدد الطلبات اليومي، و<b>{1}</b> في الإيراد اليومي، خلال {2} يوماً من التشغيل.'],
  footFx:       ['Prepared for 3asari3 · Figures in USD; LBP converted at {0} LBP/USD (stated assumption).',
                 'أُعدّت لـ 3asari3 · الأرقام بالدولار الأميركي؛ حُوِّلت الليرة اللبنانية على أساس {0} ل.ل./دولار (فرضية معلنة).'],

  p2title:      ['Volume, revenue and what the business actually keeps',
                 'الحجم والإيراد وما تحتفظ به الشركة فعلياً'],
  revPerDay:    ['Revenue per day (USD equivalent)', 'الإيراد اليومي (بما يعادل الدولار)'],
  legRev:       ['Delivery fees + commission earned that day', 'رسوم التوصيل + العمولة المكتسبة في اليوم'],
  handledVsKept:['Money handled versus money kept', 'الأموال المُدارة مقابل الأموال المحتفظ بها'],
  handledNote:  ['Most of what the business touches is not its own. Goods and packages worth <b>{0}</b> passed through in {1} days; the delivery fees on top of them — <b>{2}</b> — are what the business earns for moving them, together with {3} of shop commission and {4} of advertising. Reading the handled figure as turnover would overstate the business by <b>{5}×</b>.',
                 'معظم ما يمرّ عبر الشركة ليس ملكاً لها. فقد مرّت بضائع وطرود بقيمة <b>{0}</b> خلال {1} يوماً؛ أما رسوم التوصيل المُحتسبة فوقها — <b>{2}</b> — فهي ما تكسبه الشركة مقابل نقلها، إضافةً إلى {3} عمولات متاجر و{4} إعلانات. واعتبار المبلغ المُدار رقم أعمال يضخّم حجم الشركة <b>{5}</b> مرّة.'],
  thLine:       ['Revenue line', 'بند الإيراد'], thUsd: ['USD', 'دولار'],
  thShare:      ['Share', 'الحصة'], thWhat: ['What it is', 'التعريف'],
  lineFees:     ['Delivery fees', 'رسوم التوصيل'],
  lineFeesD:    ['Charged per order for the delivery itself', 'تُحتسب على كل طلب مقابل التوصيل نفسه'],
  lineComm:     ['Shop commission', 'عمولة المتاجر'],
  lineCommD:    ["Earned on goods bought on a customer's behalf", 'تُكتسب على البضائع المشتراة نيابةً عن الزبون'],
  lineAds:      ['Advertising', 'الإعلانات'],
  lineAdsD:     ['Story placements sold to partners', 'مساحات إعلانية تُباع للشركاء'],
  lineTotal:    ['Total', 'المجموع'],
  perOrderD:    ['{0} per order', '{0} لكل طلب'],
  commTitle:    ['One line is not being collected.', 'بند غير محصَّل.'],
  commBody:     ['Of {0} of commission earned on procurement invoices, only <b>{1}</b> — {2} — has been marked collected. It is small against fees today, but it is the line that grows with the shop module, and an uncollected commission is indistinguishable from one that was never charged.',
                 'من أصل {0} عمولات مكتسبة على فواتير الشراء، لم يُسجَّل كمحصَّل سوى <b>{1}</b> — أي {2}. المبلغ صغير اليوم قياساً بالرسوم، لكنه البند الذي ينمو مع وحدة المتجر، والعمولة غير المحصَّلة لا تختلف عملياً عن عمولة لم تُطلب أصلاً.'],
  feeCover:     ['Fee coverage', 'تغطية الرسوم'],
  feeCoverBody: ['{0} of {1} orders carry a delivery fee. The remaining <b>{2}</b> ({3}) went out with none — free deliveries, waived charges, or a fee left blank at entry. At the average of {4} that is <b>{5}</b> of foregone revenue over {6} days.',
                 'يحمل {0} طلباً من أصل {1} رسم توصيل، بينما خرج <b>{2}</b> طلباً ({3}) بلا أي رسم — توصيل مجاني أو إعفاء أو حقل تُرك فارغاً عند الإدخال. وبمتوسط {4} يعادل ذلك <b>{5}</b> من الإيراد الضائع خلال {6} يوماً.'],
  footRev:      ['Revenue counts what the business keeps. Goods, packages and shop invoices are customers’ money in transit and are excluded.',
                 'الإيراد يحتسب ما تحتفظ به الشركة. أما البضائع والطرود وفواتير المتاجر فهي أموال زبائن عابرة ومستثناة منه.'],

  p3title:      ['Cash, collection and the customer base', 'النقد والتحصيل وقاعدة الزبائن'],
  whoHolds:     ['Who holds the money', 'من يحتفظ بالنقد'],
  drivers:      ['Drivers', 'السائقون'], office: ['Office', 'المكتب'],
  whoHoldsNote: ['Drivers collected <b>{0}</b> of the {1} taken in — about <b>{2} per driver per day</b> in hand. That is the single largest operational risk in the model, and the reason the driver-dues and cashier-box controls exist.',
                 'حصّل السائقون <b>{0}</b> من أصل {1} — أي نحو <b>{2} لكل سائق يومياً</b> في عهدتهم. وهذا أكبر خطر تشغيلي منفرد في النموذج، وسبب وجود ضوابط ذمم السائقين وصندوق المحاسبة.'],
  collPerf:     ['Collection performance', 'أداء التحصيل'],
  thMeasure:    ['Measure', 'المؤشر'],
  mCharged:     ['Charged (goods + fees)', 'المفوتر (بضائع + رسوم)'],
  mCollected:   ['Collected', 'المحصَّل'],
  mRate:        ['Collection rate', 'نسبة التحصيل'],
  mOutstanding: ['Outstanding', 'المتبقّي'],
  collNote:     ['A {0} collection rate on cash-on-delivery is the number that makes this business fundable: the working-capital cycle is days, not months, and there is no receivables book to speak of beyond the credit customers.',
                 'نسبة تحصيل تبلغ {0} على الدفع عند التسليم هي الرقم الذي يجعل هذا العمل قابلاً للتمويل: دورة رأس المال العامل بالأيام لا بالأشهر، ولا يوجد دفتر ذمم يُذكر خارج زبائن الحساب الآجل.'],
  custBase:     ['The customer base', 'قاعدة الزبائن'],
  kServed:      ['Customers served', 'الزبائن المخدومون'],
  kServedSub:   ['{0} orders each', '{0} طلب لكل زبون'],
  kReturn:      ['Came back', 'عادوا للطلب'],
  kReturnSub:   ['{0} of {1}', '{0} من {1}'],
  kRepeatShare: ['Orders from repeats', 'طلبات الزبائن المتكرّرين'],
  kRepeatSub:   ['{0} orders', '{0} طلب'],
  kConc:        ['Top-10 concentration', 'تركّز أكبر 10'],
  kConcSub:     ['of all orders', 'من مجموع الطلبات'],
  custNote:     ['<b>Half the customers came back, and they bring nine orders in ten.</b> A delivery business lives or dies on that ratio: acquiring {0} customers is a cost paid once, and {1} of the volume since has come from customers already won. The counterweight is concentration — the ten largest accounts alone are {2} of orders, so losing two or three of them would be felt immediately.',
                 '<b>نصف الزبائن عادوا، وهم يأتون بتسعة طلبات من كل عشرة.</b> أعمال التوصيل تقوم أو تسقط على هذه النسبة: كسب {0} زبون كلفة تُدفع مرّة واحدة، ومنذ ذلك الحين جاء {1} من الحجم من زبائن مكتسبين سلفاً. يقابل ذلك التركّز — إذ تشكّل أكبر عشرة حسابات وحدها {2} من الطلبات، وفقدان اثنين أو ثلاثة منها سيُلمَس فوراً.'],
  busiestAcc:   ['Busiest accounts', 'أكثر الحسابات نشاطاً'],
  busiestPart:  ['Busiest partners (packages)', 'أكثر الشركاء نشاطاً (الطرود)'],
  footPartners: ['{0} partners handed us {1} packages in the period.',
                 'سلّمنا {0} شريكاً ما مجموعه {1} طرداً خلال الفترة.'],

  p4title:      ['Capacity, cost and the break-even', 'الطاقة والكلفة ونقطة التعادل'],
  fleet:        ['Fleet', 'الأسطول'],
  kDrivers:     ['Drivers used', 'السائقون العاملون'],
  kDriversSub:  ['of {0} on file', 'من أصل {0} مسجّلين'],
  kPerDriver:   ['Deliveries / driver / day', 'توصيلات / سائق / يوم'],
  kPerDriverSub:['across {0} days', 'على مدى {0} يوماً'],
  kRevDriver:   ['Revenue / driver / day', 'إيراد / سائق / يوم'],
  kRevDriverSub:['before driver cost', 'قبل كلفة السائق'],
  kCashDriver:  ['Cash / driver / day', 'نقد / سائق / يوم'],
  kCashDriverSub:['held before settlement', 'في العهدة قبل التسوية'],
  fleetNote:    ['Work is spread unevenly: the busiest driver carries {0} of all deliveries while the quietest of the eight carries {1}. Levelling that is capacity that already exists and is not being used.',
                 'توزيع العمل غير متوازن: يحمل أنشط سائق {0} من مجموع التوصيلات بينما يحمل أقلّهم بين الثمانية {1}. وتسوية هذا الفارق طاقةٌ قائمة أصلاً وغير مستثمَرة.'],
  unknown:      ['What the database cannot tell us', 'ما لا تستطيع قاعدة البيانات قوله'],
  unknownBody:  ['The software records every order, fee and collection, so the revenue side of this study is measured, not estimated. It does not record <b>what the operation costs</b> — driver pay, fuel, phones, rent, office salaries. Rather than invent a figure, the table below models profit across a range of driver costs and office overheads. The only cost the system does know is the platform itself: <b>USD 600 a year</b>, or {0} for this period — {1} of revenue.',
                 'يسجّل النظام كل طلب ورسم وتحصيل، لذا فإن جانب الإيراد في هذه الدراسة مُقاس لا مُقدَّر. لكنه لا يسجّل <b>كلفة التشغيل</b> — أجور السائقين والوقود والهواتف والإيجار ورواتب المكتب. وبدلاً من افتراض رقم، يُنمذج الجدول أدناه الربح عبر مروحة من كلف السائقين ومصاريف المكتب. والكلفة الوحيدة التي يعرفها النظام هي المنصّة نفسها: <b>600 دولار سنوياً</b>، أي {0} لهذه الفترة — {1} من الإيراد.'],
  sensTitle:    ['Monthly profit at {0} orders / month · revenue {1}',
                 'الربح الشهري عند {0} طلب شهرياً · إيراد {1}'],
  thDriverCost: ['Driver cost', 'كلفة السائق'],
  thFleetMonth: ['Fleet / month', 'الأسطول شهرياً'],
  thNoOh:       ['No overhead', 'بلا مصاريف مكتب'],
  thPlus:       ['+ USD {0}', '+ {0} دولار'],
  thBreakEven:  ['Break-even orders', 'طلبات التعادل'],
  driverPerDay: ['USD {0} / driver / day', '{0} دولار / سائق / يوم'],
  legNoOh:      ['No office overhead', 'بلا مصاريف مكتب'],
  verdictCost:  ['<b>The operation clears its costs across every case modelled.</b> Even at USD 40 per driver per day with USD 1,500 of monthly office overhead, the month closes at <b>{0}</b>. The margin comes from volume the fleet is already carrying, not from a price rise: {1} deliveries per driver per day at {2} each.',
                 '<b>تغطّي العملية كلفتها في كل الحالات المُنمذجة.</b> فحتى عند 40 دولاراً لكل سائق يومياً مع 1,500 دولار مصاريف مكتب شهرية، يُقفل الشهر على <b>{0}</b>. والهامش يأتي من حجمٍ يحمله الأسطول أصلاً، لا من رفع السعر: {1} توصيلة لكل سائق يومياً بقيمة {2} للواحدة.'],
  footFleet:    ['Fleet cost assumes {0} drivers working 26 days a month. Break-even orders = the volume that covers fleet and platform cost alone.',
                 'كلفة الأسطول مبنية على {0} سائقاً يعملون 26 يوماً شهرياً. طلبات التعادل = الحجم الذي يغطّي كلفة الأسطول والمنصّة وحدهما.'],

  p5title:      ['What to watch, and how this was measured', 'ما يجب مراقبته، وكيف قيس ذلك'],
  risksTitle:   ['Risks the data itself shows', 'مخاطر تظهرها البيانات نفسها'],
  thRisk:       ['Risk', 'الخطر'], thSays: ['What the data says', 'ما تقوله البيانات'],
  thMeans:      ['What it means', 'الدلالة'],
  r1:           ['Cash held by drivers', 'النقد في عهدة السائقين'],
  r1a:          ['{0} collected in the field, {1} of all cash', '{0} محصَّلة ميدانياً، أي {1} من مجموع النقد'],
  r1b:          ['About {0} per driver per day in hand before settlement. Daily reconciliation is not administration here; it is the control.',
                 'نحو {0} لكل سائق يومياً في العهدة قبل التسوية. والمطابقة اليومية هنا ليست إجراءً إدارياً بل هي الضابط نفسه.'],
  r2_:          ['Customer concentration', 'تركّز الزبائن'],
  r2a:          ['Top 10 accounts = {0} of orders', 'أكبر 10 حسابات = {0} من الطلبات'],
  r2b:          ['Losing two or three large accounts would show up in the week it happened. Widening the base matters more than raising the fee.',
                 'فقدان حسابين أو ثلاثة كبار سيظهر في الأسبوع نفسه. وتوسيع القاعدة أهم من رفع الرسم.'],
  r3:           ['One channel', 'قناة واحدة'],
  r3a:          ['{0} of orders still come through the call centre', '{0} من الطلبات لا تزال تمرّ عبر مركز الاتصال'],
  r3b:          ['Every order costs staff time to key in. The customer app and partner portal are the only routes that scale without adding staff.',
                 'كل طلب يكلّف وقت موظف لإدخاله. وتطبيق الزبون وبوّابة الشركاء هما المساران الوحيدان اللذان يتوسّعان دون زيادة الموظفين.'],
  r4:           ['Commission not collected', 'عمولة غير محصَّلة'],
  r4a:          ['{0} of {1} earned', '{0} من أصل {1} مكتسبة'],
  r4b:          ['A small line today, but the one that grows with the shop module. Uncollected is indistinguishable from never charged.',
                 'بند صغير اليوم، لكنه ينمو مع وحدة المتجر. وغير المحصَّل لا يختلف عمّا لم يُطلب أصلاً.'],
  r5:           ['Free deliveries', 'التوصيل المجاني'],
  r5a:          ['{0} orders ({1}) carry no fee', '{0} طلباً ({1}) بلا رسم'],
  r5b:          ['Worth about {0} over {1} days. Deliberate or not, it should be a decision rather than a default.',
                 'بقيمة نحو {0} خلال {1} يوماً. سواء كان مقصوداً أم لا، يجب أن يكون قراراً لا وضعاً افتراضياً.'],
  r6:           ['Currency', 'العملة'],
  r6a:          ['Both USD and LBP in daily use', 'الدولار والليرة مستخدمان يومياً'],
  r6b:          ['This study converts at {0} LBP/USD. A 10% move in the rate moves the reported revenue materially — every LBP figure should be read with that in mind.',
                 'تعتمد هذه الدراسة سعر {0} ل.ل./دولار. وتحرّك السعر بنسبة 10% يحرّك الإيراد المُعلن بشكل ملموس — وينبغي قراءة كل رقم بالليرة على هذا الأساس.'],
  moveMost:     ['What would move the numbers most', 'ما الذي يحرّك الأرقام أكثر'],
  a1:           ['<b>Level the fleet.</b> The busiest driver does several times the work of the quietest. Bringing the bottom half up to the median is capacity already paid for.',
                 '<b>موازنة الأسطول.</b> ينجز أنشط سائق أضعاف ما ينجزه أقلّهم. ورفع النصف الأدنى إلى الوسيط طاقةٌ مدفوعة كلفتها سلفاً.'],
  a2:           ['<b>Move orders off the call centre.</b> {0} of orders arrive through the app or the portal today. Every point moved is staff time returned.',
                 '<b>تحويل الطلبات عن مركز الاتصال.</b> يصل اليوم {0} من الطلبات عبر التطبيق أو البوّابة. وكل نقطة تُحوَّل هي وقت موظف يُستعاد.'],
  a3:           ['<b>Collect the commission.</b> {0} of it is still outstanding; the mechanism exists and is not being used.',
                 '<b>تحصيل العمولة.</b> لا يزال {0} منها غير محصَّل؛ والآلية موجودة وغير مستخدمة.'],
  a4:           ['<b>Decide the free deliveries.</b> {0} of orders carry no fee — worth roughly {1} a month.',
                 '<b>حسم مسألة التوصيل المجاني.</b> {0} من الطلبات بلا رسم — بما يعادل نحو {1} شهرياً.'],
  method:       ['Method', 'المنهجية'],
  methodBody:   ['Every figure was read directly from the operating database on {0}, covering orders created between {1} and {2} inclusive — {3} days. {4} orders were examined, together with {5} packages, the retail invoices raised against them, and {6} payment collections. No sampling, and no projection except where a line is explicitly labelled as annualised or a per-month run-rate.',
                 'قُرئت جميع الأرقام مباشرةً من قاعدة بيانات التشغيل بتاريخ {0}، وتغطّي الطلبات المُنشأة بين {1} و{2} ضمناً — أي {3} يوماً. جرى فحص {4} طلباً، مع {5} طرداً، وفواتير المتاجر المرتبطة بها، و{6} عملية تحصيل. من دون أخذ عيّنات، ومن دون إسقاطات إلا حيث يُذكر صراحةً أن الرقم سنوي أو على وتيرة شهرية.'],
  methodBody2:  ['<b>Revenue</b> means what the business keeps: delivery fees, shop commission and advertising. Goods, packages and shop invoices are customers’ money in transit and are excluded from it — they appear only as “handled”. <b>Cancelled and failed orders</b> are excluded from volume and revenue. <b>LBP</b> is converted at {0} LBP/USD, stated here because the system does not store a rate; every LBP-denominated figure in this study depends on it. <b>Costs</b> other than the platform subscription are not recorded by the system and are modelled as a range rather than asserted.',
                 '<b>الإيراد</b> يعني ما تحتفظ به الشركة: رسوم التوصيل وعمولة المتاجر والإعلانات. أما البضائع والطرود وفواتير المتاجر فهي أموال زبائن عابرة ومستثناة منه، وتظهر فقط بوصفها «مُدارة». و<b>الطلبات الملغاة والفاشلة</b> مستثناة من الحجم والإيراد. وتُحوَّل <b>الليرة اللبنانية</b> على أساس {0} ل.ل./دولار، وهو مذكور هنا لأن النظام لا يخزّن سعر صرف؛ وكل رقم بالليرة في هذه الدراسة يتوقّف عليه. أما <b>الكلف</b> غير اشتراك المنصّة فغير مسجّلة في النظام، وقد نُمذجت كمروحة بدل تأكيدها.'],
  footDoc:      ['iDeliver III · Feasibility study prepared {0} · Data source: live operating database · Software platform by _NXCORE',
                 'iDeliver III · دراسة جدوى أُعدّت بتاريخ {0} · مصدر البيانات: قاعدة بيانات التشغيل الحيّة · منصّة برمجية من _NXCORE'],

  srcCall:      ['Call centre', 'مركز الاتصال'],
  srcPartner:   ['Partner', 'الشركاء'],
  srcCustomer:  ['Customer app', 'تطبيق الزبون'],
  mGoods:       ['Goods & packages handled', 'البضائع والطرود المُدارة'],
  mFees:        ['Delivery fees charged', 'رسوم التوصيل المفوترة'],
  mColl:        ['Cash collected', 'النقد المحصَّل'],
  mKept:        ['Our revenue kept', 'الإيراد المحتفظ به'],
}
const t = (key, ...args) => {
  const s = (T[key] || ['?', '?'])[AR ? 1 : 0]
  return args.reduce((acc, v, i) => acc.split(`{${i}}`).join(v), s)
}

/* ── chart primitives ───────────────────────────────────────────────────────
   Charts are drawn left-to-right in both languages: a time axis that ran
   right-to-left would put July after August, and the reader would have to
   re-learn a convention every chart. Only the words around them flip. */
const INK = '#0f172a', MUTED = '#64748b', GRID = '#e2e8f0'
const BRAND = '#2563eb', GREEN = '#16a34a', AMBER = '#d97706', SLATE = '#94a3b8', RED = '#dc2626'

function areaChart({ points, w = 700, h = 190, color = BRAND, avg = true }) {
  const pad = { l: 46, r: 10, t: 12, b: 26 }
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b
  const max = Math.max(1, ...points.map(p => p.v))
  const step = iw / Math.max(1, points.length - 1)
  const x = i => pad.l + i * step
  const y = v => pad.t + ih - (v / max) * ih
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${pad.t + ih} L${pad.l},${pad.t + ih} Z`
  let ma = ''
  if (avg && points.length > 7) {
    const m = points.map((_, i) => {
      const s = points.slice(Math.max(0, i - 6), i + 1)
      return s.reduce((a, b) => a + b.v, 0) / s.length
    })
    ma = m.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  }
  const every = Math.ceil(points.length / 9)
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" dir="ltr">
    ${[0, 0.5, 1].map(f => { const yy = y(max * f); return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${GRID}"/>
      <text x="${pad.l - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${MUTED}">${n0(max * f)}</text>` }).join('')}
    <path d="${area}" fill="${color}" fill-opacity="0.12"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6"/>
    ${ma ? `<path d="${ma}" fill="none" stroke="${INK}" stroke-width="1.4" stroke-dasharray="4 3" opacity="0.75"/>` : ''}
    ${points.map((p, i) => (i % every === 0 || i === points.length - 1)
      ? `<text x="${x(i).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="8" fill="${MUTED}">${p.d.slice(8)}/${p.d.slice(5, 7)}</text>` : '').join('')}
  </svg>`
}

function barsH({ rows, w = 700, rowH = 22, color = BRAND }) {
  const max = Math.max(1, ...rows.map(r => r.v))
  const labelW = AR ? 150 : 168, valueW = 92
  const h = rows.length * rowH + 8
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" dir="ltr">
    ${rows.map((r, i) => {
      const y = i * rowH + 4
      const bw = (w - labelW - valueW) * (r.v / max)
      return `<text x="0" y="${y + 13}" font-size="10" fill="${INK}">${r.k}</text>
        <rect x="${labelW}" y="${y + 3}" width="${Math.max(2, bw).toFixed(1)}" height="13" rx="2.5" fill="${r.color || color}" fill-opacity="0.85"/>
        <text x="${w - 4}" y="${y + 13}" text-anchor="end" font-size="10" fill="${MUTED}">${n0(r.v)}</text>`
    }).join('')}
  </svg>`
}

function donut({ parts, size = 150, thickness = 26 }) {
  const total = parts.reduce((a, p) => a + p.v, 0) || 1
  const r = (size - thickness) / 2, cx = size / 2, cy = size / 2
  let a0 = -Math.PI / 2
  const arcs = parts.map(p => {
    const a1 = a0 + (p.v / total) * Math.PI * 2
    const large = a1 - a0 > Math.PI ? 1 : 0
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
    a0 = a1
    return `<path d="M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)}" fill="none" stroke="${p.color}" stroke-width="${thickness}"/>`
  }).join('')
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="chart-inline" dir="ltr">${arcs}</svg>`
}

function groupedBars({ rows, w = 700, h = 190, keys, colors }) {
  const pad = { l: 52, r: 10, t: 12, b: 30 }
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b
  const max = Math.max(1, ...rows.flatMap(r => keys.map(k => Math.abs(r[k]))))
  const gw = iw / rows.length, bw = Math.min(26, (gw - 10) / keys.length)
  const y0 = pad.t + ih
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" dir="ltr">
    ${[0, 0.5, 1].map(f => { const y = y0 - f * ih
      return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y}" y2="${y}" stroke="${GRID}"/>
        <text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${MUTED}">${n0(max * f)}</text>` }).join('')}
    ${rows.map((r, i) => keys.map((k, j) => {
      const bh = (Math.abs(r[k]) / max) * ih
      const x = pad.l + i * gw + (gw - bw * keys.length) / 2 + j * bw
      return `<rect x="${x.toFixed(1)}" y="${(y0 - bh).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${colors[j]}" fill-opacity="${r[k] < 0 ? 0.35 : 0.9}"/>`
    }).join('')).join('')}
    ${rows.map((r, i) => `<text x="${(pad.l + i * gw + gw / 2).toFixed(1)}" y="${h - 10}" text-anchor="middle" font-size="9" fill="${INK}">${r.label}</text>`).join('')}
  </svg>`
}

/* ── derived values shared by both languages ────────────────────────────── */
const srcName = k => k === 'call center' ? t('srcCall') : k === 'customer' ? t('srcCustomer')
                   : k === 'partner' ? t('srcPartner') : k
const sources = S.sources.map((s, i) => ({ k: srcName(s.k), v: s.n, color: [BRAND, GREEN, AMBER, SLATE][i] || SLATE }))
const callShare  = 100 * S.sources[0].n / S.orders_live
const otherShare = 100 - callShare
const money = [
  { k: t('mGoods'), v: F.goods_usd, color: SLATE },
  { k: t('mFees'),  v: F.fees_usd,  color: BRAND },
  { k: t('mColl'),  v: F.collected_usd, color: GREEN },
  { k: t('mKept'),  v: F.revenue_usd, color: AMBER },
]
const sens = F.sensitivity.map(r => ({ label: `$${r.driver_day}`, oh0: r.oh0, oh500: r.oh500, oh1000: r.oh1000, oh1500: r.oh1500 }))
const growthOrders = 100 * (F.months[1].orders_day / F.months[0].orders_day - 1)
const growthRev    = 100 * (F.months[1].rev_day / F.months[0].rev_day - 1)

const html = `<!doctype html>
<html lang="${AR ? 'ar' : 'en'}"${AR ? ' dir="rtl"' : ''}><head><meta charset="utf-8">
<title>${AR ? 'iDeliver III — دراسة جدوى أعمال التوصيل' : 'iDeliver III — Delivery Business Feasibility Study'}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font: ${AR ? '11.5px/1.85' : '11px/1.5'} ${AR ? '"Segoe UI","Tahoma","Arial",sans-serif' : '"Segoe UI",Inter,system-ui,sans-serif'};
         color: ${INK}; margin: 0; ${AR ? 'direction: rtl; text-align: right;' : ''} }
  .en { direction: ltr; unicode-bidi: isolate; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  h1 { font-size: 25px; margin: 0 0 4px; letter-spacing: ${AR ? '0' : '-0.4px'}; }
  h2 { font-size: 15px; margin: 0 0 3px; border-bottom: 2px solid ${BRAND}; padding-bottom: 4px; }
  h3 { font-size: 11.5px; margin: 14px 0 5px; text-transform: ${AR ? 'none' : 'uppercase'}; letter-spacing: ${AR ? '0' : '.5px'}; }
  p { margin: 6px 0; }
  .muted { color: ${MUTED}; }
  .lead { font-size: 12px; }
  .rule { height: 3px; background: ${BRAND}; margin: 8px 0 14px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 4px; }
  .kpi { border: 1px solid ${GRID}; border-radius: 7px; padding: 8px 10px; }
  .kpi .n { font-size: 17px; font-weight: 700; ${AR ? 'direction: ltr; text-align: right;' : ''} }
  .kpi .l { font-size: 8.5px; text-transform: ${AR ? 'none' : 'uppercase'}; letter-spacing: ${AR ? '0' : '.5px'}; color: ${MUTED}; }
  .kpi .s { font-size: 9px; color: ${MUTED}; margin-top: 1px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; }
  th, td { border-bottom: 1px solid ${GRID}; padding: 5px 7px; text-align: ${AR ? 'right' : 'left'}; }
  th { background: #f8fafc; font-size: 8.5px; text-transform: ${AR ? 'none' : 'uppercase'}; letter-spacing: ${AR ? '0' : '.4px'}; color: ${MUTED}; }
  td.n, th.n { text-align: ${AR ? 'left' : 'right'}; direction: ltr; font-variant-numeric: tabular-nums; }
  .chart { width: 100%; height: auto; display: block; margin: 6px 0 2px; }
  .chart-inline { display: inline-block; vertical-align: middle; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .good { color: ${GREEN}; } .warn { color: ${AMBER}; } .bad { color: ${RED}; }
  .legend { font-size: 9.5px; color: ${MUTED}; }
  .legend span { display: inline-block; margin-${AR ? 'left' : 'right'}: 12px; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-${AR ? 'left' : 'right'}: 4px; vertical-align: -1px; }
  .foot { margin-top: 10px; font-size: 8.5px; color: ${MUTED}; border-top: 1px solid ${GRID}; padding-top: 6px; }
  .verdict { border-${AR ? 'right' : 'left'}: 4px solid ${GREEN}; background: #f0fdf4; padding: 10px 12px; border-radius: ${AR ? '7px 0 0 7px' : '0 7px 7px 0'}; }
  .caution { border-${AR ? 'right' : 'left'}: 4px solid ${AMBER}; background: #fffbeb; padding: 10px 12px; border-radius: ${AR ? '7px 0 0 7px' : '0 7px 7px 0'}; }
  ol { margin: 6px ${AR ? '16px' : '0'} 0 ${AR ? '0' : '16px'}; padding: 0; }
</style></head><body>

<section class="page">
  <p class="muted" style="font-size:9.5px;letter-spacing:1.2px"><span class="en">${t('brand')}</span></p>
  <h1>${t('title')}</h1>
  <p class="lead muted">${t('subtitle', dmy('2026-07-01'), dmy('2026-08-23'), num(F.days))}<br>
  ${t('readNote', dmy('2026-08-23'))}</p>
  <div class="rule"></div>

  <div class="kpis">
    <div class="kpi"><div class="l">${t('kOrders')}</div><div class="n">${num(S.delivered)}</div><div class="s">${t('kOrdersSub', num(S.orders_live), pct(100 * S.delivered / S.orders_live))}</div></div>
    <div class="kpi"><div class="l">${t('kRevenue')}</div><div class="n">${usd(F.revenue_usd)}</div><div class="s">${t('kRevenueSub', usd(F.rev_per_day))}</div></div>
    <div class="kpi"><div class="l">${t('kPerOrder')}</div><div class="n">${usd(F.rev_per_order)}</div><div class="s">${t('kPerOrderSub', num(F.orders_month))}</div></div>
    <div class="kpi"><div class="l">${t('kCash')}</div><div class="n">${usd(F.collected_usd)}</div><div class="s">${t('kCashSub', pct(F.collection_rate))}</div></div>
  </div>

  <h3>${t('finding')}</h3>
  <div class="verdict">
    <p style="margin:0">${t('verdict1', num(F.days), num(S.orders_live), L(n2(S.avg_per_day)), usd(F.revenue_usd),
      usd(F.handled_usd), usd(F.rev_per_month), usd(F.rev_per_year), pct(F.platform_share))}</p>
    <p style="margin:6px 0 0">${t('verdict2', usd(F.rev_per_order), num(F.drivers_active), L(n2(F.per_driver_day)))}</p>
  </div>

  <h3>${t('ordersPerDay')}</h3>
  ${areaChart({ points: S.per_day.map(p => ({ d: p.d, v: p.n })) })}
  <p class="legend"><span><i class="dot" style="background:${BRAND}"></i>${t('legOrders')}</span>
    <span><i class="dot" style="background:${INK}"></i>${t('legAvg')}</span></p>

  <div class="two" style="margin-top:12px">
    <div>
      <h3>${t('whereFrom')}</h3>
      ${barsH({ rows: sources, w: 340 })}
      <p class="muted" style="font-size:9.5px">${t('whereNote', pct(callShare), pct(otherShare))}</p>
    </div>
    <div>
      <h3>${t('monthOnMonth')}</h3>
      <table>
        <thead><tr><th>${t('thMonth')}</th><th class="n">${t('thDays')}</th><th class="n">${t('thOrders')}</th><th class="n">${t('thOrdersDay')}</th><th class="n">${t('thRevDay')}</th></tr></thead>
        <tbody>${F.months.map(m => `<tr><td class="n">${m.m}</td><td class="n">${m.days}</td><td class="n">${n0(m.orders)}</td>
          <td class="n">${n2(m.orders_day)}</td><td class="n">${n2(m.rev_day)}</td></tr>`).join('')}</tbody>
      </table>
      <p class="muted" style="font-size:9.5px">${t('monthNote',
        `<b class="good">${pct(growthOrders)}</b>`, `<b class="good">${pct(growthRev)}</b>`, num(F.months[1].days))}</p>
    </div>
  </div>

  <div class="foot">${t('footFx', num(F.fx))}</div>
</section>

<section class="page">
  <h2>${t('p2title')}</h2>

  <h3>${t('revPerDay')}</h3>
  ${areaChart({ points: S.revenue_day.map(p => ({ d: p.d, v: p.v })), color: GREEN })}
  <p class="legend"><span><i class="dot" style="background:${GREEN}"></i>${t('legRev')}</span>
    <span><i class="dot" style="background:${INK}"></i>${t('legAvg')}</span></p>

  <h3>${t('handledVsKept')}</h3>
  ${barsH({ rows: money })}
  <p class="muted">${t('handledNote', usd(F.goods_usd), num(F.days), usd(F.fees_usd), usd(F.comm_usd),
    usd(F.ads_usd), L(n2(F.handled_usd / F.revenue_usd)))}</p>

  <table>
    <thead><tr><th>${t('thLine')}</th><th class="n">${t('thUsd')}</th><th class="n">${t('thShare')}</th><th>${t('thWhat')}</th></tr></thead>
    <tbody>
      <tr><td>${t('lineFees')}</td><td class="n">${n2(F.fees_usd)}</td><td class="n">${n2(100 * F.fees_usd / F.revenue_usd)}%</td><td class="muted">${t('lineFeesD')}</td></tr>
      <tr><td>${t('lineComm')}</td><td class="n">${n2(F.comm_usd)}</td><td class="n">${n2(100 * F.comm_usd / F.revenue_usd)}%</td><td class="muted">${t('lineCommD')}</td></tr>
      <tr><td>${t('lineAds')}</td><td class="n">${n2(F.ads_usd)}</td><td class="n">${n2(100 * F.ads_usd / F.revenue_usd)}%</td><td class="muted">${t('lineAdsD')}</td></tr>
      <tr><td><b>${t('lineTotal')}</b></td><td class="n"><b>${n2(F.revenue_usd)}</b></td><td class="n"><b>100.00%</b></td><td class="muted">${t('perOrderD', usd(F.rev_per_order))}</td></tr>
    </tbody>
  </table>

  <div class="caution">
    <p style="margin:0"><b>${t('commTitle')}</b> ${t('commBody', usd(F.comm_usd), usd(F.comm_collected_usd), pct(F.comm_collect_rate))}</p>
  </div>

  <h3>${t('feeCover')}</h3>
  <p>${t('feeCoverBody', num(S.orders_with_fee), num(S.orders_live), num(F.fee_free_orders), pct(F.fee_free_share),
    usd(F.rev_per_order), usd(F.fee_free_orders * F.rev_per_order), num(F.days))}</p>

  <div class="foot">${t('footRev')}</div>
</section>

<section class="page">
  <h2>${t('p3title')}</h2>

  <div class="two">
    <div>
      <h3>${t('whoHolds')}</h3>
      <p style="text-align:center;margin:10px 0">
        ${donut({ parts: [{ v: F.driver_collected_usd, color: BRAND }, { v: F.office_collected_usd, color: GREEN }] })}
      </p>
      <p class="legend" style="text-align:center">
        <span><i class="dot" style="background:${BRAND}"></i>${t('drivers')} ${pct(F.driver_share)}</span>
        <span><i class="dot" style="background:${GREEN}"></i>${t('office')} ${pct(100 - F.driver_share)}</span></p>
      <p class="muted">${t('whoHoldsNote', usd(F.driver_collected_usd), usd(F.collected_usd), usd(F.cash_per_driver_day))}</p>
    </div>
    <div>
      <h3>${t('collPerf')}</h3>
      <table>
        <thead><tr><th>${t('thMeasure')}</th><th class="n">${t('thUsd')}</th></tr></thead>
        <tbody>
          <tr><td>${t('mCharged')}</td><td class="n">${n2(F.handled_usd)}</td></tr>
          <tr><td>${t('mCollected')}</td><td class="n">${n2(F.collected_usd)}</td></tr>
          <tr><td>${t('mRate')}</td><td class="n"><b class="${F.collection_rate > 90 ? 'good' : 'warn'}">${n2(F.collection_rate)}%</b></td></tr>
          <tr><td>${t('mOutstanding')}</td><td class="n">${n2(Math.max(0, F.handled_usd - F.collected_usd))}</td></tr>
        </tbody>
      </table>
      <p class="muted">${t('collNote', pct(F.collection_rate))}</p>
    </div>
  </div>

  <h3>${t('custBase')}</h3>
  <div class="kpis">
    <div class="kpi"><div class="l">${t('kServed')}</div><div class="n">${num(S.customers_served)}</div><div class="s">${t('kServedSub', L(n2(F.orders_per_customer)))}</div></div>
    <div class="kpi"><div class="l">${t('kReturn')}</div><div class="n">${pct(F.repeat_rate)}</div><div class="s">${t('kReturnSub', num(S.repeat_customers), num(S.customers_served))}</div></div>
    <div class="kpi"><div class="l">${t('kRepeatShare')}</div><div class="n">${pct(F.repeat_order_share)}</div><div class="s">${t('kRepeatSub', num(S.orders_from_repeat))}</div></div>
    <div class="kpi"><div class="l">${t('kConc')}</div><div class="n">${pct(F.top10_share)}</div><div class="s">${t('kConcSub')}</div></div>
  </div>
  <p>${t('custNote', num(S.customers_served), pct(F.repeat_order_share), pct(F.top10_share))}</p>

  <div class="two" style="margin-top:8px">
    <div><h3>${t('busiestAcc')}</h3>
      ${barsH({ rows: S.top_customers.slice(0, 6).map(c => ({ k: c.code, v: c.n })), w: 340 })}</div>
    <div><h3>${t('busiestPart')}</h3>
      ${barsH({ rows: S.top_partners.slice(0, 6).map(c => ({ k: c.code, v: c.n })), w: 340, color: AMBER })}</div>
  </div>

  <div class="foot">${t('footPartners', num(S.partners_with_packages), num(S.packages_total))}</div>
</section>

<section class="page">
  <h2>${t('p4title')}</h2>

  <h3>${t('fleet')}</h3>
  <div class="kpis">
    <div class="kpi"><div class="l">${t('kDrivers')}</div><div class="n">${num(F.drivers_active)}</div><div class="s">${t('kDriversSub', num(S.drivers_on_file))}</div></div>
    <div class="kpi"><div class="l">${t('kPerDriver')}</div><div class="n">${L(n2(F.per_driver_day))}</div><div class="s">${t('kPerDriverSub', num(F.days))}</div></div>
    <div class="kpi"><div class="l">${t('kRevDriver')}</div><div class="n">${usd(F.rev_per_day / F.drivers_active)}</div><div class="s">${t('kRevDriverSub')}</div></div>
    <div class="kpi"><div class="l">${t('kCashDriver')}</div><div class="n">${usd(F.cash_per_driver_day)}</div><div class="s">${t('kCashDriverSub')}</div></div>
  </div>
  ${barsH({ rows: S.top_drivers.slice(0, 8).map(d => ({ k: d.name, v: d.n })), color: GREEN })}
  <p class="muted">${t('fleetNote', pct(100 * S.top_drivers[0].n / S.orders_live), pct(100 * S.top_drivers[7].n / S.orders_live))}</p>

  <h3>${t('unknown')}</h3>
  <p>${t('unknownBody', usd(F.platform_period), pct(F.platform_share))}</p>

  <h3>${t('sensTitle', num(F.orders_month), usd(F.rev_per_month))}</h3>
  <table>
    <thead><tr><th>${t('thDriverCost')}</th><th class="n">${t('thFleetMonth')}</th>
      <th class="n">${t('thNoOh')}</th><th class="n">${t('thPlus', '500')}</th><th class="n">${t('thPlus', '1,000')}</th><th class="n">${t('thPlus', '1,500')}</th>
      <th class="n">${t('thBreakEven')}</th></tr></thead>
    <tbody>${F.sensitivity.map(r => `<tr>
      <td>${t('driverPerDay', r.driver_day)}</td>
      <td class="n">${n0(r.driver_month)}</td>
      <td class="n ${r.oh0 > 0 ? 'good' : 'bad'}">${n0(r.oh0)}</td>
      <td class="n ${r.oh500 > 0 ? 'good' : 'bad'}">${n0(r.oh500)}</td>
      <td class="n ${r.oh1000 > 0 ? 'good' : 'bad'}">${n0(r.oh1000)}</td>
      <td class="n ${r.oh1500 > 0 ? 'good' : 'bad'}">${n0(r.oh1500)}</td>
      <td class="n">${n0(r.break_even_orders)}</td></tr>`).join('')}</tbody>
  </table>
  ${groupedBars({ rows: sens, keys: ['oh0', 'oh500', 'oh1000', 'oh1500'], colors: [GREEN, BRAND, AMBER, SLATE] })}
  <p class="legend"><span><i class="dot" style="background:${GREEN}"></i>${t('legNoOh')}</span>
    <span><i class="dot" style="background:${BRAND}"></i>${t('thPlus', '500')}</span>
    <span><i class="dot" style="background:${AMBER}"></i>${t('thPlus', '1,000')}</span>
    <span><i class="dot" style="background:${SLATE}"></i>${t('thPlus', '1,500')}</span></p>

  <div class="verdict">
    <p style="margin:0">${t('verdictCost', usd(F.sensitivity[4].oh1500), L(n2(F.per_driver_day)), usd(F.rev_per_order))}</p>
  </div>

  <div class="foot">${t('footFleet', num(F.drivers_active))}</div>
</section>

<section class="page">
  <h2>${t('p5title')}</h2>

  <h3>${t('risksTitle')}</h3>
  <table>
    <thead><tr><th style="width:22%">${t('thRisk')}</th><th style="width:26%">${t('thSays')}</th><th>${t('thMeans')}</th></tr></thead>
    <tbody>
      <tr><td><b>${t('r1')}</b></td><td>${t('r1a', usd(F.driver_collected_usd), pct(F.driver_share))}</td><td class="muted">${t('r1b', usd(F.cash_per_driver_day))}</td></tr>
      <tr><td><b>${t('r2_')}</b></td><td>${t('r2a', pct(F.top10_share))}</td><td class="muted">${t('r2b')}</td></tr>
      <tr><td><b>${t('r3')}</b></td><td>${t('r3a', pct(callShare))}</td><td class="muted">${t('r3b')}</td></tr>
      <tr><td><b>${t('r4')}</b></td><td>${t('r4a', pct(F.comm_collect_rate), usd(F.comm_usd))}</td><td class="muted">${t('r4b')}</td></tr>
      <tr><td><b>${t('r5')}</b></td><td>${t('r5a', num(F.fee_free_orders), pct(F.fee_free_share))}</td><td class="muted">${t('r5b', usd(F.fee_free_orders * F.rev_per_order), num(F.days))}</td></tr>
      <tr><td><b>${t('r6')}</b></td><td>${t('r6a')}</td><td class="muted">${t('r6b', num(F.fx))}</td></tr>
    </tbody>
  </table>

  <h3>${t('moveMost')}</h3>
  <ol>
    <li style="margin:4px 0">${t('a1')}</li>
    <li style="margin:4px 0">${t('a2', pct(otherShare))}</li>
    <li style="margin:4px 0">${t('a3', pct(100 - F.comm_collect_rate))}</li>
    <li style="margin:4px 0">${t('a4', pct(F.fee_free_share), usd(F.fee_free_orders / F.days * 30.44 * F.rev_per_order))}</li>
  </ol>

  <h3>${t('method')}</h3>
  <p class="muted">${t('methodBody', dmy('2026-08-23'), dmy('2026-07-01'), dmy('2026-08-23'), num(F.days),
    num(S.orders_total), num(S.packages_total), num(5965))}</p>
  <p class="muted">${t('methodBody2', num(F.fx))}</p>

  <div class="foot">${t('footDoc', dmy('2026-08-23'))}</div>
</section>

</body></html>`

fs.writeFileSync(OUT, html, 'utf8')
console.log(`${AR ? 'AR' : 'EN'}  written: ${path.relative(path.join(__dirname, '..'), OUT)}  ${(html.length / 1024).toFixed(0)} KB`)
