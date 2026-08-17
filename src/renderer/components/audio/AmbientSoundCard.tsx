import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX, Sliders, FolderOpen, Play, Pause, SkipForward, SkipBack, Music, Shuffle, Repeat, AlertCircle } from 'lucide-react';
import { soundEngineSingleton } from '../../services/SoundEngine';
import { TrackInfo, Language, AudioSettings } from '../../../shared/types';
import { formatNumber, formatSecondsToMMSS } from '../../utils/formatters';

export const AmbientSoundCard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.language || 'en') as Language;

  // Brown Noise Synthesizer State
  const [isPlayingBrown, setIsPlayingBrown] = useState(false);
  const [brownVolume, setBrownVolume] = useState(0.4);

  // Custom Local Folder Music Player State
  const [folderPath, setFolderPath] = useState<string>('');
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [isPlayingMusic, setIsPlayingMusic] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.6);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // Progress Seek Bar & Modes State
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isRepeatRef = useRef(false);
  const isShuffleRef = useRef(false);
  const tracksRef = useRef<TrackInfo[]>([]);
  const currentTrackIndexRef = useRef(-1);
  const errorStreakRef = useRef(0);
  const skipVolumesRef = useRef(true);

  useEffect(() => {
    isRepeatRef.current = isRepeat;
  }, [isRepeat]);
  useEffect(() => {
    isShuffleRef.current = isShuffle;
  }, [isShuffle]);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);
  useEffect(() => {
    currentTrackIndexRef.current = currentTrackIndex;
  }, [currentTrackIndex]);

  /**
   * Progresses to the next suitable track, retrying on `errorStreak` corrupt
   * files before giving up so the player never gets stuck on a bad file.
   */
  const playTrack = useCallback((index: number): boolean => {
    const audio = audioRef.current;
    if (!audio || !tracksRef.current.length) return false;
    const normalized = ((index % tracksRef.current.length) + tracksRef.current.length) % tracksRef.current.length;
    const track = tracksRef.current[normalized];
    setCurrentTrackIndex(normalized);
    audio.src = track.mediaUrl;
    audio
      .play()
      .then(() => {
        errorStreakRef.current = 0;
        setIsPlayingMusic(true);
        setPlaybackError(null);
      })
      .catch((err) => {
        console.error('[AudioPlayer] Playback failed:', err);
        errorStreakRef.current += 1;
        setIsPlayingMusic(false);
        if (errorStreakRef.current < tracksRef.current.length) {
          const nextIdx = (normalized + 1) % tracksRef.current.length;
          playTrack(nextIdx);
        } else {
          setPlaybackError(t('audio.playbackFailed'));
        }
      });
    return true;
  }, [t]);

  const nextTrack = useCallback(() => {
    if (!tracksRef.current.length) return;
    let nextIdx: number;
    if (isShuffleRef.current) {
      nextIdx = Math.floor(Math.random() * tracksRef.current.length);
    } else {
      nextIdx = (currentTrackIndexRef.current + 1) % tracksRef.current.length;
    }
    playTrack(nextIdx);
  }, [playTrack]);

  // Initialize the audio element once, subscribe to settings + mute events.
  useEffect(() => {
    const audio = new Audio();
    audio.volume = musicVolume;
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
      setDuration(audio.duration || 0);
    };

    const handleEnded = () => {
      if (isRepeatRef.current) {
        audio.currentTime = 0;
        audio.play().catch(() => {
          audio.pause();
          setIsPlayingMusic(false);
        });
      } else {
        nextTrack();
      }
    };

    const handleError = () => {
      // Fallback in case 'error' fires without a rejected play() promise.
      if (audio.src) {
        errorStreakRef.current += 1;
        setIsPlayingMusic(false);
        if (errorStreakRef.current < tracksRef.current.length) {
          nextTrack();
        } else {
          setPlaybackError(t('audio.playbackFailed'));
        }
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    let settingsUnsub: (() => void) | undefined;
    let mutedUnsub: (() => void) | undefined;

    if (window.focusStudyAPI) {
      // Apply persisted audio settings on startup.
      window.focusStudyAPI.getAudioSettings().then((settings: AudioSettings) => {
        setMusicVolume(settings.musicVolume);
        audio.volume = settings.masterMuted ? 0 : settings.musicVolume;
        setBrownVolume(settings.noiseVolume);
        soundEngineSingleton.setMasterVolume(settings.masterMuted ? 0 : 1);
        soundEngineSingleton.setNoiseVolume(settings.noiseVolume);
        if (settings.noiseEnabled) {
          const active = soundEngineSingleton.toggleBrownNoise(settings.noiseVolume);
          setIsPlayingBrown(active);
        }
      });

      window.focusStudyAPI.getMusicFolder().then((path) => {
        if (path) {
          setFolderPath(path);
          window.focusStudyAPI.getMusicTracks().then(setTracks);
        }
      });

      settingsUnsub = window.focusStudyAPI.onAudioSettingsChanged((settings) => {
        setMusicVolume(settings.musicVolume);
        setBrownVolume(settings.noiseVolume);
        if (audio) audio.volume = settings.masterMuted ? 0 : settings.musicVolume;
        soundEngineSingleton.setNoiseVolume(settings.noiseVolume);
      });

      mutedUnsub = window.focusStudyAPI.onMasterMuted((muted) => {
        soundEngineSingleton.setMasterVolume(muted ? 0 : 1);
        if (audio) audio.volume = muted ? 0 : musicVolumeRef.current;
      });
    }

    return () => {
      if (settingsUnsub) settingsUnsub();
      if (mutedUnsub) mutedUnsub();
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.pause();
      audio.src = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const musicVolumeRef = useRef(musicVolume);
  useEffect(() => {
    musicVolumeRef.current = musicVolume;
  }, [musicVolume]);

  // Persist volume changes (skip the first run that mirrors stored values).
  useEffect(() => {
    if (skipVolumesRef.current) {
      skipVolumesRef.current = false;
      return;
    }
    if (audioRef.current) audioRef.current.volume = musicVolume;
    if (window.focusStudyAPI) {
      window.focusStudyAPI.setAudioSettings({ musicVolume });
    }
  }, [musicVolume]);

  useEffect(() => {
    if (skipVolumesRef.current) return;
    if (window.focusStudyAPI) {
      window.focusStudyAPI.setAudioSettings({ noiseVolume: brownVolume });
    }
  }, [brownVolume]);

  const handleToggleBrown = () => {
    const active = soundEngineSingleton.toggleBrownNoise(brownVolume);
    setIsPlayingBrown(active);
    if (window.focusStudyAPI) {
      window.focusStudyAPI.setAudioSettings({ noiseEnabled: active });
    }
  };

  const handleBrownVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setBrownVolume(val);
    soundEngineSingleton.setNoiseVolume(val);
  };

  const handleSelectFolder = async () => {
    if (!window.focusStudyAPI) return;
    try {
      const selected = await window.focusStudyAPI.selectMusicFolder();
      if (selected) {
        setFolderPath(selected);
        const loadedTracks = await window.focusStudyAPI.getMusicTracks();
        setTracks(loadedTracks);
        setCurrentTrackIndex(-1);
        setIsPlayingMusic(false);
        setPlaybackError(null);
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
        }
      }
    } catch (err) {
      console.error('[AudioPlayer] Failed selecting folder:', err);
    }
  };

  const handleToggleMusic = () => {
    const audio = audioRef.current;
    if (!audio || tracks.length === 0) return;

    if (isPlayingMusic) {
      audio.pause();
      setIsPlayingMusic(false);
    } else {
      if (currentTrackIndex === -1) {
        playTrack(0);
      } else {
        audio.play().then(() => {
          errorStreakRef.current = 0;
          setIsPlayingMusic(true);
        }).catch(() => {
          nextTrack();
        });
      }
    }
  };

  const handleNextTrack = () => nextTrack();

  const handlePrevTrack = () => {
    if (tracks.length === 0) return;
    let prevIdx: number;
    if (isShuffle) {
      prevIdx = Math.floor(Math.random() * tracks.length);
    } else {
      prevIdx = (currentTrackIndex - 1 + tracks.length) % tracks.length;
    }
    playTrack(prevIdx);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = parseFloat(e.target.value);
    setCurrentTime(targetTime);
    if (audioRef.current) {
      audioRef.current.currentTime = targetTime;
    }
  };

  
  const currentTrack = currentTrackIndex >= 0 && currentTrackIndex < tracks.length ? tracks[currentTrackIndex] : null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold">
          <Volume2 className="w-4 h-4 text-emerald-400" />
          <span>{t('audio.title')}</span>
        </div>
        <span className="text-xs font-mono text-emerald-400 font-semibold">
          {isPlayingBrown || isPlayingMusic ? t('common.active') : t('common.muted')}
        </span>
      </div>

      {/* Brown Noise Section */}
      <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-300 font-medium">
          <span>{t('audio.brownNoise')}</span>
          <button
            onClick={handleToggleBrown}
            className={`p-1.5 rounded-lg border transition-all ${
              isPlayingBrown
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {isPlayingBrown ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Sliders className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={brownVolume}
            onChange={handleBrownVolumeChange}
            className="w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      {/* Local Folder Music Player Section */}
      <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-teal-400 font-bold">
            <Music className="w-4 h-4" />
            <span>{t('audio.musicPlayer')}</span>
          </div>

          <button
            onClick={handleSelectFolder}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] rounded-lg font-medium border border-slate-700 flex items-center gap-1 transition-all"
            title={folderPath || t('audio.selectFolder')}
          >
            <FolderOpen className="w-3.5 h-3.5 text-teal-400" />
            <span>{t('audio.selectFolder')}</span>
          </button>
        </div>

        {/* Selected Folder info & Track details */}
        {tracks.length > 0 ? (
          <div className="space-y-2">
            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="truncate pe-2">
                  <div className="text-xs font-semibold text-slate-100 truncate">
                    {currentTrack ? currentTrack.name : t('audio.nowPlaying')}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                    {t('audio.trackCount', { count: formatNumber(tracks.length, currentLang) })}
                  </div>
                </div>

                {/* Player Transport Controls */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setIsShuffle(!isShuffle)}
                    className={`p-1.5 rounded-lg transition-all ${
                      isShuffle ? 'text-teal-400 bg-teal-500/10' : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title={t('audio.shuffle')}
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={handlePrevTrack}
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all"
                  >
                    <SkipBack className="w-3.5 h-3.5 rtl:rotate-180" />
                  </button>

                  <button
                    onClick={handleToggleMusic}
                    className="p-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg shadow-md shadow-emerald-500/20 transition-all"
                  >
                    {isPlayingMusic ? (
                      <Pause className="w-4 h-4 fill-slate-950" />
                    ) : (
                      <Play className="w-4 h-4 fill-slate-950 rtl:rotate-180" />
                    )}
                  </button>

                  <button
                    onClick={handleNextTrack}
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all"
                  >
                    <SkipForward className="w-3.5 h-3.5 rtl:rotate-180" />
                  </button>

                  <button
                    onClick={() => setIsRepeat(!isRepeat)}
                    className={`p-1.5 rounded-lg transition-all ${
                      isRepeat ? 'text-teal-400 bg-teal-500/10' : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title={t('audio.repeat')}
                  >
                    <Repeat className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Playback Error Banner */}
              {playbackError && (
                <div className="flex items-center gap-1.5 text-[10px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-2 py-1.5">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>{playbackError}</span>
                </div>
              )}

              {/* Progress Seek Bar */}
              <div className="space-y-1">
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  step="1"
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full accent-teal-400 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>{formatSecondsToMMSS(currentTime, currentLang)}</span>
                  <span>{formatSecondsToMMSS(duration, currentLang)}</span>
                </div>
              </div>
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-3 pt-1">
              <Sliders className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={musicVolume}
                onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                className="w-full accent-teal-400 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 text-center py-2 border border-dashed border-slate-800 rounded-lg">
            {folderPath ? t('audio.noTracksFound') : t('audio.noFolderSelected')}
          </div>
        )}
      </div>
    </div>
  );
};