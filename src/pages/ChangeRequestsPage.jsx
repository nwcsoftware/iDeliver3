import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ClipboardPen, Plus, Search, X, Loader, AlertCircle, Pencil, Trash2, Shield,
  Send, CheckCircle2, Ban, PlayCircle, Flag, Undo2, DollarSign, Package,
  FileText, Upload, Download, Paperclip, MessageSquare, History, CalendarCheck,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  REQUEST_TYPES, MODULES, PRIORITIES, LINE_TYPES, CLASSIFICATIONS, STATUSES,
  adminCanEdit, needsSuperAdmin, needsAdmin, nextRequestNo,
  fetchChangeRequests, saveChangeRequest, patchChangeRequest, deleteChangeRequest, isMissingTable,
  fetchQuoteHistory, logQuoteEvent, QUOTE_ACTIONS, isMissingQuoteLedger,
} from '../lib/changeRequests'

const CURRENCIES = ['USD', 'LBP', 'EUR']
const typeLabel  = Object.fromEntries(REQUEST_TYPES.map(t => [t.value, t.label]))
const moduleLabel = Object.fromEntries(MODULES.map(m => [m.value, m.label]))

const emptyLine = () => ({ line_type: 'add', module: '', description: '', notes: '', price: '' })
const emptyForm = () => ({
  request_type: 'new_feature', request_type_other: '', modules: [], screen_page: '',
  priority: 'medium', title: '', description: '', justification: '', needed_by: '',
  requester_role: '', requester_phone: '', requester_email: '', company_label: '',
})

const fmtMoney = (v, c) => `${Number(v || 0).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`
const fmtWhen = ts => (ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')

/* The quotation is stored inline on the request as a data URL (fix119), so the
   document travels with the row. Keep it small — 3 MB is a generous signed
   quotation and well inside what a text column carries comfortably. */
const MAX_PDF_MB = 3
const hasQuotation = r => !!r?.quotation_pdf
const readPdf = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader()
  fr.onload  = () => resolve(String(fr.result))
  fr.onerror = () => reject(new Error('Could not read the file.'))
  fr.readAsDataURL(file)
})
/* Save it under the request number, whatever the file was called on disk. */
const quotationName = (r) =>
  r?.quotation_filename || `${r?.request_no || 'quotation'}.pdf`

/* Settings → Change Requests.

   Admins raise change / feature requests (the in-app version of the paper
   Change Request Form) and may edit or withdraw them until the super admin
   picks them up. The super admin prices or rejects them, and only after the
   admin accepts the price does work start. */
export default function ChangeRequestsPage() {
  const { currentUser, hasRole } = useAuth()
  const { COMPANY_ID, sendMessage } = useApp()
  const isSuperAdmin = hasRole('super_admin')
  const canView      = hasRole('super_admin', 'admin')

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [search,  setSearch]  = useState('')
  const [statusFilter, setStatusFilter] = useState('open')

  const [modal,   setModal]   = useState(null)   // 'add' | request (edit) — the form
  const [view,    setView]    = useState(null)   // request being previewed
  const [form,    setForm]    = useState(emptyForm())
  const [lines,   setLines]   = useState([emptyLine()])
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')
  const [busyId,  setBusyId]  = useState(null)
  const [pdfErr,  setPdfErr]  = useState('')      // quotation upload problems

  // Super-admin assessment panel + admin rejection reason
  const [assessFor, setAssessFor] = useState(null)
  const [assess,    setAssess]    = useState({})
  const [rejectFor, setRejectFor] = useState(null)
  const [rejectWhy, setRejectWhy] = useState('')
  // The admin's counter-proposal, and the conversation behind the open request.
  const [acceptFor, setAcceptFor] = useState(null)   // agreeing is a two-step act
  const [reviseFor, setReviseFor] = useState(null)
  const [revise,    setRevise]    = useState({ message: '' })
  const [history,   setHistory]   = useState([])
  const [historyErr, setHistoryErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { rows: r, error: e } = await fetchChangeRequests(COMPANY_ID)
    setRows(r)
    setError(e ? (isMissingTable(e) ? 'Change requests aren’t installed yet — run supabase-fix112.sql.' : e) : '')
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { if (canView) load() }, [canView, load])

  /* The pricing conversation for the request being viewed. */
  useEffect(() => {
    if (!view?.id) { setHistory([]); setHistoryErr(''); return }
    let alive = true
    ;(async () => {
      const { rows: h, error: e } = await fetchQuoteHistory(view.id)
      if (!alive) return
      setHistory(h)
      setHistoryErr(isMissingQuoteLedger(e) ? 'Quotation history needs supabase-fix120.sql.' : (e || ''))
    })()
    return () => { alive = false }
  }, [view?.id])

  const counts = useMemo(() => ({
    forSuperAdmin: rows.filter(needsSuperAdmin).length,
    forAdmin:      rows.filter(needsAdmin).length,
    open:          rows.filter(r => !['completed', 'rejected', 'cancelled'].includes(r.status)).length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (statusFilter === 'open'  && ['completed', 'rejected', 'cancelled'].includes(r.status)) return false
      if (statusFilter === 'mine'  && r.requested_by !== currentUser?.user_id) return false
      if (!['all', 'open', 'mine'].includes(statusFilter) && r.status !== statusFilter) return false
      if (!q) return true
      return [r.request_no, r.title, r.description, r.requested_by_name, typeLabel[r.request_type]]
        .some(v => String(v ?? '').toLowerCase().includes(q))
    })
  }, [rows, search, statusFilter, currentUser?.user_id])

  if (!canView) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Shield className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">Administrators only</p>
        <p className="text-slate-500 text-sm">You don’t have permission to view change requests.</p>
      </div>
    )
  }

  /* ── create / edit ───────────────────────────────────────── */
  function openAdd() {
    setForm({
      ...emptyForm(),
      requester_role:  currentUser?.role || '',
      requester_email: currentUser?.email || '',
      requester_phone: currentUser?.mobile || '',
    })
    setLines([emptyLine()]); setFormErr(''); setModal('add')
  }
  function openEdit(r) {
    setForm({
      request_type: r.request_type || 'new_feature', request_type_other: r.request_type_other || '',
      modules: r.modules ?? [], screen_page: r.screen_page || '', priority: r.priority || 'medium',
      title: r.title || '', description: r.description || '', justification: r.justification || '',
      needed_by: r.needed_by || '', requester_role: r.requester_role || '',
      requester_phone: r.requester_phone || '', requester_email: r.requester_email || '',
      company_label: r.company_label || '',
    })
    setLines(r.lines?.length ? r.lines.map(l => ({ ...l, price: l.price ?? '' })) : [emptyLine()])
    setFormErr(''); setModal(r)
  }
  function closeModal() { setModal(null); setForm(emptyForm()); setLines([emptyLine()]); setFormErr('') }

  const toggleModule = (m) =>
    setForm(f => ({ ...f, modules: f.modules.includes(m) ? f.modules.filter(x => x !== m) : [...f.modules, m] }))

  async function save(submit = false) {
    if (!form.title.trim()) { setFormErr('A request title is required.'); return }
    if (!lines.some(l => (l.description || '').trim())) { setFormErr('Add at least one request line.'); return }
    setSaving(true); setFormErr('')

    const existing = modal !== 'add' ? modal : null
    const { error: e, id } = await saveChangeRequest({
      ...form,
      id: existing?.id,
      request_no: existing?.request_no || nextRequestNo(rows),
      requested_by: existing?.requested_by || currentUser?.user_id || null,
      requested_by_name: existing?.requested_by_name
        || `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || null,
      status: submit ? 'submitted' : (existing?.status || 'draft'),
      submitted_at: submit ? (existing?.submitted_at || new Date().toISOString()) : existing?.submitted_at,
    }, lines, { companyId: COMPANY_ID })

    setSaving(false)
    if (e) { setFormErr(isMissingTable(e) ? 'Change requests aren’t installed yet — run supabase-fix112.sql.' : e); return }

    // Let the super admin know something is waiting for them.
    if (submit) {
      try {
        await sendMessage?.({
          title: `Change request ${existing?.request_no || ''} — ${form.title.trim()}`.trim(),
          body: `A new change request is waiting for your assessment.\n\nType: ${typeLabel[form.request_type]}\nPriority: ${form.priority}\n\n${(form.description || '').slice(0, 400)}`,
          priority: form.priority === 'high' ? 'warning' : 'info',
          displayMode: 'icon',
          audienceRoles: ['super_admin'],
        })
      } catch { /* the request is saved either way */ }
    }
    closeModal(); load()
    if (id && submit) setView(rows.find(r => r.id === id) || null)
  }

  /* ── workflow actions ────────────────────────────────────── */
  async function act(r, patch) {
    setBusyId(r.id)
    const err = await patchChangeRequest(r.id, patch)
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  const recall  = (r) => act(r, { status: 'draft', submitted_at: null })
  const start   = (r) => act(r, { status: 'in_progress' })
  const finish  = (r) => act(r, { status: 'completed', completed_at: new Date().toISOString() })
  const cancel  = (r) => act(r, { status: 'cancelled' })

  function openAssess(r) {
    setPdfErr('')
    setAssess({
      quotation_pdf:      r.quotation_pdf      || '',
      quotation_filename: r.quotation_filename || '',
      ready_by:           r.ready_by           || '',
      classification: r.classification || 'enhancement',
      assessment_summary: r.assessment_summary || '',
      risk_notes: r.risk_notes || '',
      estimated_effort: r.estimated_effort || '',
      price: r.price ?? '',
      currency: r.currency || 'USD',
      target_delivery: r.target_delivery || '',
    })
    setAssessFor(r)
  }
  /* Attach / replace the quotation PDF on the request being priced. */
  async function pickPdf(file) {
    setPdfErr('')
    if (!file) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setPdfErr('The quotation must be a PDF file.'); return
    }
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      setPdfErr(`That file is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${MAX_PDF_MB} MB.`); return
    }
    try {
      const dataUrl = await readPdf(file)
      setAssess(a => ({ ...a, quotation_pdf: dataUrl, quotation_filename: file.name }))
    } catch (e) { setPdfErr(e.message) }
  }

  async function saveAssessment() {
    const r = assessFor
    setBusyId(r.id)
    const round = Number(r.quote_round || 0) + 1
    const stampPdf = assess.quotation_pdf && assess.quotation_pdf !== r.quotation_pdf
    const who = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || null
    const {
      quotation_pdf, quotation_filename, ...assessment
    } = assess
    const base = {
      ...assessment,
      price: assess.price === '' ? 0 : Number(assess.price),
      status: 'quoted',
      assessed_by_name: who,
      assessed_at: new Date().toISOString(),
      rejection_reason: null, rejected_at: null,
      // Each send is a new round; the admin may bounce it back any number of
      // times before the price is agreed.
      quote_round: round,
      ready_by: assess.ready_by || null,
    }
    const withPdf = {
      ...base,
      quotation_pdf: quotation_pdf || null,
      quotation_filename: quotation_filename || null,
      // Stamp who attached the document, and when — but only on a new upload,
      // so re-saving the assessment doesn't rewrite the original record.
      ...(stampPdf
        ? { quotation_uploaded_at: new Date().toISOString(), quotation_uploaded_by: who }
        : quotation_pdf ? {} : { quotation_uploaded_at: null, quotation_uploaded_by: null }),
    }

    let err = await patchChangeRequest(r.id, withPdf)
    // fix119 not run yet: save the assessment anyway and say what is missing,
    // rather than losing the whole quote over the attachment.
    if (err && /quotation_/i.test(err) && /column|schema cache/i.test(err)) {
      const fallback = await patchChangeRequest(r.id, base)
      err = fallback || 'The price was saved, but the quotation PDF needs supabase-fix119.sql — run it, then attach the file again.'
    }
    if (!err) {
      await record({
        request_id: r.id, round, action: 'quoted',
        price: base.price, currency: base.currency || 'USD',
        message: assess.assessment_summary || null,
        ready_by: assess.ready_by || null,
        quotation_pdf: quotation_pdf || null, quotation_filename: quotation_filename || null,
      })
    }
    setBusyId(null); setAssessFor(null)
    if (err) { setError(err); return }
    load()
  }

  /* The admin doesn't accept the quote: they send it back with the price they
     have in mind. The request returns to the super admin, who may re-quote —
     with a fresh PDF — as many times as it takes. */
  async function sendRevision() {
    const r = reviseFor
    setBusyId(r.id)
    const err = await patchChangeRequest(r.id, { status: 'revision_requested' })
    if (!err) {
      await record({
        request_id: r.id, round: Number(r.quote_round || 1), action: 'revision_requested',
        currency: r.currency || 'USD',
        message: revise.message.trim() || null,
      })
    }
    setBusyId(null); setReviseFor(null); setRevise({ message: '' })
    if (err) { setError(err); return }
    setView(null); load()
  }

  async function doReject() {
    const r = rejectFor
    setBusyId(r.id)
    const err = await patchChangeRequest(r.id, {
      status: 'rejected', rejection_reason: rejectWhy.trim() || 'No reason given',
      rejected_at: new Date().toISOString(),
    })
    if (!err) {
      await record({
        request_id: r.id, round: Number(r.quote_round || 0), action: 'rejected',
        message: rejectWhy.trim() || 'No reason given',
      })
    }
    setBusyId(null); setRejectFor(null); setRejectWhy('')
    if (err) { setError(err); return }
    load()
  }

  // The requesting admin accepts the standing quote → the price is agreed and
  // work may start. The promised delivery date rides on the accepted quote.
  async function acceptQuote(r) {
    await act(r, {
      status: 'approved',
      approved_by: currentUser?.user_id || null,
      approved_by_name: meName(),
      approved_at: new Date().toISOString(),
    })
    await record({
      request_id: r.id, round: Number(r.quote_round || 1), action: 'accepted',
      price: r.price, currency: r.currency || 'USD', ready_by: r.ready_by || null,
    })
  }

  async function remove(r) {
    setBusyId(r.id)
    const err = await deleteChangeRequest(r.id)
    setBusyId(null); setConfirmDelete(null)
    if (err) { setError(err); return }
    load()
  }

  const mine = (r) => r.requested_by === currentUser?.user_id
  /* Answering a quotation is an administration decision, not a personal one —
     any admin (not only the colleague who raised it) may agree to the price or
     send it back for revision. Editing and withdrawing stay with the raiser. */
  const canAnswerQuote = (r) => r?.status === 'quoted' && canView
  const meName = () =>
    `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || null
  /* Record a step, and surface a missing-ledger hint without failing the action
     the user just took — the request itself is already updated by then. */
  const record = async (entry) => {
    const err = await logQuoteEvent({
      actor_id: currentUser?.user_id || null, actor_name: meName(),
      actor_role: isSuperAdmin ? 'super_admin' : 'admin',
      ...entry,
    })
    if (err) setError(isMissingQuoteLedger(err)
      ? 'The step was applied, but its history needs supabase-fix120.sql.'
      : err)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ClipboardPen className="w-5 h-5 text-brand-400" />
          <h2 className="text-base font-semibold text-slate-100">Change Requests</h2>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder="Search number, title, requester…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-primary ml-auto" onClick={openAdd}>
          <Plus className="w-4 h-4" /> New request
        </button>
      </div>

      {/* What's waiting on whom */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="px-2.5 py-1 rounded-lg border bg-brand-500/10 text-brand-300 border-brand-500/30">
          {counts.open} open
        </span>
        {isSuperAdmin && counts.forSuperAdmin > 0 && (
          <span className="px-2.5 py-1 rounded-lg border bg-amber-500/10 text-amber-300 border-amber-500/30">
            {counts.forSuperAdmin} awaiting your assessment
          </span>
        )}
        {counts.forAdmin > 0 && (
          <span className="px-2.5 py-1 rounded-lg border bg-teal-500/10 text-teal-300 border-teal-500/30">
            {counts.forAdmin} quoted — awaiting acceptance
          </span>
        )}
        {!isSuperAdmin && (
          <span className="ml-auto text-[11px] text-slate-500">
            You can edit or withdraw your requests until the super admin assesses them.
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1 flex-wrap">
        {[{ value: 'open', label: 'Open' }, { value: 'mine', label: 'My requests' }, { value: 'all', label: 'All' },
          ...Object.entries(STATUSES).map(([v, s]) => ({ value: v, label: s.label }))].map(f => (
          <button key={f.value} onClick={() => setStatusFilter(f.value)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              statusFilter === f.value
                ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {/* List */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Request #', 'Title', 'Type', 'Lines', 'Priority', 'Requested by', 'Price', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No change requests found</td></tr>
            ) : filtered.map(r => {
              const st = STATUSES[r.status] ?? STATUSES.draft
              const editable = isSuperAdmin || (mine(r) && adminCanEdit(r))
              return (
                <tr key={r.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-brand-300 whitespace-nowrap">
                    <button onClick={() => setView(r)} className="hover:underline">{r.request_no || '—'}</button>
                  </td>
                  <td className="px-4 py-3 text-slate-100 max-w-[18rem] truncate">{r.title}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{typeLabel[r.request_type] ?? r.request_type}</td>
                  <td className="px-4 py-3 text-center text-slate-400 tabular-nums">{r.lines?.length ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] capitalize ${
                      r.priority === 'high' ? 'text-red-300' : r.priority === 'low' ? 'text-slate-500' : 'text-slate-300'}`}>
                      {r.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{r.requested_by_name || '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-200 tabular-nums whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {Number(r.price) > 0 ? fmtMoney(r.price, r.currency) : '—'}
                      {hasQuotation(r) && (
                        <a href={r.quotation_pdf} download={quotationName(r)} onClick={e => e.stopPropagation()}
                          title={`Download the quotation (${quotationName(r)})`}
                          className="text-brand-300 hover:text-brand-200">
                          <Paperclip className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] border rounded px-2 py-0.5 whitespace-nowrap ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {/* Admin: submit / recall / edit / delete while unlocked */}
                      {mine(r) && r.status === 'draft' && (
                        <button onClick={() => { openEdit(r); }} title="Open and submit"
                          className="btn-ghost p-1.5 text-brand-300 hover:text-brand-200"><Send className="w-4 h-4" /></button>
                      )}
                      {mine(r) && r.status === 'submitted' && (
                        <button onClick={() => recall(r)} disabled={busyId === r.id} title="Recall to draft"
                          className="btn-ghost p-1.5 text-slate-400 hover:text-amber-300"><Undo2 className="w-4 h-4" /></button>
                      )}
                      {canAnswerQuote(r) && (
                        <>
                          <button onClick={() => { setRevise({ message: '' }); setReviseFor(r) }} disabled={busyId === r.id}
                            title="Please revise — send it back with the price you propose"
                            className="btn-ghost p-1.5 text-orange-300 hover:text-orange-200"><MessageSquare className="w-4 h-4" /></button>
                          <button onClick={() => setAcceptFor(r)} disabled={busyId === r.id}
                            title={`Agree to the quoted price${Number(r.price) > 0 ? ` (${fmtMoney(r.price, r.currency)})` : ''} and proceed`}
                            className="btn-ghost p-1.5 text-teal-300 hover:text-teal-200"><CheckCircle2 className="w-4 h-4" /></button>
                        </>
                      )}

                      {/* Super admin: assess / reject / progress */}
                      {isSuperAdmin && ['submitted', 'quoted', 'revision_requested', 'approved'].includes(r.status) && (
                        <button onClick={() => openAssess(r)} title={Number(r.quote_round || 0) > 0 ? 'Re-quote — send a revised price' : 'Assess & price'}
                          className="btn-ghost p-1.5 text-amber-300 hover:text-amber-200"><DollarSign className="w-4 h-4" /></button>
                      )}
                      {isSuperAdmin && !['rejected', 'completed'].includes(r.status) && (
                        <button onClick={() => { setRejectFor(r); setRejectWhy(r.rejection_reason || '') }}
                          title="Reject with a reason"
                          className="btn-ghost p-1.5 text-slate-400 hover:text-red-400"><Ban className="w-4 h-4" /></button>
                      )}
                      {isSuperAdmin && r.status === 'approved' && (
                        <button onClick={() => start(r)} disabled={busyId === r.id} title="Mark in progress"
                          className="btn-ghost p-1.5 text-fuchsia-300 hover:text-fuchsia-200"><PlayCircle className="w-4 h-4" /></button>
                      )}
                      {isSuperAdmin && ['in_progress', 'approved'].includes(r.status) && (
                        <button onClick={() => finish(r)} disabled={busyId === r.id} title="Mark completed"
                          className="btn-ghost p-1.5 text-green-400 hover:text-green-300"><Flag className="w-4 h-4" /></button>
                      )}

                      {editable && (
                        <button onClick={() => openEdit(r)} title="Edit"
                          className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100"><Pencil className="w-4 h-4" /></button>
                      )}
                      {editable && (
                        <button onClick={() => setConfirmDelete(r)} title="Delete"
                          className="btn-ghost p-1.5 text-slate-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── New / edit request ─────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-3xl flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">
                {modal === 'add' ? 'New change / feature request' : `Edit ${modal.request_no || 'request'}`}
              </h3>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {/* 1 — requester */}
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">1 · Requester details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Company</label>
                  <input className="input" value={form.company_label}
                    onChange={e => setForm(f => ({ ...f, company_label: e.target.value }))} placeholder="3asari3" />
                </div>
                <div>
                  <label className="label">Role / position</label>
                  <input className="input" value={form.requester_role}
                    onChange={e => setForm(f => ({ ...f, requester_role: e.target.value }))} placeholder="Admin" />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" value={form.requester_phone}
                    onChange={e => setForm(f => ({ ...f, requester_phone: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input className="input" value={form.requester_email}
                    onChange={e => setForm(f => ({ ...f, requester_email: e.target.value }))} />
                </div>
              </div>

              {/* 2 — type & scope */}
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold pt-2">2 · Request type &amp; scope</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Type of request *</label>
                  <select className="input" value={form.request_type}
                    onChange={e => setForm(f => ({ ...f, request_type: e.target.value }))}>
                    {REQUEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Requested priority</label>
                  <select className="input" value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                    {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>
              {form.request_type === 'other' && (
                <input className="input" value={form.request_type_other} placeholder="Describe the type"
                  onChange={e => setForm(f => ({ ...f, request_type_other: e.target.value }))} />
              )}
              <div>
                <label className="label">Module(s) affected</label>
                <div className="flex flex-wrap gap-2">
                  {MODULES.map(m => (
                    <button key={m.value} type="button" onClick={() => toggleModule(m.value)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        form.modules.includes(m.value)
                          ? 'text-brand-300 border-brand-500/40 bg-brand-500/10'
                          : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Specific screen / page</label>
                  <input className="input" value={form.screen_page} placeholder="e.g. Daily Orders"
                    onChange={e => setForm(f => ({ ...f, screen_page: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Needed by (target date)</label>
                  <input type="date" className="input" value={form.needed_by}
                    onChange={e => setForm(f => ({ ...f, needed_by: e.target.value }))} />
                </div>
              </div>

              {/* 3–5 — the request */}
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold pt-2">3 · Request</p>
              <div>
                <label className="label">Request title *</label>
                <input className="input" value={form.title} autoFocus
                  onChange={e => { setForm(f => ({ ...f, title: e.target.value })); setFormErr('') }}
                  placeholder="Short summary of what you need" />
              </div>
              <div>
                <label className="label">Description — what do you want, and why?</label>
                <textarea className="input min-h-[90px] resize-y" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="For a change, state how it works now and how it should work instead." />
              </div>
              <div>
                <label className="label">Business justification &amp; expected benefit</label>
                <textarea className="input min-h-[70px] resize-y" value={form.justification}
                  onChange={e => setForm(f => ({ ...f, justification: e.target.value }))}
                  placeholder="What problem does this solve? Time saved, revenue, accuracy, customer experience…" />
              </div>

              {/* Lines */}
              <div className="flex items-center justify-between pt-2">
                <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">4 · Request lines *</p>
                <button type="button" onClick={() => setLines(ls => [...ls, emptyLine()])}
                  className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300">
                  <Plus className="w-3 h-3" /> Add line
                </button>
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="rounded-lg border border-surface-border p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 w-5">#{i + 1}</span>
                      <select className="input py-1.5 text-xs w-28" value={l.line_type || 'add'}
                        onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, line_type: e.target.value } : x))}>
                        {LINE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <select className="input py-1.5 text-xs flex-1" value={l.module || ''}
                        onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, module: e.target.value } : x))}>
                        <option value="">— Module —</option>
                        {MODULES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      {isSuperAdmin && (
                        <input type="number" min="0" step="0.01" className="input py-1.5 text-xs w-24" placeholder="Price"
                          value={l.price ?? ''}
                          onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
                      )}
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}
                          className="btn-ghost p-1.5 text-slate-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                    <textarea className="input text-xs min-h-[46px] resize-y" value={l.description || ''}
                      placeholder="What exactly should be added, changed or removed?"
                      onChange={e => { setLines(ls => ls.map((x, j) => j === i ? { ...x, description: e.target.value } : x)); setFormErr('') }} />
                  </div>
                ))}
              </div>

              {formErr && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs">{formErr}</p>
                </div>
              )}
            </div>

            <div className="flex justify-between gap-2 px-5 py-4 border-t border-surface-border">
              <p className="text-[11px] text-slate-500 max-w-sm">
                Submitting sends it to the super admin for assessment and pricing. You can still recall or edit it
                until they pick it up.
              </p>
              <div className="flex gap-2">
                <button onClick={closeModal} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
                <button onClick={() => save(false)} disabled={saving}
                  className="btn-ghost px-4 py-2 text-sm border border-surface-border text-slate-200 disabled:opacity-60">
                  {saving ? <Loader className="w-4 h-4 animate-spin" /> : 'Save draft'}
                </button>
                <button onClick={() => save(true)} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                  <Send className="w-4 h-4" /> Submit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview ────────────────────────────────────────────── */}
      {view && (() => {
        const st = STATUSES[view.status] ?? STATUSES.draft
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
            onClick={() => setView(null)}>
            <div className="card w-full max-w-3xl flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs text-brand-300">{view.request_no}</span>
                  <span className={`text-[11px] border rounded px-2 py-0.5 ${st.cls}`}>{st.label}</span>
                </div>
                <button onClick={() => setView(null)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4 overflow-y-auto text-sm">
                <div>
                  <h3 className="text-base font-semibold text-slate-100">{view.title}</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {typeLabel[view.request_type]} · priority {view.priority} · requested by {view.requested_by_name || '—'} · {fmtWhen(view.created_at)}
                  </p>
                </div>
                {view.modules?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {view.modules.map(m => (
                      <span key={m} className="text-[10px] px-2 py-0.5 rounded bg-surface-hover border border-surface-border text-slate-300">
                        {moduleLabel[m] ?? m}
                      </span>
                    ))}
                  </div>
                )}
                {view.description && (
                  <div><p className="label">Description</p><p className="text-slate-300 whitespace-pre-wrap">{view.description}</p></div>
                )}
                {view.justification && (
                  <div><p className="label">Business justification</p><p className="text-slate-300 whitespace-pre-wrap">{view.justification}</p></div>
                )}

                <div>
                  <p className="label flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Request lines</p>
                  <div className="space-y-1.5 mt-1">
                    {(view.lines ?? []).map((l, i) => (
                      <div key={l.id || i} className="rounded-lg border border-surface-border px-3 py-2">
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="uppercase tracking-wider">{l.line_type || 'add'}</span>
                          {l.module && <span>· {moduleLabel[l.module] ?? l.module}</span>}
                          {Number(l.price) > 0 && <span className="ml-auto text-slate-300">{fmtMoney(l.price, view.currency)}</span>}
                        </div>
                        <p className="text-slate-300 mt-1 whitespace-pre-wrap">{l.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Assessment block — the in-app "For _NXCORE use only" */}
                {(view.status === 'quoted' || view.assessed_at || view.status === 'approved' || view.status === 'in_progress' || view.status === 'completed') && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1.5">
                    <p className="text-[11px] uppercase tracking-wider text-amber-300 font-semibold">Impact assessment</p>
                    <p className="text-xs text-slate-400">Classification: <span className="text-slate-200">{CLASSIFICATIONS.find(c => c.value === view.classification)?.label ?? '—'}</span></p>
                    {view.assessment_summary && <p className="text-slate-300 whitespace-pre-wrap text-xs">{view.assessment_summary}</p>}
                    {view.risk_notes && <p className="text-slate-400 text-xs">Risk: {view.risk_notes}</p>}
                    <div className="flex flex-wrap gap-4 text-xs text-slate-300 pt-1">
                      <span>Effort: {view.estimated_effort || '—'}</span>
                      <span>Price: <b>{Number(view.price) > 0 ? fmtMoney(view.price, view.currency) : 'No charge'}</b></span>
                      <span>Target: {view.target_delivery || '—'}</span>
                    </div>
                    {hasQuotation(view) && (
                      <a href={view.quotation_pdf} download={quotationName(view)}
                        className="mt-2 inline-flex items-center gap-2 rounded-lg border border-brand-500/30 bg-brand-500/10
                                   px-3 py-2 text-xs text-brand-200 hover:bg-brand-500/15 transition-colors">
                        <FileText className="w-4 h-4" />
                        <span className="truncate max-w-[14rem]">{quotationName(view)}</span>
                        <Download className="w-3.5 h-3.5 ml-auto" />
                      </a>
                    )}
                    {hasQuotation(view) && view.quotation_uploaded_at && (
                      <p className="text-[11px] text-slate-500">
                        Quotation attached by {view.quotation_uploaded_by || '—'} · {fmtWhen(view.quotation_uploaded_at)}
                      </p>
                    )}
                    {view.ready_by && (
                      <p className="text-xs text-slate-300 flex items-center gap-1.5">
                        <CalendarCheck className="w-3.5 h-3.5 text-teal-300" />
                        Ready by <b>{view.ready_by}</b>
                        {view.status !== 'approved' && <span className="text-slate-500">(once the price is agreed)</span>}
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500">Assessed by {view.assessed_by_name || '—'} · {fmtWhen(view.assessed_at)}</p>
                    {view.approved_at && (
                      <p className="text-[11px] text-teal-300">Price accepted by {view.approved_by_name || '—'} · {fmtWhen(view.approved_at)}</p>
                    )}
                  </div>
                )}

                {/* Every step of the pricing conversation, oldest first. */}
                {(history.length > 0 || historyErr) && (
                  <div>
                    <p className="label flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Quotation history</p>
                    {historyErr && <p className="text-[11px] text-amber-300 mb-1.5">{historyErr}</p>}
                    <div className="space-y-1.5 mt-1">
                      {history.map(h => {
                        const meta = QUOTE_ACTIONS[h.action] ?? { label: h.action }
                        const fromSuper = h.actor_role === 'super_admin'
                        const tone = h.action === 'accepted' ? 'border-teal-500/30 bg-teal-500/5'
                          : h.action === 'rejected' ? 'border-red-500/30 bg-red-500/5'
                          : h.action === 'revision_requested' ? 'border-orange-500/30 bg-orange-500/5'
                          : 'border-amber-500/30 bg-amber-500/5'
                        return (
                          <div key={h.id} className={`rounded-lg border px-3 py-2 ${tone}`}>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                              <span className="uppercase tracking-wider font-semibold text-slate-300">{meta.label}</span>
                              {h.round ? <span>· round {h.round}</span> : null}
                              <span>· {fromSuper ? 'NXCORE' : 'Requester'}: {h.actor_name || '—'}</span>
                              <span className="ml-auto">{fmtWhen(h.created_at)}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              {h.price != null && (
                                <span className="text-slate-200 text-xs">
                                  Price:
                                  <b className="ml-1">{fmtMoney(h.price, h.currency)}</b>
                                </span>
                              )}
                              {h.ready_by && <span className="text-xs text-slate-400">Ready by {h.ready_by}</span>}
                              {h.quotation_pdf && (
                                <a href={h.quotation_pdf} download={h.quotation_filename || `${view.request_no}-r${h.round}.pdf`}
                                  className="inline-flex items-center gap-1.5 text-xs text-brand-300 hover:text-brand-200">
                                  <FileText className="w-3.5 h-3.5" />
                                  {h.quotation_filename || 'quotation.pdf'}
                                  <Download className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            {h.message && <p className="text-slate-300 text-xs mt-1 whitespace-pre-wrap">{h.message}</p>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {view.status === 'rejected' && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-red-300 font-semibold">Rejected</p>
                    <p className="text-slate-300 text-xs mt-1 whitespace-pre-wrap">{view.rejection_reason}</p>
                    <p className="text-[11px] text-slate-500 mt-1">{fmtWhen(view.rejected_at)}</p>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
                {canAnswerQuote(view) && (
                  <>
                    <button
                      onClick={() => { setRevise({ message: '' }); setReviseFor(view) }}
                      title="Send it back with the price you have in mind"
                      className="btn-ghost px-4 py-2 text-sm border border-orange-500/40 text-orange-300 hover:bg-orange-500/10">
                      <MessageSquare className="w-4 h-4" /> Please revise
                    </button>
                    <button onClick={() => setAcceptFor(view)} className="btn-primary px-4 py-2 text-sm">
                      <CheckCircle2 className="w-4 h-4" /> Agree &amp; proceed
                    </button>
                  </>
                )}
                <button onClick={() => setView(null)} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Close</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Super-admin assessment ─────────────────────────────── */}
      {assessFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="card w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">
                Assess &amp; price — {assessFor.request_no}
                <span className="ml-2 text-[11px] font-normal text-slate-400">
                  quotation #{Number(assessFor.quote_round || 0) + 1}
                </span>
              </h3>
              <button onClick={() => setAssessFor(null)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div>
                <label className="label">Classification</label>
                <select className="input" value={assess.classification}
                  onChange={e => setAssess(a => ({ ...a, classification: e.target.value }))}>
                  {CLASSIFICATIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Assessment summary</label>
                <textarea className="input min-h-[70px] resize-y" value={assess.assessment_summary}
                  onChange={e => setAssess(a => ({ ...a, assessment_summary: e.target.value }))} />
              </div>
              <div>
                <label className="label">Effect on other features / risk</label>
                <input className="input" value={assess.risk_notes}
                  onChange={e => setAssess(a => ({ ...a, risk_notes: e.target.value }))} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Estimated effort</label>
                  <input className="input" value={assess.estimated_effort} placeholder="e.g. 3 days"
                    onChange={e => setAssess(a => ({ ...a, estimated_effort: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Price quoted</label>
                  <input type="number" min="0" step="0.01" className="input" value={assess.price}
                    onChange={e => setAssess(a => ({ ...a, price: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">Currency</label>
                  <select className="input" value={assess.currency}
                    onChange={e => setAssess(a => ({ ...a, currency: e.target.value }))}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Target delivery / release</label>
                  <input className="input" value={assess.target_delivery} placeholder="e.g. v3.00.018"
                    onChange={e => setAssess(a => ({ ...a, target_delivery: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Ready by</label>
                  <input type="date" className="input" value={assess.ready_by || ''}
                    onChange={e => setAssess(a => ({ ...a, ready_by: e.target.value }))} />
                  <p className="text-[11px] text-slate-500 mt-1">The date promised once the price is agreed.</p>
                </div>
              </div>

              {/* The signed quotation, attached to the request itself so the
                  requester can read the same document the price came from. */}
              <div>
                <label className="label">Quotation (PDF)</label>
                {assess.quotation_pdf ? (
                  <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-hover/40 px-3 py-2">
                    <FileText className="w-4 h-4 text-brand-300 flex-shrink-0" />
                    <span className="text-xs text-slate-200 truncate flex-1">
                      {assess.quotation_filename || 'quotation.pdf'}
                    </span>
                    <a href={assess.quotation_pdf} download={assess.quotation_filename || 'quotation.pdf'}
                      title="Download" className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100">
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    <label title="Replace" className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <input type="file" accept="application/pdf" className="hidden"
                        onChange={e => { pickPdf(e.target.files?.[0]); e.target.value = '' }} />
                    </label>
                    <button type="button" title="Remove"
                      onClick={() => setAssess(a => ({ ...a, quotation_pdf: '', quotation_filename: '' }))}
                      className="btn-ghost p-1.5 text-slate-400 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 rounded-lg border border-dashed border-surface-border px-3 py-2.5
                                    text-xs text-slate-400 hover:bg-surface-hover cursor-pointer">
                    <Upload className="w-4 h-4 text-slate-500" />
                    Attach the quotation — PDF, up to {MAX_PDF_MB} MB
                    <input type="file" accept="application/pdf" className="hidden"
                      onChange={e => { pickPdf(e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                )}
                {pdfErr && <p className="text-[11px] text-red-400 mt-1">{pdfErr}</p>}
              </div>

              <p className="text-[11px] text-slate-500">
                Saving sends the quote back to the requester. They may accept it, or ask for a revision —
                each round is kept with its date and its own PDF. No work starts until the price is agreed.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
              <button onClick={() => setAssessFor(null)} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={saveAssessment} disabled={busyId === assessFor.id} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {busyId === assessFor.id ? <Loader className="w-4 h-4 animate-spin" /> : 'Send quote'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Agreeing to a quotation: step two ──────────────────── */}
      {acceptFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-4"
          onClick={() => busyId !== acceptFor.id && setAcceptFor(null)}>
          <div className="card w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-teal-300 flex-shrink-0" />
              <h3 className="text-sm font-semibold text-slate-100">
                Agree to this quotation — {acceptFor.request_no}
              </h3>
            </div>

            <div className="rounded-lg border border-surface-border bg-surface-hover/40 px-3 py-2.5 space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] uppercase tracking-wider text-slate-500">Agreed price</span>
                <b className="text-base text-slate-100">{fmtMoney(acceptFor.price, acceptFor.currency)}</b>
              </div>
              {acceptFor.ready_by && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] uppercase tracking-wider text-slate-500">Ready by</span>
                  <span className="text-xs text-teal-300">{acceptFor.ready_by}</span>
                </div>
              )}
            </div>

            {/* Spell out the consequences before the second click. */}
            <div className="text-xs text-slate-400 space-y-1.5">
              <p className="text-slate-300">What happens next:</p>
              <p>· The price above is accepted on behalf of the administration and becomes chargeable.</p>
              <p>· Development starts{acceptFor.ready_by ? `, to be ready by ${acceptFor.ready_by}` : ''}.</p>
              <p>· The request is locked — it can no longer be edited or withdrawn.</p>
              <p>· Your acceptance is recorded in the quotation history with your name and today’s date.</p>
              <p className="text-amber-300/90">If the price or the scope still needs discussion, cancel and use “Please revise” instead.</p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setAcceptFor(null)} disabled={busyId === acceptFor.id}
                className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button
                onClick={async () => { const r = acceptFor; await acceptQuote(r); setAcceptFor(null); setView(null) }}
                disabled={busyId === acceptFor.id}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {busyId === acceptFor.id
                  ? <Loader className="w-4 h-4 animate-spin" />
                  : <CheckCircle2 className="w-4 h-4" />}
                Yes, I agree — proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin asks for a revised price ─────────────────────── */}
      {reviseFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[75] p-4">
          <div className="card w-full max-w-md p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Ask for a revision — {reviseFor.request_no}
            </h3>
            <p className="text-[11px] text-slate-400">
              Quoted at <b className="text-slate-200">{fmtMoney(reviseFor.price, reviseFor.currency)}</b>.
              Send it back with your comments and it will be reviewed again.
            </p>
            <div>
              <label className="label">Message *</label>
              <textarea className="input min-h-[100px] resize-y" value={revise.message} autoFocus
                onChange={e => setRevise(v => ({ ...v, message: e.target.value }))}
                placeholder="What should be reconsidered or changed in the scope…" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setReviseFor(null)}
                className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={sendRevision} disabled={busyId === reviseFor.id || !revise.message.trim()}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                {busyId === reviseFor.id ? <Loader className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                Please revise
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject ─────────────────────────────────────────────── */}
      {rejectFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="card w-full max-w-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-100">Reject {rejectFor.request_no}</h3>
            <div>
              <label className="label">Reason *</label>
              <textarea className="input min-h-[80px] resize-y" value={rejectWhy} autoFocus
                onChange={e => setRejectWhy(e.target.value)} placeholder="Why is this request declined?" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setRejectFor(null)} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={doReject} disabled={!rejectWhy.trim() || busyId === rejectFor.id}
                className="px-4 py-2 text-sm rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50">
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete ─────────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="card w-full max-w-sm p-5 space-y-4">
            <p className="text-sm text-slate-200">Delete {confirmDelete.request_no} — “{confirmDelete.title}”?</p>
            <p className="text-xs text-slate-500">Its request lines are deleted with it. This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={() => remove(confirmDelete)} disabled={busyId === confirmDelete.id}
                className="px-4 py-2 text-sm rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-60">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
