import { useEffect } from 'react';
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

export function App() {
  const route = useRoute();
  const { now, next } = useQueue();
  const queued = next.length + (now ? 1 : 0);

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
      page = <SongFormPage key="new" />;
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
        <nav className="nav">
          <MicIndicator />
          <a className={route.name === 'library' ? 'active' : ''} href={paths.library()}>
            <Icon name="home" size={18} />
            <span>คลังเพลง</span>
          </a>
          <a className={route.name === 'room' ? 'active' : ''} href={paths.room()}>
            <Icon name="queue" size={18} />
            <span>ห้องคาราโอเกะ</span>
            {queued > 0 && <span className="nav-count">{queued}</span>}
          </a>
          <a className={route.name === 'battle' ? 'active' : ''} href={paths.battle()}>
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
      <Toaster />
    </>
  );
}
