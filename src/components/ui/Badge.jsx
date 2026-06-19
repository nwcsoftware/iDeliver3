import React from 'react'

export const variants = {
  // driver_status
  available:             'bg-green-500/15  text-green-400  border-green-500/30',
  on_duty:               'bg-brand-500/15  text-brand-400  border-brand-500/30',
  off_duty:              'bg-slate-500/15  text-slate-400  border-slate-500/30',
  inactive:              'bg-slate-600/15  text-slate-500  border-slate-600/30',
  // status (4-step lifecycle)
  scheduled:             'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  in_progress:           'bg-brand-500/15  text-brand-400  border-brand-500/30',
  completed:             'bg-green-500/15  text-green-400  border-green-500/30',
  // legacy status values (still rendered for old data)
  pending:               'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  confirmed:             'bg-cyan-500/15   text-cyan-400   border-cyan-500/30',
  assigned:              'bg-blue-500/15   text-blue-400   border-blue-500/30',
  picked_up:             'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  in_transit:            'bg-brand-500/15  text-brand-400  border-brand-500/30',
  delivered:             'bg-green-500/15  text-green-400  border-green-500/30',
  cancelled:             'bg-slate-500/15  text-slate-400  border-slate-500/30',
  failed:                'bg-red-500/15    text-red-400    border-red-500/30',
  return_requested:      'bg-orange-500/15 text-orange-400 border-orange-500/30',
  returned:              'bg-orange-600/15 text-orange-300 border-orange-600/30',
  // payment_status
  unpaid:                'bg-red-500/15    text-red-400    border-red-500/30',
  partially_paid:        'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  due_for_collection:    'bg-orange-500/15 text-orange-400 border-orange-500/30',
  collected_by_driver:   'bg-cyan-500/15   text-cyan-400   border-cyan-500/30',
  paid_to_office:        'bg-teal-500/15   text-teal-400   border-teal-500/30',
  closed:                'bg-green-500/15  text-green-400  border-green-500/30',
  refunded:              'bg-purple-500/15 text-purple-400 border-purple-500/30',
}

export const labels = {
  scheduled:           'Scheduled',
  in_progress:         'In Progress',
  completed:           'Completed',
  available:           'Available',
  on_duty:             'On Duty',
  off_duty:            'Off Duty',
  inactive:            'Inactive',
  pending:             'Pending',
  confirmed:           'Confirmed',
  assigned:            'Assigned',
  picked_up:           'Picked Up',
  in_transit:          'In Transit',
  delivered:           'Delivered',
  cancelled:           'Cancelled',
  failed:              'Failed',
  return_requested:    'Return Requested',
  returned:            'Returned',
  unpaid:              'Unpaid',
  partially_paid:      'Partial',
  due_for_collection:  'Due Collection',
  collected_by_driver: 'With Driver',
  paid_to_office:      'Paid',
  closed:              'Closed',
  refunded:            'Refunded',
}

export default function Badge({ status }) {
  const cls = variants[status] || 'bg-slate-500/15 text-slate-400 border-slate-500/30'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${cls}`}>
      {labels[status] ?? status}
    </span>
  )
}
