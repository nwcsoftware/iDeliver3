import { supabase } from './supabase'

/* Change / feature requests (supabase-fix112.sql) — the in-app version of
   docs/iDeliver-III-Change-Request-Form.

   An admin raises a request; the super admin prices or rejects it; the admin
   accepts the price; then it is locked and the super admin drives it to
   completion. */

export const REQUEST_TYPES = [
  { value: 'new_feature',     label: 'New feature / capability' },
  { value: 'change_existing', label: 'Change to an existing feature' },
  { value: 'new_report',      label: 'New report / document' },
  { value: 'remove_feature',  label: 'Remove a feature' },
  { value: 'problem',         label: 'Report a problem (possible defect)' },
  { value: 'other',           label: 'Other' },
]

export const MODULES = [
  { value: 'operations', label: 'Operations Console / Call Center' },
  { value: 'partners',   label: 'Partners & Suppliers Portal' },
  { value: 'driver',     label: 'Driver Application' },
  { value: 'customer',   label: 'Customer Mobile Application' },
  { value: 'reports',    label: 'Reports / Accounting' },
  { value: 'other',      label: 'Not sure / other' },
]

export const PRIORITIES = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High / urgent' },
]

export const LINE_TYPES = [
  { value: 'add',     label: 'Add' },
  { value: 'change',  label: 'Change' },
  { value: 'remove',  label: 'Remove' },
  { value: 'report',  label: 'Report' },
  { value: 'problem', label: 'Problem' },
]

export const CLASSIFICATIONS = [
  { value: 'enhancement', label: 'Enhancement (chargeable)' },
  { value: 'defect',      label: 'Defect (covered — no charge)' },
]

/* Workflow states, in order, with how each one looks in the list. */
export const STATUSES = {
  draft:       { label: 'Draft',       cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
  submitted:   { label: 'Submitted',   cls: 'bg-brand-500/10 text-brand-300 border-brand-500/30' },
  quoted:      { label: 'Quoted',      cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  revision_requested: { label: 'Revision asked', cls: 'bg-orange-500/10 text-orange-300 border-orange-500/30' },
  approved:    { label: 'Approved',    cls: 'bg-teal-500/10 text-teal-300 border-teal-500/30' },
  in_progress: { label: 'In progress', cls: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30' },
  completed:   { label: 'Completed',   cls: 'bg-green-500/10 text-green-300 border-green-500/30' },
  rejected:    { label: 'Rejected',    cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
  cancelled:   { label: 'Cancelled',   cls: 'bg-slate-500/10 text-slate-500 border-slate-500/30' },
}

/* The requesting admin may still change or withdraw a request only while the
   super admin hasn't acted on it — i.e. while it is a draft or merely
   submitted. Everything from "quoted" onwards is read-only for them. */
export const adminCanEdit = (r) => ['draft', 'submitted'].includes(r?.status)

/* Requests waiting on the super admin: newly submitted, or sent back by the
   admin asking for a different price. */
export const needsSuperAdmin = (r) => ['submitted', 'revision_requested'].includes(r?.status)
/* Requests waiting on the requesting admin to accept the price. */
export const needsAdmin = (r) => r?.status === 'quoted'

export function nextRequestNo(existing = []) {
  const pad = n => String(n).padStart(2, '0')
  const d = new Date()
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const todays = existing.filter(r => String(r.request_no || '').startsWith(`CR-${day}`))
  return `CR-${day}-${String(todays.length + 1).padStart(4, '0')}`
}

export async function fetchChangeRequests(companyId = null) {
  try {
    let q = supabase
      .from('change_requests')
      .select('*, lines:change_request_lines(*)')
      .order('created_at', { ascending: false })
    if (companyId) q = q.eq('company_id', companyId)
    const { data, error } = await q
    if (error) return { rows: [], error: error.message }
    const rows = (data ?? []).map(r => ({
      ...r,
      lines: [...(r.lines ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }))
    return { rows, error: null }
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load change requests.' }
  }
}

/* Insert or update a request together with its lines. Lines are replaced
   wholesale — they are few and always edited as a block. */
export async function saveChangeRequest(req, lines = [], { companyId = null } = {}) {
  const payload = {
    request_no:        req.request_no || null,
    requested_by:      req.requested_by || null,
    requested_by_name: req.requested_by_name || null,
    requester_role:    req.requester_role || null,
    requester_phone:   req.requester_phone || null,
    requester_email:   req.requester_email || null,
    company_label:     req.company_label || null,
    request_type:      req.request_type || 'new_feature',
    request_type_other: req.request_type_other || null,
    modules:           req.modules ?? [],
    screen_page:       req.screen_page || null,
    priority:          req.priority || 'medium',
    title:             (req.title || '').trim(),
    description:       req.description || null,
    justification:     req.justification || null,
    needed_by:         req.needed_by || null,
    status:            req.status || 'draft',
    submitted_at:      req.submitted_at || null,
    updated_at:        new Date().toISOString(),
  }

  let id = req.id
  if (id) {
    const { error } = await supabase.from('change_requests').update(payload).eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { data, error } = await supabase
      .from('change_requests')
      .insert([{ ...payload, ...(companyId ? { company_id: companyId } : {}) }])
      .select('id').single()
    if (error) return { error: error.message }
    id = data.id
  }

  const { error: delErr } = await supabase.from('change_request_lines').delete().eq('request_id', id)
  if (delErr) return { error: delErr.message }
  const clean = lines.filter(l => (l.description || '').trim())
  if (clean.length) {
    const { error: insErr } = await supabase.from('change_request_lines').insert(
      clean.map((l, i) => ({
        request_id: id, sort_order: i,
        line_type: l.line_type || null, module: l.module || null,
        description: (l.description || '').trim(),
        notes: l.notes || null,
        price: l.price === '' || l.price == null ? null : Number(l.price),
      })))
    if (insErr) return { error: insErr.message }
  }
  return { id, error: null }
}

/* Patch just the workflow/assessment fields (super-admin actions and the
   admin's acceptance). */
export async function patchChangeRequest(id, patch) {
  const { error } = await supabase
    .from('change_requests')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  return error ? error.message : null
}

export async function deleteChangeRequest(id) {
  const { error } = await supabase.from('change_requests').delete().eq('id', id)
  return error ? error.message : null
}

/* ── quotation rounds (fix120) ─────────────────────────────────────────────

   Every step of the pricing conversation is recorded: who did what, when, at
   what price, and with which PDF. The live figures stay on the request itself;
   these rows are the history behind them. */

export const QUOTE_ACTIONS = {
  quoted:             { label: 'Quotation sent',      by: 'super_admin' },
  revision_requested: { label: 'Revision requested',  by: 'admin' },
  accepted:           { label: 'Price accepted',      by: 'admin' },
  rejected:           { label: 'Request rejected',    by: 'super_admin' },
}

export const isMissingQuoteLedger = (msg = '') =>
  /change_request_quotes/i.test(msg) && /not exist|schema cache/i.test(msg)

/* The whole conversation for one request, oldest first. */
export async function fetchQuoteHistory(requestId) {
  if (!requestId) return { rows: [], error: null }
  try {
    const { data, error } = await supabase
      .from('change_request_quotes')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true })
    if (error) return { rows: [], error: error.message }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e?.message || '' }
  }
}

/* Record one step. Never fails the caller's action: if fix120 hasn't been run
   the step simply isn't logged, and the message says so. */
export async function logQuoteEvent(entry) {
  try {
    const { error } = await supabase.from('change_request_quotes').insert([{
      request_id: entry.request_id,
      round:      entry.round ?? 1,
      action:     entry.action,
      actor_id:   entry.actor_id   || null,
      actor_name: entry.actor_name || null,
      actor_role: entry.actor_role || null,
      price:      entry.price === '' || entry.price == null ? null : Number(entry.price),
      currency:   entry.currency || 'USD',
      message:    entry.message  || null,
      ready_by:   entry.ready_by || null,
      quotation_pdf:      entry.quotation_pdf      || null,
      quotation_filename: entry.quotation_filename || null,
    }])
    return error ? error.message : null
  } catch (e) {
    return e?.message || 'Could not record the quotation step.'
  }
}

export const isMissingTable = (msg = '') =>
  /change_requests?/i.test(msg) && /not exist|schema cache/i.test(msg)
