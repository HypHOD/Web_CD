import CaseStage from '@/components/cd-case/CaseStage';
import { readCover } from '@/components/cd-case/cover';
import { DISC } from '@/components/cd-case/disc';
import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

const MAX_SHELF = 48;
const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|webm|aif|aiff)$/i;
const stripExt = (name) => name.replace(/\.[^.]+$/, '');

export default function CdCase() {
  const stageRef = useRef(null);
  const audioRef = useRef(null);
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const folderToken = useRef(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [spin, setSpin] = useState(true);
  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState(null);
  const [shelf, setShelf] = useState(null);
  const [shelfIndex, setShelfIndex] = useState(null);
  const [shelfOverflow, setShelfOverflow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    const onTime = () => setCurrent(audio.currentTime);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const url = track?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [track?.url]);

  useEffect(() => {
    const el = folderRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !shelf || shelfIndex == null) return undefined;
    const entry = shelf[shelfIndex];
    if (!entry) return undefined;
    const url = URL.createObjectURL(entry.file);
    audio.src = url;
    audio.load();
    setCurrent(0);
    setDuration(0);
    return () => {
      audio.pause();
      URL.revokeObjectURL(url);
    };
  }, [shelf, shelfIndex]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const ready = shelf ? shelfIndex != null : !!track;
    if (!ready) return;
    if (open) audio.play().catch(() => {});
    else audio.pause();
  }, [open, track, shelf, shelfIndex]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (shelf) {
      stageRef.current?.setOpen(!open);
      return;
    }
    if (!track) {
      setPaused((p) => !p);
      return;
    }
    if (!audio) return;
    if (audio.paused) {
      if (open) audio.play().catch(() => {});
      else stageRef.current?.setOpen(true);
    } else if (open) {
      stageRef.current?.setOpen(false);
    } else {
      audio.pause();
    }
  };
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('button') && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'o' || e.key === 'O') stageRef.current?.setOpen();
      else if (e.key === 's' || e.key === 'S') setSpin((s) => !s);
      else if (e.key === ' ') {
        e.preventDefault();
        togglePlayRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const importSong = async (file) => {
    const audio = audioRef.current;
    if (!audio || !file) return;
    folderToken.current += 1;
    const url = URL.createObjectURL(file);
    audio.src = url;
    audio.load();
    setShelf(null);
    setShelfIndex(null);
    setShelfOverflow(0);
    setTrack({ name: stripExt(file.name), url });
    setCurrent(0);
    setDuration(0);
    stageRef.current?.setShelf(null);
    stageRef.current?.setOpen(true);
    const cover = await readCover(file);
    stageRef.current?.setArt(cover);
  };

  const importFolder = (fileList) => {
    const files = [...fileList].filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));
    if (!files.length) return;
    files.sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, {
        numeric: true,
      }),
    );
    const overflow = Math.max(0, files.length - MAX_SHELF);
    const chosen = files.slice(0, MAX_SHELF);
    const token = ++folderToken.current;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setTrack(null);
    setShelfIndex(null);
    setShelfOverflow(overflow);
    setOpen(false);
    setCurrent(0);
    setDuration(0);
    Promise.all(chosen.map((file) => readCover(file))).then((covers) => {
      if (token !== folderToken.current) return;
      const list = chosen.map((file, i) => ({ file, name: stripExt(file.name), cover: covers[i] }));
      setShelf(list);
      stageRef.current?.setShelf(list);
    });
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importSong(file);
  };

  const onFolder = (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length) importFolder(files);
  };

  const now = shelf ? (shelfIndex == null ? null : shelf[shelfIndex] || null) : track;
  const showPlayIcon = shelf || now ? !playing : paused;
  const progress = duration ? Math.min(current, duration) : 0;
  const percent = duration ? (progress / duration) * 100 : 0;

  return (
    <main
      className="cd"
      data-ready={ready || undefined}
    >
      <Head>
        <title>CD Case</title>
        <meta
          name="description"
          content="A clear CD jewel case in WebGL: light bends through the plastic, the disc spins inside with its rainbow, and the case turns round as its lid swings open."
        />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
      </Head>

      <CaseStage
        ref={stageRef}
        disc={DISC}
        paused={paused}
        spin={spin}
        autoShow={!track && !shelf}
        onOpen={setOpen}
        onSelect={setShelfIndex}
        onReady={() => setReady(true)}
        onFail={() => setFailed(true)}
      />

      {failed && <p className="cd-fail">This page needs WebGL, and your browser couldn&apos;t start it.</p>}

      <h1 className="cd-sr">CD Case</h1>
      <p
        className="cd-sr"
        aria-live="polite"
      >
        {`${now ? now.name : DISC.name}${open ? ', case open' : ''}`}
      </p>

      {!now && (
        <p
          className="cd-hint"
          aria-hidden="true"
        >
          {shelf
            ? shelfOverflow
              ? `Showing ${MAX_SHELF} of ${shelfOverflow + MAX_SHELF} songs · tap shelf to expand`
              : 'Tap the shelf to expand · then tap a case to play'
            : 'Tap the case to open it · drag to turn it'}
        </p>
      )}

      {now && (
        <div className="cd-progress">
          <div className="cd-progress-head">
            <span className="cd-progress-name">{now.name}</span>
            <span className="cd-progress-time">
              {formatTime(progress)} / {formatTime(duration)}
            </span>
          </div>
          <input
            className="cd-progress-bar"
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={progress}
            disabled={!duration}
            onChange={(e) => {
              const time = Number(e.target.value);
              setCurrent(time);
              if (audioRef.current) audioRef.current.currentTime = time;
            }}
            aria-label="Playback position"
            style={{ '--pct': `${percent}%` }}
          />
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={onFile}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        hidden
        onChange={onFolder}
      />

      <nav
        className="cd-dock"
        aria-label="Controls"
      >
        <button
          type="button"
          className="cd-tool"
          onClick={() => folderRef.current?.click()}
          aria-label="Import a folder"
          title="Import a folder"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 7a1.6 1.6 0 0 1 1.6-1.6h4.1l1.8 2.1h7.9A1.6 1.6 0 0 1 20.5 9v8.3a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6z" />
          </svg>
        </button>
        <button
          type="button"
          className="cd-tool"
          onClick={() => fileRef.current?.click()}
          aria-label="Import a song"
          title="Import a song"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 17V5.6l10-2V15" />
            <circle
              cx="6.5"
              cy="17.5"
              r="2.5"
            />
            <circle
              cx="16.5"
              cy="15.5"
              r="2.5"
            />
          </svg>
        </button>
        <button
          type="button"
          className="cd-tool"
          onClick={() => setSpin((s) => !s)}
          aria-label="Spin the disc"
          aria-pressed={spin}
          data-on={spin || undefined}
          title="Spin (S)"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <circle
              cx="12"
              cy="12"
              r="8.5"
            />
            <circle
              cx="12"
              cy="12"
              r="2.4"
            />
            <path
              d="M12 5.8a6.2 6.2 0 0 1 6.2 6.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="cd-tool"
          onClick={() => stageRef.current?.setOpen()}
          aria-label={open ? 'Close the case' : 'Open the case'}
          aria-pressed={open}
          data-on={open || undefined}
          title="Open (O)"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          >
            <path d="M11 5.5 3.5 7.8v10.4L11 18.5z" />
            <rect
              x="11"
              y="5.5"
              width="9.5"
              height="13"
              rx="1.4"
            />
            <circle
              cx="15.75"
              cy="12"
              r="2.6"
            />
          </svg>
        </button>
        <button
          type="button"
          className="cd-tool"
          onClick={togglePlay}
          aria-label={showPlayIcon ? 'Play' : 'Pause'}
          aria-pressed={!showPlayIcon}
          title={`${showPlayIcon ? 'Play' : 'Pause'} (Space)`}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            aria-hidden="true"
          >
            {showPlayIcon ? (
              <path
                d="M7 4.5v15l12.5-7.5z"
                fill="currentColor"
              />
            ) : (
              <path
                d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"
                fill="currentColor"
              />
            )}
          </svg>
        </button>
      </nav>

      <style
        jsx
        global
      >{`
        .cd {
          --ink: #111114;
          --faint: rgba(17, 17, 20, 0.08);
          position: fixed;
          inset: 0;
          overflow: hidden;
          background: #ffffff;
          color: var(--ink);
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .cd-stage {
          position: absolute;
          inset: 0;
          touch-action: none;
        }
        .cd-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          opacity: 0;
          transition: opacity 0.8s ease;
        }
        .cd[data-ready] .cd-canvas {
          opacity: 1;
        }
        .cd-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
        .cd-fail {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          margin: 0;
          max-width: 80vw;
          text-align: center;
          font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
          color: rgba(17, 17, 20, 0.6);
        }

        .cd-hint {
          position: absolute;
          left: 50%;
          bottom: calc(max(24px, env(safe-area-inset-bottom)) + 76px);
          transform: translateX(-50%);
          margin: 0;
          white-space: nowrap;
          pointer-events: none;
          font: 11.5px/1 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
          letter-spacing: 0.01em;
          color: rgba(17, 17, 20, 0.42);
          transition: opacity 0.8s ease 0.6s;
        }
        .cd:not([data-ready]) .cd-hint {
          opacity: 0;
        }

        .cd-progress {
          position: absolute;
          left: 50%;
          bottom: calc(max(24px, env(safe-area-inset-bottom)) + 76px);
          transform: translateX(-50%);
          width: min(340px, calc(100vw - 48px));
          padding: 10px 14px 11px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid var(--faint);
          box-shadow: 0 10px 30px -12px rgba(17, 17, 20, 0.18);
          -webkit-backdrop-filter: blur(14px);
          backdrop-filter: blur(14px);
          font: 11.5px/1 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
          transition: opacity 0.8s ease 0.3s, transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.3s;
        }
        .cd:not([data-ready]) .cd-progress {
          opacity: 0;
          transform: translate(-50%, 10px);
        }
        .cd-progress-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 9px;
        }
        .cd-progress-name {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          font-size: 12px;
          letter-spacing: 0.01em;
          color: var(--ink);
        }
        .cd-progress-time {
          flex: none;
          font-size: 10.5px;
          letter-spacing: 0.02em;
          font-variant-numeric: tabular-nums;
          color: rgba(17, 17, 20, 0.45);
        }
        .cd-progress-bar {
          -webkit-appearance: none;
          appearance: none;
          display: block;
          width: 100%;
          height: 12px;
          margin: 0;
          padding: 0;
          background: transparent;
          cursor: pointer;
        }
        .cd-progress-bar:disabled {
          cursor: default;
        }
        .cd-progress-bar:focus-visible {
          outline: 1px solid var(--ink);
          outline-offset: 6px;
          border-radius: 3px;
        }
        .cd-progress-bar::-webkit-slider-runnable-track {
          height: 2px;
          border-radius: 2px;
          background: linear-gradient(to right, var(--ink) var(--pct), rgba(17, 17, 20, 0.14) var(--pct));
        }
        .cd-progress-bar::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 9px;
          height: 9px;
          margin-top: -3.5px;
          border: 0;
          border-radius: 50%;
          background: var(--ink);
        }
        .cd-progress-bar::-moz-range-track {
          height: 2px;
          border-radius: 2px;
          background: rgba(17, 17, 20, 0.14);
        }
        .cd-progress-bar::-moz-range-progress {
          height: 2px;
          border-radius: 2px;
          background: var(--ink);
        }
        .cd-progress-bar::-moz-range-thumb {
          width: 9px;
          height: 9px;
          border: 0;
          border-radius: 50%;
          background: var(--ink);
        }

        .cd-dock {
          position: absolute;
          left: 50%;
          bottom: max(24px, env(safe-area-inset-bottom));
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px;
          border-radius: 30px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid var(--faint);
          box-shadow: 0 10px 30px -12px rgba(17, 17, 20, 0.18);
          -webkit-backdrop-filter: blur(14px);
          backdrop-filter: blur(14px);
          transition: opacity 0.8s ease 0.2s, transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s;
        }
        .cd:not([data-ready]) .cd-dock {
          opacity: 0;
          transform: translate(-50%, 12px);
        }
        .cd-tool {
          flex: none;
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: transparent;
          color: var(--ink);
          cursor: pointer;
          transition: background 0.25s ease, color 0.25s ease;
        }
        .cd-tool:hover {
          background: rgba(17, 17, 20, 0.05);
        }
        .cd-tool:focus-visible {
          outline: 1px solid var(--ink);
          outline-offset: 2px;
        }
        .cd-tool[data-on] {
          background: var(--ink);
          color: #ffffff;
        }

        @media (max-width: 720px) {
          .cd-dock {
            gap: 2px;
            padding: 5px;
            bottom: max(16px, env(safe-area-inset-bottom));
          }
          .cd-tool {
            width: 38px;
            height: 38px;
          }
          .cd-hint {
            bottom: calc(max(16px, env(safe-area-inset-bottom)) + 62px);
            font-size: 11px;
          }
          .cd-progress {
            width: min(300px, calc(100vw - 40px));
            bottom: calc(max(16px, env(safe-area-inset-bottom)) + 62px);
            padding: 9px 12px 10px;
          }
        }
      `}</style>
    </main>
  );
}
