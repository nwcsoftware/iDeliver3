import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpenText, CalendarDays, ChevronRight, FilterX, ReceiptText, Search, UsersRound, WalletCards } from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { orderTotalsByCurrency } from '../lib/orderAmounts'
import { useApp } from '../context/AppContext'

const TYPE_LABELS = { customer: 'Customer', partner: 'Partner', supplier: 'Supplier' }

function contactName(contact) {
  return contact.company_name?.trim() || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unnamed contact'
}

function money(amount, currency = 'USD') {
  const value = Number(amount) || 0
  return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: currency === 'LBP' ? 0 : 2, maximumFractionDigits: currency === 'LBP' ? 0 : 2 })}`
}

/* The date an order lands on the statement = when it was closed (else scheduled,
   else created) — mirrors the Credit Customers page. */
function orderDate(o) {
  const raw = o?.closed_at || o?.scheduled_date || o?.created_at
  return raw ? String(raw).slice(0, 10) : ''
}

export default function ContactStatementsPage() {
  const { COMPANY_ID } = useApp()
  const [contacts, setContacts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [activity, setActivity] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const loadContacts = useCallback(async () => {
    setLoadingContacts(true)
    const { data } = await fetchAllRows(() => {
      let query = supabase.from('contacts').select('id, first_name, last_name, company_name, mobile, email, account_number, contact_type, contact_types, is_active').eq('is_active', true).order('company_name').order('first_name').order('id')
      if (COMPANY_ID) query = query.eq('company_id', COMPANY_ID)
      return query
    })
    setContacts(data ?? [])
    setLoadingContacts(false)
  }, [COMPANY_ID])

  useEffect(() => { loadContacts() }, [loadContacts])

  /* Build the statement from real order/payment data rather than the
     account_transactions ledger (which only holds driver-settlement
     reimbursements, so it's empty for ordinary contacts). A contact's
     statement is made of:
       • Order charges  — the total of each order they placed (debit)
       • Payments       — money they paid on those orders (credit)
       • Supplied lines — packages / external retail invoices they provide as a
                          partner/supplier, i.e. money owed to them (credit)     */
  const loadStatement = useCallback(async (contact) => {
    if (!contact) return
    setLoadingTransactions(true)

    // 1) Orders where this contact is the customer — charges + their payments.
    const { data: orders } = await fetchAllRows(() => {
      let q = supabase.from('delivery_orders').select(`
        id, order_number, recipient_name, currency, delivery_fee,
        discount_amount, discount_currency, vat_amount, is_free_order,
        closed_at, scheduled_date, created_at, customer_id, driver_id,
        order_items(currency, line_total, is_deleted),
        delivery_packages(package_price, paid, currency, provider_id),
        order_services(service_fees, service_fees_currency),
        retail_goods_invoices(invoice_value, currency, paid, contact_id),
        payment_collections(id, amount, currency, collection_type, collected_at, collected_by, collected_by_name)
      `).eq('customer_id', contact.id)
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      return q
    })

    // 2) Delivery packages this contact provides (partner/supplier role).
    let packagesQ = supabase.from('delivery_packages')
      .select('id, package_price, currency, paid, created_at, order:delivery_orders!inner(order_number, closed_at, scheduled_date, created_at, company_id)')
      .eq('provider_id', contact.id).eq('paid', false)
    if (COMPANY_ID) packagesQ = packagesQ.eq('order.company_id', COMPANY_ID)
    const { data: suppliedPackages } = await packagesQ

    // 3) External retail invoices for this contact's shop (partner/supplier role).
    let invoicesQ = supabase.from('retail_goods_invoices')
      .select('id, invoice_value, currency, paid, shop_name, created_at, order:delivery_orders!inner(order_number, closed_at, scheduled_date, created_at, company_id)')
      .eq('contact_id', contact.id).eq('paid', false)
    if (COMPANY_ID) invoicesQ = invoicesQ.eq('order.company_id', COMPANY_ID)
    const { data: suppliedInvoices } = await invoicesQ

    const rows = []

    for (const o of orders ?? []) {
      const date = orderDate(o)
      // Charge lines — one per currency the order carries (free orders → none).
      const totals = orderTotalsByCurrency(o)
      for (const [cur, amount] of Object.entries(totals)) {
        if (!amount) continue
        rows.push({
          transaction_id: `chg-${o.id}-${cur}`,
          transaction_date: date,
          transaction_type: 'Order Charge',
          order_number: o.order_number,
          transaction_reference: o.recipient_name || '',
          transaction_description: 'Order total',
          credit_amount: 0,
          debit_amount: Number(amount),
          currency_code: cur,
        })
      }
      // Payment lines — money the customer paid on the order.
      for (const p of (o.payment_collections ?? [])) {
        const amt = Number(p.amount) || 0
        if (!amt) continue
        rows.push({
          transaction_id: `pay-${p.id}`,
          transaction_date: (p.collected_at ? String(p.collected_at).slice(0, 10) : date),
          transaction_type: 'Payment',
          order_number: o.order_number,
          transaction_reference: p.collected_by_name || p.collection_type || '',
          transaction_description: `Payment received${p.collection_type ? ` (${p.collection_type})` : ''}`,
          credit_amount: amt,
          debit_amount: 0,
          currency_code: p.currency || 'USD',
        })
      }
    }

    // Supplier/partner lines — money owed to this contact for what they supply.
    for (const pkg of (suppliedPackages ?? [])) {
      const amt = Number(pkg.package_price) || 0
      if (!amt) continue
      rows.push({
        transaction_id: `pkg-${pkg.id}`,
        transaction_date: orderDate(pkg.order) || (pkg.created_at ? String(pkg.created_at).slice(0, 10) : ''),
        transaction_type: 'Delivery Package',
        order_number: pkg.order?.order_number || '',
        transaction_reference: 'Supplied',
        transaction_description: 'Delivery package provided',
        credit_amount: amt,
        debit_amount: 0,
        currency_code: pkg.currency || 'USD',
      })
    }
    for (const inv of (suppliedInvoices ?? [])) {
      const amt = Number(inv.invoice_value) || 0
      if (!amt) continue
      rows.push({
        transaction_id: `inv-${inv.id}`,
        transaction_date: orderDate(inv.order) || (inv.created_at ? String(inv.created_at).slice(0, 10) : ''),
        transaction_type: 'Retail Invoice',
        order_number: inv.order?.order_number || '',
        transaction_reference: inv.shop_name || 'Supplied',
        transaction_description: 'External retail invoice provided',
        credit_amount: amt,
        debit_amount: 0,
        currency_code: inv.currency || 'USD',
      })
    }

    setTransactions(rows)
    setLoadingTransactions(false)
  }, [COMPANY_ID])

  function chooseContact(contact) {
    setSelected(contact)
    setDateFrom('')
    setDateTo('')
    setActivity('all')
    loadStatement(contact)
  }

  const visibleContacts = useMemo(() => contacts.filter(contact => {
    const roles = Array.isArray(contact.contact_types) && contact.contact_types.length ? contact.contact_types : [contact.contact_type]
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || [contactName(contact), contact.account_number, contact.mobile, contact.email].some(value => String(value ?? '').toLowerCase().includes(q))
    return matchesSearch && (type === 'all' || roles.includes(type))
  }), [contacts, search, type])

  // Filter → sort oldest-first → attach a per-currency running balance
  // (running = charges − payments = what the contact still owes).
  const visibleTransactions = useMemo(() => {
    const filtered = transactions.filter(row => {
      const date = String(row.transaction_date ?? '').slice(0, 10)
      const text = `${row.transaction_type ?? ''} ${row.order_number ?? ''} ${row.transaction_reference ?? ''} ${row.transaction_description ?? ''}`.toLowerCase()
      const matchesActivity = activity === 'all' || (activity === 'payments' ? /payment|collection|reimbursement|settlement/.test(text) : /order|sale|delivery|invoice/.test(text))
      return matchesActivity && (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo)
    })
    // Oldest first so the running balance reads top-to-bottom; charge before its payment on the same day.
    filtered.sort((a, b) => {
      const da = String(a.transaction_date ?? ''), db = String(b.transaction_date ?? '')
      if (da !== db) return da < db ? -1 : 1
      return (b.debit_amount || 0) - (a.debit_amount || 0)
    })
    const running = {}
    return filtered.map(row => {
      const cur = row.currency_code || 'USD'
      running[cur] = (running[cur] || 0) + (Number(row.debit_amount) || 0) - (Number(row.credit_amount) || 0)
      return { ...row, running_balance: running[cur] }
    })
  }, [transactions, activity, dateFrom, dateTo])

  const totals = useMemo(() => Object.entries(visibleTransactions.reduce((all, row) => {
    const currency = row.currency_code || 'USD'
    if (!all[currency]) all[currency] = { credit: 0, debit: 0 }
    all[currency].credit += Number(row.credit_amount) || 0
    all[currency].debit += Number(row.debit_amount) || 0
    return all
  }, {})).map(([currency, value]) => ({ currency, ...value, balance: value.debit - value.credit })), [visibleTransactions])

  function showToday() {
    const today = new Date().toISOString().slice(0, 10)
    setDateFrom(today); setDateTo(today)
  }

  function clearStatementFilters() { setActivity('all'); setDateFrom(''); setDateTo('') }
  const hasStatementFilters = activity !== 'all' || dateFrom || dateTo

  return (
    <div className="flex-1 overflow-hidden p-6 flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-9 h-9 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center"><BookOpenText className="w-5 h-5 text-brand-400" /></div>
        <div>
          <h1 className="text-base font-semibold text-slate-100 leading-none">Contact Account Statements</h1>
          <p className="text-xs text-slate-500 mt-1">Select a customer, partner, or supplier to review their account activity.</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-4">
        <section className="card min-h-0 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-surface-border space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-200">Contacts</span><span className="text-xs text-slate-500">{visibleContacts.length}</span></div>
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" /><input className="input pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or account number…" /></div>
            <select className="input" value={type} onChange={e => setType(e.target.value)}><option value="all">All contact types</option><option value="customer">Customers</option><option value="partner">Partners</option><option value="supplier">Suppliers</option></select>
          </div>
          <div className="overflow-y-auto p-2 flex-1">
            {loadingContacts ? <p className="p-5 text-center text-sm text-slate-500">Loading contacts…</p> : visibleContacts.length === 0 ? <p className="p-5 text-center text-sm text-slate-500">No matching contacts found.</p> : visibleContacts.map(contact => {
              const roles = Array.isArray(contact.contact_types) && contact.contact_types.length ? contact.contact_types : [contact.contact_type].filter(Boolean)
              const active = selected?.id === contact.id
              return <button key={contact.id} onClick={() => chooseContact(contact)} className={`w-full text-left rounded-lg p-3 mb-1 transition-colors border ${active ? 'bg-brand-600/15 border-brand-600/40' : 'border-transparent hover:bg-surface-hover'}`}>
                <div className="flex items-start gap-2"><div className={`mt-0.5 w-7 h-7 rounded-md flex items-center justify-center ${active ? 'bg-brand-600/25 text-brand-300' : 'bg-surface-hover text-slate-400'}`}><UsersRound className="w-4 h-4" /></div><div className="min-w-0 flex-1"><div className="font-medium text-sm text-slate-200 truncate">{contactName(contact)}</div><div className="font-mono text-[11px] text-brand-400 mt-0.5">{contact.account_number || 'No account number'}</div><div className="mt-1 flex gap-1 flex-wrap">{roles.map(role => <span key={role} className="text-[10px] text-slate-500">{TYPE_LABELS[role] || role}</span>)}</div></div><ChevronRight className="w-4 h-4 mt-1 text-slate-600" /></div>
              </button>
            })}
          </div>
        </section>

        <section className="card min-h-0 flex flex-col overflow-hidden">
          {!selected ? <div className="flex-1 flex flex-col justify-center items-center text-center p-8"><WalletCards className="w-10 h-10 text-slate-600 mb-3" /><h2 className="text-slate-300 font-medium">Choose a contact</h2><p className="text-sm text-slate-500 mt-1 max-w-sm">Search by name or account number, then select a contact to open their detailed statement.</p></div> : <>
            <div className="p-4 border-b border-surface-border flex items-start gap-4 flex-wrap">
              <div className="flex-1"><p className="text-xs text-slate-500 uppercase tracking-wider">Account statement</p><h2 className="text-lg font-semibold text-slate-100 mt-1">{contactName(selected)}</h2><div className="flex gap-3 text-xs mt-1"><span className="font-mono text-brand-400">{selected.account_number || 'No account number'}</span>{selected.mobile && <span className="text-slate-500">{selected.mobile}</span>}</div></div>
              <div className="flex items-end gap-2 flex-wrap"><label className="text-xs text-slate-500">Activity<select className="input mt-1 min-w-32" value={activity} onChange={e => setActivity(e.target.value)}><option value="all">All activity</option><option value="orders">Orders & invoices</option><option value="payments">Payments</option></select></label><label className="text-xs text-slate-500">From<input type="date" className="input mt-1" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label><label className="text-xs text-slate-500">To<input type="date" className="input mt-1" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label><button onClick={showToday} className="btn-ghost text-xs"><CalendarDays className="w-4 h-4" /> Today</button>{hasStatementFilters && <button onClick={clearStatementFilters} className="btn-ghost text-xs"><FilterX className="w-4 h-4" /> Clear</button>}</div>
            </div>
            <div className="overflow-auto flex-1"><table className="w-full min-w-[850px] text-sm"><thead className="sticky top-0 bg-surface-card"><tr className="border-b border-surface-border">{['Date', 'Activity', 'Order / Ref.', 'Description', 'Credit', 'Debit', 'Balance'].map(head => <th key={head} className="text-left px-4 py-3 text-xs uppercase tracking-wider font-medium text-slate-500">{head}</th>)}</tr></thead><tbody>{loadingTransactions ? <tr><td colSpan={7} className="py-12 text-center text-slate-500">Loading statement…</td></tr> : visibleTransactions.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-slate-500">No activity found for this selection.</td></tr> : visibleTransactions.map(row => <tr key={row.transaction_id} className="border-b border-surface-border/50 hover:bg-surface-hover/40"><td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{String(row.transaction_date ?? '—').slice(0, 10)}</td><td className="px-4 py-3"><span className="text-xs px-2 py-1 rounded bg-brand-600/10 border border-brand-600/20 text-brand-300">{row.transaction_type || 'Transaction'}</span></td><td className="px-4 py-3 text-xs"><div className="font-mono text-brand-400">{row.order_number || '—'}</div>{row.transaction_reference && <div className="text-slate-500 mt-0.5">{row.transaction_reference}</div>}</td><td className="px-4 py-3 text-xs text-slate-400">{row.transaction_description || '—'}</td><td className="px-4 py-3 text-right text-xs text-green-400 whitespace-nowrap">{Number(row.credit_amount) ? money(row.credit_amount, row.currency_code) : '—'}</td><td className="px-4 py-3 text-right text-xs text-red-400 whitespace-nowrap">{Number(row.debit_amount) ? money(row.debit_amount, row.currency_code) : '—'}</td><td className={`px-4 py-3 text-right text-xs whitespace-nowrap ${row.running_balance > 0 ? 'text-amber-300' : row.running_balance < 0 ? 'text-emerald-300' : 'text-slate-400'}`}>{money(row.running_balance, row.currency_code)}</td></tr>)}</tbody></table></div>
            <div className="border-t border-surface-border p-4 flex items-center justify-between gap-3 flex-wrap bg-surface-card"><div className="text-sm text-slate-400"><ReceiptText className="w-4 h-4 inline mr-2" />{visibleTransactions.length} transaction{visibleTransactions.length === 1 ? '' : 's'}</div><div className="flex gap-4 flex-wrap">{totals.length === 0 ? <span className="text-sm text-slate-500">No totals</span> : totals.map(total => <div key={total.currency} className="text-xs"><span className="font-semibold text-slate-400 mr-2">{total.currency}</span><span className="text-red-400">Charges {money(total.debit, total.currency)}</span><span className="text-slate-600 mx-1.5">·</span><span className="text-green-400">Paid {money(total.credit, total.currency)}</span><span className="text-slate-600 mx-1.5">·</span><span className="font-semibold text-slate-100">Balance {money(total.balance, total.currency)}</span></div>)}</div></div>
          </>}
        </section>
      </div>
    </div>
  )
}
