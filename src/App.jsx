import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownToLine, BarChart3, CalendarDays, Camera, Check, ChevronRight,
  CircleHelp, Droplets, FileText, Home, ImagePlus,
  IndianRupee, LogOut, Menu, Milk, Plus, Search, Settings, ShieldCheck, Sprout,
  Pencil, Upload, Users, X,
} from 'lucide-react'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import dairyBackdrop from './assets/dairy-background.jpg'
import welcomeCow from './assets/cow-welcome.png'
import producerFarmer from './assets/producer-farmer-cutout.png'
import { api, downloadReport, refreshCsrf } from './api'
import './App.css'

const navigation = [
  { path: '/dashboard', label: 'डॅशबोर्ड', english: 'Overview', icon: Home, emoji: '🏡', theme: 'overview', banner: 'Your dairy, all in one place', caption: 'A clear view of collections, producers and the work ahead.' },
  { path: '/producers', label: 'उत्पादक मास्टर', english: 'Producers', icon: Users, emoji: '🧑‍🌾', theme: 'producers', banner: 'Built around your people', caption: 'Keep every producer profile and dairy relationship organized.' },
  { path: '/milk', label: 'दूध संकलन', english: 'Milk collection', icon: Milk, emoji: '🥛', theme: 'collection', banner: 'Every litre, accounted for', caption: 'Record collections, review sessions and keep daily totals on track.' },
  { path: '/rates', label: 'दरपत्रक', english: 'Rate chart', icon: BarChart3, emoji: '📊', theme: 'rates', banner: 'Rates that add up', caption: 'Set clear milk rate slabs for consistent, accurate calculations.' },
  { path: '/feed', label: 'खाद्य मास्टर', english: 'Feed items', icon: Sprout, emoji: '🌾', theme: 'feed', banner: 'Feed management, made simple', caption: 'Organize your feed inventory and keep producer issues in view.' },
  { path: '/advances', label: 'उचल', english: 'Producer advances', icon: IndianRupee, emoji: '💰', theme: 'accounts', banner: 'A clearer picture of every balance', caption: 'Track advances, payments and producer account activity.' },
  { path: '/reports', label: 'दूध बिल', english: 'Dudh bill', icon: FileText, emoji: '🧾', theme: 'reports', banner: 'Your dairy numbers, ready to share', caption: 'Review collection reports and prepare producer statements.' },
  { path: '/settings', label: 'डेअरी सेटिंग्ज', english: 'Dairy settings', icon: Settings, emoji: '⚙️', theme: 'settings', banner: 'Make this dairy workspace yours', caption: 'Manage the dairy details shown throughout your workspace.' },
]

const workspaceFeatures = [
  { path: '/producers', icon: Users, emoji: '🧑‍🌾', title: 'Producers', marathi: 'उत्पादक', text: 'Manage your dairy community', theme: 'producers' },
  { path: '/rates', icon: BarChart3, emoji: '📊', title: 'Rate chart', marathi: 'दरपत्रक', text: 'Set milk rates and slabs', theme: 'rates' },
  { path: '/milk', icon: Milk, emoji: '🥛', title: 'Milk collection', marathi: 'दूध संकलन', text: 'Record and review daily milk', theme: 'collection' },
  { path: '/feed', icon: Sprout, emoji: '🌾', title: 'Feed inventory', marathi: 'खाद्य व्यवस्थापन', text: 'Track feed issues and balances', theme: 'feed' },
  { path: '/advances', icon: IndianRupee, emoji: '💰', title: 'Advances', marathi: 'उचल', text: 'Manage producer payments', theme: 'accounts' },
  { path: '/reports', icon: FileText, emoji: '🧾', title: 'Reports & bills', marathi: 'अहवाल आणि बिले', text: 'Create statements and reports', theme: 'reports' },
]

const number = (value, fraction = 2) => Number(value || 0).toLocaleString('en-IN', {
  minimumFractionDigits: fraction,
  maximumFractionDigits: fraction,
})

const localDate = (date = new Date()) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

function Logo({ name = 'DoudhVyavastha', compact = false }) {
  return (
    <div className={`brand-lockup ${compact ? 'brand-compact' : ''}`}>
      <div className="brand-mark" aria-hidden="true"><Droplets size={23} strokeWidth={2.2} /></div>
      <div className="brand-copy">
        <strong>{name}</strong>
        {!compact && <span>दुग्ध व्यवस्थापन</span>}
      </div>
    </div>
  )
}

function UserAvatar({ user, compact = false }) {
  const initials = user.fullName.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className={`avatar ${compact ? 'avatar-small' : ''}`}>
      {user.photoUrl ? <img src={user.photoUrl} alt="" /> : initials}
    </div>
  )
}

function AuthPage({ onLogin }) {
  const location = useLocation()
  const navigate = useNavigate()
  const registering = location.pathname === '/register'
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [profilePhoto, setProfilePhoto] = useState(null)
  const [profilePhotoPreview, setProfilePhotoPreview] = useState('')
  const [photoError, setPhotoError] = useState('')

  useEffect(() => {
    return () => {
      if (profilePhotoPreview) URL.revokeObjectURL(profilePhotoPreview)
    }
  }, [profilePhotoPreview])

  function chooseRegistrationPhoto(event) {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    setPhotoError('')
    setMessage('')
    if (!chosen) return
    setProfilePhoto(null)
    setProfilePhotoPreview('')
    if (chosen.size > 2 * 1024 * 1024) {
      setPhotoError('Choose a photo smaller than 2 MB.')
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type)) {
      setPhotoError('Choose a JPEG, PNG, or WebP photo.')
      return
    }
    setProfilePhoto(chosen)
    setProfilePhotoPreview(URL.createObjectURL(chosen))
  }

  async function submit(event) {
    event.preventDefault()
    setMessage('')
    const fields = Object.fromEntries(new FormData(event.currentTarget).entries())
    if (registering && fields.password !== fields.confirmPassword) {
      setMessage('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      if (registering) {
        const registration = new FormData()
        for (const [key, value] of Object.entries(fields)) {
          if (key !== 'photo') registration.set(key, String(value))
        }
        registration.set('consent', fields.consent === 'on' ? 'true' : 'false')
        if (profilePhoto) registration.set('photo', profilePhoto)
        await api('/auth/register', { method: 'POST', body: registration })
        setMessage('Registration complete. Please log in to your dairy.')
        navigate('/login')
      } else {
        await api('/auth/login', { method: 'POST', body: JSON.stringify({
          identity: fields.identity,
          password: fields.password,
        }) })
        await refreshCsrf()
        await onLogin()
        navigate('/dashboard')
      }
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-backdrop" aria-hidden="true">
        <img src={dairyBackdrop} alt="" />
        <div className="auth-backdrop-shade" />
      </div>
      <div className="auth-glows" aria-hidden="true">
        <span className="auth-glow auth-glow-one" />
        <span className="auth-glow auth-glow-two" />
      </div>
      <section className={`auth-form-wrap ${registering ? 'auth-form-wrap-register' : ''}`} aria-label={registering ? 'Register your dairy' : 'Sign in'}>
        <img
          className="auth-cow"
          src={welcomeCow}
          alt=""
          aria-hidden="true"
        />
        <div className={`auth-card ${registering ? 'auth-card-register' : ''}`}>
          <div className="auth-brand"><Logo /></div>
          <div className="auth-heading">
            <h1>{registering ? 'Create your dairy account' : 'Welcome back'}</h1>
            <p className="muted">{registering ? 'Set up your space. Your dairy, your data.' : 'Sign in to continue.'}</p>
          </div>
          <form className="form-stack auth-form" onSubmit={submit}>
            {registering ? (
              <>
                <label className="auth-profile-photo-picker" aria-label="Add profile photo (optional)" title="Add profile photo (optional)">
                  {profilePhotoPreview ? <img src={profilePhotoPreview} alt="" /> : <Camera size={24} strokeWidth={2} />}
                  <input name="photo" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={chooseRegistrationPhoto} />
                </label>
                {photoError && <span className="auth-photo-error" role="alert">{photoError}</span>}
                <div className="field-row">
                  <label>Owner full name<input name="fullName" autoComplete="name" required minLength="2" placeholder="e.g. Rohan Patil" /></label>
                  <label>Dairy / business name<input name="dairyName" required minLength="2" placeholder="e.g. Patil" /></label>
                </div>
                <div className="field-row">
                  <label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
                  <label>Mobile number<input name="mobile" type="tel" autoComplete="tel" required minLength="7" placeholder="+91 98765 43210" /></label>
                </div>
                <div className="field-row">
                  <label>Password<input name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength="10" placeholder="At least 10 characters" /></label>
                  <label>Confirm password<input name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength="10" placeholder="Re-enter password" /></label>
                </div>
                <button className="password-toggle" type="button" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? 'Hide passwords' : 'Show passwords'}
                </button>
                <div className="field-row">
                  <label>Village / city<input name="village" autoComplete="address-level2" required placeholder="Your village or city" /></label>
                  <label>Address <span className="optional">(optional)</span><input name="address" autoComplete="street-address" placeholder="Street, landmark" /></label>
                </div>
                <label className="consent"><input type="checkbox" name="consent" required /><span>I agree to the terms and privacy policy.</span></label>
              </>
            ) : (
              <>
                <label>Email or mobile number<input name="identity" autoComplete="username" required placeholder="you@example.com or mobile" /></label>
                <label>Password<input name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required placeholder="Enter your password" /></label>
                <button className="password-toggle" type="button" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? 'Hide password' : 'Show password'}
                </button>
                <p className="form-note">Forgot your password? Password reset is not configured yet. Ask your system administrator for help.</p>
              </>
            )}
            {message && <div className={`notice ${message.includes('complete') ? 'notice-success' : ''}`} role="alert">{message}</div>}
            <button className="button button-primary button-wide" disabled={busy}>
              {busy ? 'Please wait…' : registering ? 'Create dairy account' : 'Sign in'} <ChevronRight size={17} />
            </button>
          </form>
          <p className="auth-switch">
            {registering ? 'Already have a dairy?' : 'New to DoudhVyavastha?'}{' '}
            <button onClick={() => { setMessage(''); navigate(registering ? '/login' : '/register') }}>
              {registering ? 'Sign in' : 'Register your dairy'}
            </button>
          </p>
          <div className="auth-secure"><ShieldCheck size={15} /> Private session · Your dairy stays separate</div>
        </div>
      </section>
    </main>
  )
}

function AppLayout({ user, onLogout, onProfile }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [date, setDate] = useState(() => new URLSearchParams(location.search).get('date') || localDate())
  const isDashboard = location.pathname === '/dashboard'
  const isProducers = location.pathname === '/producers'
  const page = navigation.find((item) => item.path === location.pathname) || navigation[0]
  const title = page.path === '/dashboard' ? 'Dashboard' : page.label

  function navigateTo(path) {
    navigate(path)
    setMenuOpen(false)
  }

  return (
    <div className={`app-shell theme-${page.theme} ${isDashboard ? 'dashboard-layout' : ''}`}>
      <aside id="workspace-navigation" className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`} aria-label="Dairy workspace navigation">
        <div className="sidebar-brand">
          <Logo name={user.dairy.displayName} />
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <div className="side-label"><span>DAIRY WORKSPACE</span><strong>डेअरी संचालन</strong></div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map(({ path, label, english, emoji }) => (
            <button key={path} className={`nav-item ${location.pathname === path ? 'nav-active' : ''}`} onClick={() => navigateTo(path)}>
              <span className="nav-emoji" aria-hidden="true">{emoji}</span><span>{label}<small>{english}</small></span>
              {location.pathname === path && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-help"><div className="help-icon"><CircleHelp size={17} /></div><div><strong>डेअरी व्यवस्थापन</strong><span>संकलन, उत्पादक आणि हिशोब</span></div><ChevronRight size={15} /></div>
        <div className="sidebar-user">
          <UserAvatar user={user} />
          <div className="user-copy"><strong>{user.fullName}</strong><span>{user.role === 'OWNER' ? 'Dairy owner' : 'Dairy staff'}</span></div>
          <button className="icon-button sidebar-logout" aria-label="Sign out" title="Sign out" onClick={onLogout}><LogOut size={17} /></button>
        </div>
      </aside>
      {menuOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open dairy workspace menu" aria-controls="workspace-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{page.english}</strong></div>
          <div className="topbar-right">
            <div className="date-chip"><CalendarDays size={16} /><input aria-label="Dashboard date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
            <div className="topbar-separator" />
            <div className="topbar-user"><span>{isDashboard ? user.fullName : user.dairy.displayName}</span><UserAvatar user={user} compact /></div>
          </div>
        </header>
        <section className="page-content">
          {isDashboard || isProducers ? null : <div className="page-heading">
            <div><p className="section-kicker">{page.path === '/dashboard' ? 'DAIRY OVERVIEW' : page.english.toUpperCase()}</p><h1>{page.path !== '/dashboard' && <span className="title-emoji" aria-hidden="true">{page.emoji}</span>}{title}</h1>
              <p className="muted">{page.path === '/producers' ? 'Keep your producer records organized and up to date.' : page.path === '/milk' ? 'Record and review every milk collection.' : page.path === '/rates' ? 'Set your own rate slabs. No rates are pre-filled.' : page.path === '/feed' ? 'Manage feed inventory and producer issues.' : page.path === '/advances' ? 'Track cash advances, payments and producer balances.' : page.path === '/reports' ? 'Create producer bills and review collection reports.' : 'Manage your dairy profile and display identity.'}</p>
            </div>
            <div className="page-date-label"><CalendarDays size={15} /> {new Date(date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
          </div>}
          {!isDashboard && !isProducers && <PageFeatureBanner page={page} />}
          <PageContent path={location.pathname} user={user} date={date} onProfile={onProfile} />
        </section>
      </main>
    </div>
  )
}

function PageFeatureBanner({ page }) {
  const Icon = page.icon
  const bannerLabel = page.path === '/dashboard' ? 'DAIRY AT A GLANCE' : `${page.english.toUpperCase()} WORKSPACE`
  return (
    <section className={`page-feature-banner banner-${page.theme}`}>
      <div className="page-feature-copy">
        <span className="page-feature-label"><span />{bannerLabel}</span>
        <h2>{page.banner}</h2>
        <p>{page.caption}</p>
        <div className="page-feature-badges">
          <span><Check size={13} /> Simple to use</span>
          <span><ShieldCheck size={13} /> Your dairy, your data</span>
        </div>
      </div>
      <div className="page-feature-art" aria-hidden="true">
        <span className="page-art-orbit page-art-orbit-one" />
        <span className="page-art-orbit page-art-orbit-two" />
        <span className="page-art-spark page-art-spark-one">✦</span>
        <span className="page-art-spark page-art-spark-two">✦</span>
        <span className="page-art-icon"><Icon size={48} strokeWidth={1.5} /></span>
        <span className="page-art-caption">{page.english}</span>
      </div>
    </section>
  )
}

function Dashboard({ user, date }) {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loadedDate, setLoadedDate] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    api(`/private/dashboard?date=${date}`).then((value) => {
      if (active) {
        setData(value)
        setLoadedDate(date)
      }
    })
      .catch((cause) => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [date, reload])
  const loading = loadedDate !== date
  const totals = data?.totals || {}
  const activeSession = data?.sessions?.find((session) => session.status === 'OPEN')
    || data?.sessions?.find((session) => session.status === 'NOT_STARTED')
  const pendingCount = activeSession?.pending_count ?? 0

  async function updateSession(session, action) {
    if (action === 'close' && !window.confirm('Close this collection session? Reopen it to make any later corrections.')) return
    setError('')
    try {
      if (action === 'resume') {
        window.location.assign(`/milk?date=${date}&session=${session.session_type}`)
        return
      }
      if (action === 'start') {
        await api('/private/sessions', {
          method: 'POST',
          body: JSON.stringify({ sessionDate: date, sessionType: session.session_type }),
        })
      } else {
        await api(`/private/sessions/${session.session_id}/${action}`, { method: 'POST' })
      }
      if (action !== 'close') {
        window.location.assign(`/milk?date=${date}&session=${session.session_type}`)
        return
      }
      setReload((value) => value + 1)
    } catch (cause) {
      setError(cause.message)
    }
  }

  return (
    <>
      {error && <Notice message={error} />}
      <section className="dairy-dashboard-header">
        <div className="dairy-dashboard-title">
          <p className="dairy-dashboard-kicker"><span /> DAIRY OVERVIEW</p>
          <h1><span className="dairy-name-emoji" aria-hidden="true">🐄</span>{user.dairy.displayName}</h1>
          <p className="dairy-dashboard-address">{[user.dairy.address, user.dairy.village].filter(Boolean).join(', ') || 'Your dairy workspace'}</p>
        </div>
      </section>
      <section className="daily-collection-summary">
        <div className="daily-collection-total">
          <span className="daily-collection-icon"><Milk size={27} /></span>
          <div>
            <span>आजचे एकूण संकलन</span>
            <strong>{loading ? '—' : number(totals.quantity, 3)} <small>L</small></strong>
            <p><span>🐄 {loading ? '—' : number(totals.cow_quantity, 3)} L</span><i /><span>🐃 {loading ? '—' : number(totals.buffalo_quantity, 3)} L</span></p>
          </div>
        </div>
        <div className="daily-collection-action">
          <button onClick={() => navigate(`/milk?date=${date}`)}><span>सुरू करा</span><ChevronRight size={20} /></button>
          <span>बाकी शेतकरी</span>
          <strong>{loading ? '—' : number(pendingCount, 0)}</strong>
        </div>
      </section>
      <div className="dashboard-section-heading">
        <div><span>DAIRY OPERATIONS</span><h2>डेअरीची कामे</h2></div>
        <span className="snapshot-date">दैनंदिन व्यवहारांसाठी</span>
      </div>
      <div className="workspace-feature-grid">
        {workspaceFeatures.map(({ path, icon: Icon, emoji, title, marathi, text, theme }) => (
          <button key={path} className={`workspace-feature-card feature-${theme}`} onClick={() => navigate(path)}>
            <span className="workspace-feature-art" aria-hidden="true">
              <span className="feature-emoji">{emoji}</span>
              <span className="feature-icon-wrap"><Icon size={20} strokeWidth={2} /></span>
            </span>
            <span className="workspace-feature-copy">
              <strong>{marathi}</strong>
              <small>{title}</small>
              <em>{text}</em>
            </span>
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel collection-panel">
          <div className="panel-heading"><div><p className="section-kicker">TODAY’S COLLECTION</p><h2>Milk at a glance</h2></div><button className="text-button" onClick={() => window.location.assign('/milk')}>View collection <ChevronRight size={15} /></button></div>
          <div className="today-milk-chart" aria-label="Today's cow and buffalo milk collection chart">
            <div className="today-chart-heading"><span>Today's collection by milk type</span><strong>{number(totals.quantity, 3)} <small>L total</small></strong></div>
            <div className="today-chart-columns">
              {[
                { label: 'Cow milk', emoji: '🐄', quantity: Number(totals.cow_quantity || 0), entries: totals.cow_count, tone: 'cow' },
                { label: 'Buffalo milk', emoji: '🐃', quantity: Number(totals.buffalo_quantity || 0), entries: totals.buffalo_count, tone: 'buffalo' },
              ].map((item) => {
                const maxQuantity = Math.max(Number(totals.cow_quantity), Number(totals.buffalo_quantity), 1)
                return <div className={`today-chart-column chart-${item.tone}`} key={item.tone}>
                  <strong>{number(item.quantity, 3)} <small>L</small></strong>
                  <div className="today-chart-track"><i style={{ height: `${item.quantity ? Math.max(8, item.quantity / maxQuantity * 100) : 0}%` }} /></div>
                  <span>{item.emoji} {item.label}</span>
                  <small>{number(item.entries, 0)} entries</small>
                </div>
              })}
            </div>
          </div>
          <div className="trend-chart">
            <div className="trend-heading"><span>Milk collected · last 7 days</span><small>LITRES</small></div>
            {(data?.trend || []).some((item) => Number(item.quantity) > 0) ? <div className="trend-bars">{data.trend.map((item) => {
              const maxQuantity = Math.max(...(data?.trend || []).map((row) => Number(row.quantity)), 1)
              return <div className="trend-day" key={item.date}><div className="trend-bar-track"><i style={{ height: `${Math.max(4, Number(item.quantity) / maxQuantity * 100)}%` }} title={`${number(item.quantity, 3)} L`} /></div><span>{new Date(item.date).toLocaleDateString('en-IN', { weekday: 'short' })}</span></div>
            })}</div> : <div className="chart-empty">Milk collection will appear here once a session is recorded.</div>}
          </div>
        </section>
        <section className="panel session-panel">
          <div className="panel-heading"><div><p className="section-kicker">दैनिक संकलन</p><h2>Collection sessions</h2></div><span className="quick-badge">{date}</span></div>
          <div className="session-card-list">{(data?.sessions || []).map((session) => <article className="session-card" key={session.session_type}>
            <div className="session-card-heading">
              <div><strong>{session.session_type === 'MORNING' ? 'सकाळ · Morning' : 'संध्याकाळ · Evening'}</strong><span className={`session-status session-${session.status.toLowerCase()}`}>{session.status.replace('_', ' ')}</span></div>
              <div className="session-card-actions">
                {session.status === 'NOT_STARTED' && <button className="button button-primary" onClick={() => updateSession(session, 'start')}>Start session</button>}
                {session.status === 'OPEN' && <>
                  <button className="button button-primary" onClick={() => updateSession(session, 'resume')}>Resume</button>
                  <button className="button button-quiet" onClick={() => updateSession(session, 'close')}>Close</button>
                </>}
                {session.status === 'CLOSED' && <button className="button button-secondary" onClick={() => updateSession(session, 'reopen')}>Reopen for correction</button>}
              </div>
            </div>
            <div className="session-metrics">
              <span><strong>{number(session.supplied_count, 0)}</strong> / {number(session.producer_count, 0)} supplied</span>
              <span><strong>{number(session.pending_count, 0)}</strong> pending</span>
              <span><strong>{number(session.quantity, 3)} L</strong> collected</span>
              <span><strong>₹{number(session.amount)}</strong> value</span>
            </div>
            <div className="session-progress"><i style={{ width: `${session.producer_count ? session.supplied_count / session.producer_count * 100 : 0}%` }} /></div>
            {session.pending_producers.length > 0 && <details className="pending-list">
              <summary>View {session.pending_producers.length} pending producers</summary>
              {session.pending_producers.map((producer) => <span key={producer.id}>{producer.producerCode} · {producer.name}</span>)}
            </details>}
            {session.status === 'NOT_STARTED' && <p className="form-note">Start this session to record collections. Missing entries remain pending; no zero quantity is added automatically.</p>}
          </article>)}</div>
        </section>
      </div>
      <section className="panel recent-panel">
        <div className="panel-heading"><div><p className="section-kicker">LATEST ACTIVITY</p><h2>Recent milk entries</h2></div><button className="text-button" onClick={() => window.location.assign('/milk')}>See all <ChevronRight size={15} /></button></div>
        <RecentEntries rows={data?.recent || []} loading={loading} />
      </section>
      <p className="dashboard-footnote"><ShieldCheck size={15} /> Your records are private to {user.dairy.displayName}.</p>
    </>
  )
}

function RecentEntries({ rows, loading }) {
  if (loading) return <div className="empty-row">Loading your latest entries…</div>
  if (!rows.length) return <EmptyState title="No milk entries yet" text="Add a rate chart and record your first collection." />
  return <div className="table-scroll"><table><thead><tr><th>PRODUCER</th><th>MILK TYPE</th><th>QUANTITY</th><th>RATE / L</th><th>AMOUNT</th><th>SESSION</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><div className="producer-cell"><span className="producer-avatar">{row.producer_name?.slice(0, 1)}</span><span><strong>{row.producer_name}</strong><small>#{row.producer_code}</small></span></div></td><td><span className={`milk-badge ${row.milk_type === 'COW' ? 'badge-cow' : 'badge-buffalo'}`}>{row.milk_type === 'COW' ? 'Cow' : 'Buffalo'}</span></td><td>{number(row.quantity_litres, 3)} L</td><td>₹{number(row.rate_per_litre, 2)}</td><td><strong>₹{number(row.amount)}</strong></td><td>{row.session_type ? `${row.session_type} · ${row.session_date}` : new Date(row.collected_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td></tr>)}</tbody></table></div>
}

const producerFields = [
  { name: 'name', label: 'उत्पादकाचे पूर्ण नाव · Producer name', placeholder: 'पूर्ण नाव लिहा', required: true },
  { name: 'mobile', label: 'मोबाईल नंबर · Mobile number', placeholder: '+91 98765 43210' },
  { name: 'village', label: 'गाव · Village', placeholder: 'गाव / शहर', required: true },
  { name: 'address', label: 'पत्ता · Address', placeholder: 'पत्ता (ऐच्छिक)' },
  { name: 'notes', label: 'नोंदी · Notes', placeholder: 'अतिरिक्त माहिती', wide: true },
]
const feedFields = [
  { name: 'itemCode', label: 'Item code', placeholder: 'e.g. F-001', required: true },
  { name: 'name', label: 'Feed name', placeholder: 'Feed item name', required: true },
  { name: 'rate', label: 'Rate', type: 'number', step: '0.01', min: '0', required: true },
  { name: 'unit', label: 'Unit', placeholder: 'kg, bag, litre', required: true },
  { name: 'description', label: 'Description', placeholder: 'Description', wide: true },
]

function CrudPage({ title, endpoint, fields, columns, itemKey, emptyTitle, emptyText, renderActions, deletePrompt, renderFormExtras, onBeforeSave, onSaved, renderDetails, inlineForm = false, filters = [] }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState(filters[0]?.value || '')
  const [formItem, setFormItem] = useState(() => inlineForm ? {} : null)
  const [formKey, setFormKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(() => {
    const params = new URLSearchParams({ search: query, page: String(page), limit: '20' })
    if (filter) params.set('status', filter)
    return api(`${endpoint}?${params}`).then((data) => { setItems(data.items); setTotal(data.total) })
  }, [endpoint, filter, page, query])
  useEffect(() => { refresh().catch((cause) => setError(cause.message)) }, [refresh])

  async function save(event) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const data = Object.fromEntries(formData.entries())
    delete data.photo
    delete data.removePhoto
    setBusy(true)
    setError('')
    try {
      if (onBeforeSave) onBeforeSave(formData)
      const saved = await api(formItem?.id ? `${endpoint}/${formItem.id}` : endpoint, {
        method: formItem?.id ? 'PUT' : 'POST',
        body: JSON.stringify(data),
      })
      setFormItem(saved.item)
      if (onSaved) await onSaved(saved.item, formData)
      if (inlineForm) {
        form.reset()
        setFormItem({})
        setFormKey((value) => value + 1)
      } else {
        setFormItem(null)
      }
      await refresh()
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(item) {
    if (!window.confirm(deletePrompt?.(item) || `Delete ${item.name || item.item_code || item.producer_code}? This cannot be undone.`)) return
    try {
      await api(`${endpoint}/${item.id}`, { method: 'DELETE' })
      await refresh()
      if (inlineForm && formItem?.id === item.id) {
        setFormItem({})
        setFormKey((value) => value + 1)
      }
    } catch (cause) {
      setError(cause.message)
    }
  }

  return (
    <>
      {error && <Notice message={error} />}
      {inlineForm && <section className="panel producer-editor-panel">
        <div className="producer-editor-heading">
          <img className="producer-editor-mascot" src={producerFarmer} alt="" aria-hidden="true" />
          <div><p className="section-kicker">उत्पादक माहिती</p><h2>{formItem?.id ? 'उत्पादकाची माहिती अपडेट करा' : 'नवीन उत्पादक जोडा'}</h2><p>नोंदणीसाठी माहिती भरा · Producer details</p></div>
        </div>
        <form key={`${formItem?.id || 'new'}-${formKey}`} className="form-stack producer-inline-form" onSubmit={save}>
          <div className="producer-inline-photo">{renderFormExtras?.(formItem || {})}</div>
          <div className="field-grid">{fields.map((field) => <label className={field.wide ? 'field-wide' : ''} key={field.name}>{field.label}{field.type === 'select' ? <select name={field.name} required={field.required} defaultValue={formItem?.[field.name] ?? ''}><option value="" disabled>Select…</option>{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <input name={field.name} type={field.type || 'text'} step={field.step} min={field.min} required={field.required} defaultValue={formItem?.[field.name] ?? ''} placeholder={field.placeholder} />}</label>)}</div>
          {error && <Notice message={error} />}
          <div className="producer-editor-actions">
            <button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : formItem?.id ? 'माहिती अपडेट करा ↩️' : 'माहिती जतन करा ✅'} <Check size={16} /></button>
            {formItem?.id && <button type="button" className="button button-danger" onClick={() => remove(formItem)}>उत्पादक डिलीट करा 🗑️</button>}
          </div>
        </form>
      </section>}
      <section className="panel data-panel">
        <div className="data-toolbar">
          <div className="data-toolbar-search">
            <div className="search-box"><Search size={16} /><input aria-label={`Search ${title}`} placeholder={`Search ${title.toLowerCase()}…`} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setPage(1); setQuery(search) } }} /><button onClick={() => { setPage(1); setQuery(search) }} aria-label="Search"><ChevronRight size={16} /></button></div>
            {filters.length > 0 && <div className="rate-type-filters producer-status-filters" role="group" aria-label="Filter producer list">{filters.map((option) => <button type="button" className={filter === option.value ? 'rate-filter-active' : ''} key={option.value || 'all'} onClick={() => { setPage(1); setFilter(option.value) }}>{option.label}</button>)}</div>}
          </div>
          {!inlineForm && <button className="button button-primary" onClick={() => setFormItem({})}><Plus size={16} /> Add {itemKey}</button>}
        </div>
        {!items.length ? <EmptyState title={query || filter ? 'No matching records' : emptyTitle} text={query || filter ? 'Try another search or filter.' : emptyText} action={!query && !filter ? () => setFormItem({}) : undefined} /> : (
          <div className="table-scroll"><table><thead><tr>{columns.map((col) => <th key={col.key}>{col.label}</th>)}<th className="action-head">ACTIONS</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>{columns.map((col) => <td key={col.key}>{col.render ? col.render(item) : item[col.key] || '—'}</td>)}<td className="row-actions">{renderDetails && <button className="small-action" onClick={() => renderDetails(item)}>View</button>}{renderActions?.(item, { refresh, setError })}<button className="small-action" onClick={() => setFormItem(item)}>Edit</button><button className="small-action danger" onClick={() => remove(item)}>Delete</button></td></tr>)}</tbody></table></div>
        )}
        {total > 20 && <Pagination page={page} total={total} pageSize={20} onChange={setPage} />}
      </section>
      {!inlineForm && formItem !== null && <Modal title={`${formItem.id ? 'Edit' : 'Add'} ${itemKey}`} onClose={() => setFormItem(null)}><form className="form-stack modal-form" onSubmit={save}><div className="field-grid">{fields.map((field) => <label className={field.wide ? 'field-wide' : ''} key={field.name}>{field.label}{field.type === 'select' ? <select name={field.name} required={field.required} defaultValue={formItem[field.name] ?? ''}><option value="" disabled>Select…</option>{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <input name={field.name} type={field.type || 'text'} step={field.step} min={field.min} required={field.required} defaultValue={formItem[field.name] ?? ''} placeholder={field.placeholder} />}</label>)}</div>{renderFormExtras?.(formItem)}{error && <Notice message={error} />}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setFormItem(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'} <Check size={16} /></button></div></form></Modal>}
    </>
  )
}

function PhotoField({ item }) {
  const [preview, setPreview] = useState('')
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview) }
  }, [preview])
  const photoUrl = preview || item.photo_url
  return <section className="producer-photo-editor">
    <div className="producer-photo-frame">
      {photoUrl ? <img src={photoUrl} alt="Producer photo preview" /> : <div className="producer-photo-placeholder"><ImagePlus size={27} /><span>📷 Add a producer photo</span></div>}
    </div>
    <div className="producer-photo-controls">
      <label className="photo-upload-button"><ImagePlus size={15} /> Choose photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => {
        const chosen = event.target.files?.[0]
        if (preview) URL.revokeObjectURL(preview)
        setPreview(chosen ? URL.createObjectURL(chosen) : '')
      }} /></label>
      <span className="form-note">JPG, PNG or WebP · maximum 2 MB. Preview before saving.</span>
      {item.photo_url && <label className="photo-remove-option"><input name="removePhoto" type="checkbox" /> Remove current photo</label>}
    </div>
  </section>
}

function ProducersPage() {
  const [selectedProducer, setSelectedProducer] = useState(null)
  return <>
  <CrudPage title="producers" endpoint="/private/producers" fields={producerFields} itemKey="producer" emptyTitle="No producers yet" emptyText="Add your first producer to get started." inlineForm filters={[{ value: '', label: 'सर्व · All' }, { value: 'active', label: 'सक्रिय · Active' }, { value: 'inactive', label: 'निष्क्रिय · Inactive' }]} deletePrompt={(item) => `Delete ${item.name}? Producers with milk history cannot be deleted; deactivate them instead.`} renderActions={(item, { refresh, setError }) => <button className="small-action" onClick={async () => {
    try {
      await api(`/private/producers/${item.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !item.is_active }),
      })
      await refresh()
    } catch (cause) {
      setError(cause.message)
    }
  }}>{item.is_active ? 'Deactivate' : 'Activate'}</button>} renderFormExtras={(item) => <><PhotoField key={item.id || 'new-producer'} item={item} /><div className="generated-code-card"><span>🪪 उत्पादक कोड · Auto</span><strong>{item.producer_code || 'नवीन उत्पादक कोड सेव्ह केल्यावर तयार होईल'}</strong></div></>} onBeforeSave={(formData) => {
    const photo = formData.get('photo')
    if (photo instanceof File && photo.size > 0) {
      if (photo.size > 2 * 1024 * 1024) throw new Error('Photo must be smaller than 2 MB.')
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.')
    }
  }} onSaved={async (item, formData) => {
    const photo = formData.get('photo')
    if (photo instanceof File && photo.size > 0) {
      const upload = new FormData()
      upload.set('photo', photo)
      await api(`/private/producers/${item.id}/photo`, { method: 'POST', body: upload })
    } else if (formData.get('removePhoto') === 'on') {
      await api(`/private/producers/${item.id}/photo`, { method: 'DELETE' })
    }
  }} renderDetails={setSelectedProducer} columns={[
    { key: 'producer_code', label: 'CODE', render: (item) => <strong className="code-cell">{item.producer_code}</strong> },
    { key: 'name', label: 'PRODUCER', render: (item) => <div className="producer-cell">{item.photo_url ? <img className="producer-avatar producer-avatar-photo" src={item.photo_url} alt="" /> : <span className="producer-avatar">{item.name.slice(0, 1)}</span>}<strong>{item.name}</strong></div> },
    { key: 'mobile', label: 'MOBILE' }, { key: 'village', label: 'VILLAGE' },
    { key: 'is_active', label: 'STATUS', render: (item) => item.is_active ? 'Active' : 'Inactive' },
  ]} />
  {selectedProducer && <Modal title="Producer details · उत्पादक माहिती" onClose={() => setSelectedProducer(null)}><div className="producer-detail-card">
    {selectedProducer.photo_url ? <img className="producer-detail-photo" src={selectedProducer.photo_url} alt={`${selectedProducer.name} producer`} /> : <div className="producer-detail-photo producer-detail-placeholder">🐄</div>}
    <div><p className="section-kicker">PRODUCER CODE</p><strong className="producer-detail-code">{selectedProducer.producer_code}</strong><h3>{selectedProducer.name}</h3><span className={`producer-status-chip ${selectedProducer.is_active ? 'is-active' : ''}`}>{selectedProducer.is_active ? '● Active producer' : '○ Inactive producer'}</span></div>
  </div><dl className="producer-detail-list"><div><dt>📱 Mobile</dt><dd>{selectedProducer.mobile || 'Not provided'}</dd></div><div><dt>📍 Village</dt><dd>{selectedProducer.village}</dd></div><div><dt>🏠 Address</dt><dd>{selectedProducer.address || 'Not provided'}</dd></div><div><dt>📝 Notes</dt><dd>{selectedProducer.notes || 'No notes'}</dd></div></dl></Modal>}
  </>
}

function FeedPage() {
  const [producers, setProducers] = useState([])
  const [feeds, setFeeds] = useState([])
  const [issues, setIssues] = useState([])
  const [issueTotal, setIssueTotal] = useState('0')
  const [from, setFrom] = useState(() => localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [to, setTo] = useState(() => localDate())
  const [issueOpen, setIssueOpen] = useState(false)
  const [issueBusy, setIssueBusy] = useState(false)
  const [issueError, setIssueError] = useState('')
  const [feedSelection, setFeedSelection] = useState('')
  const [quantity, setQuantity] = useState('')
  const [issueRate, setIssueRate] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    const params = new URLSearchParams({ from, to })
    Promise.all([
      api('/private/feed-items?limit=100'),
      api('/private/producers?limit=100'),
      api(`/private/feed-issues?${params}`),
    ]).then(([feedResult, producerResult, issueResult]) => {
      if (!active) return
      setFeeds(feedResult.items)
      setProducers(producerResult.items.filter((item) => item.is_active))
      setIssues(issueResult.items)
      setIssueTotal(issueResult.totalAmount)
    }).catch((cause) => { if (active) setIssueError(cause.message) })
    return () => { active = false }
  }, [from, to, reload])
  const selectedFeed = feeds.find((item) => item.id === feedSelection)
  async function saveIssue(event) {
    event.preventDefault()
    setIssueBusy(true)
    setIssueError('')
    const data = Object.fromEntries(new FormData(event.currentTarget).entries())
    try {
      await api('/private/feed-issues', {
        method: 'POST',
        body: JSON.stringify({ ...data, quantity: Number(data.quantity), ratePerUnit: Number(data.ratePerUnit) }),
      })
      setIssueOpen(false)
      setFeedSelection('')
      setQuantity('')
      setIssueRate('')
      setReload((value) => value + 1)
    } catch (cause) {
      setIssueError(cause.message)
    } finally {
      setIssueBusy(false)
    }
  }
  return <>
  {issueError && <Notice message={issueError} />}
  <section className="ledger-hero feed-ledger-hero"><div className="ledger-hero-icon">🌾</div><div><p className="section-kicker">FEED & PRODUCER DEDUCTIONS</p><h2>Feed issue ledger</h2><p>Record feed given to producers. Each issue keeps its own rate and value for accurate settlement.</p></div><div className="ledger-hero-total"><span>ISSUED IN SELECTED PERIOD</span><strong>₹{number(issueTotal)}</strong></div></section>
  <div className="ledger-panel-heading"><div><p className="section-kicker">INVENTORY</p><h2>Feed items & rates</h2></div><span>Update feed inventory below; issue-time rates stay saved in the ledger.</span></div>
  <CrudPage title="feed items" endpoint="/private/feed-items" fields={feedFields} itemKey="feed item" emptyTitle="No feed items yet" emptyText="Add the feed products used at your dairy." columns={[
    { key: 'item_code', label: 'ITEM CODE', render: (item) => <strong className="code-cell">{item.item_code}</strong> },
    { key: 'name', label: 'FEED ITEM' }, { key: 'rate', label: 'RATE', render: (item) => `₹${number(item.rate)}` },
    { key: 'unit', label: 'UNIT' }, { key: 'description', label: 'DESCRIPTION' },
  ]} />
  <section className="panel data-panel feed-issue-panel">
    <div className="ledger-panel-heading"><div><p className="section-kicker">PRODUCER ISSUE HISTORY</p><h2>Feed issues · खाद्य नोंद</h2></div><div className="ledger-toolbar"><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="button button-primary" onClick={() => { setIssueError(''); setIssueOpen(true) }} disabled={!feeds.length || !producers.length}><Plus size={16} /> Issue feed</button></div></div>
    {!issues.length ? <EmptyState title="No feed issues in this period" text="Add a feed item and an active producer, then record an issue here." /> : <div className="table-scroll"><table><thead><tr><th>DATE</th><th>PRODUCER</th><th>FEED ITEM</th><th>QUANTITY</th><th>RATE / UNIT</th><th>DEDUCTION</th><th>REMARKS</th></tr></thead><tbody>{issues.map((item) => <tr key={item.id}><td>{item.issue_date}</td><td><strong>{item.producer_name}</strong><small className="table-sub">#{item.producer_code}</small></td><td>{item.feed_name}</td><td>{number(item.quantity, 3)} {item.unit}</td><td>₹{number(item.rate_per_unit)}</td><td><strong>₹{number(item.amount)}</strong></td><td>{item.remarks || '—'}</td></tr>)}</tbody></table></div>}
  </section>
  {issueOpen && <Modal title="Issue feed to producer · खाद्य द्या" onClose={() => setIssueOpen(false)}><form className="form-stack modal-form" onSubmit={saveIssue}><div className="field-grid">
    <label>Producer<select name="producerId" required defaultValue=""><option value="" disabled>Select producer</option>{producers.map((producer) => <option key={producer.id} value={producer.id}>{producer.producer_code} · {producer.name}</option>)}</select></label>
    <label>Feed item<select name="feedItemId" required value={feedSelection} onChange={(event) => { setFeedSelection(event.target.value); setIssueRate(feeds.find((item) => item.id === event.target.value)?.rate || '') }}><option value="" disabled>Select feed item</option>{feeds.map((feed) => <option key={feed.id} value={feed.id}>{feed.name} · ₹{number(feed.rate)}/{feed.unit}</option>)}</select></label>
    <label>Issue date<input type="date" name="issueDate" required defaultValue={localDate()} /></label>
    <label>Quantity ({selectedFeed?.unit || 'unit'})<input name="quantity" type="number" step="0.001" min="0.001" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
    <label>Rate per {selectedFeed?.unit || 'unit'} (₹)<input name="ratePerUnit" type="number" step="0.01" min="0" required value={issueRate} onChange={(event) => setIssueRate(event.target.value)} /></label>
    <label className="field-wide">Remarks<input name="remarks" placeholder="Optional notes" /></label>
  </div><div className="statement-inline-total"><span>Estimated producer deduction</span><strong>₹{number((Number(quantity) || 0) * (Number(issueRate) || 0))}</strong></div>{issueError && <Notice message={issueError} />}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setIssueOpen(false)}>Cancel</button><button className="button button-primary" disabled={issueBusy || !feeds.length || !producers.length}>{issueBusy ? 'Saving issue…' : 'Save feed issue'} <Check size={16} /></button></div></form></Modal>}
  </>
}

function AdvancesPage() {
  const [producers, setProducers] = useState([])
  const [balances, setBalances] = useState([])
  const [advances, setAdvances] = useState([])
  const [payments, setPayments] = useState([])
  const [from, setFrom] = useState(() => localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [to, setTo] = useState(() => localDate())
  const [filter, setFilter] = useState('all')
  const [formType, setFormType] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    const params = new URLSearchParams({ from, to })
    Promise.all([
      api('/private/producers?limit=100'),
      api('/private/producer-balances'),
      api(`/private/advances?${params}`),
      api(`/private/payments?${params}`),
    ]).then(([producerData, balanceData, advanceData, paymentData]) => {
      if (!active) return
      setProducers(producerData.items.filter((item) => item.is_active))
      setBalances(balanceData.items)
      setAdvances(advanceData.items)
      setPayments(paymentData.items)
    }).catch((cause) => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [from, to, reload])
  async function saveTransaction(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    const endpoint = formType === 'advance' ? '/private/advances' : '/private/payments'
    const dateField = formType === 'advance' ? 'advanceDate' : 'paymentDate'
    try {
      await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ producerId: values.producerId, [dateField]: values.date, amount: Number(values.amount), remarks: values.remarks }),
      })
      setFormType('')
      setReload((value) => value + 1)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  async function voidAdvance(item) {
    if (!window.confirm(`Void the ₹${number(item.amount)} advance for ${item.producer_name}? It will remain in the audit history.`)) return
    try {
      await api(`/private/advances/${item.id}/void`, { method: 'POST' })
      setReload((value) => value + 1)
    } catch (cause) { setError(cause.message) }
  }
  const rows = [
    ...(filter !== 'payments' ? advances.map((item) => ({ ...item, kind: 'advance' })) : []),
    ...(filter !== 'advances' ? payments.map((item) => ({ ...item, kind: 'payment', advance_date: item.payment_date })) : []),
  ].sort((a, b) => String(b.advance_date || b.payment_date).localeCompare(String(a.advance_date || a.payment_date)))
  return <>
    {error && <Notice message={error} />}
    <section className="ledger-hero advance-ledger-hero"><div className="ledger-hero-icon">💰</div><div><p className="section-kicker">PRODUCER ACCOUNTING</p><h2>उचल व पेमेंट · Advances & payments</h2><p>Record cash advances and settlements. Payments are limited by the actual outstanding producer balance.</p></div><div className="ledger-hero-actions"><button className="button button-secondary" onClick={() => { setError(''); setFormType('advance') }} disabled={!producers.length}><Plus size={15} /> Record advance</button><button className="button button-primary" onClick={() => { setError(''); setFormType('payment') }} disabled={!producers.length}><IndianRupee size={15} /> Record payment</button></div></section>
    <section className="panel data-panel balances-panel"><div className="ledger-panel-heading"><div><p className="section-kicker">LIVE ACCOUNT POSITION</p><h2>Producer outstanding balances</h2></div><span>Milk value less feed issues, active advances and payments</span></div>
      {!balances.length ? <EmptyState title="No active producer balances" text="Add producers and record milk to see their current balance." /> : <div className="balance-card-grid">{balances.map((item) => <article className={`balance-card ${Number(item.balance) < 0 ? 'balance-negative' : ''}`} key={item.id}><div className="balance-avatar">{item.name.slice(0, 1)}</div><div className="balance-producer"><strong>{item.name}</strong><small>#{item.producer_code}</small></div><div className="balance-amount"><small>OUTSTANDING</small><strong>₹{number(item.balance)}</strong></div></article>)}</div>}
    </section>
    <section className="panel data-panel">
      <div className="ledger-panel-heading"><div><p className="section-kicker">CASH MOVEMENT</p><h2>Advance & payment ledger</h2></div><div className="ledger-toolbar"><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></div></div>
      <div className="rate-type-filters ledger-tabs"><button className={filter === 'all' ? 'rate-filter-active' : ''} onClick={() => setFilter('all')}>All transactions</button><button className={filter === 'advances' ? 'rate-filter-active' : ''} onClick={() => setFilter('advances')}>💸 Advances</button><button className={filter === 'payments' ? 'rate-filter-active' : ''} onClick={() => setFilter('payments')}>✅ Payments</button></div>
      {!rows.length ? <EmptyState title="No transactions in this period" text="Record a producer advance or payment to begin the ledger." /> : <div className="table-scroll"><table><thead><tr><th>DATE</th><th>TYPE</th><th>PRODUCER</th><th>AMOUNT</th><th>REMARKS</th><th>STATUS / ACTION</th></tr></thead><tbody>{rows.map((item) => <tr key={`${item.kind}-${item.id}`}><td>{item.advance_date || item.payment_date}</td><td><span className={`ledger-type-pill ${item.kind}`}>{item.kind === 'advance' ? '💸 Advance' : '✅ Payment'}</span></td><td><strong>{item.producer_name}</strong><small className="table-sub">#{item.producer_code}</small></td><td><strong>₹{number(item.amount)}</strong></td><td>{item.remarks || '—'}</td><td>{item.kind === 'advance' ? item.voided_at ? <span className="voided-label">Voided</span> : <button className="small-action danger" onClick={() => voidAdvance(item)}>Void entry</button> : <span className="paid-label">Paid</span>}</td></tr>)}</tbody></table></div>}
    </section>
    {formType && <Modal title={formType === 'advance' ? 'Record producer advance · उचल नोंद' : 'Record producer payment · पेमेंट नोंद'} onClose={() => setFormType('')}><form className="form-stack modal-form" onSubmit={saveTransaction}><div className="field-grid">
      <label className="field-wide">Producer<select name="producerId" required defaultValue=""><option value="" disabled>Select producer</option>{producers.map((producer) => <option value={producer.id} key={producer.id}>{producer.producer_code} · {producer.name}</option>)}</select></label>
      <label>{formType === 'advance' ? 'Advance date' : 'Payment date'}<input type="date" name="date" required defaultValue={localDate()} /></label>
      <label>Amount (₹)<input type="number" name="amount" min="0.01" step="0.01" required placeholder="0.00" /></label>
      <label className="field-wide">Remarks<input name="remarks" placeholder="Optional notes or receipt number" /></label>
    </div>{formType === 'payment' && <div className="form-note">The server verifies the selected producer’s outstanding balance before accepting this payment. Current balances are shown on the page above.</div>}{error && <Notice message={error} />}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setFormType('')}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : formType === 'advance' ? 'Save advance' : 'Save payment'} <Check size={16} /></button></div></form></Modal>}
  </>
}

function buildRatePreviewMatrix(rows) {
  const fatValues = [...new Set(rows.map((row) => Number(row.fatMin)))].sort((a, b) => a - b)
  const snfValues = [...new Set(rows.map((row) => Number(row.snfMin)))].sort((a, b) => a - b)
  if (!fatValues.length || !snfValues.length || fatValues.length * snfValues.length !== rows.length) return null

  const rowIndexes = new Map()
  rows.forEach((row, index) => {
    const key = `${Number(row.fatMin)}:${Number(row.snfMin)}`
    if (rowIndexes.has(key)) rowIndexes.set(key, null)
    else rowIndexes.set(key, index)
  })
  if ([...rowIndexes.values()].some((index) => index === null)) return null

  const fatRows = fatValues.map((fat) => {
    const cells = snfValues.map((snf) => rowIndexes.get(`${fat}:${snf}`))
    return cells.some((index) => index === undefined) ? null : { fat, cells }
  })
  return fatRows.some((row) => row === null) ? null : { fatValues, snfValues, fatRows }
}

function RatesPage() {
  const [chartFile, setChartFile] = useState(null)
  const [previewRows, setPreviewRows] = useState([])
  const [editingPreview, setEditingPreview] = useState(false)
  const [sourceName, setSourceName] = useState('')
  const [chartType, setChartType] = useState('COW')
  const [chartDate, setChartDate] = useState(() => localDate())
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState('')
  const previewMatrix = buildRatePreviewMatrix(previewRows)
  async function previewImport(file = chartFile) {
    if (!file) {
      setImportError('Choose a CSV, Excel, or PDF rate chart first.')
      return
    }
    setChartFile(file)
    setImportBusy(true)
    setImportError('')
    try {
      const formData = new FormData()
      formData.set('file', file)
      const result = await api('/private/rate-rules/import-preview', { method: 'POST', body: formData })
      setPreviewRows(result.rows)
      setEditingPreview(false)
      setSourceName(result.sourceName)
      if (result.suggestedEffectiveFrom) setChartDate(result.suggestedEffectiveFrom)
    } catch (cause) {
      setImportError(cause.message)
      setPreviewRows([])
      setEditingPreview(false)
      setSourceName('')
    } finally {
      setImportBusy(false)
    }
  }
  async function saveImport() {
    setImportBusy(true)
    setImportError('')
    try {
      const result = await api('/private/rate-rules/import', {
        method: 'POST',
        body: JSON.stringify({ milkType: chartType, effectiveFrom: chartDate, rows: previewRows }),
      })
      setPreviewRows([])
      setEditingPreview(false)
      setChartFile(null)
      setSourceName('')
      setImportError(`Imported ${result.items.length} rate rows successfully.`)
    } catch (cause) {
      setImportError(cause.message)
    } finally {
      setImportBusy(false)
    }
  }
  function updateImportRow(index, key, value) {
    setPreviewRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  }
  return <>
    <section className="panel rate-import-panel">
      <h2 className="rate-chart-title"><span className="rate-chart-emoji" aria-hidden="true">📊</span> दर पत्रक अपलोड</h2>
      <div className="rate-chart-meta">
        <label><span>📅 दिनांक</span><input type="date" value={chartDate} onChange={(event) => setChartDate(event.target.value)} /></label>
        <label><span>🥛 प्रकार</span><select value={chartType} onChange={(event) => setChartType(event.target.value)}><option value="COW">गाय</option><option value="BUFFALO">म्हैस</option></select></label>
      </div>
      {importError && <Notice message={importError} success={importError.startsWith('Imported ')} />}
      <label className={`rate-upload-cta ${importBusy ? 'is-busy' : ''}`}>
        <span><span className="rate-upload-emoji" aria-hidden="true">📄</span> {importBusy ? 'अपलोड होत आहे…' : chartFile?.name || 'PDF दरपत्रक अपलोड करा'} <span className="rate-upload-emoji" aria-hidden="true">📤</span></span>
        <input type="file" accept=".pdf,.csv,.xlsx" disabled={importBusy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; setPreviewRows([]); setImportError(''); setSourceName(''); if (file) previewImport(file) }} />
        <Upload size={25} aria-hidden="true" />
      </label>
      {previewRows.length > 0 && <div className="rate-import-preview"><div className="rate-import-preview-heading"><strong>👀 तक्ता पूर्वावलोकन (Preview)</strong><button className="small-action" type="button" onClick={() => setEditingPreview((editing) => !editing)}>{editingPreview ? <Check size={14} /> : <Pencil size={14} />}{editingPreview ? 'Done' : 'Edit rates'}</button></div>{previewMatrix ? <div className="table-scroll rate-matrix-scroll"><table className="rate-matrix-table"><thead><tr><th>FAT \ SNF</th>{previewMatrix.snfValues.map((snf) => <th key={snf}>{snf}</th>)}</tr></thead><tbody>{previewMatrix.fatRows.map(({ fat, cells }) => <tr key={fat}><th scope="row">{fat.toFixed(1)}</th>{cells.map((rowIndex, columnIndex) => <td key={previewMatrix.snfValues[columnIndex]}>{editingPreview ? <input aria-label={`Rate for Fat ${fat}, SNF ${previewMatrix.snfValues[columnIndex]}`} type="number" min="0" step="0.0001" value={previewRows[rowIndex].ratePerLitre} onChange={(event) => updateImportRow(rowIndex, 'ratePerLitre', event.target.value)} /> : Number(previewRows[rowIndex].ratePerLitre).toFixed(2)}</td>)}</tr>)}</tbody></table></div> : <div className="table-scroll"><table><thead><tr><th>FAT MIN</th><th>FAT MAX</th><th>SNF MIN</th><th>SNF MAX</th><th>RATE / L</th><th></th></tr></thead><tbody>{previewRows.map((row, index) => <tr key={`${index}-${sourceName}`}>{[['fatMin', 'Fat min', 0.01], ['fatMax', 'Fat max', 0.01], ['snfMin', 'SNF min', 0.01], ['snfMax', 'SNF max', 0.01], ['ratePerLitre', 'Rate', 0.0001]].map(([key, label, step]) => <td key={key}>{editingPreview ? <input aria-label={`${label} row ${index + 1}`} type="number" step={step} min="0" value={row[key]} onChange={(event) => updateImportRow(index, key, event.target.value)} /> : row[key]}</td>)}<td>{editingPreview && <button className="small-action danger" type="button" onClick={() => setPreviewRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>}</td></tr>)}</tbody></table></div>}<div className="rate-import-actions">{editingPreview && !previewMatrix && <button className="small-action" type="button" onClick={() => setPreviewRows((rows) => [...rows, { fatMin: 0, fatMax: 0.01, snfMin: 0, snfMax: 0.01, ratePerLitre: 0 }])}><Plus size={13} /> Add row</button>}<button className="button button-primary" onClick={saveImport} disabled={importBusy || !previewRows.length}>{importBusy ? 'Importing…' : `Import ${previewRows.length} rows`} <Check size={15} /></button></div></div>}
    </section>
  </>
}

function MilkPage({ date }) {
  const location = useLocation()
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [producers, setProducers] = useState([])
  const [sessions, setSessions] = useState([])
  const [sessionType, setSessionType] = useState(() => new URLSearchParams(location.search).get('session') === 'EVENING' ? 'EVENING' : 'MORNING')
  const [dailyTotals, setDailyTotals] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formItem, setFormItem] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dateTimeValue, setDateTimeValue] = useState('')
  const [quoteInput, setQuoteInput] = useState(null)
  const [quote, setQuote] = useState(null)
  const [quoteError, setQuoteError] = useState('')
  const [quoteBusy, setQuoteBusy] = useState(false)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [milkType, setMilkType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const selectedSession = sessions.find((session) => session.session_type === sessionType)
  const refresh = useCallback(() => {
    const query = new URLSearchParams()
    if (from) query.set('from', from)
    if (to) query.set('to', to)
    if (search) query.set('search', search)
    if (milkType) query.set('milkType', milkType)
    if (sessionType) query.set('sessionType', sessionType)
    query.set('page', String(page))
    query.set('limit', '20')
    return api(`/private/milk-entries?${query}`).then((data) => {
      setEntries(data.items)
      setTotal(data.total)
    })
  }, [from, milkType, page, search, sessionType, to])

  const refreshSessions = useCallback(() => api(`/private/sessions?date=${date}`)
    .then((data) => setSessions(data.sessions)), [date])
  const refreshDailyTotals = useCallback(() => api(`/private/dashboard?date=${date}`)
    .then((data) => setDailyTotals(data.totals)), [date])

  useEffect(() => {
    Promise.all([refresh(), refreshSessions(), api('/private/producers')])
      .then(([, , data]) => setProducers(data.items.filter((producer) => producer.is_active)))
      .catch((cause) => setError(cause.message))
  }, [refresh, refreshSessions])

  useEffect(() => {
    let active = true
    refreshDailyTotals().catch((cause) => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [refreshDailyTotals])

  useEffect(() => {
    if (!formOpen || !quoteInput) return undefined
    const startReading = Number(quoteInput.startReading)
    const endReading = Number(quoteInput.endReading)
    const fat = Number(quoteInput.fat)
    const snf = Number(quoteInput.snf)
    if (!quoteInput.noSupply && (quoteInput.startReading === '' || quoteInput.endReading === '' || endReading <= startReading)) {
      return undefined
    }
    if (!quoteInput.noSupply && (quoteInput.fat === '' || quoteInput.snf === '')) {
      return undefined
    }

    let active = true
    const timer = window.setTimeout(() => {
      setQuoteBusy(true)
      api('/private/milk-quote', {
        method: 'POST',
        body: JSON.stringify({
          sessionDate: quoteInput.sessionDate,
          milkType: quoteInput.milkType,
          startReading,
          endReading,
          fat,
          snf,
          noSupply: quoteInput.noSupply,
        }),
      }).then((result) => {
        if (active) setQuote(result)
      }).catch((cause) => {
        if (active) setQuoteError(cause.message)
      }).finally(() => {
        if (active) setQuoteBusy(false)
      })
    }, 350)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [formOpen, quoteInput])

  async function changeSession(action) {
    if (!selectedSession) return
    if (action === 'close' && !window.confirm('Close this collection session? Reopen it to make any later corrections.')) return
    setError('')
    try {
      if (action === 'start') {
        await api('/private/sessions', {
          method: 'POST',
          body: JSON.stringify({ sessionDate: date, sessionType }),
        })
      } else {
        await api(`/private/sessions/${selectedSession.session_id}/${action}`, { method: 'POST' })
      }
      await refreshSessions()
      if (action !== 'close') await refresh()
    } catch (cause) {
      setError(cause.message)
    }
  }

  async function save(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const data = Object.fromEntries(formData.entries())
    data.noSupply = formData.get('noSupply') === 'on'
    data.collectedAt = new Date(data.collectedAt).toISOString()
    setBusy(true)
    setError('')
    try {
      await api(formItem?.id ? `/private/milk-entries/${formItem.id}` : '/private/milk-entries', {
        method: formItem?.id ? 'PUT' : 'POST', body: JSON.stringify(data),
      })
      setFormOpen(false)
      setFormItem(null)
      await Promise.all([refresh(), refreshSessions(), refreshDailyTotals()])
    } catch (cause) { setError(cause.message) } finally { setBusy(false) }
  }
  function updateQuoteInput(event) {
    const { name, value, type, checked } = event.target
    setQuote(null)
    setQuoteError('')
    setQuoteBusy(false)
    setQuoteInput((previous) => {
      const updatedValue = type === 'checkbox' ? checked : value
      const next = { ...previous, [name]: updatedValue }
      if (name === 'noSupply' && checked) {
        next.startReading = previous.startReading || '0'
        next.endReading = next.startReading
        next.fat = previous.fat || '0'
        next.snf = previous.snf || '0'
      }
      return next
    })
  }
  async function remove(item) {
    if (!window.confirm('Delete this milk collection entry?')) return
    try { await api(`/private/milk-entries/${item.id}`, { method: 'DELETE' }); await Promise.all([refresh(), refreshSessions(), refreshDailyTotals()]) } catch (cause) { setError(cause.message) }
  }
  function openForm(item = null) {
    setFormItem(item)
    const dateTime = item
      ? new Date(new Date(item.collected_at).getTime() - new Date().getTimezoneOffset() * 60000)
      : new Date(`${date}T${sessionType === 'MORNING' ? '08:00' : '17:00'}`)
    setDateTimeValue(dateTime.toISOString().slice(0, 16))
    setQuoteInput({
      sessionDate: item?.session_date || date,
      sessionType: item?.session_type || sessionType,
      milkType: item?.milk_type || 'COW',
      startReading: item?.start_reading ?? '',
      endReading: item?.end_reading ?? '',
      fat: item?.fat ?? '',
      snf: item?.snf ?? '',
      noSupply: Number(item?.quantity_litres) === 0,
    })
    setQuote(null)
    setQuoteError('')
    setQuoteBusy(false)
    setFormOpen(true)
  }
  return <>
    {error && <Notice message={error} />}
    <section className="milk-collection-hero">
      <img src={dairyBackdrop} alt="" />
      <div className="milk-collection-hero-copy">
        <p>DAILY COLLECTION</p>
        <h2><span aria-hidden="true">🥛</span> दूध संकलन</h2>
        <span>{new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </div>
      <span className="milk-collection-hero-mark" aria-hidden="true">🐄</span>
    </section>
    <section className="milk-collection-stats" aria-label="Selected date milk totals">
      <article className="milk-collection-stat milk-stat-volume"><span className="milk-stat-icon"><Milk size={20} /></span><span className="milk-stat-label">एकूण दूध</span><strong>{dailyTotals ? number(dailyTotals.quantity, 3) : '—'} <small>L</small></strong></article>
      <article className="milk-collection-stat milk-stat-amount"><span className="milk-stat-icon"><IndianRupee size={19} /></span><span className="milk-stat-label">एकूण रक्कम</span><strong>₹{dailyTotals ? number(dailyTotals.amount) : '—'}</strong></article>
      <article className="milk-collection-stat milk-stat-entries"><span className="milk-stat-icon"><Users size={19} /></span><span className="milk-stat-label">नोंदी</span><strong>{dailyTotals ? number(Number(dailyTotals.cow_count) + Number(dailyTotals.buffalo_count), 0) : '—'}</strong></article>
    </section>
    <section className="panel session-toolbar">
      <div>
        <p className="section-kicker">COLLECTION SESSION</p>
        <h2>{sessionType === 'MORNING' ? 'सकाळ · Morning' : 'संध्याकाळ · Evening'}</h2>
        <p className="muted">{selectedSession ? `${selectedSession.supplied_count} of ${selectedSession.producer_count} producers supplied · ${selectedSession.pending_count} pending` : 'Loading session status…'}</p>
      </div>
      <div className="session-card-actions">
        <div className="milk-session-switch" role="group" aria-label="Select collection session"><button type="button" className={sessionType === 'MORNING' ? 'milk-session-active' : ''} onClick={() => setSessionType('MORNING')}>🌅 सकाळ</button><button type="button" className={sessionType === 'EVENING' ? 'milk-session-active' : ''} onClick={() => setSessionType('EVENING')}>🌙 संध्याकाळ</button></div>
        {selectedSession?.status === 'NOT_STARTED' && <button className="button button-primary" onClick={() => changeSession('start')}>Start session</button>}
        {selectedSession?.status === 'OPEN' && <>
          <span className="session-status session-open">OPEN</span>
          <button className="button button-quiet" onClick={() => changeSession('close')}>Close session</button>
        </>}
        {selectedSession?.status === 'CLOSED' && <button className="button button-secondary" onClick={() => changeSession('reopen')}>Reopen for correction</button>}
      </div>
    </section>
    <section className="panel data-panel">
      <div className="data-toolbar">
        <div className="milk-filters"><div className="filter-dates"><label>From<input type="date" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value) }} /></label><label>To<input type="date" value={to} onChange={(event) => { setPage(1); setTo(event.target.value) }} /></label></div><label className="type-filter">Milk type<select value={milkType} onChange={(event) => { setPage(1); setMilkType(event.target.value) }}><option value="">All types</option><option value="COW">Cow</option><option value="BUFFALO">Buffalo</option></select></label><div className="search-box milk-search"><Search size={16} /><input aria-label="Search milk entries" placeholder="Search producer…" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
        <button className="button button-primary" onClick={() => openForm()} disabled={selectedSession?.status !== 'OPEN'}><Plus size={16} /> Record milk</button>
      </div>
      {!entries.length ? <EmptyState title="No collection entries found" text={selectedSession?.status === 'OPEN' ? 'Add a rate chart and producer before recording a milk collection.' : 'Start a collection session before recording milk. No entry is created for a producer who has not supplied.'} action={selectedSession?.status === 'OPEN' ? () => openForm() : undefined} /> : <div className="table-scroll"><table><thead><tr><th>DATE / SESSION</th><th>PRODUCER</th><th>TYPE</th><th>READING</th><th>FAT / SNF</th><th>QTY</th><th>RATE</th><th>AMOUNT</th><th>ACTIONS</th></tr></thead><tbody>{entries.map((item) => <tr key={item.id}><td>{item.session_date || new Date(item.collected_at).toLocaleDateString('en-IN')}<small className="table-sub">{item.session_type || 'Legacy entry'}</small></td><td><strong>{item.producer_name}</strong><small className="table-sub">#{item.producer_code}</small></td><td><span className={`milk-badge ${item.milk_type === 'COW' ? 'badge-cow' : 'badge-buffalo'}`}>{item.milk_type}</span>{Number(item.quantity_litres) === 0 && <small className="table-sub">No supply recorded</small>}</td><td>{number(item.start_reading, 3)} → {number(item.end_reading, 3)}</td><td>{item.fat}% / {item.snf}%</td><td>{number(item.quantity_litres, 3)} L</td><td>₹{number(item.rate_per_litre, 4)}</td><td><strong>₹{number(item.amount)}</strong></td><td className="row-actions"><button className="small-action" onClick={() => openForm(item)}>Edit</button><button className="small-action danger" onClick={() => remove(item)}>Delete</button></td></tr>)}</tbody></table></div>}
      {total > 20 && <Pagination page={page} total={total} pageSize={20} onChange={setPage} />}
    </section>
    {formOpen && <Modal title={`${formItem ? 'Edit' : 'Record'} milk collection`} onClose={() => { setFormOpen(false); setFormItem(null) }}><form className="form-stack modal-form" onSubmit={save}><div className="field-grid">
      <label>Producer<select name="producerId" required defaultValue={formItem?.producer_id || ''}><option value="" disabled>Select producer</option>{producers.map((producer) => <option key={producer.id} value={producer.id}>{producer.producer_code} · {producer.name}</option>)}</select></label>
      <input type="hidden" name="sessionDate" value={quoteInput?.sessionDate || date} readOnly />
      <input type="hidden" name="sessionType" value={quoteInput?.sessionType || sessionType} readOnly />
      <div className="session-form-context"><strong>{quoteInput?.sessionDate || date}</strong><span>{(quoteInput?.sessionType || sessionType) === 'MORNING' ? 'सकाळ · Morning' : 'संध्याकाळ · Evening'}</span></div>
      <label>Collection date & time<input name="collectedAt" type="datetime-local" required defaultValue={dateTimeValue} /></label>
      <label>Milk type<select name="milkType" value={quoteInput?.milkType || 'COW'} onChange={updateQuoteInput}><option value="COW">Cow · गाय</option><option value="BUFFALO">Buffalo · म्हैस</option></select></label>
      <label>Start reading<input name="startReading" type="number" step="0.001" min="0" required value={quoteInput?.startReading ?? ''} onChange={updateQuoteInput} /></label>
      <label>End reading<input name="endReading" type="number" step="0.001" min="0" required value={quoteInput?.endReading ?? ''} onChange={updateQuoteInput} /></label>
      <label className="field-wide zero-supply-option"><input name="noSupply" type="checkbox" checked={Boolean(quoteInput?.noSupply)} onChange={updateQuoteInput} /><span>Record explicit zero milk (use the same start and end reading). This is separate from a producer with no entry.</span></label>
      <label>Fat (%)<input name="fat" type="number" step="0.01" min="0" max="20" required value={quoteInput?.fat ?? ''} onChange={updateQuoteInput} /></label>
      <label>SNF (%)<input name="snf" type="number" step="0.01" min="0" max="20" required value={quoteInput?.snf ?? ''} onChange={updateQuoteInput} /></label>
      <label className="field-wide">Notes<input name="notes" defaultValue={formItem?.notes || ''} /></label>
    </div>
    <div className={`milk-quote ${quoteError ? 'milk-quote-error' : ''}`}>
      {quoteBusy ? <span>Checking the matching rate chart…</span> : quoteError ? <span>{quoteError}</span> : quote ? <>
        <div><small>QUANTITY</small><strong>{number(quote.quantity, 3)} L</strong></div>
        <div><small>RATE / LITRE</small><strong>₹{number(quote.rate, 4)}</strong></div>
        <div><small>ESTIMATED AMOUNT</small><strong>₹{number(quote.amount)}</strong></div>
      </> : <span>Enter readings and Fat/SNF to preview the applicable rate and amount.</span>}
    </div>
    {error && <Notice message={error} />}{!producers.length && <Notice message="Add a producer before recording milk." />}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => { setFormOpen(false); setFormItem(null) }}>Cancel</button><button className="button button-primary" disabled={busy || !producers.length || !quote}>{busy ? 'Saving…' : 'Save entry'} <Check size={16} /></button></div></form></Modal>}
  </>
}

function Pagination({ page, total, pageSize, onChange }) {
  const pages = Math.ceil(total / pageSize)
  return <div className="pagination"><span>Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total}</span><div><button className="icon-button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronRight className="chevron-back" size={16} /></button><strong>{page} / {pages}</strong><button className="icon-button" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div></div>
}

function DetailedReportsPage({ dairyName, onBack }) {
  const [producers, setProducers] = useState([])
  const [producerId, setProducerId] = useState('')
  const [statement, setStatement] = useState(null)
  const [statementBusy, setStatementBusy] = useState(false)
  const [statementError, setStatementError] = useState('')
  const [from, setFrom] = useState(() => localDate())
  const [to, setTo] = useState(() => localDate())
  const [period, setPeriod] = useState('daily')
  const [groupBy, setGroupBy] = useState('entries')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    api('/private/producers?limit=100').then((value) => {
      if (!active) return
      setProducers(value.items)
      setProducerId((current) => current || value.items[0]?.id || '')
    }).catch((cause) => { if (active) setStatementError(cause.message) })
    return () => { active = false }
  }, [])
  function changePeriod(value) {
    setPeriod(value)
    if (value === 'custom') return
    const now = new Date()
    let start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let end = new Date(start)
    if (value === 'weekly') {
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
      end = new Date(start)
      end.setDate(start.getDate() + 6)
    } else if (value === 'monthly') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    } else if (value === 'yearly') {
      start = new Date(now.getFullYear(), 0, 1)
      end = new Date(now.getFullYear(), 11, 31)
    }
    setFrom(localDate(start))
    setTo(localDate(end))
  }
  async function load() {
    setBusy(true)
    setError('')
    try {
      const params = new URLSearchParams({ from, to, groupBy })
      setData(await api(`/private/reports/milk?${params}`))
    } catch (cause) { setError(cause.message) } finally { setBusy(false) }
  }
  useEffect(() => {
    let active = true
    const params = new URLSearchParams({ from, to, groupBy })
    api(`/private/reports/milk?${params}`).then((value) => {
      if (active) setData(value)
    }).catch((cause) => {
      if (active) setError(cause.message)
    })
    return () => { active = false }
  }, [from, to, groupBy])
  async function exportCsv() {
    try { await downloadReport(`/private/reports/milk?${new URLSearchParams({ from, to, groupBy, format: 'csv' })}`) } catch (cause) { setError(cause.message) }
  }
  async function loadStatement() {
    if (!producerId) return
    setStatementBusy(true)
    setStatementError('')
    try {
      const params = new URLSearchParams({ producerId, from, to })
      setStatement(await api(`/private/producer-statement?${params}`))
    } catch (cause) {
      setStatementError(cause.message)
    } finally {
      setStatementBusy(false)
    }
  }
  function exportStatement() {
    if (!statement) return
    const rowsByDate = new Map()
    statement.days.forEach((entry) => {
      const row = rowsByDate.get(entry.date) || { date: entry.date, morningQuantity: 0, morningAmount: 0, eveningQuantity: 0, eveningAmount: 0 }
      const session = entry.session_type === 'MORNING' ? 'morning' : 'evening'
      row[`${session}Quantity`] += Number(entry.quantity)
      row[`${session}Amount`] += Number(entry.amount)
      rowsByDate.set(entry.date, row)
    })
    const header = ['Date', 'Morning litres', 'Morning amount', 'Evening litres', 'Evening amount']
    const lines = [header, ...[...rowsByDate.values()].map((row) => [row.date, row.morningQuantity, row.morningAmount, row.eveningQuantity, row.eveningAmount])]
    lines.push([], ['Milk total', statement.totals.quantity, statement.totals.milkAmount], ['Feed deductions', '', statement.totals.feedAmount], ['Advances', '', statement.totals.advanceAmount], ['Payments', '', statement.totals.paymentAmount], ['Balance', '', statement.totals.balance])
    const csv = lines.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `producer-bill-${statement.producer.producer_code}-${from}-${to}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  function printStatement() {
    const reset = () => document.body.classList.remove('print-producer-statement')
    document.body.classList.add('print-producer-statement')
    window.addEventListener('afterprint', reset, { once: true })
    window.print()
    window.setTimeout(reset, 30000)
  }
  const statementDays = new Map()
  statement?.days.forEach((entry) => {
    const row = statementDays.get(entry.date) || { date: entry.date, morningQuantity: 0, morningAmount: 0, eveningQuantity: 0, eveningAmount: 0 }
    const session = entry.session_type === 'MORNING' ? 'morning' : 'evening'
    row[`${session}Quantity`] += Number(entry.quantity)
    row[`${session}Amount`] += Number(entry.amount)
    statementDays.set(entry.date, row)
  })
  const groupLabels = { entries: 'Collection entries', date: 'Daily totals', producer: 'Producer-wise', type: 'Cow / buffalo' }
  return <>
    {onBack && <button className="button button-quiet report-back-button" onClick={onBack}><ChevronRight className="chevron-back" size={15} /> Monthly producer bills</button>}
    {error && <Notice message={error} />}
    <section className="panel producer-statement-panel">
      <div className="producer-statement-heading"><div><p className="section-kicker">PRODUCER WISE SETTLEMENT</p><h2>दूध बिल · Producer bill</h2><p>Morning/evening milk, feed deductions, advances and payments in one printable statement.</p></div><div className="statement-emoji">🧾</div></div>
      <div className="statement-controls"><label>Producer<select value={producerId} onChange={(event) => { setProducerId(event.target.value); setStatement(null) }}><option value="">Select producer</option>{producers.map((producer) => <option value={producer.id} key={producer.id}>{producer.producer_code} · {producer.name}</option>)}</select></label><label>From<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setStatement(null) }} /></label><label>To<input type="date" value={to} onChange={(event) => { setTo(event.target.value); setStatement(null) }} /></label><button className="button button-primary" onClick={loadStatement} disabled={!producerId || statementBusy}>{statementBusy ? 'Preparing bill…' : 'Generate producer bill'} <FileText size={15} /></button></div>
      {statementError && <Notice message={statementError} />}
      {statement && <div className="printable-statement">
        <div className="statement-title-row"><div>{statement.producer.photo_url ? <img className="producer-avatar producer-avatar-photo" src={statement.producer.photo_url} alt="" /> : <span className="producer-avatar">{statement.producer.name.slice(0, 1)}</span>}<div><strong>{statement.producer.name}</strong><small>#{statement.producer.producer_code} · {statement.producer.village}</small></div></div><span>{statement.from} — {statement.to}</span></div>
        <div className="statement-summary-grid"><div><small>🥛 MILK QUANTITY</small><strong>{number(statement.totals.quantity, 3)} L</strong></div><div><small>💰 MILK VALUE</small><strong>₹{number(statement.totals.milkAmount)}</strong></div><div><small>🌾 FEED DEDUCTION</small><strong>− ₹{number(statement.totals.feedAmount)}</strong></div><div><small>💸 ADVANCES</small><strong>− ₹{number(statement.totals.advanceAmount)}</strong></div><div><small>✅ PAYMENTS</small><strong>− ₹{number(statement.totals.paymentAmount)}</strong></div><div className={statement.totals.balance < 0 ? 'statement-balance-negative' : 'statement-balance'}><small>📊 PERIOD BALANCE</small><strong>₹{number(statement.totals.balance)}</strong></div></div>
        <div className="statement-actions"><button className="button button-secondary" onClick={exportStatement}><ArrowDownToLine size={15} /> Export bill CSV</button><button className="button button-secondary" onClick={printStatement}><FileText size={15} /> Print / Save PDF</button></div>
        <div className="table-scroll"><table className="statement-table"><thead><tr><th rowSpan="2">DATE</th><th colSpan="2">🌅 MORNING</th><th colSpan="2">🌆 EVENING</th><th rowSpan="2">DAILY TOTAL</th></tr><tr><th>QTY (L)</th><th>AMOUNT</th><th>QTY (L)</th><th>AMOUNT</th></tr></thead><tbody>{[...statementDays.values()].sort((a, b) => a.date.localeCompare(b.date)).map((day) => <tr key={day.date}><td>{new Date(`${day.date}T12:00:00`).toLocaleDateString('en-IN')}</td><td>{number(day.morningQuantity, 3)}</td><td>₹{number(day.morningAmount)}</td><td>{number(day.eveningQuantity, 3)}</td><td>₹{number(day.eveningAmount)}</td><td><strong>₹{number(day.morningAmount + day.eveningAmount)}</strong></td></tr>)}</tbody></table></div>
        <div className="statement-detail-grid"><div><h3>🌾 Feed issues</h3>{statement.feedIssues.length ? statement.feedIssues.map((item) => <p key={item.id}><span>{item.date} · {item.description} ({number(item.quantity, 3)} {item.unit})</span><strong>− ₹{number(item.amount)}</strong></p>) : <span className="muted">No feed issues in this period.</span>}</div><div><h3>💳 Cash ledger</h3>{[...statement.advances.map((item) => ({ ...item, kind: item.voided_at ? 'Voided advance' : 'Advance', amount: Number(item.amount) * (item.voided_at ? 0 : 1) })), ...statement.payments.map((item) => ({ ...item, kind: 'Payment' }))].map((item) => <p key={item.id}><span>{item.date} · {item.kind}</span><strong>{item.voided_at ? 'Voided' : `− ₹${number(item.amount)}`}</strong></p>)}</div></div>
      </div>}
    </section>
    <section className="panel report-filter"><div><p className="section-kicker">REPORT PERIOD</p><h2>Dudh bill & collection report</h2></div><div className="report-controls"><label>Period<select value={period} onChange={(event) => changePeriod(event.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="custom">Custom date range</option></select></label><label>From<input type="date" value={from} onChange={(event) => { setPeriod('custom'); setFrom(event.target.value) }} /></label><label>To<input type="date" value={to} onChange={(event) => { setPeriod('custom'); setTo(event.target.value) }} /></label><label>Report view<select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="entries">Collection entries</option><option value="date">Daily totals</option><option value="producer">Producer-wise</option><option value="type">Cow / buffalo</option></select></label><button className="button button-primary" onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Generate report'}</button></div></section>
    <div className="report-summary"><div className="report-total"><span>TOTAL MILK</span><strong>{number(data?.totals?.quantity, 3)} <small>L</small></strong></div><div className="report-total"><span>TOTAL AMOUNT</span><strong>₹{number(data?.totals?.amount)}</strong></div><div className="report-total report-export"><span>REPORT</span><button className="button button-secondary" onClick={exportCsv}><ArrowDownToLine size={16} /> Export CSV</button><button className="button button-secondary" onClick={() => window.print()}><FileText size={16} /> Print</button></div></div>
    <section className="panel data-panel report-table"><div className="panel-heading"><div><p className="section-kicker">{dairyName} · {groupLabels[groupBy]}</p><h2>Milk collection report</h2></div><span className="report-date">{from} — {to}</span></div>{!data?.items?.length ? <EmptyState title="No milk entries for this period" text="Change the date range or record milk collections." /> : <div className="table-scroll"><table><thead>{groupBy === 'entries' ? <tr><th>DATE</th><th>PRODUCER</th><th>TYPE</th><th>QUANTITY</th><th>RATE / L</th><th>AMOUNT</th></tr> : <tr>{groupBy === 'date' ? <th>DATE</th> : groupBy === 'producer' ? <><th>PRODUCER CODE</th><th>PRODUCER</th></> : <th>MILK TYPE</th>}<th>TOTAL QUANTITY</th><th>TOTAL AMOUNT</th><th>ENTRIES</th></tr>}</thead><tbody>{data.items.map((row, i) => <tr key={`${row.date || row.producer_code || row.milk_type}-${i}`}>{groupBy === 'entries' ? <><td>{new Date(row.date).toLocaleDateString('en-IN')}</td><td><strong>{row.producer_name}</strong><small className="table-sub">#{row.producer_code}</small></td><td>{row.milk_type}</td><td>{number(row.quantity_litres, 3)} L</td><td>₹{number(row.rate_per_litre, 4)}</td><td><strong>₹{number(row.amount)}</strong></td></> : <>{groupBy === 'date' ? <td>{new Date(row.date).toLocaleDateString('en-IN')}</td> : groupBy === 'producer' ? <><td>{row.producer_code}</td><td>{row.producer_name}</td></> : <td>{row.milk_type}</td>}<td>{number(row.quantity_litres, 3)} L</td><td><strong>₹{number(row.amount)}</strong></td><td>{row.entries}</td></>}</tr>)}</tbody></table></div>}</section>
  </>
}

function ReportsPage({ dairyName }) {
  const now = new Date()
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'))
  const [year, setYear] = useState(String(now.getFullYear()))
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showDetailed, setShowDetailed] = useState(false)
  const monthKey = `${year}-${month}`
  const months = Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1).padStart(2, '0'),
    label: new Date(2026, index, 1).toLocaleDateString('en-IN', { month: 'short' }),
  }))
  const years = Array.from({ length: 9 }, (_, index) => String(now.getFullYear() - 4 + index))
  const monthLabel = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })

  const loadBills = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      setData(await api(`/private/reports/bills?${new URLSearchParams({ month: monthKey })}`))
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }, [monthKey])

  useEffect(() => { loadBills() }, [loadBills])

  function exportBills() {
    if (!data) return
    const rows = [
      ['Code', 'Producer', 'Milk (L)', 'Milk amount', 'Advance', 'Feed', 'Net pay', 'Paid', 'Balance due'],
      ...data.items.map((item) => [
        item.producer_code, item.name, item.quantity_litres, item.milk_amount, item.advance_amount,
        item.feed_amount, item.net_payable, item.payment_amount, item.balance_due,
      ]),
    ]
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `producer-bills-${monthKey}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (showDetailed) return <DetailedReportsPage dairyName={dairyName} onBack={() => setShowDetailed(false)} />

  return <div className="monthly-bill-page">
    {error && <Notice message={error} />}
    <div className="monthly-bill-filters">
      <label><span>महिना (Month)</span><select value={month} onChange={(event) => setMonth(event.target.value)}>{months.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      <label><span>वर्ष (Year)</span><select value={year} onChange={(event) => setYear(event.target.value)}>{years.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <button className="button button-primary monthly-bill-search" onClick={loadBills} disabled={busy}>{busy ? 'Loading…' : <><Search size={16} /> बिल पहा</>}</button>
    </div>
    <div className="monthly-bill-summary">
      <article className="bill-kpi-card bill-kpi-milk"><span className="bill-kpi-icon"><Milk size={22} /></span><div><span>एकूण दूध (L)</span><strong>{number(data?.totals?.quantity, 2)}</strong></div></article>
      <article className="bill-kpi-card bill-kpi-amount"><span className="bill-kpi-icon"><FileText size={22} /></span><div><span>एकूण रक्कम</span><strong>₹{number(data?.totals?.milkAmount)}</strong></div></article>
      <article className="bill-kpi-card bill-kpi-net"><span className="bill-kpi-icon"><IndianRupee size={22} /></span><div><span>निव्वळ पगार</span><strong>₹{number(data?.totals?.netPayable)}</strong></div></article>
    </div>
    <section className="panel monthly-bill-table-panel">
      <div className="monthly-bill-table-heading"><h2>🧾 उत्पादक बिल</h2><div className="monthly-bill-actions"><span>🗓 Monthly · {monthLabel} / {data?.items?.length || 0} उत्पादक</span><button className="icon-button" title="Detailed collection report" aria-label="Detailed collection report" onClick={() => setShowDetailed(true)}><FileText size={16} /></button><button className="icon-button" title="Export monthly bills" aria-label="Export monthly bills" onClick={exportBills} disabled={!data?.items?.length}><ArrowDownToLine size={16} /></button><button className="icon-button" title="Print monthly bills" aria-label="Print monthly bills" onClick={() => window.print()} disabled={!data?.items?.length}><FileText size={16} /></button></div></div>
      {!data?.items?.length ? <EmptyState title={busy ? 'Loading monthly bills…' : 'No producers found'} text={busy ? 'Preparing this month’s producer bill.' : 'Add active producers to see their monthly bills.'} /> : <div className="table-scroll monthly-bill-scroll"><table className="monthly-bill-table"><thead><tr><th>CODE</th><th>नाव</th><th>दूध (L)</th><th>रक्कम</th><th>उचल</th><th>खाद्य</th><th>पगार</th><th>पेमेंट</th><th>बाकी</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td>{item.producer_code}</td><td><strong>{item.name}</strong></td><td>{number(item.quantity_litres, 2)}</td><td>₹{number(item.milk_amount)}</td><td>₹{number(item.advance_amount)}</td><td>₹{number(item.feed_amount)}</td><td><strong>₹{number(item.net_payable)}</strong></td><td>₹{number(item.payment_amount)}</td><td><strong>₹{number(item.balance_due)}</strong></td></tr>)}</tbody><tfoot><tr><th colSpan="2">TOTAL</th><th>{number(data.totals.quantity, 2)}</th><th>₹{number(data.totals.milkAmount)}</th><th>₹{number(data.totals.advanceAmount)}</th><th>₹{number(data.totals.feedAmount)}</th><th>₹{number(data.totals.netPayable)}</th><th>₹{number(data.totals.paymentAmount)}</th><th>₹{number(data.totals.balanceDue)}</th></tr></tfoot></table></div>}
    </section>
  </div>
}

function UserPhotoSettings({ user, onProfile }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function choosePhoto(event) {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    setMessage('')
    if (!chosen) return
    setFile(null)
    setPreview('')
    if (chosen.size > 2 * 1024 * 1024) {
      setMessage('Photo must be smaller than 2 MB.')
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type)) {
      setMessage('Choose a JPEG, PNG, or WebP photo.')
      return
    }
    setFile(chosen)
    setPreview(URL.createObjectURL(chosen))
  }

  async function savePhoto() {
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      const upload = new FormData()
      upload.set('photo', file)
      await api('/private/me/photo', { method: 'POST', body: upload })
      await onProfile()
      setFile(null)
      setPreview('')
      setMessage('Profile photo updated.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function removePhoto() {
    setBusy(true)
    setMessage('')
    try {
      await api('/private/me/photo', { method: 'DELETE' })
      await onProfile()
      setFile(null)
      setPreview('')
      setMessage('Profile photo removed.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel profile-photo-panel">
    <div>
      <p className="section-kicker">YOUR ACCOUNT</p>
      <h2>Profile photo</h2>
      <p className="muted">Add a photo so your profile is easy to recognize.</p>
    </div>
    <div className="profile-photo-content">
      <div className="profile-photo-preview" aria-label="Profile photo preview">
        {(preview || user.photoUrl) ? <img src={preview || user.photoUrl} alt="" /> : <UserAvatar user={user} />}
      </div>
      <div className="profile-photo-controls">
        <label className="photo-upload-button"><ImagePlus size={15} /> {user.photoUrl ? 'Choose a new photo' : 'Choose your photo'}
          <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={choosePhoto} />
        </label>
        <span className="form-note">JPEG, PNG or WebP · maximum 2 MB. Your photo appears on your profile.</span>
        {message && <Notice message={message} success={message.includes('updated') || message.includes('removed')} />}
        <div className="profile-photo-actions">
          {file && <button className="button button-primary" onClick={savePhoto} disabled={busy}>{busy ? 'Saving…' : 'Save photo'} <Check size={16} /></button>}
          {user.photoUrl && !file && <button className="button button-secondary" onClick={removePhoto} disabled={busy}>{busy ? 'Removing…' : 'Remove photo'}</button>}
        </div>
      </div>
    </div>
  </section>
}

function SettingsPage({ user, onProfile }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await api('/private/dairy', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) })
      await onProfile()
      setMessage('Dairy profile updated.')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  return <><UserPhotoSettings user={user} onProfile={onProfile} /><section className="panel settings-panel"><div className="panel-heading"><div><p className="section-kicker">DAIRY IDENTITY</p><h2>Profile & display name</h2></div><div className="settings-logo"><Logo compact name={user.dairy.displayName} /></div></div><p className="muted">The display name appears in your workspace and reports. Logo upload can be connected when a private file storage service is configured.</p><form className="form-stack settings-form" onSubmit={save}><label>Registered dairy name<input name="registeredName" required defaultValue={user.dairy.registeredName} /></label><label>Display name<input name="displayName" required defaultValue={user.dairy.displayName} /></label><div className="form-note">Default format is “[business name] Dudh Dairy”. You can edit the display name here.</div><label>Village / city<input name="village" required defaultValue={user.dairy.village} /></label><label>Address<input name="address" defaultValue={user.dairy.address || ''} /></label>{message && <Notice message={message} success={message.includes('updated')} />}<button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'} <Check size={16} /></button></form></section></>
}

function PageContent({ path, user, date, onProfile }) {
  if (path === '/dashboard') return <Dashboard user={user} date={date} />
  if (path === '/producers') return <ProducersPage />
  if (path === '/milk') return <MilkPage date={date} />
  if (path === '/rates') return <RatesPage />
  if (path === '/feed') return <FeedPage />
  if (path === '/advances') return <AdvancesPage />
  if (path === '/reports') return <ReportsPage dairyName={user.dairy.displayName} />
  if (path === '/settings') return <SettingsPage user={user} onProfile={onProfile} />
  return <Dashboard user={user} date={date} />
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    function closeOnEscape(event) { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>{children}</section></div>
}

function EmptyState({ title, text, action }) {
  return <div className="empty-state"><div className="empty-icon"><FileText size={22} /></div><strong>{title}</strong><p>{text}</p>{action && <button className="button button-secondary" onClick={action}><Plus size={15} /> Add new</button>}</div>
}

function Notice({ message, success = false }) {
  return <div className={`notice ${success ? 'notice-success' : ''}`} role="alert">{message}</div>
}

function RootApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const authRoute = ['/login', '/register', '/'].includes(location.pathname)

  const loadProfile = useCallback(async () => {
    const data = await api('/private/me')
    setUser({ ...data.user, dairy: data.dairy })
    setError('')
  }, [])

  useEffect(() => {
    let active = true
    api('/private/me').then((data) => {
      if (active) setUser({ ...data.user, dairy: data.dairy })
    }).catch((cause) => {
      if (active) {
        if (cause.status !== 401) setError(cause.message)
        setUser(null)
      }
    }).finally(() => {
      if (active) setReady(true)
    })
    return () => { active = false }
  }, [])

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
      setUser(null)
      navigate('/login')
    } catch (cause) { setError(cause.message) }
  }

  if (!ready) return <div className="app-loading"><Logo /><span>Preparing your dairy workspace…</span></div>
  if (!user || authRoute) {
    if (user && authRoute) return <AppLayout user={user} onLogout={logout} onProfile={loadProfile} />
    return <><AuthPage onLogin={loadProfile} />{error && <div className="global-error">{error}</div>}</>
  }
  return <AppLayout user={user} onLogout={logout} onProfile={loadProfile} />
}

export default function App() {
  return <BrowserRouter><RootApp /></BrowserRouter>
}
