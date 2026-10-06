import { useEffect, useState } from 'react';
import { paths, useRoute } from './lib/router';
import { useQueue } from './lib/queue';
import { requestPersistence } from './lib/db';
import { seedDemoIfNeeded } from './lib/songs';
import { getEngine } from './audio/engine';
import { useEngineState } from './hooks/useEngine';
import { LibraryPage } from './pages/LibraryPage';
import { SongFormPage } from './pages/SongFormPage';
import { SyncPage } from './pages/SyncPage';
import { SingPage } from './pages/SingPage';
import { RoomPage } from './pages/RoomPage';
import { BattlePage } from './pages/BattlePage';
import { OnlinePage } from './pages/OnlinePage';
import { Toaster } from './components/Toaster';
import { Icon } from './components/Icon';

function MicIndicator() {
  const { micOn, recording } = useEngineState();
  if (!micOn) return null;
  return (
    <button type="button" className={`mic-indicator ${recording ? 'rec' : ''}`} onClick={() => getEngine().disableMic()} disabled={recording} title="ปิดไมค์">
      <Icon name="mic" size={16} /> {recording ? 'กำลังอัด' : 'ไมค์เปิด'}
    </button>
  );
}

/** มือถือ: ซ่อนแถบเมนูล่างตอนพิมพ์ (คีย์บอร์ดเปิด) ไม่ให้บังช่องกรอก */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (el: EventTarget | null) => {
      const e = el as HTMLElement | null;
      if (!e?.tagName) return false;
      if (e.tagName === 'TEXTAREA' || e.isContentEditable) return true;
      if (e.tagName !== 'INPUT') return false;
      const type = (e as HTMLInputElement).type;
      return !['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'color'].includes(type);
    };
    const onIn = (e: FocusEvent) => setTyping(isField(e.target));
    const onOut = () => setTyping(false);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return typing;
}

function TabLink({ href, icon, label, active, badge, cta }: { href: string; icon: string; label: string; active: boolean; badge?: number; cta?: boolean }) {
  return (
    <a className={`tab ${active ? 'active' : ''} ${cta ? 'tab-cta' : ''}`} href={href} aria-current={active ? 'page' : undefined}>
      <span className="tab-icon">
        <Icon name={icon} size={cta ? 26 : 22} />
        {!!badge && <span className="tab-badge">{badge}</span>}
      </span>
      <span className="tab-label">{label}</span>
    </a>
  );
}

export function App() {
  const route = useRoute();
  const { now, next } = useQueue();
  const queued = next.length + (now ? 1 : 0);
  const typing = useTyping();

  useEffect(() => {
    requestPersistence();
    void seedDemoIfNeeded();
  }, []);

  let page;
  switch (route.name) {
    case 'library':
      page = <LibraryPage />;
      break;
    case 'new':
      page = <SongFormPage key={route.youtube ? 'new-yt' : 'new'} youtube={route.youtube} />;
      break;
    case 'edit':
      page = <SongFormPage key={route.id} id={route.id} />;
      break;
    case 'sync':
      page = <SyncPage key={route.id} id={route.id} />;
      break;
    case 'sing':
      page = <SingPage key={route.id} id={route.id} />;
      break;
    case 'room':
      page = <RoomPage />;
      break;
    case 'battle':
      page = <BattlePage key={route.songId ?? 'battle'} songId={route.songId} />;
      break;
    case 'online':
      page = <OnlinePage key="online" code={route.code} local={route.local} />;
      break;
    default:
      page = (
        <div className="page">
          <h1>ไม่พบหน้านี้</h1>
          <a href={paths.library()}>กลับหน้าแรก</a>
        </div>
      );
  }

  return (
    <>
      <header className="topbar">
        <a className="brand" href={paths.library()}>
          <span className="brand-mark">
            <Icon name="mic" size={20} />
          </span>
          <span className="brand-name">ร้องเลย</span>
          <span className="brand-sub">คาราโอเกะเพลงไทย</span>
        </a>
        <MicIndicator />
        <nav className="nav">
          <a className={route.name === 'library' ? 'active' : ''} href={paths.library()}>
            <Icon name="home" size={18} />
            <span>หน้าแรก</span>
          </a>
          <a className={route.name === 'room' ? 'active' : ''} href={paths.room()}>
            <Icon name="queue" size={18} />
            <span>ห้องคาราโอเกะ</span>
            {queued > 0 && <span className="nav-count">{queued}</span>}
          </a>
          <a className={route.name === 'battle' || route.name === 'online' ? 'active' : ''} href={paths.battle()}>
            <Icon name="trophy" size={18} />
            <span>แข่งร้อง</span>
          </a>
          <a className={`nav-cta ${route.name === 'new' ? 'active' : ''}`} href={paths.newSong()}>
            <Icon name="plus" size={18} />
            <span>เพิ่มเพลง</span>
          </a>
        </nav>
      </header>
      <main>{page}</main>
      <footer className="footer muted small">
        ร้องเลย · ทำงานในเบราว์เซอร์ทั้งหมด — เพลงของคุณไม่ถูกอัปโหลดไปที่ใด · โปรดใช้เพลงที่คุณมีสิทธิ์ใช้งาน
      </footer>
      {/* มือถือ: เมนูหลักด้านล่างแบบแอป */}
      <nav className={`tabbar ${typing ? 'hidden' : ''}`} aria-label="เมนูหลัก">
        <TabLink href={paths.library()} icon="home" label="หน้าแรก" active={['library', 'edit', 'sync', 'sing'].includes(route.name)} />
        <TabLink href={paths.room()} icon="queue" label="ห้องร้อง" active={route.name === 'room'} badge={queued} />
        <TabLink href={paths.newSong()} icon="plus" label="เพิ่มเพลง" active={route.name === 'new'} cta />
        <TabLink href={paths.battle()} icon="trophy" label="แข่งร้อง" active={route.name === 'battle'} />
        <TabLink href={paths.online()} icon="users" label="ออนไลน์" active={route.name === 'online'} />
      </nav>
      <Toaster />
    </>
  );
}
