import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  ArrowRight,
  Cast,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  FileVideo,
  FolderOpen,
  HardDrive,
  Laptop,
  LoaderCircle,
  Maximize,
  MonitorPlay,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Subtitles,
  Trash2,
  Tv,
  Upload,
  Volume2,
  VolumeX,
  Minus,
  ShieldCheck,
  Wifi,
  X,
} from "lucide-react";
import "@fontsource-variable/manrope";
import "@fontsource-variable/noto-sans-kr";
import "./style.css";
import { matchingSubtitle } from "../shared/media.js";

const initial = {
  items: [],
  devices: [],
  network: [],
  cast: { connected: false },
  jobs: [],
};
const time = (n) => {
  n = Math.max(0, Math.floor(Number(n) || 0));
  return n >= 3600
    ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`
    : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
const size = (bytes) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
async function api(path, body, method = "POST") {
  const response = await fetch(`/api/${path}`, {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}
function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

function App() {
  const [state, setState] = useState(initial);
  const [selectedId, setSelectedId] = useState(null);
  const [subtitleId, setSubtitleId] = useState("");
  const [subtitleOn, setSubtitleOn] = useState(true);
  const [offset, setOffset] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const volumeRef = useRef(0.7),
    volumeTarget = useRef(null),
    volumeSending = useRef(false),
    volumeChanged = useRef(0),
    lastAudible = useRef(0.7);
  const [modal, setModal] = useState(null);
  const [ip, setIp] = useState("");
  const [busy, setBusy] = useState("");
  const [upload, setUpload] = useState(null);
  const [toast, setToast] = useState(null);
  const [drag, setDrag] = useState(false);
  const [filter, setFilter] = useState("all");
  const [serverError, setServerError] = useState(false);
  const video = useRef(null),
    fileInput = useRef(null),
    subtitleInput = useRef(null),
    library = useRef(null),
    dialog = useRef(null),
    lastFocus = useRef(null);
  const selected = state.items.find((i) => i.id === selectedId);
  const subtitle = state.items.find((i) => i.id === subtitleId);
  const media = state.items.filter((i) => i.kind === "media");
  const subtitles = state.items.filter((i) => i.kind === "subtitle");
  const casting = state.cast.connected && state.cast.itemId === selectedId;
  const remotePlaying = state.cast.playerState === "PLAYING";
  const activePlaying = casting ? remotePlaying : playing;
  const position = casting ? state.cast.currentTime || 0 : current;
  const length = casting ? state.cast.duration || 0 : duration;
  const subtitleUrl = subtitle ? `${subtitle.url}?offset=${offset}` : undefined;
  const refresh = async () => {
    try {
      const fresh = await api("state", null, "GET");
      setState(fresh);
      setServerError(false);
      return fresh;
    } catch {
      setServerError(true);
    }
  };
  const message = (text, error = false) =>
    setToast({ text, error, id: Date.now() });
  async function run(label, fn) {
    setBusy(label);
    try {
      return await fn();
    } catch (e) {
      message(e.message, true);
    } finally {
      setBusy("");
      await refresh();
    }
  }
  useEffect(() => {
    refresh();
    const presence = new EventSource("/api/presence");
    const timer = setInterval(refresh, 2000);
    return () => {
      clearInterval(timer);
      presence.close();
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(
        () => setToast(null),
        toast.error ? 12000 : 4500,
      );
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (modal) {
      lastFocus.current = document.activeElement;
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      lastFocus.current?.focus();
    }
  }, [modal]);
  useEffect(() => {
    if (casting) video.current?.pause();
  }, [casting]);
  useEffect(() => {
    if (state.cast.error) message(state.cast.error, true);
  }, [state.cast.error]);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const apply = () => {
      for (const track of el.textTracks)
        track.mode = subtitleOn ? "showing" : "hidden";
    };
    apply();
    el.textTracks.addEventListener("addtrack", apply);
    return () => el.textTracks.removeEventListener("addtrack", apply);
  }, [subtitleUrl, subtitleOn, selectedId]);
  useEffect(() => {
    if (video.current) video.current.volume = volume;
  }, [volume, selectedId]);
  useEffect(() => {
    if (
      casting &&
      typeof state.cast.volume === "number" &&
      Date.now() - volumeChanged.current > 1000 &&
      !volumeSending.current
    ) {
      setVolume(state.cast.volume);
      volumeRef.current = state.cast.volume;
    }
  }, [casting, state.cast.volume]);
  async function adjustVolume(value) {
    const next = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
    setVolume(next);
    volumeRef.current = next;
    volumeChanged.current = Date.now();
    if (next > 0) lastAudible.current = next;
    if (!casting) return;
    volumeTarget.current = next;
    if (volumeSending.current) return;
    volumeSending.current = true;
    try {
      while (volumeTarget.current !== null) {
        const value = volumeTarget.current;
        volumeTarget.current = null;
        const result = await api("cast/control", { action: "volume", value });
        setState((s) => ({ ...s, cast: result }));
      }
    } catch (e) {
      volumeTarget.current = null;
      message(e.message, true);
    } finally {
      volumeSending.current = false;
      await refresh();
    }
  }
  useEffect(() => {
    const key = (e) => {
      if (
        modal ||
        ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(e.target.tagName)
      )
        return;
      if (e.code === "Space" && selected) {
        e.preventDefault();
        togglePlay();
      }
      if (e.code === "ArrowRight" && selected) {
        e.preventDefault();
        seek(position + 10);
      }
      if (e.code === "ArrowLeft" && selected) {
        e.preventDefault();
        seek(position - 10);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function choose(item, available = state.items) {
    setSelectedId(item.id);
    setCurrent(0);
    setDuration(0);
    setPlaying(false);
    setOffset(0);
    const match = matchingSubtitle(item, available);
    setSubtitleId(match?.id || "");
    setSubtitleOn(true);
  }
  async function openPicker() {
    if (!state.nativePicker) {
      fileInput.current.click();
      return;
    }
    await run("파일 선택 중", async () => {
      const result = await api("open-local");
      const fresh = await refresh();
      const item = result.items.find((i) => i.kind === "media");
      if (item) {
        choose(item, fresh.items);
        if (matchingSubtitle(item, result.items))
          message("같은 이름의 자막을 자동으로 연결했습니다.");
      }
    });
  }
  async function openFiles(files) {
    if (upload) return;
    let lastMedia = null,
      lastSubtitle = null;
    for (const file of [...files]) {
      setUpload({ name: file.name, percent: 0 });
      try {
        const item = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/upload");
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable)
              setUpload({
                name: file.name,
                percent: Math.round((e.loaded / e.total) * 100),
              });
          };
          xhr.onload = () => {
            try {
              const result = JSON.parse(xhr.responseText);
              xhr.status < 300
                ? resolve(result)
                : reject(new Error(result.error));
            } catch {
              reject(new Error("파일을 가져오지 못했습니다."));
            }
          };
          xhr.onerror = () => reject(new Error("서버 연결이 끊겼습니다."));
          const body = new FormData();
          body.append("file", file);
          xhr.send(body);
        });
        if (item.kind === "media") lastMedia = item;
        else lastSubtitle = item;
      } catch (e) {
        message(e.message, true);
      }
    }
    const fresh = await refresh();
    setUpload(null);
    const active = lastMedia || selected;
    const matched = matchingSubtitle(active, fresh?.items || []);
    if (lastMedia) choose(lastMedia, fresh?.items || []);
    if (matched || (lastSubtitle && !lastMedia)) {
      const chosen = matched || lastSubtitle;
      setSubtitleId(chosen.id);
      setSubtitleOn(true);
      if (casting && !lastMedia)
        await run("자막 자동 적용", () =>
          api("cast/load", {
            itemId: selectedId,
            subtitleId: chosen.id,
            offset,
            currentTime: position,
            subtitlesEnabled: true,
            autoplay: remotePlaying,
          }),
        );
      message(
        matched
          ? "같은 이름의 자막을 자동으로 연결했습니다."
          : "자막을 연결했습니다.",
      );
    }
  }
  async function togglePlay() {
    if (!selected) {
      openPicker();
      return;
    }
    if (casting)
      await run("재생 제어", () =>
        api("cast/control", { action: remotePlaying ? "pause" : "play" }),
      );
    else if (video.current.paused) {
      try {
        await video.current.play();
      } catch {
        message(
          "이 영상은 브라우저에서 재생할 수 없습니다. TV 호환 변환을 사용해 주세요.",
          true,
        );
      }
    } else video.current.pause();
  }
  async function seek(value) {
    const next = Math.min(Math.max(0, value), length || 0);
    if (casting)
      await run("탐색", () =>
        api("cast/control", { action: "seek", value: next }),
      );
    else if (video.current && Number.isFinite(video.current.duration))
      video.current.currentTime = next;
  }
  async function sendToTv(device) {
    await run("TV에 연결 중", async () => {
      if (device) await api("cast/connect", { address: device.address });
      if (selected) {
        await api("cast/load", {
          itemId: selected.id,
          subtitleId,
          offset,
          subtitlesEnabled: subtitleOn,
          currentTime: position,
        });
        video.current?.pause();
        message("TV에서 재생을 시작했습니다.");
      } else message("TV가 연결되었습니다. 재생할 영상을 열어 주세요.");
      setModal(null);
    });
  }
  const changeSubtitle = async (enabled) => {
    if (casting)
      await run("자막 설정", async () => {
        await api("cast/control", { action: "subtitles", value: enabled });
        setSubtitleOn(enabled);
      });
    else setSubtitleOn(enabled);
  };

  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDrag(true);
        }
      }}
    >
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="KPLAYER 홈">
          <span className="brand-mark">
            <Play size={21} fill="currentColor" strokeWidth={0} />
          </span>
          <span>
            KPLAYER<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="space-label">YOUR SPACE</div>
        <nav aria-label="메인 메뉴">
          <button
            className="nav-item active"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <MonitorPlay size={19} />
            플레이어
            <span className="nav-dot" />
          </button>
          <button
            className="nav-item"
            onClick={() =>
              library.current.scrollIntoView({ behavior: "smooth" })
            }
          >
            <FolderOpen size={19} />
            이번 재생 목록
            <span className="nav-count">{media.length}</span>
          </button>
          <button className="nav-item" onClick={() => setModal("cast")}>
            <Cast size={19} />
            TV 연결{state.cast.connected && <span className="nav-dot" />}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="side-note">
            <span className="small-orbit">
              <Wifi size={19} />
            </span>
            <strong>같은 Wi-Fi, 더 큰 화면.</strong>
            <p>
              좋아하는 영상을
              <br />
              가장 편한 자리에서 즐기세요.
            </p>
            <button onClick={() => setModal("help")}>
              연결 방법 알아보기 <ArrowRight size={15} />
            </button>
          </div>
          <button className="help-link" onClick={() => setModal("help")}>
            <CircleHelp size={17} />
            도움말 & 연결 가이드
            <ChevronRight size={14} />
          </button>
          <div className="version">
            KPLAYER FOR DESKTOP <span>v1.0</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            내 공간 <ChevronRight size={13} />
            <span>플레이어</span>
          </div>
          <div className="topbar-right">
            <button
              className="privacy-badge"
              onClick={() => setModal("privacy")}
            >
              <ShieldCheck size={15} />
              <span>기록 없는 재생</span>
            </button>
            <span className={`network-status ${serverError ? "offline" : ""}`}>
              <i />
              {serverError ? "서버 연결 끊김" : "로컬 서버 실행 중"}
            </span>
            <span className="avatar">K</span>
          </div>
        </header>
        <div className="content">
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                LESS SETUP. MORE CINEMA.
              </div>
              <h1>
                당신의 화면을, 더 넓게<span>.</span>
              </h1>
              <p>내 영상과 자막 그대로. 이제 TV에서 편하게 즐기세요.</p>
            </div>
            <button
              className="button dark"
              onClick={openPicker}
              disabled={!!upload}
            >
              <Plus size={18} />
              파일 열기
            </button>
          </section>
          {serverError && (
            <div className="error-banner" role="alert">
              로컬 서버와 연결이 끊겼습니다. KPLAYER 실행 창을 확인해 주세요.
            </div>
          )}
          <div className="workspace">
            <section className="player-column" aria-label="영상 플레이어">
              <div className="player-card">
                <div className="player-stage">
                  <div className="stage-top">
                    <span className="stage-badge">
                      <span />
                      {casting ? "CASTING TO TV" : "YOUR PRIVATE CINEMA"}
                    </span>
                    <span className="stage-format">
                      {selected
                        ? selected.name.split(".").pop().toUpperCase()
                        : "READY WHEN YOU ARE"}
                    </span>
                  </div>
                  {selected ? (
                    <>
                      <video
                        ref={video}
                        key={selected.id}
                        src={selected.url}
                        crossOrigin="anonymous"
                        preload="metadata"
                        onClick={togglePlay}
                        onTimeUpdate={(e) =>
                          setCurrent(e.currentTarget.currentTime)
                        }
                        onLoadedMetadata={(e) =>
                          setDuration(e.currentTarget.duration)
                        }
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onEnded={() => setPlaying(false)}
                        onError={() =>
                          message(
                            "이 영상은 로컬 재생이 어렵습니다. 아래 메뉴에서 TV 호환 변환을 사용해 주세요.",
                            true,
                          )
                        }
                      >
                        {subtitle && (
                          <track
                            key={subtitleUrl}
                            src={subtitleUrl}
                            kind="subtitles"
                            srcLang="ko"
                            label={subtitle.name}
                            default
                          />
                        )}
                      </video>
                      {casting && (
                        <div className="casting-overlay">
                          <span className="cast-rings">
                            <Cast size={42} />
                          </span>
                          <h2>{state.cast.device.name}에서 재생 중</h2>
                          <p>이 화면에서 재생과 자막을 조절할 수 있어요.</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="empty-stage">
                      <div className="orbital orbital-one" />
                      <div className="orbital orbital-two" />
                      <div className="cinema-art">
                        <div className="art-screen">
                          <div className="art-sun" />
                          <div className="art-mountain back" />
                          <div className="art-mountain front" />
                          <div className="art-play">
                            <Play size={24} fill="currentColor" />
                          </div>
                        </div>
                        <div className="art-foot" />
                        <span className="art-cast">
                          <Cast size={25} />
                        </span>
                        <span className="art-spark spark-one">+</span>
                        <span className="art-spark spark-two">+</span>
                      </div>
                      <h2>오늘의 감상, 여기서 시작.</h2>
                      <p>영상 파일을 끌어 놓거나 선택해 주세요.</p>
                      <button
                        className="button lime"
                        onClick={openPicker}
                        disabled={!!upload}
                      >
                        <FolderOpen size={17} />
                        영상 선택하기
                        <ArrowRight size={16} />
                      </button>
                      <span className="stage-support">
                        MP4 · MKV · WEBM · MOV & MORE
                      </span>
                    </div>
                  )}
                </div>
                <div className="playback-controls">
                  <div className="timeline">
                    <input
                      aria-label="재생 위치"
                      type="range"
                      min="0"
                      max={length || 1}
                      step="0.1"
                      value={Math.min(position, length || 1)}
                      disabled={!length || !!busy}
                      onChange={(e) => seek(Number(e.target.value))}
                      style={{
                        "--progress": `${length ? (position / length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="control-row">
                    <div className="control-left">
                      <IconButton
                        label="10초 뒤로"
                        disabled={!selected || !!busy}
                        onClick={() => seek(position - 10)}
                      >
                        <SkipBack size={18} />
                      </IconButton>
                      <button
                        className="play-button"
                        aria-label={activePlaying ? "일시정지" : "재생"}
                        onClick={togglePlay}
                        disabled={!!busy}
                      >
                        {activePlaying ? (
                          <Pause size={19} fill="currentColor" />
                        ) : (
                          <Play size={19} fill="currentColor" />
                        )}
                      </button>
                      <IconButton
                        label="10초 앞으로"
                        disabled={!selected || !!busy}
                        onClick={() => seek(position + 10)}
                      >
                        <SkipForward size={18} />
                      </IconButton>
                      <span className="timecode">
                        {time(position)} <span>/ {time(length)}</span>
                      </span>
                    </div>
                    <div className="control-right">
                      <IconButton
                        label="음량 미세 조절"
                        onClick={() => setModal("volume")}
                      >
                        <Volume2 size={18} />
                      </IconButton>
                      <span className="volume-value">
                        {Math.round(volume * 100)}%
                      </span>
                      <IconButton
                        label="자막 설정"
                        onClick={() => setModal("subtitles")}
                      >
                        <Subtitles size={19} />
                      </IconButton>
                      <IconButton
                        label="TV 연결"
                        onClick={() => setModal("cast")}
                      >
                        <Cast
                          size={19}
                          className={state.cast.connected ? "lime-text" : ""}
                        />
                      </IconButton>
                      <span className="control-divider" />
                      <IconButton
                        label="전체 화면"
                        disabled={!selected || casting}
                        onClick={() =>
                          video.current
                            ?.requestFullscreen()
                            .catch(() =>
                              message("전체 화면을 사용할 수 없습니다.", true),
                            )
                        }
                      >
                        <Maximize size={18} />
                      </IconButton>
                    </div>
                  </div>
                </div>
              </div>
              <div className="now-playing">
                <div className="file-icon">
                  <FileVideo size={20} />
                </div>
                <div>
                  <strong>
                    {selected?.name || "아직 선택한 영상이 없어요"}
                  </strong>
                  <span>
                    {selected
                      ? `${size(selected.size)} · ${casting ? "TV에서 재생" : "이 PC에서 재생"}`
                      : "파일을 열고 나만의 영화관을 완성하세요."}
                  </span>
                </div>
                {selected && (
                  <IconButton
                    label="영상 옵션"
                    onClick={() => setModal("media")}
                  >
                    <MoreHorizontal size={22} />
                  </IconButton>
                )}
                {!selected && (
                  <span className="local-pill">
                    <HardDrive size={12} />
                    LOCAL FILE
                  </span>
                )}
              </div>
            </section>
            <aside className="settings-column">
              <section className="setting-card connection-card">
                <div className="card-title">
                  <span className="section-icon">
                    <Cast size={20} />
                  </span>
                  <h2>큰 화면으로 즐기기</h2>
                  <span className="tiny-tag">CAST</span>
                </div>
                <div className="device-illustration">
                  <div className="mini-laptop">
                    <Laptop size={42} strokeWidth={1.4} />
                  </div>
                  <div className="signal-path">
                    <i />
                    <i />
                    <i />
                    <ChevronRight size={13} />
                  </div>
                  <div className="mini-tv">
                    <Tv size={52} strokeWidth={1.3} />
                    <span>
                      <Wifi size={12} />
                    </span>
                  </div>
                </div>
                <div className="connection-copy">
                  <strong>
                    {state.cast.connected
                      ? state.cast.device.name
                      : "거실이 영화관이 되는 순간"}
                  </strong>
                  <p>
                    {state.cast.connected ? (
                      "연결 완료 · TV로 영상을 보내 보세요."
                    ) : (
                      <>
                        같은 Wi-Fi에 연결된 TV로
                        <br />
                        영상과 자막을 함께 보내세요.
                      </>
                    )}
                  </p>
                </div>
                <button
                  className="button dark wide"
                  disabled={!!busy}
                  onClick={() =>
                    state.cast.connected && selected
                      ? sendToTv()
                      : setModal("cast")
                  }
                >
                  <Cast size={17} />
                  {busy.startsWith("TV")
                    ? busy
                    : state.cast.connected && selected
                      ? "이 영상을 TV에서 재생"
                      : state.cast.connected
                        ? "연결된 TV 관리"
                        : "TV 연결하기"}
                  <ArrowRight size={15} />
                </button>
                <div className="connection-foot">
                  <span
                    className={state.cast.connected ? "green-dot" : "gray-dot"}
                  />
                  {state.cast.connected
                    ? "Google Cast 연결됨"
                    : "Chromecast · Google Cast 지원"}
                </div>
              </section>
              <section className="setting-card subtitle-card">
                <div className="card-title">
                  <span className="section-icon">
                    <Subtitles size={20} />
                  </span>
                  <h2>자막도 함께</h2>
                  <button
                    className={`switch ${subtitle && subtitleOn ? "on" : ""}`}
                    role="switch"
                    aria-checked={!!subtitle && subtitleOn}
                    aria-label="자막 표시"
                    disabled={!subtitle || !!busy}
                    onClick={() => changeSubtitle(!subtitleOn)}
                  >
                    <span />
                  </button>
                </div>
                <p>놓치는 대사 없이, 원하는 언어로.</p>
                <button
                  className="subtitle-upload"
                  onClick={() => setModal("subtitles")}
                >
                  <span>
                    <Subtitles size={18} />
                    {subtitle ? subtitle.name : "자막 파일 추가"}
                  </span>
                  <Plus size={16} />
                </button>
                <div className="subtitle-foot">
                  <span>SRT · VTT 지원</span>
                  <span>
                    <Check size={12} />
                    TV 동시 전송
                  </span>
                </div>
              </section>
              <div className="private-note">
                <span>
                  <HardDrive size={16} />
                </span>
                <p>
                  기록 없이, 이번 감상만.
                  <br />
                  <strong>종료 시 목록과 임시 복사본 삭제.</strong>
                </p>
              </div>
            </aside>
          </div>
          <section className="library" ref={library}>
            <div className="library-header">
              <div>
                <h2>
                  이번 재생 목록{" "}
                  <span>{media.length.toString().padStart(2, "0")}</span>
                </h2>
                <p>재생 기록은 저장하지 않습니다.</p>
              </div>
              <button
                className="text-button"
                disabled={!!upload}
                onClick={openPicker}
              >
                <Plus size={15} />
                파일 추가
              </button>
            </div>
            <div className="library-toolbar">
              <div className="filters">
                <button
                  className={filter === "all" ? "selected" : ""}
                  onClick={() => setFilter("all")}
                >
                  전체
                </button>
                <button
                  className={filter === "video" ? "selected" : ""}
                  onClick={() => setFilter("video")}
                >
                  영상
                </button>
                <button
                  className={filter === "audio" ? "selected" : ""}
                  onClick={() => setFilter("audio")}
                >
                  음악
                </button>
              </div>
              <span>최근 추가순</span>
            </div>
            {media.length === 0 ? (
              <button
                className="library-empty"
                disabled={!!upload}
                onClick={openPicker}
              >
                <span className="empty-folder">
                  <FolderOpen size={26} strokeWidth={1.4} />
                </span>
                <span>
                  <strong>첫 번째 영상을 추가해 보세요</strong>
                  <span>같은 이름의 자막을 함께 놓으면 자동 연결됩니다.</span>
                </span>
                <span className="round-plus">
                  <Plus size={19} />
                </span>
              </button>
            ) : (
              <div className="media-list">
                {media
                  .filter(
                    (i) => filter === "all" || i.contentType.startsWith(filter),
                  )
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((item, index) => (
                    <div
                      className={`media-row ${selectedId === item.id ? "chosen" : ""}`}
                      key={item.id}
                    >
                      <button
                        className="media-select"
                        onClick={() => choose(item)}
                      >
                        <span className={`media-thumb hue-${index % 3}`}>
                          <Play size={19} fill="currentColor" />
                        </span>
                        <span className="media-info">
                          <strong>{item.name}</strong>
                          <span>
                            {size(item.size)} ·{" "}
                            {item.needsConversion
                              ? "TV 호환 변환 권장"
                              : item.contentType.split("/")[1].toUpperCase()}
                          </span>
                        </span>
                        {selectedId === item.id && (
                          <span className="selected-label">선택됨</span>
                        )}
                      </button>
                      <IconButton
                        label={`${item.name} 라이브러리에서 삭제`}
                        disabled={!!busy}
                        onClick={() =>
                          run("파일 삭제", async () => {
                            await api(`items/${item.id}`, null, "DELETE");
                            if (selectedId === item.id) {
                              setSelectedId(null);
                              setPlaying(false);
                              setDuration(0);
                              setCurrent(0);
                            }
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  ))}
                {!media.some(
                  (i) => filter === "all" || i.contentType.startsWith(filter),
                ) && (
                  <p className="filter-empty">이 종류의 파일이 아직 없어요.</p>
                )}
              </div>
            )}
          </section>
          <footer>
            <span>
              <span className="footer-dot" />
              MADE FOR YOUR MOMENTS.
            </span>
            <span>내 파일. 내 자막. 내 영화관.</span>
          </footer>
        </div>
      </main>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".mp4,.m4v,.webm,.mkv,.avi,.mov,.mp3,.m4a,.ogg,.wav,.srt,.vtt"
        hidden
        onChange={(e) => {
          openFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={subtitleInput}
        type="file"
        accept=".srt,.vtt"
        hidden
        onChange={(e) => {
          openFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {drag && (
        <div
          className="drop-overlay"
          onDragLeave={() => setDrag(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            openFiles(e.dataTransfer.files);
          }}
        >
          <Upload size={48} />
          <h2>여기에 놓으면 준비 끝.</h2>
          <p>영상과 자막을 함께 놓아도 좋아요.</p>
        </div>
      )}
      {upload && (
        <div className="upload-status" role="status">
          <LoaderCircle size={20} className="spin" />
          <div>
            <strong>PC에 임시 파일 준비 중 · {upload.percent}%</strong>
            <span>{upload.name}</span>
            <progress value={upload.percent} max="100" />
          </div>
        </div>
      )}
      {toast &&
        createPortal(
          <div
            className={`toast ${toast.error ? "error" : ""}`}
            role={toast.error ? "alert" : "status"}
          >
            {toast.error ? (
              <CircleHelp size={19} />
            ) : (
              <CheckCircle2 size={19} />
            )}
            <span>{toast.text}</span>
            <IconButton label="알림 닫기" onClick={() => setToast(null)}>
              <X size={16} />
            </IconButton>
          </div>,
          modal && dialog.current ? dialog.current : document.body,
        )}
      <dialog
        ref={dialog}
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setModal(null);
        }}
        aria-labelledby="dialog-title"
      >
        <div className="dialog-inner">
          <div className="dialog-heading">
            <span className="dialog-icon">
              {modal === "cast" ? (
                <Cast />
              ) : modal === "subtitles" ? (
                <Subtitles />
              ) : modal === "media" ? (
                <SlidersHorizontal />
              ) : (
                <Wifi />
              )}
            </span>
            <IconButton label="닫기" onClick={() => setModal(null)}>
              <X size={21} />
            </IconButton>
          </div>
          {modal === "cast" && state.mode !== "offline" && (
            <>
              <div className="eyebrow">A BIGGER PICTURE</div>
              <h2 id="dialog-title">어디에서 감상할까요?</h2>
              <p className="dialog-description">
                PC와 TV를 같은 Wi-Fi 또는 공유기에 연결해 주세요.
              </p>
              {state.cast.connected && (
                <div className="connected-box">
                  <CheckCircle2 size={21} />
                  <div>
                    <strong>{state.cast.device.name}</strong>
                    <span>현재 연결됨 · {state.cast.device.address}</span>
                  </div>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() =>
                      run("연결 종료", () =>
                        api("cast/control", { action: "disconnect" }),
                      )
                    }
                  >
                    재생 종료
                  </button>
                </div>
              )}
              <div className="devices-heading">
                <span>
                  사용 가능한 기기 <b>{state.devices.length}</b>
                </span>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() =>
                    run("검색 중", async () => {
                      await api("scan");
                      message(
                        "주변 Chromecast를 검색합니다. 잠시 후 목록이 갱신됩니다.",
                      );
                    })
                  }
                >
                  <RefreshCw
                    size={14}
                    className={busy === "검색 중" ? "spin" : ""}
                  />
                  다시 검색
                </button>
              </div>
              <div className="devices-list">
                {state.devices.map((device) => (
                  <button
                    key={device.id}
                    className="device-option"
                    disabled={!!busy}
                    onClick={() => sendToTv(device)}
                  >
                    <Tv size={28} />
                    <span>
                      <strong>{device.name}</strong>
                      <span>
                        {device.model} · {device.address}
                      </span>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                ))}
                {state.devices.length === 0 && (
                  <div className="no-devices">
                    <Radio size={29} />
                    <strong>아직 발견된 TV가 없어요</strong>
                    <p>
                      TV를 켜고 Google Cast 지원 여부를 확인해 주세요.
                      <br />
                      기기 목록은 자동으로 갱신됩니다.
                    </p>
                  </div>
                )}
              </div>
              {state.discoveryError && (
                <p className="inline-error">
                  기기 검색 오류: {state.discoveryError}
                </p>
              )}
              <details className="manual-connect">
                <summary>TV IP 주소로 직접 연결</summary>
                <p>TV 설정 → 네트워크에서 IPv4 주소를 확인하세요.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendToTv({ address: ip.trim() });
                  }}
                >
                  <input
                    aria-label="TV IP 주소"
                    placeholder="192.168.0.20"
                    value={ip}
                    onChange={(e) => setIp(e.target.value)}
                    required
                  />
                  <button className="button dark" disabled={!!busy || !ip}>
                    연결
                  </button>
                </form>
              </details>
              {busy && (
                <p className="busy-line">
                  <LoaderCircle size={15} className="spin" />
                  {busy}…
                </p>
              )}
              <div className="dialog-tip">
                <CircleHelp size={17} />
                <p>
                  Chromecast 내장 TV 또는 별도 Chromecast가 필요해요. 기기가 안
                  보이면{" "}
                  <button onClick={() => setModal("help")}>연결 가이드</button>
                  를 확인하세요.
                </p>
              </div>
            </>
          )}
          {modal === "volume" && (
            <>
              <div className="eyebrow">JUST THE RIGHT VOLUME</div>
              <h2 id="dialog-title">음량 미세 조절</h2>
              <p className="dialog-description">
                {casting ? "TV" : "이 PC"} 음량을 1% 단위로 조절합니다.
              </p>
              <div className="fine-volume">
                <button
                  className="button"
                  aria-label="음량 1% 줄이기"
                  onClick={() => adjustVolume(volumeRef.current - 0.01)}
                >
                  <Minus />
                </button>
                <label>
                  <input
                    aria-label="음량 퍼센트"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(volume * 100)}
                    onChange={(e) => adjustVolume(Number(e.target.value) / 100)}
                  />
                  <span>%</span>
                </label>
                <button
                  className="button"
                  aria-label="음량 1% 높이기"
                  onClick={() => adjustVolume(volumeRef.current + 0.01)}
                >
                  <Plus />
                </button>
              </div>
              <input
                className="fine-volume-range"
                aria-label="음량 슬라이더"
                type="range"
                min="0"
                max="1"
                step=".01"
                value={volume}
                onChange={(e) => adjustVolume(Number(e.target.value))}
              />
              <button
                className="button dark wide"
                onClick={() =>
                  adjustVolume(volumeRef.current > 0 ? 0 : lastAudible.current)
                }
              >
                {volume > 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}{" "}
                {volume > 0 ? "음소거" : "음소거 해제"}
              </button>
              <p className="small-note">
                TV 기종에 따라 실제 음량 단계가 반올림될 수 있습니다.
              </p>
            </>
          )}
          {modal === "privacy" && (
            <>
              <div className="eyebrow">YOUR FILES STAY YOURS</div>
              <h2 id="dialog-title">기록 없는 재생</h2>
              <p className="dialog-description">
                파일명과 재생 목록은 실행 중인 메모리에만 유지합니다.
              </p>
              <div className="privacy-details">
                <p>
                  <strong>파일 열기</strong>원본 파일을 직접 읽습니다. 원본은
                  수정하거나 삭제하지 않습니다.
                </p>
                <p>
                  <strong>끌어 놓기·호환 변환</strong>PC에 임시 복사본이
                  생깁니다. 세션 비우기·서버 정상 종료 때 삭제하며, PC의 모든 앱
                  탭을 닫으면 약 30초 뒤 TV 재생도 종료하고 정리합니다.
                </p>
                <p>
                  <strong>앱 밖의 기록</strong>브라우저 방문 기록, 운영체제·보안
                  프로그램·TV가 남기는 기록과 삭제된 데이터의 복구 가능성까지
                  없애는 기능은 아닙니다.
                </p>
              </div>
              <button
                className="button dark wide"
                disabled={!!upload || !!busy}
                onClick={() =>
                  run("세션 비우기", async () => {
                    video.current?.pause();
                    await api("privacy/clear");
                    setSelectedId(null);
                    setSubtitleId("");
                    setPlaying(false);
                    setCurrent(0);
                    setDuration(0);
                    setModal(null);
                    message("재생 목록과 임시 복사본을 삭제했습니다.");
                  })
                }
              >
                <Trash2 size={17} />
                재생 종료·임시 파일 삭제
              </button>
            </>
          )}
          {modal === "cast" && state.mode === "offline" && (
            <>
              <div className="eyebrow">NO INTERNET NEEDED</div>
              <h2 id="dialog-title">오프라인 TV 연결</h2>
              <p className="dialog-description">
                TV와 PC를 같은 공유기에 연결하고 TV 웹브라우저에서 아래 주소를
                여세요. 인터넷은 사용하지 않습니다.
              </p>
              <div className="offline-addresses">
                {state.network.map((n) => (
                  <p key={n.address}>
                    <span>{n.name}</span>
                    <strong>
                      http://{n.address}:{state.port}/tv
                    </strong>
                  </p>
                ))}
              </div>
              <div className="pairing-pin">
                <span>TV에 입력할 연결 번호</span>
                <strong>{state.pairingCode}</strong>
              </div>
              {state.cast.connected ? (
                <div className="connected-box">
                  <CheckCircle2 size={20} />
                  <strong>TV 브라우저 연결됨</strong>
                </div>
              ) : (
                <p className="small-note">
                  TV 웹브라우저가 필요합니다. 번호는 5분마다 바뀝니다.
                </p>
              )}
              {state.cast.connected && selected && (
                <button
                  className="button dark wide"
                  disabled={!!busy}
                  onClick={() => sendToTv()}
                >
                  이 영상을 TV에서 재생
                  <ArrowRight size={17} />
                </button>
              )}
            </>
          )}
          {modal === "subtitles" && (
            <>
              <div className="eyebrow">EVERY WORD MATTERS</div>
              <h2 id="dialog-title">자막, 딱 맞게.</h2>
              <p className="dialog-description">
                SRT와 VTT를 지원해요. 한글 인코딩은 자동으로 처리합니다.
              </p>
              <button
                className="subtitle-drop"
                disabled={!!upload}
                onClick={() => subtitleInput.current.click()}
              >
                <Upload size={24} />
                <strong>자막 파일 선택</strong>
                <span>SRT · VTT / 최대 10MB</span>
              </button>
              <label className="field-label" htmlFor="subtitle-select">
                현재 자막
              </label>
              <select
                id="subtitle-select"
                value={subtitleId}
                onChange={(e) => {
                  setSubtitleId(e.target.value);
                  setSubtitleOn(true);
                }}
              >
                <option value="">자막 없음</option>
                {subtitles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div className="offset-setting">
                <div>
                  <strong>자막 싱크 조절</strong>
                  <p>+ 값은 자막을 더 늦게 표시해요.</p>
                </div>
                <div className="offset-input">
                  <input
                    type="number"
                    aria-label="자막 시간 보정 (초)"
                    min="-600"
                    max="600"
                    step="0.5"
                    value={offset}
                    onChange={(e) =>
                      setOffset(
                        Math.max(
                          -600,
                          Math.min(600, Number(e.target.value) || 0),
                        ),
                      )
                    }
                  />
                  <span>초</span>
                </div>
              </div>
              <button
                className="button dark wide"
                disabled={!!busy}
                onClick={() =>
                  casting
                    ? run("자막 적용", async () => {
                        await api("cast/load", {
                          itemId: selectedId,
                          subtitleId,
                          offset,
                          subtitlesEnabled: subtitleOn,
                          currentTime: position,
                          autoplay: remotePlaying,
                        });
                        message("TV에 자막 설정을 적용했습니다.");
                        setModal(null);
                      })
                    : setModal(null)
                }
              >
                <Check size={17} />
                {casting ? "TV에 적용" : "적용하기"}
              </button>
              <p className="small-note">
                TV에 새 자막을 적용하면 현재 위치에서 영상을 다시 불러옵니다.
              </p>
            </>
          )}
          {modal === "media" && selected && (
            <>
              <div className="eyebrow">READY FOR THE BIG SCREEN</div>
              <h2 id="dialog-title">영상 옵션</h2>
              <p className="dialog-description wrap">{selected.name}</p>
              <div className="conversion-info">
                <MonitorPlay size={30} />
                <strong>TV 호환 MP4로 변환</strong>
                <p>
                  재생이 안 되거나 소리가 나지 않을 때 사용하세요. H.264 영상과
                  AAC 오디오, 최대 1080p로 새 파일을 만듭니다. 원본은
                  유지됩니다.
                </p>
              </div>
              {state.jobs
                .filter((j) => j.itemId === selected.id)
                .map((j) => (
                  <div className={`job-status ${j.status}`} key={j.id}>
                    {j.status === "running" ? (
                      <>
                        <LoaderCircle size={17} className="spin" />
                        변환 중 · 영상 {time(j.seconds)} 처리됨
                      </>
                    ) : j.status === "done" ? (
                      <>
                        <CheckCircle2 size={17} />
                        변환 완료
                        <button
                          className="text-button"
                          onClick={() => {
                            const item = state.items.find(
                              (i) => i.id === j.resultId,
                            );
                            if (item) choose(item);
                            setModal(null);
                          }}
                        >
                          파일 선택
                        </button>
                      </>
                    ) : (
                      j.error
                    )}
                  </div>
                ))}
              <button
                className="button dark wide"
                disabled={
                  !!busy ||
                  !state.ffmpegAvailable ||
                  state.jobs.some((j) => j.status === "running")
                }
                onClick={() =>
                  run("변환 시작", async () => {
                    await api(`convert/${selected.id}`);
                    message(
                      "TV 호환 변환을 시작했습니다. 완료하면 라이브러리에 추가됩니다.",
                    );
                  })
                }
              >
                <RefreshCw size={17} />
                호환 파일 만들기
              </button>
              {!state.ffmpegAvailable && (
                <p className="inline-error">
                  FFmpeg 설치 후 앱을 다시 실행해야 변환할 수 있습니다.
                </p>
              )}
              <p className="small-note">
                영상 길이에 따라 시간이 걸리고 추가 저장 공간이 필요해요.
              </p>
            </>
          )}
          {modal === "help" && (
            <>
              <div className="eyebrow">FROM HERE TO YOUR TV</div>
              <h2 id="dialog-title">세 단계면, 큰 화면.</h2>
              <p className="dialog-description">
                PC는 켜 둔 채로, 재생은 TV에서 즐기세요.
              </p>
              <div className="help-steps">
                <div>
                  <span>01</span>
                  <section>
                    <h3>같은 네트워크에 연결</h3>
                    <p>
                      PC와 Chromecast 지원 TV를 같은 공유기에 연결하세요. PC의
                      유선 LAN 연결도 괜찮아요.
                    </p>
                  </section>
                </div>
                <div>
                  <span>02</span>
                  <section>
                    <h3>영상과 자막 열기</h3>
                    <p>
                      영상 파일을 선택하고 SRT 또는 VTT 자막을 추가하세요. 파일
                      이름이 같으면 기존 자막을 자동 선택해요.
                    </p>
                  </section>
                </div>
                <div>
                  <span>03</span>
                  <section>
                    <h3>TV 선택하고 재생</h3>
                    <p>
                      ‘TV 연결하기’에서 기기를 선택하세요.
                      재생·일시정지·탐색·볼륨을 이 화면에서 조절합니다.
                    </p>
                  </section>
                </div>
              </div>
              <details className="help-details">
                <summary>TV가 안 보이거나 영상이 재생되지 않아요</summary>
                <ul>
                  <li>
                    TV가 Google Cast를 지원하는지 확인하세요. Miracast와 AirPlay
                    전용 TV는 연결되지 않습니다.
                  </li>
                  <li>
                    공유기의 게스트 Wi-Fi와 AP 격리를 끄고 VPN 연결을
                    해제하세요.
                  </li>
                  <li>
                    Windows 방화벽에서 Node.js의 개인 네트워크 통신을
                    허용하세요. 영상 전송은 TCP {3210}, 자동 검색은 UDP 5353을
                    사용합니다. TV 제어에는 TCP 8009 연결이 필요합니다.
                  </li>
                  <li>자동 검색이 안 되면 TV의 IP 주소로 직접 연결하세요.</li>
                  <li>
                    화면이나 소리가 안 나오면 영상 옵션에서 TV 호환 MP4 변환을
                    사용하세요. DRM 영상과 내장 자막 추출은 지원하지 않습니다.
                  </li>
                  <li>재생 중에는 PC를 켜 두고 앱 서버를 종료하지 마세요.</li>
                </ul>
              </details>
              <div className="network-info">
                <Wifi size={17} />
                <div>
                  <strong>이 PC의 네트워크</strong>
                  {state.network.length ? (
                    state.network.map((n) => (
                      <span key={n.address}>
                        {n.name} · {n.address}
                      </span>
                    ))
                  ) : (
                    <span>사용 가능한 사설 IPv4 네트워크가 없습니다.</span>
                  )}
                </div>
              </div>
              <button
                className="button dark wide"
                onClick={() => setModal("cast")}
              >
                TV 연결하러 가기
                <ArrowRight size={17} />
              </button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
