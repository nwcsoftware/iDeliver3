import React from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppProvider }  from './context/AppContext'
import Sidebar          from './components/layout/Sidebar'
import Header           from './components/layout/Header'
import PartnerShell      from './components/layout/PartnerShell'
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
import RetailInvoicesPage     from './pages/RetailInvoicesPage'
import PriceListPage          from './pages/PriceListPage'
import ReturnableItemsPage     from './pages/ReturnableItemsPage'
import AccountTransactionsPage from './pages/AccountTransactionsPage'
import ContactStatementsPage    from './pages/ContactStatementsPage'
import DriverDuesPage           from './pages/DriverDuesPage'
import CreditCustomersPage      from './pages/CreditCustomersPage'
import SupplierSettlementsPage   from './pages/SupplierSettlementsPage'
import CashierBoxPage           from './pages/CashierBoxPage'
import VehiclesPage          from './pages/VehiclesPage'
import ContactsPage          from './pages/ContactsPage'
import UserAccountsPage       from './pages/UserAccountsPage'
import DeveloperAccountPage    from './pages/DeveloperAccountPage'
import AppSettingsPage         from './pages/AppSettingsPage'
import MessagesPage            from './pages/MessagesPage'
import BroadcastPopup         from './components/messages/BroadcastPopup'
import ResetOrdersPage        from './pages/ResetOrdersPage'
import DeleteOrderPage         from './pages/DeleteOrderPage'
import DeleteOrdersRangePage   from './pages/DeleteOrdersRangePage'
import DriverCollectionsPage   from './pages/DriverCollectionsPage'
import CustomerMobileApp       from './customer-mobile/CustomerMobileApp'
import logo             from './assets/Logo.png'

function AppShell() {
  const { currentUser, loading, hasRole } = useAuth()

  const isCustomerMobileRoute =
    window.location.hash.startsWith('#/customer') ||
    window.location.pathname === '/customer' ||
    window.location.pathname.startsWith('/customer/')

  // Customer mobile app runs as a separate experience under customer routes.
  if (isCustomerMobileRoute) {
    return <CustomerMobileApp />
  }

  // Full-screen splash while rehydrating session
  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-surface gap-4">
        <img src={logo} alt="iDeliver" className="w-16 h-16 object-contain" />
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

  // Suppliers & Partners are limited to their own portal: only Sold Orders and
  // Completed Orders. The full app (and all its routes) is never mounted for them.
  if (hasRole('supplier', 'partner')) {
    return <PartnerShell />
  }

  return (
    <AppProvider>
      <HashRouter>
        <div className="h-screen flex flex-col overflow-hidden">
          <BroadcastPopup />
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
                <Route path="/retail-invoices"      element={<RetailInvoicesPage />} />
                <Route path="/price-list"           element={<PriceListPage />} />
                <Route path="/returnable-items"     element={<ReturnableItemsPage />} />
                <Route path="/account-transactions" element={<AccountTransactionsPage />} />
                <Route path="/account-statements" element={<ContactStatementsPage />} />
                <Route path="/driver-dues"          element={<DriverDuesPage />} />
                <Route path="/credit-customers"     element={<CreditCustomersPage />} />
                <Route path="/supplier-settlements" element={<SupplierSettlementsPage />} />
                <Route path="/cashier-box"          element={<CashierBoxPage />} />
                <Route path="/vehicles"             element={<VehiclesPage />} />
                <Route path="/contacts/suppliers"  element={<ContactsPage type="supplier" />} />
                <Route path="/contacts/customers"  element={<ContactsPage type="customer" />} />
                <Route path="/contacts/partners"   element={<ContactsPage type="partner"  />} />
                <Route path="/settings/app"        element={<AppSettingsPage />} />
                <Route path="/settings/messages"   element={<MessagesPage />} />
                <Route path="/settings/users"      element={<UserAccountsPage />} />
                <Route path="/settings/account"    element={<DeveloperAccountPage />} />
                <Route path="/settings/delete-order" element={<DeleteOrderPage />} />
                <Route path="/settings/delete-orders-range" element={<DeleteOrdersRangePage />} />
                <Route path="/settings/driver-collections" element={<DriverCollectionsPage />} />
                <Route path="/settings/reset"      element={<ResetOrdersPage />} />
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
