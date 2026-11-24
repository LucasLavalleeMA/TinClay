import { useState } from 'react'
import { ArrowLeft, ArrowRight, FileSpreadsheet, FolderOpen, Home, MoreHorizontal, Plus, Star } from 'lucide-react'
import { isTauri } from '../engine/storageAdapter'
import { relativeTime, type RecentFile } from '../engine/recentFiles'
import { templates, type Template } from '../engine/templates'
import './HomeView.css'

interface Props {
  hasDocument: boolean
  files: RecentFile[]
  onBack: () => void
  onBlank: () => void
  onTemplate: (template: Template) => void
  onBrowse: () => void
  onOpen: (file: RecentFile) => void
  onPin: (file: RecentFile) => void
  onRemove: (file: RecentFile) => void
  onReveal: (file: RecentFile) => void
}

export function HomeView({ hasDocument, files, onBack, onBlank, onTemplate, onBrowse, onOpen, onPin, onRemove, onReveal }: Props) {
  const [view, setView] = useState<'home' | 'new'>('home')
  const [tab, setTab] = useState<'recent' | 'pinned'>('recent')
  const [menu, setMenu] = useState<string>()
  const sorted = [...files].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.accessed - a.accessed)
  const visible = tab === 'pinned' ? sorted.filter((file) => file.pinned) : sorted
  return <div className="home-view">
    <aside className="home-rail">
      {hasDocument && <button className="home-back" onClick={onBack}><ArrowLeft /> Back to Document</button>}
      <div className="home-brand"><img className="home-brand-icon" src="/tinclay.png" alt="" /><strong>TinClay</strong></div>
      <nav aria-label="Home navigation">
        <button aria-current={view === 'home' ? 'page' : undefined} onClick={() => setView('home')}><Home /> Home</button>
        <button aria-current={view === 'new' ? 'page' : undefined} onClick={() => setView('new')}><Plus /> New</button>
        <button onClick={onBrowse}><FolderOpen /> Open</button>
      </nav>
    </aside>
    <main className="home-content">
      <header className="home-heading"><p>WELCOME TO TINCLAY</p><h1>{view === 'home' ? 'Make something new.' : 'New worksheet'}</h1><span>Bring your ideas to life, one calculation at a time.</span></header>
      <section aria-labelledby="new-heading">
        <div className="home-section-heading"><h2 id="new-heading">{view === 'home' ? 'New' : 'Templates'}</h2>{view === 'home' && <button className="home-link" onClick={() => setView('new')}>More templates <ArrowRight /></button>}</div>
        <div className="template-gallery">
          <button className="template-card" onClick={onBlank}>
            <span className="template-image template-blank"><Plus /></span>
            <strong>Blank Worksheet</strong><small>Start with a clean grid</small>
          </button>
          {templates.map((template) => <button className="template-card" key={template.id} onClick={() => onTemplate(template)}>
            <span className="template-image template-energy"><span className="template-formula">½mv²</span><span className="template-chart"><i /><i /><i /><i /><i /></span></span>
            <strong>{template.title}</strong><small>{view === 'new' ? template.description : template.category}</small>
          </button>)}
        </div>
      </section>
      {view === 'home' && <section className="recent-section" aria-label="Worksheets">
        <div className="home-tabs" role="tablist" aria-label="Document lists">
          <button role="tab" aria-selected={tab === 'recent'} onClick={() => { setTab('recent'); setMenu(undefined) }}>Recent</button>
          <button role="tab" aria-selected={tab === 'pinned'} onClick={() => { setTab('pinned'); setMenu(undefined) }}>Pinned</button>
        </div>
        {visible.length === 0 ? <div className="recent-empty"><FileSpreadsheet /><strong>{tab === 'pinned' ? 'No pinned worksheets yet' : 'Your recent worksheets will appear here'}</strong><span>{tab === 'pinned' ? 'Pin a recent worksheet to keep it close.' : 'Open or save a worksheet to get started.'}</span></div> :
          <div className="recent-list">
            <div className="recent-list-heading"><span>Name</span><span>Last modified</span><span /></div>
            {visible.map((file) => <div className="recent-row" key={file.path}>
              <button className="recent-document" onClick={() => onOpen(file)}><FileSpreadsheet /><span><strong>{file.name}</strong><small title={file.path}>{file.path.startsWith('browser:') ? 'Browser file' : file.path}</small></span></button>
              <span className="recent-date" title={new Date(file.modified).toLocaleString()}>{relativeTime(file.modified)}</span>
              <div className="recent-actions">
                <button aria-label={`${file.pinned ? 'Unpin' : 'Pin'} ${file.name}`} title={file.pinned ? 'Unpin' : 'Pin'} onClick={() => onPin(file)}><Star fill={file.pinned ? 'currentColor' : 'none'} /></button>
                <div className="recent-menu-wrap"><button aria-label={`More options for ${file.name}`} aria-expanded={menu === file.path} onClick={() => setMenu(menu === file.path ? undefined : file.path)}><MoreHorizontal /></button>
                  {menu === file.path && <div className="recent-menu">
                    <button onClick={() => { setMenu(undefined); onOpen(file) }}>Open</button>
                    {isTauri() && <button onClick={() => { setMenu(undefined); onReveal(file) }}>Open File Location</button>}
                    <button onClick={() => { setMenu(undefined); onRemove(file) }}>Remove from Recent</button>
                  </div>}
                </div>
              </div>
            </div>)}
          </div>}
      </section>}
    </main>
  </div>
}
