# Gamma prompt — "How iDeliver III works"

**How to use:** open [gamma.app](https://gamma.app) → *Create new* → *Paste in text* →
paste everything between the two lines below → choose **Generate**. Suggested
settings: 16–18 cards, "Traditional" text density, and the colour notes at the
end of the prompt.

The audience is a **client with no technical background**. Everything below is
written to be understood by someone who has never seen a database.

---8<--- PASTE FROM HERE ---8<---

Create a clear, confident business presentation titled **"iDeliver III — how the
system works"** for a delivery company owner in Lebanon who has no technical
background. Explain the system in plain language, using everyday analogies
instead of technical terms. Never use the words "API", "database schema",
"backend" or "migration". Use short sentences. Every slide should answer a
question the owner would actually ask.

Tone: practical, confident, respectful of the reader's intelligence but never
assuming technical knowledge. Avoid hype words like "revolutionary" or
"cutting-edge". Use concrete numbers and examples from a Lebanese delivery
business (Tripoli, North Lebanon, USD and LBP prices, restaurants, supermarkets,
hardware shops).

Build the following slides, in this order:

**1. Title slide**
"iDeliver III — how the system works". Subtitle: "One system, three doors: your
office, your customers, your shops." Add the line "Prepared by _NXCORE".

**2. The problem this replaces**
Before the system: orders on paper and WhatsApp, prices in a notebook, drivers
phoning to ask where to go, no way to know at the end of the day who collected
what money. Show that as a short "before" list. Keep it factual, not mocking.

**3. The big picture — one system, three doors**
Explain that there is ONE system holding all the information, and three
different doors into it, each showing only what that person needs:
- **The Operations Console** — used by your call centre staff, your admins and
  you. This is the control room.
- **The Customer App** — a phone app your customers use to shop and to ask for
  deliveries.
- **The Shops Portal** — used by the suppliers and partners whose goods you
  deliver.
Add a diagram: three boxes (Office, Customers, Shops) all connecting to one
central box labelled "The shared record". Emphasise: nobody keeps their own
separate list, so nobody can disagree about what happened.

**4. Door 1 — The Operations Console (your control room)**
Describe what the office staff can do, as a list of everyday tasks:
- See every order of the day on one screen, colour-coded: late orders in red,
  orders in progress with a moving truck, unconfirmed orders in bright pink.
- Confirm new orders — one by one, or a whole day's worth in one click.
- Give an order to a driver; the moment a driver is assigned, the order is
  confirmed automatically.
- Record money as it comes in, and see instantly what is still owed.
- Print delivery labels with a barcode to stick on each package.
- See totals for the day in every currency, with advertising money reported
  separately from delivery money.
Explain that everything is stamped with WHO did it and WHEN — who confirmed,
who collected the money, who closed the order — so questions can always be
answered later.

**5. Door 2 — The Customer App**
Describe the customer's experience as a story:
A customer opens the app, sees shops near them grouped by type — restaurants,
supermarkets, hardware, sportswear, gyms, pharmacies. They tap a shop, see its
products with photos and prices, add to the basket, and choose a delivery
address they saved when they registered. If a shop is closed, the app says so
and offers to schedule the order for when the shop opens instead. They can save
favourite items with a heart. They can also simply ask for a driver — "pick me
up from home to the office", "bring me two pizzas" — without going through a
shop at all. They then follow the order to their door.

**6. Door 3 — The Shops Portal (suppliers and partners)**
Describe what a shop owner can do:
- Put their products in front of every customer using the app, with photos,
  colours, sizes and prices.
- Set their working hours, so customers see "Open" or "Closed" honestly.
- See only their own orders — never another shop's.
- See their own statement: how many packages were delivered, how much has been
  paid to them, what is still pending.
- Track their stock, so an item that runs out stops being sold.

**7. How an order actually travels (the heart of the deck)**
Show this as a numbered journey with icons, one line each:
1. **Created** — by the customer in the app, by your call centre by phone, or by
   a shop sending goods.
2. **Confirmed** — someone in your office accepts it. Until then it sits in
   bright pink and counts on the bell at the top of the screen.
3. **Assigned** — a driver is chosen. The order is now his to collect.
4. **On the way** — the driver picks up and delivers; the status follows him.
5. **Money collected** — either the driver takes the cash or the customer pays
   at the office. The system records which, because that decides who owes what.
6. **Closed** — the order is locked. Only a super admin can reopen it.
Add a note: at every step the same information is visible to everyone at once.
When a driver marks a delivery done, the office screen changes by itself.

**8. How the money is counted**
Explain in plain terms, with a worked example:
An order can carry several kinds of money — the goods themselves, a delivery
fee, a package sent by a shop, a purchase your driver made at a local shop on
the customer's behalf, and advertising. Each can be in USD or LBP. The system
keeps them apart and never mixes currencies.
Give this example: a 30.00 USD package + 5.00 USD delivery = 35.00 USD total; the
driver collects 35.00 USD; the shop is owed 30.00 USD; your company keeps 5.00
USD. Show that the same logic scales to hundreds of orders a day, and that at
any moment the office can see: what was sold, what was collected, what is still
pending, and who is holding the cash.

**9. What the system protects you from**
List real risks it removes:
- A driver collecting money twice on the same order.
- An order closed while money is still outstanding.
- A shop claiming a delivery that never happened.
- Prices changed after the fact without anyone knowing.
Explain that records are stamped and locked, and that only a super admin can
undo a closed order.

**10. Why your shops (suppliers and partners) pay a subscription**
This is important — explain it as a business proposition, not a fee:
A shop that joins the platform receives:
- A shopfront in front of every customer using the app — a sales channel they
  did not have.
- Their own login and portal, with their orders, stock and statement.
- Delivery service and drivers they do not have to employ.
- Support when something goes wrong.
Then explain the cost side honestly: keeping that shopfront available every day
costs money — the servers that hold the photos and orders, the phone numbers and
messages, the people who maintain and improve it. A subscription is how those
running costs are shared by the shops that benefit from them.
Use this analogy: **a subscription is rent for a stall in a market that never
closes.** A shop would not expect free rent in a busy souk; the app is the same
souk, open 24 hours, reaching customers across the city.
Add the practical part: the subscription has a start date and an end date. When
it expires, the shop can no longer sign in until it is renewed — the same way a
stall is not kept empty for someone who stopped paying rent.

**11. Why the platform owner also pays a subscription**
The owner often asks: "I bought the system, why do I keep paying?" Answer it
directly and without defensiveness:
Software is not a machine you buy once; it is a service that must be kept
running. Every month the system depends on things that themselves cost money:
- The servers that store every order, photo and record, and back them up.
- The map service that finds addresses.
- The messaging service that notifies customers and drivers.
- The mobile app accounts required to publish the apps on phones.
- Security updates — the phones, browsers and services the app depends on change
  constantly, and the app must be updated with them or it stops working.
- The people who fix problems, add what you ask for, and answer the phone when
  something breaks at 9pm.
Use this analogy: **you own the car, but you still pay for fuel, insurance and
servicing.** Stopping the subscription does not take the car away — it stops the
servicing, and a car without servicing eventually stops.
Add: the system warns everyone before this happens. A month before the licence
expires, a bar appears at the top of the screen for the office staff, and it
stays there until the renewal is paid and confirmed. Nobody is ever surprised.

**12. What you pay for, and what you get back**
Present a simple two-column comparison:
Left: what the subscription covers (hosting, security updates, backups, support,
small improvements, the reminders and receipts).
Right: what it saves (staff hours spent chasing orders on paper, money lost to
uncollected deliveries, customers lost to slow service, the cost of employing a
developer full-time).
Keep it honest — do not invent savings figures; describe the categories.

**13. Asking for changes — the Change Request system**
Explain that the system has its own built-in way to ask for new features:
An admin writes what they want and why. _NXCORE reviews it, prices it, and
attaches a written quotation as a PDF. The admin either agrees to the price, or
sends it back asking for a revision — and this can go back and forth as many
times as needed. Every round is kept with its date, so months later everyone can
see exactly what was asked, what was offered, and what was agreed. Work only
starts once the price is accepted, and the agreed delivery date is recorded.

**14. Receipts and documents**
Show that the system produces real paperwork, not just screens:
- Delivery labels with a barcode, stuck on each package.
- Payment receipts as PDFs, issued by _NXCORE, showing the amount, what it was
  for, and how long the subscription is valid.
- Statements for each shop, for any date range they choose.
- Quotations for change requests.

**15. Who can see what**
Explain permissions simply as a table:
- **Super admin** — everything, including reopening closed orders and setting
  prices. This is the system owner.
- **Admin** — day-to-day management, but cannot unlock closed records.
- **Call centre** — orders and customers; no financial settings.
- **Shop (supplier/partner)** — only their own goods, orders and statement.
- **Customer** — only their own orders.
- **Driver** — only the deliveries assigned to him.
Add the point: this is not about mistrust. It is so each person sees a simple
screen with only their work on it.

**16. Growing from here**
Close with what the system is ready for, without over-promising: more shops and
shop types, more cities, Arabic addresses for drivers who do not read English,
delivery-time estimates, ratings, and a driver application with its own screen
for returns and collections.

**17. Closing slide**
"iDeliver III — built and maintained by _NXCORE". Contact: +961 70 334 868.
One closing line: "One record. Three doors. Every order accounted for."

Design direction: use a warm, appetising palette — deep pomegranate red
(#B3122B) for headings and accents, olive green (#5A6E3A) for confirmations and
positive figures, warm cream (#FFF8EF) as the background instead of white, and a
gold (#E4B429) highlight used sparingly. Modern sans-serif type, generous white
space, simple flat icons and diagrams rather than stock photos of offices. Where
photos are used, prefer Middle Eastern food, markets and delivery scenes. Keep
each slide to one idea, with no more than six lines of text.

---8<--- PASTE TO HERE ---8<---

## Notes for you before you send it

- Slides **10 and 11** are the two that answer the client's real question. If the
  meeting is short, lead with those and use the rest as background.
- The deck deliberately avoids naming prices. Your quotations already carry the
  numbers, and mixing the two invites negotiation in the wrong room.
- If the client is a partner rather than the platform owner, delete slide 11 —
  they do not need to see your cost structure.
