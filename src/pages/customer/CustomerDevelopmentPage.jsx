import React from 'react'
import { CheckCircle2, Circle, ClipboardCheck, Database, LockKeyhole, Smartphone, Truck } from 'lucide-react'

const steps = [
  {
    label: 'Step 1',
    title: 'Database readiness',
    status: 'In progress',
    detail: 'Live Supabase is connected. Customer credit and saved-address fields are missing, so the Step 1 migration file is prepared.',
    active: true,
  },
  {
    label: 'Step 2',
    title: 'Customer route foundation',
    status: 'Next',
    detail: 'Create the mobile customer area, separate from staff screens.',
  },
  {
    label: 'Step 3',
    title: 'Registration and OTP',
    status: 'Waiting',
    detail: 'First-time mobile OTP, password setup, contact creation, and customer user account creation.',
  },
  {
    label: 'Step 4',
    title: 'Customer ordering',
    status: 'Waiting',
    detail: 'Products, cart, delivery booking, My Orders, and staff review compatibility.',
  },
]

const readiness = [
  ['Supabase connection', 'Connected and responding'],
  ['Company record', 'ID3-MAIN / 3asari3 found'],
  ['Required migration', 'supabase-customer-step1.sql'],
  ['Credit rule', 'Approved credit customer only; all others cash on delivery'],
  ['Delivery fee rule', 'Staff enters fee manually in internal app'],
]

export default function CustomerDevelopmentPage() {
  return (
    <div className="min-h-screen overflow-y-auto bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600">
              <Truck className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">Customer App Development</h1>
              <p className="text-xs text-slate-400">iDeliver III mobile customer workflow</p>
            </div>
          </div>
          <div className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200">
            Step 1
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-4 px-4 py-5 lg:grid-cols-[1fr_340px]">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-cyan-300">Current checkpoint</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">Database readiness</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                The customer app needs staff-controlled credit approval and saved address fields before registration,
                checkout, and delivery booking are built. The live database is reachable, and the required migration
                has been prepared for review.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {readiness.map(([name, value]) => (
              <div key={name} className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                <p className="text-xs text-slate-500">{name}</p>
                <p className="mt-1 text-sm font-medium text-slate-100">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
              <div>
                <h3 className="text-sm font-semibold text-amber-100">Before we move to Step 2</h3>
                <p className="mt-1 text-sm leading-6 text-amber-50/80">
                  Run <span className="font-mono text-amber-100">supabase-customer-step1.sql</span> in Supabase SQL
                  Editor. After it is applied, we will verify the fields live and mark Step 1 complete.
                </p>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold text-slate-200">Progress</h2>
            <div className="mt-4 space-y-3">
              {steps.map(step => (
                <div key={step.label} className={`rounded-lg border p-3 ${step.active ? 'border-brand-500/50 bg-brand-500/10' : 'border-slate-800 bg-slate-950'}`}>
                  <div className="flex items-start gap-3">
                    {step.active ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-300" />
                    ) : (
                      <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" />
                    )}
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold uppercase text-slate-500">{step.label}</p>
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{step.status}</span>
                      </div>
                      <h3 className="mt-1 text-sm font-semibold text-slate-100">{step.title}</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{step.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <Smartphone className="h-5 w-5 text-emerald-300" />
              <p className="mt-3 text-xs text-slate-500">Target</p>
              <p className="text-sm font-semibold">Mobile-first</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <LockKeyhole className="h-5 w-5 text-rose-300" />
              <p className="mt-3 text-xs text-slate-500">Security</p>
              <p className="text-sm font-semibold">Customer-only</p>
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

