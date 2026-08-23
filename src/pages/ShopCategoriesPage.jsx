import React, { useCallback, useEffect, useState } from 'react'
import { Tags, Plus, Trash2, Loader, AlertCircle, Shield, RotateCcw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  fetchShopCategories, addShopCategory, deleteShopCategory, restoreDefaultShopCategories,
} from '../lib/shopCategories'
import SearchField from '../components/ui/SearchField'

/* Settings → Shop Categories (super admin).

   The curated list suppliers tag their shop items with, and what the customer
   app's shop filter offers. Seeded by supabase-fix104.sql from
   src/lib/shopCategories.js; the super admin adds or removes entries here. */
export default function ShopCategoriesPage() {
  const { hasRole } = useAuth()
  const { COMPANY_ID } = useApp()
  const isSuperAdmin = hasRole('super_admin')

  const [rows,     setRows]     = useState([])
  const [fallback, setFallback] = useState(false)   // table empty/missing → showing defaults
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [search,   setSearch]   = useState('')
  const [newName,  setNewName]  = useState('')
  const [busy,     setBusy]     = useState(false)
  const [busyId,   setBusyId]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { rows: r, usedFallback } = await fetchShopCategories(COMPANY_ID)
    setRows(r); setFallback(usedFallback); setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { if (isSuperAdmin) load() }, [isSuperAdmin, load])

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Shield className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">Super admin only</p>
        <p className="text-slate-500 text-sm">Shop categories are managed by the developer account.</p>
      </div>
    )
  }

  async function add() {
    setBusy(true); setError('')
    const err = await addShopCategory(newName, { companyId: COMPANY_ID, sortOrder: rows.length })
    setBusy(false)
    if (err) { setError(err); return }
    setNewName(''); load()
  }

  async function remove(row) {
    if (!row.id) { setError('Run supabase-fix104.sql first — this list is still the built-in default.'); return }
    setBusyId(row.id); setError('')
    const err = await deleteShopCategory(row.id)
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  async function restore() {
    setBusy(true); setError('')
    const err = await restoreDefaultShopCategories(COMPANY_ID)
    setBusy(false)
    if (err) { setError(err); return }
    load()
  }

  const q = search.trim().toLowerCase()
  const shown = q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Tags className="w-5 h-5 text-brand-400" />
          <h2 className="text-base font-semibold text-slate-100">Shop Categories</h2>
        </div>
        <div className="relative flex-1 max-w-sm">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search categories…"
            className="input pl-9"
          />
        </div>
        <button onClick={restore} disabled={busy}
          className="btn-ghost px-3 py-2 text-sm border border-surface-border text-slate-300 ml-auto disabled:opacity-60"
          title="Re-add any of the built-in categories that are missing">
          <RotateCcw className="w-4 h-4" /> Restore defaults
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Suppliers tag their shop items from this list — they can’t create categories themselves.
        Deleting one only stops it being offered; items already tagged with it keep the tag.
      </p>

      {fallback && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-amber-200 text-xs leading-relaxed">
            Showing the built-in defaults — the <code>shop_categories</code> table is empty or missing.
            Run <span className="font-mono">supabase-fix104.sql</span> (or press Restore defaults) to save them.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {/* Add */}
      <div className="card p-4 flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[14rem]">
          <label className="label">New category</label>
          <input className="input" value={newName} placeholder="e.g. Organic Food"
            onChange={e => { setNewName(e.target.value); setError('') }}
            onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) add() }} />
        </div>
        <button onClick={add} disabled={busy || !newName.trim()} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
          {busy ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</> : <><Plus className="w-4 h-4" /> Add</>}
        </button>
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Category', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={2} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={2} className="px-4 py-10 text-center text-slate-500">No categories found</td></tr>
            ) : shown.map((row, i) => (
              <tr key={row.id ?? `d${i}`} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                <td className="px-4 py-3 text-slate-100">{row.name}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end">
                    <button onClick={() => remove(row)} disabled={busyId === row.id}
                      title={row.id ? 'Delete category' : 'Save the defaults first (Restore defaults)'}
                      className="btn-ghost p-1.5 text-slate-400 hover:text-red-400 disabled:opacity-40">
                      {busyId === row.id ? <Loader className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
