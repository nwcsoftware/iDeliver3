import React from 'react'
import { Shield } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isStrictAdmin, roleLabel } from '../lib/roles'

/* A route that only an admin or a super admin may open — and a Senior Call
 * Center user may NOT, despite inheriting admin everywhere else.
 *
 * WHY A WRAPPER AND NOT A CHECK INSIDE EACH PAGE. Hiding a menu entry is not a
 * restriction: the route still answers, and an address typed or a bookmark
 * kept from last week still opens the page. Putting the gate on the route
 * means the pages behind it cannot be reached without passing it, and a report
 * added next month is covered by being listed here rather than by somebody
 * remembering to copy a check into it.
 *
 * The refusal says which rank was refused. "You don't have permission" sends a
 * user to ask why; naming the rank lets them see that it is their account, not
 * a fault, and ask for the right thing.
 */
export default function StrictAdminRoute({ children, what = 'this page' }) {
  const { currentUser } = useAuth()
  if (isStrictAdmin(currentUser?.role)) return children

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
      <Shield className="w-10 h-10 text-slate-600" />
      <p className="text-slate-300 font-medium">Administrators only</p>
      <p className="text-slate-500 text-sm max-w-sm">
        {what} is open to administrators and super administrators.
        {currentUser?.role && (
          <> Your account is a <span className="text-slate-400">{roleLabel(currentUser.role)}</span>.</>
        )}
      </p>
    </div>
  )
}
