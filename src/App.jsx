import React from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppProvider }  from './context/AppContext'
import Sidebar          from './components/layout/Sidebar'
import Header           from './components/layout/Header'
import LoginPage        from './pages/LoginPage'
import ForcePasswordChangePage from './pages/ForcePasswordChangePage'
import DashboardPage    from './pages/DashboardPage'
import DriversPage      from './pages/DriversPage'
import DeliveriesPage   from './pages/DeliveriesPage'
import TrackingPage     from './pages/TrackingPage'
import ReportsPage      from './pages/ReportsPage'
import CompanyPage      from './pages/CompanyPage'
import ProductsPage          from './pages/ProductsPage'
import PurchaseInvoicesPage  from './pages/PurchaseInvoicesPage'
import ContactsPage          from './pages/ContactsPage'
import UserAccountsPage       from './pages/UserAccountsPage'
import { Truck }        from 'lucide-react'

function AppShell() {
  const { currentUser, loading } = useAuth()

  // Full-screen splash while rehydrating session
  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-surface gap-4">
        <div className="w-14 h-14 rounded-2xl bg-brand-600 flex items-center justify-center">
          <Truck className="w-7 h-7 text-white" />
        </div>
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce [animation-delay:0ms]"   />
          <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return <LoginPage />
  }

  // New account or admin-reset password: block the app until it's changed.
  if (currentUser.must_change_password) {
    return <ForcePasswordChangePage />
  }

  return (
    <AppProvider>
      <HashRouter>
        <div className="h-screen flex flex-col overflow-hidden">
          <Header />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <main className="flex-1 flex flex-col overflow-hidden">
              <Routes>
                <Route path="/"           element={<DashboardPage  />} />
                <Route path="/drivers"    element={<DriversPage    />} />
                <Route path="/deliveries"    element={<DeliveriesPage />} />
                <Route path="/closed-orders" element={<DeliveriesPage closed />} />
                <Route path="/tracking"   element={<TrackingPage   />} />
                <Route path="/reports"    element={<ReportsPage    />} />
                <Route path="/company"   element={<CompanyPage    />} />
                <Route path="/products"       element={<ProductsPage          />} />
                <Route path="/purchase-invoices"    element={<PurchaseInvoicesPage />} />
                <Route path="/contacts/suppliers"  element={<ContactsPage type="supplier" />} />
                <Route path="/contacts/customers"  element={<ContactsPage type="customer" />} />
                <Route path="/contacts/partners"   element={<ContactsPage type="partner"  />} />
                <Route path="/settings/users"      element={<UserAccountsPage />} />
              </Routes>
            </main>
          </div>
        </div>
      </HashRouter>
    </AppProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
