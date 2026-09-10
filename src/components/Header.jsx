import { NavLink, Link } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'

export default function Header() {
  const { t, lang, setLang } = useI18n()
  return (
    <header className="header">
      <Link className="brand" to="/">
        <span>🍽️</span>
        <span>
          {t('app.title')}
          <small>{t('app.tagline')}</small>
        </span>
      </Link>
      <nav>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          {t('nav.studio')}
        </NavLink>
        <NavLink to="/menu" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          {t('nav.menu')}
        </NavLink>
        <button className="tab" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
          {t('lang.switch')}
        </button>
      </nav>
    </header>
  )
}
