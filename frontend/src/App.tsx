import type { HomeData } from '../../shared/api'
import { useApi } from './api'
import { AreaPage } from './pages/AreaPage'
import { GoalsPage } from './pages/GoalsPage'
import { HomePage } from './pages/HomePage'
import { ReviewPage } from './pages/ReviewPage'
import { useRoute } from './router'

export function App() {
  const route = useRoute()
  const home = useApi<HomeData>('/home')
  const pending = home.data?.pendingProposals ?? 0

  return (
    <div className="app">
      <header className="topbar">
        <a className="wordmark" href="#/">
          <span className="mark">L</span>
          <span>
            Learning
            <br />
            <b>Studio</b>
          </span>
        </a>
        <nav>
          <a href="#/" className={route.page === 'home' || route.page === 'area' ? 'active' : ''}>
            Map
          </a>
          <a href="#/review" className={route.page === 'review' ? 'active' : ''}>
            Review {pending > 0 && <span className="count-badge">{pending}</span>}
          </a>
          <a href="#/goals" className={route.page === 'goals' ? 'active' : ''}>
            Goals
          </a>
        </nav>
        {home.data && (
          <span className={`ai-state ${home.data.aiAvailable ? 'on' : ''}`}>
            {home.data.aiAvailable ? 'AI ready' : 'AI off · set ANTHROPIC_API_KEY'}
          </span>
        )}
      </header>
      <main className="page">
        {route.page === 'home' && <HomePage home={home.data} error={home.error} />}
        {route.page === 'area' && <AreaPage areaId={route.areaId} topicId={route.topicId} view={route.view} />}
        {route.page === 'review' && <ReviewPage aiAvailable={home.data?.aiAvailable ?? false} />}
        {route.page === 'goals' && <GoalsPage />}
      </main>
      <footer>
        <span>Learning Studio</span>
        <span>Built for understanding, not collecting tabs.</span>
      </footer>
    </div>
  )
}
