import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  Sparkles,
  TrendingUp,
  Target,
  BarChart3,
  Zap,
  Award,
  Users,
  CheckCircle2,
  LogIn,
  Quote,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Brand Idea Online — public marketing landing page
// Rendered at "/" when the visitor is NOT authenticated.
// Authenticated visitors are redirected to /dashboard via RootRoute (see App.tsx).
// ---------------------------------------------------------------------------

const services = [
  {
    icon: Target,
    title: 'Performance Advertising',
    desc: 'Meta, Google & LinkedIn campaigns engineered for ROAS — not vanity metrics.',
  },
  {
    icon: TrendingUp,
    title: 'SEO & Content',
    desc: 'Rank for revenue keywords with technical SEO plus editorial content that converts.',
  },
  {
    icon: BarChart3,
    title: 'Analytics & CRO',
    desc: 'Funnel audits and A/B tests that compound conversions month over month.',
  },
  {
    icon: Zap,
    title: 'Email & Retention',
    desc: 'Lifecycle flows that turn one-time buyers into repeat customers.',
  },
  {
    icon: Award,
    title: 'Brand Strategy',
    desc: 'Positioning, messaging, and creative that makes you the obvious choice.',
  },
  {
    icon: Users,
    title: 'Social & Influencer',
    desc: 'Organic content and creator partnerships that move real product.',
  },
];

const stats = [
  { value: '$38M+', label: 'Client revenue driven' },
  { value: '4.2×',  label: 'Average ROAS' },
  { value: '200+',  label: 'Brands scaled' },
  { value: '97%',   label: 'Retention rate' },
];

const testimonials = [
  {
    quote:
      'Brand Idea rebuilt our paid funnel from scratch. CAC dropped 43% in the first quarter and ROAS crossed 5× by month four.',
    author: 'Ananya Sharma',
    title: 'CMO, Velura Beauty',
  },
  {
    quote:
      'Honest reporting, fast iterations, and real strategic thinking. They feel like our in-house growth team, not an agency.',
    author: 'Rohan Mehta',
    title: 'Founder, Northwind Apparel',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background font-sans">
      {/* ============================ NAVBAR ============================ */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center shadow-sm">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-bold text-base tracking-tight">Brand Idea Online</span>
              <span className="text-[10px] text-muted-foreground tracking-[0.18em] uppercase mt-0.5">
                Digital Marketing Agency
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-7">
            <a href="#services" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Services</a>
            <a href="#results"  className="text-sm text-muted-foreground hover:text-foreground transition-colors">Results</a>
            <a href="#clients"  className="text-sm text-muted-foreground hover:text-foreground transition-colors">Clients</a>
            <a href="#contact"  className="text-sm text-muted-foreground hover:text-foreground transition-colors">Contact</a>
          </nav>

          <Link to="/login">
            <Button size="sm" className="gap-2">
              <LogIn className="w-4 h-4" />
              Employee Login
            </Button>
          </Link>
        </div>
      </header>

      {/* ============================ HERO ============================== */}
      <section className="relative overflow-hidden">
        {/* ambient gradient blobs */}
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] bg-primary/15 rounded-full blur-3xl" />
          <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] bg-accent/15 rounded-full blur-3xl" />
        </div>

        <div className="container py-20 md:py-32">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium mb-8 border border-primary/20">
              <Sparkles className="w-3 h-3" />
              Trusted by 200+ growing brands
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-foreground mb-6 leading-[1.05]">
              Digital marketing that{' '}
              <span className="relative inline-block">
                <span className="relative z-10 text-primary">actually converts</span>
                <span className="absolute inset-x-0 bottom-1 h-3 bg-accent/25 -z-0 rounded" />
              </span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              We build performance-driven brand, paid media, and SEO strategies that turn audiences into revenue.
              No fluff. No vanity metrics. Just growth you can defend in a board meeting.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button asChild size="lg" className="gap-2 px-6">
                <a href="#contact">
                  Book a Strategy Call <ArrowRight className="w-4 h-4" />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="gap-2 px-6">
                <a href="#results">See Our Results</a>
              </Button>
            </div>

            <div className="mt-16 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-accent" />No long-term contracts</span>
              <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-accent" />Transparent reporting</span>
              <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-accent" />Dedicated strategist</span>
            </div>
          </div>
        </div>
      </section>

      {/* ============================ SERVICES ============================ */}
      <section id="services" className="border-t border-border/40 bg-muted/30">
        <div className="container py-20 md:py-24">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <div className="text-xs font-semibold tracking-[0.2em] uppercase text-primary mb-3">What we do</div>
            <h2 className="text-3xl md:text-4xl font-bold mb-3 tracking-tight">
              Full-funnel marketing that scales
            </h2>
            <p className="text-muted-foreground">
              From awareness to revenue — one integrated team, one dashboard, one clear plan.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {services.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group relative p-6 bg-card border border-border/60 rounded-xl hover:border-primary/40 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-lg mb-1.5 tracking-tight">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ RESULTS ============================ */}
      <section id="results" className="border-t border-border/40">
        <div className="container py-20">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <div className="text-xs font-semibold tracking-[0.2em] uppercase text-primary mb-3">Proof, not promises</div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Numbers our clients brag about
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {stats.map(({ value, label }) => (
              <div key={label}>
                <div className="text-4xl md:text-5xl font-bold text-primary tracking-tight">{value}</div>
                <div className="text-sm text-muted-foreground mt-2">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ CLIENTS / TESTIMONIALS ============================ */}
      <section id="clients" className="border-t border-border/40 bg-muted/30">
        <div className="container py-20">
          <div className="grid md:grid-cols-2 gap-6">
            {testimonials.map((t) => (
              <div
                key={t.author}
                className="relative p-8 bg-card border border-border/60 rounded-xl"
              >
                <Quote className="w-8 h-8 text-primary/20 mb-4" />
                <p className="text-foreground/90 leading-relaxed mb-6">"{t.quote}"</p>
                <div className="flex items-center gap-3 pt-4 border-t border-border/60">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
                    {t.author.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{t.author}</div>
                    <div className="text-xs text-muted-foreground">{t.title}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ CTA ============================ */}
      <section id="contact" className="container py-20">
        <div className="relative overflow-hidden bg-primary rounded-2xl p-10 md:p-14 text-center">
          <div className="absolute -top-20 -right-20 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-white/5 rounded-full blur-3xl" />
          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground mb-3 tracking-tight">
              Ready to scale?
            </h2>
            <p className="text-primary-foreground/80 max-w-xl mx-auto mb-7 leading-relaxed">
              Book a free 30-minute strategy call. No pitch deck — just a clear, data-backed plan for your next 90 days.
            </p>
            <Button asChild size="lg" variant="secondary" className="gap-2">
              <a href="mailto:hello@brandideaonline.com">
                Book Your Free Call <ArrowRight className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* ============================ FOOTER ============================ */}
      <footer className="border-t border-border/40 py-8">
        <div className="container flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span>© {new Date().getFullYear()} Brand Idea Online. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#services" className="hover:text-foreground transition-colors">Services</a>
            <a href="#contact"  className="hover:text-foreground transition-colors">Contact</a>
            <Link to="/login"   className="hover:text-foreground transition-colors">Employee Login</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
