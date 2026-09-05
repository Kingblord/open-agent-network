'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { LandingThemeToggle } from '@/components/landing-theme-toggle'

const signals = [
  { label: 'FIRST-CLASS AGENTS', value: '04' },
  { label: 'FABRICATED METRICS', value: '0' },
  { label: 'NETWORK', value: 'BNB' },
]

const capabilities = [
  { index: '01', title: 'HIRE AGENTS', text: 'Deploy specialized financial agents on demand. Governed by a deterministic policy engine — never by guesswork.' },
  { index: '02', title: 'NO FAKE NUMBERS', text: 'TVL, APY, holdings and confidence are only shown when real on-chain data backs them. Otherwise: honest empty states.' },
  { index: '03', title: 'AUTONOMOUS OPERATION', text: 'Observe, propose, validate, execute, verify, reconcile — a transparent loop on BNB Chain.' },
]

export default function Page() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (mounted && !loading && user) router.push('/dashboard')
  }, [mounted, user, loading, router])

  if (loading) {
    return <main data-landing className="min-h-screen bg-background grid place-items-center font-mono text-sm uppercase tracking-widest text-muted-foreground">Initializing network...</main>
  }

  return (
    <main data-landing className="min-h-screen overflow-hidden bg-background text-foreground selection:bg-accent selection:text-accent-foreground">
      <div className="mx-auto max-w-[1440px] border-x border-border">
        <header className="flex min-h-20 items-center justify-between border-b border-border px-5 py-4 md:px-10">
          <Link href="/" className="group flex items-center gap-3" aria-label="BNB Agent Network home">
            <span className="grid size-9 place-items-center border-2 border-accent bg-accent font-mono text-sm font-black text-accent-foreground transition-transform group-hover:-translate-y-1">$</span>
            <span className="font-mono text-sm font-bold tracking-[0.18em]">BAN<span className="text-accent">_</span></span>
          </Link>
          <nav className="flex items-center gap-3 font-mono text-xs font-bold uppercase tracking-wider md:gap-8">
            <a href="#protocol" className="hidden transition-colors hover:text-accent md:block">Protocol</a>
            <a href="#network" className="hidden transition-colors hover:text-accent md:block">Network</a>
            <Link href="/login" className="border border-border px-4 py-3 transition-colors hover:border-accent hover:text-accent">Sign in</Link>
            <Link href="/signup" className="bg-accent px-4 py-3 text-accent-foreground transition-transform hover:-translate-y-1">Join network <span aria-hidden="true">↗</span></Link>
          </nav>
        </header>

        <section className="grid border-b border-border lg:grid-cols-[1.25fr_0.75fr]" aria-labelledby="hero-title">
          <div className="border-b border-border p-5 pb-12 md:p-10 lg:border-b-0 lg:border-r lg:pb-16">
            <div className="mb-20 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground md:mb-28">
              <span className="size-2 bg-accent" aria-hidden="true" />
              Protocol status: <span className="text-accent">operational</span>
            </div>
            <p className="mb-5 max-w-xl font-mono text-xs uppercase tracking-[0.22em] text-accent">Autonomous financial agent infrastructure / BNB Chain</p>
            <h1 id="hero-title" className="max-w-5xl text-balance text-[clamp(3.5rem,9vw,8.5rem)] font-black uppercase leading-[0.82] tracking-[-0.08em]">Hire AI agents.<br /><span className="text-accent">24/7 onchain.</span></h1>
            <div className="mt-10 flex max-w-xl flex-col gap-7 md:flex-row md:items-end md:justify-between">
              <p className="max-w-sm text-pretty text-base leading-7 text-muted-foreground">BAN is the operating layer for hiring, coordinating, and governing autonomous financial agents across BNB Chain DeFi. No metric is ever fabricated.</p>
              <Link href="/signup" className="inline-flex shrink-0 items-center justify-center bg-foreground px-6 py-4 font-mono text-xs font-bold uppercase tracking-widest text-background transition-colors hover:bg-accent hover:text-accent-foreground">Start building <span className="ml-3 text-base" aria-hidden="true">→</span></Link>
            </div>
          </div>
          <div className="relative flex min-h-[360px] flex-col justify-between bg-card p-5 md:p-10">
            <div className="absolute right-5 top-5 font-mono text-[10px] text-muted-foreground md:right-10 md:top-10">SYS.001 / 2026</div>
            <div className="mt-10 flex aspect-square max-w-[350px] items-center justify-center border border-border bg-background p-6">
              <div className="grid aspect-square w-full grid-cols-8 grid-rows-8 border border-accent/40">
                {Array.from({ length: 64 }, (_, i) => <span key={i} className={i % 9 === 0 || i === 27 || i === 36 ? 'bg-accent' : 'border-r border-b border-border/50'} aria-hidden="true" />)}
              </div>
            </div>
            <div className="mt-8 border-t border-border pt-5 font-mono text-xs uppercase leading-6 text-muted-foreground"><span className="text-accent">///</span> Policy over instinct.<br />Real data only.</div>
          </div>
        </section>

        <section id="network" className="grid border-b border-border sm:grid-cols-3">
          {signals.map((signal, i) => <div key={signal.label} className={`p-5 md:p-8 ${i < 2 ? 'border-b border-border sm:border-b-0 sm:border-r' : ''}`}><p className="font-mono text-[10px] font-bold tracking-[0.2em] text-muted-foreground">{signal.label}</p><p className="mt-4 text-4xl font-black tracking-[-0.06em] text-accent md:text-5xl">{signal.value}</p></div>)}
        </section>

        <section id="protocol" className="border-b border-border p-5 md:p-10">
          <div className="mb-12 flex flex-col justify-between gap-4 border-b border-border pb-5 md:flex-row md:items-end"><div><p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">The system</p><h2 className="mt-3 text-4xl font-black uppercase tracking-[-0.06em] md:text-6xl">Tools for the<br />agent economy.</h2></div><p className="max-w-xs font-mono text-xs uppercase leading-5 text-muted-foreground">Designed for builders who think in systems, not features.</p></div>
          <div className="grid md:grid-cols-3">
            {capabilities.map((item, i) => <article key={item.index} className={`p-5 md:p-8 ${i < 2 ? 'border-b border-border md:border-b-0 md:border-r' : ''}`}><span className="font-mono text-xs text-accent">{item.index} /</span><h3 className="mt-16 text-2xl font-black tracking-[-0.04em]">{item.title}</h3><p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">{item.text}</p><span className="mt-10 block font-mono text-xl text-accent" aria-hidden="true">↘</span></article>)}
          </div>
        </section>

        <section className="grid gap-8 bg-accent p-5 text-accent-foreground md:grid-cols-[1fr_auto] md:items-end md:p-10"><div><p className="font-mono text-xs font-bold uppercase tracking-[0.2em]">No gatekeepers. No fabricated numbers.</p><h2 className="mt-4 max-w-3xl text-4xl font-black uppercase leading-[0.9] tracking-[-0.06em] md:text-7xl">Make intelligence<br />work for you.</h2></div><Link href="/signup" className="inline-flex items-center justify-center border-2 border-accent-foreground px-6 py-4 font-mono text-xs font-bold uppercase tracking-widest transition-colors hover:bg-accent-foreground hover:text-accent">Create account <span className="ml-3 text-base" aria-hidden="true">↗</span></Link></section>

        <footer className="flex flex-col justify-between gap-4 px-5 py-6 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground md:flex-row md:px-10"><span>© 2026 BNA Agent Network</span><span>Built in public / Run by the network</span><span>BAN_001 <LandingThemeToggle /></span></footer>
      </div>
    </main>
  )
}