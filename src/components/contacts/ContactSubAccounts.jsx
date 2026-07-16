import React, { useState } from 'react'
import { Plus, Trash2, Star, CreditCard, Wallet, Infinity as InfinityIcon, AlertTriangle } from 'lucide-react'
import { formatAccountNumber } from '../../lib/accountNumber'
import {
  generateSubAccountNumber, isSubAccountExpired, isUnlimited,
  SUB_ACCOUNT_CURRENCIES,
} from '../../lib/subAccounts'

/**
 * Editable list of a contact's account numbers. The parent owns the array and
 * persists it on save, exactly like ContactAddresses.
 *
 * These are Chart of Accounts rows (sub_accounts), so the field names are ITS
 * names: code = the account number, name = the label, account_type = cash|credit,
 * description = notes. See src/lib/subAccounts.js.
 *
 * Each account is cash or credit, with a maximum outstanding amount and an
 * expiry date. The two "unlimited" cases are deliberately expressed as EMPTY
 * fields rather than magic values, and labelled as such in the UI:
 *   blank limit  → no ceiling
 *   blank expiry → never expires
 *
 * Props:
 *   accounts     - array of account objects
 *   setAccounts  - state setter (accepts value or updater fn)
 *   contactType  - drives the generated number's prefix (customer/supplier/partner)
 *   readOnly     - render without any editing controls
 */
export default function ContactSubAccounts({ accounts, setAccounts, contactType, readOnly = false }) {
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError]     = useState('')

  async function add() {
    setGenerating(true); setGenError('')
    let number = ''
    try {
      number = await generateSubAccountNumber(contactType)
    } catch (e) {
      // Without a number the row can't be saved (account_number is NOT NULL), so
      // surface the failure instead of adding a row that would fail on save.
      setGenError(e?.message || 'Could not generate an account number. Check your connection and try again.')
      setGenerating(false)
      return
    }
    setAccounts(a => [...a, {
      _key: Date.now(),
      code: number,
      name: '',
      account_type: 'cash',
      currency: 'USD',
      credit_limit: '',      // blank = unlimited
      expires_on: '',        // blank = never expires
      is_primary: a.length === 0,   // first account defaults to primary
      is_active: true,
      description: '',
    }])
    setGenerating(false)
  }

  function update(i, k, v) {
    setAccounts(a => { const n = [...a]; n[i] = { ...n[i], [k]: v }; return n })
  }

  function remove(i) {
    setAccounts(a => {
      const n = a.filter((_, idx) => idx !== i)
      // If the removed one was primary, promote the first remaining account —
      // orders and payments with no account resolve to the primary, so a contact
      // with accounts must always have one.
      if (a[i]?.is_primary && n.length && !n.some(x => x.is_primary)) {
        n[0] = { ...n[0], is_primary: true }
      }
      return n
    })
  }

  function setPrimary(i) {
    setAccounts(a => a.map((x, idx) => ({ ...x, is_primary: idx === i })))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label mb-0">Account Numbers</span>
        {!readOnly && (
          <button type="button" onClick={add} disabled={generating}
            className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300 disabled:opacity-40">
            <Plus className="w-3 h-3" /> {generating ? 'Generating…' : 'Add Account'}
          </button>
        )}
      </div>

      {genError && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {genError}
        </p>
      )}

      {accounts.length === 0 ? (
        <p className="text-xs text-slate-600 border border-dashed border-surface-border rounded-lg px-3 py-4 text-center">
          No account numbers yet — click "Add Account".
        </p>
      ) : accounts.map((a, i) => {
        const isCredit = a.account_type === 'credit'
        const expired  = isSubAccountExpired(a)
        return (
          <div key={a._id ?? a._key ?? i}
            className={`border rounded-lg p-3 space-y-2 bg-surface-hover/30 ${
              expired || a.is_active === false ? 'border-red-600/40' : 'border-surface-border'}`}>

            {/* Number + primary/remove */}
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0">
                <span className="block font-mono tracking-wider text-sm text-slate-200 truncate">
                  {formatAccountNumber(a.code)}
                </span>
                <span className="block text-[10px] text-slate-500">
                  {a._id ? 'Saved account' : 'New — saved with the contact'}
                </span>
              </span>
              {!readOnly && (
                <>
                  <button type="button" onClick={() => setPrimary(i)}
                    title={a.is_primary ? 'Primary account' : 'Set as primary'}
                    className={`p-1.5 rounded-lg border flex-shrink-0 transition-colors ${a.is_primary
                      ? 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10'
                      : 'text-slate-500 border-surface-border hover:text-yellow-400'}`}>
                    <Star className="w-4 h-4" fill={a.is_primary ? 'currentColor' : 'none'} />
                  </button>
                  <button type="button" onClick={() => remove(i)} title="Remove account"
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            <input className="input" placeholder="Label (e.g. Main, Branch B)" disabled={readOnly}
              value={a.name} onChange={e => update(i, 'name', e.target.value)} />

            {/* Cash / Credit */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'cash',   label: 'Cash',   Icon: Wallet,     hint: 'Pays on close' },
                { v: 'credit', label: 'Credit', Icon: CreditCard, hint: 'May owe a balance' },
              ].map(k => (
                <button key={k.v} type="button" disabled={readOnly}
                  onClick={() => update(i, 'account_type', k.v)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border flex items-center justify-center gap-1.5 transition-colors ${
                    a.account_type === k.v
                      ? (k.v === 'credit'
                          ? 'bg-amber-600/20 text-amber-300 border-amber-600/40'
                          : 'bg-brand-600/20 text-brand-300 border-brand-600/40')
                      : 'text-slate-400 border-surface-border hover:text-slate-100 hover:bg-surface-hover'}`}>
                  <k.Icon className="w-3.5 h-3.5" /> {k.label}
                </button>
              ))}
            </div>

            {/* Credit terms — a cash account can never carry a balance, so a
                limit and an expiry would have nothing to govern. */}
            {isCredit && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label text-[10px]">Currency</label>
                  <select className="input" value={a.currency} disabled={readOnly}
                    onChange={e => update(i, 'currency', e.target.value)}>
                    {SUB_ACCOUNT_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label text-[10px]">Credit Limit</label>
                  <input className="input" type="number" min="0" step="0.01" disabled={readOnly}
                    placeholder="Unlimited"
                    value={a.credit_limit} onChange={e => update(i, 'credit_limit', e.target.value)} />
                </div>
                <div>
                  <label className="label text-[10px]">Expires On</label>
                  <input className="input" type="date" disabled={readOnly}
                    value={a.expires_on} onChange={e => update(i, 'expires_on', e.target.value)} />
                </div>
              </div>
            )}

            {isCredit && (
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <InfinityIcon className="w-3.5 h-3.5 flex-shrink-0" />
                {isUnlimited(a) ? 'No credit ceiling' : `Up to ${Number(a.credit_limit).toLocaleString()} ${a.currency}`}
                {' · '}
                {a.expires_on ? `expires ${a.expires_on}` : 'never expires'}
              </p>
            )}

            {expired && (
              <p className="text-[11px] text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                Expired — new orders can't be charged to this account.
              </p>
            )}

            {!readOnly && (
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                <input type="checkbox" className="accent-brand-500 w-3.5 h-3.5"
                  checked={a.is_active !== false}
                  onChange={e => update(i, 'is_active', e.target.checked)} />
                Active
              </label>
            )}
          </div>
        )
      })}

      {accounts.length > 0 && (
        <p className="text-[11px] text-slate-500">
          Leave the limit blank for unlimited credit, and the expiry date blank for no time limit.
          Orders with no account chosen are billed to the primary (★) account.
        </p>
      )}
    </div>
  )
}
