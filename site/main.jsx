import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Play,
  Cast,
  FolderOpen,
  Subtitles,
  ShieldCheck,
  ArrowRight,
  Download,
  Wifi,
  WifiOff,
  Minus,
  Plus,
  VolumeX,
  Volume2,
  X,
  Link as LinkIcon,
  Github,
  Trash2,
  Pause,
} from "lucide-react";
import "@fontsource-variable/manrope";
import "@fontsource-variable/noto-sans-kr";
import "./style.css";
import { mediaStem } from "../shared/media.js";
import { Companion } from "./companion.js";

let sdkPromise;
function castSdk() {
  if (window.cast?.framework)
    return Promise.resolve(window.cast.framework.CastContext.getInstance());
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sdkPromise = null;
      reject(new Error("Chrome 데스크톱과 인터넷 연결을 확인해 주세요."));
    }, 15000);
    window.__onGCastApiAvailable = (available) => {
      clearTimeout(timer);
      if (!available) {
        sdkPromise = null;
        reject(new Error("이 브라우저에서는 Chromecast를 사용할 수 없습니다."));
        return;
      }
      const context = window.cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED,
      });
      resolve(context);
    };
    const script = document.createElement("script");
    script.src =
      "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
    script.onerror = () => {
      clearTimeout(timer);
      sdkPromise = null;
      reject(new Error("Google Cast를 불러올 수 없습니다."));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}
function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("인증 정보가 없는 HTTPS 영상 주소를 입력해 주세요.");
  return url.href;
}
async function subtitleVtt(file) {
  const bytes = await file.arrayBuffer();
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("euc-kr").decode(bytes);
  }
  text = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  if (!text.includes("-->"))
    throw new Error("시간 정보가 있는 SRT 또는 VTT 자막을 선택해 주세요.");
  return /^WEBVTT/.test(text) ? text : "WEBVTT\n\n" + text;
}

function App() {
  const video = useRef(),
    files = useRef(),
    folder = useRef(),
    owned = useRef([]),
    selectedFile = useRef(null),
    subFiles = useRef([]),
    session = useRef(null),
    remote = useRef(null),
    volumeRef = useRef(0.7),
    volumeQueue = useRef(null),
    volumeBusy = useRef(false);
  const companion = useRef(null),
    uploaded = useRef(new Map()),
    bridgeCasting = useRef(false),
    bridgeState = useRef(null);
  const [item, setItem] = useState(null),
    [caption, setCaption] = useState(null),
    [subOn, setSubOn] = useState(true),
    [volume, setVolume] = useState(0.7),
    [url, setUrl] = useState(""),
    [subUrl, setSubUrl] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(""),
    [tab, setTab] = useState("local"),
    [privacy, setPrivacy] = useState(false),
    [showAddress, setShowAddress] = useState(false),
    [paused, setPaused] = useState(false),
    [tvDialog, setTvDialog] = useState(false),
    [pcReady, setPcReady] = useState(false),
    [devices, setDevices] = useState([]),
    [tvAddress, setTvAddress] = useState(""),
    [progress, setProgress] = useState(""),
    [mediaType, setMediaType] = useState("video/mp4");
  if (!companion.current)
    companion.current = new Companion(() => {
      setPcReady(false);
      uploaded.current.clear();
      if (bridgeCasting.current) {
        setConnected("");
        bridgeCasting.current = false;
        setNotice("PC 연결 창이 닫혔습니다. TV 연결을 다시 열어 주세요.");
      }
    });
  useEffect(() => {
    if (!pcReady) return;
    let cancelled = false,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const state = await companion.current.request("state");
        if (cancelled) return;
        bridgeState.current = state.cast;
        setDevices(state.devices);
        if (bridgeCasting.current) {
          setConnected(
            state.cast.connected ? state.cast.device?.name || "내 TV" : "",
          );
          setPaused(state.cast.playerState === "PAUSED");
          if (!volumeBusy.current && typeof state.cast.volume === "number") {
            setVolume(state.cast.volume);
            volumeRef.current = state.cast.volume;
          }
          if (!state.cast.connected) bridgeCasting.current = false;
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        polling = false;
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pcReady]);
  useEffect(() => {
    if (video.current) video.current.volume = volume;
  }, [volume, item]);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const apply = () => {
      for (const t of el.textTracks) t.mode = subOn ? "showing" : "hidden";
    };
    apply();
    el.textTracks.addEventListener("addtrack", apply);
    return () => el.textTracks.removeEventListener("addtrack", apply);
  }, [caption, subOn, item]);
  useEffect(() => {
    if (!privacy && !tvDialog) return;
    const previous = document.activeElement;
    const modal = document.querySelector('[role="dialog"]');
    const focusable = () =>
      [...modal.querySelectorAll("button,a,input")].filter(
        (el) => !el.disabled,
      );
    focusable()[0]?.focus();
    const key = (e) => {
      if (e.key === "Escape") {
        setPrivacy(false);
        setTvDialog(false);
      }
      if (e.key === "Tab") {
        const elements = focusable(),
          first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    modal.addEventListener("keydown", key);
    return () => {
      modal.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [privacy, tvDialog]);
  useEffect(() => {
    const clear = () => {
      for (const value of owned.current) URL.revokeObjectURL(value);
    };
    window.addEventListener("pagehide", clear);
    return () => {
      clear();
      window.removeEventListener("pagehide", clear);
    };
  }, []);
  function objectUrl(blob) {
    const value = URL.createObjectURL(blob);
    owned.current.push(value);
    return value;
  }
  async function attachSubtitle(file) {
    if (file.size > 10 * 1024 ** 2)
      throw new Error("자막은 10MB 이하만 지원합니다.");
    setCaption({
      name: file.name,
      file,
      url: objectUrl(new Blob([await subtitleVtt(file)], { type: "text/vtt" })),
    });
    setSubOn(true);
  }
  async function openFiles(list) {
    if (busy) {
      setError("TV 연결 또는 파일 준비가 끝난 뒤 다른 파일을 열어 주세요.");
      return;
    }
    setError("");
    try {
      const all = [...list];
      const media = all.find((f) =>
        /\.(mp4|m4v|webm|mkv|mov|mp3|m4a|ogg|wav)$/i.test(f.name),
      );
      subFiles.current = [
        ...subFiles.current,
        ...all.filter((f) => /\.(srt|vtt)$/i.test(f.name)),
      ];
      if (media) {
        await endCurrentCast();
        selectedFile.current = media;
        setItem({ name: media.name, url: objectUrl(media), local: true });
        setCaption(null);
        setTab("local");
      }
      const active = media || selectedFile.current;
      const match =
        active &&
        subFiles.current.findLast(
          (f) => mediaStem(f.name) === mediaStem(active.name),
        );
      if (match) {
        await attachSubtitle(match);
        setNotice("같은 이름의 자막을 자동으로 연결했습니다.");
      } else if (
        !media &&
        all.length === 1 &&
        /\.(srt|vtt)$/i.test(all[0].name)
      )
        await attachSubtitle(all[0]);
    } catch (e) {
      setError(e.message);
    }
  }
  async function endCurrentCast() {
    if (bridgeCasting.current)
      await companion.current.request("control", { action: "disconnect" });
    bridgeCasting.current = false;
    session.current?.endSession(true);
    session.current = null;
    remote.current = null;
    setConnected("");
  }
  async function loadUrl(e) {
    e.preventDefault();
    if (busy) {
      setError("TV 연결 또는 파일 준비가 끝난 뒤 주소를 열어 주세요.");
      return;
    }
    try {
      const address = httpsUrl(url),
        subtitle = subUrl ? httpsUrl(subUrl) : null;
      await endCurrentCast();
      setItem({ name: "인터넷 영상", url: address, local: false });
      setCaption(subtitle ? { name: "인터넷 자막", url: subtitle } : null);
      setSubOn(true);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function castVideo() {
    if (busy) return;
    if (!item) {
      setError("먼저 영상 파일이나 인터넷 영상 주소를 선택해 주세요.");
      return;
    }
    if (item.local) {
      setTvDialog(true);
      setBusy(true);
      setError("");
      setProgress("PC 연결 창에서 ‘웹 플레이어 연결’을 눌러 주세요.");
      try {
        await companion.current.connect();
        setPcReady(true);
        await companion.current.request("scan");
        const state = await companion.current.request("state");
        if (state.mode !== "internet")
          throw new Error("Chromecast는 KPLAYER.vbs로 실행해 주세요.");
        setDevices(state.devices);
        setProgress("같은 Wi-Fi에 연결된 TV를 선택해 주세요.");
      } catch (e) {
        setError(e.message);
        setProgress(e.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError("");
    try {
      const context = await castSdk();
      await context.requestSession();
      const castSession = context.getCurrentSession();
      const media = new chrome.cast.media.MediaInfo(item.url, mediaType);
      media.metadata = new chrome.cast.media.GenericMediaMetadata();
      media.metadata.title = "KPLAYER";
      if (caption) {
        const track = new chrome.cast.media.Track(
          1,
          chrome.cast.media.TrackType.TEXT,
        );
        track.trackContentId = caption.url;
        track.trackContentType = "text/vtt";
        track.subtype = chrome.cast.media.TextTrackType.SUBTITLES;
        track.name = "자막";
        track.language = "ko";
        media.tracks = [track];
      }
      const request = new chrome.cast.media.LoadRequest(media);
      request.currentTime = video.current?.currentTime || 0;
      request.activeTrackIds = caption && subOn ? [1] : [];
      await castSession.loadMedia(request);
      session.current = castSession;
      remote.current = castSession.getMediaSession();
      setConnected(castSession.getCastDevice().friendlyName);
      setVolume(castSession.getVolume());
      volumeRef.current = castSession.getVolume();
      video.current?.pause();
      setPaused(false);
      const changed = () => {
        const current = castSession.getMediaSession();
        remote.current = current;
        if (current) setPaused(current.playerState === "PAUSED");
      };
      remote.current?.addUpdateListener(changed);
      context.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        () => {
          if (!context.getCurrentSession()) {
            session.current = null;
            remote.current = null;
            setConnected("");
          }
        },
      );
    } catch (e) {
      setError(
        e.message || "TV 연결이 취소되었거나 영상에 접근하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function prepareFile(file) {
    if (!uploaded.current.has(file)) {
      setProgress(
        /\.(srt|vtt)$/i.test(file.name)
          ? "자막을 PC에 연결하고 있습니다…"
          : "영상을 내 PC에 준비하고 있습니다. 큰 파일은 잠시 걸릴 수 있습니다…",
      );
      uploaded.current.set(
        file,
        await companion.current.request("upload", file),
      );
    }
    return uploaded.current.get(file);
  }
  async function loadOnTv(
    address,
    currentTime = video.current?.currentTime || 0,
    autoplay = true,
  ) {
    setBusy(true);
    setError("");
    try {
      const media = await prepareFile(selectedFile.current);
      const subtitle = caption?.file ? await prepareFile(caption.file) : null;
      if (address) {
        setProgress("TV에 연결하고 있습니다…");
        await companion.current.request("connect", { address });
      }
      setProgress("TV에서 영상과 자막을 열고 있습니다…");
      const state = await companion.current.request("load", {
        itemId: media.id,
        subtitleId: subtitle?.id || null,
        currentTime,
        subtitlesEnabled: subOn,
        autoplay,
      });
      bridgeCasting.current = true;
      bridgeState.current = state;
      setConnected(state.device?.name || "내 TV");
      setPaused(state.playerState === "PAUSED");
      if (typeof state.volume === "number") {
        setVolume(state.volume);
        volumeRef.current = state.volume;
      }
      video.current?.pause();
      setTvDialog(false);
      setNotice("내 PC를 통해 TV에서 재생합니다. PC 연결 창을 열어 두세요.");
    } catch (e) {
      setError(e.message);
      setProgress(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (caption?.file && bridgeCasting.current)
      loadOnTv(
        null,
        bridgeState.current?.currentTime || 0,
        bridgeState.current?.playerState !== "PAUSED",
      );
  }, [caption]);
  async function adjust(value) {
    const next = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
    setVolume(next);
    volumeRef.current = next;
    if (!session.current && !bridgeCasting.current) return;
    volumeQueue.current = next;
    if (volumeBusy.current) return;
    volumeBusy.current = true;
    try {
      while (volumeQueue.current !== null) {
        const value = volumeQueue.current;
        volumeQueue.current = null;
        if (bridgeCasting.current)
          await companion.current.request("control", {
            action: "volume",
            value,
          });
        else await session.current.setVolume(value);
      }
    } catch {
      setError("TV 음량 변경에 실패했습니다.");
    } finally {
      volumeBusy.current = false;
    }
  }
  function control(action) {
    if (bridgeCasting.current) {
      companion.current
        .request(
          "control",
          action === "toggle"
            ? { action: paused ? "play" : "pause" }
            : {
                action: "seek",
                value: (bridgeState.current?.currentTime || 0) + 10,
              },
        )
        .then((state) => {
          bridgeState.current = state;
          setPaused(state.playerState === "PAUSED");
        })
        .catch((e) => setError(e.message));
      return;
    }
    const media = remote.current;
    if (!media) return;
    const fail = () => setError("TV 제어에 실패했습니다.");
    if (action === "toggle") {
      const type = paused ? "play" : "pause";
      media[type](null, () => setPaused(!paused), fail);
    }
    if (action === "seek") {
      const request = new chrome.cast.media.SeekRequest();
      request.currentTime = media.getEstimatedTime() + 10;
      media.seek(request, () => {}, fail);
    }
  }
  function toggleSubs() {
    const next = !subOn;
    setSubOn(next);
    if (bridgeCasting.current)
      companion.current
        .request("control", { action: "subtitles", value: next && !!caption })
        .catch((e) => setError(e.message));
    if (remote.current) {
      const request = new chrome.cast.media.EditTracksInfoRequest(
        next && caption ? [1] : [],
      );
      remote.current.editTracksInfo(
        request,
        () => {},
        () => setError("TV 자막 변경에 실패했습니다."),
      );
    }
  }
  async function clear() {
    if (busy) {
      setError("파일 전송 또는 TV 연결이 끝난 뒤 비워 주세요.");
      return;
    }
    if (pcReady) {
      try {
        await companion.current.request("clear");
        uploaded.current.clear();
        bridgeCasting.current = false;
      } catch (e) {
        setError(e.message);
        return;
      }
    }
    session.current?.endSession(true);
    session.current = null;
    remote.current = null;
    setConnected("");
    video.current?.pause();
    setItem(null);
    setCaption(null);
    setUrl("");
    setSubUrl("");
    selectedFile.current = null;
    subFiles.current = [];
    for (const value of owned.current) URL.revokeObjectURL(value);
    owned.current = [];
    setPrivacy(false);
    setNotice("이번 세션의 파일 참조와 주소를 비웠습니다.");
  }
  return (
    <div
      className="public-app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        openFiles(e.dataTransfer.files);
      }}
    >
      <header>
        <a className="logo" href="./">
          <span>
            <Play fill="currentColor" size={20} />
          </span>
          KPLAYER.
        </a>
        <nav>
          <span className="public-tag">PUBLIC WEB PLAYER</span>
          <button onClick={() => setPrivacy(true)}>
            <ShieldCheck size={17} />
            <span>프라이버시</span>
          </button>
          <a
            href="https://github.com/ssallem/Kplayer"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub 저장소"
          >
            <Github size={20} />
          </a>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div>
            <div className="eyebrow">YOUR SCREEN, ANYWHERE.</div>
            <h1>
              좋아하는 순간을,
              <br />더 큰 화면으로<span>.</span>
            </h1>
            <p>내 영상과 자막을 가볍게. 웹에서 고르고, TV로 이어 보세요.</p>
          </div>
          <div className="hero-note">
            <span>
              <ShieldCheck size={27} />
            </span>
            <strong>외부 서버 업로드 없이.</strong>
            <p>
              PC 파일은 브라우저 또는 내 PC를 통해 TV에서 재생합니다.
              <br />
              회원가입도, 재생 기록 저장도 없습니다.
            </p>
          </div>
        </section>
        <div className="workbench">
          <section className="player">
            <div className="stage">
              {item ? (
                <video
                  key={item.url}
                  ref={video}
                  src={item.url}
                  crossOrigin="anonymous"
                  controls
                  playsInline
                  onError={() =>
                    setError(
                      "이 브라우저에서 지원하지 않는 코덱이거나 영상 주소에 접근할 수 없습니다. 로컬 버전의 호환 변환을 이용하세요.",
                    )
                  }
                >
                  <track
                    key={caption?.url || "none"}
                    src={caption?.url}
                    label="자막"
                    kind="subtitles"
                    srcLang="ko"
                    default
                  />
                </video>
              ) : (
                <div className="empty">
                  <span className="stage-label">YOUR PRIVATE CINEMA</span>
                  <div className="cinema">
                    <Play size={44} fill="currentColor" />
                  </div>
                  <h2>오늘의 감상, 여기서 시작.</h2>
                  <p>영상과 같은 이름의 자막을 함께 놓아 주세요.</p>
                  <button
                    className="button lime"
                    onClick={() => files.current.click()}
                  >
                    <FolderOpen size={17} />
                    파일 열기
                    <ArrowRight size={16} />
                  </button>
                  <button
                    className="folder-button"
                    onClick={() => folder.current.click()}
                  >
                    폴더에서 영상·자막 자동 찾기
                  </button>
                  <small>MP4 · WEBM · MP3 / SRT · VTT</small>
                </div>
              )}
            </div>
            <div className="player-bottom">
              <span>
                <Play size={13} />
                {connected
                  ? `${connected}에서 재생 중`
                  : item?.name || "준비되면 재생하세요."}
              </span>
              {connected && (
                <div className="remote-controls">
                  <button
                    aria-label="TV 재생 전환"
                    onClick={() => control("toggle")}
                  >
                    {paused ? <Play size={17} /> : <Pause size={17} />}
                  </button>
                  <button onClick={() => control("seek")}>+10초</button>
                </div>
              )}
              <button
                onClick={castVideo}
                disabled={busy}
                title="영상과 자막을 Chromecast로 전송"
              >
                <Cast size={20} />
              </button>
            </div>
          </section>
          <aside>
            <section className="card">
              <div className="card-heading">
                <LinkIcon size={19} />
                <h2>어디서 가져올까요?</h2>
              </div>
              <div className="tabs">
                <button
                  className={tab === "local" ? "active" : ""}
                  onClick={() => setTab("local")}
                >
                  내 파일
                </button>
                <button
                  className={tab === "url" ? "active" : ""}
                  onClick={() => setTab("url")}
                >
                  인터넷 주소
                </button>
              </div>
              {tab === "local" ? (
                <>
                  <p>
                    PC에서 재생하거나 TV로 전송합니다.
                    <br />
                    같은 제목의 SRT·VTT는 자동으로 연결돼요.
                  </p>
                  <button
                    className="button dark wide"
                    onClick={() => files.current.click()}
                  >
                    <Plus size={17} />
                    영상·자막 선택
                  </button>
                  <button
                    className="text-button"
                    onClick={() => folder.current.click()}
                  >
                    폴더 선택으로 자막까지 한 번에 <ArrowRight size={13} />
                  </button>
                </>
              ) : (
                <form onSubmit={loadUrl}>
                  <label>
                    영상 HTTPS 주소
                    <input
                      type="url"
                      aria-label="영상 HTTPS 주소"
                      placeholder="https://…/movie.mp4"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      required
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    자막 VTT 주소 (선택)
                    <input
                      type="url"
                      aria-label="자막 VTT 주소"
                      placeholder="https://…/subtitles.vtt"
                      value={subUrl}
                      onChange={(e) => setSubUrl(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    영상 형식
                    <select
                      value={mediaType}
                      onChange={(e) => setMediaType(e.target.value)}
                    >
                      <option value="video/mp4">MP4</option>
                      <option value="video/webm">WebM</option>
                      <option value="application/x-mpegURL">HLS</option>
                      <option value="application/dash+xml">MPEG-DASH</option>
                    </select>
                  </label>
                  <button className="button dark wide">
                    주소 열기
                    <ArrowRight size={16} />
                  </button>
                  <small>
                    직접 재생 가능한 주소와 CORS가 필요합니다. YouTube 페이지
                    주소는 지원하지 않습니다.
                  </small>
                </form>
              )}
            </section>
            <section className="card">
              <div className="card-heading">
                <Volume2 size={19} />
                <h2>딱 맞는 음량</h2>
                <span className="tag">1% STEP</span>
              </div>
              <div className="volume">
                <button
                  aria-label="음량 1% 줄이기"
                  onClick={() => adjust(volumeRef.current - 0.01)}
                >
                  <Minus size={17} />
                </button>
                <label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    aria-label="음량 퍼센트"
                    value={Math.round(volume * 100)}
                    onChange={(e) => adjust(Number(e.target.value) / 100)}
                  />
                  %
                </label>
                <button
                  aria-label="음량 1% 높이기"
                  onClick={() => adjust(volumeRef.current + 0.01)}
                >
                  <Plus size={17} />
                </button>
              </div>
              <input
                className="range"
                type="range"
                min="0"
                max="1"
                step=".01"
                aria-label="음량 슬라이더"
                value={volume}
                onChange={(e) => adjust(Number(e.target.value))}
              />
              <div className="subtitle-row">
                <Subtitles size={17} />
                <span>
                  {caption ? "자막 연결됨" : "같은 제목의 자막 자동 연결"}
                </span>
                <button
                  disabled={!caption}
                  onClick={toggleSubs}
                  aria-label="자막 표시 전환"
                >
                  {caption && subOn ? "ON" : "OFF"}
                </button>
              </div>
            </section>
          </aside>
        </div>
        {error && (
          <div className="message error" role="alert">
            <span>{error}</span>
            <button aria-label="오류 닫기" onClick={() => setError("")}>
              <X size={18} />
            </button>
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            <span>{notice}</span>
            <button aria-label="알림 닫기" onClick={() => setNotice("")}>
              <X size={18} />
            </button>
          </div>
        )}
        <section className="cast-strip">
          <span className="cast-icon">
            <Cast size={27} />
          </span>
          <div>
            <h2>내 영상과 자막을 TV로 보내세요.</h2>
            <p>
              같은 Wi-Fi · Google Cast TV · PC 파일은 KPLAYER.vbs 실행 후 연결
            </p>
          </div>
          <button
            className="button dark"
            disabled={busy || !item}
            onClick={castVideo}
          >
            <Cast size={17} />
            {busy ? "연결 준비 중…" : "Chromecast 연결"}
          </button>
        </section>
        <section className="versions">
          <div className="section-title">
            <div className="eyebrow">TWO WAYS TO WATCH</div>
            <h2>당신의 환경에 맞게.</h2>
            <p>
              PC 연결 프로그램을 실행하면 이 웹 화면에서도 파일과 자막을 TV로
              보낼 수 있습니다.
            </p>
          </div>
          <div className="version-grid">
            <article>
              <span className="version-icon">
                <Wifi size={24} />
              </span>
              <span className="version-type">INTERNET</span>
              <h3>Chromecast 로컬 버전</h3>
              <p>
                내 PC의 영상과 자막을 Chromecast로 직접 전송합니다. 원본 파일을
                열면 같은 폴더의 자막도 자동 연결됩니다.
              </p>
              <a
                className="button dark"
                href="https://github.com/ssallem/Kplayer/releases/latest"
              >
                <Download size={16} />
                Windows 다운로드
              </a>
              <small>KPLAYER.vbs 실행 · 리시버 실행에 인터넷 필요</small>
            </article>
            <article>
              <span className="version-icon">
                <WifiOff size={24} />
              </span>
              <span className="version-type">OFFLINE</span>
              <h3>인터넷 없는 로컬 버전</h3>
              <p>
                같은 공유기만 있으면 됩니다. TV 브라우저에서 PC의 주소를 열고
                6자리 번호를 입력해 연결하세요.
              </p>
              <a
                className="button outline"
                href="https://github.com/ssallem/Kplayer/releases/latest"
              >
                <Download size={16} />
                오프라인 버전 다운로드
              </a>
              <small>KPLAYER-Offline.vbs 실행 · TV 웹브라우저 필요</small>
            </article>
          </div>
        </section>
        <section className="privacy-note">
          <ShieldCheck size={22} />
          <div>
            <h3>파일은 당신의 공간에.</h3>
            <p>
              영상·자막은 외부 서버에 업로드하지 않습니다. PC 파일을 TV로 전송할
              때는 연결한 내 PC에 임시 복사본이 생깁니다. 재생 기록은 저장하지
              않습니다. 인터넷 주소 재생은 해당 영상 서버에 요청하며, 인터넷
              영상의 Cast 연결 시 Google SDK를 불러옵니다. GitHub의 사이트 접속
              로그와 브라우저·TV의 기록은 별개입니다.
            </p>
          </div>
          <button onClick={() => setPrivacy(true)}>
            자세히
            <ArrowRight size={14} />
          </button>
        </section>
      </main>
      <footer>
        <span>
          KPLAYER. <small>MADE FOR YOUR MOMENTS.</small>
        </span>
        <a href="https://github.com/ssallem/Kplayer">Open source · MIT</a>
      </footer>
      <input
        hidden
        ref={files}
        type="file"
        multiple
        accept=".mp4,.m4v,.mkv,.mov,.webm,.mp3,.m4a,.ogg,.wav,.srt,.vtt"
        onChange={(e) => {
          openFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={folder}
        type="file"
        webkitdirectory=""
        multiple
        onChange={(e) => {
          openFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {tvDialog && (
        <div className="modal-backdrop" onClick={() => setTvDialog(false)}>
          <section
            className="privacy-modal tv-modal"
            role="dialog"
            aria-modal="true"
            aria-label="TV 연결"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="TV 연결 닫기"
              onClick={() => setTvDialog(false)}
            >
              <X />
            </button>
            <Cast size={30} />
            <h2>어디에서 감상할까요?</h2>
            <p role="status">{progress}</p>
            {!pcReady ? (
              <>
                <ol>
                  <li>
                    다운로드한 폴더의 <strong>KPLAYER.vbs</strong>를 실행하세요.
                  </li>
                  <li>
                    PC 연결 창에서 <strong>웹 플레이어 연결</strong>을 누르세요.
                  </li>
                  <li>이 화면에서 TV를 선택하세요.</li>
                </ol>
                <p>
                  최신 PC 연결 프로그램(v1.2.0 이상)이 필요합니다. 팝업이
                  차단되면 이 사이트의 팝업을 허용해 주세요.
                </p>
                <a
                  className="button outline wide"
                  href="https://github.com/ssallem/Kplayer/releases/latest"
                  target="_blank"
                  rel="noreferrer"
                >
                  PC 연결 프로그램 다운로드
                </a>
                <button
                  className="button dark wide"
                  onClick={castVideo}
                  disabled={busy}
                >
                  PC 연결 다시 시도
                </button>
              </>
            ) : (
              <>
                <div className="tv-devices">
                  {devices.map((device) => (
                    <button
                      className="button outline wide"
                      key={device.id || device.address}
                      disabled={busy}
                      onClick={() => loadOnTv(device.address)}
                    >
                      <Cast size={18} />
                      <span>
                        {device.name}
                        <small>
                          {device.model} · {device.address}
                        </small>
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
                {!devices.length && (
                  <p>
                    아직 발견된 TV가 없습니다. 같은 공유기에 연결했는지
                    확인하거나 TV의 IP 주소를 입력하세요.
                  </p>
                )}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    companion.current
                      .request("scan")
                      .catch((e) => setError(e.message))
                  }
                >
                  TV 다시 검색
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    loadOnTv(tvAddress);
                  }}
                >
                  <label>
                    TV IP 주소
                    <input
                      aria-label="TV IP 주소"
                      value={tvAddress}
                      onChange={(e) => setTvAddress(e.target.value)}
                      placeholder="192.168.0.20"
                      autoComplete="off"
                      required
                    />
                  </label>
                  <button className="button dark wide" disabled={busy}>
                    이 TV로 재생
                  </button>
                </form>
                <p>영상은 내 PC에만 임시 복사됩니다. 연결 창을 열어 두세요.</p>
              </>
            )}
          </section>
        </div>
      )}
      {privacy && (
        <div className="modal-backdrop" onClick={() => setPrivacy(false)}>
          <section
            className="privacy-modal"
            role="dialog"
            aria-modal="true"
            aria-label="프라이버시 안내"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="닫기"
              onClick={() => setPrivacy(false)}
            >
              <X />
            </button>
            <ShieldCheck size={30} />
            <h2>기록 없이 즐기세요.</h2>
            <p>
              웹의 파일 참조와 재생 주소는 이 탭의 메모리에만 존재합니다. TV
              전송 시 선택한 파일을 연결된 내 PC에 임시 복사하며 외부 서버로
              보내지 않습니다. 분석 도구, localStorage, IndexedDB, 계정 기능을
              사용하지 않습니다.
            </p>
            <p>
              로컬 버전의 드래그 파일과 변환 파일은 임시 복사본이 생기며, 세션
              비우기·정상 종료 또는 모든 PC 탭을 닫은 뒤 약 30초 후 정리합니다.
              강제 종료 잔여물은 다음 실행 때 삭제합니다.
            </p>
            <p>
              브라우저 방문 기록, OS·보안 프로그램·TV의 기록, GitHub 사이트 접속
              로그까지 지우는 기능은 아닙니다. 삭제 파일의 복구 불가능성도
              보장하지 않습니다.
            </p>
            <button className="button dark wide" onClick={clear}>
              <Trash2 size={17} />
              재생 종료·이번 세션 비우기
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
