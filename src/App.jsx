import { Routes, Route, Navigate } from 'react-router-dom'
import Header from './components/Header.jsx'
import Studio from './pages/Studio.jsx'
import Menu from './pages/Menu.jsx'
import Item from './pages/Item.jsx'

export default function App() {
  return (
    <div className="app">
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Studio />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/item/:id" element={<Item />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
